// Asgard marble + architecture A/B, from one camera.
//
// Shot 1/2: the same 25 city-marble surfaces with the old warm tint and the new blue-grey tint, so
// the palette change can be judged without any other difference. Shot 3/4: the new architectural
// geometry hidden and shown at the same camera, which is the only honest way to show that the detail
// is real geometry rather than a texture change.
//
//   bash scripts/run-browser-test.sh scripts/capture-asgard-architecture.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/asgard-arch';
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
page.setDefaultTimeout(150000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 130000, polling: 250 });
await page.evaluate(() => {
  const select = document.querySelector('#menuMapSelect');
  select.value = 'asgard';
  select.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(700);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select('p1', 'Goku');
  window.__browserSmashSelect?.select('p2', 'Naruto Uzumaki');
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(2200);
await page.evaluate(() => { window.__browserSmashTrainingDummy = true; window.__browserSmashFreezeAI = true; });

const inventory = await page.evaluate(() => {
  const scene = window.__browserSmashScene;
  const marbles = new Set();
  let marbleMeshes = 0;
  scene.traverse(node => {
    if (!node.isMesh) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    if (!/city marble/i.test(material?.name || '')) return;
    marbleMeshes += 1;
    marbles.add(material);
  });
  const arch = window.__browserSmashAsgardArchitectureMeshes || [];
  return {
    marbleMeshes,
    marbleMaterials: [...marbles].map(material => ({ name: material.name, tint: material.color.getHexString(), hasMap: Boolean(material.map), hasNormal: Boolean(material.normalMap), hasRoughness: Boolean(material.roughnessMap), normalScale: material.normalScale?.x ?? null })),
    architecture: window.__browserSmashAsgardArchitecture || null,
    archMeshes: arch.map(mesh => ({ name: mesh.name, vertices: mesh.geometry?.attributes?.position?.count || 0, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow })),
    archVisible: arch.map(mesh => mesh.visible)
  };
});

const setTint = hex => page.evaluate(value => {
  const scene = window.__browserSmashScene;
  scene.traverse(node => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) if (/city marble/i.test(material?.name || '')) material.color.setHex(value);
  });
}, hex);
const setArch = visible => page.evaluate(value => {
  for (const mesh of window.__browserSmashAsgardArchitectureMeshes || []) mesh.visible = value;
}, visible);
const place = (x, z) => page.evaluate(({ x, z }) => {
  const player = window.fighters[0];
  player.position.set(x, 0.05, z);
  player.velocity.set(0, 0, 0);
}, { x, z });
const shoot = async (name, camera, settle = 900) => {
  await page.evaluate(c => {
    const target = c.fighter === 'p2' ? window.fighters?.[1] : window.fighters?.[0];
    window.smashCamera?.spectate?.({ ...c, fighter: target });
  }, camera);
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.evaluate(() => window.smashCamera?.endSpectate?.());
};

// Palace-side view of the western civilian hall cluster.
await place(-35, 21);
await setArch(false);
await setTint(0xf4f0ea);
await shoot('1-marble-warm-before', { fighter: 'p1', framing: 'full', yaw: 4, pitch: -3 });
await setTint(0xb9c4d0);
await shoot('2-marble-blue-grey-after', { fighter: 'p1', framing: 'full', yaw: 4, pitch: -3 });
await shoot('3-architecture-off', { fighter: 'p1', framing: 'full', yaw: 4, pitch: -3 });
await setArch(true);
await shoot('4-architecture-on', { fighter: 'p1', framing: 'full', yaw: 4, pitch: -3 });
// Wider vantage for the overall silhouette change.
await place(-8, 26);
await shoot('5-architecture-wide', { fighter: 'p1', framing: 'full', yaw: 26, pitch: 12 });
// Bifrost gate piers, which gained stepped bases and capitals.
await place(0, 34);
await shoot('6-bifrost-piers', { fighter: 'p1', framing: 'full', yaw: 0, pitch: -2 });

const report = {
  inventory,
  finalTint: await page.evaluate(() => {
    const scene = window.__browserSmashScene;
    let tint = null;
    scene.traverse(node => {
      if (tint || !node.isMesh) return;
      const material = Array.isArray(node.material) ? node.material[0] : node.material;
      if (/city marble/i.test(material?.name || '')) tint = material.color.getHexString();
    });
    return tint;
  }),
  errors
};
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log('ASGARD_ARCH ' + JSON.stringify({
  marbleMeshes: inventory.marbleMeshes,
  marbleMaterials: inventory.marbleMaterials,
  architecture: inventory.architecture,
  archMeshes: inventory.archMeshes,
  errors: errors.length
}));
await browser.close(); server.close();
