// Screen-space coverage probe: what does the player actually see in Asgard?
// Casts a 32 x 18 grid of rays through the live gameplay camera and records the first opaque surface
// each one hits. Coverage = share of sampled screen area, which is the only honest way to say a
// surface "exists in gameplay" rather than merely existing in the scene graph.
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
  const camera = window.smashCamera?.camera;
  const scene = window.__browserSmashScene;
  const raycaster = new T.Raycaster();
  const NX = 32, NY = 18;
  const mats = new Map();
  const meshes = new Map();
  let hits = 0, misses = 0, transparentHits = 0;
  const byMatMeshes = new Map();

  for (let ix = 0; ix < NX; ix += 1) {
    for (let iy = 0; iy < NY; iy += 1) {
      const ndc = new T.Vector2(((ix + 0.5) / NX) * 2 - 1, ((iy + 0.5) / NY) * 2 - 1);
      raycaster.setFromCamera(ndc, camera);
      raycaster.far = 4000;
      const list = raycaster.intersectObjects(scene.children, true)
        .filter(h => h.object.visible && h.object.isMesh);
      const hit = list.find(h => {
        const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
        return !m || (!m.transparent && (m.opacity ?? 1) >= 0.9);
      });
      if (!hit) { misses += 1; continue; }
      if (hit !== list[0]) transparentHits += 1;
      hits += 1;
      const m = Array.isArray(hit.object.material) ? hit.object.material[0] : hit.object.material;
      const matName = m?.name || '(unnamed)';
      mats.set(matName, (mats.get(matName) || 0) + 1);
      const token = (hit.object.name || '(unnamed mesh)').replace(/\d+$/, '');
      meshes.set(token, (meshes.get(token) || 0) + 1);
      const bucket = byMatMeshes.get(matName) || new Map();
      bucket.set(token, (bucket.get(token) || 0) + 1);
      byMatMeshes.set(matName, bucket);
    }
  }
  const total = NX * NY;
  const rank = map => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, rays: count, pct: +(100 * count / total).toFixed(1) }));
  const matsRanked = rank(mats).map(r => ({
    ...r,
    meshes: [...(byMatMeshes.get(r.name) || new Map()).entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => `${n}(${c})`)
  }));
  return { camera: camera.position.toArray().map(v => +v.toFixed(2)), gridTotal: total, hits, misses, transparentHits, materials: matsRanked, meshes: rank(meshes) };
});

await writeFile(`${out}/screen-coverage.json`, JSON.stringify(data, null, 2));
console.log('COVERAGE ' + JSON.stringify({ total: data.gridTotal, hits: data.hits, misses: data.misses, transparentHits: data.transparentHits }));
for (const row of data.materials) console.log(`  ${String(row.pct).padStart(5)}%  ${row.name}  ${row.meshes.join(' ')}`);
console.log('MESHES ' + JSON.stringify(data.meshes.slice(0, 12)));
await browser.close(); server.close();
