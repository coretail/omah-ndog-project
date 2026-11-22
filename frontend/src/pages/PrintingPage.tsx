import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Printer } from "lucide-react";
import { ApiError, PrintJobStatus, printsApi, sessionsApi } from "../api/client";
import { SessionUnavailableView } from "../components/SessionUnavailableView";
import { clearDraft, loadDraft, resetDesignDraft } from "../utils/draftStorage";

interface PrintingPageProps {
  token: string;
  onBackToPreview: () => void;
  onPrintAgain: () => void;
  onGoHome: () => void;
}

const STATUS_LABELS: Record<PrintJobStatus["status"], string> = {
  queued: "Menunggu Antrean Cetak",
  printing: "Sedang Mencetak...",
  printed: "Selesai Dicetak",
  failed: "Gagal Mencetak — Hubungi Operator",
  cancelled: "Dibatalkan",
};

export function PrintingPage({
  token,
  onBackToPreview,
  onPrintAgain,
  onGoHome,
}: PrintingPageProps) {
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<PrintJobStatus | null>(null);
  const [finishedMobile, setFinishedMobile] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const draft = loadDraft(token);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function checkState() {
      try {
        await sessionsApi.getSession(token);
        if (draft.lastJobId !== null) {
          const st = await printsApi.getJobStatus(token, draft.lastJobId);
          if (!cancelled) {
            setJobStatus(st);
            if ((st.status === "printed" || st.status === "cancelled") && timer !== null) {
              window.clearInterval(timer);
              timer = null;
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setSessionError(
            err instanceof ApiError
              ? err.message
              : "Sesi tidak ditemukan atau sudah berakhir."
          );
        }
      }
    }

    void checkState();
    if (draft.lastJobId !== null) {
      timer = window.setInterval(() => void checkState(), 3000);
    }
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [token, draft.lastJobId]);

  if (finishedMobile) {
    return (
      <div className="studio-bg" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: 28,
            padding: 36,
            maxWidth: 460,
            textAlign: "center",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <CheckCircle2 size={54} color="#16a34a" style={{ marginBottom: 12 }} />
          <h2 className="studio-heading" style={{ fontSize: 30, marginBottom: 10 }}>
            Terima Kasih!
          </h2>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>
            Sesi pemilihan foto Anda telah selesai. Silakan ambil hasil cetak Anda di kasir studio.
          </p>
        </div>
      </div>
    );
  }

  if (sessionError) {
    return (
      <SessionUnavailableView
        message={sessionError}
        onGoHome={draft.kioskOrigin ? onGoHome : undefined}
      />
    );
  }

  function handlePrintAgain() {
    resetDesignDraft(token);
    onPrintAgain();
  }

  async function handleFinish() {
    if (!draft.kioskOrigin) {
      if (
        !window.confirm(
          "Tandai selesai di HP ini? Teman lain yang masih memilih foto di HP mereka tetap bisa melanjutkan."
        )
      ) {
        return;
      }
      clearDraft(token);
      setFinishedMobile(true);
      return;
    }

    if (
      !window.confirm(
        "Akhiri seluruh sesi sekarang? QR Code tidak akan bisa dipakai lagi oleh perangkat mana pun."
      )
    ) {
      return;
    }
    setFinishing(true);
    try {
      await sessionsApi.completeSession(token);
      clearDraft(token);
      onGoHome();
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        clearDraft(token);
        onGoHome();
      }
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div
      className="studio-bg"
      style={{
        minHeight: "100vh",
        padding: "24px 24px 48px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div>
        <button
          type="button"
          className="back-arrow-btn"
          aria-label="Kembali ke Last Preview"
          onClick={onBackToPreview}
        >
          <ArrowLeft size={28} />
        </button>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: 22,
          maxWidth: 760,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "clamp(30px, 4vw, 44px)", fontWeight: 700, lineHeight: 1.2 }}>
          Foto dalam
          <br />
          Proses Cetak
        </h1>

        <p style={{ margin: 0, fontSize: "clamp(16px, 2vw, 20px)", fontWeight: 700, lineHeight: 1.45 }}>
          Masih mau tambah cetak dengan design lain?
          <br />
          Tenang saja, langsung klik Cetak lagi
        </p>

        <div
          style={{
            backgroundColor:
              jobStatus?.status === "failed" ? "#fee2e2" : "rgba(255,255,255,0.9)",
            color: jobStatus?.status === "failed" ? "#991b1b" : "inherit",
            borderRadius: 999,
            padding: "10px 20px",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          <Printer
            size={18}
            color={jobStatus?.status === "failed" ? "#991b1b" : "var(--brand-blue)"}
          />
          <span>
            {jobStatus
              ? jobStatus.status === "failed" && jobStatus.error_message
                ? `${STATUS_LABELS.failed}: ${jobStatus.error_message}`
                : STATUS_LABELS[jobStatus.status]
              : "Pesanan desain Anda telah dicatat untuk diproses"}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: 20,
            flexWrap: "wrap",
            justifyContent: "center",
            width: "100%",
            marginTop: 8,
          }}
        >
          <button
            type="button"
            className="pill-btn-orange"
            onClick={handlePrintAgain}
            style={{ minWidth: 250 }}
          >
            Cetak lagi
          </button>

          <button
            type="button"
            className="pill-btn-orange"
            disabled={finishing}
            onClick={() => void handleFinish()}
            style={{ minWidth: 250 }}
          >
            {finishing ? "Menutup..." : "Selesai"}
          </button>
        </div>
      </div>
    </div>
  );
}
