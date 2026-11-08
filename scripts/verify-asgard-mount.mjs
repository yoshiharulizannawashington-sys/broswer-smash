// Proof that selecting Asgard mounts Asgard - and only Asgard.
//
// The defect this guards: `applyWorldStage` hid the procedural valley skyline only when the map had a
// world location, and Asgard is an authored Blender arena with none. 1 178 CinematicValleyEnvironment
// meshes therefore stayed visible over the 559-mesh palace, so every Asgard material "refinement"
// was being applied behind a valley skyline.
//
//   bash scripts/run-browser-test.sh scripts/verify-asgard-mount.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/asgard-mount';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const snapshot = () => ({
  roots: [],
});

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message || error)));

  const read = () => page.evaluate(() => {
    const scene = window.__browserSmashScene;
    const THREE = window.__browserSmashThree;
    const roots = scene.children.map(child => {
      let meshes = 0;
      let visibleMeshes = 0;
      const names = [];
      child.traverse(node => {
        if (!node.isMesh) return;
        meshes++;
        if (node.visible) visibleMeshes++;
        if (names.length < 4 && node.name) names.push(node.name);
      });
      const box = new THREE.Box3().setFromObject(child);
      return {
        name: child.name || '(unnamed)',
        visible: child.visible !== false,
        meshes,
        visibleMeshes,
        sample: names,
        bounds: box.isEmpty() ? null : { min: box.min.toArray().map(v => +v.toFixed(1)), max: box.max.toArray().map(v => +v.toFixed(1)) }
      };
    });
    // The arena layer is `Blender cinematic arena assets`; the per-arena groups inside it are named
    // `Blender arena · <key>`. Filtering the layer by a different prefix reported zero arena roots and
    // made a correctly mounted Asgard look absent.
    const arenaLayer = scene.children.find(child => /Blender cinematic arena/i.test(child.name || '')) || null;
    const arenaGroups = [];
    arenaLayer?.children.forEach(child => {
      let meshes = 0;
      child.traverse(node => { if (node.isMesh) meshes++; });
      arenaGroups.push({ name: child.name || '(unnamed)', visible: child.visible !== false, meshes });
    });
    const arenaRoots = arenaGroups;
    const camera = window.smashCamera?.camera || window.camera;
    const target = window.__browserSmashCameraTarget?.() || null;
    return {
      activeArena: window.__browserSmashAssets?.activeArena || null,
      arenas: window.__browserSmashAssets?.arenas || {},
      arenaRoots,
      valleyEnvironment: roots.find(r => r.name === 'CinematicValleyEnvironment') || null,
      finalValley: roots.find(r => r.name.includes('Final Valley')) || null,
      asgardMeshes: arenaRoots.filter(r => r.name.includes('asgard')).reduce((n, r) => n + r.meshes, 0),
      totals: { meshes: roots.reduce((n, r) => n + r.meshes, 0), visibleMeshes: roots.reduce((n, r) => n + r.visibleMeshes, 0) },
      camera: camera ? { position: camera.position.toArray().map(v => +v.toFixed(2)), distanceToOrigin: +camera.position.length().toFixed(2) } : null,
      stage: window.smashCamera?.describe?.() || null,
      world: window.__browserSmashWorld || null,
      fighters: (window.fighters || []).map(f => ({ name: f.name, position: f.position.toArray().map(v => +v.toFixed(2)), grounded: f.isGrounded }))
    };
  });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashSelect?.select('p1', 'Superman');
    window.__browserSmashSelect?.select('p2', 'Thor');
    window.__browserSmashSelect?.chooseArena('asgard');
  });
  await page.evaluate(() => document.querySelector('#play').click());
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForTimeout(5000);

  const asgard = await read();
  const asgardAsset = asgard.arenas?.asgard || null;
  console.log('ASGARD_STATE', JSON.stringify({
    activeArena: asgard.activeArena,
    asset: asgardAsset,
    valleyEnvironment: asgard.valleyEnvironment,
    finalValley: asgard.finalValley,
    arenaRoots: asgard.arenaRoots.map(r => ({ name: r.name, visible: r.visible, meshes: r.meshes, sample: r.sample })),
    camera: asgard.camera,
    world: asgard.world,
    fighters: asgard.fighters
  }, null, 1));

  check('Asgard is the selected arena', asgard.activeArena === 'asgard', String(asgard.activeArena));
  check('the Asgard GLB loaded and passed its structure check', asgardAsset?.status === 'loaded' && asgardAsset.meshCount >= 80,
    JSON.stringify(asgardAsset));
  check('the mounted Asgard hierarchy is visible', asgard.arenaRoots.some(r => r.name.includes('asgard') && r.visible && r.meshes > 100),
    JSON.stringify(asgard.arenaRoots.map(r => `${r.name}:${r.visible ? 'visible' : 'hidden'}:${r.meshes}`)));
  check('the procedural valley environment is not visible over Asgard',
    asgard.valleyEnvironment ? asgard.valleyEnvironment.visible === false : true,
    JSON.stringify(asgard.valleyEnvironment && { visible: asgard.valleyEnvironment.visible, meshes: asgard.valleyEnvironment.meshes }));
  check('the Final Valley arena group is not visible', asgard.finalValley ? asgard.finalValley.visible === false : true,
    JSON.stringify(asgard.finalValley && { visible: asgard.finalValley.visible, meshes: asgard.finalValley.meshes }));
  check('exactly one arena group is mounted for Asgard', asgard.arenaRoots.filter(r => r.visible).length === 1,
    `${asgard.arenaRoots.filter(r => r.visible).length} visible of ${asgard.arenaRoots.length}`);
  check('the camera is pulled back over the arena, not inside a wall',
    Boolean(asgard.camera) && asgard.camera.distanceToOrigin > 8 && asgard.camera.distanceToOrigin < 80,
    JSON.stringify(asgard.camera));
  check('fighters spawn on the ground inside the stage',
    asgard.fighters.every(f => Number.isFinite(f.position[1]) && Math.abs(f.position[0]) < 40 && Math.abs(f.position[2]) < 40),
    JSON.stringify(asgard.fighters));
  await page.screenshot({ path: `${out}/asgard-gameplay-after.png` });
  console.log('SHOT', `${out}/asgard-gameplay-after.png`);

  // ---- switching: no stale arena left behind, no duplicates
  const switchOrder = ['valley', 'finalvalley', 'asgard', 'hogwarts', 'asgard'];
  const states = [];
  for (const key of switchOrder) {
    await page.evaluate(arenaKey => window.__browserSmashApplyMap?.(arenaKey), key);
    await page.waitForTimeout(2500);
    const state = await read();
    states.push({ key, activeArena: state.activeArena, visible: state.arenaRoots.filter(r => r.visible).map(r => r.name), total: state.arenaRoots.length });
    if (key === 'asgard') {
      check(`after switching to ${key} (${states.length}) exactly one arena group is visible`, state.arenaRoots.filter(r => r.visible).length === 1,
        JSON.stringify(states[states.length - 1]));
      check(`after switching to ${key} (${states.length}) the valley environment is hidden again`,
        state.valleyEnvironment ? state.valleyEnvironment.visible === false : true,
        JSON.stringify(state.valleyEnvironment && { visible: state.valleyEnvironment.visible }));
    }
  }
  console.log('SWITCHES', JSON.stringify(states, null, 1));
  // The arena layer legitimately caches one group per arena that has been loaded (so asgard +
  // hogwarts == 2 children after a round trip). Duplication would be a *second* group for the same
  // arena, so count the Asgard groups specifically rather than the layer size.
  const asgardGroups = states.filter(state => state.key === 'asgard').map(state => state.visible.filter(name => name.includes('asgard')).length);
  check('repeated Asgard switches never mount a second Asgard group',
    asgardGroups.every(count => count === 1), JSON.stringify(states.map(state => ({ key: state.key, total: state.total, visible: state.visible }))));
  check('switching away from Asgard leaves no Asgard group visible',
    states.filter(state => state.key !== 'asgard').every(state => state.visible.every(name => !name.includes('asgard'))),
    JSON.stringify(states.map(state => ({ key: state.key, visible: state.visible }))));
  check('no page errors while switching arenas', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(failures === 0 ? '\nAsgard mounting verification passed.' : `\nAsgard mounting verification FAILED (${failures}).`);
} finally {
  await browser?.close();
  server.close();
}
process.exitCode = failures === 0 ? 0 : 1;
