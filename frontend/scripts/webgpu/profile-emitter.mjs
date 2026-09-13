import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { webgpuBrowserOptions } from '../browser-options.mjs';
const bundle = process.env.AUTOV_PERF_BUNDLE ? await readFile(process.env.AUTOV_PERF_BUNDLE,'utf8') : (await build({stdin:{contents:'export {VfxRuntimeV2} from "./src/lib/vfx-lab/runtime-v2"; export {createDocument} from "./src/lib/vfx-lab/ui-bridge";',resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'Probe',write:false,minify:true})).outputFiles[0].text;
if(process.env.AUTOV_SAVE_PERF_BUNDLE) await writeFile(process.env.AUTOV_SAVE_PERF_BUNDLE,bundle);
const server=createServer((req,res)=>res.end(req.url==='/probe.js'?bundle:'<div id="host" style="width:640px;height:360px"></div>'));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(webgpuBrowserOptions());
try {
const page=await browser.newPage();
const cdp=await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
page.on('pageerror',e=>console.error(e));
await page.goto(`http://127.0.0.1:${server.address().port}`);
await page.addScriptTag({url:'/probe.js'});
const result=await page.evaluate(async(preview)=>{
 const results=[];
 const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
 for(const count of [600,6000]) {
  const r=new Probe.VfxRuntimeV2(document.getElementById('host'),{preview});
  try {
   r.setInteractive(false);r.renderer.setPixelRatio(1);r.resize(640,360);
   const doc=Probe.createDocument('profile');doc.layers[0].emitter.count=count;
   r.setDocument(doc);await r.whenReady();
   const device=r.renderer.backend.device;
   if(!r.renderer.backend.isWebGPUBackend)throw Error('WebGPU required');
   for(const post of [false,true]) {
    r.setFeatureFlags({post});
    const cold=performance.now();r.render(.5);await device.queue.onSubmittedWorkDone();
    const coldMs=performance.now()-cold;
    for(let i=0;i<3;i++){r.render(.5);await device.queue.onSubmittedWorkDone();}
    const cpu=[],complete=[];
    for(let i=0;i<12;i++) {
     const start=performance.now();r.render(.4+i*.01);cpu.push(performance.now()-start);
     await device.queue.onSubmittedWorkDone();complete.push(performance.now()-start);
    }
    r.renderer.info.autoReset=false;r.renderer.info.reset();r.render(.5);
    const render=structuredClone(r.renderer.info.render),memory=structuredClone(r.renderer.info.memory);
    await device.queue.onSubmittedWorkDone();
    results.push({count,post,coldMs,cpuMedianMs:median(cpu),completedMedianMs:median(complete),render,memory});
    r.renderer.info.autoReset=true;
   }
  }finally{r.dispose();}
 }
 return {userAgent:navigator.userAgent,width:640,height:360,dpr:1,preview,results};
},process.env.AUTOV_PREVIEW === "1");
const {profile}=await cdp.send('Profiler.stop');
result.cpuProfile=profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,15).map(n=>({function:n.callFrame.functionName,line:n.callFrame.lineNumber,hits:n.hitCount}));
console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
