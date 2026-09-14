import * as THREE from "three";
import type { LayerV2, VfxDocumentV2 } from "./schema-v2";
import {
  PATH_SAMPLES,
  sampleEffectPath,
  pathFrameAt,
  pathVector,
  type SampledPath,
} from "./effect-path";

export type LayerPath = {
  path: SampledPath;
  mode: "shape" | "emit" | "follow";
  spread: boolean;
  baseLength: number;
};
/** Convert the reference-space path into a rigid layer's local coordinates.
 * The normal runtime placement matrix then handles both path and legacy layers. */
export function layerPath(
  doc: VfxDocumentV2,
  layer: LayerV2,
): LayerPath | undefined {
  const attachment = layer.path;
  if (!attachment) return;
  const definition = doc.paths?.find((p) => p.id === attachment.pathId);
  if (!definition) throw new Error(`Missing effect path ${attachment.pathId}`);
  const source = sampleEffectPath(definition);
  const anchor = doc.authoringFrame ?? {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  };
  const matrix = new THREE.Matrix4()
    .compose(
      new THREE.Vector3(...layer.transform.position),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...layer.transform.rotation),
      ),
      new THREE.Vector3(1, 1, 1),
    )
    .invert()
    .multiply(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...anchor.position),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...anchor.rotation),
        ),
        new THREE.Vector3(1, 1, 1),
      ),
    );
  const [start, end] = attachment.range;
  const frames = Array.from({ length: PATH_SAMPLES }, (_, i) => {
    const frame = pathFrameAt(
      source,
      source.length * (start + ((end - start) * i) / (PATH_SAMPLES - 1)),
    );
    frame.normal.applyAxisAngle(frame.tangent, attachment.roll);
    frame.position.add(
      pathVector(frame, new THREE.Vector3(...attachment.offset, 0)),
    );
    frame.position.applyMatrix4(matrix);
    frame.normal.transformDirection(matrix);
    frame.tangent.transformDirection(matrix);
    return frame;
  });
  return {
    path: { length: source.length * (end - start), frames },
    mode: attachment.mode,
    spread: layer.emitter?.shape.type === "line",
    baseLength: layer.geometry?.length ?? 1,
  };
}
export function pathUniforms(
  binding?: LayerPath,
): Record<string, THREE.IUniform> {
  const frames =
    binding?.path.frames ??
    Array.from({ length: PATH_SAMPLES }, () => ({
      position: new THREE.Vector3(),
      normal: new THREE.Vector3(1, 0, 0),
      tangent: new THREE.Vector3(0, 0, 1),
    }));
  return {
    uEffectPathMode: {
      value: binding ? { shape: 1, emit: 2, follow: 3 }[binding.mode] : 0,
    },
    uEffectPathBaseLength: { value: binding?.baseLength ?? 1 },
    uEffectPathLength: { value: binding?.path.length ?? 1 },
    uEffectPathSpread: { value: binding?.spread ? 1 : 0 },
    // Interleaving all three vectors uses one UBO, not three. Trail materials
    // otherwise exceed WebGPU's default 12 uniform buffers per shader stage.
    uEffectPathData: {
      value: frames.flatMap((f) => [f.position, f.normal, f.tangent]),
    },
  };
}
/** Birth direction is path-local. Gravity and wind remain layer-local and are
 * added by the existing trajectory evaluator after this function. */
export function pathParticlePosition(
  binding: LayerPath,
  spawn: number,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  distance: number,
  out: THREE.Vector3,
): void {
  const birth = (binding.spread ? spawn : 0) * binding.path.length;
  const frame = pathFrameAt(
    binding.path,
    birth + (binding.mode === "follow" ? distance : 0),
  );
  out
    .copy(frame.position)
    .add(pathVector(frame, new THREE.Vector3(origin.x, origin.y, 0)));
  if (binding.mode === "emit")
    out.addScaledVector(pathVector(frame, direction), distance);
}
