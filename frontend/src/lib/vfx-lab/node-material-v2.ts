import type { IUniform } from "three";
import * as THREE from "three/webgpu";
import {
  attribute,
  texture,
  reference,
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

/** Every draw the V2 renderer makes, and the generated vertex/fragment pair it
 * is built from. Adding a layer kind means adding its programs to
 * scripts/webgpu/port-shaders.mts and one line here. */
const PROGRAMS = {
  particle: ["particleVertex", "particleFragment"],
  subParticle: ["subParticleVertex", "particleFragment"],
  trail: ["trailVertex", "trailFragment"],
  subTrail: ["subTrailVertex", "trailFragment"],
  strip: ["stripVertex", "stripFragment"],
  sliver: ["sliverVertex", "sliverFragment"],
  surface: ["surfaceVertex", "surfaceFragment"],
  blob: ["blobVertex", "blobFragment"],
  crystal: ["crystalVertex", "crystalFragment"],
  splash: ["splashVertex", "splashFragment"],
  ribbon: ["ribbonVertex", "ribbonFragment"],
  wireBurst: ["wireBurstVertex", "wireBurstFragment"],
  arc: ["arcVertex", "arcFragment"],
  streak: ["streakVertex", "streakFragment"],
  sheet: ["sheetVertex", "sheetFragment"],
  crescent: ["crescentVertex", "crescentFragment"],
  lick: ["lickVertex", "lickFragment"],
} as const satisfies Record<string, readonly [string, string]>;

export type ShaderName = keyof typeof PROGRAMS;
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
  const [vertexName, fragmentName] = PROGRAMS[kind];
  const graphs = shaders as unknown as Record<
    string,
    ((b: Record<string, THREE.Node>) => THREE.Node) & Record<string, Binding>
  >;
  const declarations = graphs as unknown as Record<string, Record<string, Binding>>;
  const definitions = {
    ...declarations[`${vertexName}Bindings`],
    ...declarations[`${fragmentName}Bindings`],
  };
  const bindings: Record<string, THREE.Node> = {};
  // Report the whole set at once: a program that gains a uniform block usually
  // needs several, and one name per rebuild is a slow way to find that out.
  const missing = Object.entries(definitions)
    .filter(([name, binding]) => binding.kind === "uniform" && !uniforms[name])
    .map(([name]) => name);
  if (missing.length)
    throw new Error(
      `Missing V2 shader uniforms for ${kind}: ${missing.join(", ")}`,
    );
  for (const [name, binding] of Object.entries(definitions)) {
    if (binding.kind === "uniform") {
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
      } else if (binding.size) {
        // Three names a uniform buffer's WGSL struct after the node's id unless
        // the node carries a name. Naming it keeps the generated text identical
        // between two materials of the same kind, which is what lets them share
        // a compiled program.
        const node = uniformArray(uniforms[name].value, binding.type);
        node.setName(name);
        bindings[name] = node;
      }
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
  // Stable, engine-neutral program identity for native engine exports.
  material.userData.avfxProgram = kind;

  material.vertexNode = graphs[vertexName](bindings);
  material.fragmentNode = graphs[fragmentName](bindings);
  return material;
}
