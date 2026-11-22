from __future__ import annotations

import io
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from backend.config import AppConfig
from backend.main import create_app


def _make_png_bytes(width: int = 400, height: int = 600) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_jpeg_bytes(width: int = 200, height: int = 200) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), (255, 0, 0))
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _admin_headers(client: TestClient, pin_code: str) -> dict[str, str]:
    resp = client.post("/api/admin/auth/login", json={"pin": pin_code})
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['token']}"}


def test_category_crud_and_auth_guards(tmp_path: Path) -> None:
    pin_code = "482910"
    cfg = AppConfig(data_dir=tmp_path / "data", admin_initial_pin=pin_code)
    app = create_app(cfg)

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        # Public read works
        cats = client.get("/api/frames/categories")
        assert cats.status_code == 200
        assert len(cats.json()) == 4

        # Write requires admin auth
        assert (
            client.post(
                "/api/frames/categories",
                json={"name": "Strip", "price": 18000, "width_mm": 50, "height_mm": 150},
            ).status_code
            == 401
        )

        headers = _admin_headers(client, pin_code)

        # Tunnel header blocked even with admin token
        assert (
            client.post(
                "/api/frames/categories",
                json={"name": "Strip", "price": 18000, "width_mm": 50, "height_mm": 150},
                headers={**headers, "CF-Connecting-IP": "198.51.100.1"},
            ).status_code
            == 403
        )

        # Create category
        created = client.post(
            "/api/frames/categories",
            json={
                "name": "Strip",
                "price": 18000,
                "width_mm": 50.0,
                "height_mm": 150.0,
                "orientation": "landscape",
                "safe_margin_mm": 2.5,
                "sort_order": 5,
            },
            headers=headers,
        )
        assert created.status_code == 201
        cat_id = created.json()["id"]
        assert created.json()["orientation"] == "landscape"
        assert created.json()["safe_margin_mm"] == 2.5

        # Duplicate name -> 409
        dup = client.post(
            "/api/frames/categories",
            json={"name": "Strip", "price": 18000, "width_mm": 50, "height_mm": 150},
            headers=headers,
        )
        assert dup.status_code == 409

        # Update category price & orientation
        updated = client.put(
            f"/api/frames/categories/{cat_id}",
            json={"price": 22000, "orientation": "portrait"},
            headers=headers,
        )
        assert updated.status_code == 200
        assert updated.json()["price"] == 22000
        assert updated.json()["orientation"] == "portrait"

        # Delete category
        deleted = client.delete(f"/api/frames/categories/{cat_id}", headers=headers)
        assert deleted.status_code == 200


def test_frame_upload_slots_validation_and_delete(tmp_path: Path) -> None:
    pin_code = "519283"
    cfg = AppConfig(data_dir=tmp_path / "data", admin_initial_pin=pin_code)
    app = create_app(cfg)

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        headers = _admin_headers(client, pin_code)
        cat_id = client.get("/api/frames/categories").json()[0]["id"]

        # Reject non-PNG image (JPEG)
        bad_upload = client.post(
            "/api/frames",
            data={"category_id": str(cat_id), "name": "Bad Frame"},
            files={"file": ("bad.jpg", _make_jpeg_bytes(), "image/jpeg")},
            headers=headers,
        )
        assert bad_upload.status_code == 400

        # Valid PNG upload
        png_bytes = _make_png_bytes(600, 900)
        uploaded = client.post(
            "/api/frames",
            data={"category_id": str(cat_id), "name": "Pastel Pink"},
            files={"file": ("frame.png", png_bytes, "image/png")},
            headers=headers,
        )
        assert uploaded.status_code == 201
        frame_data = uploaded.json()
        frame_id = frame_data["id"]
        assert frame_data["canvas_width"] == 600
        assert frame_data["canvas_height"] == 900
        assert frame_data["slots"] == []

        # Image endpoint serves stored PNG
        img_resp = client.get(frame_data["image_url"])
        assert img_resp.status_code == 200
        assert img_resp.headers["content-type"] == "image/png"
        assert img_resp.content == png_bytes

        # Invalid slot bounds (wPct <= 0, xPct + wPct > 100) rejected with 422
        assert (
            client.put(
                f"/api/frames/{frame_id}/slots",
                json={"slots": [{"id": "s1", "xPct": 10, "yPct": 10, "wPct": 0, "hPct": 20}]},
                headers=headers,
            ).status_code
            == 422
        )
        assert (
            client.put(
                f"/api/frames/{frame_id}/slots",
                json={"slots": [{"id": "s1", "xPct": 80, "yPct": 10, "wPct": 30, "hPct": 20}]},
                headers=headers,
            ).status_code
            == 422
        )

        # Valid slot update persists
        slots_payload = {
            "slots": [
                {"id": "slot-1", "xPct": 10.5, "yPct": 12.0, "wPct": 35.0, "hPct": 40.0, "locked": True},
                {"id": "slot-2", "xPct": 54.5, "yPct": 12.0, "wPct": 35.0, "hPct": 40.0, "locked": False},
            ]
        }
        saved_slots = client.put(
            f"/api/frames/{frame_id}/slots",
            json=slots_payload,
            headers=headers,
        )
        assert saved_slots.status_code == 200
        assert len(saved_slots.json()["slots"]) == 2
        assert saved_slots.json()["slots"][0]["locked"] is True

        # Reload list_frames confirms persistence
        listed = client.get(f"/api/frames?category_id={cat_id}")
        assert listed.status_code == 200
        assert len(listed.json()) == 1
        assert listed.json()[0]["slots"][1]["id"] == "slot-2"

        # Delete frame removes DB entry and stored PNG file
        stored_files = list(cfg.frames_dir.glob("*.png"))
        assert len(stored_files) == 1
        del_resp = client.delete(f"/api/frames/{frame_id}", headers=headers)
        assert del_resp.status_code == 200
        assert list(cfg.frames_dir.glob("*.png")) == []
        assert client.get(frame_data["image_url"]).status_code == 404


def test_admin_subfolders_list_create_and_usage_warning(tmp_path: Path) -> None:
    pin_code = "640281"
    cfg = AppConfig(data_dir=tmp_path / "data", admin_initial_pin=pin_code)
    app = create_app(cfg)
    photo_root = tmp_path / "studio_photos"
    photo_root.mkdir()

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        headers = _admin_headers(client, pin_code)
        client.put(
            "/api/admin/settings",
            json={"photo_root_dir": str(photo_root), "folder_mode": "active"},
            headers=headers,
        )

        # Reject path traversal on subfolder creation
        assert (
            client.post(
                "/api/admin/subfolders",
                json={"name": "../escape"},
                headers=headers,
            ).status_code
            == 422
        )

        created_sf = client.post(
            "/api/admin/subfolders",
            json={"name": "sesi-pagi"},
            headers=headers,
        )
        assert created_sf.status_code == 201
        assert created_sf.json()["name"] == "sesi-pagi"
        assert created_sf.json()["used_by_sessions"] == 0

        # Add one sample photo inside subfolder and activate it
        (photo_root / "sesi-pagi" / "IMG_001.jpg").write_bytes(_make_jpeg_bytes())
        client.put(
            "/api/admin/settings",
            json={"active_subfolder": "sesi-pagi"},
            headers=headers,
        )

        # Register a customer session using active subfolder
        reg = client.post(
            "/api/sessions",
            json={
                "name": "Gita",
                "whatsapp": "081234567890",
                "email": "gita@example.com",
                "consent_accepted": True,
            },
        )
        assert reg.status_code == 201

        subfolders = client.get("/api/admin/subfolders", headers=headers)
        assert subfolders.status_code == 200
        assert len(subfolders.json()) == 1
        assert subfolders.json()[0]["photo_count"] == 1
        assert subfolders.json()[0]["used_by_sessions"] == 1
