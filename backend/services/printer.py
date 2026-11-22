from __future__ import annotations

import os
import sys
import threading
from abc import ABC, abstractmethod
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageWin

from backend.schemas import PrinterStatusLiteral

try:
    import win32con
    import win32gui
    import win32print
    import win32ui

    _HAS_PYWIN32 = True
except ImportError:  # pragma: no cover - non-Windows fallback
    win32con = None  # type: ignore[assignment]
    win32gui = None  # type: ignore[assignment]
    win32print = None  # type: ignore[assignment]
    win32ui = None  # type: ignore[assignment]
    _HAS_PYWIN32 = False


class PrinterError(Exception):
    """Raised when printer status check or spooler job submission fails."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class PrinterStatusInfo:
    """Snapshot of a printer's availability and spooler status."""

    name: str
    is_default: bool
    status: PrinterStatusLiteral
    status_message: str
    jobs_count: int = 0


class PrinterBackend(ABC):
    """Abstract interface for enumerating printers and printing rendered 300 DPI images."""

    @abstractmethod
    def list_printers(self) -> list[PrinterStatusInfo]:
        """Return available printers and their current status."""

    @abstractmethod
    def get_printer_status(self, printer_name: str) -> PrinterStatusInfo:
        """Inspect current status for a named printer."""

    @abstractmethod
    def print_image(
        self,
        image_path: Path,
        printer_name: str,
        copies: int = 1,
        orientation: str = "portrait",
    ) -> None:
        """Send an image file to the specified printer."""


def _evaluate_win32_printer_status(attributes: int, status_flags: int) -> tuple[PrinterStatusLiteral, str]:
    """Map Windows spooler Attributes & Status bitmasks into a normalized status."""
    work_offline_attr = getattr(win32print, "PRINTER_ATTRIBUTE_WORK_OFFLINE", 0x00000400)
    offline_flag = getattr(win32print, "PRINTER_STATUS_OFFLINE", 0x00000080)
    paper_out_flag = getattr(win32print, "PRINTER_STATUS_PAPER_OUT", 0x00000010)
    paper_jam_flag = getattr(win32print, "PRINTER_STATUS_PAPER_JAM", 0x00000008)
    paper_problem_flag = getattr(win32print, "PRINTER_STATUS_PAPER_PROBLEM", 0x00000040)
    error_flag = getattr(win32print, "PRINTER_STATUS_ERROR", 0x00000002)
    door_open_flag = getattr(win32print, "PRINTER_STATUS_DOOR_OPEN", 0x00400000)
    no_toner_flag = getattr(win32print, "PRINTER_STATUS_NO_TONER", 0x00040000)
    not_avail_flag = getattr(win32print, "PRINTER_STATUS_NOT_AVAILABLE", 0x00001000)
    user_int_flag = getattr(win32print, "PRINTER_STATUS_USER_INTERVENTION", 0x00100000)
    paused_flag = getattr(win32print, "PRINTER_STATUS_PAUSED", 0x00000001)
    printing_flag = getattr(win32print, "PRINTER_STATUS_PRINTING", 0x00000400)
    busy_flag = getattr(win32print, "PRINTER_STATUS_BUSY", 0x00000200)

    if (attributes & work_offline_attr) or (status_flags & offline_flag):
        return "offline", "Printer sedang offline / tidak terhubung."
    if status_flags & paper_out_flag:
        return "paper_out", "Kertas printer habis (Paper Out)."
    if status_flags & (paper_jam_flag | paper_problem_flag):
        return "error", "Kertas printer bermasalah / macet."
    if status_flags & (error_flag | door_open_flag | no_toner_flag | not_avail_flag | user_int_flag):
        return "error", "Printer mengalami error atau membutuhkan perhatian operator."
    if status_flags & paused_flag:
        return "error", "Antrean printer Windows sedang dijeda (Paused)."
    if status_flags & (printing_flag | busy_flag):
        return "busy", "Printer sedang sibuk mencetak."
    return "ready", "Printer siap digunakan."


class WindowsSpoolerPrinter(PrinterBackend):
    """Windows print spooler backend backed by pywin32 (win32print + PIL.ImageWin)."""

    def _require_pywin32(self) -> tuple[Any, Any, Any]:
        if not _HAS_PYWIN32 or win32print is None or win32ui is None or win32con is None:
            raise PrinterError("unsupported", "pywin32 tidak tersedia pada sistem operasi ini.")
        return win32print, win32ui, win32con

    def _get_default_printer_name(self) -> str:
        w32print, _, _ = self._require_pywin32()
        try:
            return str(w32print.GetDefaultPrinter())
        except Exception:
            return ""

    def list_printers(self) -> list[PrinterStatusInfo]:
        w32print, _, _ = self._require_pywin32()
        default_name = self._get_default_printer_name()
        flags = w32print.PRINTER_ENUM_LOCAL | w32print.PRINTER_ENUM_CONNECTIONS
        raw_printers = w32print.EnumPrinters(flags)
        results: list[PrinterStatusInfo] = []
        for entry in raw_printers:
            printer_name = str(entry[2])
            try:
                info = self.get_printer_status(printer_name, default_name=default_name)
            except Exception:
                info = PrinterStatusInfo(
                    name=printer_name,
                    is_default=printer_name == default_name,
                    status="unknown",
                    status_message="Status printer tidak dapat dibaca.",
                    jobs_count=0,
                )
            results.append(info)
        return results

    def get_printer_status(
        self,
        printer_name: str,
        *,
        default_name: str | None = None,
    ) -> PrinterStatusInfo:
        w32print, _, _ = self._require_pywin32()
        resolved_default = default_name if default_name is not None else self._get_default_printer_name()
        handle = None
        try:
            handle = w32print.OpenPrinter(printer_name)
            info = w32print.GetPrinter(handle, 2)
            attributes = int(info.get("Attributes", 0))
            status_flags = int(info.get("Status", 0))
            jobs_count = int(info.get("cJobs", 0))
            norm_status, message = _evaluate_win32_printer_status(attributes, status_flags)
            return PrinterStatusInfo(
                name=printer_name,
                is_default=printer_name == resolved_default,
                status=norm_status,
                status_message=message,
                jobs_count=jobs_count,
            )
        except Exception as exc:
            raise PrinterError("offline", f"Printer '{printer_name}' tidak ditemukan atau tidak dapat diakses.") from exc
        finally:
            if handle is not None:
                with suppress(Exception):
                    w32print.ClosePrinter(handle)

    def print_image(
        self,
        image_path: Path,
        printer_name: str,
        copies: int = 1,
        orientation: str = "portrait",
    ) -> None:
        w32print, w32ui, w32con = self._require_pywin32()

        if copies < 1:
            raise PrinterError("invalid_copies", "Jumlah salinan cetak minimal 1.")
        if not image_path.is_file():
            raise PrinterError("missing_output", "File output 300 DPI tidak ditemukan.")

        status_info = self.get_printer_status(printer_name)
        if status_info.status in ("offline", "paper_out", "error"):
            raise PrinterError(status_info.status, status_info.status_message)

        handle = None
        hdc = None
        raw_dc_handle = None
        doc_started = False

        try:
            devmode = None
            try:
                handle = w32print.OpenPrinter(printer_name)
                printer_info = w32print.GetPrinter(handle, 2)
                devmode = printer_info.get("pDevMode")
                if devmode is not None:
                    devmode.Orientation = (
                        w32con.DMORIENT_LANDSCAPE
                        if orientation == "landscape"
                        else w32con.DMORIENT_PORTRAIT
                    )
                    devmode.Copies = 1
            except Exception:
                devmode = None

            if win32gui is not None and devmode is not None:
                try:
                    raw_dc_handle = win32gui.CreateDC("WINSPOOL", printer_name, devmode)
                    hdc = w32ui.CreateDCFromHandle(raw_dc_handle)
                except Exception:
                    raw_dc_handle = None
                    hdc = None

            if hdc is None:
                hdc = w32ui.CreateDC()
                hdc.CreatePrinterDC(printer_name)

            printable_w = max(1, int(hdc.GetDeviceCaps(w32con.HORZRES)))
            printable_h = max(1, int(hdc.GetDeviceCaps(w32con.VERTRES)))

            with Image.open(image_path) as raw_img:
                img = raw_img.convert("RGB")
                # Rotate 90 deg if physical paper printable box orientation differs from image
                if (printable_w > printable_h) != (img.width > img.height):
                    img = img.rotate(90, expand=True)

                scale = min(printable_w / img.width, printable_h / img.height)
                draw_w = max(1, int(round(img.width * scale)))
                draw_h = max(1, int(round(img.height * scale)))
                offset_x = max(0, (printable_w - draw_w) // 2)
                offset_y = max(0, (printable_h - draw_h) // 2)

                dib = ImageWin.Dib(img)
                hdc.StartDoc(f"Omah Ndog Studio - {image_path.name}")
                doc_started = True
                for _ in range(copies):
                    hdc.StartPage()
                    dib.draw(
                        hdc.GetHandleOutput(),
                        (offset_x, offset_y, offset_x + draw_w, offset_y + draw_h),
                    )
                    hdc.EndPage()
        except PrinterError:
            raise
        except Exception as exc:
            raise PrinterError("spooler_error", f"Gagal mengirim ke printer '{printer_name}': {exc}") from exc
        finally:
            if doc_started and hdc is not None:
                with suppress(Exception):
                    hdc.EndDoc()
            if hdc is not None:
                with suppress(Exception):
                    hdc.DeleteDC()
            elif raw_dc_handle is not None and win32gui is not None:
                with suppress(Exception):
                    win32gui.DeleteDC(raw_dc_handle)
            if handle is not None:
                with suppress(Exception):
                    w32print.ClosePrinter(handle)


@dataclass(frozen=True)
class RecordedPrintJob:
    """In-memory record of a print invocation captured by MockPrinterBackend."""

    image_path: Path
    printer_name: str
    copies: int
    orientation: str
    image_size: tuple[int, int]
    image_dpi: Any


class MockPrinterBackend(PrinterBackend):
    """Thread-safe mock printer backend for automated testing and non-Windows dev."""

    def __init__(self, printer_names: tuple[str, ...] = ("Mock Photo Printer",)) -> None:
        self._lock = threading.Lock()
        self._printer_names = list(printer_names)
        self._mode: PrinterStatusLiteral = "ready"
        self._message = "Printer simulasi siap digunakan."
        self.printed_jobs: list[RecordedPrintJob] = []

    def set_mode(self, mode: PrinterStatusLiteral, message: str = "") -> None:
        """Configure simulated printer health state."""
        with self._lock:
            self._mode = mode
            if message:
                self._message = message
            elif mode == "offline":
                self._message = "Printer simulasi sedang offline."
            elif mode == "paper_out":
                self._message = "Kertas printer simulasi habis."
            elif mode == "error":
                self._message = "Printer simulasi mengalami error."
            else:
                self._message = "Printer simulasi siap digunakan."

    def list_printers(self) -> list[PrinterStatusInfo]:
        with self._lock:
            return [
                PrinterStatusInfo(
                    name=name,
                    is_default=(idx == 0),
                    status=self._mode,
                    status_message=self._message,
                    jobs_count=0,
                )
                for idx, name in enumerate(self._printer_names)
            ]

    def get_printer_status(self, printer_name: str) -> PrinterStatusInfo:
        with self._lock:
            if printer_name not in self._printer_names:
                raise PrinterError("offline", f"Printer '{printer_name}' tidak ditemukan.")
            return PrinterStatusInfo(
                name=printer_name,
                is_default=(printer_name == self._printer_names[0]),
                status=self._mode,
                status_message=self._message,
                jobs_count=0,
            )

    def print_image(
        self,
        image_path: Path,
        printer_name: str,
        copies: int = 1,
        orientation: str = "portrait",
    ) -> None:
        if copies < 1:
            raise PrinterError("invalid_copies", "Jumlah salinan minimal 1.")
        if not image_path.is_file():
            raise PrinterError("missing_output", "File output 300 DPI tidak ditemukan.")

        with self._lock:
            if printer_name not in self._printer_names:
                raise PrinterError("offline", f"Printer '{printer_name}' tidak tersedia.")
            if self._mode in ("offline", "paper_out", "error"):
                raise PrinterError(self._mode, self._message)

            with Image.open(image_path) as img:
                size = img.size
                dpi = img.info.get("dpi")

            self.printed_jobs.append(
                RecordedPrintJob(
                    image_path=image_path,
                    printer_name=printer_name,
                    copies=copies,
                    orientation=orientation,
                    image_size=size,
                    image_dpi=dpi,
                )
            )


def create_default_printer_backend() -> PrinterBackend:
    """Create the appropriate printer backend for the current runtime environment."""
    if os.getenv("STUDIO_MOCK_PRINTER", "").strip() == "1":
        return MockPrinterBackend()
    if sys.platform == "win32" and _HAS_PYWIN32:
        return WindowsSpoolerPrinter()
    return MockPrinterBackend()
