import { ChangeEvent, type CSSProperties, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  FolderOpen,
  Globe,
  LogOut,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import {
  ApiError,
  FrameCategory,
  FrameItem,
  FrameSlot,
  Orientation,
  StudioSettings,
  SubfolderInfo,
  adminApi,
  framesApi,
  setStoredAdminToken,
} from "../api/client";
import { FrameSlotEditor } from "../components/FrameSlotEditor";

interface AdminDashboardProps {
  onRequireAuth: () => void;
  onBackToKiosk?: () => void;
}

export function AdminDashboard({ onRequireAuth, onBackToKiosk }: AdminDashboardProps) {
  const [categories, setCategories] = useState<FrameCategory[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  const [frames, setFrames] = useState<FrameItem[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(null);

  const [priceInput, setPriceInput] = useState("");
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [photoRootInput, setPhotoRootInput] = useState("");
  const [publicUrlInput, setPublicUrlInput] = useState("");
  const [folderModeInput, setFolderModeInput] = useState<"active" | "auto_create">("active");
  const [activeSubfolderInput, setActiveSubfolderInput] = useState("");
  const [subfolders, setSubfolders] = useState<SubfolderInfo[]>([]);
  const [newSubfolderName, setNewSubfolderName] = useState("");

  const [savingSlots, setSavingSlots] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Category modal state
  const [catModalMode, setCatModalMode] = useState<"create" | "edit" | null>(null);
  const [catName, setCatName] = useState("");
  const [catPrice, setCatPrice] = useState("15000");
  const [catWidthMm, setCatWidthMm] = useState("102");
  const [catHeightMm, setCatHeightMm] = useState("152");
  const [catOrientation, setCatOrientation] = useState<Orientation>("portrait");
  const [catSafeMarginMm, setCatSafeMarginMm] = useState("0");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleAuthFailure = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setStoredAdminToken(null);
        onRequireAuth();
        return true;
      }
      return false;
    },
    [onRequireAuth]
  );

  const loadInitial = useCallback(async () => {
    try {
      const [cats, st, subs] = await Promise.all([
        framesApi.listCategories(),
        adminApi.getSettings(),
        adminApi.listSubfolders(),
      ]);
      setCategories(cats);
      setSettings(st);
      setPhotoRootInput(st.photo_root_dir);
      setPublicUrlInput(st.public_base_url);
      setFolderModeInput(st.folder_mode);
      setActiveSubfolderInput(st.active_subfolder);
      setSubfolders(subs);

      if (cats.length > 0) {
        const first = cats[0];
        setSelectedCatId((prev) => (prev && cats.some((c) => c.id === prev) ? prev : first.id));
      }
    } catch (err) {
      if (!handleAuthFailure(err)) {
        setFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal memuat data Admin.",
        });
      }
    }
  }, [handleAuthFailure]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    const activeCat = categories.find((c) => c.id === selectedCatId) ?? null;
    if (activeCat) {
      setPriceInput(String(activeCat.price));
    }
    if (selectedCatId === null) {
      setFrames([]);
      setSelectedFrameId(null);
      return;
    }
    let cancelled = false;
    framesApi
      .listFrames(selectedCatId)
      .then((list) => {
        if (cancelled) return;
        setFrames(list);
        setSelectedFrameId((prev) =>
          prev && list.some((f) => f.id === prev) ? prev : list[0]?.id ?? null
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setFeedback({
            type: "err",
            text: err instanceof Error ? err.message : "Gagal memuat frame.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCatId, categories]);

  const activeCategory = categories.find((c) => c.id === selectedCatId) ?? null;
  const selectedFrame = frames.find((f) => f.id === selectedFrameId) ?? null;
  const activeSubfolderMeta = subfolders.find((s) => s.name === activeSubfolderInput) ?? null;

  async function handleSavePrice(e: FormEvent) {
    e.preventDefault();
    if (!activeCategory) return;
    const parsedPrice = Number.parseInt(priceInput.replace(/\D/g, ""), 10);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setFeedback({ type: "err", text: "Harga tidak valid." });
      return;
    }
    try {
      const updated = await framesApi.updateCategory(activeCategory.id, { price: parsedPrice });
      setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setFeedback({ type: "ok", text: `Harga kategori ${updated.name} disimpan.` });
    } catch (err) {
      if (!handleAuthFailure(err)) {
        setFeedback({ type: "err", text: err instanceof Error ? err.message : "Gagal update harga." });
      }
    }
  }

  function openCategoryModal(mode: "create" | "edit") {
    setCatModalMode(mode);
    if (mode === "edit" && activeCategory) {
      setCatName(activeCategory.name);
      setCatPrice(String(activeCategory.price));
      setCatWidthMm(String(activeCategory.width_mm));
      setCatHeightMm(String(activeCategory.height_mm));
      setCatOrientation(activeCategory.orientation);
      setCatSafeMarginMm(String(activeCategory.safe_margin_mm));
    } else {
      setCatName("");
      setCatPrice("15000");
      setCatWidthMm("102");
      setCatHeightMm("152");
      setCatOrientation("portrait");
      setCatSafeMarginMm("0");
    }
  }

  async function handleSubmitCategoryModal(e: FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        name: catName.trim(),
        price: Number.parseInt(catPrice, 10) || 0,
        width_mm: Number.parseFloat(catWidthMm) || 102,
        height_mm: Number.parseFloat(catHeightMm) || 152,
        orientation: catOrientation,
        safe_margin_mm: Number.parseFloat(catSafeMarginMm) || 0,
        sort_order: categories.length + 1,
      };
      if (catModalMode === "create") {
        const created = await framesApi.createCategory(payload);
        setCategories((prev) => [...prev, created]);
        setSelectedCatId(created.id);
        setFeedback({ type: "ok", text: `Kategori ${created.name} ditambahkan.` });
      } else if (catModalMode === "edit" && activeCategory) {
        const updated = await framesApi.updateCategory(activeCategory.id, payload);
        setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        setFeedback({ type: "ok", text: `Kategori ${updated.name} diperbarui.` });
      }
      setCatModalMode(null);
    } catch (err) {
      if (!handleAuthFailure(err)) {
        setFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal menyimpan kategori.",
        });
      }
    }
  }

  async function handleDeleteActiveCategory() {
    if (!activeCategory) return;
    if (
      !window.confirm(
        `Hapus kategori "${activeCategory.name}" beserta semua frame di dalamnya?`
      )
    ) {
      return;
    }
    try {
      await framesApi.deleteCategory(activeCategory.id);
      const remaining = categories.filter((c) => c.id !== activeCategory.id);
      setCategories(remaining);
      setSelectedCatId(remaining[0]?.id ?? null);
      setCatModalMode(null);
      setFeedback({ type: "ok", text: `Kategori ${activeCategory.name} dihapus.` });
    } catch (err) {
      if (!handleAuthFailure(err)) {
        setFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal menghapus kategori.",
        });
      }
    }
  }

  async function handleUploadFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeCategory) return;

    const baseName = file.name.replace(/\.png$/i, "").slice(0, 60) || "Frame Baru";
    try {
      const created = await framesApi.uploadFrame(activeCategory.id, baseName, file);
      setFrames((prev) => [...prev, created]);
      setSelectedFrameId(created.id);
      setFeedback({ type: "ok", text: `Frame "${created.name}" berhasil diunggah.` });
    } catch (err) {
      if (!handleAuthFailure(err)) {
        setFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal mengunggah PNG frame.",
        });
      }
    }
  }

  async function handleDeleteFrame(frame: FrameItem) {
    if (
      !window.confirm(
        `Hapus frame "${frame.name}" (${frame.slots.length} slot)? Aksi ini tidak bisa dibatalkan.`
      )
    ) {
      return;
    }
    try {
      await framesApi.deleteFrame(frame.id);
      setFrames((prev) => {
        const next = prev.filter((f) => f.id !== frame.id);
        if (selectedFrameId === frame.id) {
          setSelectedFrameId(next[0]?.id ?? null);
        }
        return next;
      });
      setFeedback({ type: "ok", text: "Frame dihapus." });
    } catch (err) {
      if (!handleAuthFailure(err)) {
        setFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal menghapus frame.",
        });
      }
    }
  }

  async function handleSaveSlots(frameId: number, slots: FrameSlot[]) {
    setSavingSlots(true);
    try {
      const updated = await framesApi.updateSlots(frameId, slots);
      setFrames((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setFeedback({ type: "ok", text: `Slot untuk "${updated.name}" tersimpan.` });
    } catch (err) {
      if (!handleAuthFailure(err)) {
        setFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal menyimpan slot.",
        });
      }
    } finally {
      setSavingSlots(false);
    }
  }

  async function handleBrowseFolder() {
    try {
      const res = await adminApi.browseFolder();
      if (res.path) {
        setPhotoRootInput(res.path);
      }
    } catch (err) {
      if (!handleAuthFailure(err)) {
        setFeedback({
          type: "err",
          text:
            err instanceof Error
              ? err.message
              : "Browse Folder hanya tersedia dari PC Kiosk (localhost).",
        });
      }
    }
  }

  async function handleSavePhotoSettings(e: FormEvent) {
    e.preventDefault();
    try {
      const updated = await adminApi.updateSettings({
        photo_root_dir: photoRootInput,
        folder_mode: folderModeInput,
        active_subfolder: activeSubfolderInput,
      });
      setSettings(updated);
      setPhotoRootInput(updated.photo_root_dir);
      const subs = await adminApi.listSubfolders();
      setSubfolders(subs);
      setFeedback({ type: "ok", text: "Pengaturan folder foto tersimpan." });
    } catch (err) {
      if (!handleAuthFailure(err)) {
        setFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal menyimpan folder foto.",
        });
      }
    }
  }

  async function handleCreateSubfolder() {
    const trimmed = newSubfolderName.trim();
    if (!trimmed) return;
    try {
      const created = await adminApi.createSubfolder(trimmed);
      setSubfolders((prev) => {
        const filtered = prev.filter((s) => s.name !== created.name);
        return [...filtered, created].sort((a, b) => a.name.localeCompare(b.name));
      });
      setActiveSubfolderInput(created.name);
      setNewSubfolderName("");
      await adminApi.updateSettings({ active_subfolder: created.name });
      setFeedback({ type: "ok", text: `Subfolder "${created.name}" dibuat & diaktifkan.` });
    } catch (err) {
      if (!handleAuthFailure(err)) {
        setFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal membuat subfolder.",
        });
      }
    }
  }

  async function handleSaveTunnelSettings(e: FormEvent) {
    e.preventDefault();
    try {
      const updated = await adminApi.updateSettings({
        public_base_url: publicUrlInput,
      });
      setSettings(updated);
      setPublicUrlInput(updated.public_base_url);
      setFeedback({ type: "ok", text: "Pengaturan URL Tunnel tersimpan." });
    } catch (err) {
      if (!handleAuthFailure(err)) {
        setFeedback({
          type: "err",
          text: err instanceof Error ? err.message : "Gagal menyimpan URL Tunnel.",
        });
      }
    }
  }

  async function handleLogout() {
    try {
      await adminApi.logout();
    } catch {
      // Ignore network errors on logout
    } finally {
      setStoredAdminToken(null);
      onRequireAuth();
    }
  }

  return (
    <div className="admin-bg" style={{ padding: "28px 32px 64px" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>
        {/* Header */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 130 }}>
            {onBackToKiosk && (
              <button
                type="button"
                onClick={onBackToKiosk}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  backgroundColor: "#ffffff",
                  border: "2px solid var(--brand-blue)",
                  borderRadius: 999,
                  padding: "10px 16px",
                  fontWeight: 700,
                  color: "var(--brand-blue)",
                }}
              >
                <ArrowLeft size={18} />
                <span>Kiosk</span>
              </button>
            )}
          </div>
          <h1 className="studio-heading" style={{ fontSize: "clamp(34px, 4.5vw, 64px)", textAlign: "center" }}>
            Admin Dashboard
          </h1>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              backgroundColor: "#ffffff",
              border: "2px solid var(--accent-orange-red)",
              borderRadius: 999,
              padding: "10px 18px",
              fontWeight: 700,
              color: "var(--accent-orange-red)",
            }}
          >
            <LogOut size={18} />
            <span>Keluar</span>
          </button>
        </header>

        {feedback && (
          <div
            role="status"
            style={{
              padding: "12px 18px",
              borderRadius: 14,
              fontWeight: 700,
              backgroundColor: feedback.type === "ok" ? "#dcfce7" : "#fee2e2",
              color: feedback.type === "ok" ? "#166534" : "#991b1b",
              border: `2px solid ${feedback.type === "ok" ? "#22c55e" : "#ef4444"}`,
            }}
          >
            {feedback.text}
          </div>
        )}

        {/* Frame Setting Section */}
        <section>
          <h2 style={{ margin: "0 0 14px", fontSize: 36, fontWeight: 700 }}>Frame Setting</h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(340px, 1.45fr) minmax(320px, 1fr)",
              gap: 24,
              alignItems: "stretch",
            }}
          >
            {/* Left Pink Panel #FFADD1 */}
            <div
              style={{
                backgroundColor: "var(--panel-pink)",
                borderRadius: 32,
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 18,
                boxShadow: "var(--shadow-card)",
              }}
            >
              {/* Top Bar: Categories + Add Cat + Upload Frame */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div
                      style={{
                        backgroundColor: "var(--accent-orange-red)",
                        borderRadius: 14,
                        padding: "6px 10px",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      {categories.map((cat) => {
                        const active = cat.id === selectedCatId;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setSelectedCatId(cat.id)}
                            style={{
                              border: "none",
                              borderRadius: 9,
                              padding: "8px 14px",
                              fontWeight: 700,
                              fontSize: 20,
                              color: "#ffffff",
                              backgroundColor: active ? "var(--brand-blue)" : "transparent",
                            }}
                          >
                            {cat.name}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      title="Tambah Kategori"
                      onClick={() => openCategoryModal("create")}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        border: "none",
                        backgroundColor: "#ffffff",
                        color: "var(--brand-blue)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                      }}
                    >
                      <Plus size={22} />
                    </button>

                    {activeCategory && (
                      <button
                        type="button"
                        title="Edit Kategori Aktif"
                        onClick={() => openCategoryModal("edit")}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: "50%",
                          border: "none",
                          backgroundColor: "#ffffff",
                          color: "var(--accent-orange-red)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                        }}
                      >
                        <Pencil size={18} />
                      </button>
                    )}
                  </div>

                  {/* Input Harga */}
                  <form onSubmit={handleSavePrice} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Input Harga</div>
                      <div
                        style={{
                          backgroundColor: "var(--accent-orange-red)",
                          borderRadius: 14,
                          padding: "6px 14px",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span style={{ color: "#ffffff", fontWeight: 700, fontSize: 20 }}>Rp</span>
                        <input
                          type="number"
                          min={0}
                          value={priceInput}
                          onChange={(e) => setPriceInput(e.target.value)}
                          style={{
                            width: 120,
                            border: "none",
                            background: "transparent",
                            color: "#ffffff",
                            fontWeight: 700,
                            fontSize: 20,
                            outline: "none",
                          }}
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      style={{
                        marginTop: 18,
                        border: "none",
                        borderRadius: 12,
                        padding: "10px 16px",
                        backgroundColor: "var(--brand-blue)",
                        color: "#ffffff",
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      Simpan Harga
                    </button>
                    {activeCategory && (
                      <span style={{ marginTop: 18, fontSize: 12, fontWeight: 600 }}>
                        {activeCategory.width_mm}×{activeCategory.height_mm}mm · {activeCategory.orientation}
                        {activeCategory.safe_margin_mm > 0
                          ? ` · margin ${activeCategory.safe_margin_mm}mm`
                          : ""}
                      </span>
                    )}
                  </form>
                </div>

                {/* Big Upload Frame + Button */}
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png"
                    onChange={handleUploadFileChange}
                    style={{ display: "none" }}
                  />
                  <button
                    type="button"
                    title="Upload Frame PNG"
                    disabled={!activeCategory}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      width: 82,
                      height: 82,
                      borderRadius: "50%",
                      border: "none",
                      backgroundColor: "#ffffff",
                      color: "var(--brand-blue)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 4px 14px rgba(0,0,0,0.14)",
                    }}
                  >
                    <Plus size={38} />
                  </button>
                </div>
              </div>

              {/* Frame Cards Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 16,
                  maxHeight: 460,
                  overflowY: "auto",
                  paddingRight: 4,
                }}
              >
                {frames.length === 0 ? (
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      backgroundColor: "rgba(255,255,255,0.65)",
                      borderRadius: 16,
                      padding: 28,
                      textAlign: "center",
                      fontWeight: 600,
                      color: "var(--text-muted)",
                    }}
                  >
                    Belum ada frame di kategori ini. Klik tombol + besar untuk unggah PNG transparan.
                  </div>
                ) : (
                  frames.map((frame) => {
                    const isSelected = frame.id === selectedFrameId;
                    return (
                      <div
                        key={frame.id}
                        onClick={() => setSelectedFrameId(frame.id)}
                        style={{
                          backgroundColor: "#ffffff",
                          borderRadius: 14,
                          padding: 8,
                          cursor: "pointer",
                          border: isSelected ? "4px solid var(--brand-blue)" : "2px solid transparent",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          position: "relative",
                        }}
                      >
                        <div
                          style={{
                            height: 190,
                            backgroundColor: "#f3f4f6",
                            borderRadius: 8,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                          }}
                        >
                          <img
                            src={frame.image_url}
                            alt={frame.name}
                            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                          />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {frame.name} ({frame.slots.length} slot)
                          </span>
                          <button
                            type="button"
                            title="Hapus Frame"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteFrame(frame);
                            }}
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "#dc2626",
                              padding: 4,
                              display: "flex",
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Slot Editor */}
            <FrameSlotEditor
              frame={selectedFrame}
              onSaveSlots={handleSaveSlots}
              saving={savingSlots}
            />
          </div>
        </section>

        {/* Photo File Section */}
        <section>
          <h2 style={{ margin: "0 0 4px", fontSize: 36, fontWeight: 700 }}>Photo File</h2>
          <p style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 500 }}>
            Add one dedicated folder for your photo dashboard
          </p>

          <form onSubmit={handleSavePhotoSettings} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                backgroundColor: "var(--accent-orange)",
                borderRadius: 20,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                maxWidth: 1010,
              }}
            >
              <div
                style={{
                  flex: 1,
                  backgroundColor: "#ffffff",
                  borderRadius: 14,
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <Search size={22} color="#555555" />
                <input
                  type="text"
                  value={photoRootInput}
                  onChange={(e) => setPhotoRootInput(e.target.value)}
                  placeholder="Contoh: D:\StudioPhotos"
                  style={{
                    flex: 1,
                    border: "none",
                    outline: "none",
                    fontSize: 16,
                    fontWeight: 600,
                  }}
                />
              </div>

              <button
                type="button"
                title="Pilih Folder (PC Kiosk)"
                onClick={handleBrowseFolder}
                style={{
                  backgroundColor: "#ffffff",
                  border: "none",
                  borderRadius: 14,
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontWeight: 700,
                  color: "var(--brand-blue)",
                }}
              >
                <FolderOpen size={20} />
                <span>Browse</span>
              </button>

              <button
                type="submit"
                title="Simpan Folder"
                style={{
                  backgroundColor: "transparent",
                  border: "none",
                  color: "#ffffff",
                  padding: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                <Save size={28} />
                <span>Simpan</span>
              </button>
            </div>

            {/* Subfolder Session Picker */}
            <div
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.92)",
                borderRadius: 20,
                padding: 18,
                maxWidth: 1010,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Mode Subfolder Sesi:</span>
                  <select
                    value={folderModeInput}
                    onChange={(e) =>
                      setFolderModeInput(e.target.value as "active" | "auto_create")
                    }
                    style={{ padding: "8px 12px", borderRadius: 10, border: "2px solid #d4d4d4", fontWeight: 600 }}
                  >
                    <option value="active">Gunakan Subfolder Aktif</option>
                    <option value="auto_create">Auto-create Subfolder per Customer</option>
                  </select>
                </label>

                {folderModeInput === "active" && (
                  <label style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Subfolder Aktif:</span>
                    <select
                      value={activeSubfolderInput}
                      onChange={(e) => setActiveSubfolderInput(e.target.value)}
                      style={{ padding: "8px 12px", borderRadius: 10, border: "2px solid #d4d4d4", fontWeight: 600 }}
                    >
                      <option value="">-- Pilih Subfolder --</option>
                      {subfolders.map((sf) => (
                        <option key={sf.name} value={sf.name}>
                          {sf.name} ({sf.photo_count} foto
                          {sf.used_by_sessions > 0 ? ` · dipakai ${sf.used_by_sessions} sesi` : ""})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                  <input
                    type="text"
                    value={newSubfolderName}
                    onChange={(e) => setNewSubfolderName(e.target.value)}
                    placeholder="Nama subfolder baru"
                    style={{ padding: "8px 12px", borderRadius: 10, border: "2px solid #d4d4d4" }}
                  />
                  <button
                    type="button"
                    onClick={handleCreateSubfolder}
                    style={{
                      border: "none",
                      borderRadius: 10,
                      padding: "8px 14px",
                      backgroundColor: "var(--brand-blue)",
                      color: "#ffffff",
                      fontWeight: 700,
                    }}
                  >
                    + Subfolder
                  </button>
                </div>
              </div>

              {folderModeInput === "active" &&
                activeSubfolderMeta &&
                activeSubfolderMeta.used_by_sessions > 0 && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      backgroundColor: "#fef3c7",
                      color: "#92400e",
                      padding: "10px 14px",
                      borderRadius: 12,
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    <AlertTriangle size={18} />
                    <span>
                      Peringatan: Subfolder "{activeSubfolderMeta.name}" sudah pernah dipakai oleh{" "}
                      {activeSubfolderMeta.used_by_sessions} sesi sebelumnya. Disarankan membuat
                      subfolder baru atau aktifkan filter waktu registrasi saat membuat sesi.
                    </span>
                  </div>
                )}
            </div>
          </form>
        </section>

        {/* Tunnel & System Section */}
        <section>
          <h2 style={{ margin: "0 0 10px", fontSize: 28, fontWeight: 700 }}>
            Pengaturan Tunnel & Sistem
          </h2>
          <form
            onSubmit={handleSaveTunnelSettings}
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.92)",
              borderRadius: 20,
              padding: 20,
              maxWidth: 1010,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Globe size={22} color="var(--brand-blue)" />
              <label style={{ fontWeight: 700, fontSize: 14 }}>Public Base URL (Cloudflare / ngrok):</label>
              <input
                type="url"
                value={publicUrlInput}
                onChange={(e) => setPublicUrlInput(e.target.value)}
                placeholder="https://studio.domainanda.com (kosongkan untuk mode LAN)"
                style={{
                  flex: 1,
                  minWidth: 280,
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "2px solid #d4d4d4",
                }}
              />
              <button
                type="submit"
                style={{
                  border: "none",
                  borderRadius: 12,
                  padding: "10px 18px",
                  backgroundColor: "var(--accent-orange)",
                  color: "#ffffff",
                  fontWeight: 700,
                }}
              >
                Simpan URL
              </button>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
              <div>
                <strong>Fallback LAN Aktif:</strong>{" "}
                <code>http://{settings?.lan_ip ?? "127.0.0.1"}:8000</code> (tetap berfungsi penuh
                meski internet/tunnel mati).
              </div>
              <div>
                <strong>Catatan Tunnel:</strong> Gunakan <strong>Cloudflare Named Tunnel</strong>{" "}
                agar domain tetap sama. Jika memakai Quick Tunnel, URL berganti setiap restart
                sehingga QR sesi sebelumnya menjadi tidak valid.
              </div>
            </div>
          </form>
        </section>
      </div>

      {/* Category Create/Edit Modal */}
      {catModalMode && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <form
            onSubmit={handleSubmitCategoryModal}
            style={{
              width: "100%",
              maxWidth: 440,
              backgroundColor: "#ffffff",
              borderRadius: 24,
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              border: "4px solid var(--brand-blue)",
            }}
          >
            <h3 style={{ margin: 0, color: "var(--brand-blue)" }}>
              {catModalMode === "create" ? "Tambah Kategori Frame" : "Edit Kategori Frame"}
            </h3>

            <label style={modalLabelStyle}>
              <span>Nama Kategori</span>
              <input
                type="text"
                required
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                style={modalInputStyle}
              />
            </label>

            <label style={modalLabelStyle}>
              <span>Harga (Rp)</span>
              <input
                type="number"
                min={0}
                required
                value={catPrice}
                onChange={(e) => setCatPrice(e.target.value)}
                style={modalInputStyle}
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={modalLabelStyle}>
                <span>Lebar (mm)</span>
                <input
                  type="number"
                  step="0.1"
                  min={1}
                  required
                  value={catWidthMm}
                  onChange={(e) => setCatWidthMm(e.target.value)}
                  style={modalInputStyle}
                />
              </label>
              <label style={modalLabelStyle}>
                <span>Tinggi (mm)</span>
                <input
                  type="number"
                  step="0.1"
                  min={1}
                  required
                  value={catHeightMm}
                  onChange={(e) => setCatHeightMm(e.target.value)}
                  style={modalInputStyle}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={modalLabelStyle}>
                <span>Orientasi</span>
                <select
                  value={catOrientation}
                  onChange={(e) => setCatOrientation(e.target.value as Orientation)}
                  style={modalInputStyle}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label style={modalLabelStyle}>
                <span>Safe Margin (mm)</span>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  max={50}
                  required
                  value={catSafeMarginMm}
                  onChange={(e) => setCatSafeMarginMm(e.target.value)}
                  style={modalInputStyle}
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              {catModalMode === "edit" && activeCategory && (
                <button
                  type="button"
                  title="Hapus Kategori"
                  onClick={() => void handleDeleteActiveCategory()}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    border: "2px solid #dc2626",
                    backgroundColor: "#fee2e2",
                    color: "#dc2626",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Trash2 size={16} />
                  <span>Hapus</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setCatModalMode(null)}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 999,
                  border: "2px solid #d4d4d4",
                  backgroundColor: "#ffffff",
                  fontWeight: 700,
                }}
              >
                Batal
              </button>
              <button
                type="submit"
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 999,
                  border: "none",
                  backgroundColor: "var(--accent-orange)",
                  color: "#ffffff",
                  fontWeight: 700,
                }}
              >
                Simpan
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const modalLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
  fontWeight: 700,
};

const modalInputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "2px solid #d4d4d4",
  fontSize: 14,
};
