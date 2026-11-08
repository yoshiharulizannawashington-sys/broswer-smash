// What is actually in front of the duel camera in Asgard at spawn?
//   bash scripts/run-browser-test.sh scripts/diag-asgard-camera.mjs
// Diagnostic only: writes no files, changes no game state.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (p === '/api/models/sources') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"sources":[],"roster":{"launch":[],"manifestKeys":[]}}'); return; }
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    const body = await readFile(resolve(root, rel));
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) { res.writeHead(404); res.end('n'); } else res.end(); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
try {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180_000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSelect?.select('p1', 'Wonder Woman');
    window.__browserSmashSelect?.select('p2', 'Thor');
    window.__browserSmashSelect?.chooseArena?.('asgard');
    document.querySelector('#play')?.click();
  });
  const probe = () => page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const cam = window.smashCamera?.camera;
    if (!cam) return { error: 'no camera' };
    const target = window.smashCamera?.lookTarget || { x: 0, y: 0, z: 0 };
    const originV = new THREE.Vector3(cam.position.x, cam.position.y, cam.position.z);
    const lookV = new THREE.Vector3(target.x, target.y, target.z);
    const dir = lookV.clone().sub(originV);
    const distance = dir.length();
    dir.normalize();
    const raycaster = new THREE.Raycaster(originV, dir, 0.05, distance + 40);
    const hits = raycaster.intersectObject(window.__browserSmashScene, true)
      .filter(hit => hit.object.isMesh && !/fighter|skin|hair|gi|armor|weapon/i.test(hit.object.name || ''));
    const first = hits[0] || null;
    return {
      cam: { x: +cam.position.x.toFixed(2), y: +cam.position.y.toFixed(2), z: +cam.position.z.toFixed(2) },
      look: { x: +target.x.toFixed(2), y: +target.y.toFixed(2), z: +target.z.toFixed(2) },
      shotDistance: +distance.toFixed(2),
      fov: +cam.fov.toFixed(1),
      framing: JSON.parse(JSON.stringify(window.smashCamera?.framing || {})),
      stage: { tilt: window.smashCamera?.stageTilt, scale: window.smashCamera?.stageScale, yaw: window.smashCamera?.stageYaw, reach: window.smashCamera?.collisionReach, blocks: window.smashCamera?.collisionBlocks?.length ?? 0 },
      layout: (() => { const l = window.__browserSmashLayout?.() || {}; return { bounds: l.bounds || null, spawns: l.spawns || null, ground: l.ground ?? null, blocks: (l.blocks || []).length }; })(),
      worldSpawns: window.__browserSmashWorld?.spawns ?? null,
      fighters: (window.fighters || []).map(f => ({ name: f.name, x: +f.position.x.toFixed(2), y: +f.position.y.toFixed(2), z: +f.position.z.toFixed(2) })),
      nearestOccluder: first ? { name: first.object.name || '(unnamed)', distance: +first.distance.toFixed(2), material: first.object.material?.name || null } : null
    };
  });
  const samples = [];
  samples.push({ at: 'spawn', ...(await probe()) });
  await page.waitForTimeout(2500);
  samples.push({ at: 'settled', ...(await probe()) });
  await page.evaluate(() => window.__browserSmashStep?.(1.5));
  await page.waitForTimeout(1200);
  samples.push({ at: 'after-step', ...(await probe()) });
  console.log('ASGARD_CAMERA ' + JSON.stringify({ samples, errors: errors.slice(0, 3) }));
} finally {
  await browser.close();
  await new Promise(d => server.close(d));
}
