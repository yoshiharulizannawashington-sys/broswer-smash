// Goku motion evidence for the rig/animation rebuild.
//
// Captures the mounted 73-joint Goku body from a fixed three-quarter front camera in two ways:
//   1. real gameplay states (idle, walk, run, guard) driven through the game input/state machine
//   2. the actual authored clip sampled at named beats (jab contact, kick contact, Kamehameha
//      charge/release, jump/hover) on the same mixer that plays the match
//
// The first run is the "before" set; the same script after regenerating goku_animated.glb is the
// "after" set. Clip names, camera, resolution and sampling times are identical, so the two sets
// are directly comparable.
//
//   bash scripts/run-browser-test.sh scripts/capture-goku-rebuild.mjs --tag=before
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const argv = process.argv.slice(2);
const flag = name => {
  const hit = argv.find(arg => arg.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};
const TAG = flag('tag') || 'before';
const out = resolve(root, 'artifacts/goku-rebuild', TAG);
await mkdir(out, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => rel === dir || rel.startsWith(dir + sep))) {
      rel = 'public' + sep + rel;
    }
    const file = resolve(root, rel);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end('forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error?.message || error).slice(0, 240)));

await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
  && window.__browserSmashSelect && window.__browserSmashStep
  && window.fighters?.length === 2, null, { timeout: 120_000, polling: 200 });
await page.addStyleTag({ content: '#bbHudLayer,#hud,.bb-hud,#menu{display:none!important}' });

await page.evaluate(() => {
  const select = window.__browserSmashSelect;
  select.show();
  select.select('p1', 'Goku');
  select.select('p2', 'Vegeta');
  select.chooseArena('tournament');
  document.querySelector('#play')?.click();
});
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'),
  null, { timeout: 60_000, polling: 200 });
// The match loading curtain lifts only after the renderer has drawn the arena. Waiting on fighters
// alone captures the loading card while the character GLBs are still being parsed, which is exactly
// what happened when the new 73-track clips made startup slower than the old 20-track set.
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false,
  null, { timeout: 30_000, polling: 100 }).catch(() => {});
await page.waitForFunction(() => {
  const loading = window.__bbLoading?.describe?.();
  const menu = document.querySelector('#menu');
  return loading?.visible === false && (window.__browserSmashFrames || 0) > 2
    && (!menu || menu.classList.contains('hidden'));
}, null, { timeout: 90_000, polling: 100 });
await page.waitForFunction(() => {
  const f = window.fighters?.[0];
  const u = f?.model?.userData;
  return f?.identityKey === 'goku' && Boolean(u?.humanMixer) && Boolean(u?.idleAction)
    && Boolean(u?.importedStrikeActions?.light || u?.authoredAbilityActions?.light)
    && u?.idleAction?.getClip?.()?.name === 'Goku_Idle';
}, null, { timeout: 90_000, polling: 200 });
await page.waitForTimeout(650);
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashStep(1.2);
});
await page.waitForTimeout(350);

// A fixed camera independent of the duel camera. The opponent is hidden only after the real
// match has started; Goku itself is still driven by the normal gameplay state machine.
const setup = await page.evaluate(() => {
  const THREE = window.__browserSmashThree;
  const f = window.fighters[0], foe = window.fighters[1];
  const model = f.model;
  if (foe?.model) foe.model.visible = false;
  window.__phaseGokuRealCameraUpdate = window.smashCamera?.update;
  if (window.smashCamera) window.smashCamera.update = () => {};
  for (const selector of ['#bbHudLayer', '#hud', '#energyHUD', '#cameraSettings', '#exploreHint', '#comboNotice']) {
    document.querySelectorAll(selector).forEach(node => { node.style.setProperty('display', 'none', 'important'); });
  }
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const forward = new THREE.Vector3(0, 0, 1)
    .applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion())).setY(0);
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1); else forward.normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const camera = window.smashCamera.camera;
  const distance = Math.max(2.9, size.y * 1.65);
  camera.position.set(
    center.x + forward.x * distance + right.x * distance * 0.20,
    center.y + size.y * 0.08,
    center.z + forward.z * distance + right.z * distance * 0.20
  );
  camera.near = 0.05; camera.far = 100; camera.fov = 34;
  camera.lookAt(center.x, center.y, center.z);
  camera.updateProjectionMatrix();
  const clips = Object.keys(f.model.userData.animationActions || {});
  // Re-frame after any live input that moved the fighter. The camera is otherwise pinned to the
  // spawn point, and a walk/run probe leaves the body outside a fixed close-up.
  // A pickup flash / transformation shroud can sit in front of the camera, and because clip
  // evidence pauses the simulation the shroud never fades. Remove only large transparent sphere
  // shells around this fighter; body parts, eyes, shadows and the sky dome are untouched.
  window.__gokuClearVfx = () => {
    let removed = 0;
    const roots = [f.model.parent, f.model].filter(Boolean);
    for (const root of roots) root.traverse(o => {
      if (!o.isMesh || !o.material || o.material.transparent !== true) return;
      if ((o.material.opacity ?? 1) > 0.65) return;
      const radius = Number(o.geometry?.parameters?.radius || 0);
      if (radius < 0.4 || radius > 8) return;
      const world = o.getWorldPosition(new THREE.Vector3());
      if (world.distanceTo(f.position) > 5) return;
      o.visible = false;
      removed++;
    });
    return removed;
  };
  window.__gokuFrame = (angle = 0) => {
    model.updateMatrixWorld(true);
    const liveBox = new THREE.Box3().setFromObject(model);
    const liveCenter = liveBox.getCenter(new THREE.Vector3());
    const liveSize = liveBox.getSize(new THREE.Vector3());
    const liveForward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion())).setY(0);
    if (liveForward.lengthSq() < 1e-6) liveForward.set(0, 0, 1); else liveForward.normalize();
    const liveRight = new THREE.Vector3(-liveForward.z, 0, liveForward.x);
    const liveDistance = Math.max(3.0, liveSize.y * 1.85);
    const viewAngle = angle * Math.PI / 180;
    const viewForward = new THREE.Vector3()
      .addScaledVector(liveForward, Math.cos(viewAngle))
      .addScaledVector(liveRight, Math.sin(viewAngle));
    camera.position.set(
      liveCenter.x + viewForward.x * liveDistance + liveRight.x * liveDistance * 0.18,
      liveCenter.y + liveSize.y * 0.05,
      liveCenter.z + viewForward.z * liveDistance + liveRight.z * liveDistance * 0.18
    );
    camera.lookAt(liveCenter.x, liveCenter.y, liveCenter.z);
    camera.updateProjectionMatrix();
    return { center: liveCenter.toArray().map(v => +v.toFixed(2)), size: liveSize.toArray().map(v => +v.toFixed(2)) };
  };
  return {
    identity: f.identityKey, joints: (() => { let n = 0; model.traverse(o => { if (o.isBone) n++; }); return n; })(),
    clips, clipCount: clips.length,
    strikeClips: Object.keys(f.model.userData.importedStrikeActions || {}),
    idle: f.model.userData.idleAction?.getClip?.()?.name || null,
    camera: camera.position.toArray().map(v => +v.toFixed(2)),
    box: { min: box.min.toArray().map(v => +v.toFixed(2)), max: box.max.toArray().map(v => +v.toFixed(2)) }
  };
});

const settleAndShot = async (name, angle = 0) => {
  await page.evaluate(viewAngle => {
    window.__gokuClearVfx?.();
    window.__gokuFrame?.(viewAngle);
    window.__browserSmashSetPaused?.(true);
  }, angle);
  await page.waitForTimeout(140);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  await page.evaluate(() => window.__browserSmashSetPaused?.(false));
};

const liveState = async (name, setupState) => {
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.hitstun = 0; f.guardBreak = 0; f.dodgeTimer = 0; f.attackQueue.length = 0;
    f.guardHeld = false; f.itemShieldTimer = 0; f.invulnerable = 0;
    f.isGrounded = true; f.position.y = 0; f.velocity?.set?.(0, 0, 0);
    window.__gokuClearVfx?.();
    window.__browserSmashStep(1 / 60);
  });
  await setupState();
  await settleAndShot(name);
  return page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData;
    return {
      clip: u.currentClip, speed: +Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0).toFixed(2),
      grounded: !!f.isGrounded, guard: !!f.guardHeld, y: +f.position.y.toFixed(2)
    };
  });
};


const liveRows = {};
liveRows.idle = await liveState('00-live-idle', async () => {
  await page.evaluate(() => window.__browserSmashStep(0.5));
});
liveRows.walk = await liveState('01-live-walk', async () => {
  await page.keyboard.down('d');
  await page.evaluate(() => window.__browserSmashStep(0.32));
});
liveRows.run = await liveState('02-live-run', async () => {
  // Shift is both sprint and the buffered dash key, so its first press enters Goku_Dodge. Keep
  // D held and hold Shift long enough for the dash to finish and the sprint speed to establish;
  // the row after the screenshot reports the clip that was actually bound.
  await page.keyboard.down('Shift');
  await page.evaluate(() => window.__browserSmashStep(0.85));
  await page.keyboard.up('Shift');
});
await page.keyboard.up('d');
liveRows.jump = await liveState('02b-live-jump', async () => {
  await page.keyboard.press('Space');
  await page.evaluate(() => window.__browserSmashStep(0.24));
});
// Real flight, not a clip sample: F toggles flight in the live state machine, D drives forward
// and Space holds altitude. The screenshot is the sequence at cruise, after takeoff and turning
// have completed, so the hands and the ground clearance are visible together.
liveRows.flight = await liveState('02c-live-flight', async () => {
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.flightMode = true;
    f.isGrounded = false;
    f.position.y = 2.4;
    f.velocity?.set?.(0, 0, 0);
  });
  await page.keyboard.down('d');
  await page.keyboard.down('Space');
  await page.evaluate(() => window.__browserSmashStep(0.62));
  await page.keyboard.up('Space');
});
await page.keyboard.up('d');
console.log('LIVE', JSON.stringify(liveRows));

// Clip mode: the actual authored clip, same mixer and same mounted skeleton. Stop the state
// machine's simulation, silence every action, then pose the chosen action at the requested phase.
const clipShot = async (name, clipName, phase, extra = {}) => {
  const result = await page.evaluate(({ clipName, phase, extra }) => {
    const f = window.fighters[0], u = f.model.userData;
    const mixer = u.humanMixer;
    if (!mixer) return { error: 'no mixer' };
    f.position.y = 0.18;
    f.isGrounded = true;
    f.velocity?.set?.(0, 0, 0);
    window.__gokuClearVfx?.();
    // Clip mode must start from the arena's ground height. A live jump leaves the fighter root
    // at 1.82 m; without this reset every later clip is rendered and measured from the air.
    f.position.y = 0.18;
    f.isGrounded = true;
    f.velocity?.set?.(0, 0, 0);
    f.hitstun = 0; f.guardHeld = false; f.dodgeTimer = 0; f.attackQueue.length = 0;
    window.__gokuClearVfx?.();
    // The mounted body's reaction/locomotion bank is not the whole clip inventory: the imported
    // strike table and authored-ability actions are separate collections on userData. Search every
    // action collection, deduplicated, or attack evidence is reported as a missing clip.
    const seen = new Set();
    const all = [];
    const collect = value => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (typeof value.getClip === 'function') { all.push(value); return; }
      if (value.isObject3D || value.isMixer) return;
      for (const child of Object.values(value)) collect(child);
    };
    for (const key of ['animationActions', 'importedStrikeActions', 'authoredAbilityActions', 'bakedAuthoredActions']) collect(u[key]);
    for (const a of all) { try { a.stop(); } catch {} }
    const action = all.find(a => a.getClip().name === clipName)
      || all.find(a => a.getClip().name.toLowerCase().includes(clipName.toLowerCase()));
    if (!action) return { error: 'clip not found', clipName, have: all.slice(0, 6).map(a => a.getClip().name) };
    const clip = action.getClip();
    action.reset();
    action.setLoop(extra.loop ? (window.__browserSmashThree.LoopRepeat ?? 2200) : (window.__browserSmashThree.LoopOnce ?? 2201), extra.loop ? Infinity : 1);
    action.clampWhenFinished = !extra.loop;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.time = Math.max(0, Math.min(clip.duration, clip.duration * phase));
    action.play();
    action.paused = true;
    mixer.update(0);
    f.model.updateMatrixWorld(true);
    // Freeze the simulation before the screenshot so the real-time state machine cannot replace
    // this pose while the PNG is encoded. Pause leaves the renderer running; it stops only step().
    window.__browserSmashSetPaused?.(true);
    // Measure the visible whole-body use of this pose.
    const mm = window.__browserSmashThree;
    const box = new mm.Box3().setFromObject(f.model);
    const head = u.head?.getWorldPosition(new mm.Vector3());
    const hips = u.pelvis?.getWorldPosition(new mm.Vector3());
    const hands = [u.leftHand, u.rightHand].filter(Boolean).map(h => h.getWorldPosition(new mm.Vector3()));
    const feet = [u.leftFoot, u.rightFoot].filter(Boolean).map(h => h.getWorldPosition(new mm.Vector3()));
    const chestBone = f.model.getObjectByName('Chest');
    const chest = chestBone?.getWorldPosition(new mm.Vector3()) || null;
    return {
      clip: clip.name, duration: +clip.duration.toFixed(3), phase,
      tracks: clip.tracks.length,
      bones: new Set(clip.tracks.map(t => String(t.name).split('.')[0])).size,
      height: +box.getSize(new mm.Vector3()).y.toFixed(3),
      headY: head ? +head.y.toFixed(3) : null, hipsY: hips ? +hips.y.toFixed(3) : null,
      chestY: chest ? +chest.y.toFixed(3) : null,
      handSpread: hands.length === 2 ? +hands[0].distanceTo(hands[1]).toFixed(3) : null,
      handReach: chest ? hands.map(v => +(v.z - chest.z).toFixed(3)) : [],
      handHeight: chest ? hands.map(v => +(v.y - chest.y).toFixed(3)) : [],
      footY: feet.map(v => +v.y.toFixed(3))
    };
  }, { clipName, phase, extra });
  await settleAndShot(name, extra.angle || 0);
  return result;
};

const clipEvidence = [];
clipEvidence.push(await clipShot('04-clip-idle', 'Goku_Idle', 0.35, { loop: true }));
clipEvidence.push(await clipShot('05-clip-walk', 'Goku_Walk', 0.25, { loop: true }));
clipEvidence.push(await clipShot('06-clip-run', 'Goku_Run', 0.25, { loop: true }));
clipEvidence.push(await clipShot('07-clip-jab', 'Goku_Jab', 0.38));
clipEvidence.push(await clipShot('07b-clip-jab-side', 'Goku_Jab', 0.38, { angle: 90 }));
clipEvidence.push(await clipShot('07c-clip-jab-side-opposite', 'Goku_Jab', 0.38, { angle: -90 }));
clipEvidence.push(await clipShot('08-clip-kick', 'Goku_Kick', 0.44));
clipEvidence.push(await clipShot('08b-clip-kick-side', 'Goku_Kick', 0.44, { angle: 90 }));
clipEvidence.push(await clipShot('08c-clip-kick-side-opposite', 'Goku_Kick', 0.44, { angle: -90 }));
clipEvidence.push(await clipShot('09-clip-heavy', 'Goku_Heavy', 0.42));
clipEvidence.push(await clipShot('10-clip-guard', 'Goku_Block', 0.35, { loop: true }));
clipEvidence.push(await clipShot('10b-clip-guard-side', 'Goku_Block', 0.35, { angle: 90, loop: true }));
clipEvidence.push(await clipShot('11-clip-kamehameha-charge', 'Goku_KamehamehaCharge', 0.5, { loop: true }));
clipEvidence.push(await clipShot('12-clip-kamehameha-release', 'Goku_Kamehameha', 0.38));
clipEvidence.push(await clipShot('13-clip-hover', 'Goku_Hover', 0.5, { loop: true }));
clipEvidence.push(await clipShot('13b-clip-turn', 'Goku_Turn', 0.5));
clipEvidence.push(await clipShot('13c-clip-fly-takeoff', 'Goku_FlyTakeoff', 0.72));

// Quantitative whole-body audit. Samples each principal clip at 9 phases on the live mixer and
// records how many of Goku's 73 joints actually move from the clip's own first frame.
const audit = await page.evaluate(() => {
  const f = window.fighters[0], u = f.model.userData, mixer = u.humanMixer;
  const seen = new Set();
  const all = [];
  const collect = value => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (typeof value.getClip === 'function') { all.push(value); return; }
    if (value.isObject3D || value.isMixer) return;
    for (const child of Object.values(value)) collect(child);
  };
  for (const key of ['animationActions', 'importedStrikeActions', 'authoredAbilityActions', 'bakedAuthoredActions']) collect(u[key]);
  const names = ['Goku_Idle', 'Goku_Walk', 'Goku_Run', 'Goku_Turn', 'Goku_Jump', 'Goku_Land',
    'Goku_Jab', 'Goku_Cross', 'Goku_Kick', 'Goku_Heavy', 'Goku_Block', 'Goku_HitLight',
    'Goku_HitHeavy', 'Goku_KamehamehaCharge', 'Goku_Kamehameha', 'Goku_Ultimate', 'Goku_Hover'];
  const rows = [];
  for (const name of names) {
    const action = all.find(a => a.getClip().name === name);
    if (!action) { rows.push({ clip: name, missing: true }); continue; }
    const clip = action.getClip();
    const bones = [...new Set(clip.tracks.map(t => String(t.name).split('.')[0]))];
    const first = new Map();
    for (const a of all) { try { a.stop(); } catch {} }
    action.reset(); action.setEffectiveWeight(1); action.play();
    const samples = [];
    for (let i = 0; i < 9; i++) {
      action.time = clip.duration * (i / 8);
      action.paused = true;
      mixer.update(0);
      const state = {};
      for (const bone of bones) {
        const node = f.model.getObjectByName(bone);
        if (node) state[bone] = node.quaternion.toArray().map(v => +v.toFixed(4));
      }
      samples.push(state);
    }
    let moved = 0, max = 0;
    for (const bone of bones) {
      let delta = 0;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[0][bone], b = samples[i][bone];
        if (!a || !b) continue;
        delta = Math.max(delta, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]));
      }
      if (delta > 0.01) moved++;
      max = Math.max(max, delta);
    }
    const transforms = clip.tracks.filter(t => t.name.endsWith('.position')).map(t => t.name);
    rows.push({ clip: name, duration: +clip.duration.toFixed(3), tracks: clip.tracks.length, bones: bones.length, moved, maxDelta: +max.toFixed(4), transforms });
  }
  return rows;
});

// Real guard input, captured after the clip evidence so a guard impact flash cannot sit in the
// frames inspecting walk, run, punches or kicks. E is the shield key in smash_input.js.
await page.evaluate(() => { window.__browserSmashSetPaused?.(false); });
await page.keyboard.down('e');
await page.evaluate(() => { const f = window.fighters[0]; f.guardHeld = true; window.__browserSmashStep(0.22); });
await settleAndShot('03-live-guard');
await page.keyboard.up('e');
await page.evaluate(() => { const f = window.fighters[0]; f.guardHeld = false; f.guardBreak = 0; window.__browserSmashStep(0.15); });

// A real KeyJ press through the state machine. This is the integration check between the new
// full-body clip and the legacy action selector; the direct clip frames only prove the asset.
const liveStrike = async name => {
  await page.evaluate(() => {
    const [f, foe] = window.fighters;
    f.attackQueue.length = 0; f.hitstun = 0; f.attackLock = 0; f.guardHeld = false;
    f.casting = null; f.abilityCast = null; f.specialCooldown = 0;
    f.facing = 1; f.facingZ = 0; f.isGrounded = true; f.position.y = 0;
    foe.position.set(f.position.x + 1.35, 0, f.position.z);
    foe.velocity?.set?.(0, 0, 0); foe.hitstun = 0;
    window.__browserSmashStep(1 / 60);
  });
  await page.keyboard.down('j');
  const result = await page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData;
    let seen = null;
    for (let i = 0; i < 36; i++) {
      window.__browserSmashStep(1 / 60);
      const a = u.authoredStrikeAction;
      if (!a) continue;
      const duration = a.getClip().duration || 1;
      const phase = a.time / duration;
      seen = {
        clip: a.getClip().name, time: +a.time.toFixed(3), duration: +duration.toFixed(3),
        phase: +phase.toFixed(3), currentClip: u.currentClip,
        guardHeld: f.guardHeld, hitstun: +(f.hitstun || 0).toFixed(2)
      };
      if (phase >= 0.3) break;
    }
    window.__gokuFrame?.(0);
    window.__browserSmashSetPaused?.(true);
    return seen;
  });
  await page.keyboard.up('j');
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  await page.evaluate(() => window.__browserSmashSetPaused?.(false));
  return result;
};
const liveJab = await liveStrike('03b-live-jab');

await page.evaluate(() => {
  const f = window.fighters[0], u = f.model.userData;
  for (const a of Object.values(u.animationActions || {})) { try { a.stop(); } catch {} }
  u.idleAction?.reset?.().setEffectiveWeight?.(1).play?.();
  if (window.__phaseGokuRealCameraUpdate) window.smashCamera.update = window.__phaseGokuRealCameraUpdate;
});
await page.waitForTimeout(250);

await writeFile(resolve(out, 'report.json'), JSON.stringify({
  tag: TAG,
  generatedAt: new Date().toISOString(),
  setup,
  liveJab,
  clipEvidence,
  audit,
  pageErrors
}, null, 2) + '\n');
console.log('SETUP ' + JSON.stringify(setup));
console.log('CLIP_EVIDENCE ' + JSON.stringify(clipEvidence.map(r => ({ clip: r.clip, tracks: r.tracks, bones: r.bones, duration: r.duration, error: r.error }))));
console.log('AUDIT ' + JSON.stringify(audit.map(r => ({ clip: r.clip, bones: r.bones, moved: r.moved, max: r.maxDelta, transforms: r.transforms?.length }))));
console.log('SUMMARY ' + JSON.stringify({ errors: pageErrors.length, out }));
await browser.close();
server.close();
