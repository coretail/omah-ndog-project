import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Download,
  Printer,
  RefreshCw,
  RotateCcw,
  XCircle,
} from "lucide-react";
import {
  AdminPrintJob,
  PrintJobStatus,
  PrinterInfo,
  StudioSettings,
  adminApi,
  fetchAuthenticatedBlob,
  printsApi,
} from "../api/client";
import { formatRupiah } from "../utils/draftStorage";

interface PrintQueuePanelProps {
  settings: StudioSettings | null;
  onSettingsUpdated: (updated: StudioSettings) => void;
  onAuthFailure: (err: unknown) => boolean;
  onFeedback: (msg: { type: "ok" | "err"; text: string }) => void;
}

const JOB_STATUS_META: Record<
  PrintJobStatus["status"],
  { label: string; bg: string; fg: string }
> = {
  queued: { label: "Menunggu", bg: "#fef3c7", fg: "#92400e" },
  printing: { label: "Mencetak...", bg: "#dbeafe", fg: "#1e40af" },
  printed: { label: "Tercetak", bg: "#dcfce7", fg: "#166534" },
  failed: { label: "Gagal", bg: "#fee2e2", fg: "#991b1b" },
  cancelled: { label: "Dibatalkan", bg: "#f3f4f6", fg: "#4b5563" },
};

const PRINTER_STATUS_META: Record<
  PrinterInfo["status"],
  { label: string; bg: string; fg: string }
> = {
  ready: { label: "Siap", bg: "#dcfce7", fg: "#166534" },
  busy: { label: "Sibuk", bg: "#dbeafe", fg: "#1e40af" },
  offline: { label: "Offline", bg: "#fee2e2", fg: "#991b1b" },
  paper_out: { label: "Kertas Habis", bg: "#fee2e2", fg: "#991b1b" },
  error: { label: "Error", bg: "#fee2e2", fg: "#991b1b" },
  unknown: { label: "Tidak Diketahui", bg: "#f3f4f6", fg: "#4b5563" },
};

function AuthenticatedOutputThumbnail({
  previewUrl,
  alt,
  onAuthFailure,
}: {
  previewUrl: string | null;
  alt: string;
  onAuthFailure: (err: unknown) => boolean;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!previewUrl) {
      setBlobUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;

    fetchAuthenticatedBlob(previewUrl)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((err) => {
        if (!cancelled) {
          onAuthFailure(err);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [previewUrl, onAuthFailure]);

  if (!blobUrl) {
    return (
      <div
        style={{
          width: 68,
          height: 88,
          borderRadius: 10,
          backgroundColor: "#f3f4f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          color: "#6b7280",
          flexShrink: 0,
        }}
      >
        300 DPI
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={alt}
      style={{
        width: 68,
        height: 88,
        objectFit: "contain",
        borderRadius: 10,
        backgroundColor: "#f9fafb",
        border: "1px solid #e5e7eb",
        flexShrink: 0,
      }}
    />
  );
}

export function PrintQueuePanel({
  settings,
  onSettingsUpdated,
  onAuthFailure,
  onFeedback,
}: PrintQueuePanelProps) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerNameInput, setPrinterNameInput] = useState(settings?.printer_name ?? "");
  const [autoPrintInput, setAutoPrintInput] = useState(settings?.auto_print_enabled ?? false);
  const [savingPrinter, setSavingPrinter] = useState(false);

  const [jobs, setJobs] = useState<AdminPrintJob[]>([]);
  const [statusFilter, setStatusFilter] = useState<PrintJobStatus["status"] | "all">("all");
  const [busyJobId, setBusyJobId] = useState<number | null>(null);

  useEffect(() => {
    if (settings) {
      setPrinterNameInput(settings.printer_name);
      setAutoPrintInput(settings.auto_print_enabled);
    }
  }, [settings]);

  const loadPrinters = useCallback(async () => {
    try {
      const list = await printsApi.listPrinters();
      setPrinters(list);
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal memuat daftar printer.",
        });
      }
    }
  }, [onAuthFailure, onFeedback]);

  const loadQueue = useCallback(async () => {
    try {
      const list = await printsApi.listQueue(statusFilter === "all" ? undefined : statusFilter);
      setJobs(list);
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal memuat antrean cetak.",
        });
      }
    }
  }, [statusFilter, onAuthFailure, onFeedback]);

  useEffect(() => {
    void loadPrinters();
  }, [loadPrinters]);

  useEffect(() => {
    void loadQueue();
    const timer = window.setInterval(() => {
      void loadQueue();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadQueue]);

  async function handleSavePrinterSettings(e: FormEvent) {
    e.preventDefault();
    setSavingPrinter(true);
    try {
      const updated = await adminApi.updateSettings({
        printer_name: printerNameInput,
        auto_print_enabled: autoPrintInput,
      });
      onSettingsUpdated(updated);
      onFeedback({ type: "ok", text: "Pengaturan printer & mode cetak tersimpan." });
      void loadPrinters();
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal menyimpan pengaturan printer.",
        });
      }
    } finally {
      setSavingPrinter(false);
    }
  }

  async function handleJobAction(
    jobId: number,
    action: "print" | "retry" | "cancel"
  ) {
    if (
      action === "cancel" &&
      !window.confirm(`Batalkan antrean cetak #${jobId}?`)
    ) {
      return;
    }
    setBusyJobId(jobId);
    try {
      const updated =
        action === "print"
          ? await printsApi.triggerPrint(jobId)
          : action === "retry"
            ? await printsApi.retryJob(jobId)
            : await printsApi.cancelJob(jobId);
      setJobs((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      onFeedback({
        type: "ok",
        text:
          action === "cancel"
            ? `Job #${jobId} dibatalkan.`
            : `Job #${jobId} dikirim ke printer.`,
      });
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Aksi cetak gagal.",
        });
      }
    } finally {
      setBusyJobId(null);
    }
  }

  async function handleDownload(job: AdminPrintJob) {
    if (!job.download_url) return;
    try {
      const blob = await fetchAuthenticatedBlob(job.download_url);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `print_job_${job.id}.jpg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal mengunduh file 300 DPI.",
        });
      }
    }
  }

  const activePrinterInfo =
    printers.find((p) => p.name === printerNameInput) ??
    printers.find((p) => p.is_default) ??
    null;
  const activePrinterMeta = activePrinterInfo
    ? PRINTER_STATUS_META[activePrinterInfo.status]
    : null;

  return (
    <section>
      <h2 style={{ margin: "0 0 10px", fontSize: 28, fontWeight: 700 }}>
        Print Queue &amp; Pengaturan Printer
      </h2>

      <div
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.92)",
          borderRadius: 20,
          padding: 20,
          maxWidth: 1010,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {/* Printer Selector & Auto-Print Toggle */}
        <form
          onSubmit={handleSavePrinterSettings}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            paddingBottom: 16,
            borderBottom: "2px solid #f0f0f0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Printer size={22} color="var(--brand-blue)" />
            <label style={{ fontWeight: 700, fontSize: 14 }}>Printer Target:</label>
            <select
              value={printerNameInput}
              onChange={(e) => setPrinterNameInput(e.target.value)}
              style={{
                flex: 1,
                minWidth: 240,
                padding: "9px 12px",
                borderRadius: 12,
                border: "2px solid #d4d4d4",
                fontWeight: 600,
              }}
            >
              <option value="">-- Gunakan Default Printer Windows --</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.is_default ? " (Default)" : ""} — {PRINTER_STATUS_META[p.status].label}
                </option>
              ))}
            </select>

            {activePrinterMeta && activePrinterInfo && (
              <span
                title={activePrinterInfo.status_message}
                style={{
                  backgroundColor: activePrinterMeta.bg,
                  color: activePrinterMeta.fg,
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {activePrinterMeta.label}
              </span>
            )}

            <button
              type="button"
              onClick={() => void loadPrinters()}
              title="Refresh Status Printer"
              style={{
                border: "2px solid #d4d4d4",
                borderRadius: 12,
                padding: "8px 12px",
                backgroundColor: "#ffffff",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <RefreshCw size={15} />
              <span>Cek Printer</span>
            </button>

            <button
              type="submit"
              disabled={savingPrinter}
              style={{
                border: "none",
                borderRadius: 12,
                padding: "10px 18px",
                backgroundColor: "var(--accent-orange)",
                color: "#ffffff",
                fontWeight: 700,
              }}
            >
              {savingPrinter ? "Menyimpan..." : "Simpan Printer"}
            </button>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={autoPrintInput}
              onChange={(e) => setAutoPrintInput(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "var(--brand-blue)" }}
            />
            <span>
              Auto-Print aktif (langsung kirim ke printer saat customer menekan Cetak; matikan untuk
              mode Manual Print Queue)
            </span>
          </label>
        </form>

        {/* Queue Filter & Refresh */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 16 }}>Daftar Antrean Cetak ({jobs.length})</strong>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as PrintJobStatus["status"] | "all")
            }
            style={{
              marginLeft: "auto",
              padding: "7px 12px",
              borderRadius: 10,
              border: "2px solid #d4d4d4",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            <option value="all">Semua Status</option>
            <option value="queued">Menunggu (Queued)</option>
            <option value="printing">Sedang Mencetak</option>
            <option value="printed">Tercetak</option>
            <option value="failed">Gagal</option>
            <option value="cancelled">Dibatalkan</option>
          </select>

          <button
            type="button"
            onClick={() => void loadQueue()}
            style={{
              border: "2px solid #d4d4d4",
              borderRadius: 10,
              padding: "7px 12px",
              backgroundColor: "#ffffff",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Print Queue List */}
        {jobs.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontWeight: 600 }}>
            Belum ada antrean cetak.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {jobs.map((job) => {
              const badge = JOB_STATUS_META[job.status];
              const isBusy = busyJobId === job.id;
              return (
                <div
                  key={job.id}
                  style={{
                    border: "2px solid #e5e7eb",
                    borderRadius: 16,
                    padding: 14,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    flexWrap: "wrap",
                    backgroundColor: "#ffffff",
                  }}
                >
                  <AuthenticatedOutputThumbnail
                    previewUrl={job.preview_url}
                    alt={`Output #${job.id}`}
                    onAuthFailure={onAuthFailure}
                  />

                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong>
                        #{job.id} · {job.customer_name}
                      </strong>
                      <span
                        style={{
                          backgroundColor: badge.bg,
                          color: badge.fg,
                          padding: "3px 10px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                      {job.category_name} ({job.frame_name}) · {job.copies} lbr ·{" "}
                      <strong>{formatRupiah(job.total_price)}</strong>
                    </div>
                    {job.error_message && (
                      <div
                        style={{
                          marginTop: 6,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#991b1b",
                          backgroundColor: "#fee2e2",
                          padding: "4px 10px",
                          borderRadius: 8,
                        }}
                      >
                        <AlertTriangle size={14} />
                        <span>{job.error_message}</span>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {job.status === "queued" && (
                      <button
                        type="button"
                        disabled={isBusy || !job.has_output}
                        onClick={() => void handleJobAction(job.id, "print")}
                        style={{
                          border: "none",
                          borderRadius: 10,
                          padding: "8px 14px",
                          backgroundColor: "var(--brand-blue)",
                          color: "#ffffff",
                          fontWeight: 700,
                          fontSize: 13,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Printer size={15} />
                        <span>Print Sekarang</span>
                      </button>
                    )}

                    {job.status === "failed" && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleJobAction(job.id, "retry")}
                        style={{
                          border: "none",
                          borderRadius: 10,
                          padding: "8px 14px",
                          backgroundColor: "var(--accent-orange)",
                          color: "#ffffff",
                          fontWeight: 700,
                          fontSize: 13,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <RotateCcw size={15} />
                        <span>Retry</span>
                      </button>
                    )}

                    {(job.status === "queued" || job.status === "failed") && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleJobAction(job.id, "cancel")}
                        style={{
                          border: "2px solid #dc2626",
                          borderRadius: 10,
                          padding: "7px 12px",
                          backgroundColor: "#ffffff",
                          color: "#dc2626",
                          fontWeight: 700,
                          fontSize: 13,
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <XCircle size={15} />
                        <span>Cancel</span>
                      </button>
                    )}

                    {job.has_output && job.download_url && (
                      <button
                        type="button"
                        onClick={() => void handleDownload(job)}
                        style={{
                          border: "2px solid #d4d4d4",
                          borderRadius: 10,
                          padding: "7px 12px",
                          backgroundColor: "#ffffff",
                          fontWeight: 700,
                          fontSize: 13,
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <Download size={15} />
                        <span>Download 300 DPI</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
