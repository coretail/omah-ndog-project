from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from PIL import Image, ImageOps, UnidentifiedImageError

SUPPORTED_IMAGE_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".webp"})
MAX_SOURCE_PHOTO_BYTES = 50 * 1024 * 1024
MAX_SOURCE_PHOTO_PIXELS = 100_000_000
THUMB_MAX_DIM = 480
PREVIEW_MAX_DIM = 1200


class PhotoPathError(Exception):
    """Raised when a requested session photo path is invalid, forbidden, or missing."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class ScannedPhoto:
    """Verified photo entry inside a session subfolder."""

    filename: str
    width: int
    height: int
    size_bytes: int
    modified_at: str


def _validate_plain_segment(value: str, label: str) -> str:
    if not value or value != value.strip():
        raise PhotoPathError(400, f"Invalid {label}.")
    forbidden = ("/", "\\", "..", ":", "\x00")
    if any(part in value for part in forbidden) or value in (".", ".."):
        raise PhotoPathError(400, f"Invalid {label}.")
    return value


def resolve_session_folder(photo_root_dir: str, photo_subfolder: str) -> Path:
    """Resolve and strictly verify session subfolder inside photo_root_dir."""
    if not photo_root_dir:
        raise PhotoPathError(400, "Dedicated photo folder is not configured.")
    _validate_plain_segment(photo_subfolder, "session subfolder")

    root = Path(photo_root_dir).resolve()
    if not root.is_dir():
        raise PhotoPathError(400, "Dedicated photo folder is not accessible.")

    resolved = (root / photo_subfolder).resolve()
    if not resolved.is_relative_to(root) or resolved == root:
        raise PhotoPathError(403, "Session subfolder escapes photo root.")
    if not resolved.is_dir():
        raise PhotoPathError(404, "Session photo subfolder does not exist.")
    return resolved


def resolve_photo_file(photo_root_dir: str, photo_subfolder: str, filename: str) -> Path:
    """Resolve and strictly verify a photo file inside the session subfolder."""
    _validate_plain_segment(filename, "filename")
    if Path(filename).suffix.lower() not in SUPPORTED_IMAGE_EXTENSIONS:
        raise PhotoPathError(400, "Unsupported image file extension.")

    session_dir = resolve_session_folder(photo_root_dir, photo_subfolder)
    resolved = (session_dir / filename).resolve()
    if not resolved.is_relative_to(session_dir) or resolved == session_dir:
        raise PhotoPathError(403, "Photo path escapes session folder.")
    if not resolved.is_file():
        raise PhotoPathError(404, "Photo not found.")
    return resolved


def _upright_dimensions(img: Image.Image) -> tuple[int, int]:
    width, height = img.size
    exif = img.getexif()
    orientation = exif.get(274, 1) if exif else 1
    if orientation in (5, 6, 7, 8):
        return height, width
    return width, height


class PhotoScannerService:
    """Scans session folders safely, filters incomplete files, and caches WebP thumbnails."""

    def __init__(
        self,
        thumbnails_dir: Path,
        stability_delay_sec: float = 0.25,
        max_concurrency: int = 4,
        max_metadata_cache: int = 2000,
    ) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be at least 1")
        self._thumbnails_dir = thumbnails_dir
        self._stability_delay_sec = max(0.0, stability_delay_sec)
        self._max_concurrency = max_concurrency
        self._semaphore = threading.BoundedSemaphore(max_concurrency)
        self._cache_lock = threading.Lock()
        self._metadata_cache: OrderedDict[tuple[str, int, int], tuple[int, int]] = OrderedDict()
        self._max_metadata_cache = max_metadata_cache

    def _get_cached_dims(self, key: tuple[str, int, int]) -> tuple[int, int] | None:
        with self._cache_lock:
            dims = self._metadata_cache.get(key)
            if dims is not None:
                self._metadata_cache.move_to_end(key)
            return dims

    def _set_cached_dims(self, key: tuple[str, int, int], dims: tuple[int, int]) -> None:
        with self._cache_lock:
            self._metadata_cache[key] = dims
            self._metadata_cache.move_to_end(key)
            while len(self._metadata_cache) > self._max_metadata_cache:
                self._metadata_cache.popitem(last=False)

    def _verify_and_read_dimensions(self, path: Path) -> tuple[int, int] | None:
        with self._semaphore:
            try:
                with Image.open(path) as img:
                    raw_w, raw_h = img.size
                    if (
                        raw_w <= 0
                        or raw_h <= 0
                        or raw_w * raw_h > MAX_SOURCE_PHOTO_PIXELS
                    ):
                        return None
                    img.verify()

                with Image.open(path) as img:
                    img.load()
                    return _upright_dimensions(img)
            except (
                Image.DecompressionBombError,
                UnidentifiedImageError,
                OSError,
                SyntaxError,
                ValueError,
            ):
                return None

    def list_photos(
        self,
        photo_root_dir: str,
        photo_subfolder: str,
        *,
        min_mtime: float | None = None,
    ) -> list[ScannedPhoto]:
        """Scan session subfolder and return verified, stable photo entries."""
        session_dir = resolve_session_folder(photo_root_dir, photo_subfolder)

        try:
            dir_entries = list(session_dir.iterdir())
        except OSError as exc:
            raise PhotoPathError(400, "Failed to read session subfolder.") from exc

        verified_photos: list[ScannedPhoto] = []
        pending: list[tuple[str, Path, os.stat_result]] = []

        for entry in dir_entries:
            if entry.suffix.lower() not in SUPPORTED_IMAGE_EXTENSIONS:
                continue
            try:
                resolved = entry.resolve()
                if not resolved.is_relative_to(session_dir) or resolved == session_dir:
                    continue
                if not resolved.is_file():
                    continue
                st1 = resolved.stat()
            except OSError:
                continue

            if st1.st_size <= 0 or st1.st_size > MAX_SOURCE_PHOTO_BYTES:
                continue
            if min_mtime is not None and st1.st_mtime < min_mtime:
                continue

            cache_key = (str(resolved), st1.st_size, st1.st_mtime_ns)
            cached_dims = self._get_cached_dims(cache_key)
            if cached_dims is not None:
                verified_photos.append(
                    ScannedPhoto(
                        filename=entry.name,
                        width=cached_dims[0],
                        height=cached_dims[1],
                        size_bytes=st1.st_size,
                        modified_at=datetime.fromtimestamp(st1.st_mtime, tz=timezone.utc).isoformat(),
                    )
                )
            else:
                pending.append((entry.name, resolved, st1))

        if pending:
            if self._stability_delay_sec > 0:
                time.sleep(self._stability_delay_sec)

            stable_items: list[tuple[str, Path, os.stat_result]] = []
            for filename, resolved, st1 in pending:
                try:
                    st2 = resolved.stat()
                except OSError:
                    continue
                if st2.st_size != st1.st_size or st2.st_mtime_ns != st1.st_mtime_ns:
                    continue
                stable_items.append((filename, resolved, st2))

            if len(stable_items) > 1:
                workers = min(self._max_concurrency, len(stable_items))
                with ThreadPoolExecutor(max_workers=workers) as pool:
                    dims_list = list(
                        pool.map(
                            lambda item: self._verify_and_read_dimensions(item[1]),
                            stable_items,
                        )
                    )
            elif len(stable_items) == 1:
                dims_list = [self._verify_and_read_dimensions(stable_items[0][1])]
            else:
                dims_list = []

            for (filename, resolved, st2), dims in zip(stable_items, dims_list, strict=True):
                if dims is None:
                    continue

                cache_key = (str(resolved), st2.st_size, st2.st_mtime_ns)
                self._set_cached_dims(cache_key, dims)
                verified_photos.append(
                    ScannedPhoto(
                        filename=filename,
                        width=dims[0],
                        height=dims[1],
                        size_bytes=st2.st_size,
                        modified_at=datetime.fromtimestamp(st2.st_mtime, tz=timezone.utc).isoformat(),
                    )
                )

        verified_photos.sort(key=lambda item: item.filename.lower())
        return verified_photos

    def get_or_create_variant(
        self,
        photo_root_dir: str,
        photo_subfolder: str,
        filename: str,
        variant: Literal["thumb", "preview"],
        *,
        min_mtime: float | None = None,
    ) -> Path:
        """Return cached WebP thumbnail/preview path, generating it safely if absent."""
        resolved = resolve_photo_file(photo_root_dir, photo_subfolder, filename)
        try:
            st1 = resolved.stat()
        except OSError as exc:
            raise PhotoPathError(404, "Photo not found.") from exc

        if st1.st_size <= 0 or st1.st_size > MAX_SOURCE_PHOTO_BYTES:
            raise PhotoPathError(404, "Photo is not ready.")
        if min_mtime is not None and st1.st_mtime < min_mtime:
            raise PhotoPathError(404, "Photo not found in this session.")

        thumbs_root = self._thumbnails_dir.resolve()
        thumbs_root.mkdir(parents=True, exist_ok=True)

        digest = hashlib.sha256(
            f"{resolved}|{st1.st_size}|{st1.st_mtime_ns}|{variant}".encode("utf-8")
        ).hexdigest()
        cache_path = (thumbs_root / f"{digest}_{variant}.webp").resolve()
        if not cache_path.is_relative_to(thumbs_root):
            raise PhotoPathError(500, "Invalid thumbnail cache path.")
        if cache_path.is_file():
            return cache_path

        cache_key = (str(resolved), st1.st_size, st1.st_mtime_ns)
        if self._get_cached_dims(cache_key) is None and self._stability_delay_sec > 0:
            time.sleep(self._stability_delay_sec)
            try:
                st2 = resolved.stat()
            except OSError as exc:
                raise PhotoPathError(404, "Photo is not ready.") from exc
            if st2.st_size != st1.st_size or st2.st_mtime_ns != st1.st_mtime_ns:
                raise PhotoPathError(404, "Photo is still being copied.")

        max_dim = THUMB_MAX_DIM if variant == "thumb" else PREVIEW_MAX_DIM
        quality = 80 if variant == "thumb" else 85
        tmp_path = thumbs_root / f".tmp_{digest}_{secrets.token_hex(6)}.webp"

        with self._semaphore:
            if cache_path.is_file():
                return cache_path
            try:
                with Image.open(resolved) as img:
                    raw_w, raw_h = img.size
                    if (
                        raw_w <= 0
                        or raw_h <= 0
                        or raw_w * raw_h > MAX_SOURCE_PHOTO_PIXELS
                    ):
                        raise PhotoPathError(400, "Photo dimensions exceed limit.")
                    img.verify()

                with Image.open(resolved) as img:
                    img.load()
                    dims = _upright_dimensions(img)
                    self._set_cached_dims(cache_key, dims)

                    transposed = ImageOps.exif_transpose(img)
                    if transposed.mode not in ("RGB", "RGBA"):
                        target_mode = "RGBA" if "A" in transposed.getbands() else "RGB"
                        transposed = transposed.convert(target_mode)
                    transposed.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
                    transposed.save(tmp_path, format="WEBP", quality=quality, method=4)

                os.replace(tmp_path, cache_path)
            except PhotoPathError:
                tmp_path.unlink(missing_ok=True)
                raise
            except (
                Image.DecompressionBombError,
                UnidentifiedImageError,
                OSError,
                SyntaxError,
                ValueError,
            ) as exc:
                tmp_path.unlink(missing_ok=True)
                raise PhotoPathError(404, "Photo is invalid or still copying.") from exc

        return cache_path
