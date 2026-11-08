// Screen coverage of Asgard, measured correctly.
// The earlier pass filtered only each leaf mesh's own `visible` flag; three's raycaster still hits
// meshes whose parent group is hidden, which is how hidden procedural set dressing appeared to fill
// 62% of the frame. Here visibility walks the whole ancestor chain, and every named probe aims its
// own ray. Coverage is reported per material and per mesh, and each hit is tagged with whether it
// belongs to the Asgard GLB group or to the procedural layer beneath it.
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

  const effectivelyVisible = object => {
    for (let node = object; node; node = node.parent) if (node.visible === false) return false;
    return true;
  };
  const ownerOf = object => {
    for (let node = object; node; node = node.parent) {
      if (/Blender arena · asgard/i.test(node.name || '')) return 'asgard-glb';
      if (/final valley|procedural/i.test(node.name || '')) return 'procedural';
    }
    return 'other';
  };
  const opaque = object => {
    const m = Array.isArray(object.material) ? object.material[0] : object.material;
    return !m || (!m.transparent && (m.opacity ?? 1) >= 0.9);
  };
  const cast = (x, y) => {
    raycaster.setFromCamera(new T.Vector2(x, y), camera);
    raycaster.far = 4000;
    const list = raycaster.intersectObjects(scene.children, true)
      .filter(h => h.object.isMesh && effectivelyVisible(h.object) && opaque(h.object));
    return list[0] || null;
  };

  const NX = 32, NY = 18;
  const tally = new Map();
  for (let ix = 0; ix < NX; ix += 1) {
    for (let iy = 0; iy < NY; iy += 1) {
      const x = ((ix + 0.5) / NX) * 2 - 1;
      const y = ((iy + 0.5) / NY) * 2 - 1;
      const hit = cast(x, y);
      if (!hit) continue;
      const object = hit.object;
      const m = Array.isArray(object.material) ? object.material[0] : object.material;
      const token = (object.name || '(unnamed mesh)').replace(/\d+$/, '');
      const key = `${m?.name || '(unnamed material)'} | ${token}`;
      const entry = tally.get(key) || { key, owner: ownerOf(object), rays: 0, distance: +hit.distance.toFixed(1), ndc: [] };
      entry.rays += 1;
      if (entry.ndc.length < 5) entry.ndc.push([+x.toFixed(2), +y.toFixed(2)]);
      tally.set(key, entry);
    }
  }
  const rows = [...tally.values()].sort((a, b) => b.rays - a.rays)
    .map(r => ({ ...r, pct: +(100 * r.rays / (NX * NY)).toFixed(1) }));

  const probes = {};
  for (const [label, x, y] of [
    ['centre', 0, 0], ['floorLow', 0, -0.75], ['leftMid', -0.75, -0.2], ['leftLower', -0.6, -0.55],
    ['rightLower', 0.5, -0.6], ['upperLeft', -0.4, 0.55], ['upperRight', 0.55, 0.4]
  ]) {
    const hit = cast(x, y);
    if (!hit) { probes[label] = { miss: true }; continue; }
    const object = hit.object;
    const m = Array.isArray(object.material) ? object.material[0] : object.material;
    probes[label] = {
      mesh: object.name || '(unnamed mesh)',
      material: m?.name || '(unnamed material)',
      owner: ownerOf(object),
      geometry: object.geometry?.type,
      maps: !!m?.map, normalMap: !!m?.normalMap, roughnessMap: !!m?.roughnessMap,
      distance: +hit.distance.toFixed(2)
    };
  }
  return { camera: camera.position.toArray().map(v => +v.toFixed(2)), rows: rows.slice(0, 16), probes };
});

await writeFile(`${out}/coverage-visible.json`, JSON.stringify(data, null, 2));
await page.screenshot({ path: `${out}/00-current-match.png` });
console.log('PROBES ' + JSON.stringify(data.probes));
for (const row of data.rows) console.log(`  ${String(row.pct).padStart(5)}%  ${row.owner.padEnd(10)} ${row.key}  d=${row.distance}`);
await browser.close(); server.close();
