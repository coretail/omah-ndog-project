import { SelectedPhotoSlot } from "../api/client";

export interface SessionDraft {
  selectedCategoryId: number | null;
  selectedFrameId: number | null;
  selectedPhotos: Record<string, SelectedPhotoSlot>;
  copies: number;
  kioskOrigin: boolean;
  qrTargetUrl: string;
  qrMode: "tunnel" | "lan";
  lastJobId: number | null;
}

const DEFAULT_DRAFT: SessionDraft = {
  selectedCategoryId: null,
  selectedFrameId: null,
  selectedPhotos: {},
  copies: 1,
  kioskOrigin: false,
  qrTargetUrl: "",
  qrMode: "lan",
  lastJobId: null,
};

function storageKey(token: string): string {
  return `omah_ndog_draft_${token}`;
}

export function loadDraft(token: string): SessionDraft {
  try {
    const raw = sessionStorage.getItem(storageKey(token));
    if (!raw) return { ...DEFAULT_DRAFT, selectedPhotos: {} };
    const parsed = JSON.parse(raw) as Partial<SessionDraft>;
    return {
      selectedCategoryId: parsed.selectedCategoryId ?? null,
      selectedFrameId: parsed.selectedFrameId ?? null,
      selectedPhotos: parsed.selectedPhotos ? { ...parsed.selectedPhotos } : {},
      copies:
        typeof parsed.copies === "number" && parsed.copies >= 1
          ? Math.min(20, Math.floor(parsed.copies))
          : 1,
      kioskOrigin: Boolean(parsed.kioskOrigin),
      qrTargetUrl: typeof parsed.qrTargetUrl === "string" ? parsed.qrTargetUrl : "",
      qrMode: parsed.qrMode === "tunnel" ? "tunnel" : "lan",
      lastJobId: typeof parsed.lastJobId === "number" ? parsed.lastJobId : null,
    };
  } catch {
    return { ...DEFAULT_DRAFT, selectedPhotos: {} };
  }
}

export function saveDraft(token: string, patch: Partial<SessionDraft>): SessionDraft {
  const current = loadDraft(token);
  const next: SessionDraft = {
    ...current,
    ...patch,
    selectedPhotos: patch.selectedPhotos
      ? { ...patch.selectedPhotos }
      : { ...current.selectedPhotos },
  };
  try {
    sessionStorage.setItem(storageKey(token), JSON.stringify(next));
  } catch {
    // Ignore quota/private-mode storage failures
  }
  return next;
}

export function resetDesignDraft(token: string): SessionDraft {
  return saveDraft(token, {
    selectedFrameId: null,
    selectedPhotos: {},
    copies: 1,
    lastJobId: null,
  });
}

export function clearDraft(token: string): void {
  try {
    sessionStorage.removeItem(storageKey(token));
  } catch {
    // Ignore storage failures
  }
}

export function formatRupiah(amount: number): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}
