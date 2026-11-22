from __future__ import annotations

import ast
import io
import os
import time
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from backend.config import AppConfig
from backend.database import db_session
from backend.main import create_app
from backend.services.cleanup_service import run_retention_cleanup
from backend.services.printer import MockPrinterBackend


def _make_sample_jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), (120, 180, 220)).save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _make_sample_png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (400, 600), (255, 173, 209, 255)).save(buf, format="PNG")
    return buf.getvalue()


def test_retention_cleanup_deletes_expired_and_preserves_recent_and_camera_photos(
    tmp_path: Path,
) -> None:
    thumbs_dir = tmp_path / "data" / "thumbnails"
    outputs_dir = tmp_path / "data" / "outputs"
    camera_dir = tmp_path / "camera_photos" / "sesi-01"
    thumbs_dir.mkdir(parents=True)
    (outputs_dir / "1").mkdir(parents=True)
    (outputs_dir / "2").mkdir(parents=True)
    camera_dir.mkdir(parents=True)

    now = time.time()
    old_ts = now - 10 * 86_400
    fresh_ts = now - 1 * 86_400

    old_thumb = thumbs_dir / "old.webp"
    fresh_thumb = thumbs_dir / "fresh.webp"
    old_output = outputs_dir / "1" / "10.jpg"
    fresh_output = outputs_dir / "2" / "11.jpg"
    old_camera = camera_dir / "IMG_0001.jpg"

    for p, ts in (
        (old_thumb, old_ts),
        (fresh_thumb, fresh_ts),
        (old_output, old_ts),
        (fresh_output, fresh_ts),
        (old_camera, old_ts),
    ):
        p.write_bytes(b"1234567890")
        os.utime(p, (ts, ts))

    res = run_retention_cleanup(thumbs_dir, outputs_dir, retention_days=7, now_ts=now)
    assert res.deleted_thumbnails == 1
    assert res.deleted_outputs == 1
    assert res.freed_bytes == 20
    assert not old_thumb.exists()
    assert fresh_thumb.exists()
    assert not old_output.exists()
    assert not (outputs_dir / "1").exists()
    assert fresh_output.exists()
    # Original camera photo must NEVER be deleted
    assert old_camera.exists()


def test_customer_history_csv_export_manual_cleanup_and_delete_customer(tmp_path: Path) -> None:
    pin_code = "482910"
    cfg = AppConfig(
        data_dir=tmp_path / "data",
        admin_initial_pin=pin_code,
        photo_stability_delay_sec=0.0,
    )
    mock_printer = MockPrinterBackend(("Mock Photo Printer",))
    app = create_app(cfg, printer_backend=mock_printer)

    photo_root = tmp_path / "camera_root"
    session_dir = photo_root / "sesi-01"
    session_dir.mkdir(parents=True)
    camera_photo = session_dir / "IMG_001.jpg"
    camera_photo.write_bytes(_make_sample_jpeg())

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        tok = client.post("/api/admin/auth/login", json={"pin": pin_code}).json()["token"]
        headers = {"Authorization": f"Bearer {tok}"}

        client.put(
            "/api/admin/settings",
            json={
                "photo_root_dir": str(photo_root),
                "folder_mode": "active",
                "active_subfolder": "sesi-01",
                "retention_days": 3,
                "auto_print_enabled": False,
            },
            headers=headers,
        )

        cats = client.get("/api/frames/categories").json()
        cat_id = int(cats[0]["id"])
        frame_res = client.post(
            "/api/frames",
            data={"category_id": str(cat_id), "name": "F1"},
            files={"file": ("f1.png", _make_sample_png(), "image/png")},
            headers=headers,
        )
        frame_id = int(frame_res.json()["id"])
        client.put(
            f"/api/frames/{frame_id}/slots",
            json={"slots": [{"id": "s1", "xPct": 10, "yPct": 10, "wPct": 80, "hPct": 80}]},
            headers=headers,
        )

        # Register customer with potential CSV formula payload in name
        s_res = client.post(
            "/api/sessions",
            json={
                "name": "=CMD('calc')",
                "whatsapp": "081234567890",
                "email": "cust@example.com",
                "consent_accepted": True,
            },
        )
        assert s_res.status_code == 201
        sess_id = int(s_res.json()["id"])
        sess_token = str(s_res.json()["token"])

        p_res = client.post(
            f"/api/prints/{sess_token}",
            json={
                "frame_id": frame_id,
                "copies": 2,
                "selected_photos": [{"slotId": "s1", "filename": "IMG_001.jpg"}],
            },
        )
        assert p_res.status_code == 201
        assert app.state.print_worker.wait_idle(5.0)

        out_dir = cfg.outputs_dir / str(sess_id)
        assert out_dir.is_dir() and any(out_dir.iterdir())

        # Customer history endpoint
        hist = client.get("/api/admin/customers", headers=headers)
        assert hist.status_code == 200
        rows = hist.json()
        assert len(rows) == 1
        assert rows[0]["job_count"] == 1
        assert rows[0]["total_spent"] == int(cats[0]["price"]) * 2

        # CSV export neutralizes leading '=' formula
        csv_res = client.get("/api/admin/customers/export.csv", headers=headers)
        assert csv_res.status_code == 200
        assert "text/csv" in csv_res.headers["content-type"]
        assert "'=CMD('calc')" in csv_res.text

        # Manual cleanup endpoint respects retention_days=3 (fresh output kept)
        cleanup_res = client.post("/api/admin/cleanup/run", headers=headers)
        assert cleanup_res.status_code == 200
        assert cleanup_res.json()["retention_days"] == 3
        assert cleanup_res.json()["deleted_outputs"] == 0

        # Cannot delete customer if a print job is actively printing
        with db_session(cfg.db_path) as conn:
            conn.execute("UPDATE print_jobs SET status = 'printing' WHERE session_id = ?", (sess_id,))
        conflict_del = client.delete(f"/api/admin/customers/{sess_id}", headers=headers)
        assert conflict_del.status_code == 409

        with db_session(cfg.db_path) as conn:
            conn.execute("UPDATE print_jobs SET status = 'queued' WHERE session_id = ?", (sess_id,))

        # Delete customer removes DB row + rendered outputs, but keeps original camera photo
        del_res = client.delete(f"/api/admin/customers/{sess_id}", headers=headers)
        assert del_res.status_code == 200
        assert del_res.json()["deleted_outputs"] >= 1
        assert not out_dir.exists()
        assert camera_photo.is_file()
        assert client.get("/api/admin/customers", headers=headers).json() == []


def test_security_audit_and_architecture_invariants(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[2]

    # 1. win32* imports must only appear in backend/services/printer.py
    for py_file in (repo_root / "backend").rglob("*.py"):
        if "tests" in py_file.parts:
            continue
        tree = ast.parse(py_file.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith("win32"):
                        assert py_file.name == "printer.py", f"win32 import in {py_file}"
            elif isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("win32"):
                assert py_file.name == "printer.py", f"win32 import in {py_file}"

    # 2. No async def router handlers in backend/routers/ (all handlers run in threadpool)
    for router_file in (repo_root / "backend" / "routers").glob("*.py"):
        tree = ast.parse(router_file.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            assert not isinstance(node, ast.AsyncFunctionDef), (
                f"Unexpected async def handler in {router_file.name}: {node.name}"
            )

    # 3. .gitignore excludes data/ and .env*
    gitignore = (repo_root / ".gitignore").read_text(encoding="utf-8")
    assert "data/" in gitignore
    assert ".env" in gitignore

    # 4. Tunnel headers blocked on admin cleanup/customers and print queue
    cfg = AppConfig(data_dir=tmp_path / "data", admin_initial_pin="482910")
    app = create_app(cfg, printer_backend=MockPrinterBackend())
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        tok = client.post("/api/admin/auth/login", json={"pin": "482910"}).json()["token"]
        for path in ("/api/admin/customers", "/api/admin/customers/export.csv", "/api/prints/queue"):
            res = client.get(
                path,
                headers={"Authorization": f"Bearer {tok}", "CF-Connecting-IP": "198.51.100.2"},
            )
            assert res.status_code == 403
