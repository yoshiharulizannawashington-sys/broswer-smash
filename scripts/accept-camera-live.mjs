// Live-gameplay camera acceptance: Wonder Woman vs Thor in Asgard, AI active, fighters moved by
// real input and physics - never pinned. Records per-sample composition, camera path, solver cost
// and page errors, and writes report-live-<group>.json.
//
//   PHASES=neutral,approach,separation bash scripts/run-browser-test.sh scripts/accept-camera-live.mjs
//
// SwiftShader numbers are composition/timing evidence only; frame rate here is not a hardware
// performance signal.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const group = process.env.PHASES ? process.env.PHASES.replace(/,/g,'+') : 'all';
const out = resolve(root, 'artifacts/camera-live');
await mkdir(out, { recursive: true });
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg' };
const server = createServer(async (req,res) => {
  try {
    const p = decodeURIComponent(new URL(req.url||'/','http://localhost').pathname);
    if (p === '/api/models/sources') { res.writeHead(200,{'Content-Type':'application/json'}); res.end('{"sources":[],"roster":{"launch":[],"manifestKeys":[]}}'); return; }
    let rel = normalize(p).replace(/^[/\\]+/,'') || 'index.html';
    if (['js','assets','models','data'].some(d => rel === d || rel.startsWith(d+sep))) rel = 'public'+sep+rel;
    res.writeHead(200,{'Content-Type':mime[extname(rel).toLowerCase()]||'application/octet-stream'});
    res.end(await readFile(resolve(root,rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0,'127.0.0.1',d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message)));
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180000, polling: 250 });
await page.evaluate(() => {
  const s = window.__browserSmashSelect;
  s?.select('p1','Wonder Woman'); s?.select('p2','Thor'); s?.chooseArena?.('asgard');
  document.querySelector('#practice')?.click();
});
await page.waitForFunction(() => window.__browserSmashAssets?.authoredArena?.status === 'loaded', null, { timeout: 120000, polling: 250 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const cam = window.smashCamera;
  window.__live = { samples: [], solverMs: [], phase: 'boot' };
  const original = cam.update.bind(cam);
  cam.update = (...args) => {
    const t0 = performance.now();
    const result = original(...args);
    window.__live.solverMs.push(performance.now() - t0);
    return result;
  };
  let n = 0;
  const tick = () => {
    const f = window.fighters || [];
    if (f.length === 2 && cam.report && (n++ % 2 === 0)) {
      const r = cam.report(f[0], f[1]);
      if (r) {
        window.__live.samples.push({
          phase: window.__live.phase, t: performance.now(),
          cam: [r.camera.x, r.camera.y, r.camera.z], fov: r.camera.fov, dist: r.camera.distanceToMid,
          inside: r.insideGeometry, switches: r.bearings?.switches ?? 0,
          fighters: r.fighters.map(x => ({
            name: x.name, on: !!x.bounds.onScreen, h: x.bounds.heightFraction,
            head: !!x.head.clear, torso: !!x.torso.clear
          }))
        });
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.click('canvas', { position: { x: 640, y: 620 } }).catch(() => {});
const phases = [
  { name: 'neutral',     ms: 12000, keys: [] },
  { name: 'approach',    ms: 12000, keys: ['KeyD'] },
  { name: 'separation',  ms: 12000, keys: ['KeyA'] },
  { name: 'knockback',   ms: 12000, keys: [], setup: 'knockback' },
  { name: 'jump',        ms: 12000, keys: [], setup: 'jump' },
  { name: 'close-combat',ms: 12000, keys: ['KeyJ'] },
  { name: 'columns',     ms: 12000, keys: [], setup: 'columns' }
];
const only = process.env.PHASES ? process.env.PHASES.split(',').map(s => s.trim()) : null;
const ran = [];
for (const phase of phases) {
  if (only && !only.includes(phase.name)) continue;
  ran.push(phase.name);
  await page.evaluate(name => { window.__live.phase = name; }, phase.name);
  if (phase.setup === 'knockback') {
    await page.evaluate(() => {
      const f = window.fighters || [];
      const cpu = f.find(x => !x.player) || f[1];
      cpu.velocity?.set(-22, 5, 6);
    });
  }
  if (phase.setup === 'jump') {
    await page.evaluate(() => {
      for (const f of window.fighters || []) f.velocity?.set(0, 9.5, 0);
    });
  }
  if (phase.setup === 'columns') {
    await page.evaluate(() => {
      const f = window.fighters || [];
      f[0]?.position.set(-14, 0, -108);
      f[1]?.position.set(14, 0, -108);
    });
  }
  for (const key of phase.keys) await page.keyboard.down(key);
  await page.waitForTimeout(phase.ms);
  for (const key of phase.keys) await page.keyboard.up(key);
  await page.screenshot({ path: `${out}/${group}-${phase.name}.png` });
  console.log('phase done:', phase.name);
}
const data = await page.evaluate(() => window.__live);
await browser.close();
await new Promise(done => server.close(done));
await writeFile(resolve(out, `report-live-${group}.json`), JSON.stringify({ group, ran, pageErrors, ...data }, null, 1));
const ms = data.solverMs.slice().sort((a,b) => a-b);
const p = q => ms.length ? +ms[Math.min(ms.length-1, Math.floor(q*ms.length))].toFixed(3) : null;
const byPhase = {};
for (const s of data.samples) {
  const p2 = byPhase[s.phase] || (byPhase[s.phase] = { n:0, bothOn:0, bothClear:0, minH:9, heights:[], switches:0, dists:[], inside:0 });
  p2.n++;
  if (s.fighters.every(f => f.on)) p2.bothOn++;
  if (s.fighters.every(f => f.on && f.head && f.torso)) p2.bothClear++;
  const minH = Math.min(...s.fighters.map(f => f.h));
  p2.heights.push(minH); p2.minH = Math.min(p2.minH, minH);
  p2.switches = s.switches; p2.dists.push(s.dist); if (s.inside) p2.inside++;
}
for (const [k,v] of Object.entries(byPhase)) {
  v.bothOnPct = +(100*v.bothOn/v.n).toFixed(1);
  v.bothClearPct = +(100*v.bothClear/v.n).toFixed(1);
  v.meanHeight = +(v.heights.reduce((a,b)=>a+b,0)/v.n).toFixed(3);
  v.minH = +v.minH.toFixed(3);
  v.meanDist = +(v.dists.reduce((a,b)=>a+b,0)/v.n).toFixed(2);
  delete v.heights; delete v.dists;
}
console.log('SOLVER ms p50/p95/max:', p(0.5), p(0.95), ms.length ? +ms[ms.length-1].toFixed(2) : null, 'calls:', ms.length, 'samples:', data.samples.length);
console.log('PAGE ERRORS:', pageErrors.length ? pageErrors.slice(0,2).join(' | ') : 'none');
for (const [k,v] of Object.entries(byPhase)) console.log('PHASE', k, JSON.stringify(v));
