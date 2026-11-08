// Model Refinement 3 evidence: each fighter rendered alone at three controlled distances through
// SmashCamera.spectate, HUD removed. A detail that only reads at 1.6 m is documented as such.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const out = process.env.OUT || 'artifacts/compare/readability';
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
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180000, polling: 250 });
await page.evaluate(() => {
  const s = window.__browserSmashSelect;
  s?.select('p1','Wonder Woman'); s?.select('p2','Thor'); s?.chooseArena?.('asgard');
  document.querySelector('#practice')?.click();
});
await page.waitForFunction(() => window.__browserSmashAssets?.authoredArena?.status === 'loaded', null, { timeout: 120000, polling: 250 });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  for (const el of [...document.body.children]) {
    if (el.tagName === 'CANVAS') continue;
    if (el.contains(canvas)) { for (const c of [...el.children]) { if (c.tagName !== 'CANVAS' && !c.contains(canvas)) c.style.display = 'none'; } }
    else el.style.display = 'none';
  }
});
const targets = [{ slug: 'thor', index: 1 }, { slug: 'wonder_woman', index: 0 }];
const distances = [{ label: 'select', d: 6.0 }, { label: 'fight', d: 3.0 }, { label: 'close', d: 1.6 }];
for (const t of targets) {
  for (const dist of distances) {
    const info = await page.evaluate(({ i, d }) => {
      const f = window.fighters[i];
      f.position.set(0, 0, -30); f.velocity?.set(0,0,0);
      // Face the spectate camera: model yaw is atan2(facing, facingZ).
      f.facing = 0; f.facingZ = 1;
      if (f.model) f.model.rotation.y = Math.atan2(f.facing, f.facingZ);
      // Inspection only: the held weapon sits across the chest in the idle pose and hides the
      // plate work this capture exists to judge. Hidden here, never in gameplay.
      f.model?.traverse?.(o => { if (/hammer|stormbreaker|weapon/i.test(o.name || '')) o.visible = false; });
      window.smashCamera.spectate?.({ fighter: f, framing: 'full', distance: d, yaw: 0, pitch: 0.05 });
      const c = window.smashCamera.camera;
      return { camera: c.position.toArray().map(v => +v.toFixed(2)), fov: +c.fov.toFixed(1) };
    }, { i: t.index, d: dist.d });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${t.slug}-${dist.label}.png` });
    console.log(t.slug, dist.label, JSON.stringify(info));
  }
}
await browser.close(); server.close();
