from __future__ import annotations

import asyncio
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from backend.database import db_session, get_all_settings, get_setting
from backend.schemas import (
    SessionCompleteResponse,
    SessionCreateRequest,
    SessionPublicInfoResponse,
    SessionResponse,
)
from backend.security import get_app_config, rate_limit_public
from backend.services.qr_service import build_qr_target_url, generate_qr_png_bytes

router = APIRouter(
    prefix="/api/sessions",
    tags=["sessions"],
    dependencies=[Depends(rate_limit_public)],
)

_SAFE_SLUG_RE = re.compile(r"[^a-zA-Z0-9_-]+")


def _parse_iso_utc(raw: str) -> datetime:
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _resolve_subfolder_for_session(
    photo_root_dir: str,
    active_subfolder: str,
    folder_mode: str,
    customer_name: str,
    now_utc: datetime,
) -> str:
    """Resolve and validate session subfolder inside photo_root_dir using Path.resolve()."""
    if not photo_root_dir:
        return active_subfolder

    root_resolved = Path(photo_root_dir).resolve()
    if not root_resolved.exists() or not root_resolved.is_dir():
        return active_subfolder

    if folder_mode == "auto_create":
        slug = _SAFE_SLUG_RE.sub("-", customer_name.strip().lower()).strip("-_") or "customer"
        folder_name = f"{now_utc.strftime('%Y%m%d_%H%M%S')}_{slug[:24]}"
        target_dir = (root_resolved / folder_name).resolve()
        if not target_dir.is_relative_to(root_resolved) or target_dir == root_resolved:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid session subfolder path.",
            )
        target_dir.mkdir(parents=True, exist_ok=True)
        return folder_name

    if not active_subfolder:
        return ""

    candidate = (root_resolved / active_subfolder).resolve()
    if not candidate.is_relative_to(root_resolved) or candidate == root_resolved:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid active subfolder configuration.",
        )
    return active_subfolder


def _load_active_session(conn: sqlite3.Connection, token: str) -> sqlite3.Row:
    """Load session by token and ensure it is neither completed nor expired."""
    row = conn.execute(
        "SELECT * FROM customer_sessions WHERE token = ?",
        (token,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found.",
        )
    if str(row["status"]) == "completed":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Session is already completed.",
        )
    expires_at = _parse_iso_utc(str(row["expires_at"]))
    if datetime.now(timezone.utc) >= expires_at:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Session has expired.",
        )
    return row


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    payload: SessionCreateRequest,
    request: Request,
) -> SessionResponse:
    """Register a new customer session and generate a high-entropy QR token."""
    config = get_app_config(request)
    now_utc = datetime.now(timezone.utc)

    with db_session(config.db_path) as conn:
        settings = get_all_settings(conn)
        ttl_hours = int(settings.get("session_ttl_hours", "4") or "4")
        expires_at = now_utc + timedelta(hours=ttl_hours)
        public_base_url = settings.get("public_base_url", "")
        photo_root_dir = settings.get("photo_root_dir", "")
        active_subfolder = settings.get("active_subfolder", "")
        folder_mode = settings.get("folder_mode", "active")

        photo_subfolder = await asyncio.to_thread(
            _resolve_subfolder_for_session,
            photo_root_dir,
            active_subfolder,
            folder_mode,
            payload.name,
            now_utc,
        )

        session_token = secrets.token_urlsafe(32)
        created_iso = now_utc.isoformat()
        expires_iso = expires_at.isoformat()

        cursor = conn.execute(
            """
            INSERT INTO customer_sessions (
                token, name, whatsapp, email, consent_accepted,
                photo_subfolder, filter_after_created_at, status, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
            """,
            (
                session_token,
                payload.name,
                payload.whatsapp,
                payload.email,
                1 if payload.consent_accepted else 0,
                photo_subfolder,
                1 if payload.filter_after_created_at else 0,
                expires_iso,
                created_iso,
            ),
        )
        session_id = int(cursor.lastrowid or 0)

    qr_target_url, qr_mode = await asyncio.to_thread(
        build_qr_target_url, session_token, public_base_url, config.port
    )

    return SessionResponse(
        id=session_id,
        token=session_token,
        name=payload.name,
        whatsapp=payload.whatsapp,
        email=payload.email,
        photo_subfolder=photo_subfolder,
        status="active",
        qr_target_url=qr_target_url,
        qr_mode=qr_mode,
        expires_at=expires_iso,
        created_at=created_iso,
    )


@router.get("/{token}", response_model=SessionPublicInfoResponse)
async def get_session(token: str, request: Request) -> SessionPublicInfoResponse:
    """Validate and retrieve public metadata for an active customer session."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        row = _load_active_session(conn, token)
        return SessionPublicInfoResponse(
            id=int(row["id"]),
            name=str(row["name"]),
            photo_subfolder=str(row["photo_subfolder"]),
            status="active",
            expires_at=str(row["expires_at"]),
            created_at=str(row["created_at"]),
        )


@router.get("/{token}/qr")
async def get_session_qr(token: str, request: Request) -> Response:
    """Render PNG QR code pointing to the active session URL."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        _load_active_session(conn, token)
        public_base_url = get_setting(conn, "public_base_url")

    target_url, _ = await asyncio.to_thread(
        build_qr_target_url, token, public_base_url, config.port
    )
    png_bytes = await asyncio.to_thread(generate_qr_png_bytes, target_url)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/{token}/complete", response_model=SessionCompleteResponse)
async def complete_session(token: str, request: Request) -> SessionCompleteResponse:
    """Mark an active session as completed, invalidating further QR access."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        row = _load_active_session(conn, token)
        session_id = int(row["id"])
        conn.execute(
            "UPDATE customer_sessions SET status = 'completed' WHERE id = ?",
            (session_id,),
        )
    return SessionCompleteResponse(id=session_id, status="completed")
