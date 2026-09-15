import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { webgpuBrowserOptions } from '../browser-options.mjs';
const bundle = await build({stdin:{contents:`export {captureV2,VfxRuntimeV2} from './src/lib/vfx-lab/capture-v2'; export {createDocument} from './src/lib/vfx-lab/ui-bridge';`,resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'Probe',write:false});
const server=createServer((req,res)=>res.end(req.url==='/probe.js'?bundle.outputFiles[0].text:'<body></body>'));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
 browser=await chromium.launch(webgpuBrowserOptions());
 const page=await browser.newPage({deviceScaleFactor:2});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addScriptTag({url:'/probe.js'});
 const candidate=process.env.AUTOV_CAPTURE_DOCUMENT?JSON.parse(await readFile(process.env.AUTOV_CAPTURE_DOCUMENT,'utf8')):null;
 const result=await page.evaluate(async(candidate)=>{
  const doc=Probe.createDocument();doc.duration=.5;doc.impact=.1;
  doc.layers[0].end=.5;doc.layers[0].material.mask.textureId=null;
  let frames=0;const ratios=[];
  const render=Probe.VfxRuntimeV2.prototype.render;
  Probe.VfxRuntimeV2.prototype.render=function(...args){frames++;ratios.push(this.renderer.getPixelRatio());return render.apply(this,args);};
  const full=await Probe.captureV2(doc);const fullFrames=frames;frames=0;
  const sheet=await Probe.captureV2(doc,{motionEvidence:false});const sheetFrames=frames;frames=0;
  const repeat=await Probe.captureV2(doc,{motionEvidence:false});
  let actual=null;
  if(candidate){frames=0;const evidence=await Probe.captureV2(candidate,{motionEvidence:false});actual={frames,pixels:evidence.renderedPixels,sheet:evidence.sheet};}
  return {fullFrames,sheetFrames,sameSheet:full.sheet===sheet.sheet,repeat:sheet.sheet===repeat.sheet,hasFullMotion:!!full.strip&&!!full.temporal,noUnusedMotion:sheet.strip===undefined&&sheet.temporal===undefined&&sheet.stripTimes.length===0,ratios:[...new Set(ratios)],remainingCanvases:document.querySelectorAll('canvas').length,pixels:sheet.renderedPixels,sheet:sheet.sheet,actual};
 },candidate);
 assert.deepEqual(errors,[]);assert.equal(result.sameSheet,true);assert.equal(result.repeat,true);assert.equal(result.sheetFrames,9);assert.ok(result.fullFrames>result.sheetFrames);assert.equal(result.hasFullMotion,true);assert.equal(result.noUnusedMotion,true);assert.deepEqual(result.ratios,[1]);assert.equal(result.remainingCanvases,0);assert.ok(result.pixels>0);
 await mkdir('/tmp/autov-capture-memory',{recursive:true});
 await writeFile('/tmp/autov-capture-memory/sheet.jpg',Buffer.from(result.sheet.split(',')[1],'base64'));
 if(result.actual){assert.equal(result.actual.frames,9);assert.ok(result.actual.pixels>0);await writeFile('/tmp/autov-capture-memory/candidate.jpg',Buffer.from(result.actual.sheet.split(',')[1],'base64'));delete result.actual.sheet;}
 delete result.sheet;console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
