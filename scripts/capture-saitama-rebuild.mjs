// Saitama motion evidence for the rig/animation rebuild.
//
// Captures the mounted 158-joint Saitama body from a fixed three-quarter front camera:
//   1. real gameplay states (idle, walk, run, jump, guard) through the live state machine
//   2. the actual clip sampled at named beats on the same mixer that plays the match
//
// The first run is the "before" set (the shipped 17-joint clips); the same script after the rebuild
// is the "after" set. Clip names, camera, resolution and sampling phases are identical, so the two
// sets are directly comparable.
//
//   bash scripts/run-browser-test.sh scripts/capture-saitama-rebuild.mjs --tag=before
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
const SHOTS = !argv.includes('--audit-only');
const AUDIT = !argv.includes('--shots-only');
const out = resolve(root, 'artifacts/saitama-rebuild', TAG);
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
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
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
  select.select('p1', 'Saitama');
  select.select('p2', 'Goku');
  select.chooseArena('tournament');
  document.querySelector('#play')?.click();
});
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'),
  null, { timeout: 60_000, polling: 200 });
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
  return f?.identityKey === 'saitama' && Boolean(u?.humanMixer) && Boolean(u?.idleAction);
}, null, { timeout: 90_000, polling: 200 });
// The authored set is a separate clip-only GLB and binds asynchronously. Wait for the actual state
// action, not merely for the mounted body's old idle clip; a pre-bind capture would sample the
// shipped 17-joint motion again.
await page.waitForFunction(() =>
  window.fighters?.[0]?.model?.userData?.idleAction?.getClip?.()?.name === 'Saitama_idle',
  null, { timeout: 90_000, polling: 200 }).catch(() => {});
await page.waitForTimeout(900);
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashStep(1.2);
});
await page.waitForTimeout(350);

const setup = await page.evaluate(() => {
  const THREE = window.__browserSmashThree;
  const f = window.fighters[0], foe = window.fighters[1];
  const model = f.model;
  if (foe?.model) foe.model.visible = false;
  // A runtime-equipped prop (the items/equipment holder, not body geometry) sits in the left hand
  // and hides the arm in every frame. It exists in the before set too, so removing it from the
  // evidence does not flatter the rebuild; it only reveals the body that is being measured.
  let hiddenEquipped = 0;
  // The weapon holders live outside the imported body root, so a model-only traversal misses them.
  // Detach the actual holdables the equipment system published; this is evidence cleanup, not a
  // gameplay change.
  window.__saitamaHideEquip = () => {
    const u = f.model.userData;
    for (const object of [u.equippedWeaponRight, u.equippedWeaponLeft, u.pickupBlade]) {
      if (!object || !object.parent) continue;
      object.removeFromParent();
      hiddenEquipped++;
    }
    return hiddenEquipped;
  };
  window.__saitamaHideEquip();
  window.__phaseRealCameraUpdate = window.smashCamera?.update;
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
  const distance = Math.max(2.9, size.y * 1.75);
  camera.position.set(
    center.x + forward.x * distance + right.x * distance * 0.20,
    center.y + size.y * 0.08,
    center.z + forward.z * distance + right.z * distance * 0.20
  );
  camera.near = 0.05; camera.far = 100; camera.fov = 34;
  camera.lookAt(center.x, center.y, center.z);
  camera.updateProjectionMatrix();
  window.__saitamaClearVfx = () => {
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
  window.__saitamaFrame = (angle = 0, zoom = 1, raise = 0) => {
    model.updateMatrixWorld(true);
    const liveBox = new THREE.Box3().setFromObject(model);
    const liveCenter = liveBox.getCenter(new THREE.Vector3());
    const liveSize = liveBox.getSize(new THREE.Vector3());
    const liveForward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion())).setY(0);
    if (liveForward.lengthSq() < 1e-6) liveForward.set(0, 0, 1); else liveForward.normalize();
    const liveRight = new THREE.Vector3(-liveForward.z, 0, liveForward.x);
    const liveDistance = Math.max(3.0, liveSize.y * 1.9) * zoom;
    const viewAngle = angle * Math.PI / 180;
    const viewForward = new THREE.Vector3()
      .addScaledVector(liveForward, Math.cos(viewAngle))
      .addScaledVector(liveRight, Math.sin(viewAngle));
    camera.position.set(
      liveCenter.x + viewForward.x * liveDistance + liveRight.x * liveDistance * 0.18,
      liveCenter.y + liveSize.y * 0.05 + raise,
      liveCenter.z + viewForward.z * liveDistance + liveRight.z * liveDistance * 0.18
    );
    camera.lookAt(liveCenter.x, liveCenter.y + raise, liveCenter.z);
    camera.updateProjectionMatrix();
    return { center: liveCenter.toArray().map(v => +v.toFixed(2)), size: liveSize.toArray().map(v => +v.toFixed(2)) };
  };
  let joints = 0;
  model.traverse(o => { if (o.isBone) joints++; });
  return {
    identity: f.identityKey, joints, hiddenEquipped,
    clipCount: Object.keys(f.model.userData.animationActions || {}).length,
    idle: f.model.userData.idleAction?.getClip?.()?.name || null,
    importedReaction: f.model.userData.importedReactionSet || null,
    camera: camera.position.toArray().map(v => +v.toFixed(2)),
    box: { min: box.min.toArray().map(v => +v.toFixed(2)), max: box.max.toArray().map(v => +v.toFixed(2)) }
  };
});

const settleAndShot = async (name, angle = 0, framing = {}) => {
  await page.evaluate(({ viewAngle, zoom, raise }) => {
    window.__saitamaClearVfx?.();
    window.__saitamaHideEquip?.();
    window.__saitamaFrame?.(viewAngle, zoom, raise);
    window.__browserSmashSetPaused?.(true);
  }, { viewAngle: angle, zoom: framing.zoom || 1, raise: framing.raise || 0 });
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
    window.__saitamaClearVfx?.();
    window.__browserSmashStep(1 / 60);
  });
  await setupState();
  await settleAndShot(name);
  return page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData;
    const bone = name => f.model.getObjectByName(name)?.getWorldPosition(new window.__browserSmashThree.Vector3());
    const feet = ['footL_148', 'footR_153'].map(n => bone(n)).filter(Boolean).map(v => +v.y.toFixed(3));
    return {
      clip: u.currentClip, speed: +Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0).toFixed(2),
      grounded: !!f.isGrounded, guard: !!f.guardHeld, y: +f.position.y.toFixed(2), feetY: feet
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
  await page.keyboard.down('Shift');
  await page.evaluate(() => window.__browserSmashStep(0.85));
  await page.keyboard.up('Shift');
});
await page.keyboard.up('d');
liveRows.jump = await liveState('02b-live-jump', async () => {
  await page.keyboard.press('Space');
  await page.evaluate(() => window.__browserSmashStep(0.24));
});
console.log('LIVE', JSON.stringify(liveRows));

const clipShot = async (name, clipName, phase, extra = {}) => {
  const result = await page.evaluate(({ clipName, phase, extra }) => {
    const f = window.fighters[0], u = f.model.userData;
    const mixer = u.humanMixer;
    if (!mixer) return { error: 'no mixer' };
    f.position.y = 0.18;
    f.isGrounded = true;
    f.velocity?.set?.(0, 0, 0);
    f.hitstun = 0; f.guardHeld = false; f.dodgeTimer = 0; f.attackQueue.length = 0;
    window.__saitamaClearVfx?.();
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
    if (!action) return { error: 'clip not found', clipName, have: all.slice(0, 8).map(a => a.getClip().name) };
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
    window.__browserSmashSetPaused?.(true);
    const mm = window.__browserSmashThree;
    const box = new mm.Box3().setFromObject(f.model);
    const at = n => f.model.getObjectByName(n)?.getWorldPosition(new mm.Vector3());
    const chest = at('spine005_93') || at('spine006_92');
    const hands = [at('handL_114'), at('handR_137')].filter(Boolean);
    const feet = [at('footL_148'), at('footR_153')].filter(Boolean);
    return {
      clip: clip.name, duration: +clip.duration.toFixed(3), phase,
      tracks: clip.tracks.length,
      bones: new Set(clip.tracks.map(t => String(t.name).split('.')[0])).size,
      height: +box.getSize(new mm.Vector3()).y.toFixed(3),
      headY: at('face_91') ? +at('face_91').y.toFixed(3) : null,
      hipsY: at('spine_156') ? +at('spine_156').y.toFixed(3) : null,
      chestY: chest ? +chest.y.toFixed(3) : null,
      handSpread: hands.length === 2 ? +hands[0].distanceTo(hands[1]).toFixed(3) : null,
      handReach: chest ? hands.map(v => +(v.z - chest.z).toFixed(3)) : [],
      handHeight: chest ? hands.map(v => +(v.y - chest.y).toFixed(3)) : [],
      footY: feet.map(v => +v.y.toFixed(3))
    };
  }, { clipName, phase, extra });
  await settleAndShot(name, extra.angle || 0, extra);
  return result;
};

const clipEvidence = [];
if (SHOTS) {
clipEvidence.push(await clipShot('04-clip-idle', 'Saitama_idle', 0.35, { loop: true }));
clipEvidence.push(await clipShot('05-clip-walk', 'Saitama_walk', 0.25, { loop: true }));
clipEvidence.push(await clipShot('06-clip-run', 'Saitama_run', 0.25, { loop: true }));
clipEvidence.push(await clipShot('07-clip-jab', 'Saitama_jab', 0.42));
clipEvidence.push(await clipShot('07b-clip-jab-side', 'Saitama_jab', 0.42, { angle: 90 }));
clipEvidence.push(await clipShot('08-clip-heavy-side', 'Saitama_heavy_punch', 0.44, { angle: 90 }));
clipEvidence.push(await clipShot('09-clip-block', 'Saitama_block', 0.35, { loop: true }));
clipEvidence.push(await clipShot('10-clip-jump', 'Saitama_jump', 0.55, { zoom: 1.28, raise: 0.28 }));
clipEvidence.push(await clipShot('11-clip-hover-side', 'Saitama_hover', 0.5, { angle: 60, loop: true, zoom: 1.1 }));
clipEvidence.push(await clipShot('12-clip-fly-side', 'Saitama_fly', 0.5, { angle: 60, loop: true, zoom: 1.1 }));
}

const audit = !AUDIT ? [] : await page.evaluate(() => {
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
  const names = ['idle', 'walk', 'run', 'jump', 'land', 'jab', 'heavy_punch', 'block',
    'hover', 'fly', 'knockdown', 'victory'].map(name => `Saitama_${name}`);
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

await page.evaluate(() => { window.__browserSmashSetPaused?.(false); });
if (SHOTS) {
await page.keyboard.down('e');
await page.evaluate(() => { const f = window.fighters[0]; f.guardHeld = true; window.__browserSmashStep(0.22); });
await settleAndShot('03-live-guard');
await page.keyboard.up('e');
await page.evaluate(() => { const f = window.fighters[0]; f.guardHeld = false; f.guardBreak = 0; window.__browserSmashStep(0.15); });
}

await page.evaluate(() => {
  const f = window.fighters[0], u = f.model.userData;
  for (const a of Object.values(u.animationActions || {})) { try { a.stop(); } catch {} }
  u.idleAction?.reset?.().setEffectiveWeight?.(1).play?.();
  if (window.__phaseRealCameraUpdate) window.smashCamera.update = window.__phaseRealCameraUpdate;
});
await page.waitForTimeout(250);

await writeFile(resolve(out, 'report.json'), JSON.stringify({
  tag: TAG, generatedAt: new Date().toISOString(), setup, liveRows, clipEvidence, audit, pageErrors
}, null, 2) + '\n');
console.log('SETUP ' + JSON.stringify(setup));
console.log('CLIP_EVIDENCE ' + JSON.stringify(clipEvidence.map(r => ({ clip: r.clip, tracks: r.tracks, bones: r.bones, duration: r.duration, error: r.error }))));
console.log('AUDIT ' + JSON.stringify(audit.map(r => ({ clip: r.clip, tracks: r.tracks, bones: r.bones, moved: r.moved, max: r.maxDelta }))));
console.log('SUMMARY ' + JSON.stringify({ errors: pageErrors.length, out }));
await browser.close();
server.close();
