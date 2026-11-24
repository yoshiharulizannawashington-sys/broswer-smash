// Asgard evidence pass: one real match, captured three ways from the same camera position -
// the arena as it ships now, a close-up of the Rock030 stone surface, and the same frame with the
// material and lighting reverted to the pre-fix values. Also records the material wiring, what the
// fighters actually stand on, whether the stone mesh is visible at all, and any failed requests.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/asgard-evidence';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
const missing = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
page.on('response', r => { if (r.status() >= 400) missing.push(`${r.status()} ${new URL(r.url()).pathname}`); });

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForFunction(() => window.__browserSmashSkyStatus?.loaded, null, { timeout: 60000, polling: 250 }).catch(() => {});
await page.evaluate(() => {
  const select = document.querySelector('#menuMapSelect');
  select.value = 'asgard';
  select.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const key = (t, c) => window.dispatchEvent(new KeyboardEvent(t, { code: c, key: 'j', bubbles: true }));
  key('keydown', 'KeyJ');
  for (let i = 0; i < 40; i += 1) { window.__browserSmashStep(1 / 60); window.__browserSmashAttackTick?.(); }
  key('keyup', 'KeyJ');
});
await page.screenshot({ path: `${out}/01-after-asgard.png` });

const wiring = await page.evaluate(() => {
  const T = window.__browserSmashThree;
  const scene = window.__browserSmashScene;
  const rows = [];
  let stoneMesh = null;
  scene.traverse(n => {
    if (!n.isMesh) return;
    const m = Array.isArray(n.material) ? n.material[0] : n.material;
    if (m?.name === 'Asgard · warm stone' && !stoneMesh) stoneMesh = n;
    if (!/^Asgard/.test(m?.name || '')) return;
    if (rows.some(r => r.material === m.name)) return;
    rows.push({
      material: m.name,
      colorMap: Boolean(m.map), normalMap: Boolean(m.normalMap), roughnessMap: Boolean(m.roughnessMap),
      aoMap: Boolean(m.aoMap), aoMapIntensity: m.aoMapIntensity, metalnessMap: Boolean(m.metalnessMap),
      roughness: m.roughness, metalness: m.metalness,
      mapColorSpace: m.map?.colorSpace || null,
      normalColorSpace: m.normalMap?.colorSpace || null,
      mapRepeat: m.map?.repeat ? [m.map.repeat.x, m.map.repeat.y] : null,
      hasUv1: Boolean(n.geometry?.getAttribute('uv1')),
      emissiveIntensity: m.emissiveIntensity
    });
  });
  // What is the fighter actually standing on, and is the stone mesh the visible surface?
  const name = n => { const m = Array.isArray(n.material) ? n.material[0] : n.material; return m?.name || '(unnamed)'; };
  const fighter = window.fighters?.[0];
  const fx = fighter?.position?.x ?? 0, fz = fighter?.position?.z ?? 0;
  const down = new T.Raycaster(new T.Vector3(fx, 12, fz), new T.Vector3(0, -1, 0));
  const below = down.intersectObjects(scene.children, true).filter(h => h.object.visible).slice(0, 4)
    .map(h => ({ material: name(h.object), y: +h.point.y.toFixed(2), faceUp: h.face ? h.face.normal.y > 0.5 : null }));
  let occlusion = null;
  if (stoneMesh) {
    stoneMesh.updateWorldMatrix(true, false);
    const box = new T.Box3().setFromObject(stoneMesh);
    const center = box.getCenter(new T.Vector3());
    const camera = window.smashCamera?.camera;
    if (camera) {
      const dir = camera.position.clone().sub(center).normalize();
      const ray = new T.Raycaster(center.clone().addScaledVector(dir, 0.05), dir);
      const hit = ray.intersectObjects(scene.children, true).filter(h => h.object.visible)[0];
      occlusion = { firstHitTowardCamera: hit ? name(hit.object) : null, stoneVisible: hit ? hit.object === stoneMesh : null };
    }
  }
  return { rows, stoneFound: Boolean(stoneMesh), below, occlusion };
});

// Close-up: render the scene through a throwaway camera framed on the stone and read the WebGL
// buffer in the same task (the drawing buffer is still valid there), so the game camera and match
// loop are never touched and the composited game frame cannot be mistaken for this render.
const closeup = await page.evaluate(() => {
  const T = window.__browserSmashThree;
  const scene = window.__browserSmashScene;
  const renderer = window.__browserSmashRenderer;
  let stone = null;
  scene.traverse(n => { if (!stone && n.isMesh && (Array.isArray(n.material) ? n.material[0] : n.material)?.name === 'Asgard · warm stone') stone = n; });
  if (!stone) return null;
  stone.updateWorldMatrix(true, false);
  const box = new T.Box3().setFromObject(stone);
  const center = box.getCenter(new T.Vector3());
  const cam = new T.PerspectiveCamera(50, 16 / 9, 0.05, 4000);
  cam.position.copy(center).add(new T.Vector3(1.6, 2.2, 1.6));
  cam.lookAt(center.clone().add(new T.Vector3(0.6, 0, 0.6)));
  renderer.render(scene, cam);
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    const src = (h - 1 - y) * w * 4;
    img.data.set(pixels.subarray(src, src + w * 4), y * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL('image/png'), center: center.toArray() };
});
if (closeup) await writeFile(`${out}/02-stone-closeup.png`, Buffer.from(closeup.url.split(',')[1], 'base64'));

await page.evaluate(() => {
  const scene = window.__browserSmashScene;
  const renderer = window.__browserSmashRenderer;
  scene.traverse(n => {
    const m = n.isMesh ? (Array.isArray(n.material) ? n.material[0] : n.material) : null;
    if (m?.name !== 'Asgard · warm stone') return;
    m.map = null; m.normalMap = null; m.roughnessMap = null; m.aoMap = null; m.metalnessMap = null;
    m.color?.setHex(0x3d372f); m.roughness = 0.84; m.metalness = 0.04; m.needsUpdate = true;
  });
  if (window.__browserSmashSun) window.__browserSmashSun.intensity = 2.3;
  renderer.toneMappingExposure = 0.96;
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/03-before-asgard.png` });

const status = await page.evaluate(() => ({
  sky: window.__browserSmashSkyStatus || null,
  outputColorSpace: window.__browserSmashRenderer?.outputColorSpace ?? null,
  toneMapping: window.__browserSmashRenderer?.toneMapping ?? null
}));
await writeFile(`${out}/report.json`, JSON.stringify({ ...status, wiring, closeup: Boolean(closeup), errors, missing: [...new Set(missing)] }, null, 2));
console.log('ASGARD_EVIDENCE', JSON.stringify({ ...status, wiring: wiring.rows.filter(r => r.material === 'Asgard · warm stone'), below: wiring.below, occlusion: wiring.occlusion, closeup: Boolean(closeup), errors: errors.slice(-4), missing: [...new Set(missing)].slice(0, 8) }));
await browser.close(); server.close();
