import {chromium} from 'playwright';
import {webgpuBrowserOptions} from '../browser-options.mjs';
const browser=await chromium.launch(webgpuBrowserOptions());
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('console',m=>{if(m.type()==='error')console.log('ERROR',m.text());});
 page.on('pageerror',e=>console.log('ERROR',e.message));
 await page.goto('http://localhost:3000/dev/vfx-studio-v2?fixture=empty',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(() => document.querySelector('.scene-host canvas') && !document.querySelector('.scene-status'));
 const originalCanvas = await page.locator('.scene-host canvas').elementHandle();
 await page.screenshot({path:'.autov-local/workspace-empty.png'});
 await page.getByRole('button',{name:'Add emitter',exact:true}).click();
 await page.waitForTimeout(20000);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 const ruler=await page.getByRole('slider',{name:'Playback position'}).boundingBox();
 await page.mouse.click(ruler.x+ruler.width/6,ruler.y+ruler.height/2);
 await page.waitForTimeout(3000);
 console.log('BODY' ,await page.locator('body').innerText());
 await page.screenshot({path:'.autov-local/empty-studio.png'});
 if (!await originalCanvas.evaluate(canvas => canvas.isConnected && canvas === document.querySelector('.scene-host canvas'))) throw Error('Adding an emitter replaced the workspace canvas');
 await page.locator('.lab-emitter-bar').first().hover();
 await page.getByRole('button',{name:'Delete Emitter 1',exact:true}).click();
 await page.waitForTimeout(1000);
 if (!await originalCanvas.evaluate(canvas => canvas.isConnected && canvas === document.querySelector('.scene-host canvas'))) throw Error('Deleting the last emitter replaced the workspace canvas');
 await page.screenshot({path:'.autov-local/workspace-empty-after-delete.png'});
 console.log('PASS: same workspace canvas before add, after add, and after delete');
}finally{await browser.close();}
