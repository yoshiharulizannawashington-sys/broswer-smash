// Acceptance for the real Asgard courtyard rim: placement, rendered luminance, captures, routes.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/asgard-rim';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name} ${detail ? '· ' + JSON.stringify(detail) : ''}`); };
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));

await page.goto(origin + '/?courtyardBand=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForTimeout(400);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  const menu = document.querySelector('#menuMapSelect');
  const select = document.querySelector('#mapSelect');
  if (menu) menu.value = 'asgard';
  if (select) { select.value = 'asgard'; select.dispatchEvent(new Event('change')); }
  window.__browserSmashApplyMap('asgard');
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(3500);

const geometry = await page.evaluate(() => {
  const THREE = window.__browserSmashThree;
  const meshes = window.__browserSmashAsgardCourtyardMeshes || [];
  const box = new THREE.Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
  const layout = window.__browserSmashLayout();
  const size = box.getSize(new THREE.Vector3());
  return {
    meshCount: meshes.length,
    names: meshes.map(m => m.name),
    bounds: { min: box.min.toArray().map(v => +v.toFixed(2)), max: box.max.toArray().map(v => +v.toFixed(2)) },
    size: size.toArray().map(v => +v.toFixed(1)),
    layout: { label: layout.label, bounds: layout.bounds },
    report: window.__browserSmashAsgardCourtyard || null,
    triangles: meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0)
  };
});
check('rim geometry exists', geometry.meshCount >= 3, { meshes: geometry.meshCount, names: geometry.names });
check('rim follows the real platform edge', Math.abs(geometry.bounds.max[0] - 63) < 2.5 && Math.abs(geometry.bounds.min[0] + 63) < 2.5 && Math.abs(geometry.bounds.max[2] - 44) < 2.5 && Math.abs(geometry.bounds.min[2] + 46) < 2.5, geometry.bounds);
check('rim is outside the inlay, not around it', geometry.bounds.max[0] > 55 && geometry.bounds.min[0] < -55, { width: geometry.size[0], depth: geometry.size[2] });
check('openings cover the avenue and gate', geometry.report?.openings?.south?.includes('-7..7') && geometry.report?.openings?.north?.includes('-13..13'), geometry.report?.openings);

// Same camera, band hidden then shown: a true before/after pair.
const camera = { fighter: 0, framing: 'wide', yaw: 0, pitch: -0.95, distance: 145 };
await page.evaluate(({ camera }) => window.smashCamera.spectate?.({ fighter: window.fighters[camera.fighter], framing: camera.framing, yaw: camera.yaw, pitch: camera.pitch, distance: camera.distance }), { camera });
await page.waitForTimeout(900);
await page.evaluate(() => { window.__browserSmashAsgardCourtyardMeshes?.forEach(m => { m.visible = false; }); });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/before-wide.png` });
await page.evaluate(() => { window.__browserSmashAsgardCourtyardMeshes?.forEach(m => { m.visible = true; }); });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/after-wide.png` });

// Rendered luminance from the live framebuffer: warm stone must stay readable on both halves.
const luminance = await page.evaluate(() => {
  const renderer = window.__browserSmashRenderer;
  const scene = window.__browserSmashScene;
  const cam = window.smashCamera?.camera;
  if (!renderer || !cam) return { available: false };
  renderer.render(scene, cam);
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const half = (x0, x1) => {
    const values = [];
    for (let y = Math.floor(h * 0.30); y < Math.floor(h * 0.62); y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const i = (y * w + x) * 4;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (r > g + 4 && g > b + 2 && lum > 18) values.push(lum);
      }
    }
    values.sort((a, b) => a - b);
    return { count: values.length, p25: values[Math.floor(values.length * 0.25)] || 0, p50: values[Math.floor(values.length * 0.5)] || 0 };
  };
  return { available: true, left: half(0, Math.floor(w / 2)), right: half(Math.floor(w / 2), w) };
});
if (luminance.available) {
  check('lit and shade stone remain readable', luminance.left.count > 50 && luminance.right.count > 50 && Math.min(luminance.left.p50, luminance.right.p50) > 35, luminance);
} else {
  check('rendered luminance measurable', false, 'renderer hook unavailable');
}

// Gameplay-distance view with fighters beside the south rim.
await page.evaluate(() => {
  const f = window.fighters[0], g = window.fighters[1];
  f.position.set(48, 0, -43); g.position.set(50, 0, -43.2);
  window.smashCamera.spectate?.({ fighter: f, framing: 'medium', yaw: 0, pitch: -0.15, distance: 12 });
});
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/gameplay-rim.png` });
await page.evaluate(() => window.smashCamera.spectate?.({ fighter: window.fighters[0], framing: 'close', yaw: 0, pitch: -0.08, distance: 6 }));
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/closeup-rim.png` });

check('no page errors', errors.length === 0, errors);
const report = { geometry, luminance, checks, errors };
await writeFile(`${out}/acceptance.json`, JSON.stringify(report, null, 2));
const failed = checks.filter(c => !c.ok);
console.log('SUMMARY ' + JSON.stringify({ passed: checks.length - failed.length, total: checks.length, failed: failed.map(c => c.name) }));
await browser.close();
server.close();
process.exitCode = failed.length ? 1 : 0;
