// Capture the authored jab at exact clip times. The pose is evaluated and the skeleton updated first;
// only then is the mixer frozen, so slow rendering cannot advance past the frame being measured.
// The opponent is placed along the measured punch direction and the camera is put side-on manually,
// which makes the extension readable and keeps the target in frame.
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
  window.__browserSmashSelect?.select?.('p2', 'Goku');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForFunction(() => {
  const u = window.fighters?.[0]?.model?.userData || {};
  return Boolean(u.importedStrikeSet && u.importedStrikeActions && u.idleAction && u.humanMixer && u.rightHand);
}, null, { timeout: 90000, polling: 250 });

const selected = await page.evaluate(async () => {
  const f = window.fighters[0];
  const u = f.model.userData;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const before = u.lastAuthoredStrike?.at ?? -1;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true }));
  window.__browserSmashStep(1 / 60);
  await frame();
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', bubbles: true }));
  for (let i = 0; i < 30; i += 1) {
    window.__browserSmashStep(1 / 60);
    await frame();
    const s = u.lastAuthoredStrike;
    if (s && s.at !== before) return { slot: s.slot, clip: s.clip, actionClip: u.authoredStrikeAction?.getClip?.().name || null };
  }
  return { slot: null, clip: null, failure: 'no authored strike selected within 30 steps' };
});

async function evaluateAt(time, cameraMode) {
  return page.evaluate(({ t, mode }) => {
    const f = window.fighters[0];
    const u = f.model.userData;
    const foe = window.fighters[1];
    const a = u.importedStrikeActions.light;
    try { window.__browserSmashPause?.open?.(); } catch (_error) {}
    for (const el of document.querySelectorAll('#pause,#pauseMenu,[data-role="pause"]')) el.style.display = 'none';
    if (foe) { foe.hitstun = 0; foe.velocity?.set?.(0, 0, 0); foe.aiState = 'idle'; }
    // 1) evaluate the clip, 2) update the skeleton, 3) only then freeze it.
    u.authoredStrikeAction = a;
    u.poseHold = true;
    a.reset(); a.setEffectiveWeight(1); a.play(); a.time = t;
    for (const act of Object.values(u.animationActions || {})) { if (act !== a) act?.setEffectiveWeight?.(0); }
    u.humanMixer.update(0);
    a.paused = true;
    u.applyFistPose?.();
    f.model.updateMatrixWorld(true);

    const hand = u.rightHand;
    const hips = u.hips || f.model.getObjectByName('Hips');
    const forearm = u.rightForeArm || f.model.getObjectByName('RightForeArm');
    const arm = u.rightArm || f.model.getObjectByName('RightArm');
    const wp = hand.getWorldPosition(new hand.position.constructor());
    const hp = hips.getWorldPosition(new hips.position.constructor());

    // Punch direction measured from the evaluated pose, so the target sits exactly where the fist goes.
    let dx = wp.x - hp.x, dz = wp.z - hp.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    if (mode === 'place') {
      // Keep the UI out of the evidence frame.
      if (!document.getElementById('bbCaptureStyle')) {
        const st = document.createElement('style');
        st.id = 'bbCaptureStyle';
        st.textContent = '#hud,#topHud,#combatHud,#energyHUD,#cameraSettings,#controls,#status,#timer,#trainingPanel,#comboCounter,#announcer,#pause,#pauseMenu,#menu,.fighter,.hud{display:none!important}';
        document.head.appendChild(st);
      }
      document.body.classList.add('in-menu');
      for (const b of document.querySelectorAll('button')) if (/ONLINE CHARACTERS/i.test(b.textContent || '')) b.style.display = 'none';
      // Facing from the fighter's pre-move opponent, so the camera sits in the front hemisphere.
      const V = hand.position.constructor;
      const fp = foe ? foe.position : new V(hp.x, 0, hp.z - 1);
      let fx = fp.x - hp.x, fz = fp.z - hp.z;
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl; fz /= fl;
      // p1 spawns at -X facing +X and p2 at +X, so this vector already points from Goku toward
      // the opponent: the lens belongs on that side. Flipping it put the camera behind him.
      const sx = -fz, sz = fx;
      if (foe) {
        foe.position.set(hp.x + dx * 1.55 - sx * 0.4, 0, hp.z + dz * 1.55 - sz * 0.4);
        foe.model?.updateMatrixWorld?.(true);
      }
      const cam = window.smashCamera?.camera;
      if (cam) {
        const px = hp.x + fx * 1.5 + sx * 2.5;
        const pz = hp.z + fz * 1.5 + sz * 2.5;
        cam.position.set(px, hp.y + 0.62, pz);
        cam.lookAt(hp.x + dx * 0.5, hp.y + 0.33, hp.z + dz * 0.5);
        cam.updateMatrixWorld(true);
        window.smashCamera.enabled = false;
      }
    }
    if (mode === 'hand') {
      const cam = window.smashCamera?.camera;
      if (cam) {
        const V = hand.position.constructor;
        const wp2 = hand.getWorldPosition(new V());
        const foreW = (u.rightForeArm || forearm).getWorldPosition(new V());
        const dir = wp2.clone().sub(foreW).normalize();
        const sideV = new V().crossVectors(dir, new V(0, 1, 0)).normalize();
        cam.near = 0.01;
        cam.position.copy(wp2).addScaledVector(sideV, 0.4).addScaledVector(dir, 0.05);
        cam.position.y += 0.06;
        cam.lookAt(wp2);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
        window.smashCamera.enabled = false;
      }
    }
    const handTrack = a.getClip().tracks.find(tr => tr.name === 'RightHand.quaternion');
    let handVaries = false;
    if (handTrack) {
      const v = handTrack.values;
      for (let i = 4; i < v.length; i += 1) if (Math.abs(v[i] - v[i % 4]) > 1e-4) { handVaries = true; break; }
    }
    return {
      time: +a.time.toFixed(3),
      clip: a.getClip().name,
      tracks: a.getClip().tracks.length,
      handWorld: [+wp.x.toFixed(4), +wp.y.toFixed(4), +wp.z.toFixed(4)],
      hipWorld: [+hp.x.toFixed(4), +hp.y.toFixed(4), +hp.z.toFixed(4)],
      arm: Array.from(arm?.quaternion.toArray?.() || []).map(n => +n.toFixed(3)),
      fore: Array.from(forearm?.quaternion.toArray?.() || []).map(n => +n.toFixed(3)),
      hand: Array.from(hand.quaternion.toArray()).map(n => +n.toFixed(3)),
      handTrackVaries: handVaries,
      paused: Boolean(window.__browserSmashPause?.paused),
      fist: u.fistDebug || null,
      weight: +a.getEffectiveWeight().toFixed(2)
    };
  }, { t: time, mode: cameraMode });
}

// Five held frames. The first fixes the target and camera; every later shot evaluates its own clip
// time, updates the skeleton, then freezes, so each image is a real evaluated pose.
const SHOTS = [
  ['final-neutral', 0, 'place'],
  ['final-startup', 0.06, 'keep'],
  ['final-contact', 0.13, 'keep'],
  ['final-follow-through', 0.21, 'keep'],
  ['final-recovery', 0.30, 'keep'],
  ['front-hand-neutral', 0, 'hand'],
  ['front-hand-contact', 0.13, 'hand']
];
const data = {};
for (const [name, time, mode] of SHOTS) {
  const frame = await evaluateAt(time, mode);
  if (name === 'final-contact') data['peak-contact'] = frame;
  data[name] = frame;
  await page.waitForTimeout(450);
  await page.screenshot({ path: `artifacts/goku-jab/${name}.png` });
}

const delta = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(4);
const summary = {
  selected,
  clip: data['peak-contact'].clip,
  tracks: data['peak-contact'].tracks,
  neutralToPeakHand: d3(data['final-neutral'].handWorld, data['final-contact'].handWorld),
  neutralToPeakArm: +delta(data['final-neutral'].arm, data['final-contact'].arm).toFixed(4),
  neutralToPeakFore: +delta(data['final-neutral'].fore, data['final-contact'].fore).toFixed(4),
  neutralToPeakWrist: +delta(data['final-neutral'].hand, data['final-contact'].hand).toFixed(4),
  handTrackVaries: data['peak-contact'].handTrackVaries,
  frames: data,
  fist: data['final-contact'].fist,
  fistBones: data['final-contact'].fist?.names || [],
  errors
};
console.log('CAPTURE ' + JSON.stringify(summary));
await browser.close();
server.close();
process.exit(0);
