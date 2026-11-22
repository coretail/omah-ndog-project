import { useEffect, useState } from "react";
import { ArrowLeft, Camera, Wifi } from "lucide-react";
import { photosApi, sessionsApi } from "../api/client";
import { loadDraft } from "../utils/draftStorage";

interface QrPageProps {
  token: string;
  onBack: () => void;
  onNext: () => void;
}

export function QrPage({ token, onBack, onNext }: QrPageProps) {
  const [photoCount, setPhotoCount] = useState<number | null>(null);
  const [subfolderName, setSubfolderName] = useState<string>("");
  const draft = loadDraft(token);

  useEffect(() => {
    let cancelled = false;

    async function pollPhotos() {
      try {
        const res = await photosApi.listPhotos(token);
        if (!cancelled) {
          setPhotoCount(res.photos.length);
          setSubfolderName(res.subfolder);
        }
      } catch {
        if (!cancelled) {
          setPhotoCount((prev) => prev);
        }
      }
    }

    void pollPhotos();
    const timer = window.setInterval(() => void pollPhotos(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token]);

  return (
    <div
      className="studio-bg"
      style={{
        minHeight: "100vh",
        padding: "28px 24px 48px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div>
        <button
          type="button"
          className="back-arrow-btn"
          aria-label="Kembali"
          onClick={onBack}
        >
          <ArrowLeft size={30} />
        </button>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 22,
          textAlign: "center",
          maxWidth: 540,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: 44,
            padding: 28,
            width: "min(360px, 82vw)",
            aspectRatio: "1 / 1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <img
            src={sessionsApi.getQrImageUrl(token)}
            alt="QR Code Pilih Foto dari HP"
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        </div>

        <p
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            lineHeight: 1.4,
            maxWidth: 420,
          }}
        >
          Scan QR buat memilih Frame, dan Foto dari HP kalian masing masing
        </p>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              backgroundColor: "rgba(255,255,255,0.85)",
              borderRadius: 999,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Camera size={16} color="var(--brand-blue)" />
            <span>
              {photoCount === null
                ? "Memeriksa folder foto..."
                : `${photoCount} foto siap dipilih${subfolderName ? ` (${subfolderName})` : ""}`}
            </span>
          </span>

          <span
            style={{
              backgroundColor: "rgba(255,255,255,0.85)",
              borderRadius: 999,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Wifi size={16} color="var(--accent-orange-red)" />
            <span>{draft.qrMode === "tunnel" ? "Mode Tunnel Publik" : "Mode Wi-Fi Studio (LAN)"}</span>
          </span>
        </div>

        {draft.qrTargetUrl && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              backgroundColor: "rgba(255,255,255,0.65)",
              padding: "6px 14px",
              borderRadius: 12,
              wordBreak: "break-all",
              maxWidth: "100%",
            }}
          >
            {draft.qrTargetUrl}
          </div>
        )}

        <button
          type="button"
          className="pill-btn-orange"
          onClick={onNext}
          style={{
            minWidth: 280,
            minHeight: 58,
            color: "#ffffff",
            fontSize: 28,
            marginTop: 4,
          }}
        >
          NEXT
        </button>
      </div>
    </div>
  );
}
