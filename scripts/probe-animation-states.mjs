// Phase 6 probe: prove the eight new clips are actually selected by gameplay, in the real game.
//
//   bash scripts/run-browser-test.sh scripts/probe-animation-states.mjs
//
// Reads `model.userData.currentClip` - the clip the animator chose this frame - instead of mixer
// crossfade weights, and drives the states through the same fighter fields the game sets. Part two
// plays a real match to a real KO and checks the winner holds victory while the loser holds defeat.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const errors = [];
let browser;
try {
  browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));

  const boot = async () => {
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.fighters?.length >= 2, null, { timeout: 120_000 });
  };
  const clip = () => page.evaluate(() => {
    const f = window.fighters.find(x => x.model?.userData?.humanMixer) || window.fighters[0];
    return { fighter: f.identityKey, clip: f.model.userData.currentClip || null, ko: f.ko, victoryPose: f.victoryPose };
  });
  const set = (patch) => page.evaluate(p => {
    const f = window.fighters.find(x => x.model?.userData?.humanMixer) || window.fighters[0];
    f.hitstun = 0; f.ko = false; f.victoryPose = 0; f.parryTimer = 0; f.grabHold = 0;
    f.guardHeld = false; f.flightMode = false; f.percent = 0;
    // velocity/position are plain objects on some fighter paths, vectors on others.
    f.velocity.x = 0; f.velocity.y = 0; f.velocity.z = 0;
    for (const [key, value] of Object.entries(p)) {
      if (value && typeof value === 'object' && f[key] && typeof f[key] === 'object') {
        Object.assign(f[key], value);
      } else {
        f[key] = value;
      }
    }
  }, patch);

  await boot();
  // Practice mode: the dummy never attacks, so an injected state is not overwritten mid-sample.
  await page.evaluate(() => document.querySelector('#practice').click());
  await page.waitForTimeout(1500);

  const states = {};
  // This renderer runs at a few frames per second in software, so a state needs close to a second
  // of wall clock before the animator has sampled it. Short waits sampled the previous probe.
  const probe = async (name, patch, hold = 1200) => {
    // Clear first and let the animator actually sample a stun of zero: consecutive hits without a
    // gap is a probe artefact, and the real game always returns to zero between blows.
    await set({});
    await page.waitForTimeout(900);
    await set(patch);
    await page.waitForTimeout(hold);
    states[name] = (await clip()).clip;
  };
  const keysDown = async list => { for (const key of list) await page.keyboard.down(key); };
  const keysUp = async list => { for (const key of list) await page.keyboard.up(key); };

  await probe('idle', {});
  await probe('heavy_hit', { hitstun: 2.0 });
  await probe('light_hit', { hitstun: 0.3 });
  await probe('parry', { parryTimer: 3 });
  await probe('hover', { flightMode: true, canFly: true, position: { x: 0, y: 6, z: 0 }, isGrounded: false }, 1600);
  await probe('throw', { grabHold: 3 });

  // Movement is read from the real key map, so these two are actual player input rather than an
  // injected velocity the simulation overwrites on the next frame.
  // Walk has to be probed on the ground: the practice spawn left the body airborne, so holding a
  // direction read the jump/fall branch instead of locomotion.
  await set({ isGrounded: true, groundLevel: 0, position: { x: 0, y: 0, z: 0 } });
  await page.waitForTimeout(900);
  await keysDown(['KeyD']);
  await page.waitForTimeout(1600);
  states.walk = (await clip()).clip;
  await keysUp(['KeyD']);
  await set({}); await page.waitForTimeout(900);
  await keysDown(['KeyE', 'KeyD']);
  await page.waitForTimeout(1600);
  states.strafe = (await clip()).clip;
  await keysUp(['KeyE', 'KeyD']);

  // Part two: a real match, driven to a real KO, through the real match-end path.
  await boot();
  await page.evaluate(() => document.querySelector('#play').click());
  await page.waitForTimeout(1800);
  const match = { rounds: [] };
  for (let round = 0; round < 4; round++) {
    const done = await page.evaluate(() => {
      window.fighters[1].percent = 160;
      window.__browserSmashStep(2.5);
      return (document.querySelector('#result')?.textContent || '').length > 0;
    });
    match.rounds.push(await page.evaluate(() => ({
      result: (document.querySelector('#result')?.textContent || '').slice(0, 40),
      p1: { victoryPose: window.fighters[0].victoryPose, ko: window.fighters[0].ko,
            clip: window.fighters[0].model?.userData?.currentClip },
      p2: { victoryPose: window.fighters[1].victoryPose, ko: window.fighters[1].ko,
            clip: window.fighters[1].model?.userData?.currentClip }
    })));
    if (done) break;
  }
  await page.waitForTimeout(900);
  match.final = await page.evaluate(() => ({
    result: (document.querySelector('#result')?.textContent || '').slice(0, 60),
    p1clip: window.fighters[0].model?.userData?.currentClip,
    p2clip: window.fighters[1].model?.userData?.currentClip,
    p1victoryPose: window.fighters[0].victoryPose,
    p2ko: window.fighters[1].ko
  }));

  console.log(JSON.stringify({ states, match, pageErrors: errors }, null, 2));
} finally {
  await browser?.close();
  server.close();
}
