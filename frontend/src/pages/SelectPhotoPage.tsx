import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import {
  ApiError,
  FrameItem,
  PhotoItem,
  SelectedPhotoSlot,
  framesApi,
  photosApi,
  sessionsApi,
} from "../api/client";
import { FrameCompositePreview } from "../components/FrameCompositePreview";
import { SessionUnavailableView } from "../components/SessionUnavailableView";
import { loadDraft, saveDraft } from "../utils/draftStorage";

interface SelectPhotoPageProps {
  token: string;
  onBackToFrame: () => void;
  onNextPreview: () => void;
  onGoHome: () => void;
}

export function SelectPhotoPage({
  token,
  onBackToFrame,
  onNextPreview,
  onGoHome,
}: SelectPhotoPageProps) {
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [frame, setFrame] = useState<FrameItem | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<Record<string, SelectedPhotoSlot>>(
    () => loadDraft(token).selectedPhotos
  );
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const fetchPhotos = useCallback(async () => {
    try {
      const res = await photosApi.listPhotos(token);
      setPhotos(res.photos);
      setPhotoError(null);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        setSessionError(err.message);
      } else {
        setPhotoError(
          err instanceof Error ? err.message : "Belum ada foto tersedia di folder sesi."
        );
      }
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        await sessionsApi.getSession(token);
        const draft = loadDraft(token);
        const allFrames = await framesApi.listFrames(draft.selectedCategoryId ?? undefined);
        const chosen =
          allFrames.find((f) => f.id === draft.selectedFrameId) ?? allFrames[0] ?? null;
        if (!chosen) {
          onBackToFrame();
          return;
        }
        if (cancelled) return;
        setFrame(chosen);
        setActiveSlotId(chosen.slots[0]?.id ?? null);
        await fetchPhotos();
      } catch (err) {
        if (!cancelled) {
          setSessionError(
            err instanceof ApiError
              ? err.message
              : "Sesi tidak ditemukan atau sudah berakhir."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    const timer = window.setInterval(() => void fetchPhotos(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, fetchPhotos, onBackToFrame]);

  const photoMap = useMemo(() => {
    const map: Record<string, PhotoItem> = {};
    for (const item of photos) {
      map[item.filename] = item;
    }
    return map;
  }, [photos]);

  if (sessionError) {
    return (
      <SessionUnavailableView
        message={sessionError}
        onGoHome={loadDraft(token).kioskOrigin ? onGoHome : undefined}
      />
    );
  }

  const slots = frame?.slots ?? [];
  const filledCount = slots.filter((s) => Boolean(selectedPhotos[s.id])).length;
  const allSlotsFilled = slots.length === 0 || filledCount === slots.length;

  function persistSelection(nextMap: Record<string, SelectedPhotoSlot>) {
    setSelectedPhotos(nextMap);
    saveDraft(token, { selectedPhotos: nextMap });
  }

  function handlePickPhoto(filename: string) {
    if (!frame || slots.length === 0) return;

    const targetSlotId =
      activeSlotId && slots.some((s) => s.id === activeSlotId)
        ? activeSlotId
        : slots.find((s) => !selectedPhotos[s.id])?.id ?? slots[0].id;

    const nextMap: Record<string, SelectedPhotoSlot> = {
      ...selectedPhotos,
      [targetSlotId]: {
        slotId: targetSlotId,
        filename,
        offsetX: 0,
        offsetY: 0,
        zoom: 1,
      },
    };
    persistSelection(nextMap);

    // Advance active slot to next unfilled slot for smooth multi-slot selection
    const nextEmpty = slots.find((s) => s.id !== targetSlotId && !nextMap[s.id]);
    if (nextEmpty) {
      setActiveSlotId(nextEmpty.id);
    }
  }

  function updateActiveSlotAdjustment(patch: Partial<Pick<SelectedPhotoSlot, "offsetX" | "offsetY" | "zoom">>) {
    if (!activeSlotId) return;
    const current = selectedPhotos[activeSlotId];
    if (!current) return;
    persistSelection({
      ...selectedPhotos,
      [activeSlotId]: { ...current, ...patch },
    });
  }

  function clearActiveSlot() {
    if (!activeSlotId || !selectedPhotos[activeSlotId]) return;
    const copy = { ...selectedPhotos };
    delete copy[activeSlotId];
    persistSelection(copy);
  }

  const activeAssignment = activeSlotId ? selectedPhotos[activeSlotId] ?? null : null;

  return (
    <div className="studio-bg" style={{ padding: "24px clamp(16px, 4vw, 56px) 48px" }}>
      <div style={{ maxWidth: 1380, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <button
            type="button"
            className="back-arrow-btn"
            aria-label="Kembali ke Pilih Frame"
            onClick={onBackToFrame}
          >
            <ArrowLeft size={28} />
          </button>
          <h1 className="studio-heading" style={{ fontSize: "clamp(32px, 4vw, 48px)", textAlign: "center" }}>
            Pilih Foto
          </h1>
          <button
            type="button"
            className="back-arrow-btn"
            title="Muat ulang daftar foto"
            aria-label="Muat ulang daftar foto"
            onClick={() => void fetchPhotos()}
          >
            <RefreshCw size={22} />
          </button>
        </header>

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, fontWeight: 700, fontSize: 18 }}>
            Memuat foto studio...
          </div>
        ) : (
          <div className="studio-split-layout">
            {/* Left Column: Photo Grid */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <p style={{ margin: 0, fontSize: "clamp(16px, 2vw, 22px)", fontWeight: 700 }}>
                  Silahkan Pilih Foto terlebih dahulu
                </p>
                <span
                  style={{
                    backgroundColor: allSlotsFilled ? "#dcfce7" : "#ffffff",
                    color: allSlotsFilled ? "#166534" : "var(--brand-blue)",
                    padding: "6px 14px",
                    borderRadius: 999,
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {slots.length === 0
                    ? "Frame tanpa slot foto"
                    : `${filledCount} / ${slots.length} slot terisi`}
                </span>
              </div>

              <div
                style={{
                  backgroundColor: "var(--panel-pink)",
                  borderRadius: 16,
                  padding: 20,
                  boxShadow: "var(--shadow-card)",
                  minHeight: 360,
                  maxHeight: 580,
                  overflowY: "auto",
                }}
              >
                {photoError && photos.length === 0 ? (
                  <div style={{ padding: 36, textAlign: "center", fontWeight: 700, color: "#7f1d1d" }}>
                    {photoError}
                  </div>
                ) : photos.length === 0 ? (
                  <div style={{ padding: 36, textAlign: "center", fontWeight: 700, color: "var(--text-muted)" }}>
                    Belum ada foto di folder sesi. Foto yang baru disalin dari kamera akan muncul otomatis di sini.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                      gap: 14,
                    }}
                  >
                    {photos.map((photo) => {
                      const assignedIndices = slots
                        .map((s, i) => (selectedPhotos[s.id]?.filename === photo.filename ? i + 1 : null))
                        .filter((v): v is number => v !== null);
                      const isUsed = assignedIndices.length > 0;

                      return (
                        <button
                          key={photo.filename}
                          type="button"
                          onClick={() => handlePickPhoto(photo.filename)}
                          style={{
                            position: "relative",
                            padding: 0,
                            border: isUsed ? "4px solid var(--brand-blue)" : "2px solid transparent",
                            borderRadius: 10,
                            overflow: "hidden",
                            backgroundColor: "#676767",
                            aspectRatio: "3 / 4",
                            boxShadow: isUsed ? "0 6px 16px rgba(1, 67, 161, 0.3)" : "none",
                          }}
                        >
                          <img
                            src={photo.thumb_url}
                            alt={photo.filename}
                            loading="lazy"
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              display: "block",
                            }}
                          />
                          {isUsed && (
                            <span
                              style={{
                                position: "absolute",
                                top: 6,
                                right: 6,
                                backgroundColor: "var(--brand-blue)",
                                color: "#ffffff",
                                borderRadius: 999,
                                padding: "3px 8px",
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              Slot #{assignedIndices.join(", #")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Live Composite Preview & Crop Controls */}
            <div
              className="preview-column-sticky"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16,
              }}
            >
              <h2 className="studio-heading" style={{ fontSize: "clamp(30px, 3.6vw, 44px)", textAlign: "center" }}>
                Preview
              </h2>

              <div style={{ width: "100%", maxWidth: 360 }}>
                <FrameCompositePreview
                  frame={frame}
                  selectedPhotos={selectedPhotos}
                  photoMap={photoMap}
                  activeSlotId={activeSlotId}
                  onSelectSlot={setActiveSlotId}
                  interactive
                  maxHeight={430}
                />
              </div>

              {activeAssignment && (
                <div
                  style={{
                    width: "100%",
                    maxWidth: 360,
                    backgroundColor: "rgba(255,255,255,0.92)",
                    borderRadius: 14,
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Atur Slot Aktif</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        title="Reset posisi"
                        onClick={() => updateActiveSlotAdjustment({ offsetX: 0, offsetY: 0, zoom: 1 })}
                        style={miniBtnStyle}
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        type="button"
                        title="Kosongkan slot"
                        onClick={clearActiveSlot}
                        style={{ ...miniBtnStyle, color: "#dc2626" }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <label style={sliderLabelStyle}>
                    <span>Zoom ({activeAssignment.zoom.toFixed(1)}×)</span>
                    <input
                      type="range"
                      min={1}
                      max={2.5}
                      step={0.1}
                      value={activeAssignment.zoom}
                      onChange={(e) =>
                        updateActiveSlotAdjustment({ zoom: Number.parseFloat(e.target.value) })
                      }
                    />
                  </label>
                  <label style={sliderLabelStyle}>
                    <span>Geser Kiri/Kanan</span>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.05}
                      value={activeAssignment.offsetX}
                      onChange={(e) =>
                        updateActiveSlotAdjustment({ offsetX: Number.parseFloat(e.target.value) })
                      }
                    />
                  </label>
                  <label style={sliderLabelStyle}>
                    <span>Geser Atas/Bawah</span>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.05}
                      value={activeAssignment.offsetY}
                      onChange={(e) =>
                        updateActiveSlotAdjustment({ offsetY: Number.parseFloat(e.target.value) })
                      }
                    />
                  </label>
                </div>
              )}

              <button
                type="button"
                className="pill-btn-orange"
                disabled={!allSlotsFilled}
                onClick={onNextPreview}
                style={{ width: "100%", maxWidth: 340 }}
              >
                Cetak
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const miniBtnStyle = {
  border: "1px solid #d4d4d4",
  backgroundColor: "#ffffff",
  borderRadius: 8,
  padding: "4px 8px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const sliderLabelStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};
