// Which overlay elements survive body.spectating? Lists every visible element that paints over the
// canvas, with the id/class the spectate style would need in order to hide it.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root=process.cwd();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.png':'image/png'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(new URL(req.url||'/','http://localhost').pathname);
 if(p==='/api/models/sources'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"sources":[],"roster":{"launch":[],"manifestKeys":[]}}');return;}
 let rel=normalize(p).replace(/^[/\\]+/,'')||'index.html'; if(['js','assets','models','data'].some(d=>rel===d||rel.startsWith(d+sep))) rel='public'+sep+rel;
 res.writeHead(200,{'Content-Type':mime[extname(rel).toLowerCase()]||'application/octet-stream'}); res.end(await readFile(resolve(root,rel)));}
 catch{if(!res.headersSent)res.writeHead(404);res.end('nf');}});
await new Promise(d=>server.listen(0,'127.0.0.1',d));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:900,height:1100}});
await page.goto(origin+'/public/index.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__browserSmashAssets?.app?.status==='running'&&window.fighters?.length===2,null,{timeout:180000,polling:250});
await page.evaluate(()=>{const s=window.__browserSmashSelect;s?.select('p1','Wonder Woman');s?.select('p2','Thor');s?.chooseArena?.('asgard');document.querySelector('#practice')?.click();});
await page.waitForFunction(()=>window.__browserSmashAssets?.authoredArena?.status==='loaded',null,{timeout:120000,polling:250});
await page.waitForTimeout(2500);
const info=await page.evaluate(()=>{
  const f=window.fighters||[]; window.smashCamera.spectate({fighter:f[0],framing:'upper',distance:3,yaw:0,pitch:2});
  const out=[];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('canvas')) continue;
    if (el.tagName==='SCRIPT'||el.tagName==='STYLE'||el.tagName==='CANVAS') continue;
    if (el.querySelector('canvas') || el.tagName==='BODY'||el.tagName==='HTML') continue;
    const r=el.getBoundingClientRect(); if(r.width<40||r.height<12) continue;
    const cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0) continue;
    // Only elements that actually paint text/boxes over the viewport.
    if(!el.textContent || !el.textContent.trim()) continue;
    if(r.bottom<0||r.top>innerHeight) continue;
    out.push({tag:el.tagName,id:el.id||null,cls:(el.className||'').toString().slice(0,60),w:Math.round(r.width),h:Math.round(r.height),text:el.textContent.trim().replace(/\s+/g,' ').slice(0,42)});
  }
  const seen=new Set(); const uniq=[];
  for(const o of out){const k=(o.id||'')+'|'+(o.cls||''); if(seen.has(k))continue; seen.add(k); uniq.push(o);}
  return {spectating:document.body.classList.contains('spectating'), overlays:uniq.slice(0,25)};
});
console.log(JSON.stringify(info,null,1));
await browser.close(); server.close();
