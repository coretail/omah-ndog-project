from __future__ import annotations

import hashlib
import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from backend.schemas import FrameSlotSchema, SelectedPhotoSlotSchema
from backend.services.photo_scanner import (
    MAX_SOURCE_PHOTO_PIXELS,
    PhotoPathError,
    resolve_photo_file,
)

PRINT_DPI = 300
MM_PER_INCH = 25.4
MAX_CANVAS_DIMENSION = 10_000


class CompositorError(Exception):
    """Raised when 300 DPI compositing fails due to invalid geometry or missing/corrupt assets."""


@dataclass(frozen=True)
class CanvasLayout:
    """Pixel dimensions and safe-margin inset for 300 DPI compositing."""

    canvas_width: int
    canvas_height: int
    margin_px: int
    inner_width: int
    inner_height: int


def mm_to_pixels(mm: float, dpi: int = PRINT_DPI) -> int:
    """Convert physical millimeters to rounded integer pixels at the given DPI."""
    return max(1, round(mm / MM_PER_INCH * dpi))


def compute_canvas_layout(
    width_mm: float,
    height_mm: float,
    orientation: str,
    safe_margin_mm: float = 0.0,
    dpi: int = PRINT_DPI,
) -> CanvasLayout:
    """Compute 300 DPI canvas and inner frame dimensions respecting orientation and safe margin."""
    if width_mm <= 0 or height_mm <= 0:
        raise CompositorError("Dimensi kategori frame harus lebih besar dari 0 mm.")
    if safe_margin_mm < 0:
        raise CompositorError("Safe margin tidak boleh negatif.")

    eff_w = float(width_mm)
    eff_h = float(height_mm)
    if orientation == "portrait" and eff_w > eff_h:
        eff_w, eff_h = eff_h, eff_w
    elif orientation == "landscape" and eff_h > eff_w:
        eff_w, eff_h = eff_h, eff_w

    if 2.0 * safe_margin_mm >= min(eff_w, eff_h):
        raise CompositorError("Safe margin terlalu besar untuk ukuran frame ini.")

    canvas_w = mm_to_pixels(eff_w, dpi=dpi)
    canvas_h = mm_to_pixels(eff_h, dpi=dpi)
    if canvas_w > MAX_CANVAS_DIMENSION or canvas_h > MAX_CANVAS_DIMENSION:
        raise CompositorError("Dimensi kanvas 300 DPI melebihi batas maksimum.")

    margin_px = round(safe_margin_mm / MM_PER_INCH * dpi) if safe_margin_mm > 0 else 0
    inner_w = canvas_w - 2 * margin_px
    inner_h = canvas_h - 2 * margin_px
    if inner_w < 1 or inner_h < 1:
        raise CompositorError("Area cetak internal terlalu kecil setelah dikurangi safe margin.")

    return CanvasLayout(
        canvas_width=canvas_w,
        canvas_height=canvas_h,
        margin_px=margin_px,
        inner_width=inner_w,
        inner_height=inner_h,
    )


def _crop_and_fit_photo(
    photo_path: Path,
    slot_w: int,
    slot_h: int,
    offset_x: float,
    offset_y: float,
    zoom: float,
    *,
    min_mtime: float | None = None,
) -> Image.Image:
    """Open, EXIF-orient, cover-crop with CSS-parity pan/zoom, and resize to (slot_w, slot_h)."""
    try:
        st = photo_path.stat()
    except OSError as exc:
        raise CompositorError(f"File foto '{photo_path.name}' tidak dapat dibaca.") from exc

    if min_mtime is not None and st.st_mtime < min_mtime:
        raise CompositorError(f"Foto '{photo_path.name}' tidak termasuk dalam sesi ini.")

    try:
        with Image.open(photo_path) as raw_img:
            raw_w, raw_h = raw_img.size
            if raw_w <= 0 or raw_h <= 0 or raw_w * raw_h > MAX_SOURCE_PHOTO_PIXELS:
                raise CompositorError(f"Dimensi foto '{photo_path.name}' tidak valid.")
            transposed = ImageOps.exif_transpose(raw_img)
            if transposed.mode != "RGBA":
                transposed = transposed.convert("RGBA")

            src_w, src_h = transposed.size
            cover_scale = max(slot_w / src_w, slot_h / src_h)
            total_scale = cover_scale * max(1.0, zoom)
            crop_w = min(float(src_w), slot_w / total_scale)
            crop_h = min(float(src_h), slot_h / total_scale)

            p_x = (1.0 + max(-1.0, min(1.0, offset_x))) / 2.0
            p_y = (1.0 + max(-1.0, min(1.0, offset_y))) / 2.0
            left = max(0.0, min(src_w - crop_w, p_x * (src_w - crop_w)))
            top = max(0.0, min(src_h - crop_h, p_y * (src_h - crop_h)))

            return transposed.resize(
                (slot_w, slot_h),
                Image.Resampling.LANCZOS,
                box=(left, top, left + crop_w, top + crop_h),
            )
    except CompositorError:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise CompositorError(f"Gagal memproses foto '{photo_path.name}'.") from exc


def render_composite_300dpi(
    *,
    session_id: int,
    job_id: int,
    width_mm: float,
    height_mm: float,
    orientation: str,
    safe_margin_mm: float,
    frame_image_filename: str,
    frames_dir: Path,
    slots: list[FrameSlotSchema],
    selected_photos: list[SelectedPhotoSlotSchema],
    photo_root_dir: str,
    photo_subfolder: str,
    outputs_dir: Path,
    min_mtime: float | None = None,
) -> Path:
    """Render a 300 DPI composite JPEG (photos beneath transparent PNG overlay) atomically."""
    layout = compute_canvas_layout(width_mm, height_mm, orientation, safe_margin_mm, dpi=PRINT_DPI)

    frames_root = frames_dir.resolve()
    frame_path = (frames_root / frame_image_filename).resolve()
    if not frame_path.is_relative_to(frames_root) or frame_path == frames_root or not frame_path.is_file():
        raise CompositorError("File template frame PNG tidak ditemukan.")

    selection_map = {item.slotId: item for item in selected_photos}
    missing_slots = [slot.id for slot in slots if slot.id not in selection_map]
    if missing_slots:
        raise CompositorError("Semua slot frame harus terisi foto sebelum dicetak.")

    canvas = Image.new("RGBA", (layout.canvas_width, layout.canvas_height), (255, 255, 255, 255))

    for slot in slots:
        selection = selection_map[slot.id]
        try:
            photo_path = resolve_photo_file(photo_root_dir, photo_subfolder, selection.filename)
        except PhotoPathError as exc:
            raise CompositorError(exc.detail) from exc

        sx = min(layout.inner_width - 1, max(0, round(slot.xPct / 100.0 * layout.inner_width)))
        sy = min(layout.inner_height - 1, max(0, round(slot.yPct / 100.0 * layout.inner_height)))
        sw = max(1, round(slot.wPct / 100.0 * layout.inner_width))
        sh = max(1, round(slot.hPct / 100.0 * layout.inner_height))

        # Clamp within inner frame area to avoid bleeding past safe margins on rounding
        sw = min(sw, max(1, layout.inner_width - sx))
        sh = min(sh, max(1, layout.inner_height - sy))

        fitted = _crop_and_fit_photo(
            photo_path,
            sw,
            sh,
            selection.offsetX,
            selection.offsetY,
            selection.zoom,
            min_mtime=min_mtime,
        )
        canvas.paste(fitted, (layout.margin_px + sx, layout.margin_px + sy))

    try:
        with Image.open(frame_path) as raw_overlay:
            overlay = raw_overlay.convert("RGBA") if raw_overlay.mode != "RGBA" else raw_overlay.copy()
            if overlay.size != (layout.inner_width, layout.inner_height):
                overlay = overlay.resize(
                    (layout.inner_width, layout.inner_height),
                    Image.Resampling.LANCZOS,
                )
            canvas.alpha_composite(overlay, dest=(layout.margin_px, layout.margin_px))
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise CompositorError("Gagal memuat overlay PNG frame.") from exc

    outputs_root = outputs_dir.resolve()
    session_out_dir = (outputs_root / str(session_id)).resolve()
    if not session_out_dir.is_relative_to(outputs_root) or session_out_dir == outputs_root:
        raise CompositorError("Path direktori output tidak valid.")
    session_out_dir.mkdir(parents=True, exist_ok=True)

    output_path = (session_out_dir / f"{job_id}.jpg").resolve()
    if not output_path.is_relative_to(outputs_root):
        raise CompositorError("Path file output tidak valid.")

    tmp_path = session_out_dir / f".tmp_{job_id}_{secrets.token_hex(6)}.jpg"
    try:
        rgb_canvas = canvas.convert("RGB")
        rgb_canvas.save(
            tmp_path,
            format="JPEG",
            quality=95,
            subsampling=0,
            dpi=(PRINT_DPI, PRINT_DPI),
        )
        os.replace(tmp_path, output_path)
    except OSError as exc:
        tmp_path.unlink(missing_ok=True)
        raise CompositorError("Gagal menyimpan file hasil compositing 300 DPI.") from exc

    return output_path


def get_or_create_output_preview(
    output_path: Path,
    thumbnails_dir: Path,
    max_dim: int = 400,
) -> Path:
    """Generate or return a cached WebP thumbnail preview for a rendered 300 DPI output."""
    resolved_output = output_path.resolve()
    if not resolved_output.is_file():
        raise CompositorError("File hasil compositing tidak ditemukan.")

    st = resolved_output.stat()
    thumbs_root = thumbnails_dir.resolve()
    thumbs_root.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256(
        f"out|{resolved_output}|{st.st_size}|{st.st_mtime_ns}|{max_dim}".encode("utf-8")
    ).hexdigest()
    cache_path = (thumbs_root / f"out_{digest}.webp").resolve()
    if not cache_path.is_relative_to(thumbs_root):
        raise CompositorError("Path cache preview output tidak valid.")
    if cache_path.is_file():
        return cache_path

    tmp_path = thumbs_root / f".tmp_out_{digest}_{secrets.token_hex(6)}.webp"
    try:
        with Image.open(resolved_output) as img:
            preview_img = img.convert("RGB")
            preview_img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
            preview_img.save(tmp_path, format="WEBP", quality=82, method=4)
        os.replace(tmp_path, cache_path)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        tmp_path.unlink(missing_ok=True)
        raise CompositorError("Gagal membuat preview output.") from exc

    return cache_path
