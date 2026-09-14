import fire from "../../../fixtures/v2/curved-fire/document.json";
import lightning from "../../../fixtures/v2/curved-lightning/document.json";
import beam from "../../../fixtures/v2/curved-beam/document.json";
import { createPresetV2, type RecipeV2Id } from "./recipes-v2";
import { validateDocumentV2 } from "./schema-v2";

/** Generator references are separate from the user-approved canonical fixtures. */
export function generationExampleV2(family: RecipeV2Id) {
  const examples = { "fire-projectile": fire, "lightning-impact": lightning, beam };
  if (family in examples) return validateDocumentV2(structuredClone(examples[family as keyof typeof examples]));
  const doc = createPresetV2(family);
  if (family !== "fire-slash") return doc;
  doc.paths = [{ id: "slash-path", points: [[0,0,0],[0,0,1.5],[2,0,2.5],[3,0,1]] }];
  for (const layer of doc.layers) {
    const shape = layer.kind === "trail" && layer.geometry?.type === "ribbon";
    const particles = layer.kind === "particles" && layer.emitter?.shape.type === "line";
    if (!shape && !particles) continue;
    layer.path = { pathId: "slash-path", mode: shape ? "shape" : "emit", range: [0,1], offset: [0,0], roll: 0 };
    layer.transform = { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] };
    layer.motion = null;
    layer.tracks = layer.tracks.filter(t => !t.target.startsWith("transform."));
    layer.overrides = [];
    if (layer.emitter) {
      layer.emitter.shape.axis = [0,0,1];
      layer.emitter.sub = null;
      layer.emitter.forces.curl = null;
      layer.emitter.forces.vortex = null;
      layer.emitter.forces.floor = null;
    }
  }
  return validateDocumentV2(doc);
}
