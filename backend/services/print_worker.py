from __future__ import annotations

import logging
import queue
import threading
from datetime import datetime, timezone
from pathlib import Path

from backend.config import AppConfig
from backend.database import db_session, get_all_settings
from backend.routers.sessions import parse_iso_utc
from backend.schemas import validate_selected_photos_json, validate_slots_json
from backend.services.compositor import CompositorError, render_composite_300dpi
from backend.services.printer import PrinterBackend, PrinterError


class PrintWorker:
    """Single-worker background queue for non-blocking 300 DPI compositing and printing."""

    def __init__(self, config: AppConfig, printer_backend: PrinterBackend) -> None:
        self._config = config
        self._printer_backend = printer_backend
        self._queue: queue.Queue[tuple[str, int] | None] = queue.Queue()
        self._cond = threading.Condition()
        self._pending_count = 0
        self._started = False
        self._stopping = False
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Start background worker thread and recover any interrupted printing jobs."""
        with self._cond:
            if self._started and self._thread is not None and self._thread.is_alive():
                return
            self._stopping = False
            self._recover_interrupted_jobs()
            self._thread = threading.Thread(
                target=self._run_loop,
                name="studio-print-worker",
                daemon=True,
            )
            self._started = True
            self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        """Gracefully stop the background worker thread."""
        with self._cond:
            if not self._started or self._thread is None:
                return
            self._stopping = True
            thread = self._thread
            self._queue.put(None)
        thread.join(timeout=timeout)
        with self._cond:
            self._started = False
            self._thread = None

    def enqueue(self, task_type: str, job_id: int) -> None:
        """Queue a compositing or print task for asynchronous background execution."""
        with self._cond:
            if not self._started or self._thread is None or not self._thread.is_alive():
                self._stopping = False
                self._recover_interrupted_jobs()
                self._thread = threading.Thread(
                    target=self._run_loop,
                    name="studio-print-worker",
                    daemon=True,
                )
                self._started = True
                self._thread.start()
            self._pending_count += 1
            self._queue.put((task_type, job_id))

    def wait_idle(self, timeout: float = 10.0) -> bool:
        """Block until all queued tasks finish or timeout expires (for tests/shutdown)."""
        with self._cond:
            return self._cond.wait_for(lambda: self._pending_count == 0, timeout=timeout)

    def _recover_interrupted_jobs(self) -> None:
        now_iso = datetime.now(timezone.utc).isoformat()
        try:
            with db_session(self._config.db_path) as conn:
                conn.execute(
                    """
                    UPDATE print_jobs
                    SET status = 'failed',
                        error_message = 'Proses cetak terhenti saat server restart.',
                        updated_at = ?
                    WHERE status = 'printing'
                    """,
                    (now_iso,),
                )
        except Exception as exc:
            # DB may not be initialized yet if called outside lifespan
            logging.getLogger(__name__).debug("Skipped print job recovery: %s", exc)

    def _run_loop(self) -> None:
        while True:
            item = self._queue.get()
            if item is None:
                self._queue.task_done()
                break
            task_type, job_id = item
            try:
                if task_type == "process_new":
                    self._handle_process_new(job_id)
                elif task_type == "print_job":
                    self._handle_print_job(job_id)
            except Exception as exc:
                self._mark_failed_safe(job_id, f"Kesalahan internal worker: {exc}")
            finally:
                self._queue.task_done()
                with self._cond:
                    self._pending_count = max(0, self._pending_count - 1)
                    if self._pending_count == 0:
                        self._cond.notify_all()

    def _mark_failed_safe(self, job_id: int, message: str) -> None:
        now_iso = datetime.now(timezone.utc).isoformat()
        with db_session(self._config.db_path) as conn:
            conn.execute(
                """
                UPDATE print_jobs
                SET status = 'failed', error_message = ?, updated_at = ?
                WHERE id = ? AND status NOT IN ('cancelled', 'printed')
                """,
                (message[:500], now_iso, job_id),
            )

    def _ensure_output_rendered(self, job_id: int) -> tuple[Path, str, int, str]:
        """Render 300 DPI composite if missing on disk. Returns (output_path, orientation, copies, status)."""
        with db_session(self._config.db_path) as conn:
            row = conn.execute(
                """
                SELECT
                    pj.*,
                    cs.photo_subfolder,
                    cs.filter_after_created_at,
                    cs.created_at AS session_created_at,
                    f.image_path AS frame_image_path,
                    f.slots_json,
                    fc.width_mm,
                    fc.height_mm,
                    fc.orientation,
                    fc.safe_margin_mm
                FROM print_jobs pj
                JOIN customer_sessions cs ON cs.id = pj.session_id
                JOIN frames f ON f.id = pj.frame_id
                JOIN frame_categories fc ON fc.id = f.category_id
                WHERE pj.id = ?
                """,
                (job_id,),
            ).fetchone()
            if row is None:
                raise CompositorError("Print job tidak ditemukan.")

            settings = get_all_settings(conn)

        status_val = str(row["status"])
        copies = int(row["copies"])
        orientation = str(row["orientation"])
        existing_rel = str(row["output_image_path"] or "")
        outputs_root = self._config.outputs_dir.resolve()

        if existing_rel:
            existing_abs = (outputs_root / existing_rel).resolve()
            if existing_abs.is_relative_to(outputs_root) and existing_abs.is_file():
                return existing_abs, orientation, copies, status_val

        slots = validate_slots_json(str(row["slots_json"]))
        selected_photos = validate_selected_photos_json(str(row["selected_photos_json"]))
        filter_after = int(row["filter_after_created_at"]) == 1
        min_mtime = (
            parse_iso_utc(str(row["session_created_at"])).timestamp() if filter_after else None
        )

        output_abs = render_composite_300dpi(
            session_id=int(row["session_id"]),
            job_id=job_id,
            width_mm=float(row["width_mm"]),
            height_mm=float(row["height_mm"]),
            orientation=orientation,
            safe_margin_mm=float(row["safe_margin_mm"]),
            frame_image_filename=str(row["frame_image_path"]),
            frames_dir=self._config.frames_dir,
            slots=slots,
            selected_photos=selected_photos,
            photo_root_dir=settings.get("photo_root_dir", ""),
            photo_subfolder=str(row["photo_subfolder"]),
            outputs_dir=self._config.outputs_dir,
            min_mtime=min_mtime,
        )
        rel_path = output_abs.resolve().relative_to(outputs_root).as_posix()
        now_iso = datetime.now(timezone.utc).isoformat()
        with db_session(self._config.db_path) as conn:
            conn.execute(
                "UPDATE print_jobs SET output_image_path = ?, updated_at = ? WHERE id = ?",
                (rel_path, now_iso, job_id),
            )
        return output_abs, orientation, copies, status_val

    def _handle_process_new(self, job_id: int) -> None:
        with db_session(self._config.db_path) as conn:
            row = conn.execute("SELECT status FROM print_jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None or str(row["status"]) == "cancelled":
            return

        try:
            _, _, _, _ = self._ensure_output_rendered(job_id)
        except CompositorError as exc:
            self._mark_failed_safe(job_id, str(exc))
            return

        now_iso = datetime.now(timezone.utc).isoformat()
        should_print = False
        with db_session(self._config.db_path) as conn:
            settings = get_all_settings(conn)
            auto_print = settings.get("auto_print_enabled", "false").lower() == "true"
            if auto_print:
                cursor = conn.execute(
                    """
                    UPDATE print_jobs
                    SET status = 'printing', error_message = '', updated_at = ?
                    WHERE id = ? AND status = 'queued'
                    """,
                    (now_iso, job_id),
                )
                should_print = cursor.rowcount > 0

        if should_print:
            self._execute_print(job_id)

    def _handle_print_job(self, job_id: int) -> None:
        try:
            _, _, _, status_val = self._ensure_output_rendered(job_id)
        except CompositorError as exc:
            self._mark_failed_safe(job_id, str(exc))
            return

        if status_val != "printing":
            return
        self._execute_print(job_id)

    def _resolve_printer_name(self, configured_name: str) -> str:
        cleaned = configured_name.strip()
        if cleaned:
            return cleaned
        printers = self._printer_backend.list_printers()
        for p in printers:
            if p.is_default:
                return p.name
        if printers:
            return printers[0].name
        return ""

    def _execute_print(self, job_id: int) -> None:
        with db_session(self._config.db_path) as conn:
            row = conn.execute(
                """
                SELECT pj.status, pj.copies, pj.output_image_path, fc.orientation
                FROM print_jobs pj
                JOIN frames f ON f.id = pj.frame_id
                JOIN frame_categories fc ON fc.id = f.category_id
                WHERE pj.id = ?
                """,
                (job_id,),
            ).fetchone()
            settings = get_all_settings(conn)

        if row is None or str(row["status"]) != "printing":
            return

        outputs_root = self._config.outputs_dir.resolve()
        rel_path = str(row["output_image_path"] or "")
        output_abs = (outputs_root / rel_path).resolve() if rel_path else outputs_root
        if not rel_path or not output_abs.is_relative_to(outputs_root) or not output_abs.is_file():
            self._mark_failed_safe(job_id, "File output 300 DPI tidak ditemukan untuk dicetak.")
            return

        target_printer = self._resolve_printer_name(settings.get("printer_name", ""))
        if not target_printer:
            self._mark_failed_safe(
                job_id,
                "Tidak ada printer yang dikonfigurasi atau terdeteksi di sistem.",
            )
            return

        try:
            self._printer_backend.print_image(
                image_path=output_abs,
                printer_name=target_printer,
                copies=int(row["copies"]),
                orientation=str(row["orientation"]),
            )
        except PrinterError as exc:
            self._mark_failed_safe(job_id, exc.message)
            return
        except Exception as exc:
            self._mark_failed_safe(job_id, f"Gagal mencetak: {exc}")
            return

        now_iso = datetime.now(timezone.utc).isoformat()
        with db_session(self._config.db_path) as conn:
            conn.execute(
                """
                UPDATE print_jobs
                SET status = 'printed', error_message = '', updated_at = ?
                WHERE id = ? AND status = 'printing'
                """,
                (now_iso, job_id),
            )
