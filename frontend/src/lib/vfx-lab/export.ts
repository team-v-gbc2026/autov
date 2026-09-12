import { validateDocument, type VfxDocument } from "./schema";
export async function exportHtml(doc: VfxDocument, runtimeBundle?: string) {
  validateDocument(doc);
  if (!runtimeBundle) {
    const response = await fetch("/vfx-runtime.js");
    if (!response.ok)
      throw new Error("Player bundle missing. Run npm run bundle:runtime.");
    runtimeBundle = await response.text();
  }
  const bundle = runtimeBundle.replace(/<\/script/gi, "<\\/script");
  const json = JSON.stringify(doc).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>autoV — Three.js effect</title><style>*{box-sizing:border-box}body{margin:0;background:#101112;color:#cbd1d4;font:12px system-ui}#viewport{position:absolute;inset:0}footer{position:absolute;bottom:20px;left:20px;right:20px;display:flex;align-items:center;gap:16px;padding:14px;background:#1b1d20db;border:1px solid #ffffff20;border-radius:8px}input{flex:1;accent-color:#bacdc8}button{padding:8px 12px;background:#d8dfdd;color:#17211d;border:0;border-radius:4px}#error{position:absolute;top:20px;left:20px;color:#e5aaa0}</style><div id="viewport"></div><div id="error" role="alert"></div><footer><button id="play">Pause</button><span id="name"></span><input id="time" aria-label="Playback position" type="range" min="0" step=".001"><output id="clock"></output></footer><script>${bundle}</script><script>
const definition=${json};
document.getElementById('name').textContent=definition.name;
const slider=document.getElementById('time'),clock=document.getElementById('clock'),button=document.getElementById('play');slider.max=definition.duration;
let time=0,playing=!matchMedia('(prefers-reduced-motion: reduce)').matches,last=performance.now();
button.textContent=playing?'Pause':'Play';button.onclick=()=>{playing=!playing;button.textContent=playing?'Pause':'Play'};slider.oninput=()=>{time=Number(slider.value)};
(async()=>{try{const runtime=new AutoV.VfxRuntime(document.getElementById('viewport'),message=>document.getElementById('error').textContent=message);await runtime.prepare(definition);runtime.setDocument(definition);function frame(now){if(playing)time=(time+Math.min(.1,(now-last)/1000))%definition.duration;last=now;runtime.render(time);slider.value=time;clock.textContent=time.toFixed(2)+' / '+definition.duration.toFixed(2)+' s';requestAnimationFrame(frame)}requestAnimationFrame(frame);addEventListener('pagehide',()=>runtime.dispose())}catch(error){document.getElementById('error').textContent=error.message}})();
</script></html>`;
}
