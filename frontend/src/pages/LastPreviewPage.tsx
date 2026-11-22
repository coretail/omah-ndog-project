import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  ApiError,
  FrameCategory,
  FrameItem,
  PhotoItem,
  framesApi,
  photosApi,
  printsApi,
  sessionsApi,
} from "../api/client";
import { FrameCompositePreview } from "../components/FrameCompositePreview";
import { SessionUnavailableView } from "../components/SessionUnavailableView";
import { formatRupiah, loadDraft, saveDraft } from "../utils/draftStorage";

interface LastPreviewPageProps {
  token: string;
  onBackToPhoto: () => void;
  onPrinted: () => void;
  onGoHome: () => void;
}

export function LastPreviewPage({
  token,
  onBackToPhoto,
  onPrinted,
  onGoHome,
}: LastPreviewPageProps) {
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [frame, setFrame] = useState<FrameItem | null>(null);
  const [category, setCategory] = useState<FrameCategory | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [copies, setCopies] = useState<number>(() => loadDraft(token).copies);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        await sessionsApi.getSession(token);
        const draft = loadDraft(token);
        const [cats, allFrames, photoRes] = await Promise.all([
          framesApi.listCategories(),
          framesApi.listFrames(draft.selectedCategoryId ?? undefined),
          photosApi.listPhotos(token),
        ]);
        if (cancelled) return;
        const chosenFrame =
          allFrames.find((f) => f.id === draft.selectedFrameId) ?? allFrames[0] ?? null;
        if (!chosenFrame) {
          onBackToPhoto();
          return;
        }
        setFrame(chosenFrame);
        setCategory(cats.find((c) => c.id === chosenFrame.category_id) ?? null);
        setPhotos(photoRes.photos);
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
  }, [token, onBackToPhoto]);

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

  const draft = loadDraft(token);
  const unitPrice = category?.price ?? 0;
  const totalPrice = unitPrice * copies;

  function adjustCopies(delta: number) {
    setCopies((prev) => {
      const next = Math.max(1, Math.min(20, prev + delta));
      saveDraft(token, { copies: next });
      return next;
    });
  }

  async function handlePrint() {
    if (!frame) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const selectedList = frame.slots
        .map((s) => draft.selectedPhotos[s.id])
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      const job = await printsApi.submitJob(token, {
        frame_id: frame.id,
        copies,
        selected_photos: selectedList,
      });

      saveDraft(token, {
        copies,
        lastJobId: job?.id ?? null,
      });
      onPrinted();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal mengirim permintaan cetak.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="studio-bg" style={{ padding: "24px clamp(16px, 4vw, 56px) 48px" }}>
      <div style={{ maxWidth: 1260, margin: "0 auto" }}>
        <div style={{ marginBottom: 12 }}>
          <button
            type="button"
            className="back-arrow-btn"
            aria-label="Kembali ke Pilih Foto"
            onClick={onBackToPhoto}
          >
            <ArrowLeft size={28} />
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, fontWeight: 700, fontSize: 18 }}>
            Menyiapkan Last Preview...
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 40,
              alignItems: "center",
            }}
          >
            {/* Left: Last Preview */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
              <h1 className="studio-heading" style={{ fontSize: "clamp(32px, 4vw, 48px)", textAlign: "center" }}>
                Last Preview
              </h1>
              <div style={{ width: "100%", maxWidth: 420 }}>
                <FrameCompositePreview
                  frame={frame}
                  selectedPhotos={draft.selectedPhotos}
                  photoMap={photoMap}
                  maxHeight={560}
                />
              </div>
            </div>

            {/* Right: Copies Stepper & Print CTA */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 22,
                textAlign: "center",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "clamp(26px, 3vw, 38px)", fontWeight: 700 }}>
                Cetak berapa banyak nih?
              </h2>

              <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
                <button
                  type="button"
                  aria-label="Kurangi jumlah cetak"
                  onClick={() => adjustCopies(-1)}
                  disabled={copies <= 1}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: 42,
                    fontWeight: 700,
                    padding: "8px 14px",
                    opacity: copies <= 1 ? 0.35 : 1,
                  }}
                >
                  -
                </button>

                <div
                  style={{
                    width: 132,
                    height: 122,
                    borderRadius: 18,
                    backgroundColor: "var(--accent-orange)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 40,
                    fontWeight: 700,
                    boxShadow: "0 8px 20px rgba(0,0,0,0.14)",
                  }}
                >
                  {String(copies).padStart(2, "0")}
                </div>

                <button
                  type="button"
                  aria-label="Tambah jumlah cetak"
                  onClick={() => adjustCopies(1)}
                  disabled={copies >= 20}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: 42,
                    fontWeight: 700,
                    padding: "8px 14px",
                    opacity: copies >= 20 ? 0.35 : 1,
                  }}
                >
                  +
                </button>
              </div>

              <p style={{ margin: 0, maxWidth: 420, fontSize: 15, fontWeight: 700, lineHeight: 1.45 }}>
                Jumlah foto yang dicetak, berarti menggunakan design dan layout yang sama dengan
                yang sudah di setup
              </p>

              {category && (
                <div
                  style={{
                    backgroundColor: "rgba(255,255,255,0.88)",
                    borderRadius: 16,
                    padding: "10px 22px",
                    fontWeight: 700,
                    fontSize: 16,
                  }}
                >
                  {category.name} · {copies} lbr × {formatRupiah(unitPrice)} ={" "}
                  <span style={{ color: "var(--brand-blue)" }}>{formatRupiah(totalPrice)}</span>
                </div>
              )}

              {errorMsg && (
                <div
                  role="alert"
                  style={{
                    backgroundColor: "#fee2e2",
                    color: "#991b1b",
                    padding: "10px 14px",
                    borderRadius: 12,
                    fontWeight: 700,
                  }}
                >
                  {errorMsg}
                </div>
              )}

              <button
                type="button"
                className="pill-btn-orange"
                disabled={submitting || !frame}
                onClick={handlePrint}
                style={{ width: "100%", maxWidth: 340 }}
              >
                {submitting ? "Memproses..." : "Cetak"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
