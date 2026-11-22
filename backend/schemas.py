from __future__ import annotations

import json
import math
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _validate_clean_filename(value: str) -> str:
    if not value or value != value.strip():
        raise ValueError("Filename must not be empty or contain leading/trailing whitespace.")
    forbidden = ("/", "\\", "..", ":", "\x00")
    if any(part in value for part in forbidden) or value in (".", ".."):
        raise ValueError("Filename must be a plain file name without path separators.")
    return value


class FrameSlotSchema(BaseModel):
    """Axis-aligned rectangular photo slot coordinates stored in percentages (0..100)."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    xPct: float = Field(ge=0.0, lt=100.0)
    yPct: float = Field(ge=0.0, lt=100.0)
    wPct: float = Field(gt=0.0, le=100.0)
    hPct: float = Field(gt=0.0, le=100.0)
    locked: bool = False

    @field_validator("id")
    @classmethod
    def _clean_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Slot id must not be blank.")
        return cleaned

    @model_validator(mode="after")
    def _check_bounds(self) -> FrameSlotSchema:
        for num in (self.xPct, self.yPct, self.wPct, self.hPct):
            if not math.isfinite(num):
                raise ValueError("Slot coordinates must be finite numbers.")
        if self.xPct + self.wPct > 100.0 + 1e-6:
            raise ValueError("xPct + wPct must not exceed 100.")
        if self.yPct + self.hPct > 100.0 + 1e-6:
            raise ValueError("yPct + hPct must not exceed 100.")
        return self


MAX_SLOTS_PER_FRAME = 32


def validate_slots_json(raw: str | list[dict[str, Any]]) -> list[FrameSlotSchema]:
    """Parse and validate frame slots payload, enforcing unique slot IDs and max count."""
    data = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(data, list):
        raise ValueError("slots_json must be a JSON array.")
    if len(data) > MAX_SLOTS_PER_FRAME:
        raise ValueError(f"Maximum {MAX_SLOTS_PER_FRAME} slots allowed per frame.")
    slots = [FrameSlotSchema.model_validate(item) for item in data]
    seen: set[str] = set()
    for slot in slots:
        if slot.id in seen:
            raise ValueError(f"Duplicate slot id: {slot.id}")
        seen.add(slot.id)
    return slots


class SelectedPhotoSlotSchema(BaseModel):
    """Customer photo assignment and crop offsets for a single frame slot."""

    model_config = ConfigDict(extra="forbid")

    slotId: str = Field(min_length=1, max_length=64)
    filename: str = Field(min_length=1, max_length=255)
    offsetX: float = Field(default=0.0, ge=-1.0, le=1.0)
    offsetY: float = Field(default=0.0, ge=-1.0, le=1.0)
    zoom: float = Field(default=1.0, ge=1.0, le=3.0)

    @field_validator("slotId")
    @classmethod
    def _clean_slot_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("slotId must not be blank.")
        return cleaned

    @field_validator("filename")
    @classmethod
    def _validate_filename(cls, value: str) -> str:
        return _validate_clean_filename(value)

    @model_validator(mode="after")
    def _check_finite(self) -> SelectedPhotoSlotSchema:
        for num in (self.offsetX, self.offsetY, self.zoom):
            if not math.isfinite(num):
                raise ValueError("Crop adjustments must be finite numbers.")
        return self


def validate_selected_photos_json(
    raw: str | list[dict[str, Any]],
) -> list[SelectedPhotoSlotSchema]:
    """Parse and validate selected_photos_json payload, enforcing unique slotId values."""
    data = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(data, list):
        raise ValueError("selected_photos_json must be a JSON array.")
    items = [SelectedPhotoSlotSchema.model_validate(item) for item in data]
    seen: set[str] = set()
    for item in items:
        if item.slotId in seen:
            raise ValueError(f"Duplicate slotId in selection: {item.slotId}")
        seen.add(item.slotId)
    return items


def _validate_pin_format(value: str) -> str:
    if not value or value != value.strip() or any(ch.isspace() for ch in value):
        raise ValueError("PIN must not contain spaces.")
    if len(value) < 4 or len(value) > 32:
        raise ValueError("PIN length must be between 4 and 32 characters.")
    return value


class PinSetupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pin: str = Field(min_length=4, max_length=32)

    @field_validator("pin")
    @classmethod
    def _check_pin(cls, value: str) -> str:
        return _validate_pin_format(value)


class PinLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pin: str = Field(min_length=1, max_length=64)


class PinChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_pin: str = Field(min_length=1, max_length=64)
    new_pin: str = Field(min_length=4, max_length=32)

    @field_validator("new_pin")
    @classmethod
    def _check_new_pin(cls, value: str) -> str:
        return _validate_pin_format(value)


class AdminAuthStatusResponse(BaseModel):
    pin_configured: bool
    authenticated: bool
    locked_seconds_remaining: int = 0


class AdminLoginResponse(BaseModel):
    token: str
    expires_at: str


class SettingsResponse(BaseModel):
    photo_root_dir: str
    active_subfolder: str
    folder_mode: Literal["active", "auto_create"]
    public_base_url: str
    auto_print_enabled: bool
    printer_name: str
    retention_days: int
    session_ttl_hours: int
    lan_ip: str


class SettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    photo_root_dir: str | None = None
    active_subfolder: str | None = None
    folder_mode: Literal["active", "auto_create"] | None = None
    public_base_url: str | None = None
    auto_print_enabled: bool | None = None
    printer_name: str | None = None
    retention_days: int | None = Field(default=None, ge=1, le=365)
    session_ttl_hours: int | None = Field(default=None, ge=1, le=168)

    @field_validator("public_base_url")
    @classmethod
    def _validate_public_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip().rstrip("/")
        if not cleaned:
            return ""
        parsed = urlsplit(cleaned)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("public_base_url must be a valid http:// or https:// URL.")
        return cleaned

    @field_validator("active_subfolder")
    @classmethod
    def _validate_subfolder(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return ""
        return _validate_clean_filename(cleaned)


class BrowseFolderResponse(BaseModel):
    path: str | None


class SessionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    whatsapp: str = Field(min_length=6, max_length=30)
    email: str = Field(min_length=5, max_length=120)
    consent_accepted: bool
    filter_after_created_at: bool = False

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Name is required.")
        return cleaned

    @field_validator("whatsapp")
    @classmethod
    def _validate_whatsapp(cls, value: str) -> str:
        cleaned = value.strip()
        digits = [ch for ch in cleaned if ch.isdigit()]
        allowed_chars = set("0123456789+ -")
        if len(digits) < 6 or any(ch not in allowed_chars for ch in cleaned):
            raise ValueError("Invalid WhatsApp number.")
        return cleaned

    @field_validator("email")
    @classmethod
    def _validate_email(cls, value: str) -> str:
        cleaned = value.strip()
        if " " in cleaned or cleaned.count("@") != 1:
            raise ValueError("Invalid email address.")
        local, domain = cleaned.split("@", 1)
        if not local or "." not in domain or domain.startswith(".") or domain.endswith("."):
            raise ValueError("Invalid email address.")
        return cleaned

    @field_validator("consent_accepted")
    @classmethod
    def _require_consent(cls, value: bool) -> bool:
        if not value:
            raise ValueError("Privacy consent must be accepted.")
        return value


class SessionResponse(BaseModel):
    id: int
    token: str
    name: str
    whatsapp: str
    email: str
    photo_subfolder: str
    status: Literal["active", "completed"]
    qr_target_url: str
    qr_mode: Literal["tunnel", "lan"]
    expires_at: str
    created_at: str


class SessionPublicInfoResponse(BaseModel):
    id: int
    name: str
    photo_subfolder: str
    status: Literal["active", "completed"]
    expires_at: str
    created_at: str


class SessionCompleteResponse(BaseModel):
    id: int
    status: Literal["completed"]


class HealthResponse(BaseModel):
    status: str
    database_journal_mode: str


class FrameCategoryCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    price: int = Field(ge=0, le=10_000_000)
    width_mm: float = Field(gt=0.0, le=1000.0)
    height_mm: float = Field(gt=0.0, le=1000.0)
    orientation: Literal["portrait", "landscape"] = "portrait"
    safe_margin_mm: float = Field(default=0.0, ge=0.0, le=50.0)
    sort_order: int = Field(default=0, ge=0, le=1000)

    @field_validator("name")
    @classmethod
    def _clean_cat_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Category name is required.")
        return cleaned


class FrameCategoryUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=40)
    price: int | None = Field(default=None, ge=0, le=10_000_000)
    width_mm: float | None = Field(default=None, gt=0.0, le=1000.0)
    height_mm: float | None = Field(default=None, gt=0.0, le=1000.0)
    orientation: Literal["portrait", "landscape"] | None = None
    safe_margin_mm: float | None = Field(default=None, ge=0.0, le=50.0)
    sort_order: int | None = Field(default=None, ge=0, le=1000)

    @field_validator("name")
    @classmethod
    def _clean_opt_cat_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Category name must not be blank.")
        return cleaned


class FrameCategoryResponse(BaseModel):
    id: int
    name: str
    price: int
    width_mm: float
    height_mm: float
    orientation: Literal["portrait", "landscape"]
    safe_margin_mm: float
    sort_order: int


class FrameSlotsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slots: list[FrameSlotSchema] = Field(max_length=MAX_SLOTS_PER_FRAME)

    @field_validator("slots")
    @classmethod
    def _unique_slot_ids(cls, value: list[FrameSlotSchema]) -> list[FrameSlotSchema]:
        seen: set[str] = set()
        for slot in value:
            if slot.id in seen:
                raise ValueError(f"Duplicate slot id: {slot.id}")
            seen.add(slot.id)
        return value


class FrameResponse(BaseModel):
    id: int
    category_id: int
    name: str
    image_url: str
    canvas_width: int
    canvas_height: int
    slots: list[FrameSlotSchema]
    created_at: str


class SubfolderInfoResponse(BaseModel):
    name: str
    photo_count: int
    used_by_sessions: int


class SubfolderCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)

    @field_validator("name")
    @classmethod
    def _clean_subfolder_name(cls, value: str) -> str:
        return _validate_clean_filename(value.strip())


class PhotoItemResponse(BaseModel):
    filename: str
    width: int
    height: int
    size_bytes: int
    modified_at: str
    thumb_url: str
    preview_url: str


class SessionPhotoListResponse(BaseModel):
    subfolder: str
    photos: list[PhotoItemResponse]
