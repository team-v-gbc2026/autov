/** Verify that preparing a preview removes shader builds from emitter boundaries.
 * Linux: AUTOV_WEBGPU_SOFTWARE=1 xvfb-run -a node scripts/webgpu/verify-boundaries.mjs
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { webgpuBrowserOptions } from '../browser-options.mjs';
const bundle = (await build({stdin:{contents:'export {VfxRuntimeV2} from "./src/lib/vfx-lab/runtime-v2";',resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'Probe',write:false,minify:true})).outputFiles[0].text;
if(process.env.AUTOV_SAVE_BOUNDARY_BUNDLE) await writeFile(process.env.AUTOV_SAVE_BOUNDARY_BUNDLE,bundle);
const server=createServer((req,res)=>res.end(req.url==='/probe.js'?bundle:'<div id="host" style="width:320px;height:180px"></div>'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await chromium.launch(webgpuBrowserOptions());
 const page=await browser.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}`); await page.addScriptTag({url:'/probe.js'});
 const results=[];
 for(const id of (process.env.AUTOV_FIXTURES?.split(',')||['beam','ice-blast','lightning-impact'])) {
  const doc=JSON.parse(await readFile(`fixtures/v2/${id}/document.json`,'utf8'));
  const result=await page.evaluate(async doc=>{
   const r=new Probe.VfxRuntimeV2(document.getElementById('host'),{preview:true});
   const builds=[];r.renderer.debug.onNodeBuilderCreated=(builder,object)=>builds.push(object.object.name||object.material.type);
   try {
    r.setInteractive(false);r.setDocument(doc);await r.whenReady();
    const edges=[...new Set([0,...doc.layers.flatMap(l=>[l.start,l.end]),doc.duration])].sort((a,b)=>a-b);
    const samples=[];
    for(let loop=0;loop<2;loop++)for(const edge of edges)for(const offset of [-.001,0,.001]) {
     const time=Math.max(0,Math.min(doc.duration,edge+offset));
     const start=performance.now(),count=builds.length;r.renderPreview(time);
     const cpuMs=performance.now()-start;
     await r.renderer.backend.device.queue.onSubmittedWorkDone();
     samples.push({loop,time,cpuMs,builds:builds.slice(count)});
    }
    // Reinstall a delayed layer after a prior frame: preparation must advance
    // the post graph's frame cache and prepare the replacement too.
    const edited = structuredClone(doc);
    const delayed = edited.layers.find(layer => layer.kind !== 'light' && layer.start > 0)
      ?? edited.layers.find(layer => layer.kind !== 'light');
    delayed.transform.position[0] += 0.01;
    r.setDocument(edited, { preserveCamera: true });
    await r.whenReady();
    const editBuildStart = builds.length;
    r.renderPreview(delayed.start + 0.001);
    await r.renderer.backend.device.queue.onSubmittedWorkDone();
    return {samples,editBuilds:builds.slice(editBuildStart),backend:r.renderer.backend.isWebGPUBackend};
   }finally{r.dispose();}
  },doc);
  results.push({id,...result});
  console.log(JSON.stringify({id,spikes:result.samples.filter(s=>s.builds.length||s.cpuMs>20)}));
 }
 const output=process.env.AUTOV_EVIDENCE_DIR||'.autov-local/boundaries';await mkdir(output,{recursive:true});
 await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));
 for (const result of results) {
  assert.equal(result.backend,true);
  assert.deepEqual(result.samples.flatMap(sample=>sample.builds),[],`${result.id} compiled at a timeline boundary`);
  assert.deepEqual(result.editBuilds,[],`${result.id} delayed edit was not prepared`);
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
