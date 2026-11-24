// Identifies what the coverage probe could not name: the unnamed 47% surface and the exact meshes
// behind the stone-looking pixels. Also dumps the GLB's structural meshes (bases, piers, plinths,
// pediments) so stone architecture can be judged mesh by mesh instead of by material regex.
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
  const trace = (ndc, ray) => {
    const list = raycaster.intersectObjects(scene.children, true).filter(h => h.object.isMesh && h.object.visible);
    const hit = list.find(h => {
      const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
      return !m || (!m.transparent && (m.opacity ?? 1) >= 0.9);
    });
    if (!hit) return { ndc, miss: true };
    const object = hit.object;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    const chain = [];
    let node = object;
    for (let i = 0; node && i < 6; i += 1) { chain.push(node.name || (node.type || '?')); node = node.parent; }
    const box = new T.Box3().setFromObject(object);
    const size = box.getSize(new T.Vector3());
    // How many of the sampled rays this whole mesh wins.
    return {
      ndc: ndc.map(v => +v.toFixed(2)),
      geometry: object.geometry?.type,
      mesh: object.name || '(unnamed mesh)',
      material: material?.name || '(unnamed material)',
      colour: material?.color ? '#' + material.color.getHexString() : null,
      maps: !!material?.map,
      metalness: material?.metalness, roughness: material?.roughness,
      emissive: material?.emissive ? '#' + material.emissive.getHexString() : null,
      transparent: !!material?.transparent,
      chain,
      size: size.toArray().map(v => +v.toFixed(1)),
      distance: +hit.distance.toFixed(1)
    };
  };
  const probes = {
    centre: trace([0, 0], true),
    floorLow: trace([0, -0.85], true),
    leftStone: trace([-0.82, -0.15], true),
    leftStone2: trace([-0.62, -0.3], true),
    rightFloor: trace([0.55, -0.5], true),
    upperLeft: trace([-0.5, 0.45], true),
    upperRight: trace([0.6, 0.3], true)
  };
  // Full-frame tally keyed by material + mesh, keeping one representative detail record per key.
  const tally = new Map();
  const NX = 32, NY = 18;
  for (let ix = 0; ix < NX; ix += 1) {
    for (let iy = 0; iy < NY; iy += 1) {
      const ndc = [((ix + 0.5) / NX) * 2 - 1, ((iy + 0.5) / NY) * 2 - 1];
      raycaster.setFromCamera(new T.Vector2(ndc[0], ndc[1]), camera);
      raycaster.far = 4000;
      const list = raycaster.intersectObjects(scene.children, true).filter(h => h.object.isMesh && h.object.visible);
      const hit = list.find(h => {
        const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
        return !m || (!m.transparent && (m.opacity ?? 1) >= 0.9);
      });
      if (!hit) continue;
      const m = Array.isArray(hit.object.material) ? hit.object.material[0] : hit.object.material;
      const key = (m?.name || '(unnamed material)') + ' | ' + ((hit.object.name || '(unnamed mesh)').replace(/\d+$/, ''));
      const entry = tally.get(key) || { key, rays: 0, ndc: [], distance: +hit.distance.toFixed(1) };
      entry.rays += 1;
      if (entry.ndc.length < 6) entry.ndc.push(ndc.map(v => +v.toFixed(2)));
      tally.set(key, entry);
    }
  }
  const rows = [...tally.values()].sort((a, b) => b.rays - a.rays)
    .map(r => ({ ...r, pct: +(100 * r.rays / (NX * NY)).toFixed(1) }));
  return { probes, rows: rows.slice(0, 14), camera: camera.position.toArray().map(v => +v.toFixed(2)) };
});

await writeFile(`${out}/surface-identity.json`, JSON.stringify(data, null, 2));
await page.screenshot({ path: `${out}/00-current-match.png` });
console.log('IDENT ' + JSON.stringify(data.probes));
for (const row of data.rows) console.log(`  ${String(row.pct).padStart(5)}%  ${row.key}  d=${row.distance}  ndc=${JSON.stringify(row.ndc)}`);
await browser.close(); server.close();
