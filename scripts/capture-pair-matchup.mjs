// Clean gameplay-distance frame of one matchup, no HUD, no second fighter in the way.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root=process.cwd(); const out='artifacts/compare/asgard-matchup'; await mkdir(out,{recursive:true});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{
  try{
    const p=decodeURIComponent(new URL(req.url||'/','http://localhost').pathname);
    if(p==='/api/models/sources'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"sources":[],"roster":{"launch":[],"manifestKeys":[]}}');return;}
    let rel=normalize(p).replace(/^[/\\]+/,'')||'index.html';
    if(['js','assets','models','data'].some(d=>rel===d||rel.startsWith(d+sep))) rel='public'+sep+rel;
    res.writeHead(200,{'Content-Type':mime[extname(rel).toLowerCase()]||'application/octet-stream'});
    res.end(await readFile(resolve(root,rel)));
  }catch{ if(!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d=>server.listen(0,'127.0.0.1',d));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
await page.goto(origin+'/public/index.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__browserSmashAssets?.app?.status==='running'&&window.fighters?.length===2,null,{timeout:180000,polling:250});
await page.evaluate(()=>{const s=window.__browserSmashSelect;s?.select('p1','Wonder Woman');s?.select('p2','Thor');s?.chooseArena?.('asgard');document.querySelector('#practice')?.click();});
await page.evaluate(()=>document.body.classList.add('spectating'));
await page.waitForFunction(()=>window.__browserSmashAssets?.authoredArena?.status==='loaded',null,{timeout:120000,polling:250});
await page.waitForTimeout(4000);
const info=await page.evaluate(()=>{
  const f=window.fighters||[]; const a=f[0],b=f[1];
  a.position.set(1.6,0,-6); b.position.set(-2.4,0,-1.4);
  a.velocity?.set(0,0,0); b.velocity?.set(0,0,0);
  if(a.facing!==undefined) a.facing=Math.PI;
  for(let i=0;i<30;i++) window.smashCamera.update(a,b,0.2,'overhead');
  window.smashCamera.camera.updateMatrixWorld(true);
  const c=window.smashCamera.camera;
  return {camera:c.position.toArray().map(v=>+v.toFixed(2)),fov:c.fov,names:[a.name,b.name]};
});
await page.waitForTimeout(1200);
await page.screenshot({path:out+'/wonder-woman-vs-thor.png'});
console.log(JSON.stringify(info));
await browser.close(); server.close();
