// Which Asgard surfaces are actually visible stone? Traverses the mounted palace, measures each
// mesh's world bounds and surface area, then raycasts from the gameplay camera to sample points on
// the mesh so "visible" is measured rather than inferred from a material name.
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

const report = await page.evaluate(() => {
  const T = window.__browserSmashThree;
  const camera = window.smashCamera?.camera;
  const scene = window.__browserSmashScene;
  const raycaster = new T.Raycaster();
  const rows = [];
  scene.traverse(node => {
    if (!node.isMesh || !node.visible) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    const name = material?.name || '(unnamed)';
    if (!/asgard/i.test(name)) return;
    node.updateWorldMatrix(true, false);
    const box = new T.Box3().setFromObject(node);
    const size = box.getSize(new T.Vector3());
    const geometry = node.geometry;
    let area = 0;
    const pos = geometry?.getAttribute('position');
    if (pos && geometry.index) {
      const idx = geometry.index.array;
      const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
      for (let i = 0; i < idx.length; i += 3) {
        a.fromBufferAttribute(pos, idx[i]).applyMatrix4(node.matrixWorld);
        b.fromBufferAttribute(pos, idx[i + 1]).applyMatrix4(node.matrixWorld);
        c.fromBufferAttribute(pos, idx[i + 2]).applyMatrix4(node.matrixWorld);
        area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      }
    }
    // Sample points across the world box and test line of sight from the gameplay camera.
    let sampled = 0, visible = 0;
    for (let ix = 0; ix < 3; ix += 1) for (let iy = 0; iy < 3; iy += 1) for (let iz = 0; iz < 3; iz += 1) {
      const p = new T.Vector3(
        box.min.x + size.x * (0.15 + ix * 0.35),
        box.min.y + size.y * (0.15 + iy * 0.35),
        box.min.z + size.z * (0.15 + iz * 0.35)
      );
      const dir = p.clone().sub(camera.position);
      const dist = dir.length();
      if (dist < 0.001) continue;
      raycaster.set(camera.position, dir.normalize());
      raycaster.far = dist + 0.05;
      const hits = raycaster.intersectObjects(scene.children, true).filter(h => h.object.visible);
      sampled += 1;
      if (hits[0]?.object === node) visible += 1;
    }
    rows.push({
      mesh: node.name || '(unnamed mesh)',
      material: name,
      size: [size.x, size.y, size.z].map(v => +v.toFixed(1)),
      areaM2: Math.round(area),
      lineOfSight: sampled ? +(visible / sampled).toFixed(2) : 0,
      triangles: Math.round((geometry?.index?.count || 0) / 3)
    });
  });
  rows.sort((x, y) => (y.lineOfSight * y.areaM2) - (x.lineOfSight * x.areaM2));
  return rows.slice(0, 18);
});

await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log('STONE ' + JSON.stringify(report));
await browser.close(); server.close();
