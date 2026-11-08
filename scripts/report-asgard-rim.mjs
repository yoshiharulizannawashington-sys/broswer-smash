// Measure the real Asgard platform edge and visualise it, before any construction.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root=process.cwd();const out='artifacts/asgard-rim';await mkdir(out,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm'};
const server=createServer(async(req,res)=>{try{let rel=normalize(decodeURIComponent(new URL(req.url||'/','http://x').pathname)).replace(/^[/\\]+/,'')||'index.html';if(!(rel==='public'||rel.startsWith('public'+sep)))rel='public'+sep+rel;res.writeHead(200,{'Content-Type':mime[extname(rel).toLowerCase()]||'application/octet-stream'});res.end(await readFile(resolve(root,rel)));}catch{if(!res.headersSent)res.writeHead(404);res.end('nf');}});
await new Promise(d=>server.listen(0,'127.0.0.1',d));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(120000);
const errors=[];page.on('pageerror',e=>errors.push(String(e.message||e).slice(0,160)));
await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelector('#bbTitle')&&window.fighters?.length===2,null,{timeout:110000,polling:250});
await page.waitForTimeout(400);await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(()=>{const menu=document.querySelector('#menuMapSelect');const select=document.querySelector('#mapSelect');if(menu)menu.value='asgard';if(select){select.value='asgard';select.dispatchEvent(new Event('change'));}window.__browserSmashApplyMap('asgard');window.__browserSmashSelect?.select?.('p1','Goku');window.__browserSmashSelect?.select?.('p2','Naruto Uzumaki');window.__browserSmashFreezeAI=true;});
await page.waitForTimeout(500);await page.evaluate(()=>document.querySelector('#play')?.click());
await page.waitForFunction(()=>document.querySelector('#menu')?.classList.contains('hidden'),null,{timeout:30000,polling:200});
await page.waitForTimeout(3500);
const report=await page.evaluate(()=>{
  const THREE=window.__browserSmashThree,scene=window.__browserSmashScene;
  const named=[];let platform=null,inlay=null;
  scene.updateMatrixWorld(true);
  scene.traverse(n=>{if(!n.isMesh)return;const name=n.name||'';if(/asgardian[_ ]town[_ ]square/i.test(name)){const b=new THREE.Box3().setFromObject(n);platform={name,box:b,mat:n.material?.name||''};}
    if(/plaza[_ ]gilt[_ ]inlay/i.test(name)){const b=new THREE.Box3().setFromObject(n);inlay={name,box:b,mat:n.material?.name||''};}
    if(/marble|town square|plaza/i.test(name+(n.material?.name||'')))named.push(name);});
  if(!platform)return {error:'no town square mesh',named};
  const layout=window.__browserSmashLayout();const b=layout.bounds;
  if(layout.label!=='Asgard')return {error:'wrong layout',label:layout.label,bounds:b};
  const p=platform.box.clone();const inb=inlay?.box.clone();
  const round=v=>+v.toFixed(2);
  // Debug overlay: platform rim (red), inlay (yellow), playable rectangle (cyan).
  const group=new THREE.Group();group.name='asgard-rim-debug';
  const line=(x0,z0,x1,z1,y,color)=>{const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0,y,z0),new THREE.Vector3(x1,y,z0),new THREE.Vector3(x1,y,z1),new THREE.Vector3(x0,y,z1)]);g.setIndex([0,1,1,2,2,3,3,0]);const m=new THREE.LineBasicMaterial({color,depthTest:false});const l=new THREE.LineSegments(g,m);l.renderOrder=999;group.add(l);};
  line(p.min.x,p.min.z,p.max.x,p.max.z,0.6,0xff3b30);
  if(inb)line(inb.min.x,inb.min.z,inb.max.x,inb.max.z,0.75,0xffd60a);
  line(b.x0,b.z0,b.x1,b.z1,0.9,0x00e5ff);
  for(const [x,z] of [[p.min.x,p.min.z],[p.max.x,p.min.z],[p.max.x,p.max.z],[p.min.x,p.max.z]]){const post=new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.35,8,8),new THREE.MeshBasicMaterial({color:0xff3b30}));post.position.set(x,4,z);group.add(post);}
  scene.add(group);window.__asgardRimDebug=group;
  window.smashCamera.spectate?.({fighter:window.fighters[0],framing:'wide',yaw:0,pitch:-1.05,distance:150});
  return {
    platform:{name:platform.name,material:platform.mat,min:p.min.toArray().map(round),max:p.max.toArray().map(round),size:[round(p.max.x-p.min.x),round(p.max.y-p.min.y),round(p.max.z-p.min.z)],top:round(p.max.y)},
    inlay:inb?{name:inlay.name,material:inlay.mat,min:inb.min.toArray().map(round),max:inb.max.toArray().map(round),size:[round(inb.max.x-inb.min.x),round(inb.max.z-inb.min.z)],top:round(inb.max.y)}:null,
    playable:{bounds:b,width:round(b.x1-b.x0),depth:round(b.z1-b.z0)},
    clearance:{west:round(b.x0-p.min.x),east:round(p.max.x-b.x1),south:round(b.z0-p.min.z),northOverlap:round(p.max.z-b.z1)},
    named
  };
});
await page.waitForTimeout(1600);
await page.screenshot({path:`${out}/platform-edge-debug.png`});
await writeFile(`${out}/boundary.json`,JSON.stringify({report,errors},null,2));
console.log('RIM '+JSON.stringify(report));console.log('ERRORS '+errors.length);
await browser.close();server.close();
