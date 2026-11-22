import { FormEvent, useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import {
  CustomerHistoryItem,
  StudioSettings,
  adminApi,
} from "../api/client";
import { formatRupiah } from "../utils/format";

interface CustomerHistoryPanelProps {
  settings: StudioSettings | null;
  onSettingsUpdated: (updated: StudioSettings) => void;
  onAuthFailure: (err: unknown) => boolean;
  onFeedback: (msg: { type: "ok" | "err"; text: string }) => void;
}

const PAGE_SIZE = 100;

export function CustomerHistoryPanel({
  settings,
  onSettingsUpdated,
  onAuthFailure,
  onFeedback,
}: CustomerHistoryPanelProps) {
  const [customers, setCustomers] = useState<CustomerHistoryItem[]>([]);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [retentionDaysInput, setRetentionDaysInput] = useState(
    String(settings?.retention_days ?? 7)
  );
  const [sessionTtlInput, setSessionTtlInput] = useState(
    String(settings?.session_ttl_hours ?? 4)
  );
  const [retentionDirty, setRetentionDirty] = useState(false);
  const [ttlDirty, setTtlDirty] = useState(false);

  const [savingRetention, setSavingRetention] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const settingsRetentionDays = settings?.retention_days;
  const settingsSessionTtl = settings?.session_ttl_hours;

  useEffect(() => {
    if (settingsRetentionDays !== undefined && !retentionDirty) {
      setRetentionDaysInput(String(settingsRetentionDays));
    }
  }, [settingsRetentionDays, retentionDirty]);

  useEffect(() => {
    if (settingsSessionTtl !== undefined && !ttlDirty) {
      setSessionTtlInput(String(settingsSessionTtl));
    }
  }, [settingsSessionTtl, ttlDirty]);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const page = await adminApi.listCustomers(PAGE_SIZE, 0);
      setCustomers(page.items);
      setTotalCustomers(page.total);
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal memuat histori customer.",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [onAuthFailure, onFeedback]);

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const page = await adminApi.listCustomers(PAGE_SIZE, customers.length);
      setCustomers((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));
        const nextItems = page.items.filter((c) => !existingIds.has(c.id));
        return [...prev, ...nextItems];
      });
      setTotalCustomers(page.total);
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal memuat data customer berikutnya.",
        });
      }
    } finally {
      setLoadingMore(false);
    }
  }

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
      setRetentionDirty(false);
      setTtlDirty(false);
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
    setExportingCsv(true);
    try {
      const blob = await adminApi.exportCustomersCsv();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "studio_customers.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      if (!onAuthFailure(err)) {
        onFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal mengekspor CSV customer.",
        });
      }
    } finally {
      setExportingCsv(false);
    }
  }

  async function handleDeleteCustomer(item: CustomerHistoryItem) {
    const retentionDays = settings?.retention_days ?? 7;
    if (
      !window.confirm(
        `Hapus data customer "${item.name}" beserta ${item.job_count} job dan file output cetaknya? Foto asli kamera di folder studio TIDAK akan dihapus, dan thumbnail cache terhapus otomatis sesuai masa retensi (${retentionDays} hari).`
      )
    ) {
      return;
    }
    setDeletingId(item.id);
    try {
      await adminApi.deleteCustomer(item.id);
      setCustomers((prev) => prev.filter((c) => c.id !== item.id));
      setTotalCustomers((prev) => Math.max(0, prev - 1));
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
              onChange={(e) => {
                setRetentionDaysInput(e.target.value);
                setRetentionDirty(true);
              }}
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
              onChange={(e) => {
                setSessionTtlInput(e.target.value);
                setTtlDirty(true);
              }}
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
          <div>
            <strong style={{ fontSize: 16 }}>Histori Customer</strong>
            {!loading && (
              <span style={{ marginLeft: 10, fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>
                Menampilkan {customers.length} dari {totalCustomers} customer
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button
              type="button"
              disabled={loading}
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
              disabled={exportingCsv}
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
                opacity: exportingCsv ? 0.7 : 1,
              }}
            >
              <Download size={14} />
              <span>{exportingCsv ? "Mengekspor..." : "Export CSV"}</span>
            </button>
          </div>
        </div>

        {/* Customer History Table */}
        {loading ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontWeight: 600 }}>
            Memuat histori customer...
          </div>
        ) : customers.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontWeight: 600 }}>
            Belum ada data customer tercatat.
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
                    <th style={{ padding: "8px 10px" }}>Name</th>
                    <th style={{ padding: "8px 10px" }}>Whatsapp</th>
                    <th style={{ padding: "8px 10px" }}>Email</th>
                    <th style={{ padding: "8px 10px" }}>Subfolder</th>
                    <th style={{ padding: "8px 10px" }}>Job</th>
                    <th style={{ padding: "8px 10px" }}>Total Tercetak</th>
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

            {customers.length < totalCustomers && (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void handleLoadMore()}
                  style={{
                    border: "2px solid var(--brand-blue)",
                    borderRadius: 10,
                    padding: "8px 18px",
                    backgroundColor: "#ffffff",
                    color: "var(--brand-blue)",
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {loadingMore ? "Memuat..." : "Muat Lebih Banyak"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
