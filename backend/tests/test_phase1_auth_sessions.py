from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend import main as backend_main
from backend import security as security_module
from backend.config import AppConfig
from backend.database import db_session
from backend.main import create_app
from backend.routers import admin as admin_router
from backend.schemas import validate_selected_photos_json, validate_slots_json
from backend.security import SlidingWindowRateLimiter


def _make_app(
    tmp_path: Path,
    *,
    initial_pin: str | None = None,
    rate_limit_requests: int = 60,
    pin_max_attempts: int = 5,
    pin_lockout_seconds: int = 900,
):
    cfg = AppConfig(
        data_dir=tmp_path / "data",
        admin_initial_pin=initial_pin,
        rate_limit_requests=rate_limit_requests,
        pin_max_attempts=pin_max_attempts,
        pin_lockout_seconds=pin_lockout_seconds,
        testing=False,
    )
    return create_app(cfg), cfg


def test_health_wal_and_seeded_categories(tmp_path: Path) -> None:
    app, cfg = _make_app(tmp_path)
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        resp = client.get("/api/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["database_journal_mode"] == "wal"

    with db_session(cfg.db_path) as conn:
        fk_row = conn.execute("PRAGMA foreign_keys;").fetchone()
        assert fk_row is not None and int(fk_row[0]) == 1

        categories = conn.execute(
            "SELECT name FROM frame_categories ORDER BY sort_order ASC"
        ).fetchall()
        names = [str(r["name"]) for r in categories]
        assert names == ["4R", "5R", "Polaroid", "News Paper"]


def test_pydantic_slot_and_selected_photo_validators() -> None:
    valid_slots = validate_slots_json(
        '[{"id": "slot-1", "xPct": 10, "yPct": 15, "wPct": 40, "hPct": 50, "locked": false}]'
    )
    assert len(valid_slots) == 1
    assert valid_slots[0].id == "slot-1"

    with pytest.raises(ValidationError):
        validate_slots_json([{"id": "s1", "xPct": 70, "yPct": 10, "wPct": 35, "hPct": 20}])

    with pytest.raises(ValidationError):
        validate_slots_json(
            [{"id": "s1", "xPct": 10, "yPct": 10, "wPct": 20, "hPct": 20, "rotation": 45}]
        )

    with pytest.raises(ValueError):
        validate_slots_json(
            [
                {"id": "dup", "xPct": 0, "yPct": 0, "wPct": 20, "hPct": 20},
                {"id": "dup", "xPct": 30, "yPct": 0, "wPct": 20, "hPct": 20},
            ]
        )

    valid_photos = validate_selected_photos_json(
        [{"slotId": "slot-1", "filename": "IMG_0001.JPG", "offsetX": 0.25, "offsetY": -0.5, "zoom": 1.5}]
    )
    assert valid_photos[0].filename == "IMG_0001.JPG"

    for bad_name in ("../secret.jpg", "sub/IMG.jpg", "sub\\IMG.jpg", "C:IMG.jpg", " "):
        with pytest.raises(ValidationError):
            validate_selected_photos_json([{"slotId": "slot-1", "filename": bad_name}])

    with pytest.raises(ValidationError):
        validate_selected_photos_json(
            [{"slotId": "slot-1", "filename": "IMG.jpg", "zoom": 5.0}]
        )


def test_admin_tunnel_and_public_ip_blocking(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)

    with TestClient(app, client=("203.0.113.10", 50000)) as public_client:
        assert public_client.get("/api/admin/auth/status").status_code == 403

    with TestClient(app, client=("127.0.0.1", 50000)) as local_client:
        assert (
            local_client.get(
                "/api/admin/auth/status", headers={"CF-Connecting-IP": "198.51.100.5"}
            ).status_code
            == 403
        )
        assert (
            local_client.get(
                "/api/admin/auth/status", headers={"True-Client-IP": "198.51.100.5"}
            ).status_code
            == 403
        )
        assert (
            local_client.get(
                "/api/admin/auth/status", headers={"X-Forwarded-For": "203.0.113.10"}
            ).status_code
            == 403
        )
        assert local_client.get("/api/admin/auth/status").status_code == 200

    with TestClient(app, client=("192.168.1.50", 50000)) as lan_client:
        resp = lan_client.get("/api/admin/auth/status")
        assert resp.status_code == 200
        assert resp.json()["pin_configured"] is False


def test_admin_pin_setup_lockout_change_and_logout(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path, pin_max_attempts=5, pin_lockout_seconds=900)
    first_code = "482910"
    second_code = "739104"

    with TestClient(app, client=("192.168.1.50", 50000)) as lan_client:
        assert lan_client.get("/api/admin/settings").status_code == 401
        assert (
            lan_client.post("/api/admin/auth/setup", json={"pin": first_code}).status_code == 403
        )

    with TestClient(app, client=("127.0.0.1", 50000)) as local_client:
        setup_resp = local_client.post("/api/admin/auth/setup", json={"pin": first_code})
        assert setup_resp.status_code == 201
        token1 = setup_resp.json()["token"]
        assert len(token1) >= 40

        assert (
            local_client.post("/api/admin/auth/setup", json={"pin": first_code}).status_code
            == 409
        )

        # 4 wrong attempts -> 401, 5th -> 429 lockout
        for _ in range(4):
            bad = local_client.post("/api/admin/auth/login", json={"pin": "000000"})
            assert bad.status_code == 401
        fifth = local_client.post("/api/admin/auth/login", json={"pin": "000000"})
        assert fifth.status_code == 429
        assert "Retry-After" in fifth.headers

        # Even valid code is blocked while IP is locked
        locked_valid = local_client.post("/api/admin/auth/login", json={"pin": first_code})
        assert locked_valid.status_code == 429

    # Fresh LAN IP can authenticate cleanly
    with TestClient(app, client=("192.168.1.60", 50000)) as lan_client:
        login_resp = lan_client.post("/api/admin/auth/login", json={"pin": first_code})
        assert login_resp.status_code == 200
        token2 = login_resp.json()["token"]

        headers2 = {"Authorization": f"Bearer {token2}"}
        assert lan_client.get("/api/admin/settings", headers=headers2).status_code == 200

        change_resp = lan_client.post(
            "/api/admin/auth/change-pin",
            json={"current_pin": first_code, "new_pin": second_code},
            headers=headers2,
        )
        assert change_resp.status_code == 200
        token3 = change_resp.json()["token"]

        # Old tokens are revoked after PIN rotation
        assert lan_client.get("/api/admin/settings", headers=headers2).status_code == 401
        headers3 = {"Authorization": f"Bearer {token3}"}
        assert lan_client.get("/api/admin/settings", headers=headers3).status_code == 200

        # Logout revokes current token
        assert lan_client.post("/api/admin/auth/logout", headers=headers3).status_code == 200
        assert lan_client.get("/api/admin/settings", headers=headers3).status_code == 401


def test_browse_folder_localhost_only_and_settings_validation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    initial_code = "519283"
    app, _ = _make_app(tmp_path, initial_pin=initial_code)
    photo_root = tmp_path / "studio_photos"
    photo_root.mkdir()
    not_a_dir = tmp_path / "sample.txt"
    not_a_dir.write_text("hello", encoding="utf-8")

    monkeypatch.setattr(admin_router, "open_native_folder_dialog", lambda: str(photo_root))

    with TestClient(app, client=("192.168.1.70", 50000)) as lan_client:
        tok = lan_client.post("/api/admin/auth/login", json={"pin": initial_code}).json()["token"]
        lan_headers = {"Authorization": f"Bearer {tok}"}
        assert lan_client.post("/api/admin/browse-folder", headers=lan_headers).status_code == 403

    with TestClient(app, client=("127.0.0.1", 50000)) as local_client:
        tok = local_client.post("/api/admin/auth/login", json={"pin": initial_code}).json()["token"]
        headers = {"Authorization": f"Bearer {tok}"}

        browse = local_client.post("/api/admin/browse-folder", headers=headers)
        assert browse.status_code == 200
        assert browse.json()["path"] == str(photo_root.resolve())

        # Invalid manual paths
        for invalid_path in ("relative/path", str(tmp_path / "missing_dir"), str(not_a_dir), " "):
            bad_resp = local_client.put(
                "/api/admin/settings",
                json={"photo_root_dir": invalid_path},
                headers=headers,
            )
            assert bad_resp.status_code == 400

        # Invalid public URL rejected by Pydantic
        assert (
            local_client.put(
                "/api/admin/settings",
                json={"public_base_url": "ftp://invalid.example.com"},
                headers=headers,
            ).status_code
            == 422
        )

        # Valid settings update
        ok_resp = local_client.put(
            "/api/admin/settings",
            json={
                "photo_root_dir": str(photo_root),
                "folder_mode": "auto_create",
                "public_base_url": "https://studio.example.com/",
                "retention_days": 14,
                "session_ttl_hours": 6,
            },
            headers=headers,
        )
        assert ok_resp.status_code == 200
        data = ok_resp.json()
        assert data["photo_root_dir"] == str(photo_root.resolve())
        assert data["public_base_url"] == "https://studio.example.com"
        assert data["retention_days"] == 14
        assert data["session_ttl_hours"] == 6


def test_sessions_qr_expiry_completion_and_tunnel_url(tmp_path: Path) -> None:
    initial_code = "640281"
    app, cfg = _make_app(tmp_path, initial_pin=initial_code, rate_limit_requests=20)
    photo_root = tmp_path / "photos"
    photo_root.mkdir()

    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        tok = client.post("/api/admin/auth/login", json={"pin": initial_code}).json()["token"]
        headers = {"Authorization": f"Bearer {tok}"}
        client.put(
            "/api/admin/settings",
            json={"photo_root_dir": str(photo_root), "folder_mode": "auto_create"},
            headers=headers,
        )

        # Missing privacy consent rejected
        no_consent = client.post(
            "/api/sessions",
            json={
                "name": "Alya",
                "whatsapp": "081234567890",
                "email": "alya@example.com",
                "consent_accepted": False,
            },
        )
        assert no_consent.status_code == 422

        # Register session (LAN fallback mode)
        created = client.post(
            "/api/sessions",
            json={
                "name": "Budi Santoso",
                "whatsapp": "+62 812-3456-7890",
                "email": "budi@example.com",
                "consent_accepted": True,
            },
        )
        assert created.status_code == 201
        session_data = created.json()
        session_token = session_data["token"]
        assert len(session_token) >= 40
        assert session_data["qr_mode"] == "lan"
        assert session_data["qr_target_url"].endswith(f"/s/{session_token}")
        assert (photo_root / session_data["photo_subfolder"]).is_dir()

        # Retrieve session info & QR PNG
        info_resp = client.get(f"/api/sessions/{session_token}")
        assert info_resp.status_code == 200
        assert info_resp.json()["name"] == "Budi Santoso"

        qr_resp = client.get(f"/api/sessions/{session_token}/qr")
        assert qr_resp.status_code == 200
        assert qr_resp.headers["content-type"] == "image/png"
        assert qr_resp.content.startswith(b"\x89PNG\r\n\x1a\n")

        # Complete session -> subsequent QR/session lookups fail with 410
        comp_resp = client.post(f"/api/sessions/{session_token}/complete")
        assert comp_resp.status_code == 200
        assert comp_resp.json()["status"] == "completed"
        assert client.get(f"/api/sessions/{session_token}").status_code == 410
        assert client.get(f"/api/sessions/{session_token}/qr").status_code == 410

    # Test expiry + tunnel public_base_url using a LAN client
    with TestClient(app, client=("192.168.1.88", 50000)) as lan_client:
        tok = lan_client.post("/api/admin/auth/login", json={"pin": initial_code}).json()["token"]
        lan_client.put(
            "/api/admin/settings",
            json={"public_base_url": "https://omahndog.example.com", "folder_mode": "active"},
            headers={"Authorization": f"Bearer {tok}"},
        )
        reg = lan_client.post(
            "/api/sessions",
            json={
                "name": "Citra",
                "whatsapp": "081299887766",
                "email": "citra@example.com",
                "consent_accepted": True,
            },
        )
        assert reg.status_code == 201
        t2 = reg.json()["token"]
        assert reg.json()["qr_mode"] == "tunnel"
        assert reg.json()["qr_target_url"] == f"https://omahndog.example.com/s/{t2}"

        with db_session(cfg.db_path) as conn:
            past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
            conn.execute(
                "UPDATE customer_sessions SET expires_at = ? WHERE token = ?",
                (past, t2),
            )

        assert lan_client.get(f"/api/sessions/{t2}").status_code == 410


def test_rate_limit_exact_n_plus_one(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path, rate_limit_requests=3)
    with TestClient(app, client=("127.0.0.1", 50000)) as local_client:
        reg = local_client.post(
            "/api/sessions",
            json={
                "name": "Dina",
                "whatsapp": "081234567890",
                "email": "dina@example.com",
                "consent_accepted": True,
            },
        )
        assert reg.status_code == 201
        token = reg.json()["token"]

    with TestClient(app, client=("192.168.1.90", 50000)) as lan_client:
        for _ in range(3):
            assert lan_client.get(f"/api/sessions/{token}").status_code == 200
        blocked = lan_client.get(f"/api/sessions/{token}")
        assert blocked.status_code == 429
        assert "Retry-After" in blocked.headers


def test_rate_limit_ignores_spoofed_headers_from_non_loopback(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path, rate_limit_requests=3)
    with TestClient(app, client=("127.0.0.1", 50000)) as local_client:
        reg = local_client.post(
            "/api/sessions",
            json={
                "name": "Eko",
                "whatsapp": "081234567891",
                "email": "eko@example.com",
                "consent_accepted": True,
            },
        )
        assert reg.status_code == 201
        token = reg.json()["token"]

    # Non-loopback client cannot bypass rate limit by spoofing CF-Connecting-IP / X-Forwarded-For
    with TestClient(app, client=("192.168.1.99", 50000)) as spoof_client:
        spoof_headers = [
            {"CF-Connecting-IP": "203.0.113.1"},
            {"CF-Connecting-IP": "203.0.113.2"},
            {"X-Forwarded-For": "203.0.113.3"},
        ]
        for hdr in spoof_headers:
            assert spoof_client.get(f"/api/sessions/{token}", headers=hdr).status_code == 200
        assert (
            spoof_client.get(
                f"/api/sessions/{token}", headers={"CF-Connecting-IP": "203.0.113.4"}
            ).status_code
            == 429
        )

    # Loopback client (local cloudflared) uses CF-Connecting-IP for per-visitor buckets
    with TestClient(app, client=("127.0.0.1", 50000)) as tunnel_proxy:
        visitor_one = {"CF-Connecting-IP": "198.51.100.10"}
        visitor_two = {"CF-Connecting-IP": "198.51.100.20"}
        for _ in range(3):
            assert tunnel_proxy.get(f"/api/sessions/{token}", headers=visitor_one).status_code == 200
        assert tunnel_proxy.get(f"/api/sessions/{token}", headers=visitor_one).status_code == 429
        assert tunnel_proxy.get(f"/api/sessions/{token}", headers=visitor_two).status_code == 200


def test_rate_limiter_prunes_expired_and_caps_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [100.0]
    monkeypatch.setattr(security_module.time, "monotonic", lambda: clock[0])

    limiter = SlidingWindowRateLimiter(max_requests=2, window_seconds=10, max_keys=3)
    assert limiter.check("ip-1") == (True, 0)
    assert limiter.check("ip-2") == (True, 0)
    assert limiter.check("ip-3") == (True, 0)
    assert limiter.active_key_count == 3

    # Adding a 4th distinct key within window evicts oldest key to stay capped at max_keys=3
    clock[0] = 101.0
    assert limiter.check("ip-4") == (True, 0)
    assert limiter.active_key_count == 3

    # Once window elapses, all prior expired keys are pruned automatically
    clock[0] = 112.0
    assert limiter.check("ip-5") == (True, 0)
    assert limiter.active_key_count == 1


def test_session_registration_blocked_via_tunnel_and_public_ip(tmp_path: Path) -> None:
    app, _ = _make_app(tmp_path)
    payload = {
        "name": "Fajar",
        "whatsapp": "081234567892",
        "email": "fajar@example.com",
        "consent_accepted": True,
    }

    with TestClient(app, client=("203.0.113.10", 50000)) as public_client:
        assert public_client.post("/api/sessions", json=payload).status_code == 403

    with TestClient(app, client=("127.0.0.1", 50000)) as local_client:
        assert (
            local_client.post(
                "/api/sessions", json=payload, headers={"CF-Connecting-IP": "198.51.100.5"}
            ).status_code
            == 403
        )
        assert (
            local_client.post(
                "/api/sessions", json=payload, headers={"True-Client-IP": "198.51.100.5"}
            ).status_code
            == 403
        )
        assert (
            local_client.post(
                "/api/sessions", json=payload, headers={"X-Forwarded-For": "203.0.113.10"}
            ).status_code
            == 403
        )

        created = local_client.post("/api/sessions", json=payload)
        assert created.status_code == 201
        token = created.json()["token"]

        # Customer reading session via tunnel (loopback proxy + CF-Connecting-IP) succeeds
        assert (
            local_client.get(
                f"/api/sessions/{token}", headers={"CF-Connecting-IP": "198.51.100.5"}
            ).status_code
            == 200
        )

        # Completing session via tunnel or public IP is blocked (403) so one phone cannot kill shared QR
        assert (
            local_client.post(
                f"/api/sessions/{token}/complete",
                headers={"CF-Connecting-IP": "198.51.100.5"},
            ).status_code
            == 403
        )
        assert local_client.get(f"/api/sessions/{token}").status_code == 200

        # Direct Kiosk/LAN completes the session cleanly
        assert local_client.post(f"/api/sessions/{token}/complete").status_code == 200
        assert local_client.get(f"/api/sessions/{token}").status_code == 410


def test_main_module_has_no_import_time_app() -> None:
    assert not hasattr(backend_main, "app")
    assert callable(backend_main.create_app)


def test_admin_pin_lockout_blocks_parallel_brute_force(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    correct_code = "482910"
    app, _ = _make_app(tmp_path, initial_pin=correct_code, pin_max_attempts=5)

    real_verify = admin_router.verify_pin
    verify_lock = threading.Lock()
    verify_calls = [0]

    def tracked_verify(pin: str, stored_hash: str, stored_salt: str) -> bool:
        with verify_lock:
            verify_calls[0] += 1
        return real_verify(pin, stored_hash, stored_salt)

    monkeypatch.setattr(admin_router, "verify_pin", tracked_verify)

    total_workers = 40
    barrier = threading.Barrier(total_workers)

    def attempt(idx: int) -> int:
        with TestClient(app, client=("192.168.1.55", 50000)) as client:
            barrier.wait(timeout=10)
            resp = client.post("/api/admin/auth/login", json={"pin": f"{idx:06d}"})
            return resp.status_code

    with ThreadPoolExecutor(max_workers=total_workers) as executor:
        statuses = list(executor.map(attempt, range(total_workers)))

    assert verify_calls[0] == 5
    assert statuses.count(200) == 0
    assert statuses.count(401) == 4
    assert statuses.count(429) == 36
    assert app.state.pin_lockout.check_locked("192.168.1.55") > 0


def test_admin_pin_lockout_rejects_correct_pin_when_five_attempts_in_flight(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    correct_code = "482910"
    app, _ = _make_app(tmp_path, initial_pin=correct_code, pin_max_attempts=5)

    real_verify = admin_router.verify_pin
    state_lock = threading.Lock()
    entered = [0]
    all_five_entered = threading.Event()
    release_verify = threading.Event()

    def gated_verify(pin: str, stored_hash: str, stored_salt: str) -> bool:
        with state_lock:
            entered[0] += 1
            if entered[0] == 5:
                all_five_entered.set()
        assert release_verify.wait(timeout=10)
        return real_verify(pin, stored_hash, stored_salt)

    monkeypatch.setattr(admin_router, "verify_pin", gated_verify)

    def send_wrong() -> int:
        with TestClient(app, client=("192.168.1.56", 50000)) as client:
            return client.post("/api/admin/auth/login", json={"pin": "000000"}).status_code

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(send_wrong) for _ in range(5)]
        assert all_five_entered.wait(timeout=10)

        with TestClient(app, client=("192.168.1.56", 50000)) as attacker:
            sixth = attacker.post("/api/admin/auth/login", json={"pin": correct_code})
            assert sixth.status_code == 429
            assert "Retry-After" in sixth.headers
            assert entered[0] == 5

        release_verify.set()
        results = [f.result() for f in futures]

    assert results.count(200) == 0
    assert results.count(401) == 4
    assert results.count(429) == 1
    assert entered[0] == 5
    assert app.state.pin_lockout.check_locked("192.168.1.56") > 0
