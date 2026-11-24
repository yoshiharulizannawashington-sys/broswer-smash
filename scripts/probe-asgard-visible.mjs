// Inventory + visibility pass for Asgard.
// 1) Every mesh name token in the mounted palace, grouped, with total surface area - so real stone
//    geometry (cliffs, walls, foundations, pillars) shows up even if its material is named marble.
// 2) Per-vertex test: is the vertex inside the gameplay camera frustum, and is the line from the
//    camera to that vertex clear (raycast stopping just short of the vertex)?
// Both are measured against the live camera, not guessed from names.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/asgard-stone';
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

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.evaluate(() => { const s = document.querySelector('#menuMapSelect'); s.value = 'asgard'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => { window.__browserSmashSelect?.select?.('p1', 'Goku'); window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki'); });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(2500);

const data = await page.evaluate(() => {
  const T = window.__browserSmashThree;
  const camera = window.smashCamera?.camera || window.__browserSmashCamera;
  const scene = window.__browserSmashScene;
  const raycaster = new T.Raycaster();
  const frustum = new T.Frustum().setFromProjectionMatrix(
    new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  );
  const groups = new Map();
  const mats = new Map();
  let meshTotal = 0;

  scene.traverse(node => {
    if (!node.isMesh) return;
    meshTotal += 1;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    const matName = material?.name || '(unnamed)';
    mats.set(matName, (mats.get(matName) || 0) + 1);
  });

  scene.traverse(node => {
    if (!node.isMesh || !node.visible) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    const matName = material?.name || '(unnamed)';
    if (!/asgard/i.test(matName)) return;
    node.updateWorldMatrix(true, false);
    const geometry = node.geometry;
    const pos = geometry?.getAttribute('position');
    if (!pos) return;
    const idx = geometry.index?.array;
    const tri = (idx ? idx.length : pos.count) / 3;
    const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
    let area = 0;
    for (let i = 0; i + 2 < (idx ? idx.length : pos.count); i += 3) {
      const i0 = idx ? idx[i] : i, i1 = idx ? idx[i + 1] : i + 1, i2 = idx ? idx[i + 2] : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(node.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(node.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(node.matrixWorld);
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    // Sample real surface vertices, stride so a dense mesh cannot dominate the runtime.
    const stride = Math.max(1, Math.floor(pos.count / 160));
    let onScreen = 0, clear = 0, sampled = 0;
    const world = new T.Vector3();
    for (let i = 0; i < pos.count; i += stride) {
      world.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld);
      if (!frustum.containsPoint(world)) continue;
      onScreen += 1;
      const dir = world.clone().sub(camera.position);
      const dist = dir.length();
      if (dist < 0.5) continue;
      raycaster.set(camera.position, dir.normalize());
      raycaster.far = dist - 0.08;
      sampled += 1;
      if (raycaster.intersectObjects(scene.children, true).length === 0) clear += 1;
    }
    const token = (node.name || 'unnamed').replace(/\d+$/, '');
    const bucket = groups.get(token) || { token, material: matName, meshes: 0, areaM2: 0, onScreenVerts: 0, clearVerts: 0 };
    bucket.meshes += 1;
    bucket.areaM2 += area;
    bucket.onScreenVerts += onScreen;
    bucket.clearVerts += clear;
    groups.set(token, bucket);
  });

  const rows = [...groups.values()].map(r => ({
    name: r.token, material: r.material, meshes: r.meshes,
    areaM2: Math.round(r.areaM2), inFrame: r.onScreenVerts, unoccluded: r.clearVerts
  })).sort((x, y) => y.unoccluded - x.unoccluded || y.areaM2 - x.areaM2);
  const topMats = [...mats.entries()].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([n, c]) => ({ n, c }));
  return {
    camera: camera.position.toArray().map(v => +v.toFixed(2)),
    fov: camera.fov, meshTotal,
    materials: topMats,
    visible: rows.filter(r => r.unoccluded > 0 || r.inFrame > 0).slice(0, 26),
    all: rows.length
  };
});

await writeFile(`${out}/report2.json`, JSON.stringify(data, null, 2));
console.log('INVENTORY ' + JSON.stringify(data));
await browser.close(); server.close();
