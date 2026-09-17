import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
const root=process.cwd(); const output=path.resolve(root,'.autov-local/engine-export'); await mkdir(output,{recursive:true});
const token=randomUUID();
const entry=`import {exportEngineBundle} from './src/lib/vfx-lab/engine-export/export';
const status=document.querySelector('output');
document.querySelector('button').onclick=async()=>{try{document.querySelector('button').disabled=true;const id=document.querySelector('select').value;const doc=await(await fetch('/fixture/'+id)).json();const result=await exportEngineBundle(doc,{fps:15,onProgress:(m,p)=>status.textContent=m+' '+Math.round(p*100)+'%'});for(const f of result.files){await fetch('/save/'+id+'/'+f.name,{method:'POST',headers:{'X-Preview-Token':'${token}'},body:f.blob});}await fetch('/save/'+id+'/effect.zip',{method:'POST',headers:{'X-Preview-Token':'${token}'},body:result.blob});status.textContent='Export complete: '+id+' ('+result.manifest.draws.length+' native 3D draws)';}catch(e){status.textContent=e.stack||e.message;}finally{document.querySelector('button').disabled=false;}};`;
const compile=()=>build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'iife',write:false,target:'es2022',logLevel:'warning'});
const html=`<!doctype html><meta charset="utf-8"><title>autoV native 3D export verification</title><style>body{background:#14191e;color:#eee;font:16px system-ui;padding:40px}button,select{padding:12px;margin:8px}output{display:block;white-space:pre-wrap}</style><h1>autoV · native 3D engine export</h1><p>Exports actual runtime meshes, particle attributes and shader parameters. Results saved locally for engine verification.</p><select aria-label="Effect"><option>fire-projectile</option><option>smoke-burst</option><option>shield</option><option>fire-slash</option><option>water-projectile</option></select><button>Export 3D verification bundle</button><output>Ready</output><script src="/bundle.js"></script>`;
createServer(async(req,res)=>{try{
const url=new URL(req.url,'http://localhost'); const p=decodeURIComponent(url.pathname);
if(p==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
if(p==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end((await compile()).outputFiles[0].text);return;}
if(p.startsWith('/save/')&&req.method==='POST'){
if(req.headers['x-preview-token']!==token){res.writeHead(403);res.end();return;}
const dest=path.resolve(output,p.slice(6));if(!dest.startsWith(output+path.sep))throw Error('Invalid path');
const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>256*1024*1024)throw Error('Too large');chunks.push(c);}
await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,Buffer.concat(chunks));res.end('saved');console.log('saved',p.slice(6));return;}
let file;
if(p.startsWith('/fixture/'))file=path.join(root,'fixtures/v2',path.basename(p),'document.json');
else if(p.startsWith('/engine-export/'))file=path.resolve(root,'public','.'+p);
else{res.writeHead(404);res.end();return;}
if(!file.startsWith(root+path.sep))throw Error('Invalid path');res.end(await readFile(file));
}catch(e){res.writeHead(500);res.end(String(e));}}).listen(4317,'127.0.0.1',()=>console.log('http://127.0.0.1:4317',output));
