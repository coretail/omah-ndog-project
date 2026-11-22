from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse

from backend.database import db_session, get_setting
from backend.routers.sessions import load_active_session, parse_iso_utc
from backend.schemas import (
    AdminPrintJobResponse,
    PrinterInfoResponse,
    PrintJobCustomerResponse,
    PrintJobStatusLiteral,
    SubmitPrintJobRequest,
    validate_slots_json,
)
from backend.security import (
    get_app_config,
    rate_limit_public,
    require_admin_auth,
)
from backend.services.compositor import CompositorError, get_or_create_output_preview
from backend.services.photo_scanner import PhotoPathError, resolve_photo_file
from backend.services.print_worker import PrintWorker
from backend.services.printer import PrinterBackend

router = APIRouter(prefix="/api/prints", tags=["prints"])


def _resolve_output_file(outputs_dir: Path, rel_path: str) -> Path | None:
    if not rel_path:
        return None
    root = outputs_dir.resolve()
    target = (root / rel_path).resolve()
    if not target.is_relative_to(root) or target == root or not target.is_file():
        return None
    return target


def _row_to_admin_job(row: sqlite3.Row, outputs_dir: Path) -> AdminPrintJobResponse:
    job_id = int(row["id"])
    output_file = _resolve_output_file(outputs_dir, str(row["output_image_path"] or ""))
    has_output = output_file is not None
    return AdminPrintJobResponse(
        id=job_id,
        session_id=int(row["session_id"]),
        customer_name=str(row["customer_name"]),
        frame_id=int(row["frame_id"]),
        frame_name=str(row["frame_name"]),
        category_name=str(row["category_name"]),
        unit_price=int(row["unit_price"]),
        copies=int(row["copies"]),
        total_price=int(row["total_price"]),
        status=str(row["status"]),  # type: ignore[arg-type]
        error_message=str(row["error_message"] or ""),
        has_output=has_output,
        preview_url=f"/api/prints/queue/{job_id}/preview" if has_output else None,
        download_url=f"/api/prints/queue/{job_id}/download" if has_output else None,
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _load_admin_job_row(conn: sqlite3.Connection, job_id: int) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT
            pj.*,
            cs.name AS customer_name,
            f.name AS frame_name
        FROM print_jobs pj
        JOIN customer_sessions cs ON cs.id = pj.session_id
        JOIN frames f ON f.id = pj.frame_id
        WHERE pj.id = ?
        """,
        (job_id,),
    ).fetchone()


@router.get("/printers", response_model=list[PrinterInfoResponse])
def list_printers(
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> list[PrinterInfoResponse]:
    """List available system printers and their live status."""
    backend: PrinterBackend = request.app.state.printer_backend
    infos = backend.list_printers()
    return [
        PrinterInfoResponse(
            name=info.name,
            is_default=info.is_default,
            status=info.status,
            status_message=info.status_message,
            jobs_count=info.jobs_count,
        )
        for info in infos
    ]


@router.get("/queue", response_model=list[AdminPrintJobResponse])
def list_print_queue(
    request: Request,
    status_filter: PrintJobStatusLiteral | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    _admin_session: str = Depends(require_admin_auth),
) -> list[AdminPrintJobResponse]:
    """List print jobs for the Admin Print Queue panel (newest first)."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        if status_filter is not None:
            rows = conn.execute(
                """
                SELECT pj.*, cs.name AS customer_name, f.name AS frame_name
                FROM print_jobs pj
                JOIN customer_sessions cs ON cs.id = pj.session_id
                JOIN frames f ON f.id = pj.frame_id
                WHERE pj.status = ?
                ORDER BY pj.id DESC
                LIMIT ?
                """,
                (status_filter, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT pj.*, cs.name AS customer_name, f.name AS frame_name
                FROM print_jobs pj
                JOIN customer_sessions cs ON cs.id = pj.session_id
                JOIN frames f ON f.id = pj.frame_id
                ORDER BY pj.id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

    return [_row_to_admin_job(row, config.outputs_dir) for row in rows]


@router.post("/queue/{job_id}/print", response_model=AdminPrintJobResponse)
def trigger_manual_print(
    job_id: int,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> AdminPrintJobResponse:
    """Trigger printing for a queued job (Manual Print Queue mode)."""
    config = get_app_config(request)
    now_iso = datetime.now(timezone.utc).isoformat()
    with db_session(config.db_path) as conn:
        existing = _load_admin_job_row(conn, job_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Print job not found.")
        cursor = conn.execute(
            """
            UPDATE print_jobs
            SET status = 'printing', error_message = '', updated_at = ?
            WHERE id = ? AND status = 'queued'
            """,
            (now_iso, job_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Job cannot be printed from status '{existing['status']}'.",
            )
        updated = _load_admin_job_row(conn, job_id)

    worker: PrintWorker = request.app.state.print_worker
    worker.enqueue("print_job", job_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Print job not found.")
    return _row_to_admin_job(updated, config.outputs_dir)


@router.post("/queue/{job_id}/retry", response_model=AdminPrintJobResponse)
def retry_failed_print(
    job_id: int,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> AdminPrintJobResponse:
    """Retry a failed print job."""
    config = get_app_config(request)
    now_iso = datetime.now(timezone.utc).isoformat()
    with db_session(config.db_path) as conn:
        existing = _load_admin_job_row(conn, job_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Print job not found.")
        cursor = conn.execute(
            """
            UPDATE print_jobs
            SET status = 'printing', error_message = '', updated_at = ?
            WHERE id = ? AND status = 'failed'
            """,
            (now_iso, job_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Only failed jobs can be retried (current: '{existing['status']}').",
            )
        updated = _load_admin_job_row(conn, job_id)

    worker: PrintWorker = request.app.state.print_worker
    worker.enqueue("print_job", job_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Print job not found.")
    return _row_to_admin_job(updated, config.outputs_dir)


@router.post("/queue/{job_id}/cancel", response_model=AdminPrintJobResponse)
def cancel_print_job(
    job_id: int,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> AdminPrintJobResponse:
    """Cancel a queued or failed print job."""
    config = get_app_config(request)
    now_iso = datetime.now(timezone.utc).isoformat()
    with db_session(config.db_path) as conn:
        existing = _load_admin_job_row(conn, job_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Print job not found.")
        cursor = conn.execute(
            """
            UPDATE print_jobs
            SET status = 'cancelled', updated_at = ?
            WHERE id = ? AND status IN ('queued', 'failed')
            """,
            (now_iso, job_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Job cannot be cancelled from status '{existing['status']}'.",
            )
        updated = _load_admin_job_row(conn, job_id)

    if updated is None:
        raise HTTPException(status_code=404, detail="Print job not found.")
    return _row_to_admin_job(updated, config.outputs_dir)


@router.get("/queue/{job_id}/download")
def download_print_output(
    job_id: int,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> FileResponse:
    """Download the rendered 300 DPI JPEG output for a print job."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        row = conn.execute(
            "SELECT output_image_path FROM print_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Print job not found.")

    output_file = _resolve_output_file(config.outputs_dir, str(row["output_image_path"] or ""))
    if output_file is None:
        raise HTTPException(status_code=404, detail="Rendered output file is not ready.")

    return FileResponse(
        path=output_file,
        media_type="image/jpeg",
        filename=f"print_job_{job_id}.jpg",
    )


@router.get("/queue/{job_id}/preview")
def preview_print_output(
    job_id: int,
    request: Request,
    _admin_session: str = Depends(require_admin_auth),
) -> FileResponse:
    """Serve a lightweight WebP thumbnail preview of the rendered 300 DPI output."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        row = conn.execute(
            "SELECT output_image_path FROM print_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Print job not found.")

    output_file = _resolve_output_file(config.outputs_dir, str(row["output_image_path"] or ""))
    if output_file is None:
        raise HTTPException(status_code=404, detail="Rendered output file is not ready.")

    try:
        cache_path = get_or_create_output_preview(output_file, config.thumbnails_dir)
    except CompositorError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return FileResponse(
        path=cache_path,
        media_type="image/webp",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post(
    "/{token}",
    response_model=PrintJobCustomerResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_public)],
)
def submit_print_job(
    token: str,
    payload: SubmitPrintJobRequest,
    request: Request,
) -> PrintJobCustomerResponse:
    """Validate customer photo/frame selection, record print job, and queue background rendering."""
    config = get_app_config(request)
    now_iso = datetime.now(timezone.utc).isoformat()

    with db_session(config.db_path) as conn:
        session_row = load_active_session(conn, token)
        photo_root_dir = get_setting(conn, "photo_root_dir")
        frame_row = conn.execute(
            """
            SELECT f.id, f.slots_json, fc.name AS category_name, fc.price AS unit_price
            FROM frames f
            JOIN frame_categories fc ON fc.id = f.category_id
            WHERE f.id = ?
            """,
            (payload.frame_id,),
        ).fetchone()
        if frame_row is None:
            raise HTTPException(status_code=404, detail="Selected frame not found.")

        frame_slots = validate_slots_json(str(frame_row["slots_json"]))
        if not frame_slots:
            raise HTTPException(status_code=400, detail="Selected frame has no photo slots configured.")

        expected_ids = {slot.id for slot in frame_slots}
        provided_ids = {item.slotId for item in payload.selected_photos}
        if expected_ids != provided_ids:
            raise HTTPException(
                status_code=422,
                detail="selected_photos must match every slot configured on the selected frame.",
            )

        photo_subfolder = str(session_row["photo_subfolder"])
        filter_after = int(session_row["filter_after_created_at"]) == 1
        min_mtime = (
            parse_iso_utc(str(session_row["created_at"])).timestamp() if filter_after else None
        )

        for item in payload.selected_photos:
            try:
                resolved = resolve_photo_file(photo_root_dir, photo_subfolder, item.filename)
                if min_mtime is not None and resolved.stat().st_mtime < min_mtime:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Photo '{item.filename}' is outside this session's time filter.",
                    )
            except PhotoPathError as exc:
                raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
            except OSError as exc:
                raise HTTPException(
                    status_code=404, detail=f"Photo '{item.filename}' cannot be accessed."
                ) from exc

        unit_price = int(frame_row["unit_price"])
        total_price = unit_price * payload.copies
        serialized_photos = json.dumps([item.model_dump() for item in payload.selected_photos])

        cursor = conn.execute(
            """
            INSERT INTO print_jobs (
                session_id, frame_id, category_name, unit_price, copies, total_price,
                selected_photos_json, output_image_path, status, error_message, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, '', 'queued', '', ?, ?)
            """,
            (
                int(session_row["id"]),
                payload.frame_id,
                str(frame_row["category_name"]),
                unit_price,
                payload.copies,
                total_price,
                serialized_photos,
                now_iso,
                now_iso,
            ),
        )
        job_id = int(cursor.lastrowid or 0)

    worker: PrintWorker = request.app.state.print_worker
    worker.enqueue("process_new", job_id)

    return PrintJobCustomerResponse(
        id=job_id,
        status="queued",
        copies=payload.copies,
        total_price=total_price,
        error_message="",
    )


@router.get(
    "/{token}/{job_id}",
    response_model=PrintJobCustomerResponse,
    dependencies=[Depends(rate_limit_public)],
)
def get_customer_print_job_status(
    token: str,
    job_id: int,
    request: Request,
) -> PrintJobCustomerResponse:
    """Retrieve status of a print job belonging to the active customer session."""
    config = get_app_config(request)
    with db_session(config.db_path) as conn:
        session_row = load_active_session(conn, token)
        job_row = conn.execute(
            "SELECT id, session_id, status, copies, total_price, error_message FROM print_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if job_row is None or int(job_row["session_id"]) != int(session_row["id"]):
            raise HTTPException(status_code=404, detail="Print job not found.")

    return PrintJobCustomerResponse(
        id=int(job_row["id"]),
        status=str(job_row["status"]),  # type: ignore[arg-type]
        copies=int(job_row["copies"]),
        total_price=int(job_row["total_price"]),
        error_message=str(job_row["error_message"] or ""),
    )
