from __future__ import annotations

import hashlib
import hmac
import ipaddress
import math
import secrets
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, status

from backend.config import AppConfig

_TUNNEL_HEADERS = ("cf-connecting-ip", "true-client-ip", "cf-visitor")
_FORWARDED_HEADERS = ("x-forwarded-for", "x-real-ip")

_LOOPBACK_NETS = (
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
)
_LAN_NETS = (
    *_LOOPBACK_NETS,
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
)


def hash_pin(pin: str, salt: bytes | None = None) -> tuple[str, str]:
    """Hash a PIN with PBKDF2-HMAC-SHA256 and a random 16-byte salt."""
    salt_bytes = salt if salt is not None else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt_bytes, 200_000)
    return digest.hex(), salt_bytes.hex()


def verify_pin(pin: str, stored_hash_hex: str, stored_salt_hex: str) -> bool:
    """Verify a plaintext PIN against stored hex digest and salt in constant time."""
    if not pin or not stored_hash_hex or not stored_salt_hex:
        return False
    try:
        salt_bytes = bytes.fromhex(stored_salt_hex)
    except ValueError:
        return False
    computed_hex, _ = hash_pin(pin, salt_bytes)
    return hmac.compare_digest(computed_hex, stored_hash_hex)


def _parse_ip(host: str | None) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    if not host:
        return None
    cleaned = host.strip()
    if cleaned.startswith("[") and "]" in cleaned:
        cleaned = cleaned[1 : cleaned.index("]")]
    if "%" in cleaned:
        cleaned = cleaned.split("%", 1)[0]
    try:
        addr = ipaddress.ip_address(cleaned)
    except ValueError:
        return None
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        return addr.ipv4_mapped
    return addr


def is_loopback_ip(host: str | None, *, allow_testclient: bool = False) -> bool:
    """Return True if host is a loopback address."""
    if allow_testclient and host == "testclient":
        return True
    addr = _parse_ip(host)
    if addr is None:
        return False
    return any(addr in net for net in _LOOPBACK_NETS)


def is_lan_or_loopback_ip(host: str | None, *, allow_testclient: bool = False) -> bool:
    """Return True if host is a loopback or private RFC1918/LAN address."""
    if allow_testclient and host == "testclient":
        return True
    addr = _parse_ip(host)
    if addr is None:
        return False
    return any(addr in net for net in _LAN_NETS)


def get_app_config(request: Request) -> AppConfig:
    """Retrieve AppConfig attached to FastAPI app state."""
    return request.app.state.config


def get_client_ip(request: Request) -> str:
    """Extract raw client IP from ASGI request scope."""
    if request.client and request.client.host:
        return request.client.host
    return ""


def require_lan_no_tunnel(request: Request) -> str:
    """Allow only direct localhost/LAN requests and reject tunnel/public proxy traffic."""
    for header in _TUNNEL_HEADERS:
        if header in request.headers:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin access is blocked through external tunnels.",
            )

    for header in _FORWARDED_HEADERS:
        raw_val = request.headers.get(header)
        if raw_val is not None:
            hops = [part.strip() for part in raw_val.split(",") if part.strip()]
            if not hops or not all(is_lan_or_loopback_ip(hop) for hop in hops):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Admin access is blocked through public proxies.",
                )

    config = get_app_config(request)
    client_ip = get_client_ip(request)
    if not is_lan_or_loopback_ip(client_ip, allow_testclient=config.testing):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access is restricted to localhost or studio LAN.",
        )
    return client_ip


def require_localhost_only(request: Request) -> str:
    """Allow only direct loopback requests with no forwarding or tunnel headers."""
    for header in (*_TUNNEL_HEADERS, *_FORWARDED_HEADERS):
        if header in request.headers:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This operation is restricted to direct localhost access.",
            )

    config = get_app_config(request)
    client_ip = get_client_ip(request)
    if not is_loopback_ip(client_ip, allow_testclient=config.testing):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This operation is restricted to localhost.",
        )
    return client_ip


class PinLockoutTracker:
    """Thread-safe per-IP failed PIN attempt tracker with timed lockout."""

    def __init__(self, max_attempts: int = 5, lockout_seconds: int = 900) -> None:
        self._max_attempts = max_attempts
        self._lockout_seconds = lockout_seconds
        self._lock = threading.Lock()
        self._failures: dict[str, int] = {}
        self._locked_until: dict[str, float] = {}

    def check_locked(self, ip: str) -> int:
        """Return remaining lockout seconds for IP, or 0 if not locked."""
        now = time.monotonic()
        with self._lock:
            until = self._locked_until.get(ip)
            if until is None:
                return 0
            if now >= until:
                self._locked_until.pop(ip, None)
                self._failures.pop(ip, None)
                return 0
            return max(1, int(math.ceil(until - now)))

    def record_failure(self, ip: str) -> tuple[int, int]:
        """Record a failed attempt. Returns (remaining_attempts, lockout_seconds)."""
        now = time.monotonic()
        with self._lock:
            until = self._locked_until.get(ip)
            if until is not None and now < until:
                return 0, max(1, int(math.ceil(until - now)))
            if until is not None and now >= until:
                self._locked_until.pop(ip, None)
                self._failures.pop(ip, None)

            attempts = self._failures.get(ip, 0) + 1
            self._failures[ip] = attempts
            if attempts >= self._max_attempts:
                self._locked_until[ip] = now + self._lockout_seconds
                self._failures[ip] = 0
                return 0, self._lockout_seconds
            return self._max_attempts - attempts, 0

    def reset(self, ip: str) -> None:
        """Clear failure counter and lockout state on successful authentication."""
        with self._lock:
            self._failures.pop(ip, None)
            self._locked_until.pop(ip, None)


class AdminSessionStore:
    """In-memory store of active admin bearer session hashes."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: dict[str, datetime] = {}

    @staticmethod
    def _digest(raw_value: str) -> str:
        return hashlib.sha256(raw_value.encode("utf-8")).hexdigest()

    def issue(self, ttl_hours: int) -> tuple[str, datetime]:
        """Generate and store a new high-entropy admin session bearer value."""
        raw_value = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
        digest = self._digest(raw_value)
        with self._lock:
            self._purge_expired_locked()
            self._entries[digest] = expires_at
        return raw_value, expires_at

    def validate(self, raw_value: str) -> bool:
        """Check if bearer value exists and is not expired."""
        if not raw_value:
            return False
        digest = self._digest(raw_value)
        now = datetime.now(timezone.utc)
        with self._lock:
            expires_at = self._entries.get(digest)
            if expires_at is None:
                return False
            if now >= expires_at:
                self._entries.pop(digest, None)
                return False
            return True

    def revoke(self, raw_value: str) -> None:
        """Invalidate a single admin session."""
        if not raw_value:
            return
        digest = self._digest(raw_value)
        with self._lock:
            self._entries.pop(digest, None)

    def revoke_all(self) -> None:
        """Invalidate all active admin sessions."""
        with self._lock:
            self._entries.clear()

    def _purge_expired_locked(self) -> None:
        now = datetime.now(timezone.utc)
        expired = [k for k, exp in self._entries.items() if now >= exp]
        for key in expired:
            self._entries.pop(key, None)


def extract_bearer_value(request: Request) -> str | None:
    """Extract bearer credential from Authorization header."""
    header = request.headers.get("authorization")
    if not header:
        return None
    scheme, _, credential = header.partition(" ")
    if scheme.lower() != "bearer":
        return None
    cleaned = credential.strip()
    return cleaned or None


def require_admin_auth(request: Request) -> str:
    """FastAPI dependency enforcing LAN/no-tunnel guard and valid admin bearer session."""
    require_lan_no_tunnel(request)
    raw_value = extract_bearer_value(request)
    store: AdminSessionStore = request.app.state.admin_sessions
    if not raw_value or not store.validate(raw_value):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return raw_value


class SlidingWindowRateLimiter:
    """Thread-safe sliding window rate limiter keyed by client IP."""

    def __init__(self, max_requests: int = 60, window_seconds: int = 60) -> None:
        self._max_requests = max_requests
        self._window_seconds = window_seconds
        self._lock = threading.Lock()
        self._buckets: dict[str, deque[float]] = {}

    def check(self, key: str) -> tuple[bool, int]:
        """Check and record one request for key. Returns (allowed, retry_after_seconds)."""
        now = time.monotonic()
        cutoff = now - self._window_seconds
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = deque()
                self._buckets[key] = bucket
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self._max_requests:
                retry_after = max(1, int(math.ceil(bucket[0] + self._window_seconds - now)))
                return False, retry_after
            bucket.append(now)
            return True, 0


def rate_limit_public(request: Request) -> None:
    """FastAPI dependency applying per-IP rate limiting to public customer endpoints."""
    cf_ip = request.headers.get("cf-connecting-ip", "").strip()
    if cf_ip:
        client_key = cf_ip
    else:
        xff = request.headers.get("x-forwarded-for", "")
        first_hop = xff.split(",", 1)[0].strip() if xff else ""
        client_key = first_hop or get_client_ip(request) or "unknown"

    limiter: SlidingWindowRateLimiter = request.app.state.public_rate_limiter
    allowed, retry_after = limiter.check(client_key)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please slow down.",
            headers={"Retry-After": str(retry_after)},
        )
