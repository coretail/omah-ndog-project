import { FormEvent, useState } from "react";
import { Lock } from "lucide-react";
import { ApiError, adminApi, setStoredAdminToken } from "../api/client";

interface AdminPinModalProps {
  pinConfigured: boolean;
  lockedSecondsRemaining: number;
  onAuthenticated: () => void;
  onClose?: () => void;
}

export function AdminPinModal({
  pinConfigured,
  lockedSecondsRemaining,
  onAuthenticated,
  onClose,
}: AdminPinModalProps) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(
    lockedSecondsRemaining > 0
      ? `Terlalu banyak percobaan gagal. Coba lagi dalam ${lockedSecondsRemaining} detik.`
      : null
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!pinConfigured && pin !== confirmPin) {
      setErrorMsg("Konfirmasi PIN tidak cocok.");
      return;
    }

    setSubmitting(true);
    try {
      const result = pinConfigured ? await adminApi.login(pin) : await adminApi.setupPin(pin);
      setStoredAdminToken(result.token);
      setPin("");
      setConfirmPin("");
      onAuthenticated();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429 && err.retryAfter) {
          setErrorMsg(`Terlalu banyak percobaan salah. Terkunci selama ${err.retryAfter} detik.`);
        } else {
          setErrorMsg(err.message);
        }
      } else {
        setErrorMsg("Gagal menghubungi server.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          backgroundColor: "#ffffff",
          borderRadius: 24,
          padding: 28,
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.25)",
          border: "4px solid var(--accent-orange-red)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: "var(--brand-blue)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Lock size={22} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, color: "var(--brand-blue)" }}>
              {pinConfigured ? "Masuk Admin Dashboard" : "Atur PIN Admin Pertama"}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
              {pinConfigured
                ? "Masukkan PIN operator studio"
                : "Setup pertama hanya dapat dilakukan dari PC Kiosk (localhost)"}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 700, fontSize: 14 }}>
            <span>{pinConfigured ? "PIN Admin" : "PIN Baru (4–32 karakter)"}</span>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
              minLength={4}
              maxLength={32}
              autoFocus
              placeholder="••••••"
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                border: "2px solid #d4d4d4",
                fontSize: 18,
              }}
            />
          </label>

          {!pinConfigured && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontWeight: 700, fontSize: 14 }}>
              <span>Konfirmasi PIN Baru</span>
              <input
                type="password"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                required
                minLength={4}
                maxLength={32}
                placeholder="••••••"
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "2px solid #d4d4d4",
                  fontSize: 18,
                }}
              />
            </label>
          )}

          {errorMsg && (
            <div
              role="alert"
              style={{
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                padding: "10px 12px",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {errorMsg}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: 999,
                  border: "2px solid #d4d4d4",
                  backgroundColor: "#ffffff",
                  fontWeight: 700,
                  fontSize: 15,
                }}
              >
                Batal
              </button>
            )}
            <button
              type="submit"
              disabled={submitting}
              style={{
                flex: 2,
                padding: "12px 16px",
                borderRadius: 999,
                border: "none",
                backgroundColor: "var(--accent-orange)",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              {submitting ? "Memproses..." : pinConfigured ? "Masuk" : "Simpan PIN"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
