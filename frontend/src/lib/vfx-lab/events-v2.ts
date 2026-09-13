import { findPath, invertCurve, pathPoint } from "./paths-v2";
import type { Curve, LayerV2, VfxDocumentV2 } from "./schema-v2";

// ---------------------------------------------------------------------------
// Path events.
//
// A path in a v2 document is geometry, but it is also a CLOCK: something
// travels along it, and the moment its head reaches a given u is an event other
// layers want to hang off — a meteor's impact flash, its shock ring, the
// debris. Writing those times by hand means every one of them has to be redone
// when the descent is retimed, and one missed edit puts a flash under nothing.
//
// So the head is read back off whichever layer drives the path (a blob's
// blob.head, a path-anchored emitter's spawn.headCurve, a ribbon's
// window.head), its curve is inverted in closed form, and the moment is scaled
// into the driving layer's own window. `layer.window` then moves a layer onto
// that moment and `emitter.spawn.mode "event"` births instances at it.
//
// Everything here is a pure function of the document, evaluated once when it is
// loaded: no state, so seek == play.
// ---------------------------------------------------------------------------

/** The head curve a layer drives `pathId` with, or null when it drives none. */
function headCurveOf(layer: LayerV2, pathId: string): Curve | null {
  if (layer.blob?.pathId === pathId && layer.blob.head) return layer.blob.head;
  if (layer.emitter?.shape.pathId === pathId && layer.emitter.spawn.headCurve)
    return layer.emitter.spawn.headCurve;
  if (layer.ribbon?.pathId === pathId) return layer.ribbon.window.head;
  return null;
}

/**
 * The global time at which the head travelling `pathId` reaches `u`, or null
 * when nothing in the document drives that path. The earliest driver wins, so a
 * trail and the tip running the same path agree on one impact.
 */
export function pathEventTime(
  doc: VfxDocumentV2,
  pathId: string,
  u = 1,
): number | null {
  let best: number | null = null;
  for (const layer of doc.layers) {
    if (!layer.enabled) continue;
    const head = headCurveOf(layer, pathId);
    if (!head) continue;
    const span = Math.max(layer.end - layer.start, 1e-4);
    const time = layer.start + invertCurve(head, u) * span;
    if (best === null || time < best) best = time;
  }
  return best;
}

/**
 * The (origin, time) pairs `emitter.spawn.originsFromPath` hands to a layer:
 * one per path when `pathId` is null — so a single debris layer covers every
 * impact in the document — and one for that path alone when it is set. The
 * origin is the path's END, which is where the thing travelling it stops.
 */
export function pathEvents(
  doc: VfxDocumentV2,
  pathId: string | null,
): Array<{ position: [number, number, number]; time: number }> {
  const ids = pathId ? [pathId] : doc.paths.map((path) => path.id);
  const events: Array<{ position: [number, number, number]; time: number }> = [];
  for (const id of ids) {
    const path = findPath(doc, id);
    if (!path) continue;
    const time = pathEventTime(doc, id, 1);
    if (time === null) continue;
    events.push({ position: pathPoint(path, 1), time });
  }
  return events;
}

/**
 * The document with every `layer.window` resolved: the layer's start becomes
 * the event plus whatever offset it was authored with, and its duration is
 * kept. A window that names a path nothing drives is left alone, so a document
 * that loses its driver degrades to its authored times instead of vanishing.
 *
 * Applied once on load, before anything else reads a layer's window, so the
 * renderer, the framing pass and the capture path all see the same times.
 */
export function resolveEventWindows(doc: VfxDocumentV2): VfxDocumentV2 {
  if (!doc.layers.some((layer) => layer.window)) return doc;
  const layers = doc.layers.map((layer) => {
    if (!layer.window) return layer;
    const event = pathEventTime(doc, layer.window.at.pathId, layer.window.at.u);
    if (event === null) return layer;
    const span = Math.max(layer.end - layer.start, 1e-4);
    const start = Math.min(
      Math.max(0, event + layer.start),
      Math.max(0, doc.duration - 1e-3),
    );
    return { ...layer, start, end: Math.min(doc.duration, start + span) };
  });
  return { ...doc, layers };
}
