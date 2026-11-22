import { type CSSProperties, FormEvent, useState } from "react";
import { Settings } from "lucide-react";
import { ApiError, sessionsApi } from "../api/client";
import { saveDraft } from "../utils/draftStorage";

interface WelcomePageProps {
  onSessionCreated: (token: string) => void;
  onOpenAdmin: () => void;
}

export function WelcomePage({ onSessionCreated, onOpenAdmin }: WelcomePageProps) {
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!consentAccepted) {
      setErrorMsg("Centang persetujuan privasi terlebih dahulu.");
      return;
    }

    setSubmitting(true);
    try {
      const session = await sessionsApi.createSession({
        name: name.trim(),
        whatsapp: whatsapp.trim(),
        email: email.trim(),
        consent_accepted: true,
      });
      saveDraft(session.token, {
        kioskOrigin: true,
        qrTargetUrl: session.qr_target_url,
        qrMode: session.qr_mode,
      });
      onSessionCreated(session.token);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Gagal membuat sesi. Pastikan backend aktif dan akses dari PC Kiosk.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="welcome-bg welcome-split" style={{ position: "relative" }}>
      {/* Top-right Settings button */}
      <button
        type="button"
        title="Pengaturan Admin"
        aria-label="Pengaturan Admin"
        onClick={onOpenAdmin}
        style={{
          position: "absolute",
          top: 24,
          right: 24,
          zIndex: 10,
          width: 54,
          height: 54,
          borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.65)",
          backgroundColor: "rgba(255, 255, 255, 0.28)",
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(4px)",
        }}
      >
        <Settings size={30} />
      </button>

      {/* Left Hero Photo */}
      <div className="welcome-hero-panel">
        <img
          src="/assets/hero-welcome.png"
          alt="Self-Photo Studio"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center top",
            display: "block",
          }}
        />
      </div>

      {/* Right Registration Form */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 28px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 520 }}>
          <h1
            className="studio-heading"
            style={{
              fontSize: "clamp(32px, 4vw, 48px)",
              textAlign: "center",
              marginBottom: 32,
            }}
          >
            Halo Kaka,
            <br />
            Kenalan dulu yuuk
          </h1>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <label style={fieldLabelStyle}>
              <span style={{ paddingLeft: 18 }}>Name</span>
              <input
                type="text"
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama lengkap kamu"
                style={pillInputStyle}
              />
            </label>

            <label style={fieldLabelStyle}>
              <span style={{ paddingLeft: 18 }}>Whatsapp</span>
              <input
                type="tel"
                required
                minLength={6}
                maxLength={30}
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="Contoh: 081234567890"
                style={pillInputStyle}
              />
            </label>

            <label style={fieldLabelStyle}>
              <span style={{ paddingLeft: 18 }}>Email</span>
              <input
                type="email"
                required
                maxLength={120}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@email.com"
                style={pillInputStyle}
              />
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "6px 10px",
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.4,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--brand-blue)" }}
              />
              <span>
                Saya menyetujui data Nama, WhatsApp, dan Email disimpan untuk kebutuhan sesi cetak
                foto studio ini.
              </span>
            </label>

            {errorMsg && (
              <div
                role="alert"
                style={{
                  backgroundColor: "#fee2e2",
                  color: "#991b1b",
                  padding: "10px 14px",
                  borderRadius: 14,
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {errorMsg}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
              <button
                type="submit"
                disabled={submitting}
                className="pill-btn-orange"
                style={{
                  minWidth: 280,
                  color: "#ffffff",
                  fontSize: 28,
                  minHeight: 58,
                }}
              >
                {submitting ? "MEMPROSES..." : "NEXT"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

const fieldLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontWeight: 700,
  fontSize: 18,
};

const pillInputStyle: CSSProperties = {
  width: "100%",
  height: 52,
  borderRadius: 26,
  border: "2px solid rgba(0, 0, 0, 0.08)",
  backgroundColor: "#ffffff",
  padding: "0 22px",
  fontSize: 16,
  fontWeight: 600,
  outline: "none",
  boxShadow: "0 6px 14px rgba(0, 0, 0, 0.14)",
};
