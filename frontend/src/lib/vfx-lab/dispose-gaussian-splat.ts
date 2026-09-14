import type { BufferAttribute, WebGPURenderer } from "three/webgpu";
import type { GaussianSplat } from "three/addons/objects/GaussianSplat.js";

type ComputeResource = { isComputeNode: true; dispose(): void };
type StorageResource = { isStorageBufferNode: true; value: BufferAttribute };
type AddonInternals = {
  _buffers: Record<string, unknown>;
  _sort: Record<string, unknown>;
  _sphericalHarmonicsComputeNode: ComputeResource | null;
};

/**
 * Three r186's GaussianSplat/CountingSort have no dispose method. Dispose their
 * compute nodes (releasing pipelines/bindings), material, draw/source geometry,
 * and storage attributes, including compute-only sort scratch buffers. Geometry
 * disposal alone misses those buffers. Keep this version-specific access here;
 * switch to the addon's public teardown when one becomes available.
 */
export function disposeGaussianSplat(splat: GaussianSplat, renderer: WebGPURenderer) {
  const internals = splat as unknown as AddonInternals;
  const attributes = new Set<BufferAttribute>();
  const nodes = new Set<ComputeResource>();
  for (const resource of [
    ...Object.values(internals._buffers),
    ...Object.values(internals._sort),
    internals._sphericalHarmonicsComputeNode,
  ]) {
    if (!resource || typeof resource !== "object") continue;
    if ("isComputeNode" in resource && resource.isComputeNode === true) {
      nodes.add(resource as ComputeResource);
    }
    if ("isStorageBufferNode" in resource && resource.isStorageBufferNode === true) {
      attributes.add((resource as StorageResource).value);
    }
  }
  for (const node of nodes) node.dispose();
  // Dispose geometry before material: its listener still needs the render
  // object's node attributes to release all buffers used by the vertex stage.
  splat.geometry.dispose();
  splat.material.dispose();
  splat.splatGeometry.dispose();
  // Renderer Attributes.delete is idempotent, updates memory counters, and
  // destroys both WebGPU buffers and WebGL fallback buffers. It is null before
  // renderer initialization, when no GPU resources have been allocated yet.
  const attributeManager = (renderer as unknown as {
    _attributes: { delete(attribute: BufferAttribute): unknown } | null;
  })._attributes;
  for (const attribute of attributes) attributeManager?.delete(attribute);
}
