import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const result=await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import IterationOffer from './src/components/studio/iteration-offer'; window.clicks=[]; createRoot(document.getElementById('root')).render(<IterationOffer projectId="project" busy={false} onContinue={async offer=>{window.clicks.push(offer);return true;}}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,jsx:'automatic',write:false,outfile:'/tmp/iteration.js',plugins:[{name:'mock-auth',setup(b){b.onResolve({filter:/^@\/lib\/agent\/client$/},()=>({path:'auth',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const agentHeaders=async()=>({});',loader:'js'}));}}]});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text,css=result.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
let enabled=true;
const server=createServer((req,res)=>{
 if(req.url==='/api/studio/iteration'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(enabled?{operationId:'30000000-0000-4000-8000-000000000001',revision:4}:null));}
 else if(req.url==='/app.js')res.end(js);
 else res.end(`<style>body{background:#17191c;color:#ddd;font-family:Arial;padding:30px} ${css}</style><div id="root"></div><script src="/app.js"></script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:420,height:240}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);const chip=page.getByRole('button',{name:'Continue',exact:true});await chip.waitFor();assert.equal(await page.evaluate(()=>window.clicks.length),0);
 await mkdir('/tmp/autov-iteration',{recursive:true});await page.screenshot({path:'/tmp/autov-iteration/continue.png'});
 await chip.click();assert.deepEqual(await page.evaluate(()=>window.clicks),[{operationId:'30000000-0000-4000-8000-000000000001',revision:4}]);
 await page.reload();await chip.waitFor();enabled=false;await chip.waitFor({state:'hidden',timeout:6000});assert.deepEqual(errors,[]);console.log('Continue chip: label, explicit click, exact consent, reload and stale-offer removal passed');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
