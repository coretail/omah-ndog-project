from __future__ import annotations

import io
import json
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError

from backend.database import db_session
from backend.schemas import (
    FrameCategoryCreateRequest,
    FrameCategoryResponse,
    FrameCategoryUpdateRequest,
    FrameResponse,
    FrameSlotsUpdateRequest,
    validate_slots_json,
)
from backend.security import get_app_config, rate_limit_public, require_admin_auth

router = APIRouter(prefix="/api/frames", tags=["frames"])

MAX_FRAME_FILE_BYTES = 15 * 1024 * 1024
MAX_FRAME_DIMENSION = 8000
MAX_FRAME_PIXELS = MAX_FRAME_DIMENSION * MAX_FRAME_DIMENSION


def _row_to_category(row: sqlite3.Row) -> FrameCategoryResponse:
    return FrameCategoryResponse(
        id=int(row["id"]),
        name=str(row["name"]),
        price=int(row["price"]),
        width_mm=float(row["width_mm"]),
        height_mm=float(row["height_mm"]),
        orientation=str(row["orientation"]),  # type: ignore[arg-type]
        safe_margin_mm=float(row["safe_margin_mm"]),
        sort_order=int(row["sort_order"]),
    )


def _row_to_frame(row: sqlite3.Row) -> FrameResponse:
    frame_id = int(row["id"])
    slots = validate_slots_json(str(row["slots_json"]))
    return FrameResponse(
        id=frame_id,
        category_id=int(row["category_id"]),
        name=str(row["name"]),
        image_url=f"/api/frames/{frame_id}/image",
        canvas_width=int(row["canvas_width"]),
        canvas_height=int(row["canvas_height"]),
        slots=slots,
        created_at=str(row["created_at"]),
    )


def _safe_unlink_frame(frames_dir: Path, image_filename: str) -> None:
    if not image_filename:
        return
    base = frames_dir.resolve()
    target = (base / image_filename).resolve()
    if target.is_relative_to(base) and target != base and target.is_file():
        target.unlink(missing_ok=True)


@router.get(
    "/categories",
    response_model=list[FrameCategoryResponse],
    dependencies=[Depends(rate_limit_public)],
)
def list_categories(request: Request) -> list[FrameCategoryResponse]:
    """List all frame categories ordered by sort_order and id."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        rows = conn.execute(
            "SELECT * FROM frame_categories ORDER BY sort_order ASC, id ASC"
        ).fetchall()
    return [_row_to_category(r) for r in rows]


@router.post(
    "/categories",
    response_model=FrameCategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_category(
    payload: FrameCategoryCreateRequest,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> FrameCategoryResponse:
    """Create a new frame category."""
    config = get_app_config(request)
    try:
        with db_session(config.db_path) as conn:
            cursor = conn.execute(
                """
                INSERT INTO frame_categories (
                    name, price, width_mm, height_mm, orientation, safe_margin_mm, sort_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.name,
                    payload.price,
                    payload.width_mm,
                    payload.height_mm,
                    payload.orientation,
                    payload.safe_margin_mm,
                    payload.sort_order,
                ),
            )
            cat_id = int(cursor.lastrowid or 0)
            row = conn.execute(
                "SELECT * FROM frame_categories WHERE id = ?", (cat_id,)
            ).fetchone()
    except sqlite3.IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category name already exists.",
        ) from exc

    if row is None:
        raise HTTPException(status_code=500, detail="Failed to load created category.")
    return _row_to_category(row)


@router.put("/categories/{category_id}", response_model=FrameCategoryResponse)
def update_category(
    category_id: int,
    payload: FrameCategoryUpdateRequest,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> FrameCategoryResponse:
    """Update an existing frame category."""
    config = get_app_config(request)
    try:
        with db_session(config.db_path) as conn:
            existing = conn.execute(
                "SELECT * FROM frame_categories WHERE id = ?", (category_id,)
            ).fetchone()
            if existing is None:
                raise HTTPException(status_code=404, detail="Category not found.")

            name = payload.name if payload.name is not None else str(existing["name"])
            price = payload.price if payload.price is not None else int(existing["price"])
            width_mm = (
                payload.width_mm if payload.width_mm is not None else float(existing["width_mm"])
            )
            height_mm = (
                payload.height_mm
                if payload.height_mm is not None
                else float(existing["height_mm"])
            )
            orientation = (
                payload.orientation
                if payload.orientation is not None
                else str(existing["orientation"])
            )
            safe_margin_mm = (
                payload.safe_margin_mm
                if payload.safe_margin_mm is not None
                else float(existing["safe_margin_mm"])
            )
            sort_order = (
                payload.sort_order
                if payload.sort_order is not None
                else int(existing["sort_order"])
            )

            conn.execute(
                """
                UPDATE frame_categories
                SET name = ?, price = ?, width_mm = ?, height_mm = ?,
                    orientation = ?, safe_margin_mm = ?, sort_order = ?
                WHERE id = ?
                """,
                (name, price, width_mm, height_mm, orientation, safe_margin_mm, sort_order, category_id),
            )
            row = conn.execute(
                "SELECT * FROM frame_categories WHERE id = ?", (category_id,)
            ).fetchone()
    except sqlite3.IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category name already exists.",
        ) from exc

    if row is None:
        raise HTTPException(status_code=404, detail="Category not found.")
    return _row_to_category(row)


@router.delete("/categories/{category_id}")
def delete_category(
    category_id: int,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> dict[str, str]:
    """Delete a frame category and its unused frame PNG files."""
    config = get_app_config(request)
    try:
        with db_session(config.db_path) as conn:
            existing = conn.execute(
                "SELECT id FROM frame_categories WHERE id = ?", (category_id,)
            ).fetchone()
            if existing is None:
                raise HTTPException(status_code=404, detail="Category not found.")
            frame_rows = conn.execute(
                "SELECT image_path FROM frames WHERE category_id = ?", (category_id,)
            ).fetchall()
            conn.execute("DELETE FROM frame_categories WHERE id = ?", (category_id,))
    except sqlite3.IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete category while frames are referenced by print jobs.",
        ) from exc

    for row in frame_rows:
        _safe_unlink_frame(config.frames_dir, str(row["image_path"]))
    return {"status": "deleted"}


@router.get(
    "",
    response_model=list[FrameResponse],
    dependencies=[Depends(rate_limit_public)],
)
def list_frames(
    request: Request,
    category_id: int | None = None,
) -> list[FrameResponse]:
    """List frame templates, optionally filtered by category_id."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        if category_id is not None:
            rows = conn.execute(
                "SELECT * FROM frames WHERE category_id = ? ORDER BY id ASC",
                (category_id,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM frames ORDER BY id ASC").fetchall()
    return [_row_to_frame(r) for r in rows]


@router.post("", response_model=FrameResponse, status_code=status.HTTP_201_CREATED)
def upload_frame(
    request: Request,
    category_id: int = Form(...),
    name: str = Form(...),
    file: UploadFile = File(...),
    _admin_session: str = Depends(require_admin_auth),
) -> FrameResponse:
    """Upload a transparent PNG frame template and store its dimensions."""
    config = get_app_config(request)
    cleaned_name = name.strip()
    if not cleaned_name or len(cleaned_name) > 80:
        raise HTTPException(status_code=400, detail="Frame name must be 1..80 characters.")

    raw_bytes = file.file.read(MAX_FRAME_FILE_BYTES + 1)
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw_bytes) > MAX_FRAME_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Frame PNG exceeds 15 MB limit.",
        )

    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            if img.format != "PNG":
                raise HTTPException(status_code=400, detail="Only PNG frame templates are supported.")
            canvas_width, canvas_height = img.size
            if (
                canvas_width <= 0
                or canvas_height <= 0
                or canvas_width > MAX_FRAME_DIMENSION
                or canvas_height > MAX_FRAME_DIMENSION
                or canvas_width * canvas_height > MAX_FRAME_PIXELS
            ):
                raise HTTPException(
                    status_code=400,
                    detail=f"PNG dimensions must be between 1 and {MAX_FRAME_DIMENSION}px per side.",
                )
            img.verify()
    except HTTPException:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise HTTPException(status_code=400, detail="Invalid or corrupted PNG image.") from exc

    config.ensure_dirs()
    stored_filename = f"{secrets.token_hex(16)}.png"
    target_path = (config.frames_dir.resolve() / stored_filename).resolve()
    if not target_path.is_relative_to(config.frames_dir.resolve()):
        raise HTTPException(status_code=500, detail="Invalid storage path.")

    try:
        with db_session(config.db_path) as conn:
            cat = conn.execute(
                "SELECT id FROM frame_categories WHERE id = ?", (category_id,)
            ).fetchone()
            if cat is None:
                raise HTTPException(status_code=404, detail="Frame category not found.")

            target_path.write_bytes(raw_bytes)
            created_at = datetime.now(timezone.utc).isoformat()
            cursor = conn.execute(
                """
                INSERT INTO frames (
                    category_id, name, image_path, canvas_width, canvas_height, slots_json, created_at
                ) VALUES (?, ?, ?, ?, ?, '[]', ?)
                """,
                (category_id, cleaned_name, stored_filename, canvas_width, canvas_height, created_at),
            )
            frame_id = int(cursor.lastrowid or 0)
            row = conn.execute("SELECT * FROM frames WHERE id = ?", (frame_id,)).fetchone()
    except Exception:
        target_path.unlink(missing_ok=True)
        raise

    if row is None:
        raise HTTPException(status_code=500, detail="Failed to store frame.")
    return _row_to_frame(row)


@router.get("/{frame_id}/image", dependencies=[Depends(rate_limit_public)])
def get_frame_image(frame_id: int, request: Request) -> FileResponse:
    """Serve stored PNG template for a frame."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        row = conn.execute("SELECT image_path FROM frames WHERE id = ?", (frame_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Frame not found.")

    base = config.frames_dir.resolve()
    target = (base / str(row["image_path"])).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise HTTPException(status_code=404, detail="Frame image file not found.")

    return FileResponse(
        path=target,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.put("/{frame_id}/slots", response_model=FrameResponse)
def update_frame_slots(
    frame_id: int,
    payload: FrameSlotsUpdateRequest,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> FrameResponse:
    """Validate and save axis-aligned percentage photo slots for a frame."""
    config = get_app_config(request)
    serialized = json.dumps([slot.model_dump() for slot in payload.slots])
    with db_session(config.db_path) as conn:
        existing = conn.execute("SELECT id FROM frames WHERE id = ?", (frame_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Frame not found.")
        conn.execute(
            "UPDATE frames SET slots_json = ? WHERE id = ?",
            (serialized, frame_id),
        )
        row = conn.execute("SELECT * FROM frames WHERE id = ?", (frame_id,)).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Frame not found.")
    return _row_to_frame(row)


@router.delete("/{frame_id}")
def delete_frame(
    frame_id: int,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> dict[str, str]:
    """Delete a frame template and its stored PNG file."""
    config = get_app_config(request)
    try:
        with db_session(config.db_path) as conn:
            existing = conn.execute(
                "SELECT image_path FROM frames WHERE id = ?", (frame_id,)
            ).fetchone()
            if existing is None:
                raise HTTPException(status_code=404, detail="Frame not found.")
            image_path = str(existing["image_path"])
            conn.execute("DELETE FROM frames WHERE id = ?", (frame_id,))
    except sqlite3.IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete frame referenced by existing print jobs.",
        ) from exc

    _safe_unlink_frame(config.frames_dir, image_path)
    return {"status": "deleted"}
