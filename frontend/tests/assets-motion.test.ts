import test from "node:test";
import assert from "node:assert/strict";
import { createPreset } from "../src/lib/vfx-lab/recipes";
import { validateDocument, GEOMETRIES } from "../src/lib/vfx-lab/schema";
import { evaluateLayer, applyScopedEdit } from "../src/lib/vfx-lab/evaluate";
import { buildGeometry } from "../src/lib/vfx-lab/geometry";
import { generatePipeline } from "../src/lib/vfx-lab/pipeline";

test("waypoints seek deterministically and scoped appearance edits preserve motion", () => {
 const doc=createPreset("slash"), layer=doc.layers[0];
 layer.motion={ keys:[[0,0,0,0],[.2,2,1,-1],[layer.end-layer.start,3,0,0]],ease:"linear"};
 validateDocument(doc);
 const before=evaluateLayer(layer,layer.start+.1);
 assert.deepEqual(before.params.position, [layer.params.position[0]+1,layer.params.position[1]+.5,layer.params.position[2]-.5]);
 const after=applyScopedEdit(doc,layer.id,{target:"opacity",value:.1,start:layer.start,end:layer.end,fade:0});
 assert.deepEqual(evaluateLayer(after.layers[0],layer.start+.1).params.position,before.params.position);
 evaluateLayer(layer,doc.duration); evaluateLayer(layer,0);
 assert.deepEqual(evaluateLayer(layer,layer.start+.1),before);
 layer.motion.keys[1][0]=layer.motion.keys[2][0];
 assert.throws(()=>validateDocument(doc),/motion keys/);
});
for (const geometry of GEOMETRIES) test(`${geometry}: deterministic bounded mesh with finite UVs`,()=>{
 const layer=createPreset("slash").layers[0]; layer.geometry=geometry;
 const a=buildGeometry(layer,123), b=buildGeometry(layer,123);
 try {
  assert.ok(a.getAttribute("position").count<10000);
  for(const key of ["position","normal","uv"]) {
   assert.ok([...a.getAttribute(key).array].every(Number.isFinite));
   assert.deepEqual(a.getAttribute(key).array,b.getAttribute(key).array);
  }
 } finally {a.dispose();b.dispose();}
});
test("documents reject missing assets and unsupported particle mesh/texture combinations",()=>{
 const doc=createPreset("slash");doc.layers[0].textureId="missing";
 assert.throws(()=>validateDocument(doc),/Missing texture/);
 doc.layers[0].textureId=null;
 const particles=doc.layers.find(l=>l.kind==="particles")!;particles.geometry="cone";
 assert.throws(()=>validateDocument(doc),/billboards/);
});
test("texture generation is bounded before candidates and texture failures keep procedural rendering",async()=>{
 const calls:string[]=[]; const doc=createPreset("magic");
 const result=await generatePipeline({prompt:"magic seal",references:[],mode:"fast",textures:true,signal:new AbortController().signal,
 request:async body=>{calls.push(String(body.action));if(body.action==="plan")return {runId:"x",plan:{textures:[{id:"seal"}]}};if(body.action==="texture")throw Error("unavailable");return {document:doc};},
 capture:async()=>({sheet:"x",times:[0,1],width:320,height:180,runtime:"test",renderer:"test",camera:[],layers:[],observations:[]}),progress:()=>{},candidate:()=>{}});
 assert.deepEqual(calls,["plan","texture","candidate"]);assert.equal(result.selected.document.name,doc.name);
 assert.ok(result.trace.some(x=>x.includes("procedural")));
});

test("staggered short strikes are each sampled before they disappear", async()=>{
 const {sampleTimes}=await import("../src/lib/vfx-lab/evaluate");
 const doc=createPreset("lightning");
 const bolt=doc.layers.find(l=>l.id==="bolt")!;
 doc.layers=[.4,.75,1.1].map((start,i)=>({...structuredClone(bolt),id:`strike-${i}`,start,end:start+.2}));
 const times=sampleTimes(doc);assert.ok(times.length<=12);
 for(const layer of doc.layers)assert.ok(times.some(t=>t>layer.start&&t<layer.end));
});
