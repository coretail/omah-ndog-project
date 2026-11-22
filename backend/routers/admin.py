from __future__ import annotations

import asyncio
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status

from backend.database import db_session, get_all_settings, get_setting, set_setting
from backend.schemas import (
    AdminAuthStatusResponse,
    AdminLoginResponse,
    BrowseFolderResponse,
    PinChangeRequest,
    PinLoginRequest,
    PinSetupRequest,
    SettingsResponse,
    SettingsUpdateRequest,
)
from backend.security import (
    AdminSessionStore,
    PinLockoutTracker,
    extract_bearer_value,
    get_app_config,
    get_client_ip,
    hash_pin,
    require_admin_auth,
    require_lan_no_tunnel,
    require_localhost_only,
    verify_pin,
)
from backend.services.qr_service import detect_lan_ip

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_lan_no_tunnel)],
)


def validate_readable_directory(path_str: str) -> str:
    """Validate that a manual folder path is absolute, exists, and is readable."""
    cleaned = path_str.strip()
    if not cleaned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Folder path must not be empty.",
        )

    candidate = Path(cleaned)
    if not candidate.is_absolute():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Folder path must be an absolute path.",
        )

    try:
        resolved = candidate.resolve()
        if not resolved.exists() or not resolved.is_dir():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Folder does not exist or is not a directory.",
            )
        if not os.access(resolved, os.R_OK):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Folder is not readable.",
            )
        next(resolved.iterdir(), None)
    except HTTPException:
        raise
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Folder cannot be accessed.",
        ) from exc

    return str(resolved)


def open_native_folder_dialog() -> str | None:
    """Open native OS folder picker dialog on localhost."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    try:
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(title="Select Dedicated Photo Folder")
    finally:
        root.destroy()

    if not selected:
        return None
    return str(Path(selected).resolve())


def _build_settings_response(settings: dict[str, str], lan_ip: str) -> SettingsResponse:
    folder_mode = settings.get("folder_mode", "active")
    if folder_mode not in ("active", "auto_create"):
        folder_mode = "active"
    return SettingsResponse(
        photo_root_dir=settings.get("photo_root_dir", ""),
        active_subfolder=settings.get("active_subfolder", ""),
        folder_mode=folder_mode,  # type: ignore[arg-type]
        public_base_url=settings.get("public_base_url", ""),
        auto_print_enabled=settings.get("auto_print_enabled", "false").lower() == "true",
        printer_name=settings.get("printer_name", ""),
        retention_days=int(settings.get("retention_days", "7") or "7"),
        session_ttl_hours=int(settings.get("session_ttl_hours", "4") or "4"),
        lan_ip=lan_ip,
    )


@router.get("/auth/status", response_model=AdminAuthStatusResponse)
async def get_auth_status(request: Request) -> AdminAuthStatusResponse:
    """Return whether admin PIN is configured, current session validity, and lockout status."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        pin_configured = bool(get_setting(conn, "admin_pin_hash"))

    raw_value = extract_bearer_value(request)
    store: AdminSessionStore = request.app.state.admin_sessions
    authenticated = bool(raw_value and store.validate(raw_value))
    lockout: PinLockoutTracker = request.app.state.pin_lockout
    locked_remaining = lockout.check_locked(get_client_ip(request))

    return AdminAuthStatusResponse(
        pin_configured=pin_configured,
        authenticated=authenticated,
        locked_seconds_remaining=locked_remaining,
    )


@router.post(
    "/auth/setup",
    response_model=AdminLoginResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_localhost_only)],
)
async def setup_initial_pin(
    payload: PinSetupRequest,
    request: Request,
) -> AdminLoginResponse:
    """First-run PIN setup, restricted to direct localhost requests."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        if get_setting(conn, "admin_pin_hash"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Admin PIN is already configured.",
            )
        pin_hash, pin_salt = hash_pin(payload.pin)
        set_setting(conn, "admin_pin_hash", pin_hash)
        set_setting(conn, "admin_pin_salt", pin_salt)

    store: AdminSessionStore = request.app.state.admin_sessions
    session_value, expires_at = store.issue(config.admin_token_ttl_hours)
    return AdminLoginResponse(token=session_value, expires_at=expires_at.isoformat())


@router.post("/auth/login", response_model=AdminLoginResponse)
async def login_admin(payload: PinLoginRequest, request: Request) -> AdminLoginResponse:
    """Authenticate admin using PIN with per-IP brute-force lockout."""
    config = get_app_config(request)
    client_ip = get_client_ip(request)
    lockout: PinLockoutTracker = request.app.state.pin_lockout

    locked_seconds = lockout.check_locked(client_ip)
    if locked_seconds > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed PIN attempts. Try again in {locked_seconds} seconds.",
            headers={"Retry-After": str(locked_seconds)},
        )

    with db_session(config.db_path) as conn:
        stored_hash = get_setting(conn, "admin_pin_hash")
        stored_salt = get_setting(conn, "admin_pin_salt")

    if not stored_hash or not stored_salt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin PIN has not been configured yet. Setup from localhost first.",
        )

    if not verify_pin(payload.pin, stored_hash, stored_salt):
        remaining, locked_now = lockout.record_failure(client_ip)
        if locked_now > 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed PIN attempts. Locked for {locked_now} seconds.",
                headers={"Retry-After": str(locked_now)},
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid PIN. {remaining} attempt(s) remaining.",
        )

    lockout.reset(client_ip)
    store: AdminSessionStore = request.app.state.admin_sessions
    session_value, expires_at = store.issue(config.admin_token_ttl_hours)
    return AdminLoginResponse(token=session_value, expires_at=expires_at.isoformat())


@router.post("/auth/logout")
async def logout_admin(
    request: Request,
    admin_session: str = Depends(require_admin_auth),
) -> dict[str, str]:
    """Revoke current admin session."""
    store: AdminSessionStore = request.app.state.admin_sessions
    store.revoke(admin_session)
    return {"status": "ok"}


@router.post("/auth/change-pin", response_model=AdminLoginResponse)
async def change_admin_pin(
    payload: PinChangeRequest,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> AdminLoginResponse:
    """Update admin PIN after verifying current PIN and rotate all active admin sessions."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        stored_hash = get_setting(conn, "admin_pin_hash")
        stored_salt = get_setting(conn, "admin_pin_salt")
        if not verify_pin(payload.current_pin, stored_hash, stored_salt):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Current PIN is incorrect.",
            )
        new_hash, new_salt = hash_pin(payload.new_pin)
        set_setting(conn, "admin_pin_hash", new_hash)
        set_setting(conn, "admin_pin_salt", new_salt)

    store: AdminSessionStore = request.app.state.admin_sessions
    store.revoke_all()
    session_value, expires_at = store.issue(config.admin_token_ttl_hours)
    return AdminLoginResponse(token=session_value, expires_at=expires_at.isoformat())


@router.get("/settings", response_model=SettingsResponse)
async def get_settings(
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> SettingsResponse:
    """Retrieve studio configuration settings."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        settings = get_all_settings(conn)
    lan_ip = await asyncio.to_thread(detect_lan_ip)
    return _build_settings_response(settings, lan_ip)


@router.put("/settings", response_model=SettingsResponse)
async def update_settings(
    payload: SettingsUpdateRequest,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> SettingsResponse:
    """Validate and update studio configuration settings."""
    config = get_app_config(request)
    validated_root_dir: str | None = None
    if payload.photo_root_dir is not None:
        validated_root_dir = await asyncio.to_thread(
            validate_readable_directory, payload.photo_root_dir
        )

    with db_session(config.db_path) as conn:
        if validated_root_dir is not None:
            set_setting(conn, "photo_root_dir", validated_root_dir)
        if payload.active_subfolder is not None:
            set_setting(conn, "active_subfolder", payload.active_subfolder)
        if payload.folder_mode is not None:
            set_setting(conn, "folder_mode", payload.folder_mode)
        if payload.public_base_url is not None:
            set_setting(conn, "public_base_url", payload.public_base_url)
        if payload.auto_print_enabled is not None:
            set_setting(
                conn,
                "auto_print_enabled",
                "true" if payload.auto_print_enabled else "false",
            )
        if payload.printer_name is not None:
            set_setting(conn, "printer_name", payload.printer_name.strip())
        if payload.retention_days is not None:
            set_setting(conn, "retention_days", str(payload.retention_days))
        if payload.session_ttl_hours is not None:
            set_setting(conn, "session_ttl_hours", str(payload.session_ttl_hours))
        settings = get_all_settings(conn)

    lan_ip = await asyncio.to_thread(detect_lan_ip)
    return _build_settings_response(settings, lan_ip)


@router.post(
    "/browse-folder",
    response_model=BrowseFolderResponse,
    dependencies=[Depends(require_localhost_only)],
)
async def browse_folder(
    _admin_session: str = Depends(require_admin_auth),
) -> BrowseFolderResponse:
    """Open native folder picker dialog on the studio PC (localhost-only)."""
    selected = await asyncio.to_thread(open_native_folder_dialog)
    return BrowseFolderResponse(path=selected)
