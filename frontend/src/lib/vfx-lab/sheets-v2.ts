import * as THREE from "three";
import type { Sheets } from "./schema-v2";
import { smoothstep } from "./blob-v2";

// ---------------------------------------------------------------------------
// The sheets generator: `layer.sheets` -> curved, tapered, opaque membranes.
//
// A generator like blob, splash and crystals: the document says how the tail is
// shaped and every sheet's size, curl, heading, sway and tumble is hashed out
// of (sheets.seed, index). What none of the others has is a MULTI-CADENCE
// schedule — each size class re-fires on its own `period` and the births inside
// a class are spread evenly across it, so coverage is uniform at every t and no
// sheet is ever clipped by its own re-fire.
//
// Everything is a pure function of (sheets, index, layer-local time): the
// absolute birth of the instance alive at t is
//
//     birth(t) = birth0 + floor((t - birth0) / period) * period
//
// which is the whole of the state a looping emitter needs.
// ---------------------------------------------------------------------------

export interface Sheet {
  index: number;
  /** Which size class this sheet belongs to, and its slot inside that class. */
  klass: number;
  /** Birth of the FIRST firing, in layer-local seconds, and the cadence. */
  birth0: number;
  period: number;
  life: number;
  length: number;
  width: number;
  curl: number;
  /** Sign and depth of the shallow arc along the length. */
  bow: number;
  /** Metres along the flow axis the sheet starts at (negative = inside). */
  start: number;
  /** Metres across the flow axis the sheet is offset by. */
  lateral: number;
  speed: number;
  /** Lateral swim: amplitude, angular rate and phase. */
  sway: [number, number, number];
  /** Roll about the flow axis at birth, and its rate. */
  roll: [number, number];
  /** Yaw wobble amplitude, so the crescents do not all face the same way. */
  yaw: number;
  hash: number;
}

function hash(seed: number, index: number, channel: number) {
  const x =
    Math.sin(seed * 0.0137 + index * 127.1 + channel * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The population. Classes are dealt out by a golden-ratio walk through the
 * cumulative weights rather than by `i % n`, so a three-class tail interleaves
 * its big and small sheets instead of banding them; the slot index inside a
 * class is then just how many earlier sheets share it.
 */
export function sheetInstances(spec: Sheets): Sheet[] {
  const total = spec.classes.reduce((sum, c) => sum + c.weight, 0) || 1;
  const pick: number[] = [];
  const perClass = new Array(spec.classes.length).fill(0);
  for (let i = 0; i < spec.count; i++) {
    const f = (i * 0.6180339887498949) % 1;
    let acc = 0;
    let k = spec.classes.length - 1;
    for (let c = 0; c < spec.classes.length; c++) {
      acc += spec.classes[c].weight / total;
      if (f < acc) {
        k = c;
        break;
      }
    }
    pick.push(k);
    perClass[k]++;
  }

  const sheets: Sheet[] = [];
  const slot = new Array(spec.classes.length).fill(0);
  for (let i = 0; i < spec.count; i++) {
    const k = pick[i];
    const cls = spec.classes[k];
    const h = (n: number) => hash(spec.seed, i, n);
    const n = Math.max(1, perClass[k]);
    const index = slot[k]++;
    sheets.push({
      index: i,
      klass: k,
      // Evenly spread inside the class's own cadence, nudged by a third of a
      // slot so two classes never fire on the same frame.
      birth0: (index + h(1) * 0.35) * (cls.period / n),
      period: cls.period,
      life: cls.life,
      length: lerp(spec.length[0], spec.length[1], h(2)) * cls.length,
      width: lerp(spec.width[0], spec.width[1], h(3)) * cls.width,
      curl: lerp(spec.curl[0], spec.curl[1], h(4)),
      bow: spec.bow * (h(5) > 0.5 ? 1 : -1),
      start: lerp(spec.spawn.axisFrom, spec.spawn.axisTo, h(6)),
      lateral: (h(7) - 0.5) * spec.width[1] * 1.6,
      speed: lerp(spec.speed[0], spec.speed[1], h(8)) * cls.speed,
      sway: [
        spec.undulation.amplitude * (0.5 + h(9)),
        spec.undulation.frequency * 6.2831853 * (0.7 + 0.6 * h(10)),
        h(11) * 6.2831853,
      ],
      roll: [h(12) * 6.2831853, (h(13) - 0.5) * 2 * spec.tumble],
      yaw: (h(14) - 0.5) * 0.7,
      hash: i * 3.7 + 1.3,
    });
  }
  return sheets;
}

/**
 * One sheet, in its own local frame: +X runs along the length (centred), the
 * strip is bent around that axis by `curl` and bowed in +Y by `bow`. The width
 * profile is a sin() raised to `taper`, so the membrane is pinched at both ends
 * and widest in the middle — a crescent, not a card.
 */
export function sheetGeometry(sheet: Sheet, spec: Sheets) {
  const NU = 18;
  const NV = 7;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const curl = Math.max(0.25, sheet.curl);
  const radius = sheet.width / curl;
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    const w =
      sheet.width *
      Math.pow(Math.sin(Math.PI * Math.min(0.999, 0.06 + u * 0.94)), spec.taper);
    const bow = Math.sin(Math.PI * u) * sheet.length * sheet.bow;
    const k = w / Math.max(1e-3, sheet.width);
    for (let j = 0; j <= NV; j++) {
      const v = j / NV - 0.5;
      const a = v * curl * k;
      positions.push(
        u * sheet.length - sheet.length * 0.5,
        radius * Math.sin(a) * k + bow,
        radius * (Math.cos(a) - 1) * k,
      );
      uvs.push(u, v + 0.5);
    }
  }
  for (let i = 0; i < NU; i++)
    for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j;
      const b = a + NV + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface SheetState {
  visible: boolean;
  /** Layer-space position of the sheet's centre. */
  position: [number, number, number];
  /** Roll about the flow axis, and the yaw wobble across it. */
  roll: number;
  yaw: number;
  scale: number;
  /** 0..1 through this firing's own life; the tear threshold rides it. */
  age01: number;
}

/**
 * The absolute birth of the firing of `sheet` alive at layer-local `time`.
 * Closed form: nothing is spawned before the layer starts or after `until`, so
 * the appear and the fade need no state at all.
 */
export function sheetBirthAt(sheet: Sheet, time: number) {
  const k = Math.floor((time - sheet.birth0) / Math.max(sheet.period, 1e-4));
  return sheet.birth0 + k * sheet.period;
}

export function sheetStateAt(
  sheet: Sheet,
  spec: Sheets,
  time: number,
  /** Layer-local seconds after which nothing new is born (the fade-out). */
  until: number,
): SheetState {
  const birth = sheetBirthAt(sheet, time);
  const age = time - birth;
  const dead = birth < 0 || birth > until || age < 0 || age >= sheet.life;
  if (dead)
    return {
      visible: false,
      position: [0, 0, 0],
      roll: 0,
      yaw: 0,
      scale: 0,
      age01: 0,
    };
  const u = age / sheet.life;
  const d = sheet.start + sheet.speed * age;
  const sway =
    sheet.sway[0] *
    Math.sin(sheet.sway[1] * age + sheet.sway[2]) *
    (0.35 + 0.65 * Math.min(1, age * 2.2));
  const grow = smoothstep(0, Math.max(spec.scaleIn, 1e-3), age);
  const shrink = 1 - smoothstep(1 - spec.shrinkOut, 1, u);
  const scale = grow * shrink * (0.85 + 0.15 * u);
  return {
    visible: scale > 0.02,
    // Along the flow axis, across it by the sheet's own lateral offset, and
    // drooping slightly with distance: the tail sags as it leaves the head.
    position: [d, sheet.lateral * (0.4 + 0.6 * u), sway - 0.02 * d],
    roll: sheet.roll[0] + sheet.roll[1] * age,
    yaw: sheet.yaw * Math.sin(age * 1.7 + sheet.sway[2]),
    scale,
    age01: u,
  };
}

/**
 * Layer-local envelope of the tail, for framing: the flow axis from the
 * earliest start to the furthest a MEDIAN sheet reaches, plus the widest sheet
 * across it. The fastest class deliberately leaves the claimed volume — a tail
 * that streams out of frame is the point — the same way a streak fan claims its
 * median reach rather than its maximum.
 */
export function sheetsBounds(spec: Sheets): THREE.Vector3[] {
  const median =
    spec.classes.reduce((sum, c) => sum + c.speed * c.life, 0) /
    Math.max(1, spec.classes.length);
  const reach =
    spec.spawn.axisTo +
    ((spec.speed[0] + spec.speed[1]) * 0.5) * median +
    spec.length[1] * 0.5;
  const across = spec.width[1] * 1.6 + spec.undulation.amplitude;
  const points: THREE.Vector3[] = [];
  for (const along of [Math.min(spec.spawn.axisFrom, 0), reach])
    for (const x of [-across, across])
      for (const y of [-across, across])
        points.push(new THREE.Vector3(along, x, y));
  return points;
}
