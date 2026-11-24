import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, extname } from 'node:path';
import { chromium } from 'playwright';
const root=process.cwd(); const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(new URL(req.url||'/','http://x').pathname);let rel=normalize(p).replace(/^[/\\]+/,'')||'index.html';if(['js','assets','models','data'].some(d=>rel===d||rel.startsWith(d+'/')))rel='public/'+rel;const b=await readFile(resolve(root,rel));res.writeHead(200,{'Content-Type':mime[extname(rel).toLowerCase()]||'application/octet-stream'});res.end(b);}catch{res.writeHead(404);res.end('missing');}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok)); const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:960,height:600}}); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.goto(origin+'/public/index.html',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForFunction(()=>window.__browserSmashAssets?.app?.status==='running'&&window.__browserSmashStep&&window.fighters?.length===2,null,{timeout:120000,polling:200});
console.log(JSON.stringify({ok:true,title:await page.title(),app:await page.evaluate(()=>window.__browserSmashAssets.app),fighters:await page.evaluate(()=>window.fighters.map(f=>f.identity)),errors},null,1));
await page.screenshot({path:'artifacts/rig-batch/test/browser-probe.png'});
}finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
