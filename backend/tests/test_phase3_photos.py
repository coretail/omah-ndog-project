from __future__ import annotations

import io
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageOps

from backend.config import AppConfig
from backend.main import create_app
from backend.services import photo_scanner as photo_scanner_module
from backend.services.photo_scanner import PhotoPathError, PhotoScannerService, resolve_photo_file


def _make_jpeg_bytes(
    width: int = 800,
    height: int = 600,
    *,
    exif_orientation: int | None = None,
) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), (30, 120, 210))
    if exif_orientation is not None:
        exif = img.getexif()
        exif[274] = exif_orientation
        img.save(buf, format="JPEG", quality=85, exif=exif)
    else:
        img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _setup_studio_with_session(
    tmp_path: Path,
    *,
    subfolder: str = "sesi-01",
    filter_after_created_at: bool = False,
    rate_limit_requests: int = 60,
    media_rate_limit_requests: int = 600,
    stability_delay_sec: float = 0.0,
) -> tuple[object, AppConfig, Path, str]:
    pin_code = "482910"
    cfg = AppConfig(
        data_dir=tmp_path / "data",
        admin_initial_pin=pin_code,
        rate_limit_requests=rate_limit_requests,
        media_rate_limit_requests=media_rate_limit_requests,
        photo_stability_delay_sec=stability_delay_sec,
    )
    app = create_app(cfg)
    photo_root = tmp_path / "studio_photos"
    session_dir = photo_root / subfolder
    session_dir.mkdir(parents=True)

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        tok = client.post("/api/admin/auth/login", json={"pin": pin_code}).json()["token"]
        headers = {"Authorization": f"Bearer {tok}"}
        client.put(
            "/api/admin/settings",
            json={
                "photo_root_dir": str(photo_root),
                "folder_mode": "active",
                "active_subfolder": subfolder,
            },
            headers=headers,
        )
        reg = client.post(
            "/api/sessions",
            json={
                "name": "Hana",
                "whatsapp": "081234567890",
                "email": "hana@example.com",
                "consent_accepted": True,
                "filter_after_created_at": filter_after_created_at,
            },
        )
        assert reg.status_code == 201
        session_token = reg.json()["token"]

    return app, cfg, photo_root, session_token


def test_photo_path_traversal_and_symlink_escape(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, _, photo_root, token = _setup_studio_with_session(tmp_path)
    (photo_root / "secret.jpg").write_bytes(_make_jpeg_bytes())
    (photo_root / "sesi-01" / "ok.jpg").write_bytes(_make_jpeg_bytes())

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        for bad_path in (
            f"/api/photos/{token}/../thumb",
            f"/api/photos/{token}/%2e%2e/thumb",
            f"/api/photos/{token}/..%2fsecret.jpg/thumb",
            f"/api/photos/{token}/sub%5csecret.jpg/thumb",
            f"/api/photos/{token}/notes.txt/thumb",
        ):
            resp = client.get(bad_path)
            assert resp.status_code in (400, 403, 404)

        assert client.get(f"/api/photos/{token}/ok.jpg/thumb").status_code == 200

    # Symlink / Path.resolve() escape outside session folder
    escape_link = photo_root / "sesi-01" / "escape.jpg"
    secret_target = photo_root / "secret.jpg"
    try:
        os.symlink(secret_target, escape_link)
    except OSError:
        real_resolve = Path.resolve

        def fake_resolve(self: Path, strict: bool = False) -> Path:
            if self.name == "escape.jpg":
                return secret_target
            return real_resolve(self, strict=strict)

        escape_link.write_bytes(_make_jpeg_bytes())
        monkeypatch.setattr(Path, "resolve", fake_resolve)

    with pytest.raises(PhotoPathError) as exc_info:
        resolve_photo_file(str(photo_root), "sesi-01", "escape.jpg")
    assert exc_info.value.status_code == 403


def test_photo_scanner_skips_corrupt_truncated_and_unstable_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, cfg, photo_root, token = _setup_studio_with_session(tmp_path)
    session_dir = photo_root / "sesi-01"

    valid_bytes = _make_jpeg_bytes(800, 600)
    (session_dir / "valid.jpg").write_bytes(valid_bytes)
    (session_dir / "truncated.jpg").write_bytes(valid_bytes[: len(valid_bytes) // 3])
    (session_dir / "garbage.jpg").write_bytes(b"definitely-not-a-jpeg")
    (session_dir / "empty.jpg").write_bytes(b"")
    (session_dir / "readme.txt").write_text("ignore me", encoding="utf-8")

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        resp = client.get(f"/api/photos/{token}")
        assert resp.status_code == 200
        names = [p["filename"] for p in resp.json()["photos"]]
        assert names == ["valid.jpg"]

    # Deterministic test for file still being copied during stability delay
    scanner = PhotoScannerService(cfg.thumbnails_dir, stability_delay_sec=0.05)
    copying_path = session_dir / "copying.jpg"
    copying_path.write_bytes(valid_bytes[:200])

    mutated = [False]

    def append_during_copy(_seconds: float) -> None:
        if not mutated[0]:
            mutated[0] = True
            copying_path.write_bytes(valid_bytes)

    monkeypatch.setattr(photo_scanner_module.time, "sleep", append_during_copy)

    first_scan = scanner.list_photos(str(photo_root), "sesi-01")
    assert [p.filename for p in first_scan] == ["valid.jpg"]

    # Next scan sees copying.jpg stable and valid
    second_scan = scanner.list_photos(str(photo_root), "sesi-01")
    assert [p.filename for p in second_scan] == ["copying.jpg", "valid.jpg"]


def test_photo_exif_orientation_and_webp_thumb_preview(tmp_path: Path) -> None:
    app, cfg, photo_root, token = _setup_studio_with_session(tmp_path)
    portrait_via_exif = _make_jpeg_bytes(1600, 900, exif_orientation=6)
    (photo_root / "sesi-01" / "IMG_0001.JPG").write_bytes(portrait_via_exif)

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        listed = client.get(f"/api/photos/{token}")
        assert listed.status_code == 200
        photos = listed.json()["photos"]
        assert len(photos) == 1
        assert photos[0]["width"] == 900
        assert photos[0]["height"] == 1600

        thumb_resp = client.get(photos[0]["thumb_url"])
        assert thumb_resp.status_code == 200
        assert thumb_resp.headers["content-type"] == "image/webp"
        assert thumb_resp.headers["cache-control"] == "private, max-age=3600"
        assert "etag" in thumb_resp.headers
        assert len(thumb_resp.content) < 100_000
        with Image.open(io.BytesIO(thumb_resp.content)) as thumb_img:
            assert thumb_img.format == "WEBP"
            assert thumb_img.size == (270, 480)

        preview_resp = client.get(photos[0]["preview_url"])
        assert preview_resp.status_code == 200
        assert preview_resp.headers["content-type"] == "image/webp"
        assert preview_resp.headers["cache-control"] == "private, max-age=3600"
        with Image.open(io.BytesIO(preview_resp.content)) as prev_img:
            assert prev_img.format == "WEBP"
            assert prev_img.size == (675, 1200)

    cached_files = list(cfg.thumbnails_dir.glob("*.webp"))
    assert len(cached_files) == 2


def test_photo_filter_after_created_at_on_reused_subfolder(tmp_path: Path) -> None:
    app, _, photo_root, token_filtered = _setup_studio_with_session(
        tmp_path, subfolder="shared", filter_after_created_at=True
    )
    shared_dir = photo_root / "shared"
    old_photo = shared_dir / "old.jpg"
    old_photo.write_bytes(_make_jpeg_bytes())
    past = time.time() - 3600
    os.utime(old_photo, (past, past))

    new_photo = shared_dir / "new.jpg"
    new_photo.write_bytes(_make_jpeg_bytes())
    future = time.time() + 5
    os.utime(new_photo, (future, future))

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        filtered_list = client.get(f"/api/photos/{token_filtered}")
        assert filtered_list.status_code == 200
        assert [p["filename"] for p in filtered_list.json()["photos"]] == ["new.jpg"]
        assert client.get(f"/api/photos/{token_filtered}/old.jpg/thumb").status_code == 404
        assert client.get(f"/api/photos/{token_filtered}/new.jpg/thumb").status_code == 200

        # Second session on the same subfolder without time filter sees both photos
        reg2 = client.post(
            "/api/sessions",
            json={
                "name": "Indra",
                "whatsapp": "081234567899",
                "email": "indra@example.com",
                "consent_accepted": True,
                "filter_after_created_at": False,
            },
        )
        assert reg2.status_code == 201
        token_unfiltered = reg2.json()["token"]
        unfiltered_list = client.get(f"/api/photos/{token_unfiltered}")
        assert unfiltered_list.status_code == 200
        assert [p["filename"] for p in unfiltered_list.json()["photos"]] == ["new.jpg", "old.jpg"]


def test_photo_session_invalidation_rate_limit_and_semaphore(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, cfg, photo_root, token = _setup_studio_with_session(
        tmp_path, rate_limit_requests=3, media_rate_limit_requests=10
    )
    (photo_root / "sesi-01" / "p1.jpg").write_bytes(_make_jpeg_bytes())

    with TestClient(app, client=("192.168.1.44", 50000)) as lan_client:
        # Media requests use separate higher-capacity bucket and do not exhaust polling quota
        for _ in range(5):
            assert lan_client.get(f"/api/photos/{token}/p1.jpg/thumb").status_code == 200

        for _ in range(3):
            assert lan_client.get(f"/api/photos/{token}").status_code == 200
        blocked = lan_client.get(f"/api/photos/{token}")
        assert blocked.status_code == 429
        assert "Retry-After" in blocked.headers

        # Exceed media bucket (10 allowed, 11th -> 429)
        for _ in range(5):
            assert lan_client.get(f"/api/photos/{token}/p1.jpg/thumb").status_code == 200
        media_blocked = lan_client.get(f"/api/photos/{token}/p1.jpg/thumb")
        assert media_blocked.status_code == 429
        assert "Retry-After" in media_blocked.headers

    # Completed session is rejected with 410 on photo endpoints
    with TestClient(app, client=("127.0.0.1", 50000)) as local_client:
        assert local_client.post(f"/api/sessions/{token}/complete").status_code == 200
    with TestClient(app, client=("192.168.1.45", 50000)) as completed_client:
        assert completed_client.get(f"/api/photos/{token}").status_code == 410
        assert completed_client.get(f"/api/photos/{token}/p1.jpg/thumb").status_code == 410

    # Semaphore caps concurrent Pillow thumbnail jobs
    for i in range(8):
        (photo_root / "sesi-01" / f"bulk_{i}.jpg").write_bytes(_make_jpeg_bytes(400, 300))

    scanner = PhotoScannerService(
        cfg.thumbnails_dir / "sem_test",
        stability_delay_sec=0.0,
        max_concurrency=2,
    )
    real_transpose = ImageOps.exif_transpose
    lock = threading.Lock()
    active = [0]
    max_seen = [0]

    def tracked_transpose(img: Image.Image) -> Image.Image:
        with lock:
            active[0] += 1
            if active[0] > max_seen[0]:
                max_seen[0] = active[0]
        try:
            time.sleep(0.02)
            return real_transpose(img)
        finally:
            with lock:
                active[0] -= 1

    monkeypatch.setattr(photo_scanner_module.ImageOps, "exif_transpose", tracked_transpose)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(
                lambda idx: scanner.get_or_create_variant(
                    str(photo_root), "sesi-01", f"bulk_{idx}.jpg", "thumb"
                ),
                range(8),
            )
        )

    assert len(results) == 8
    assert max_seen[0] <= 2
