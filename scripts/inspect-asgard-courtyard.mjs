// Measure the real Asgard boundary before building anything.
//
// The first attempt dumped Final Valley geometry: switching arena starts an async GLB mount and a
// fixed 4.5 s wait was not enough under SwiftShader. This waits for the Asgard arena state to report
// loaded, then dumps every `Asgard · …` surface with its world bounds so the courtyard / outer-plaza
// boundary can be read from the model rather than guessed.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/asgard-courtyard';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForTimeout(400);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const select = document.querySelector('#mapSelect');
  if (select) { select.value = 'asgard'; select.dispatchEvent(new Event('change')); }
  window.__browserSmashApplyMap('asgard');
});
// Wait for the authored Asgard group, not just the switch call.
const loaded = await page.waitForFunction(() => {
  const state = window.__browserSmashAssets?.authoredArena;
  return state && state.key === 'asgard' && state.status === 'loaded' && window.__browserSmashAsgardArchitecture;
}, null, { timeout: 60000, polling: 250 }).then(() => true).catch(() => false);
await page.waitForTimeout(800);

const data = await page.evaluate(() => {
  const THREE = window.__browserSmashThree;
  const scene = window.__browserSmashScene;
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  const asgard = [];
  scene.traverse(node => {
    if (!node.isMesh || !node.geometry) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    if (!/^Asgard · /i.test(material?.name || '')) return;
    box.setFromObject(node);
    if (box.isEmpty()) return;
    box.getSize(size);
    box.getCenter(centre);
    asgard.push({
      name: node.name || '(unnamed)',
      material: material.name,
      maps: { map: Boolean(material.map), normal: Boolean(material.normalMap), roughness: Boolean(material.roughnessMap), ao: Boolean(material.aoMap) },
      min: [box.min.x, box.min.y, box.min.z].map(v => +v.toFixed(2)),
      max: [box.max.x, box.max.y, box.max.z].map(v => +v.toFixed(2)),
      size: [size.x, size.y, size.z].map(v => +v.toFixed(2)),
      centre: [+centre.x.toFixed(2), +centre.y.toFixed(2), +centre.z.toFixed(2)]
    });
  });
  const byMaterial = {};
  for (const row of asgard) {
    byMaterial[row.material] = byMaterial[row.material] || { count: 0, largest: [] };
    byMaterial[row.material].count += 1;
  }
  for (const row of asgard) {
    const bucket = byMaterial[row.material].largest;
    bucket.push(row);
    bucket.sort((a, b) => b.size[0] * b.size[2] - a.size[0] * a.size[2]);
    bucket.length = Math.min(bucket.length, 6);
  }
  return { total: asgard.length, byMaterial, architecture: window.__browserSmashAsgardArchitecture || null, arena: window.__browserSmashAssets?.authoredArena || null };
});
await writeFile(`${out}/surfaces.json`, JSON.stringify({ loaded, ...data, errors }, null, 2));
console.log('LOADED', loaded, 'TOTAL', data.total, 'ARENA', JSON.stringify(data.arena));
for (const [material, info] of Object.entries(data.byMaterial)) {
  console.log('MATERIAL', material, info.count);
  info.largest.forEach(row => console.log('  ', JSON.stringify(row)));
}
console.log('ARCH', JSON.stringify(data.architecture));
console.log('ERRORS', errors.length);
await browser.close(); server.close();
