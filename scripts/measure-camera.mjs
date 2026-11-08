// Camera framing measurement. No screenshots, so it is fast enough to run per arena.
//
//   bash scripts/run-browser-test.sh scripts/measure-camera.mjs
//
// Reports, for every arena and every combat state the camera has to survive, the shot distance,
// lens, camera height, and how many pixels tall each fighter is. It also checks the thing that
// actually matters: that both fighters stay inside the frustum. A frame can "keep the fighters in
// shot" while making them 40 px tall, which is what a pulled-back cinematic camera looks like when
// it goes too far - so the pixel height is reported alongside.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const ARENAS = (process.argv.find(a => a.startsWith('--arenas=')) || '--arenas=tournament,asgard,hogwarts,starktower').split('=')[1].split(',');

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try {
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
  } catch { await route.fulfill({ status: 404, body: 'missing' }); }
});

const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
const rows = [];

/** Project both fighters and report the shot. */
async function sample(arena, state) {
  const row = await page.evaluate(({ arena: arenaKey, state: stateName }) => {
    const THREE = window.__browserSmashThree;
    const camera = window.smashCamera.camera;
    camera.updateMatrixWorld();
    const project = fighter => {
      const point = fighter.position.clone().add(new THREE.Vector3(0, 1, 0)).project(camera);
      return { x: point.x, y: point.y, z: point.z };
    };
    const inFrame = fighter => {
      const p = project(fighter);
      return p.z < 1 && Math.abs(p.x) <= 1.02 && Math.abs(p.y) <= 1.02;
    };
    const fighters = window.fighters;
    const heightOf = fighter => {
      const distance = Math.max(.001, fighter.position.clone().add(new THREE.Vector3(0, 1, 0)).distanceTo(camera.position));
      return +(2.0 * (window.innerHeight / 2) / (distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))).toFixed(0);
    };
    return {
      arena: arenaKey, state: stateName,
      distance: +Math.max(0, window.smashCamera.framing.distance || 0).toFixed(1),
      fov: +camera.fov.toFixed(1),
      cameraY: +camera.position.y.toFixed(1),
      lookY: +window.smashCamera.lookTarget.y.toFixed(1),
      gap: +fighters[0].position.distanceTo(fighters[1].position).toFixed(1),
      p1px: heightOf(fighters[0]), p2px: heightOf(fighters[1]),
      inFrame: inFrame(fighters[0]) && inFrame(fighters[1]),
      altitude: +Math.max(fighters[0].position.y, fighters[1].position.y).toFixed(1)
    };
  }, { arena, state });
  rows.push(row);
  console.log(`${row.arena.padEnd(12)} ${row.state.padEnd(12)} d=${String(row.distance).padStart(5)} fov=${String(row.fov).padStart(4)} camY=${String(row.cameraY).padStart(5)} gap=${String(row.gap).padStart(5)} alt=${String(row.altitude).padStart(5)} fighters ${String(row.p1px).padStart(4)}px/${String(row.p2px).padStart(4)}px ${row.inFrame ? 'both in frame' : 'OUT OF FRAME'}`);
  return row;
}

try {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.__browserSmashStep, null, { timeout: 180_000, polling: 200 });

  for (const arena of ARENAS) {
    await page.evaluate(key => {
      window.__browserSmashPause?.close?.();
      document.querySelector('#menu').classList.remove('hidden');
      window.__browserSmashSelect?.show?.();
      window.__browserSmashSelect?.chooseArena?.(key);
      window.__browserSmashSelect?.setMode?.('1p');
    }, arena);
    await step(0.05);
    // #play lives on the arena step of the setup screen, so drive it through the DOM here: this
    // script measures the camera, not the setup flow (the gameplay suite covers that).
    await page.evaluate(() => document.querySelector('#play').click());
    await step(0.4);
    const place = (gap, y1 = 0, y2 = 0) => page.evaluate(({ gap: g, y1: a, y2: b }) => {
      const [p1, p2] = window.fighters;
      p1.position.set(-g / 2, (p1.groundLevel ?? 0) + a, -12);
      p2.position.set(g / 2, (p2.groundLevel ?? 0) + b, -12);
      p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
      p1.hitstun = 0; p2.hitstun = 0;
    }, { gap, y1, y2 });

    await place(2); await step(0.3); await sample(arena, 'close duel');
    await place(9); await step(0.4); await sample(arena, 'separated');
    await place(18); await step(0.6); await sample(arena, 'far apart');
    await place(2);
    await step(0.3);
    await page.evaluate(() => { window.fighters[0].specialCooldown = 0; });
    await page.keyboard.press('k');
    await step(0.35);
    await sample(arena, 'special');
    await step(0.8);
    await page.evaluate(() => { window.fighters[0].meter = 100; });
    await page.keyboard.press('o');
    await step(0.5);
    await sample(arena, 'ultimate');
    await step(1.4);
    await place(2, 4.5, 0); await step(0.25); await sample(arena, 'jump');
    await place(2, 9, 0);
    await page.evaluate(() => { window.fighters[0].canFly = true; window.fighters[0].flightMode = true; });
    await step(0.8);
    await sample(arena, 'flight');
    await page.evaluate(() => { window.fighters[0].flightMode = false; });
    await step(0.4);
  }

  const out = rows.filter(row => !row.inFrame);
  console.log(`\n${rows.length} samples, ${out.length} with a fighter out of frame, ${errors.length} page errors`);
  console.log('smallest fighter height: ' + Math.min(...rows.map(r => Math.min(r.p1px, r.p2px))) + 'px');
  const worst = rows.reduce((a, b) => (Math.min(a.p1px, a.p2px) <= Math.min(b.p1px, b.p2px) ? a : b));
  console.log(`smallest shot: ${worst.arena} · ${worst.state} · ${worst.p1px}px/${worst.p2px}px at d=${worst.distance}`);
} finally {
  await browser.close();
  await server.close();
}
