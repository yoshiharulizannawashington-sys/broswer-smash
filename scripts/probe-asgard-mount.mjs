// What is actually mounted when Asgard is selected?
//
// The earlier material inventory reported CinematicValleyEnvironment and Final Valley meshes while
// Asgard was selected, so before touching any material this records the real scene: which arena asset
// loaded, which roots are visible, how many meshes each contributes, and where the camera is looking.
//
//   bash scripts/run-browser-test.sh scripts/probe-asgard-mount.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
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

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));

const report = () => page.evaluate(() => {
  const scene = window.__browserSmashScene;
  if (!scene) return { error: 'no scene' };
  const roots = scene.children.map(child => {
    let meshes = 0;
    let visibleMeshes = 0;
    child.traverse(node => { if (node.isMesh) { meshes++; if (node.visible) visibleMeshes++; } });
    return { name: child.name || '(unnamed)', type: child.type, visible: child.visible !== false, meshes, visibleMeshes };
  });
  const camera = window.camera || window.smashCamera?.camera;
  const dir = camera ? camera.getWorldDirection(new window.__browserSmashThree.Vector3()) : null;
  return {
    activeArena: window.__browserSmashAssets?.activeArena || null,
    arenas: window.__browserSmashAssets?.arenas || null,
    sceneRoots: roots.filter(r => r.meshes > 0).sort((a, b) => b.meshes - a.meshes).slice(0, 12),
    totals: { roots: scene.children.length, meshes: roots.reduce((n, r) => n + r.meshes, 0), visibleMeshes: roots.reduce((n, r) => n + r.visibleMeshes, 0) },
    camera: camera ? { position: camera.position.toArray().map(v => +v.toFixed(2)), direction: dir ? dir.toArray().map(v => +v.toFixed(2)) : null } : null,
    fighters: (window.fighters || []).map(f => ({ name: f.name, position: f.position.toArray().map(v => +v.toFixed(2)) })),
    mapKey: window.mapSelect?.value || null,
    applyMapType: typeof window.applyMap
  };
});

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashSelect?.select('p1', 'Superman');
  window.__browserSmashSelect?.select('p2', 'Thor');
});
const choose = async key => {
  await page.evaluate(arenaKey => window.__browserSmashSelect?.chooseArena(arenaKey), key);
  await page.waitForTimeout(1500);
};
await choose('asgard');
await page.evaluate(() => document.querySelector('#play').click());
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(4000);
console.log('ASGARD', JSON.stringify(await report(), null, 1));
await page.screenshot({ path: 'artifacts/compare/asgard-mount/asgard-gameplay.png' });

// Switch away and back inside the running match, to see whether the previous arena is left behind.
for (const key of ['valley', 'asgard', 'finalvalley', 'asgard']) {
  const switched = await page.evaluate(arenaKey => {
    if (typeof window.__browserSmashApplyMap !== 'function') return false;
    window.__browserSmashApplyMap(arenaKey);
    return true;
  }, key);
  await page.waitForTimeout(2500);
  console.log('SWITCH', key, 'applied=' + switched, JSON.stringify(await report()));
}
console.log('ERRORS', JSON.stringify(errors.slice(0, 3)));
await browser.close();
server.close();
