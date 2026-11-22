import { FormEvent, useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import {
  CustomerHistoryItem,
  StudioSettings,
  adminApi,
} from "../api/client";
import { formatRupiah } from "../utils/draftStorage";

interface CustomerHistoryPanelProps {
  settings: StudioSettings | null;
  onSettingsUpdated: (updated: StudioSettings) => void;
  onAuthFailure: (err: unknown) => boolean;
  onFeedback: (msg: { type: "ok" | "err"; text: string }) => void;
}

export function CustomerHistoryPanel({
  settings,
  onSettingsUpdated,
  onAuthFailure,
  onFeedback,
}: CustomerHistoryPanelProps) {
  const [customers, setCustomers] = useState<CustomerHistoryItem[]>([]);
  const [retentionDaysInput, setRetentionDaysInput] = useState(
    String(settings?.retention_days ?? 7)
  );
  const [sessionTtlInput, setSessionTtlInput] = useState(
    String(settings?.session_ttl_hours ?? 4)
  );
  const [savingRetention, setSavingRetention] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (settings) {
      setRetentionDaysInput(String(settings.retention_days));
      setSessionTtlInput(String(settings.session_ttl_hours));
    }
  }, [settings]);

  const loadCustomers = useCallback(async () => {
    try {
      const list = await adminApi.listCustomers(100);
      setCustomers(list);
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal memuat histori customer.",
        });
      }
    }
  }, [onAuthFailure, onFeedback]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  async function handleSaveRetention(e: FormEvent) {
    e.preventDefault();
    const days = Number.parseInt(retentionDaysInput, 10);
    const ttl = Number.parseInt(sessionTtlInput, 10);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      onFeedback({ type: "err", text: "Retensi file harus antara 1 dan 365 hari." });
      return;
    }
    if (!Number.isFinite(ttl) || ttl < 1 || ttl > 168) {
      onFeedback({ type: "err", text: "Masa berlaku QR harus antara 1 dan 168 jam." });
      return;
    }
    setSavingRetention(true);
    try {
      const updated = await adminApi.updateSettings({
        retention_days: days,
        session_ttl_hours: ttl,
      });
      onSettingsUpdated(updated);
      onFeedback({ type: "ok", text: "Pengaturan retensi & masa berlaku QR tersimpan." });
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal menyimpan retensi.",
        });
      }
    } finally {
      setSavingRetention(false);
    }
  }

  async function handleRunCleanup() {
    setCleaning(true);
    try {
      const res = await adminApi.runCleanup();
      const freedKb = Math.round(res.freed_bytes / 1024);
      onFeedback({
        type: "ok",
        text: `Cleanup selesai (> ${res.retention_days} hari): ${res.deleted_thumbnails} thumbnail & ${res.deleted_outputs} output dihapus (${freedKb} KB).`,
      });
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal menjalankan cleanup.",
        });
      }
    } finally {
      setCleaning(false);
    }
  }

  async function handleExportCsv() {
    try {
      const blob = await adminApi.exportCustomersCsv();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "studio_customers.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal mengekspor CSV customer.",
        });
      }
    }
  }

  async function handleDeleteCustomer(item: CustomerHistoryItem) {
    if (
      !window.confirm(
        `Hapus data customer "${item.name}" beserta ${item.job_count} job dan file output cetaknya? Foto asli kamera di folder studio TIDAK akan dihapus.`
      )
    ) {
      return;
    }
    setDeletingId(item.id);
    try {
      await adminApi.deleteCustomer(item.id);
      setCustomers((prev) => prev.filter((c) => c.id !== item.id));
      onFeedback({
        type: "ok",
        text: `Data customer "${item.name}" dihapus (foto asli kamera tetap aman).`,
      });
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal menghapus data customer.",
        });
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section>
      <h2 style={{ margin: "0 0 10px", fontSize: 28, fontWeight: 700 }}>
        Privasi, Retensi &amp; Histori Customer
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
        {/* Retention & Manual Cleanup */}
        <form
          onSubmit={handleSaveRetention}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            paddingBottom: 16,
            borderBottom: "2px solid #f0f0f0",
          }}
        >
          <ShieldCheck size={22} color="var(--brand-blue)" />
          <label style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <span>Retensi Cache/Output (hari):</span>
            <input
              type="number"
              min={1}
              max={365}
              value={retentionDaysInput}
              onChange={(e) => setRetentionDaysInput(e.target.value)}
              style={{
                width: 72,
                padding: "7px 10px",
                borderRadius: 10,
                border: "2px solid #d4d4d4",
                fontWeight: 700,
              }}
            />
          </label>

          <label style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <span>Masa Berlaku QR (jam):</span>
            <input
              type="number"
              min={1}
              max={168}
              value={sessionTtlInput}
              onChange={(e) => setSessionTtlInput(e.target.value)}
              style={{
                width: 72,
                padding: "7px 10px",
                borderRadius: 10,
                border: "2px solid #d4d4d4",
                fontWeight: 700,
              }}
            />
          </label>

          <button
            type="submit"
            disabled={savingRetention}
            style={{
              border: "none",
              borderRadius: 12,
              padding: "9px 16px",
              backgroundColor: "var(--accent-orange)",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {savingRetention ? "Menyimpan..." : "Simpan Retensi"}
          </button>

          <button
            type="button"
            disabled={cleaning}
            onClick={() => void handleRunCleanup()}
            style={{
              marginLeft: "auto",
              border: "2px solid var(--brand-blue)",
              borderRadius: 12,
              padding: "8px 14px",
              backgroundColor: "#ffffff",
              color: "var(--brand-blue)",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {cleaning ? "Membersihkan..." : "Bersihkan File Expired"}
          </button>
        </form>

        {/* Customer Table Header & Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 16 }}>Histori Customer ({customers.length})</strong>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button
              type="button"
              onClick={() => void loadCustomers()}
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

            <button
              type="button"
              onClick={() => void handleExportCsv()}
              style={{
                border: "none",
                borderRadius: 10,
                padding: "8px 14px",
                backgroundColor: "var(--brand-blue)",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <Download size={14} />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Customer History Table */}
        {customers.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontWeight: 600 }}>
            Belum ada data customer tercatat.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                  <th style={{ padding: "8px 10px" }}>Name</th>
                  <th style={{ padding: "8px 10px" }}>Whatsapp</th>
                  <th style={{ padding: "8px 10px" }}>Email</th>
                  <th style={{ padding: "8px 10px" }}>Subfolder</th>
                  <th style={{ padding: "8px 10px" }}>Job</th>
                  <th style={{ padding: "8px 10px" }}>Total</th>
                  <th style={{ padding: "8px 10px" }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "9px 10px", fontWeight: 700 }}>{c.name}</td>
                    <td style={{ padding: "9px 10px" }}>{c.whatsapp}</td>
                    <td style={{ padding: "9px 10px" }}>{c.email}</td>
                    <td style={{ padding: "9px 10px" }}>{c.photo_subfolder || "-"}</td>
                    <td style={{ padding: "9px 10px", fontWeight: 700 }}>{c.job_count}</td>
                    <td style={{ padding: "9px 10px", fontWeight: 700 }}>
                      {formatRupiah(c.total_spent)}
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      <button
                        type="button"
                        disabled={deletingId === c.id}
                        onClick={() => void handleDeleteCustomer(c)}
                        title="Hapus Data Customer"
                        style={{
                          border: "1px solid #dc2626",
                          borderRadius: 8,
                          padding: "5px 10px",
                          backgroundColor: "#fee2e2",
                          color: "#dc2626",
                          fontWeight: 700,
                          fontSize: 12,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Trash2 size={13} />
                        <span>Hapus</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
