from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from backend.database import db_session, get_setting
from backend.routers.sessions import load_active_session, parse_iso_utc
from backend.schemas import PhotoItemResponse, SessionPhotoListResponse
from backend.security import get_app_config, rate_limit_public
from backend.services.photo_scanner import PhotoPathError, PhotoScannerService

router = APIRouter(
    prefix="/api/photos",
    tags=["photos"],
    dependencies=[Depends(rate_limit_public)],
)


def _load_session_photo_context(request: Request, token: str) -> tuple[str, str, float | None]:
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        row = load_active_session(conn, token)
        photo_root_dir = get_setting(conn, "photo_root_dir")
        photo_subfolder = str(row["photo_subfolder"])
        filter_after = int(row["filter_after_created_at"]) == 1
        min_mtime = parse_iso_utc(str(row["created_at"])).timestamp() if filter_after else None
    return photo_root_dir, photo_subfolder, min_mtime


@router.get("/{token}", response_model=SessionPhotoListResponse)
def list_session_photos(token: str, request: Request) -> SessionPhotoListResponse:
    """List verified photos inside the customer session's assigned subfolder."""
    photo_root_dir, photo_subfolder, min_mtime = _load_session_photo_context(request, token)
    scanner: PhotoScannerService = request.app.state.photo_scanner

    try:
        items = scanner.list_photos(
            photo_root_dir,
            photo_subfolder,
            min_mtime=min_mtime,
        )
    except PhotoPathError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    encoded_token = quote(token, safe="")
    photos = [
        PhotoItemResponse(
            filename=item.filename,
            width=item.width,
            height=item.height,
            size_bytes=item.size_bytes,
            modified_at=item.modified_at,
            thumb_url=f"/api/photos/{encoded_token}/{quote(item.filename, safe='')}/thumb",
            preview_url=f"/api/photos/{encoded_token}/{quote(item.filename, safe='')}/preview",
        )
        for item in items
    ]
    return SessionPhotoListResponse(subfolder=photo_subfolder, photos=photos)


@router.get("/{token}/{filename}/thumb")
def get_photo_thumbnail(token: str, filename: str, request: Request) -> FileResponse:
    """Serve a cached WebP thumbnail (max 480px) for a session photo."""
    photo_root_dir, photo_subfolder, min_mtime = _load_session_photo_context(request, token)
    scanner: PhotoScannerService = request.app.state.photo_scanner

    try:
        cache_path = scanner.get_or_create_variant(
            photo_root_dir,
            photo_subfolder,
            filename,
            "thumb",
            min_mtime=min_mtime,
        )
    except PhotoPathError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return FileResponse(
        path=cache_path,
        media_type="image/webp",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get("/{token}/{filename}/preview")
def get_photo_preview(token: str, filename: str, request: Request) -> FileResponse:
    """Serve a cached WebP medium preview (max 1200px) for a session photo."""
    photo_root_dir, photo_subfolder, min_mtime = _load_session_photo_context(request, token)
    scanner: PhotoScannerService = request.app.state.photo_scanner

    try:
        cache_path = scanner.get_or_create_variant(
            photo_root_dir,
            photo_subfolder,
            filename,
            "preview",
            min_mtime=min_mtime,
        )
    except PhotoPathError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    return FileResponse(
        path=cache_path,
        media_type="image/webp",
        headers={"Cache-Control": "private, max-age=300"},
    )
