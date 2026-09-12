import {
  type Layer,
  type Params,
  type VfxDocument,
  type Override,
  validateDocument,
  validateOverride,
} from "./schema";

export const clamp = (v: number, lo = 0, hi = 1) =>
  Math.min(hi, Math.max(lo, v));
export function random(
  seed: number,
  layer: string,
  id: number,
  attribute: string,
) {
  let h = seed >>> 0;
  for (const c of `${layer}:${id}:${attribute}`)
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function windowWeight(o: Override, t: number) {
  if (t < o.start || t >= o.end) return 0;
  if (!o.fade) return 1;
  const u = clamp(Math.min((t - o.start) / o.fade, (o.end - t) / o.fade));
  return u * u * (3 - 2 * u);
}
function mixColor(a: string, b: string, w: number) {
  const channels = [1, 3, 5].map((i) =>
    Math.round(
      parseInt(a.slice(i, i + 2), 16) * (1 - w) +
        parseInt(b.slice(i, i + 2), 16) * w,
    )
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${channels.join("")}`;
}
export function evaluateLayer(
  layer: Layer,
  time: number,
): { visible: boolean; params: Params; age: number } {
  const p = { ...layer.params, position: [...layer.params.position] as Params["position"] };
  const age = time - layer.start;
  for (const track of layer.tracks) {
    const keys = track.keys;
    let value = keys[0][1];
    if (age >= keys[keys.length - 1][0]) value = keys[keys.length - 1][1];
    else
      for (let i = 1; i < keys.length; i++) {
        if (age <= keys[i][0]) {
          let u = clamp((age - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
          if (track.ease === "smooth") u = u * u * (3 - 2 * u);
          if (track.ease === "outCubic") u = 1 - (1 - u) ** 3;
          if (track.ease === "inQuad") u *= u;
          value = keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * u;
          break;
        }
      }
    p[track.target] = value;
  }
  if (layer.motion) {
    const keys = layer.motion.keys;
    let offset = keys[0].slice(1);
    if (age >= keys[keys.length - 1][0]) offset = keys[keys.length - 1].slice(1);
    else for (let i = 1; i < keys.length; i++) {
      if (age <= keys[i][0]) {
        let u = clamp((age - keys[i-1][0]) / (keys[i][0] - keys[i-1][0]));
        if (layer.motion.ease === "smooth") u = u*u*(3-2*u);
        offset = [1,2,3].map(j => keys[i-1][j] + (keys[i][j] - keys[i-1][j])*u);
        break;
      }
    }
    p.position = p.position.map((v,i) => v + offset[i]) as Params["position"];
  }
  for (const o of layer.overrides) {
    const w = windowWeight(o, time);
    if (w === 0) continue; // Exactly preserve protected values; no round-trip color conversion.
    if (o.target === "color" && typeof o.value === "string")
      p.color = mixColor(p.color, o.value, w);
    else if (o.target !== "color" && typeof o.value === "number")
      p[o.target] += (o.value - p[o.target]) * w;
  }
  return {
    visible: layer.enabled && age >= 0 && time < layer.end,
    params: p,
    age,
  };
}
export function applyScopedEdit(
  doc: VfxDocument,
  layerId: string,
  input: unknown,
) {
  const o = validateOverride(input, doc.duration);
  // Motion controls would change entire particle trajectories. Limit window edits to appearance.
  if (
    ![
      "color",
      "intensity",
      "opacity",
      "radius",
      "width",
      "length",
      "erosion",
    ].includes(o.target)
  )
    throw new Error(
      "Time-scoped edits support appearance only. Motion needs a whole-layer edit.",
    );
  const next = structuredClone(doc);
  const layer = next.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error("Unknown layer.");
  layer.overrides.push(o);
  return validateDocument(next);
}
export function sampleTimes(doc: VfxDocument) {
  // Inspect real event onsets: model prose and nominal impact metadata may disagree.
  const impacts = doc.layers
    .filter((l) => l.enabled && l.role === "impact")
    .map((l) => l.start);
  const impact = impacts.length ? Math.min(...impacts) : doc.impact;
  const normalize = (t: number) => Math.round(clamp(t, 0, doc.duration - .001)*1000)/1000;
  const selected = new Set<number>([0, normalize(doc.duration-.001)]);
  // Capture short primary events first; a later strike must not disappear between generic samples.
  const events=doc.layers.filter(l=>l.enabled && (l.role==="primary" || l.role==="impact"));
  const priority=[
    Math.max(0,impact-.02),impact+.02,
    ...events.filter(l=>l.end-l.start<=.5).map(l=>(l.start+l.end)/2),
    ...events.map(l=>l.start+Math.min(.08,(l.end-l.start)*.3)),
    impact*.5,impact+.18,impact+.35,impact+.65,doc.duration*.35,doc.duration*.65,doc.duration*.82,
  ];
  for(const time of priority){if(selected.size>=12)break;selected.add(normalize(time));}
  for(let i=1;selected.size<12 && i<24;i++)selected.add(normalize(doc.duration*i/24));
  return [...selected].sort((a,b)=>a-b);
}
// CPU oracle matching the analytic particle shader (before object rotation / translation).
export function particleAt(
  doc: VfxDocument,
  layer: Layer,
  id: number,
  time: number,
) {
  const p = evaluateLayer(layer, time).params;
  const r = (key: string) => random(doc.seed, layer.id, id, key);
  const age = time - layer.start - r("birth") * p.emission;
  const life = p.life * (0.65 + r("life") * 0.35);
  const a = r("angle") * Math.PI * 2,
    y = (r("height") * 2 - 1) * p.spread;
  const radius = Math.sqrt(1 - y * y),
    v = p.speed * (0.4 + r("speed") * 0.6);
  const d = p.drag < 0.001 ? age : (1 - Math.exp(-p.drag * age)) / p.drag;
  return {
    id,
    birth: layer.start + r("birth") * p.emission,
    alive: age >= 0 && age < life && time < layer.end && layer.enabled,
    position: [
      Math.cos(a) * radius * (p.radius * r("origin") + v * d),
      y * v * d + 0.5 * p.gravity * age * age,
      Math.sin(a) * radius * (p.radius * r("origin") + v * d),
    ],
  };
}
