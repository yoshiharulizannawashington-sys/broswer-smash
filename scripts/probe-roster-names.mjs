// Why do some slugs report captured:0? Print the real roster names, their slugOf() form, and the
// preview state for the fighters that would not capture.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png' };
const server = createServer(async (req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://x').pathname);let rel=normalize(p).replace(/^[/\\]+/,'')||'index.html';if(['js','assets','models','data'].some(d=>rel===d||rel.startsWith(d+sep)))rel='public'+sep+rel;res.writeHead(200,{'Content-Type':mime[extname(rel)]||'application/octet-stream'});res.end(await readFile(resolve(root,rel)));}catch{res.writeHead(404);res.end('x');}});
await new Promise(d=>server.listen(0,'127.0.0.1',d));
const origin='http://127.0.0.1:'+server.address().port;
const slugOf=n=>String(n||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:520,height:640},deviceScaleFactor:2});
const errs=[];page.on('pageerror',e=>errs.push(String(e).split('\n')[0]));
await page.goto(origin+'/index.html',{waitUntil:'load'});
await page.waitForFunction(()=>Boolean(window.characterRosters),null,{timeout:120000});
const names=await page.evaluate(()=>window.characterRosters.launch.map(e=>Array.isArray(e)?e[0]:e.name));
console.log('LAUNCH COUNT',names.length);
console.log(names.map(n=>slugOf(n)).join(' '));
console.log('THOR MATCH',names.filter(n=>slugOf(n)==='thor'));
console.log('WW MATCH',names.filter(n=>slugOf(n)==='wonder_woman'));
await page.waitForFunction(()=>Boolean(window.__browserSmashPreview),null,{timeout:120000});
for(const slug of ['thor','wonder_woman','goku','mario']){
  const out=await page.evaluate(async s=>{
    try{ await window.__browserSmashPreview.show(s,s); }catch(e){ return {error:String(e)}; }
    await new Promise(r=>setTimeout(r,1200));
    const c=document.querySelector('#selectScreen canvas');
    const st=document.querySelector('#selectScreen [data-role="previewstatus"]');
    const dbg=window.__fighterPreviewDebug;
    return { state: st?.dataset.state||'missing', status: st?.textContent?.slice(0,80)||null,
      canvas:[c?.clientWidth,c?.clientHeight], hasRoot:Boolean(dbg?.root),
      tri: dbg?.root ? (()=>{let t=0;dbg.root.traverse(o=>{if(o.isMesh){const g=o.geometry;t+=g.index?g.index.count/3:(g.attributes.position?.count||0)/3;}});return Math.round(t);})() : null };
  }, slug);
  console.log(slug, JSON.stringify(out));
}
console.log('PAGE ERRORS', JSON.stringify([...new Set(errs)].slice(0,5)));
await browser.close(); server.close();
