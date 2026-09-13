import * as THREE from "three/webgpu";
import type { IUniform } from "three";
import type { Curve, Ramp } from "./schema-v2";
export const CURVE_KEYS = 8;
export const RAMP_STOPS = 6;

export function rampUniforms(ramp: Ramp) {
  const colors: THREE.Vector4[] = [];
  const stops: number[] = [];
  for (let i = 0; i < RAMP_STOPS; i++) {
    const stop = ramp.stops[Math.min(i, ramp.stops.length - 1)];
    // `new THREE.Color(hex)` already converts sRGB -> linear; converting again
    // washes the whole palette out.
    const color = new THREE.Color(stop.color);
    colors.push(new THREE.Vector4(color.r, color.g, color.b, stop.intensity));
    stops.push(stop.t);
  }
  return {
    uRamp: { value: colors },
    uRampT: { value: stops },
    uRampN: { value: ramp.stops.length },
  };
}

export function writeRamp(uniforms: Record<string, IUniform>, ramp: Ramp) {
  const colors = uniforms.uRamp.value as THREE.Vector4[];
  const stops = uniforms.uRampT.value as number[];
  for (let i = 0; i < RAMP_STOPS; i++) {
    const stop = ramp.stops[Math.min(i, ramp.stops.length - 1)];
    const color = new THREE.Color(stop.color);
    colors[i].set(color.r, color.g, color.b, stop.intensity);
    stops[i] = stop.t;
  }
  uniforms.uRampN.value = ramp.stops.length;
}

const FALLBACK_CURVE: Curve = {
  keys: [[0, 1] as [number, number], [1, 1]],
  ease: "linear",
};

export function curveUniforms(name: string, curve: Curve | null) {
  const source = curve ?? FALLBACK_CURVE;
  const keys: THREE.Vector2[] = [];
  for (let i = 0; i < CURVE_KEYS; i++) {
    const key = source.keys[Math.min(i, source.keys.length - 1)];
    keys.push(new THREE.Vector2(key[0], key[1]));
  }
  return {
    [`uCurve${name}`]: { value: keys },
    [`uCurve${name}N`]: { value: source.keys.length },
    [`uCurve${name}Ease`]: { value: source.ease === "smooth" ? 1 : 0 },
  };
}

export function writeCurve(
  uniforms: Record<string, IUniform>,
  name: string,
  curve: Curve | null,
) {
  const source = curve ?? FALLBACK_CURVE;
  const keys = uniforms[`uCurve${name}`].value as THREE.Vector2[];
  for (let i = 0; i < CURVE_KEYS; i++) {
    const key = source.keys[Math.min(i, source.keys.length - 1)];
    keys[i].set(key[0], key[1]);
  }
  uniforms[`uCurve${name}N`].value = source.keys.length;
  uniforms[`uCurve${name}Ease`].value = source.ease === "smooth" ? 1 : 0;
}
