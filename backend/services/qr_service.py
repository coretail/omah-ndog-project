from __future__ import annotations

import io
import socket
from typing import Literal

import qrcode


def detect_lan_ip() -> str:
    """Detect local outbound LAN IPv4 address without sending network traffic."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        ip = str(sock.getsockname()[0])
        if ip and not ip.startswith("0."):
            return ip
    except OSError:
        pass
    finally:
        sock.close()
    return "127.0.0.1"


def build_qr_target_url(
    session_token: str,
    public_base_url: str,
    port: int,
) -> tuple[str, Literal["tunnel", "lan"]]:
    """Build session URL preferring configured tunnel URL, with LAN IP fallback."""
    cleaned_base = public_base_url.strip().rstrip("/")
    if cleaned_base:
        return f"{cleaned_base}/s/{session_token}", "tunnel"

    lan_ip = detect_lan_ip()
    return f"http://{lan_ip}:{port}/s/{session_token}", "lan"


def generate_qr_png_bytes(url: str) -> bytes:
    """Render a PNG QR code image for the target session URL."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()
