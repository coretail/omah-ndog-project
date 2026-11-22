import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { Check, CornerDownLeft, CornerDownRight, Lock, PlusSquare, Trash2 } from "lucide-react";
import { FrameItem, FrameSlot } from "../api/client";

interface FrameSlotEditorProps {
  frame: FrameItem | null;
  onSaveSlots: (frameId: number, slots: FrameSlot[]) => Promise<void>;
  saving: boolean;
}

type DragMode = "move" | "nw" | "ne" | "sw" | "se";

interface ActiveDrag {
  slotId: string;
  mode: DragMode;
  startX: number;
  startY: number;
  origin: FrameSlot;
  rectWidth: number;
  rectHeight: number;
  snapshotBefore: FrameSlot[];
}

const MIN_SLOT_PCT = 5;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function roundPct(val: number): number {
  return Math.round(val * 100) / 100;
}

export function FrameSlotEditor({ frame, onSaveSlots, saving }: FrameSlotEditorProps) {
  const [slots, setSlots] = useState<FrameSlot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<FrameSlot[][]>([]);
  const [redoStack, setRedoStack] = useState<FrameSlot[][]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const slotsRef = useRef<FrameSlot[]>(slots);
  slotsRef.current = slots;

  useEffect(() => {
    const initial = frame ? frame.slots.map((s) => ({ ...s })) : [];
    setSlots(initial);
    setSelectedId(initial[0]?.id ?? null);
    setUndoStack([]);
    setRedoStack([]);
    setStatusMessage(null);
  }, [frame?.id, frame?.slots]);

  function commitChange(nextSlots: FrameSlot[]) {
    setUndoStack((prev) => [...prev.slice(-29), slotsRef.current.map((s) => ({ ...s }))]);
    setRedoStack([]);
    setSlots(nextSlots);
    setStatusMessage(null);
  }

  function handleAddSlot() {
    if (!frame) return;
    const idx = slots.length + 1;
    const offset = ((idx - 1) * 5) % 35;
    const newSlot: FrameSlot = {
      id: `slot-${Date.now().toString(36)}-${idx}`,
      xPct: 10 + offset,
      yPct: 10 + offset,
      wPct: 35,
      hPct: 35,
      locked: false,
    };
    commitChange([...slots, newSlot]);
    setSelectedId(newSlot.id);
  }

  function handleToggleLock() {
    if (!selectedId) return;
    commitChange(
      slots.map((s) => (s.id === selectedId ? { ...s, locked: !s.locked } : s))
    );
  }

  function handleDeleteSelected() {
    if (!selectedId) return;
    const target = slots.find((s) => s.id === selectedId);
    if (target?.locked) return;
    const remaining = slots.filter((s) => s.id !== selectedId);
    commitChange(remaining);
    setSelectedId(remaining[0]?.id ?? null);
  }

  function handleUndo() {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, slots.map((s) => ({ ...s }))]);
    setSlots(previous);
    if (!previous.some((s) => s.id === selectedId)) {
      setSelectedId(previous[0]?.id ?? null);
    }
  }

  function handleRedo() {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, slots.map((s) => ({ ...s }))]);
    setSlots(next);
    if (!next.some((s) => s.id === selectedId)) {
      setSelectedId(next[0]?.id ?? null);
    }
  }

  async function handleSave() {
    if (!frame) return;
    await onSaveSlots(frame.id, slots);
    setStatusMessage("Slot tersimpan!");
  }

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dxPct = ((e.clientX - drag.startX) / drag.rectWidth) * 100;
      const dyPct = ((e.clientY - drag.startY) / drag.rectHeight) * 100;
      const orig = drag.origin;

      let nextX = orig.xPct;
      let nextY = orig.yPct;
      let nextW = orig.wPct;
      let nextH = orig.hPct;

      if (drag.mode === "move") {
        nextX = clamp(orig.xPct + dxPct, 0, 100 - orig.wPct);
        nextY = clamp(orig.yPct + dyPct, 0, 100 - orig.hPct);
      } else {
        if (drag.mode === "nw" || drag.mode === "sw") {
          const maxLeft = orig.xPct + orig.wPct - MIN_SLOT_PCT;
          nextX = clamp(orig.xPct + dxPct, 0, maxLeft);
          nextW = orig.wPct + (orig.xPct - nextX);
        }
        if (drag.mode === "ne" || drag.mode === "se") {
          nextW = clamp(orig.wPct + dxPct, MIN_SLOT_PCT, 100 - orig.xPct);
        }
        if (drag.mode === "nw" || drag.mode === "ne") {
          const maxTop = orig.yPct + orig.hPct - MIN_SLOT_PCT;
          nextY = clamp(orig.yPct + dyPct, 0, maxTop);
          nextH = orig.hPct + (orig.yPct - nextY);
        }
        if (drag.mode === "sw" || drag.mode === "se") {
          nextH = clamp(orig.hPct + dyPct, MIN_SLOT_PCT, 100 - orig.yPct);
        }
      }

      setSlots((prev) =>
        prev.map((s) =>
          s.id === drag.slotId
            ? {
                ...s,
                xPct: roundPct(nextX),
                yPct: roundPct(nextY),
                wPct: roundPct(nextW),
                hPct: roundPct(nextH),
              }
            : s
        )
      );
    }

    function onPointerUp() {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      const changed =
        JSON.stringify(drag.snapshotBefore) !== JSON.stringify(slotsRef.current);
      if (changed) {
        setUndoStack((prev) => [...prev.slice(-29), drag.snapshotBefore]);
        setRedoStack([]);
        setStatusMessage(null);
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  function startDrag(e: ReactPointerEvent, slot: FrameSlot, mode: DragMode) {
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(slot.id);
    if (slot.locked) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    dragRef.current = {
      slotId: slot.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...slot },
      rectWidth: rect.width,
      rectHeight: rect.height,
      snapshotBefore: slots.map((s) => ({ ...s })),
    };
  }

  const selectedSlot = slots.find((s) => s.id === selectedId) ?? null;

  return (
    <div
      style={{
        backgroundColor: "var(--panel-pink-light)",
        borderRadius: 32,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 18,
        minHeight: 560,
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* Toolbar #FE4E12 matching Figma Group 16 */}
      <div
        style={{
          backgroundColor: "var(--accent-orange-red)",
          borderRadius: 15,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            title="Tambah Slot Foto"
            onClick={handleAddSlot}
            disabled={!frame}
            style={toolbarBtnStyle(false, !frame)}
          >
            <PlusSquare size={26} />
          </button>
          <button
            type="button"
            title={selectedSlot?.locked ? "Buka Kunci Slot" : "Kunci Slot"}
            onClick={handleToggleLock}
            disabled={!selectedSlot}
            style={toolbarBtnStyle(Boolean(selectedSlot?.locked), !selectedSlot)}
          >
            <Lock size={25} />
          </button>
          <button
            type="button"
            title="Undo"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            style={toolbarBtnStyle(false, undoStack.length === 0)}
          >
            <CornerDownLeft size={25} />
          </button>
          <button
            type="button"
            title="Redo"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            style={toolbarBtnStyle(false, redoStack.length === 0)}
          >
            <CornerDownRight size={25} />
          </button>
          <button
            type="button"
            title="Hapus Slot Terpilih"
            onClick={handleDeleteSelected}
            disabled={!selectedSlot || selectedSlot.locked}
            style={toolbarBtnStyle(false, !selectedSlot || selectedSlot.locked)}
          >
            <Trash2 size={23} />
          </button>
        </div>

        <button
          type="button"
          title="Simpan Koordinat Slot"
          onClick={handleSave}
          disabled={!frame || saving}
          style={{
            background: "rgba(255,255,255,0.2)",
            border: "none",
            borderRadius: 10,
            color: "#ffffff",
            padding: "6px 12px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 700,
            opacity: !frame || saving ? 0.5 : 1,
          }}
        >
          <Check size={24} />
          <span>{saving ? "Menyimpan..." : "Simpan"}</span>
        </button>
      </div>

      {/* Canvas Stage */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(255,255,255,0.45)",
          borderRadius: 18,
          padding: 16,
          position: "relative",
        }}
      >
        {!frame ? (
          <p style={{ color: "var(--text-muted)", fontWeight: 600, textAlign: "center" }}>
            Pilih atau unggah template frame PNG di sebelah kiri untuk mengatur slot foto.
          </p>
        ) : (
          <>
            <div
              ref={stageRef}
              style={{
                position: "relative",
                display: "inline-block",
                maxWidth: "100%",
                maxHeight: 460,
                aspectRatio: `${frame.canvas_width} / ${frame.canvas_height}`,
                backgroundColor: "#ffffff",
                backgroundImage:
                  "linear-gradient(45deg, #eee 25%, transparent 25%), linear-gradient(-45deg, #eee 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #eee 75%), linear-gradient(-45deg, transparent 75%, #eee 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                userSelect: "none",
                touchAction: "none",
              }}
            >
              {/* Slot boxes rendered beneath transparent frame overlay */}
              {slots.map((slot, index) => {
                const isSelected = slot.id === selectedId;
                return (
                  <div
                    key={slot.id}
                    onPointerDown={(e) => startDrag(e, slot, "move")}
                    style={{
                      position: "absolute",
                      left: `${slot.xPct}%`,
                      top: `${slot.yPct}%`,
                      width: `${slot.wPct}%`,
                      height: `${slot.hPct}%`,
                      backgroundColor: isSelected
                        ? "rgba(1, 67, 161, 0.35)"
                        : "rgba(254, 78, 18, 0.25)",
                      border: isSelected ? "2px solid #0143a1" : "2px dashed #fe4e12",
                      cursor: slot.locked ? "not-allowed" : "move",
                      zIndex: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontWeight: 700,
                      fontSize: 12,
                      textShadow: "0 1px 2px rgba(0,0,0,0.7)",
                    }}
                  >
                    <span>
                      #{index + 1} {slot.locked ? "🔒" : ""}
                    </span>

                    {isSelected && !slot.locked && (
                      <>
                        {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                          <div
                            key={corner}
                            onPointerDown={(e) => startDrag(e, slot, corner)}
                            style={{
                              position: "absolute",
                              width: 12,
                              height: 12,
                              backgroundColor: "#ffcc00",
                              border: "2px solid #0143a1",
                              borderRadius: 3,
                              ...(corner.includes("n") ? { top: -6 } : { bottom: -6 }),
                              ...(corner.includes("w") ? { left: -6 } : { right: -6 }),
                              cursor: `${corner}-resize`,
                            }}
                          />
                        ))}
                      </>
                    )}
                  </div>
                );
              })}

              <img
                src={frame.image_url}
                alt={frame.name}
                draggable={false}
                style={{
                  position: "relative",
                  zIndex: 1,
                  width: "100%",
                  height: "100%",
                  display: "block",
                  pointerEvents: "none",
                }}
              />
            </div>

            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "var(--text-dark)",
                display: "flex",
                gap: 14,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <span>
                Dimensi: {frame.canvas_width}×{frame.canvas_height}px
              </span>
              <span>Total Slot: {slots.length}</span>
              {selectedSlot && (
                <span>
                  Terpilih: X {selectedSlot.xPct}% · Y {selectedSlot.yPct}% · W {selectedSlot.wPct}%
                  · H {selectedSlot.hPct}%
                </span>
              )}
              {statusMessage && (
                <span style={{ color: "#15803d", fontWeight: 700 }}>{statusMessage}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function toolbarBtnStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    background: active ? "#0143a1" : "transparent",
    border: "none",
    borderRadius: 8,
    color: "#ffffff",
    padding: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
