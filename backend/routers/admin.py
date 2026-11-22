from __future__ import annotations

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
    SubfolderCreateRequest,
    SubfolderInfoResponse,
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
def get_auth_status(request: Request) -> AdminAuthStatusResponse:
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
def setup_initial_pin(
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
def login_admin(payload: PinLoginRequest, request: Request) -> AdminLoginResponse:
    """Authenticate admin using PIN with atomic per-IP brute-force lockout."""
    config = get_app_config(request)
    client_ip = get_client_ip(request)
    lockout: PinLockoutTracker = request.app.state.pin_lockout

    acquired, locked_seconds = lockout.try_acquire(client_ip)
    if not acquired:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed PIN attempts. Try again in {locked_seconds} seconds.",
            headers={"Retry-After": str(locked_seconds)},
        )

    settled = False
    try:
        with db_session(config.db_path) as conn:
            stored_hash = get_setting(conn, "admin_pin_hash")
            stored_salt = get_setting(conn, "admin_pin_salt")

        if not stored_hash or not stored_salt:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Admin PIN has not been configured yet. Setup from localhost first.",
            )

        if not verify_pin(payload.pin, stored_hash, stored_salt):
            remaining, locked_now = lockout.record_failure(client_ip, from_acquired=True)
            settled = True
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

        lockout.record_success(client_ip, from_acquired=True)
        settled = True
    finally:
        if not settled:
            lockout.release_acquired(client_ip)

    store: AdminSessionStore = request.app.state.admin_sessions
    session_value, expires_at = store.issue(config.admin_token_ttl_hours)
    return AdminLoginResponse(token=session_value, expires_at=expires_at.isoformat())


@router.post("/auth/logout")
def logout_admin(
    request: Request,
    admin_session: str = Depends(require_admin_auth),
) -> dict[str, str]:
    """Revoke current admin session."""
    store: AdminSessionStore = request.app.state.admin_sessions
    store.revoke(admin_session)
    return {"status": "ok"}


@router.post("/auth/change-pin", response_model=AdminLoginResponse)
def change_admin_pin(
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
def get_settings(
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> SettingsResponse:
    """Retrieve studio configuration settings."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        settings = get_all_settings(conn)
    lan_ip = detect_lan_ip()
    return _build_settings_response(settings, lan_ip)


@router.put("/settings", response_model=SettingsResponse)
def update_settings(
    payload: SettingsUpdateRequest,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> SettingsResponse:
    """Validate and update studio configuration settings."""
    config = get_app_config(request)
    validated_root_dir: str | None = None
    if payload.photo_root_dir is not None:
        validated_root_dir = validate_readable_directory(payload.photo_root_dir)

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

    lan_ip = detect_lan_ip()
    return _build_settings_response(settings, lan_ip)


@router.post(
    "/browse-folder",
    response_model=BrowseFolderResponse,
    dependencies=[Depends(require_localhost_only)],
)
def browse_folder(
    _admin_session: str = Depends(require_admin_auth),
) -> BrowseFolderResponse:
    """Open native folder picker dialog on the studio PC (localhost-only)."""
    selected = open_native_folder_dialog()
    return BrowseFolderResponse(path=selected)


_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


@router.get("/subfolders", response_model=list[SubfolderInfoResponse])
def list_subfolders(
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> list[SubfolderInfoResponse]:
    """List session subfolders inside photo_root_dir along with prior session counts."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        root_str = get_setting(conn, "photo_root_dir")
        usage_rows = conn.execute(
            """
            SELECT photo_subfolder, COUNT(*) AS cnt
            FROM customer_sessions
            WHERE photo_subfolder != ''
            GROUP BY photo_subfolder
            """
        ).fetchall()

    if not root_str:
        return []

    root_resolved = Path(root_str).resolve()
    if not root_resolved.is_dir():
        return []

    usage_map = {str(r["photo_subfolder"]): int(r["cnt"]) for r in usage_rows}
    results: list[SubfolderInfoResponse] = []
    try:
        entries = sorted(root_resolved.iterdir(), key=lambda p: p.name.lower())
    except OSError:
        return []

    for entry in entries:
        if not entry.is_dir():
            continue
        resolved_entry = entry.resolve()
        if not resolved_entry.is_relative_to(root_resolved):
            continue
        try:
            photo_count = sum(
                1
                for item in resolved_entry.iterdir()
                if item.is_file() and item.suffix.lower() in _IMAGE_EXTENSIONS
            )
        except OSError:
            photo_count = 0
        results.append(
            SubfolderInfoResponse(
                name=entry.name,
                photo_count=photo_count,
                used_by_sessions=usage_map.get(entry.name, 0),
            )
        )
    return results


@router.post(
    "/subfolders",
    response_model=SubfolderInfoResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_subfolder(
    payload: SubfolderCreateRequest,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> SubfolderInfoResponse:
    """Create a new session subfolder inside configured photo_root_dir."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        root_str = get_setting(conn, "photo_root_dir")
        usage_row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM customer_sessions WHERE photo_subfolder = ?",
            (payload.name,),
        ).fetchone()

    if not root_str:
        raise HTTPException(
            status_code=400,
            detail="Dedicated photo folder (photo_root_dir) is not configured yet.",
        )

    root_resolved = Path(root_str).resolve()
    if not root_resolved.is_dir():
        raise HTTPException(status_code=400, detail="Configured photo_root_dir is not accessible.")

    target = (root_resolved / payload.name).resolve()
    if not target.is_relative_to(root_resolved) or target == root_resolved:
        raise HTTPException(status_code=400, detail="Invalid subfolder name.")

    target.mkdir(parents=True, exist_ok=True)
    photo_count = sum(
        1 for item in target.iterdir() if item.is_file() and item.suffix.lower() in _IMAGE_EXTENSIONS
    )
    used_count = int(usage_row["cnt"]) if usage_row else 0
    return SubfolderInfoResponse(
        name=payload.name,
        photo_count=photo_count,
        used_by_sessions=used_count,
    )
