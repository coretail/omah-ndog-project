import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ApiError, FrameCategory, FrameItem, framesApi, sessionsApi } from "../api/client";
import { FrameCompositePreview } from "../components/FrameCompositePreview";
import { SessionUnavailableView } from "../components/SessionUnavailableView";
import { formatRupiah } from "../utils/format";
import { loadDraft, saveDraft } from "../utils/draftStorage";

interface SelectFramePageProps {
  token: string;
  onSelectPhoto: () => void;
  onBackToQr?: () => void;
  onGoHome: () => void;
}

export function SelectFramePage({
  token,
  onSelectPhoto,
  onBackToQr,
  onGoHome,
}: SelectFramePageProps) {
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [categories, setCategories] = useState<FrameCategory[]>([]);
  const [frames, setFrames] = useState<FrameItem[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<number | null>(() => loadDraft(token).selectedCategoryId);
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(() => loadDraft(token).selectedFrameId);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        await sessionsApi.getSession(token);
        const cats = await framesApi.listCategories();
        if (cancelled) return;
        setCategories(cats);
        const draft = loadDraft(token);
        const initialCat =
          cats.find((c) => c.id === draft.selectedCategoryId)?.id ?? cats[0]?.id ?? null;
        setSelectedCatId(initialCat);
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
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (selectedCatId === null) {
      setFrames([]);
      return;
    }
    let cancelled = false;
    framesApi
      .listFrames(selectedCatId)
      .then((list) => {
        if (cancelled) return;
        setFrames(list);
        const draft = loadDraft(token);
        const validSaved = list.find((f) => f.id === draft.selectedFrameId)?.id ?? null;
        setSelectedFrameId((prev) =>
          prev && list.some((f) => f.id === prev) ? prev : validSaved ?? list[0]?.id ?? null
        );
      })
      .catch(() => {
        if (!cancelled) setFrames([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCatId, token]);

  if (sessionError) {
    return (
      <SessionUnavailableView
        message={sessionError}
        onGoHome={loadDraft(token).kioskOrigin ? onGoHome : undefined}
      />
    );
  }

  const activeCategory = categories.find((c) => c.id === selectedCatId) ?? null;
  const activeFrame = frames.find((f) => f.id === selectedFrameId) ?? null;
  const draft = loadDraft(token);

  function handleSelectCategory(catId: number) {
    setSelectedCatId(catId);
    setSelectedFrameId(null);
    saveDraft(token, {
      selectedCategoryId: catId,
      selectedFrameId: null,
      selectedPhotos: {},
    });
  }

  function handleSelectFrame(frameId: number) {
    setSelectedFrameId(frameId);
    const prevFrameId = loadDraft(token).selectedFrameId;
    saveDraft(token, {
      selectedCategoryId: selectedCatId,
      selectedFrameId: frameId,
      ...(prevFrameId !== frameId ? { selectedPhotos: {} } : {}),
    });
  }

  function handleContinue() {
    if (!activeFrame || selectedCatId === null) return;
    saveDraft(token, {
      selectedCategoryId: selectedCatId,
      selectedFrameId: activeFrame.id,
    });
    onSelectPhoto();
  }

  return (
    <div className="studio-bg" style={{ padding: "24px clamp(16px, 4vw, 56px) 48px" }}>
      <div style={{ maxWidth: 1380, margin: "0 auto" }}>
        {/* Header */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div style={{ width: 52 }}>
            {draft.kioskOrigin && onBackToQr && (
              <button
                type="button"
                className="back-arrow-btn"
                aria-label="Kembali ke QR"
                onClick={onBackToQr}
              >
                <ArrowLeft size={28} />
              </button>
            )}
          </div>
          <h1 className="studio-heading" style={{ fontSize: "clamp(32px, 4vw, 48px)", textAlign: "center" }}>
            Pilih Frame
          </h1>
          <div style={{ width: 52 }} />
        </header>

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, fontWeight: 700, fontSize: 18 }}>
            Memuat pilihan frame...
          </div>
        ) : (
          <div className="studio-split-layout">
            {/* Left Column: Price, Categories, Frame Grid */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#ffffff", textShadow: "0 1px 2px rgba(0,0,0,0.25)" }}>
                  Harga
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#ffffff", textShadow: "0 1px 3px rgba(0,0,0,0.25)" }}>
                  {activeCategory ? `${formatRupiah(activeCategory.price)} / lbr` : "-"}
                </div>
              </div>

              {/* Category Pill Bar */}
              <div
                style={{
                  backgroundColor: "var(--accent-orange-red)",
                  borderRadius: 16,
                  padding: "8px 12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                  alignSelf: "flex-start",
                  maxWidth: "100%",
                }}
              >
                {categories.map((cat) => {
                  const isActive = cat.id === selectedCatId;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => handleSelectCategory(cat.id)}
                      style={{
                        border: "none",
                        borderRadius: 14,
                        padding: "8px 16px",
                        fontWeight: 700,
                        fontSize: "clamp(16px, 2vw, 22px)",
                        color: "#ffffff",
                        backgroundColor: isActive ? "var(--accent-yellow)" : "transparent",
                        textShadow: isActive ? "0 1px 2px rgba(0,0,0,0.2)" : "none",
                      }}
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>

              {/* Pink Panel Grid */}
              <div
                style={{
                  backgroundColor: "var(--panel-pink)",
                  borderRadius: 16,
                  padding: 20,
                  boxShadow: "var(--shadow-card)",
                  minHeight: 360,
                  maxHeight: 560,
                  overflowY: "auto",
                }}
              >
                {frames.length === 0 ? (
                  <div
                    style={{
                      padding: 40,
                      textAlign: "center",
                      fontWeight: 700,
                      color: "var(--text-muted)",
                    }}
                  >
                    Belum ada template frame untuk kategori ini.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                      gap: 18,
                    }}
                  >
                    {frames.map((frame) => {
                      const isSelected = frame.id === selectedFrameId;
                      return (
                        <button
                          key={frame.id}
                          type="button"
                          onClick={() => handleSelectFrame(frame.id)}
                          style={{
                            border: isSelected
                              ? "4px solid var(--brand-blue)"
                              : "2px solid rgba(0,0,0,0.08)",
                            borderRadius: 12,
                            backgroundColor: "#ffffff",
                            padding: 8,
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            alignItems: "center",
                            boxShadow: isSelected
                              ? "0 6px 18px rgba(1, 67, 161, 0.28)"
                              : "none",
                          }}
                        >
                          <div
                            style={{
                              width: "100%",
                              height: 195,
                              backgroundColor: "#676767",
                              borderRadius: 6,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              overflow: "hidden",
                            }}
                          >
                            <img
                              src={frame.image_url}
                              alt={frame.name}
                              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                            />
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-dark)" }}>
                            {frame.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Preview + Pilih Foto Button */}
            <div
              className="preview-column-sticky"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 20,
              }}
            >
              <h2 className="studio-heading" style={{ fontSize: "clamp(30px, 3.6vw, 44px)", textAlign: "center" }}>
                Preview
              </h2>

              <div style={{ width: "100%", maxWidth: 360 }}>
                <FrameCompositePreview
                  frame={activeFrame}
                  selectedPhotos={draft.selectedPhotos}
                  maxHeight={460}
                />
              </div>

              <button
                type="button"
                className="pill-btn-orange"
                disabled={!activeFrame}
                onClick={handleContinue}
                style={{ width: "100%", maxWidth: 340 }}
              >
                Pilih Foto
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
