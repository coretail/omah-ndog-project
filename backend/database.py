from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from backend.security import hash_pin

DEFAULT_SETTINGS: dict[str, str] = {
    "photo_root_dir": "",
    "active_subfolder": "",
    "folder_mode": "active",
    "filter_photos_after_registration": "false",
    "public_base_url": "",
    "auto_print_enabled": "false",
    "printer_name": "",
    "retention_days": "7",
    "session_ttl_hours": "4",
}

DEFAULT_CATEGORIES: tuple[tuple[str, int, float, float, str, float, int], ...] = (
    ("4R", 15000, 102.0, 152.0, "portrait", 0.0, 1),
    ("5R", 20000, 127.0, 178.0, "portrait", 0.0, 2),
    ("Polaroid", 15000, 88.0, 107.0, "portrait", 0.0, 3),
    ("News Paper", 25000, 148.0, 210.0, "portrait", 0.0, 4),
)

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS frame_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    price INTEGER NOT NULL,
    width_mm REAL NOT NULL,
    height_mm REAL NOT NULL,
    orientation TEXT NOT NULL CHECK (orientation IN ('portrait', 'landscape')),
    safe_margin_mm REAL NOT NULL DEFAULT 0.0,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES frame_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    image_path TEXT NOT NULL,
    canvas_width INTEGER NOT NULL,
    canvas_height INTEGER NOT NULL,
    slots_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    email TEXT NOT NULL,
    consent_accepted INTEGER NOT NULL DEFAULT 1,
    photo_subfolder TEXT NOT NULL DEFAULT '',
    filter_after_created_at INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS print_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES customer_sessions(id) ON DELETE CASCADE,
    frame_id INTEGER NOT NULL REFERENCES frames(id) ON DELETE RESTRICT,
    category_name TEXT NOT NULL,
    unit_price INTEGER NOT NULL,
    copies INTEGER NOT NULL,
    total_price INTEGER NOT NULL,
    selected_photos_json TEXT NOT NULL,
    output_image_path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'printing', 'printed', 'failed', 'cancelled')),
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_frames_category ON frames(category_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON customer_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON customer_sessions(status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_session ON print_jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
"""


def get_connection(db_path: Path) -> sqlite3.Connection:
    """Open a SQLite connection with WAL mode, foreign keys, and busy timeout enabled."""
    conn = sqlite3.connect(str(db_path), timeout=5.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn


@contextmanager
def db_session(db_path: Path) -> Iterator[sqlite3.Connection]:
    """Context manager yielding a SQLite connection with commit/rollback handling."""
    conn = get_connection(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def db_immediate_session(db_path: Path) -> Iterator[sqlite3.Connection]:
    """Context manager yielding a SQLite connection inside an atomic BEGIN IMMEDIATE transaction."""
    conn = get_connection(db_path)
    conn.isolation_level = None
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        if conn.in_transaction:
            conn.execute("COMMIT")
    except Exception:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def init_db(db_path: Path, admin_initial_pin: str | None = None) -> None:
    """Initialize SQLite schema, default settings, seed categories, and optional initial PIN."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with db_session(db_path) as conn:
        conn.executescript(_SCHEMA_SQL)

        for key, value in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )

        if admin_initial_pin:
            existing_pin = get_setting(conn, "admin_pin_hash")
            if not existing_pin:
                pin_hash, pin_salt = hash_pin(admin_initial_pin)
                set_setting(conn, "admin_pin_hash", pin_hash)
                set_setting(conn, "admin_pin_salt", pin_salt)

        count_row = conn.execute("SELECT COUNT(*) AS cnt FROM frame_categories").fetchone()
        if count_row is not None and int(count_row["cnt"]) == 0:
            conn.executemany(
                """
                INSERT INTO frame_categories (
                    name, price, width_mm, height_mm, orientation, safe_margin_mm, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                DEFAULT_CATEGORIES,
            )


def get_setting(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    """Fetch a single setting value from the settings table."""
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if row is None:
        return default
    return str(row["value"])


def get_all_settings(conn: sqlite3.Connection) -> dict[str, str]:
    """Fetch all settings as a string dictionary merged over defaults."""
    result = dict(DEFAULT_SETTINGS)
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    for row in rows:
        result[str(row["key"])] = str(row["value"])
    return result


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    """Insert or update a single setting value."""
    conn.execute(
        """
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (key, value),
    )
