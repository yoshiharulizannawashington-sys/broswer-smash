// Title backdrop measurement, before vs after the compact-panel change.
//
// At the Chromebook viewport (1366 x 768) this captures every authored title map and measures what
// the eye is supposed to see: the menu's footprint as a share of the screen, where the landmark
// lands relative to the panel, how much live geometry covers the frame, and the button hit sizes.
// It does not judge colour; the luminance comparison is done on the saved PNGs afterwards.
//
//   TITLE_PHASE=before bash scripts/run-browser-test.sh scripts/measure-title-backdrop.mjs
//   TITLE_PHASE=after  bash scripts/run-browser-test.sh scripts/measure-title-backdrop.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const phase = process.env.TITLE_PHASE || 'before';
const root = process.cwd();
const out = `artifacts/title-backdrop/${phase}`;
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const MAPS = ['asgard', 'hogwarts', 'deathstar', 'tournament', 'starktower'];
const W = 1366;
const H = 768;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(150000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 130000, polling: 250 });
await page.waitForTimeout(700);

const report = { phase, viewport: { width: W, height: H }, maps: {}, errors };
for (const key of MAPS) {
  await page.evaluate(k => {
    for (const sel of [document.querySelector('#mapSelect'), document.querySelector('#menuMapSelect')]) {
      if (sel) { sel.value = k; sel.dispatchEvent(new Event('change')); }
    }
    window.__browserSmashApplyMap(k);
  }, key);
  await page.waitForFunction(k => window.__browserSmashAssets?.authoredArena?.key === k
    && window.__browserSmashAssets.authoredArena.status === 'loaded', key, { timeout: 90000, polling: 300 });
  await page.waitForTimeout(1000);

  const data = await page.evaluate(k => {
    const THREE = window.__browserSmashThree;
    const camera = window.smashCamera?.camera;
    const group = window.__browserSmashAuthoredGroup;
    const state = window.__browserSmashTitleCamera?.();
    const title = document.querySelector('#bbTitle');
    const panel = title?.closest('.panel');
    const nav = [...document.querySelectorAll('#bbTitle .bb-title-nav button')];
    if (!THREE || !camera || !state?.shot) return { key: k, error: 'missing handle' };
    const r = panel.getBoundingClientRect();
    const tr = title.getBoundingClientRect();
    const area = Math.max(0, r.width * r.height);
    const anchor = new THREE.Vector3(state.shot.anchor[0], state.shot.anchor[1], state.shot.anchor[2]).project(camera);
    const screen = { x: Math.round((anchor.x + 1) / 2 * innerWidth), y: Math.round((1 - anchor.y) / 2 * innerHeight) };
    const insidePanel = screen.x >= r.left && screen.x <= r.right && screen.y >= r.top && screen.y <= r.bottom;
    const style = getComputedStyle(panel);
    // Live-geometry coverage across the frame, the same probe the acceptance suite uses.
    const raycaster = new THREE.Raycaster();
    let covered = 0;
    let sampled = 0;
    if (group) {
      group.updateWorldMatrix(true, true);
      for (const nx of [-0.8, -0.4, 0, 0.4, 0.8]) {
        for (const ny of [-0.6, -0.2, 0.2, 0.6, 0.9]) {
          const point = new THREE.Vector3(nx, ny, 0.5).unproject(camera);
          raycaster.set(camera.position, point.sub(camera.position).normalize());
          const hit = raycaster.intersectObject(group, true)[0];
          sampled += 1;
          if (hit && hit.distance > 1.5) covered += 1;
        }
      }
    }
    return {
      key: k,
      panel: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), areaPercent: +(area / (innerWidth * innerHeight) * 100).toFixed(1) },
      title: { width: Math.round(tr.width), height: Math.round(tr.height) },
      style: { backdropFilter: style.backdropFilter, backgroundImage: style.backgroundImage.slice(0, 90), borderRadius: style.borderRadius },
      landmark: { ...screen, ndcY: +anchor.y.toFixed(3), insidePanel, visible: !insidePanel && screen.y > 0 && screen.y < innerHeight },
      coverage: { covered, sampled },
      buttons: nav.map(b => {
        const br = b.getBoundingClientRect();
        const bs = getComputedStyle(b);
        return { label: b.dataset.nav, w: Math.round(br.width), h: Math.round(br.height), color: bs.color, background: bs.backgroundColor };
      }),
      menuBackground: getComputedStyle(document.querySelector('#menu')).backgroundImage.slice(0, 120)
    };
  }, key);
  report.maps[key] = data;
  await page.screenshot({ path: `${out}/${key}.png` });
  console.log('TITLE_MAP', JSON.stringify({ key, error: data.error || null, panel: data.panel, landmark: data.landmark, coverage: data.coverage, buttons: data.buttons?.length }));
}
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log('TITLE_BACKDROP ' + JSON.stringify({
  phase,
  maps: Object.values(report.maps).map(m => ({ key: m.key, panelArea: m.panel?.areaPercent, landmarkVisible: m.landmark?.visible, coverage: m.coverage })),
  errors: errors.length
}));
await browser.close();
server.close();
