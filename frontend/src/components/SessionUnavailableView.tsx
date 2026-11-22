interface SessionUnavailableViewProps {
  message: string;
  onGoHome?: () => void;
}

export function SessionUnavailableView({ message, onGoHome }: SessionUnavailableViewProps) {
  return (
    <div
      className="studio-bg"
      style={{
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: 28,
          padding: 32,
          maxWidth: 460,
          width: "100%",
          textAlign: "center",
          boxShadow: "var(--shadow-card)",
          border: "4px solid var(--accent-orange-red)",
        }}
      >
        <h2 className="studio-heading" style={{ fontSize: 30, marginBottom: 12 }}>
          Sesi Tidak Aktif
        </h2>
        <p style={{ margin: "0 0 22px", fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>
          {message}
        </p>
        {onGoHome && (
          <button
            type="button"
            className="pill-btn-orange"
            onClick={onGoHome}
            style={{ fontSize: 20, minHeight: 52, padding: "10px 28px" }}
          >
            Kembali ke Awal
          </button>
        )}
      </div>
    </div>
  );
}
