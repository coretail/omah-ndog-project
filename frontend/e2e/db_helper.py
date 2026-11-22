from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _e2e_base_dir() -> Path:
    return Path(tempfile.gettempdir()) / "omah-ndog-e2e"


def _db_path() -> Path:
    env_dir = os.getenv("STUDIO_DATA_DIR")
    if env_dir:
        return Path(env_dir) / "studio.db"
    return _e2e_base_dir() / "data" / "studio.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path()), timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn


def _clear_dir_contents(target_dir: Path) -> None:
    if not target_dir.is_dir():
        return
    for entry in target_dir.iterdir():
        if entry.is_dir():
            shutil.rmtree(entry, ignore_errors=True)
        else:
            entry.unlink(missing_ok=True)


def cmd_reset_customer_data() -> None:
    data_dir = _db_path().parent
    conn = _connect()
    try:
        conn.execute("DELETE FROM print_jobs")
        conn.execute("DELETE FROM customer_sessions")
        defaults = {
            "retention_days": "7",
            "session_ttl_hours": "4",
            "public_base_url": "",
            "auto_print_enabled": "false",
            "printer_name": "",
            "folder_mode": "active",
            "active_subfolder": "sesi-e2e",
            "filter_photos_after_registration": "false",
        }
        for key, value in defaults.items():
            conn.execute(
                """
                INSERT INTO settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )
        conn.commit()
    finally:
        conn.close()

    _clear_dir_contents(data_dir / "outputs")
    _clear_dir_contents(data_dir / "thumbnails")


def cmd_set_setting(key: str, value: str) -> None:
    conn = _connect()
    try:
        conn.execute(
            """
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )
        conn.commit()
    finally:
        conn.close()


def cmd_set_job_status(job_id: int, status_val: str) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = _connect()
    try:
        cur = conn.execute(
            "UPDATE print_jobs SET status = ?, updated_at = ? WHERE id = ?",
            (status_val, now_iso, job_id),
        )
        if cur.rowcount == 0:
            raise SystemExit(f"print_jobs row id={job_id} not found")
        conn.commit()
    finally:
        conn.close()


def cmd_seed_bulk_customers(count: int, payloads_json: str | None) -> None:
    payloads: list[str] = json.loads(payloads_json) if payloads_json else []
    now = datetime.now(timezone.utc)
    expires_iso = (now + timedelta(hours=4)).isoformat()

    rows: list[tuple[str, str, str, str, str, str, str]] = []
    normal_count = max(0, count - len(payloads))
    for i in range(normal_count):
        created_iso = (now - timedelta(seconds=(count - i))).isoformat()
        rows.append(
            (
                f"bulk-tok-{i:04d}-{int(now.timestamp())}",
                f"Customer Bulk {i + 1:03d}",
                f"0812000{i:05d}",
                f"bulk{i + 1}@example.com",
                "sesi-e2e",
                expires_iso,
                created_iso,
            )
        )

    for idx, name in enumerate(payloads):
        created_iso = (now - timedelta(seconds=(len(payloads) - idx))).isoformat()
        rows.append(
            (
                f"payload-tok-{idx:02d}-{int(now.timestamp())}",
                name,
                f"0812999{idx:05d}",
                f"payload{idx}@example.com",
                "sesi-e2e",
                expires_iso,
                created_iso,
            )
        )

    conn = _connect()
    try:
        conn.executemany(
            """
            INSERT INTO customer_sessions (
                token, name, whatsapp, email, consent_accepted,
                photo_subfolder, filter_after_created_at, status, expires_at, created_at
            ) VALUES (?, ?, ?, ?, 1, ?, 0, 'active', ?, ?)
            """,
            rows,
        )
        conn.commit()
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="SQLite helper for Playwright E2E tests.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("reset-customer-data")

    p_set = sub.add_parser("set-setting")
    p_set.add_argument("key")
    p_set.add_argument("value")

    p_job = sub.add_parser("set-job-status")
    p_job.add_argument("job_id", type=int)
    p_job.add_argument("status")

    p_seed = sub.add_parser("seed-bulk-customers")
    p_seed.add_argument("count", type=int)
    p_seed.add_argument("--payloads-json", default=None)

    args = parser.parse_args()
    if args.command == "reset-customer-data":
        cmd_reset_customer_data()
    elif args.command == "set-setting":
        cmd_set_setting(args.key, args.value)
    elif args.command == "set-job-status":
        cmd_set_job_status(args.job_id, args.status)
    elif args.command == "seed-bulk-customers":
        cmd_seed_bulk_customers(args.count, args.payloads_json)


if __name__ == "__main__":
    main()
