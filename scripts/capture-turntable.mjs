// Front / three-quarter / gameplay-distance captures of one fighter at a time, using the game's
// supported inspection path (smashCamera.spectate injects the HUD-hiding style and sets
// body.spectating). The other fighter's model is hidden for the shot only; no gameplay, placement
// or combat system is changed.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const out = process.env.OUT || 'artifacts/compare/turntable';
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
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180000, polling: 250 });
await page.evaluate(() => {
  const s = window.__browserSmashSelect;
  s?.select('p1','Wonder Woman'); s?.select('p2','Thor'); s?.chooseArena?.('asgard');
  document.querySelector('#practice')?.click();
});
await page.waitForFunction(() => window.__browserSmashAssets?.authoredArena?.status === 'loaded', null, { timeout: 120000, polling: 250 });
await page.waitForTimeout(2500);
// Refinement 4 distances: the discs must read at 1.6 m, 3 m and 6 m; the shield at close range
// and at normal combat distance (9 m, the mean live camera distance measured earlier).
const PLANS = {
  thor: [
    { name: 'front',         yaw: 0,  distance: 1.6, framing: 'upper' },
    { name: 'three-quarter', yaw: 40, distance: 3.0, framing: 'upper' },
    { name: 'gameplay',      yaw: 20, distance: 6.0, framing: 'full' }
  ],
  wonder_woman: [
    { name: 'front',         yaw: 0,  distance: 1.6, framing: 'upper' },
    { name: 'three-quarter', yaw: 40, distance: 3.0, framing: 'upper' },
    { name: 'gameplay',      yaw: 20, distance: 9.0, framing: 'full' }
  ]
};
for (const target of [{ slug: 'thor', index: 1 }, { slug: 'wonder_woman', index: 0 }]) {
  for (const shot of PLANS[target.slug]) {
    const info = await page.evaluate(({ i, s }) => {
      const f = window.fighters || [];
      // Keep the opponent out of frame: hide its model for the shot only.
      f.forEach((x, k) => { if (x.model) x.model.visible = (k === i); });
      const cam = window.smashCamera;
      const described = cam.spectate({ fighter: f[i], framing: s.framing, distance: s.distance, yaw: s.yaw, pitch: 2 });
      const rs = document.querySelector('#roundScore');
      const hud = document.querySelector('#hud');
      const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
      return { spectate: described, hudClass: document.body.classList.contains('spectating'),
               roundScoreVisible: vis(rs), hudVisible: vis(hud) };
    }, { i: target.index, s: shot });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${target.slug}-${shot.name}.png` });
    console.log(target.slug, shot.name, 'hudVisible=' + info.hudVisible, 'roundBannerVisible=' + info.roundScoreVisible);
  }
}
await browser.close(); server.close();
