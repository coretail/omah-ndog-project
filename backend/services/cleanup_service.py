from __future__ import annotations

import logging
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from backend.config import AppConfig
from backend.database import db_session, get_setting

logger = logging.getLogger(__name__)

DEFAULT_CLEANUP_INTERVAL_SECONDS = 3600


@dataclass(frozen=True)
class CleanupResult:
    """Summary of files removed during retention cleanup."""

    deleted_thumbnails: int
    deleted_outputs: int
    freed_bytes: int


def _prune_expired_files(root_dir: Path, cutoff_ts: float) -> tuple[int, int]:
    """Delete files inside root_dir older than cutoff_ts and prune empty subdirectories."""
    resolved_root = root_dir.resolve()
    if not resolved_root.is_dir():
        return 0, 0

    deleted_count = 0
    freed_bytes = 0

    for item in list(resolved_root.rglob("*")):
        try:
            resolved_item = item.resolve()
            if not resolved_item.is_relative_to(resolved_root) or resolved_item == resolved_root:
                continue
            if not resolved_item.is_file():
                continue
            st = resolved_item.stat()
            if st.st_mtime < cutoff_ts:
                file_size = st.st_size
                resolved_item.unlink(missing_ok=True)
                deleted_count += 1
                freed_bytes += file_size
        except OSError as exc:
            logger.debug("Skipping file during cleanup (%s): %s", item, exc)

    # Remove empty subdirectories bottom-up without touching resolved_root itself
    dirs = sorted(
        (p for p in resolved_root.rglob("*") if p.is_dir()),
        key=lambda p: len(p.parts),
        reverse=True,
    )
    for d in dirs:
        try:
            resolved_d = d.resolve()
            if resolved_d.is_relative_to(resolved_root) and resolved_d != resolved_root:
                if not any(resolved_d.iterdir()):
                    resolved_d.rmdir()
        except OSError:
            pass

    return deleted_count, freed_bytes


def run_retention_cleanup(
    thumbnails_dir: Path,
    outputs_dir: Path,
    retention_days: int,
    *,
    now_ts: float | None = None,
) -> CleanupResult:
    """Delete cached thumbnails and rendered 300 DPI outputs older than retention_days."""
    effective_days = max(1, retention_days)
    ref_ts = now_ts if now_ts is not None else time.time()
    cutoff_ts = ref_ts - effective_days * 86_400

    del_thumbs, freed_thumbs = _prune_expired_files(thumbnails_dir, cutoff_ts)
    del_outputs, freed_outputs = _prune_expired_files(outputs_dir, cutoff_ts)

    return CleanupResult(
        deleted_thumbnails=del_thumbs,
        deleted_outputs=del_outputs,
        freed_bytes=freed_thumbs + freed_outputs,
    )


def delete_session_outputs(outputs_dir: Path, session_id: int) -> int:
    """Delete rendered output directory for a single session without touching camera photos."""
    outputs_root = outputs_dir.resolve()
    if not outputs_root.is_dir():
        return 0

    session_dir = (outputs_root / str(session_id)).resolve()
    if not session_dir.is_relative_to(outputs_root) or session_dir == outputs_root:
        return 0
    if not session_dir.exists():
        return 0

    file_count = sum(1 for item in session_dir.rglob("*") if item.is_file())
    shutil.rmtree(session_dir, ignore_errors=True)
    return file_count


class CleanupScheduler:
    """Background daemon scheduler running retention cleanup on startup and periodically."""

    def __init__(
        self,
        config: AppConfig,
        *,
        interval_seconds: int = DEFAULT_CLEANUP_INTERVAL_SECONDS,
    ) -> None:
        self._config = config
        self._interval_seconds = max(1, interval_seconds)
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def run_once(self) -> CleanupResult:
        """Read retention_days from settings and execute one cleanup pass."""
        retention_days = 7
        try:
            with db_session(self._config.db_path) as conn:
                raw_days = get_setting(conn, "retention_days", "7")
                retention_days = max(1, int(raw_days or "7"))
        except Exception as exc:
            logger.debug("Fallback to default retention_days=7: %s", exc)

        return run_retention_cleanup(
            self._config.thumbnails_dir,
            self._config.outputs_dir,
            retention_days,
        )

    def start(self) -> None:
        """Start background cleanup thread if not already running."""
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._loop,
            name="studio-cleanup-scheduler",
            daemon=True,
        )
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        """Signal the cleanup thread to exit and wait up to timeout seconds."""
        if self._thread is None:
            return
        self._stop_event.set()
        self._thread.join(timeout=timeout)
        self._thread = None

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.run_once()
            except Exception as exc:
                logger.warning("Periodic retention cleanup error: %s", exc)
            if self._stop_event.wait(self._interval_seconds):
                break
