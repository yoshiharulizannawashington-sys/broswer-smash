// Prove the authored jab drives the rig, without depending on the renderer's frame rate.
//
// A 0.34 s clip cannot be sampled from a ~1 fps loop: the real frame advances the mixer by about a
// second, so the clip is already clamped at its end when the next probe reads it. This script first
// proves a real KeyJ press selects Goku_Jab through the state machine, then evaluates that same clip
// at fixed times on the mounted mixer and measures the hand and arm bones at each one. A contact
// frame is captured with the camera framed on the torso.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
await mkdir('artifacts/goku-jab', { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForFunction(() => {
  const u = window.fighters?.[0]?.model?.userData || {};
  return Boolean(u.importedStrikeSet && u.importedStrikeActions && u.idleAction);
}, null, { timeout: 90000, polling: 250 });

// 1. Real input selects the authored clip through the state machine.
const selection = await page.evaluate(async () => {
  const f = window.fighters[0];
  const u = f.model.userData;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const foe = window.fighters[1];
  if (foe) { foe.position.set(f.position.x + (f.facing >= 0 ? 1.15 : -1.15), 0, f.position.z); foe.velocity?.set?.(0, 0, 0); }
  const before = u.lastAuthoredStrike?.at ?? -1;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true }));
  window.__browserSmashStep(1 / 60);
  await frame();
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', bubbles: true }));
  for (let i = 0; i < 30; i += 1) {
    window.__browserSmashStep(1 / 60);
    await frame();
    const s = u.lastAuthoredStrike;
    if (s && s.at !== before) {
      const a = u.authoredStrikeAction;
      return { slot: s.slot, clip: s.clip, actionClip: a?.getClip?.().name || null, weight: a ? +a.getEffectiveWeight().toFixed(2) : null, running: a ? a.isRunning() : null };
    }
  }
  return { slot: null, clip: null, last: u.lastAuthoredStrike || null };
});

// 2. Evaluate that same clip at fixed times; frame-rate independent.
const measurement = await page.evaluate(() => {
  const f = window.fighters[0];
  const u = f.model.userData;
  const a = u.importedStrikeActions.light;
  const hand = u.rightHand;
  const arm = u.rightArm || f.model.getObjectByName('RightArm');
  const fore = u.rightForeArm || f.model.getObjectByName('RightForeArm');
  const quat = b => (b ? Array.from(b.quaternion.toArray()) : [0, 0, 0, 0]);
  const pos = () => { const v = hand.getWorldPosition(hand.position.clone()); return [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; };
  const idleWeight = u.idleAction?.getEffectiveWeight?.() ?? 0;
  u.idleAction?.setEffectiveWeight?.(0);
  a.reset();
  a.setEffectiveWeight(1);
  a.paused = false;
  a.play();
  const samples = [];
  const duration = a.getClip().duration;
  for (let i = 0; i <= 8; i += 1) {
    const t = duration * (i / 8);
    a.time = t;
    u.humanMixer.update(0);
    samples.push({ t: +t.toFixed(3), p: pos(), arm: quat(arm), fore: quat(fore), hand: quat(hand) });
  }
  const dist = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  const maxHand = Math.max(...samples.map(s => dist(samples[0].p, s.p)));
  const quatDelta = (k) => Math.max(...samples.map(s => Math.max(...s[k].map((v, i) => Math.abs(v - samples[0][k][i])))));
  // Leave the rig at the frame of furthest hand travel, not at a fixed half-way guess.
  const peak = samples.reduce((best, s, idx) => (dist(samples[0].p, s.p) > dist(samples[0].p, samples[best].p) ? idx : best), 0);
  a.time = duration * (peak / 8);
  u.humanMixer.update(0);
  const contact = pos();
  return {
    clip: a.getClip().name, duration: +duration.toFixed(3), tracks: a.getClip().tracks.length,
    maxHandDelta: +maxHand.toFixed(4), armQuatDelta: +quatDelta('arm').toFixed(4),
    foreQuatDelta: +quatDelta('fore').toFixed(4), handQuatDelta: +quatDelta('hand').toFixed(4),
    start: samples[0].p, contact, peakTime: +(duration * (peak / 8)).toFixed(3), samples: samples.map(s => ({ t: s.t, p: s.p }))
  };
});

const shot = await page.evaluate(() => {
  const f = window.fighters[0];
  const u = f.model.userData;
  const a = u.importedStrikeActions.light;
  window.smashCamera?.spectate?.({ fighter: f, framing: 'torso', yaw: (window.__frontYaw || 0) + 30, pitch: 4, distance: 2.7 });
  try { window.__browserSmashPause?.open?.(); } catch (_error) {}
  for (const el of document.querySelectorAll('#pause,#pauseMenu,[data-role="pause"]')) el.style.display = 'none';
  // Hold the posed frame: pause the mixer and clamp the action at its furthest hand travel, so the
  // capture cannot advance past the 0.34 s clip before the screenshot lands.
  const peak = a.getClip().duration * (3 / 8);
  a.reset(); a.setEffectiveWeight(1); a.play(); a.time = peak; a.paused = true;
  for (const act of Object.values(u.animationActions || {})) { if (act !== a && act?.setEffectiveWeight) act.setEffectiveWeight(0); }
  u.humanMixer.update(0);
  const hand = u.rightHand.getWorldPosition(u.rightHand.position.clone());
  return { paused: Boolean(window.__browserSmashPause?.paused), peak: +peak.toFixed(3), hand: [+hand.x.toFixed(3), +hand.y.toFixed(3), +hand.z.toFixed(3)] };
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'artifacts/goku-jab/contact.png' });
console.log('SHOT ' + JSON.stringify(shot));

console.log('RESULT ' + JSON.stringify({ selection, measurement, errors }));
await browser.close();
server.close();
process.exit(0);
