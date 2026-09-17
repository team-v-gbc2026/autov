import * as THREE from "three/webgpu";
import { meshGlb, type PackedAttribute } from "./binary";

export function instanced(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  return (attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute ||
    (attribute instanceof THREE.InterleavedBufferAttribute &&
      attribute.data instanceof THREE.InstancedInterleavedBuffer);
}

export function packAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): PackedAttribute {
  const values: number[] = [];
  for (let i = 0; i < attribute.count; i++) for (let k = 0; k < attribute.itemSize; k++) {
    const value = attribute.getComponent(i, k);
    if (!Number.isFinite(value)) throw new Error("Non-finite mesh attribute in AVFX export.");
    values.push(value);
  }
  return { itemSize: attribute.itemSize, count: attribute.count, values };
}

/** Immutable, content-deduplicated snapshots. Neither object identity nor GPU
 * upload versions prove that CPU geometry has stayed unchanged between samples. */
export class MeshSnapshots {
  private buckets = new Map<number, Array<{ path: string; bytes: Uint8Array }>>();
  private count = 0;
  constructor(private put: (path: string, bytes: Uint8Array) => void) {}

  capture(geometry: THREE.BufferGeometry, mode: 1 | 4 = 4): string {
    const attributes = Object.fromEntries(Object.entries(geometry.attributes)
      .filter(([, attribute]) => !instanced(attribute))
      .map(([name, attribute]) => [name, packAttribute(attribute)]));
    if (!attributes.position) throw new Error("Export draw has no position attribute.");
    const bytes = meshGlb({ attributes, indices: geometry.index ? packAttribute(geometry.index).values : null, mode });
    // Hash only selects a bucket; byte comparison makes collisions harmless.
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    const bucket = this.buckets.get(hash) ?? [];
    for (const entry of bucket) {
      if (entry.bytes.length === bytes.length && entry.bytes.every((byte, i) => byte === bytes[i])) return entry.path;
    }
    const path = `meshes/mesh-${this.count}.glb`;
    this.put(path, bytes);
    this.count++;
    bucket.push({ path, bytes });
    this.buckets.set(hash, bucket);
    return path;
  }
}
