"use client";
import type { EffectPath } from "@/lib/vfx-lab/effect-path";
import type {
  CurveEditController,
  CurveEditSnapshot,
} from "@/lib/vfx-lab/curve-edit-controller";

export default function CurveEditControls({
  paths,
  controller,
  snapshot,
}: {
  paths: EffectPath[];
  controller: CurveEditController | null;
  snapshot: CurveEditSnapshot;
}) {
  if (!paths.length) return null;
  return (
    <div
      className="lab-curve-edit-controls"
      role="group"
      aria-label="Curve editing"
    >
      <label>
        Curve point{" "}
        <select
          aria-label="Curve point"
          disabled={!controller || snapshot.dragging}
          value={
            snapshot.selected
              ? `${snapshot.selected.pathId}:${snapshot.selected.index}`
              : ""
          }
          onChange={(event) => {
            const [pathId, index] = event.target.value.split(":");
            controller?.select(
              pathId ? { pathId, index: Number(index) } : null,
            );
          }}
        >
          <option value="">Select a point…</option>
          {paths.flatMap((path) =>
            path.points.map((_, index) => (
              <option key={`${path.id}:${index}`} value={`${path.id}:${index}`}>
                {path.id} ·{" "}
                {index % 3 === 0
                  ? `Endpoint ${index / 3 + 1}`
                  : `Control ${index}`}
              </option>
            )),
          )}
        </select>
      </label>
      <button
        type="button"
        className="icon-button"
        disabled={!controller || !snapshot.dirty || snapshot.dragging}
        onClick={() => controller?.apply()}
      >
        Apply curve
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={!snapshot.active && !snapshot.dirty}
        onClick={() => controller?.cancel()}
      >
        Cancel
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={
          !controller ||
          !snapshot.canUndo ||
          snapshot.dirty ||
          snapshot.dragging
        }
        onClick={() => controller?.undo()}
      >
        Undo curve
      </button>
      <span role="status">
        {snapshot.error ||
          (snapshot.dirty
            ? "Draft only — Apply updates the effect."
            : snapshot.active
              ? "Drag the move arrows. Escape cancels."
              : "Click a cyan endpoint or amber control point.")}
      </span>
    </div>
  );
}
