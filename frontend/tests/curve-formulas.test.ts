import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compileCurveFormula, CurveFormulaSchema, validateDocumentV2 } from "../src/lib/vfx-lab/schema-v2";
import { applyLayerPatch, projectToUi } from "../src/lib/vfx-lab/ui-bridge";
const formula = {kind: "envelope" as const, start: 0, end: 0, peak: 2, attack: 0.15, release: 0.65};
test("bounded formulas compile exact breakpoints", () => {
  assert.deepEqual(compileCurveFormula(formula), {keys:[[0,0],[0.15,2],[0.65,2],[1,0]],ease:"smooth"});
  assert.deepEqual(compileCurveFormula({...formula,kind:"constant",start:3}).keys, [[0,3],[1,3]]);
  assert.equal(CurveFormulaSchema.safeParse({...formula,attack:NaN}).success,false);
  assert.equal(CurveFormulaSchema.safeParse({...formula,kind:"eval"}).success,false);
});
test("formulas only require the fields their kind reads", () => {
  assert.equal(CurveFormulaSchema.safeParse({kind:"ramp",start:0,end:1}).success,true);
  assert.equal(CurveFormulaSchema.safeParse({kind:"constant",start:0.4}).success,true);
  assert.equal(CurveFormulaSchema.safeParse({kind:"smooth",start:0}).success,false);
  assert.equal(CurveFormulaSchema.safeParse({kind:"envelope",start:0,end:0,peak:1}).success,false);
  assert.deepEqual(compileCurveFormula({kind:"ramp",start:0,end:1}), {keys:[[0,0],[1,1]],ease:"linear"});
});
test("UI patch preserves formulas across validation and JSON round trip", () => {
  const id = readdirSync("fixtures/v2").find(id => {
    try { return JSON.parse(readFileSync(`fixtures/v2/${id}/document.json`,"utf8")).layers.some((l: {emitter?:unknown})=>l.emitter); } catch { return false; }
  });
  assert.ok(id);
  const doc = validateDocumentV2(JSON.parse(readFileSync(`fixtures/v2/${id}/document.json`,"utf8")));
  const layer = projectToUi(doc).layers.find(l=>l.curves?.some(c=>c.path==="emitter.render.sizeCurve"))!;
  const curve = layer.curves!.find(c=>c.path==="emitter.render.sizeCurve")!;
  const next = applyLayerPatch(doc,layer.id,{curves:[{...curve,value:{...curve.value,formula}}]});
  const restored = validateDocumentV2(JSON.parse(JSON.stringify(next)));
  const actual = restored.layers.find(l=>l.id===layer.id)!.emitter!.render.sizeCurve;
  assert.deepEqual(actual.keys,compileCurveFormula(formula).keys);
  assert.deepEqual(actual.formula,formula);
  assert.deepEqual(doc.layers.find(l=>l.id===layer.id)!.emitter!.render.sizeCurve,curve.value);
});
test("wire materials default shading like the document schema", async () => {
  const { MaterialWireSchema, MaterialSchema, defaultMaterial } = await import("../src/lib/vfx-lab/schema-v2");
  const { shading: _omitted, ...material } = defaultMaterial();
  assert.equal(MaterialSchema.safeParse(material).success, true);
  const wire = MaterialWireSchema.safeParse(material);
  assert.equal(wire.success, true);
  if (wire.success) assert.equal(wire.data.shading, "unlit");
});
