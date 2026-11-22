export interface FrameSlot {
  id: string;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  locked: boolean;
}

export type Orientation = "portrait" | "landscape";

export interface FrameCategory {
  id: number;
  name: string;
  price: number;
  width_mm: number;
  height_mm: number;
  orientation: Orientation;
  safe_margin_mm: number;
  sort_order: number;
}

export interface FrameItem {
  id: number;
  category_id: number;
  name: string;
  image_url: string;
  canvas_width: number;
  canvas_height: number;
  slots: FrameSlot[];
  created_at: string;
}

export interface AdminAuthStatus {
  pin_configured: boolean;
  authenticated: boolean;
  locked_seconds_remaining: number;
}

export interface AdminLoginResult {
  token: string;
  expires_at: string;
}

export interface StudioSettings {
  photo_root_dir: string;
  active_subfolder: string;
  folder_mode: "active" | "auto_create";
  filter_photos_after_registration: boolean;
  public_base_url: string;
  auto_print_enabled: boolean;
  printer_name: string;
  retention_days: number;
  session_ttl_hours: number;
  lan_ip: string;
}

export interface SubfolderInfo {
  name: string;
  photo_count: number;
  used_by_sessions: number;
}

export class ApiError extends Error {
  status: number;
  retryAfter?: number;

  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const ADMIN_SESSION_STORAGE_KEY = "omah_ndog_admin_session";

export function getStoredAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAdminToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  requireAuth = false
): Promise<T> {
  const headers = new Headers(options.headers);
  if (requireAuth) {
    const token = getStoredAdminToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  if (!(options.body instanceof FormData) && options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let detail = `Request gagal (${response.status})`;
    try {
      const errBody = (await response.json()) as { detail?: unknown };
      if (typeof errBody.detail === "string") {
        detail = errBody.detail;
      } else if (Array.isArray(errBody.detail)) {
        detail = errBody.detail
          .map((item: { msg?: string }) => item.msg ?? JSON.stringify(item))
          .join("; ");
      }
    } catch {
      // Fallback to generic message
    }
    const retryHeader = response.headers.get("Retry-After");
    const retryAfter = retryHeader ? Number.parseInt(retryHeader, 10) : undefined;
    throw new ApiError(response.status, detail, Number.isFinite(retryAfter) ? retryAfter : undefined);
  }

  return (await response.json()) as T;
}

export const adminApi = {
  getAuthStatus(): Promise<AdminAuthStatus> {
    return requestJson<AdminAuthStatus>("/api/admin/auth/status", {}, true);
  },

  setupPin(pin: string): Promise<AdminLoginResult> {
    return requestJson<AdminLoginResult>("/api/admin/auth/setup", {
      method: "POST",
      body: JSON.stringify({ pin }),
    });
  },

  login(pin: string): Promise<AdminLoginResult> {
    return requestJson<AdminLoginResult>("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ pin }),
    });
  },

  logout(): Promise<{ status: string }> {
    return requestJson<{ status: string }>("/api/admin/auth/logout", { method: "POST" }, true);
  },

  getSettings(): Promise<StudioSettings> {
    return requestJson<StudioSettings>("/api/admin/settings", {}, true);
  },

  updateSettings(payload: Partial<Omit<StudioSettings, "lan_ip">>): Promise<StudioSettings> {
    return requestJson<StudioSettings>(
      "/api/admin/settings",
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
      true
    );
  },

  browseFolder(): Promise<{ path: string | null }> {
    return requestJson<{ path: string | null }>(
      "/api/admin/browse-folder",
      { method: "POST" },
      true
    );
  },

  listSubfolders(): Promise<SubfolderInfo[]> {
    return requestJson<SubfolderInfo[]>("/api/admin/subfolders", {}, true);
  },

  createSubfolder(name: string): Promise<SubfolderInfo> {
    return requestJson<SubfolderInfo>(
      "/api/admin/subfolders",
      {
        method: "POST",
        body: JSON.stringify({ name }),
      },
      true
    );
  },
};

export const framesApi = {
  listCategories(): Promise<FrameCategory[]> {
    return requestJson<FrameCategory[]>("/api/frames/categories");
  },

  createCategory(payload: {
    name: string;
    price: number;
    width_mm: number;
    height_mm: number;
    orientation: Orientation;
    safe_margin_mm: number;
    sort_order: number;
  }): Promise<FrameCategory> {
    return requestJson<FrameCategory>(
      "/api/frames/categories",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      true
    );
  },

  updateCategory(
    categoryId: number,
    payload: Partial<{
      name: string;
      price: number;
      width_mm: number;
      height_mm: number;
      orientation: Orientation;
      safe_margin_mm: number;
      sort_order: number;
    }>
  ): Promise<FrameCategory> {
    return requestJson<FrameCategory>(
      `/api/frames/categories/${categoryId}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
      true
    );
  },

  deleteCategory(categoryId: number): Promise<{ status: string }> {
    return requestJson<{ status: string }>(
      `/api/frames/categories/${categoryId}`,
      { method: "DELETE" },
      true
    );
  },

  listFrames(categoryId?: number): Promise<FrameItem[]> {
    const query = categoryId !== undefined ? `?category_id=${categoryId}` : "";
    return requestJson<FrameItem[]>(`/api/frames${query}`);
  },

  uploadFrame(categoryId: number, name: string, file: File): Promise<FrameItem> {
    const form = new FormData();
    form.append("category_id", String(categoryId));
    form.append("name", name);
    form.append("file", file);
    return requestJson<FrameItem>(
      "/api/frames",
      {
        method: "POST",
        body: form,
      },
      true
    );
  },

  updateSlots(frameId: number, slots: FrameSlot[]): Promise<FrameItem> {
    return requestJson<FrameItem>(
      `/api/frames/${frameId}/slots`,
      {
        method: "PUT",
        body: JSON.stringify({ slots }),
      },
      true
    );
  },

  deleteFrame(frameId: number): Promise<{ status: string }> {
    return requestJson<{ status: string }>(
      `/api/frames/${frameId}`,
      { method: "DELETE" },
      true
    );
  },
};

export interface CustomerSessionCreate {
  name: string;
  whatsapp: string;
  email: string;
  consent_accepted: boolean;
  filter_after_created_at?: boolean;
}

export interface CustomerSession {
  id: number;
  token: string;
  name: string;
  whatsapp: string;
  email: string;
  photo_subfolder: string;
  status: "active" | "completed";
  qr_target_url: string;
  qr_mode: "tunnel" | "lan";
  expires_at: string;
  created_at: string;
}

export interface SessionPublicInfo {
  id: number;
  name: string;
  photo_subfolder: string;
  status: "active" | "completed";
  expires_at: string;
  created_at: string;
}

export interface PhotoItem {
  filename: string;
  width: number;
  height: number;
  size_bytes: number;
  modified_at: string;
  thumb_url: string;
  preview_url: string;
}

export interface SessionPhotoList {
  subfolder: string;
  photos: PhotoItem[];
}

export interface SelectedPhotoSlot {
  slotId: string;
  filename: string;
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface SubmitPrintJobRequest {
  frame_id: number;
  copies: number;
  selected_photos: SelectedPhotoSlot[];
}

export interface PrintJobStatus {
  id: number;
  status: "queued" | "printing" | "printed" | "failed" | "cancelled";
  copies: number;
  total_price: number;
  error_message: string;
}

export const sessionsApi = {
  createSession(payload: CustomerSessionCreate): Promise<CustomerSession> {
    return requestJson<CustomerSession>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getSession(token: string): Promise<SessionPublicInfo> {
    return requestJson<SessionPublicInfo>(`/api/sessions/${encodeURIComponent(token)}`);
  },

  completeSession(token: string): Promise<{ id: number; status: "completed" }> {
    return requestJson<{ id: number; status: "completed" }>(
      `/api/sessions/${encodeURIComponent(token)}/complete`,
      { method: "POST" }
    );
  },

  getQrImageUrl(token: string): string {
    return `/api/sessions/${encodeURIComponent(token)}/qr`;
  },
};

export const photosApi = {
  listPhotos(token: string): Promise<SessionPhotoList> {
    return requestJson<SessionPhotoList>(`/api/photos/${encodeURIComponent(token)}`);
  },
};

export const printsApi = {
  async submitJob(
    token: string,
    payload: SubmitPrintJobRequest
  ): Promise<PrintJobStatus | null> {
    try {
      return await requestJson<PrintJobStatus>(`/api/prints/${encodeURIComponent(token)}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  },

  async getJobStatus(token: string, jobId: number): Promise<PrintJobStatus | null> {
    try {
      return await requestJson<PrintJobStatus>(
        `/api/prints/${encodeURIComponent(token)}/${jobId}`
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  },
};
