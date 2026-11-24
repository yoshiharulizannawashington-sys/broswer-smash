// Hogwarts Great Hall stone architecture A/B, from identical cameras.
//
// Shots come in pairs: the merged moulding meshes hidden, then visible, with the fighter and camera
// unmoved. That is the only honest way to show the detail is real geometry rather than a material or
// lighting change. The hall is also shot at gameplay distance, not just as a close-up.
//
//   bash scripts/run-browser-test.sh scripts/capture-hogwarts-architecture.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/hogwarts-arch';
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
  select.value = 'hogwarts';
  select.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(900);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select('p1', 'Goku');
  window.__browserSmashSelect?.select('p2', 'Naruto Uzumaki');
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(2400);
await page.evaluate(() => { window.__browserSmashTrainingDummy = true; window.__browserSmashFreezeAI = true; });

// The authored arena mounts asynchronously and the late stone pass retries; wait for the hall's
// stone meshes and the architecture report rather than guessing a delay.
await page.waitForFunction(() => (window.__browserSmashHogwartsArchitecture?.added || 0) > 0, null, { timeout: 40000, polling: 250 }).catch(() => {});

const inventory = await page.evaluate(() => {
  const scene = window.__browserSmashScene;
  const stoneMaterials = new Map();
  let stoneMeshes = 0;
  scene.traverse(node => {
    if (!node.isMesh) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    const name = material?.name || '';
    if (!/(old stone|worn stone)/i.test(name)) return;
    stoneMeshes += 1;
    stoneMaterials.set(name, {
      name,
      map: Boolean(material.map),
      normalMap: Boolean(material.normalMap),
      roughnessMap: Boolean(material.roughnessMap),
      metalness: material.metalness
    });
  });
  const meshes = window.__browserSmashHogwartsArchitectureMeshes || [];
  return {
    stoneMeshes,
    stoneMaterials: [...stoneMaterials.values()],
    architecture: window.__browserSmashHogwartsArchitecture || null,
    trimMeshes: meshes.map(mesh => ({
      name: mesh.name,
      vertices: mesh.geometry?.attributes?.position?.count || 0,
      triangles: (mesh.geometry?.index?.count || 0) / 3,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      visible: mesh.visible
    })),
    layout: (() => { try { return window.__browserSmashLayout?.() || null; } catch { return null; } })()
  };
});

const setArch = visible => page.evaluate(value => {
  for (const mesh of window.__browserSmashHogwartsArchitectureMeshes || []) mesh.visible = value;
}, visible);
const shoot = async (name, camera, settle = 800) => {
  await page.evaluate(c => window.smashCamera?.spectate?.({ ...c, fighter: window.fighters?.[0] }), camera);
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.evaluate(() => window.smashCamera?.endSpectate?.());
  console.log('SHOT', name);
};

// Pair 1: down the nave, the view a player actually gets when the match starts.
await setArch(false);
await shoot('1-nave-architecture-off', { framing: 'full', yaw: 180, pitch: 5 });
await setArch(true);
await shoot('2-nave-architecture-on', { framing: 'full', yaw: 180, pitch: 5 });
// Pair 2: the pier wall and arcade, where the plinths, capitals and panel frames sit.
await setArch(false);
await shoot('3-piers-off', { framing: 'full', yaw: 92, pitch: 0 });
await setArch(true);
await shoot('4-piers-on', { framing: 'full', yaw: 92, pitch: 0 });
// Pair 3: looking up at the arches and vault ribs, the highest-contrast additions.
await setArch(false);
await shoot('5-vault-off', { framing: 'full', yaw: 8, pitch: 26 });
await setArch(true);
await shoot('6-vault-on', { framing: 'full', yaw: 8, pitch: 26 });
// Gameplay distance: the hall with both fighters, architecture shown.
await shoot('7-gameplay-distance', { framing: 'full', yaw: 150, pitch: 9, distance: 13 });

const report = {
  inventory,
  architectureVisible: await page.evaluate(() => (window.__browserSmashHogwartsArchitectureMeshes || []).map(mesh => mesh.visible)),
  errors
};
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log('HOGWARTS_ARCH ' + JSON.stringify({
  parts: inventory.architecture?.added,
  meshCount: inventory.architecture?.meshCount,
  surfaces: inventory.architecture?.surfaces,
  kinds: inventory.architecture?.kinds,
  trimMeshes: inventory.trimMeshes,
  stoneMeshes: inventory.stoneMeshes,
  errors: errors.length
}));
await browser.close();
server.close();
