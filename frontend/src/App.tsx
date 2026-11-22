import { useCallback, useEffect, useState } from "react";
import { AdminAuthStatus, adminApi } from "./api/client";
import { AdminPinModal } from "./components/AdminPinModal";
import { SessionUnavailableView } from "./components/SessionUnavailableView";
import { AdminDashboard } from "./pages/AdminDashboard";
import { LastPreviewPage } from "./pages/LastPreviewPage";
import { PrintingPage } from "./pages/PrintingPage";
import { QrPage } from "./pages/QrPage";
import { SelectFramePage } from "./pages/SelectFramePage";
import { SelectPhotoPage } from "./pages/SelectPhotoPage";
import { WelcomePage } from "./pages/WelcomePage";

type AppRoute =
  | { kind: "welcome" }
  | { kind: "admin" }
  | { kind: "session-qr"; token: string }
  | { kind: "session-frame"; token: string }
  | { kind: "session-photo"; token: string }
  | { kind: "session-preview"; token: string }
  | { kind: "session-printing"; token: string }
  | { kind: "not-found" };

function parseRoute(pathname: string): AppRoute {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized === "" || normalized === "/") {
    return { kind: "welcome" };
  }
  if (normalized === "/admin") {
    return { kind: "admin" };
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts[0] === "s" && parts[1]) {
    const token = decodeURIComponent(parts[1]);
    const sub = parts[2] ?? "frame";
    if (sub === "qr") return { kind: "session-qr", token };
    if (sub === "frame") return { kind: "session-frame", token };
    if (sub === "photo") return { kind: "session-photo", token };
    if (sub === "preview") return { kind: "session-preview", token };
    if (sub === "printing") return { kind: "session-printing", token };
  }

  return { kind: "not-found" };
}

function AdminRouteGate({ onBackToKiosk }: { onBackToKiosk: () => void }) {
  const [authStatus, setAuthStatus] = useState<AdminAuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const status = await adminApi.getAuthStatus();
      setAuthStatus(status);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Tidak dapat terhubung ke backend studio."
      );
    }
  }, []);

  useEffect(() => {
    void refreshAuthStatus();
  }, [refreshAuthStatus]);

  if (error) {
    return (
      <div className="admin-bg" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: 24,
            padding: 28,
            maxWidth: 460,
            textAlign: "center",
            border: "4px solid var(--accent-orange-red)",
          }}
        >
          <h2 className="studio-heading" style={{ fontSize: 28, marginBottom: 12 }}>
            Akses Admin Dibatasi
          </h2>
          <p style={{ margin: "0 0 18px", fontWeight: 600 }}>{error}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              type="button"
              onClick={onBackToKiosk}
              style={{
                border: "2px solid var(--brand-blue)",
                borderRadius: 999,
                padding: "10px 20px",
                backgroundColor: "#ffffff",
                color: "var(--brand-blue)",
                fontWeight: 700,
              }}
            >
              Kembali ke Kiosk
            </button>
            <button
              type="button"
              onClick={() => void refreshAuthStatus()}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "10px 20px",
                backgroundColor: "var(--accent-orange)",
                color: "#ffffff",
                fontWeight: 700,
              }}
            >
              Coba Lagi
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!authStatus) {
    return (
      <div className="admin-bg" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <p style={{ fontWeight: 700, fontSize: 18 }}>Memuat Admin Dashboard...</p>
      </div>
    );
  }

  if (!authStatus.authenticated) {
    return (
      <div className="admin-bg">
        <AdminPinModal
          pinConfigured={authStatus.pin_configured}
          lockedSecondsRemaining={authStatus.locked_seconds_remaining}
          onAuthenticated={() => void refreshAuthStatus()}
          onClose={onBackToKiosk}
        />
      </div>
    );
  }

  return (
    <AdminDashboard
      onRequireAuth={() => void refreshAuthStatus()}
      onBackToKiosk={onBackToKiosk}
    />
  );
}

export function App() {
  const [pathname, setPathname] = useState<string>(() => window.location.pathname);

  const navigate = useCallback((to: string, replace = false) => {
    if (replace) {
      window.history.replaceState(null, "", to);
    } else {
      window.history.pushState(null, "", to);
    }
    setPathname(window.location.pathname);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    function onPopState() {
      setPathname(window.location.pathname);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Normalize bare /s/:token URL from QR scan to /s/:token/frame
  useEffect(() => {
    const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length === 2 && parts[0] === "s" && parts[1]) {
      navigate(`/s/${encodeURIComponent(parts[1])}/frame`, true);
    }
  }, [pathname, navigate]);

  const route = parseRoute(pathname);

  if (route.kind === "welcome") {
    return (
      <WelcomePage
        onSessionCreated={(token) => navigate(`/s/${encodeURIComponent(token)}/qr`)}
        onOpenAdmin={() => navigate("/admin")}
      />
    );
  }

  if (route.kind === "admin") {
    return <AdminRouteGate onBackToKiosk={() => navigate("/")} />;
  }

  if (route.kind === "session-qr") {
    const encoded = encodeURIComponent(route.token);
    return (
      <QrPage
        token={route.token}
        onBack={() => navigate("/")}
        onNext={() => navigate(`/s/${encoded}/frame`)}
      />
    );
  }

  if (route.kind === "session-frame") {
    const encoded = encodeURIComponent(route.token);
    return (
      <SelectFramePage
        token={route.token}
        onBackToQr={() => navigate(`/s/${encoded}/qr`)}
        onSelectPhoto={() => navigate(`/s/${encoded}/photo`)}
        onGoHome={() => navigate("/")}
      />
    );
  }

  if (route.kind === "session-photo") {
    const encoded = encodeURIComponent(route.token);
    return (
      <SelectPhotoPage
        token={route.token}
        onBackToFrame={() => navigate(`/s/${encoded}/frame`)}
        onNextPreview={() => navigate(`/s/${encoded}/preview`)}
        onGoHome={() => navigate("/")}
      />
    );
  }

  if (route.kind === "session-preview") {
    const encoded = encodeURIComponent(route.token);
    return (
      <LastPreviewPage
        token={route.token}
        onBackToPhoto={() => navigate(`/s/${encoded}/photo`)}
        onPrinted={() => navigate(`/s/${encoded}/printing`)}
        onGoHome={() => navigate("/")}
      />
    );
  }

  if (route.kind === "session-printing") {
    const encoded = encodeURIComponent(route.token);
    return (
      <PrintingPage
        token={route.token}
        onBackToPreview={() => navigate(`/s/${encoded}/preview`)}
        onPrintAgain={() => navigate(`/s/${encoded}/frame`)}
        onGoHome={() => navigate("/")}
      />
    );
  }

  return (
    <SessionUnavailableView
      message="Halaman tidak ditemukan."
      onGoHome={() => navigate("/")}
    />
  );
}

export default App;
