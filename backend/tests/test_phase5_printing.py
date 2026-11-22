from __future__ import annotations

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from backend.config import AppConfig
from backend.main import create_app
from backend.schemas import FrameSlotSchema, SelectedPhotoSlotSchema
from backend.services.compositor import (
    PRINT_DPI,
    CompositorError,
    compute_canvas_layout,
    mm_to_pixels,
    render_composite_300dpi,
)
from backend.services.printer import MockPrinterBackend


def _make_transparent_frame_png(width: int = 600, height: int = 900) -> bytes:
    img = Image.new("RGBA", (width, height), (255, 173, 209, 255))
    draw = ImageDraw.Draw(img)
    # Transparent window in the middle-top
    draw.rectangle((60, 90, width - 60, height - 90), fill=(0, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_split_photo_jpeg(
    width: int = 1200,
    height: int = 800,
    *,
    left_color: tuple[int, int, int] = (220, 40, 40),
    right_color: tuple[int, int, int] = (40, 90, 220),
    exif_orientation: int | None = None,
) -> bytes:
    img = Image.new("RGB", (width, height), left_color)
    draw = ImageDraw.Draw(img)
    draw.rectangle((width // 2, 0, width, height), fill=right_color)
    buf = io.BytesIO()
    if exif_orientation is not None:
        exif = img.getexif()
        exif[274] = exif_orientation
        img.save(buf, format="JPEG", quality=95, exif=exif)
    else:
        img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def _setup_app_with_frame_and_session(
    tmp_path: Path,
    *,
    auto_print_enabled: bool = False,
    orientation: str = "portrait",
    safe_margin_mm: float = 0.0,
) -> tuple[object, AppConfig, MockPrinterBackend, Path, dict[str, str], int, str]:
    pin_code = "482910"
    cfg = AppConfig(
        data_dir=tmp_path / "data",
        admin_initial_pin=pin_code,
        photo_stability_delay_sec=0.0,
    )
    mock_printer = MockPrinterBackend(("Mock Photo Printer", "Backup Printer"))
    app = create_app(cfg, printer_backend=mock_printer)

    photo_root = tmp_path / "studio_photos"
    session_dir = photo_root / "sesi-01"
    session_dir.mkdir(parents=True)
    (session_dir / "photo_1.jpg").write_bytes(_make_split_photo_jpeg(1200, 800))
    (session_dir / "photo_2.jpg").write_bytes(_make_split_photo_jpeg(800, 1200, exif_orientation=6))

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        tok = client.post("/api/admin/auth/login", json={"pin": pin_code}).json()["token"]
        admin_headers = {"Authorization": f"Bearer {tok}"}

        client.put(
            "/api/admin/settings",
            json={
                "photo_root_dir": str(photo_root),
                "folder_mode": "active",
                "active_subfolder": "sesi-01",
                "auto_print_enabled": auto_print_enabled,
                "printer_name": "Mock Photo Printer",
            },
            headers=admin_headers,
        )

        cat_res = client.post(
            "/api/frames/categories",
            json={
                "name": "4R-Test",
                "price": 15000,
                "width_mm": 102.0,
                "height_mm": 152.0,
                "orientation": orientation,
                "safe_margin_mm": safe_margin_mm,
                "sort_order": 1,
            },
            headers=admin_headers,
        )
        assert cat_res.status_code == 201
        cat_id = int(cat_res.json()["id"])

        upload_res = client.post(
            "/api/frames",
            data={"category_id": str(cat_id), "name": "Test Frame"},
            files={"file": ("frame.png", _make_transparent_frame_png(), "image/png")},
            headers=admin_headers,
        )
        assert upload_res.status_code == 201
        frame_id = int(upload_res.json()["id"])

        slots_res = client.put(
            f"/api/frames/{frame_id}/slots",
            json={
                "slots": [
                    {
                        "id": "slot-1",
                        "xPct": 10.0,
                        "yPct": 10.0,
                        "wPct": 80.0,
                        "hPct": 80.0,
                        "locked": False,
                    }
                ]
            },
            headers=admin_headers,
        )
        assert slots_res.status_code == 200

        sess_res = client.post(
            "/api/sessions",
            json={
                "name": "Budi",
                "whatsapp": "081234567890",
                "email": "budi@example.com",
                "consent_accepted": True,
            },
        )
        assert sess_res.status_code == 201
        session_token = str(sess_res.json()["token"])

    return app, cfg, mock_printer, session_dir, admin_headers, frame_id, session_token


def test_compositor_300dpi_portrait_landscape_margin_exif_and_crop(tmp_path: Path) -> None:
    portrait = compute_canvas_layout(102.0, 152.0, "portrait", safe_margin_mm=0.0)
    assert (portrait.canvas_width, portrait.canvas_height) == (
        mm_to_pixels(102.0),
        mm_to_pixels(152.0),
    )
    assert portrait.canvas_width < portrait.canvas_height

    landscape = compute_canvas_layout(102.0, 152.0, "landscape", safe_margin_mm=2.0)
    assert landscape.canvas_width > landscape.canvas_height
    assert landscape.margin_px == round(2.0 / 25.4 * PRINT_DPI)
    assert landscape.inner_width == landscape.canvas_width - 2 * landscape.margin_px
    assert landscape.inner_height == landscape.canvas_height - 2 * landscape.margin_px

    with pytest.raises(CompositorError):
        compute_canvas_layout(10.0, 10.0, "portrait", safe_margin_mm=5.0)

    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    (frames_dir / "overlay.png").write_bytes(_make_transparent_frame_png(600, 900))

    photo_root = tmp_path / "photos"
    sub = photo_root / "sesi-x"
    sub.mkdir(parents=True)
    # Landscape 1200x800 split red (left) / blue (right), and EXIF-rotated photo
    (sub / "split.jpg").write_bytes(
        _make_split_photo_jpeg(1200, 800, left_color=(230, 30, 30), right_color=(30, 70, 230))
    )

    outputs_dir = tmp_path / "outputs"
    out_left = render_composite_300dpi(
        session_id=1,
        job_id=101,
        width_mm=102.0,
        height_mm=152.0,
        orientation="portrait",
        safe_margin_mm=2.0,
        frame_image_filename="overlay.png",
        frames_dir=frames_dir,
        slots=[FrameSlotSchema(id="s1", xPct=10, yPct=10, wPct=80, hPct=80)],
        selected_photos=[
            SelectedPhotoSlotSchema(slotId="s1", filename="split.jpg", offsetX=-1.0, offsetY=0.0, zoom=1.5)
        ],
        photo_root_dir=str(photo_root),
        photo_subfolder="sesi-x",
        outputs_dir=outputs_dir,
    )
    out_right = render_composite_300dpi(
        session_id=1,
        job_id=102,
        width_mm=102.0,
        height_mm=152.0,
        orientation="portrait",
        safe_margin_mm=2.0,
        frame_image_filename="overlay.png",
        frames_dir=frames_dir,
        slots=[FrameSlotSchema(id="s1", xPct=10, yPct=10, wPct=80, hPct=80)],
        selected_photos=[
            SelectedPhotoSlotSchema(slotId="s1", filename="split.jpg", offsetX=1.0, offsetY=0.0, zoom=1.5)
        ],
        photo_root_dir=str(photo_root),
        photo_subfolder="sesi-x",
        outputs_dir=outputs_dir,
    )

    with Image.open(out_left) as img_left, Image.open(out_right) as img_right:
        assert img_left.size == (mm_to_pixels(102.0), mm_to_pixels(152.0))
        assert img_left.info.get("dpi") == (300, 300)
        # Safe margin border at (1, 1) must remain white
        assert img_left.getpixel((1, 1))[0] > 240
        # Center pixel on offsetX=-1 should be red-dominant, offsetX=+1 blue-dominant
        center = (img_left.width // 2, img_left.height // 2)
        px_left = img_left.getpixel(center)
        px_right = img_right.getpixel(center)
        assert px_left[0] > px_left[2] + 80
        assert px_right[2] > px_right[0] + 80

    # Path traversal in frame filename or photo filename must raise CompositorError
    with pytest.raises(CompositorError):
        render_composite_300dpi(
            session_id=1,
            job_id=103,
            width_mm=102.0,
            height_mm=152.0,
            orientation="portrait",
            safe_margin_mm=0.0,
            frame_image_filename="../secret.png",
            frames_dir=frames_dir,
            slots=[FrameSlotSchema(id="s1", xPct=10, yPct=10, wPct=80, hPct=80)],
            selected_photos=[SelectedPhotoSlotSchema(slotId="s1", filename="split.jpg")],
            photo_root_dir=str(photo_root),
            photo_subfolder="sesi-x",
            outputs_dir=outputs_dir,
        )


def test_manual_print_queue_workflow_and_download_preview(tmp_path: Path) -> None:
    app, cfg, mock_printer, _sdir, admin_headers, frame_id, token = _setup_app_with_frame_and_session(
        tmp_path, auto_print_enabled=False
    )

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        submit = client.post(
            f"/api/prints/{token}",
            json={
                "frame_id": frame_id,
                "copies": 2,
                "selected_photos": [
                    {"slotId": "slot-1", "filename": "photo_1.jpg", "offsetX": 0.0, "offsetY": 0.0, "zoom": 1.0}
                ],
            },
        )
        assert submit.status_code == 201
        job_id = int(submit.json()["id"])
        assert submit.json()["total_price"] == 30000

        assert app.state.print_worker.wait_idle(5.0)
        assert len(mock_printer.printed_jobs) == 0

        # Job stays queued with rendered 300 DPI output ready
        queue_res = client.get("/api/prints/queue", headers=admin_headers)
        assert queue_res.status_code == 200
        job_data = queue_res.json()[0]
        assert job_data["id"] == job_id
        assert job_data["status"] == "queued"
        assert job_data["has_output"] is True

        # Admin preview & 300 DPI download endpoints work
        preview_res = client.get(f"/api/prints/queue/{job_id}/preview", headers=admin_headers)
        assert preview_res.status_code == 200
        assert preview_res.headers["content-type"] == "image/webp"

        dl_res = client.get(f"/api/prints/queue/{job_id}/download", headers=admin_headers)
        assert dl_res.status_code == 200
        assert dl_res.headers["content-type"] == "image/jpeg"

        # Operator triggers Print Sekarang
        trigger_res = client.post(f"/api/prints/queue/{job_id}/print", headers=admin_headers)
        assert trigger_res.status_code == 200
        assert trigger_res.json()["status"] == "printing"

        assert app.state.print_worker.wait_idle(5.0)
        assert len(mock_printer.printed_jobs) == 1
        assert mock_printer.printed_jobs[0].copies == 2
        assert mock_printer.printed_jobs[0].printer_name == "Mock Photo Printer"
        assert mock_printer.printed_jobs[0].image_dpi == (300, 300)

        # Customer status endpoint reflects 'printed'
        cust_status = client.get(f"/api/prints/{token}/{job_id}")
        assert cust_status.status_code == 200
        assert cust_status.json()["status"] == "printed"

        # Cannot print an already printed job again
        dup_res = client.post(f"/api/prints/queue/{job_id}/print", headers=admin_headers)
        assert dup_res.status_code == 409


def test_auto_print_and_mock_printer_failures_retry_cancel(tmp_path: Path) -> None:
    app, _cfg, mock_printer, _sdir, admin_headers, frame_id, token = _setup_app_with_frame_and_session(
        tmp_path, auto_print_enabled=True
    )

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        # 1. Simulate printer offline
        mock_printer.set_mode("offline", "Printer kabel terputus")
        r1 = client.post(
            f"/api/prints/{token}",
            json={
                "frame_id": frame_id,
                "copies": 1,
                "selected_photos": [{"slotId": "slot-1", "filename": "photo_2.jpg"}],
            },
        )
        assert r1.status_code == 201
        job_id_1 = int(r1.json()["id"])
        assert app.state.print_worker.wait_idle(5.0)

        s1 = client.get(f"/api/prints/{token}/{job_id_1}").json()
        assert s1["status"] == "failed"
        assert "terputus" in s1["error_message"]

        # 2. Simulate paper out on retry -> still failed with paper out message
        mock_printer.set_mode("paper_out")
        retry_1 = client.post(f"/api/prints/queue/{job_id_1}/retry", headers=admin_headers)
        assert retry_1.status_code == 200
        assert app.state.print_worker.wait_idle(5.0)

        s2 = client.get(f"/api/prints/{token}/{job_id_1}").json()
        assert s2["status"] == "failed"
        assert "habis" in s2["error_message"].lower()

        # 3. Restore printer to ready and retry -> printed
        mock_printer.set_mode("ready")
        retry_2 = client.post(f"/api/prints/queue/{job_id_1}/retry", headers=admin_headers)
        assert retry_2.status_code == 200
        assert app.state.print_worker.wait_idle(5.0)

        s3 = client.get(f"/api/prints/{token}/{job_id_1}").json()
        assert s3["status"] == "printed"
        assert len(mock_printer.printed_jobs) == 1

        # 4. Printed job cannot be cancelled (409), failed job can be cancelled
        assert client.post(f"/api/prints/queue/{job_id_1}/cancel", headers=admin_headers).status_code == 409

        mock_printer.set_mode("error")
        r2 = client.post(
            f"/api/prints/{token}",
            json={
                "frame_id": frame_id,
                "copies": 1,
                "selected_photos": [{"slotId": "slot-1", "filename": "photo_1.jpg"}],
            },
        )
        job_id_2 = int(r2.json()["id"])
        assert app.state.print_worker.wait_idle(5.0)

        cancel_res = client.post(f"/api/prints/queue/{job_id_2}/cancel", headers=admin_headers)
        assert cancel_res.status_code == 200
        assert cancel_res.json()["status"] == "cancelled"


def test_print_endpoints_security_tunnel_block_and_session_idor(tmp_path: Path) -> None:
    app, _cfg, _mock, _sdir, admin_headers, frame_id, token = _setup_app_with_frame_and_session(
        tmp_path, auto_print_enabled=False
    )

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        # Unauthenticated requests to admin queue & printers must be rejected (401)
        assert client.get("/api/prints/printers").status_code == 401
        assert client.get("/api/prints/queue").status_code == 401
        assert client.post("/api/prints/queue/1/print").status_code == 401

        # Tunnel proxy header must be blocked (403) even with valid admin token
        tunnel_res = client.get(
            "/api/prints/queue",
            headers={**admin_headers, "CF-Connecting-IP": "203.0.113.50"},
        )
        assert tunnel_res.status_code == 403

        # Create job on session 1
        job_res = client.post(
            f"/api/prints/{token}",
            json={
                "frame_id": frame_id,
                "copies": 1,
                "selected_photos": [{"slotId": "slot-1", "filename": "photo_1.jpg"}],
            },
        )
        assert job_res.status_code == 201
        job_id = int(job_res.json()["id"])
        assert app.state.print_worker.wait_idle(5.0)

        # Create session 2 and verify IDOR protection on GET /api/prints/{token2}/{job_id}
        sess2 = client.post(
            "/api/sessions",
            json={
                "name": "Sari",
                "whatsapp": "081200000001",
                "email": "sari@example.com",
                "consent_accepted": True,
            },
        )
        token2 = str(sess2.json()["token"])
        assert client.get(f"/api/prints/{token2}/{job_id}").status_code == 404
