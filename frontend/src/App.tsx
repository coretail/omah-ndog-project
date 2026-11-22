import { useCallback, useEffect, useState } from "react";
import { AdminAuthStatus, adminApi } from "./api/client";
import { AdminPinModal } from "./components/AdminPinModal";
import { AdminDashboard } from "./pages/AdminDashboard";

export function App() {
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
            Koneksi Terputus
          </h2>
          <p style={{ margin: "0 0 18px", fontWeight: 600 }}>{error}</p>
          <button
            type="button"
            onClick={() => void refreshAuthStatus()}
            style={{
              border: "none",
              borderRadius: 999,
              padding: "10px 24px",
              backgroundColor: "var(--accent-orange)",
              color: "#ffffff",
              fontWeight: 700,
            }}
          >
            Coba Lagi
          </button>
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
        />
      </div>
    );
  }

  return <AdminDashboard onRequireAuth={() => void refreshAuthStatus()} />;
}

export default App;
