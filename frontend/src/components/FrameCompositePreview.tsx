import { FrameItem, PhotoItem, SelectedPhotoSlot } from "../api/client";

interface FrameCompositePreviewProps {
  frame: FrameItem | null;
  selectedPhotos: Record<string, SelectedPhotoSlot>;
  photoMap?: Record<string, PhotoItem>;
  activeSlotId?: string | null;
  onSelectSlot?: (slotId: string) => void;
  interactive?: boolean;
  maxHeight?: number;
}

export function FrameCompositePreview({
  frame,
  selectedPhotos,
  photoMap = {},
  activeSlotId = null,
  onSelectSlot,
  interactive = false,
  maxHeight = 480,
}: FrameCompositePreviewProps) {
  if (!frame) {
    return (
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          aspectRatio: "349 / 477",
          backgroundColor: "var(--surface-gray)",
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          textAlign: "center",
          fontWeight: 600,
          color: "var(--text-muted)",
          margin: "0 auto",
        }}
      >
        Pilih frame untuk melihat preview
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxHeight,
        aspectRatio: `${frame.canvas_width} / ${frame.canvas_height}`,
        margin: "0 auto",
        backgroundColor: "#ffffff",
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.18)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {/* Photo slots placed beneath transparent PNG overlay */}
      {frame.slots.map((slot, index) => {
        const assignment = selectedPhotos[slot.id];
        const photo = assignment ? photoMap[assignment.filename] : undefined;
        const imgUrl = photo?.preview_url || photo?.thumb_url;
        const isActive = interactive && activeSlotId === slot.id;

        const posX = assignment ? 50 + assignment.offsetX * 50 : 50;
        const posY = assignment ? 50 + assignment.offsetY * 50 : 50;
        const zoom = assignment ? assignment.zoom : 1;

        return (
          <div
            key={slot.id}
            style={{
              position: "absolute",
              left: `${slot.xPct}%`,
              top: `${slot.yPct}%`,
              width: `${slot.wPct}%`,
              height: `${slot.hPct}%`,
              backgroundColor: "#d9d9d9",
              overflow: "hidden",
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={assignment.filename}
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: `${posX}% ${posY}%`,
                  transform: `scale(${zoom})`,
                  transformOrigin: `${posX}% ${posY}%`,
                  display: "block",
                }}
              />
            ) : (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#555555",
                  userSelect: "none",
                }}
              >
                Slot {index + 1}
              </span>
            )}

            {interactive && (
              <button
                type="button"
                aria-label={`Pilih slot ${index + 1}`}
                onClick={() => onSelectSlot?.(slot.id)}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 3,
                  border: isActive ? "3px solid var(--brand-blue)" : "2px dashed rgba(1, 67, 161, 0.45)",
                  backgroundColor: isActive ? "rgba(1, 67, 161, 0.08)" : "transparent",
                  padding: 0,
                }}
              />
            )}
          </div>
        );
      })}

      {/* Frame PNG overlay */}
      <img
        src={frame.image_url}
        alt={frame.name}
        draggable={false}
        style={{
          position: "relative",
          zIndex: 2,
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
