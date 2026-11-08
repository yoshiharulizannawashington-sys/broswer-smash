// Close-up stills of Naruto's authored strike poses.
//
// These are taken straight from the clips the body has bound, each paused at a chosen progress by
// pausing its AnimationAction - no bone is written by hand. Runtime selection (which move id reaches
// which slot) is proven separately by scripts/verify-naruto-authored-strikes.mjs with real keys;
// this script exists so the poses themselves can be judged, which a frame delta this coarse cannot
// catch mid-swing.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/naruto-strikes';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashSelect?.chooseArena('valley');
  window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(3000);
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  const a = window.fighters[0], b = window.fighters[1];
  // The opponent is moved out of frame: at torso distance it stood between the camera and Naruto.
  a.position.set(0, 0, 0); b.position.set(9.5, 0, -3.5);
  a.velocity?.set?.(0, 0, 0); b.velocity?.set?.(0, 0, 0);
  const THREE = window.__browserSmashThree;
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(a.model.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
  window.__frontYaw = (Math.atan2(fwd.x, fwd.z) - Math.atan2(a.facingZ || 0, a.facing || 1)) * 180 / Math.PI;
  window.smashCamera?.spectate?.({ fighter: a, framing: 'torso', yaw: window.__frontYaw + 30, pitch: 4, distance: 2.7 });
});
await page.locator('canvas').first().click({ position: { x: 340, y: 230 }, force: true });

const poses = [
  { slot: 'light1', p: 0.30 },
  { slot: 'light2', p: 0.32 },
  { slot: 'light3', p: 0.36 },
  { slot: 'light4', p: 0.40 },
  { slot: 'light5', p: 0.42 },
  { slot: 'heavy', p: 0.38 },
  { slot: 'heavyLauncher', p: 0.40 },
  { slot: 'heavySlam', p: 0.38 },
  { slot: 'rasengan', p: 0.55 },
  { slot: 'shadowClone', p: 0.20 },
  { slot: 'special', p: 0.50 },
  { slot: 'ultimate', p: 0.45 }
];
const results = [];
for (const pose of poses) {
  const state = await page.evaluate(async ({ slot, p }) => {
    const f = window.fighters[0], u = f.model.userData;
    const THREE = window.__browserSmashThree;
    const actions = u.authoredAbilityActions || {};
    const a = actions[slot];
    if (!a) return { ok: false, slot, bound: Object.keys(actions) };
    // The pace each clip is selected at: a strike of `seconds` plays its whole clip in that window.
    const hold = () => {
      for (const [key, other] of Object.entries(actions)) if (key !== slot && other.isRunning()) other.stop();
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
      a.setEffectiveWeight(1); a.play();
      a.paused = true;
      a.time = Math.min(0.95, p) * a.getClip().duration;
      u.authoredStrikeAction = a; u.authoredStrikeTime = 999;
      f.attackQueue.length = 0; f.hitstun = 0; f.isGrounded = true; f.position.y = 0;
      window.smashCamera?.spectate?.({ fighter: f, framing: 'torso', yaw: window.__frontYaw + 30, pitch: 4, distance: 2.7 });
    };
    hold();
    await new Promise(r => requestAnimationFrame(r));
    hold();
    await new Promise(r => requestAnimationFrame(r));
    const url = document.querySelector('canvas').toDataURL('image/png');
    return { ok: true, slot, clip: a.getClip().name, at: +a.time.toFixed(3), duration: +a.getClip().duration.toFixed(3), url };
  }, pose);
  let file = null;
  if (state.ok && state.url && state.url.length > 5000) {
    file = `${out}/pose-${pose.slot}.png`;
    await writeFile(file, Buffer.from(state.url.split(',')[1], 'base64'));
  }
  const { url: _url, ...rest } = state;
  results.push({ requestedProgress: pose.p, ...rest, file });
}
await writeFile(`${out}/naruto-pose-stills.json`, JSON.stringify({ generatedAt: new Date().toISOString(), results, errors }, null, 2));
for (const r of results) console.log('POSE', JSON.stringify(r));
console.log('ERRORS', JSON.stringify(errors.slice(0, 2)));
await browser.close(); server.close();
