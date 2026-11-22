from __future__ import annotations

import ast
import csv
import io
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.config import AppConfig
from backend.database import db_session, set_setting
from backend.main import create_app
from backend.services import cleanup_service as cleanup_module
from backend.services.cleanup_service import (
    CleanupScheduler,
    delete_session_outputs,
    run_retention_cleanup,
)
from backend.services.printer import MockPrinterBackend


def _make_sample_jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), (120, 180, 220)).save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _make_sample_png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (400, 600), (255, 173, 209, 255)).save(buf, format="PNG")
    return buf.getvalue()


def test_retention_cleanup_deletes_expired_and_preserves_fresh_dirs_and_camera_photos(
    tmp_path: Path,
) -> None:
    thumbs_dir = tmp_path / "data" / "thumbnails"
    outputs_dir = tmp_path / "data" / "outputs"
    camera_dir = tmp_path / "camera_photos" / "sesi-01"
    expired_empty_dir = outputs_dir / "1"
    fresh_empty_dir = outputs_dir / "3"
    thumbs_dir.mkdir(parents=True)
    expired_empty_dir.mkdir(parents=True)
    (outputs_dir / "2").mkdir(parents=True)
    fresh_empty_dir.mkdir(parents=True)
    camera_dir.mkdir(parents=True)

    now = time.time()
    old_ts = now - 10 * 86_400
    fresh_ts = now - 1 * 86_400

    old_thumb = thumbs_dir / "old.webp"
    fresh_thumb = thumbs_dir / "fresh.webp"
    old_output = expired_empty_dir / "10.jpg"
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

    # Set directory mtime explicitly: expired_empty_dir is old, fresh_empty_dir is fresh
    os.utime(expired_empty_dir, (old_ts, old_ts))
    os.utime(fresh_empty_dir, (now, now))

    res = run_retention_cleanup(thumbs_dir, outputs_dir, retention_days=7, now_ts=now)
    assert res.deleted_thumbnails == 1
    assert res.deleted_outputs == 1
    assert res.freed_bytes == 20
    assert not old_thumb.exists()
    assert fresh_thumb.exists()
    assert not old_output.exists()
    assert not expired_empty_dir.exists()
    assert fresh_output.exists()
    # Fresh empty directory must NOT be pruned (protects in-progress worker output dir)
    assert fresh_empty_dir.is_dir()
    # Original camera photo must NEVER be deleted
    assert old_camera.exists()


def test_customer_history_printed_only_total_csv_export_cleanup_and_delete(tmp_path: Path) -> None:
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
        unit_price = int(cats[0]["price"])
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

        # Job 1: queued -> will be printed
        p1 = client.post(
            f"/api/prints/{sess_token}",
            json={
                "frame_id": frame_id,
                "copies": 2,
                "selected_photos": [{"slotId": "s1", "filename": "IMG_001.jpg"}],
            },
        )
        assert p1.status_code == 201
        job1_id = int(p1.json()["id"])

        # Job 2: queued -> will be marked failed (must NOT count toward total_spent)
        p2 = client.post(
            f"/api/prints/{sess_token}",
            json={
                "frame_id": frame_id,
                "copies": 3,
                "selected_photos": [{"slotId": "s1", "filename": "IMG_001.jpg"}],
            },
        )
        assert p2.status_code == 201
        job2_id = int(p2.json()["id"])

        assert app.state.print_worker.wait_idle(5.0)

        # Before printing, both queued jobs give total_spent == 0
        hist_before = client.get("/api/admin/customers", headers=headers).json()
        assert hist_before["total"] == 1
        assert hist_before["items"][0]["job_count"] == 2
        assert hist_before["items"][0]["total_spent"] == 0

        # Print job 1 and mark job 2 as failed
        assert client.post(f"/api/prints/queue/{job1_id}/print", headers=headers).status_code == 200
        assert app.state.print_worker.wait_idle(5.0)
        with db_session(cfg.db_path) as conn:
            conn.execute("UPDATE print_jobs SET status = 'failed' WHERE id = ?", (job2_id,))

        # Only printed job1 (2 copies) is counted in total_spent
        hist_after = client.get("/api/admin/customers", headers=headers).json()
        assert hist_after["items"][0]["job_count"] == 2
        assert hist_after["items"][0]["total_spent"] == unit_price * 2

        # CSV export header and formula neutralization
        csv_res = client.get("/api/admin/customers/export.csv", headers=headers)
        assert csv_res.status_code == 200
        assert "text/csv" in csv_res.headers["content-type"]
        assert "Total Tercetak (Rp)" in csv_res.text
        assert "'=CMD('calc')" in csv_res.text

        # Corrupt retention_days setting must not cause 500
        with db_session(cfg.db_path) as conn:
            set_setting(conn, "retention_days", "corrupt")
        cleanup_res = client.post("/api/admin/cleanup/run", headers=headers)
        assert cleanup_res.status_code == 200
        assert cleanup_res.json()["retention_days"] == 7

        # 404 when deleting unknown customer
        assert client.delete("/api/admin/customers/999999", headers=headers).status_code == 404

        # 409 when a print job is actively printing
        with db_session(cfg.db_path) as conn:
            conn.execute("UPDATE print_jobs SET status = 'printing' WHERE id = ?", (job1_id,))
        assert client.delete(f"/api/admin/customers/{sess_id}", headers=headers).status_code == 409

        with db_session(cfg.db_path) as conn:
            conn.execute("UPDATE print_jobs SET status = 'queued' WHERE id = ?", (job1_id,))

        out_dir = cfg.outputs_dir / str(sess_id)
        assert out_dir.is_dir() and any(out_dir.iterdir())

        del_res = client.delete(f"/api/admin/customers/{sess_id}", headers=headers)
        assert del_res.status_code == 200
        assert del_res.json()["status"] == "deleted"
        assert del_res.json()["deleted_outputs"] >= 1
        assert not out_dir.exists()
        assert camera_photo.is_file()
        assert client.get("/api/admin/customers", headers=headers).json()["total"] == 0


def test_csv_export_over_500_rows_pagination_and_formula_sanitization(tmp_path: Path) -> None:
    cfg = AppConfig(data_dir=tmp_path / "data", admin_initial_pin="482910")
    app = create_app(cfg, printer_backend=MockPrinterBackend())
    now_iso = datetime.now(timezone.utc).isoformat()

    total_rows = 520
    payload_names = [
        "=SUM(A1)",
        "+628111",
        "-1+1",
        "@IMPORT",
        "\tcmd",
        "\rcmd",
        "   =1+1",
        "  +628123",
    ]
    with db_session(cfg.db_path) as conn:
        for i in range(total_rows):
            cust_name = payload_names[i] if i < len(payload_names) else f"Customer {i:03d}"
            conn.execute(
                """
                INSERT INTO customer_sessions (
                    token, name, whatsapp, email, consent_accepted,
                    photo_subfolder, filter_after_created_at, status, expires_at, created_at
                ) VALUES (?, ?, ?, ?, 1, 'sesi', 0, 'active', ?, ?)
                """,
                (f"tok-{i}", cust_name, "08123456789", f"c{i}@example.com", now_iso, now_iso),
            )

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        # 401 without auth on all Phase 6 endpoints
        assert client.post("/api/admin/cleanup/run").status_code == 401
        assert client.get("/api/admin/customers").status_code == 401
        assert client.get("/api/admin/customers/export.csv").status_code == 401
        assert client.delete("/api/admin/customers/1").status_code == 401

        tok = client.post("/api/admin/auth/login", json={"pin": "482910"}).json()["token"]
        headers = {"Authorization": f"Bearer {tok}"}

        # UI pagination returns total=520 and sliced items
        page1 = client.get("/api/admin/customers?limit=100&offset=0", headers=headers).json()
        assert page1["total"] == total_rows
        assert len(page1["items"]) == 100

        page6 = client.get("/api/admin/customers?limit=100&offset=500", headers=headers).json()
        assert page6["total"] == total_rows
        assert len(page6["items"]) == 20

        # Full CSV export must contain all 520 rows without truncation
        csv_res = client.get("/api/admin/customers/export.csv", headers=headers)
        assert csv_res.status_code == 200
        text = csv_res.text.lstrip("\ufeff")
        parsed = list(csv.reader(io.StringIO(text)))
        assert len(parsed) == total_rows + 1  # header + 520 rows

        exported_names = {row[1] for row in parsed[1:]}
        for raw in payload_names:
            assert f"'{raw}" in exported_names


def test_cleanup_scheduler_lifecycle_and_partial_delete_count(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cfg = AppConfig(data_dir=tmp_path / "data", admin_initial_pin="482910")
    cfg.ensure_dirs()
    scheduler = CleanupScheduler(cfg, interval_seconds=60)

    # Idempotent start and stop
    scheduler.start()
    first_thread = scheduler._thread
    assert first_thread is not None and first_thread.is_alive()
    scheduler.start()
    assert scheduler._thread is first_thread
    scheduler.stop(timeout=2.0)
    assert scheduler._thread is None
    scheduler.stop(timeout=2.0)

    # Partial rmtree failure should report real deleted count
    sess_dir = cfg.outputs_dir / "42"
    sess_dir.mkdir(parents=True)
    f1 = sess_dir / "1.jpg"
    f2 = sess_dir / "2.jpg"
    f1.write_bytes(b"a")
    f2.write_bytes(b"b")

    def _partial_rmtree(path: Path, onerror: object = None) -> None:
        f1.unlink()
        if callable(onerror):
            onerror(os.unlink, str(f2), (PermissionError, PermissionError("locked"), None))

    monkeypatch.setattr(cleanup_module.shutil, "rmtree", _partial_rmtree)
    deleted = delete_session_outputs(cfg.outputs_dir, 42)
    assert deleted == 1
    assert f2.exists()


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
