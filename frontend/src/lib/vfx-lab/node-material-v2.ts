import type { IUniform } from "three";
import * as THREE from "three/webgpu";
import {
  attribute,
  reference,
  texture,
  uniformArray,
  varying,
  vec2,
  vec3,
  vec4,
  float,
  int,
} from "three/tsl";
import * as shaders from "./shaders-v2-nodes.js";

type Binding = { type: string; kind: string; size?: number };
type ShaderName = "particle" | "subParticle" | "trail" | "subTrail" | "surface";
export type V2NodeMaterial = THREE.NodeMaterial & {
  uniforms: Record<string, IUniform>;
};

/** Bind the existing document evaluator to static TSL graphs. References read
 * live uniform values on each draw, including replacement textures and arrays.
 * Vertex and fragment graphs share the same varying objects.
 */
export function createV2NodeMaterial(
  kind: ShaderName,
  uniforms: Record<string, IUniform>,
  parameters: THREE.MaterialParameters,
): V2NodeMaterial {
  const vertexName = `${kind}Vertex` as const;
  const fragmentName =
    `${kind.includes("Trail") || kind === "trail" ? "trail" : kind.includes("Particle") || kind === "particle" ? "particle" : "surface"}Fragment` as const;
  const definitions = {
    ...shaders[`${vertexName}Bindings`],
    ...shaders[`${fragmentName}Bindings`],
  } as Record<string, Binding>;
  const bindings: Record<string, THREE.Node> = {};
  for (const [name, binding] of Object.entries(definitions)) {
    if (binding.kind === "uniform") {
      if (!uniforms[name])
        throw new Error(`Missing V2 shader uniform: ${name}`);
      if (binding.type === "sampler2D") {
        const node = texture(uniforms[name].value ?? undefined);
        const fallback = node.value;
        const originalUpdate = node.update.bind(node);
        node.onObjectUpdate((frame) => {
          node.value = uniforms[name].value ?? fallback;
          originalUpdate(frame);
        });
        bindings[name] = node;
      } else if (/^u(?:Curve[A-Z]N|RampN|(?:Parent)?SpeedN|(?:Parent)?BurstN|Procedural|RenderMode|SmokeLit|SmokeCard)$/.test(name)) {
        // These values are structural within an installed document. Baking them
        // lets the GPU unroll short curve/ramp loops and discard unused shapes.
        // Edits install new materials; animated keys preserve the same lengths.
        bindings[name] = int(uniforms[name].value);
      } else if (binding.size)
        bindings[name] = uniformArray(uniforms[name].value, binding.type);
      else
        bindings[name] = reference(
          "value",
          uniforms[name].value?.isColor ? "color" : binding.type,
          uniforms[name],
        );
    } else if (binding.kind === "attribute") {
      bindings[name] = attribute(name, binding.type);
    } else {
      const value =
        binding.type === "vec2"
          ? vec2()
          : binding.type === "vec3"
            ? vec3()
            : binding.type === "vec4"
              ? vec4()
              : float();
      bindings[name] = varying(value, name);
    }
  }
  const material = new THREE.NodeMaterial() as V2NodeMaterial;
  material.setValues(parameters);
  // V2 effects author their shading; litSmoke uses explicit light uniforms.
  // Fog only affects scene dressing.
  material.fog = false;
  material.forceSinglePass = true;
  material.uniforms = uniforms;

  material.vertexNode = shaders[vertexName](bindings);
  material.fragmentNode = shaders[fragmentName](bindings);
  return material;
}
