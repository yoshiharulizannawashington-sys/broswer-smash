// Goku, end to end, through the normal character-select path.
//
// This is the runtime half of the animation verification. The imported body's skeleton cannot be
// posed in Blender without rebuilding it (measurements in artifacts/goku-animation/), so the renders
// that prove anticipation/contact/recovery come from the renderer that actually plays the clips.
//
// Two capture rules learned the hard way, and encoded here:
//   1. Sample the phase from the ACTION CLOCK, not from a wall-time guess. A screenshot taken after
//      a fixed 0.13 s step landed after a 0.34 s strike had already clamped, so every "contact" shot
//      was really a return-to-idle frame.
//   2. Turn the body toward the lens for the still. The duel camera sits behind P1, so a forward
//      punch was photographed from behind his back. The pose is untouched; only the still's yaw is.
//
//   bash scripts/run-browser-test.sh scripts/verify-goku-hd-match.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/goku-hd';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    const body = await readFile(resolve(root, rel));
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
let failures = 0;
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) failures++;
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const shots = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(90000);
  page.on('pageerror', error => errors.push(String(error?.message || error).slice(0, 200)));

  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
  await page.click('#bbTitle [data-nav="versus"]');
  await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Goku"]'), null, { timeout: 30000, polling: 200 });

  // ---- select-screen preview: must show his idle, not the bind pose ----------------------------
  await page.evaluate(() => {
    document.querySelector('#selectScreen [data-side="p1"]').click();
    document.querySelector('#selectScreen [data-fighter="Goku"]').click();
  });
  await page.waitForFunction(() => window.__fighterPreviewDebug?.idle, null, { timeout: 30000, polling: 250 }).catch(() => {});
  await page.waitForTimeout(900);
  const preview = await page.evaluate(() => {
    const debug = window.__fighterPreviewDebug || null;
    return debug ? { idle: debug.idle, bones: debug.bones ?? null, mixer: Boolean(debug.mixer), root: Boolean(debug.root) } : null;
  });
  await page.screenshot({ path: `${out}/00-select-preview.png` });
  shots.push('00-select-preview');
  check('the select preview plays his authored idle', preview?.idle?.name === 'Goku_Idle' && preview?.idle?.tracks > 0 && preview?.mixer === true, JSON.stringify(preview));

  await page.evaluate(() => {
    document.querySelector('#selectScreen [data-side="p2"]').click();
    document.querySelector('#selectScreen [data-fighter="Naruto Uzumaki"]').click();
    document.querySelector('#play').click();
  });
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 60000, polling: 200 });
  await page.waitForFunction(() => window.fighters?.[0]?.model?.userData?.humanMixer, null, { timeout: 90000, polling: 250 });
  await page.waitForFunction(() => {
    const g = window.__browserSmashAssets?.importedReactions?.goku;
    return g && (g.status === 'ready' || g.status === 'failed' || g.status === 'error');
  }, null, { timeout: 60000, polling: 250 }).catch(() => {});
  await page.evaluate(() => window.__browserSmashStep(0.5));
  await page.waitForTimeout(600);

  const mount = await page.evaluate(() => {
    const f = window.fighters[0], rootModel = f.model;
    let joints = 0, meshes = 0, mapped = 0; const textures = new Set(); const materials = new Set();
    rootModel.traverse(node => {
      if (node.isBone) joints++;
      if (!node.isMesh) return;
      meshes++;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) {
        if (!material) continue;
        materials.add(material.name || material.uuid);
        if (material.map) { mapped++; const image = material.map.image; textures.add(`${material.name}:${image?.width}x${image?.height}`); }
      }
    });
    return {
      identityKey: f.identityKey, joints, meshes, mapped, materials: [...materials], textures: [...textures],
      controllerReleased: Boolean(rootModel.userData.animationControllerReleased),
      idleClip: rootModel.userData.idleAction?.getClip?.().name || null,
      currentClip: rootModel.userData.currentClip || null
    };
  });
  check('the promoted body is mounted through character select', mount.joints >= 70, JSON.stringify({ joints: mount.joints, meshes: mount.meshes, identity: mount.identityKey }));
  check('the spec/gloss conversion reached the shader (meshes carry diffuse maps)', mount.mapped >= 2, JSON.stringify({ mapped: mount.mapped, textures: mount.textures, materials: mount.materials }));
  check('the rig is driven by his own authored clips', mount.controllerReleased === true && mount.idleClip === 'Goku_Idle', JSON.stringify({ released: mount.controllerReleased, current: mount.currentClip, idle: mount.idleClip }));

  const pixels = await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const renderer = window.__browserSmashRenderer;
    const camera = window.smashCamera?.camera;
    const fighter = window.fighters[0];
    if (!renderer || !camera) return { error: 'renderer or camera missing' };
    const box = new THREE.Box3().setFromObject(fighter.model);
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const projected = corners.map(corner => corner.clone().project(camera));
    const minX = Math.max(0, Math.min(...projected.map(p => p.x)) * 0.5 + 0.5);
    const maxX = Math.min(1, Math.max(...projected.map(p => p.x)) * 0.5 + 0.5);
    const minY = Math.max(0, Math.min(...projected.map(p => p.y)) * 0.5 + 0.5);
    const maxY = Math.min(1, Math.max(...projected.map(p => p.y)) * 0.5 + 0.5);
    renderer.render(window.__browserSmashScene, camera);
    const canvas = renderer.domElement;
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    const x0 = Math.floor(minX * copy.width), x1 = Math.ceil(maxX * copy.width);
    const y0 = Math.floor((1 - maxY) * copy.height), y1 = Math.ceil((1 - minY) * copy.height);
    const data = copy.getContext('2d').getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
    let lit = 0, saturated = 0, sumS = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max < 0.08) continue;
      lit++;
      const s = max === 0 ? 0 : (max - min) / max;
      sumS += s;
      if (s > 0.18) saturated++;
    }
    return { lit, saturated, meanSaturation: +(sumS / Math.max(1, lit)).toFixed(3) };
  });
  check('the rendered body is textured, not default white', (pixels.saturated || 0) > (pixels.lit || 1) * 0.12, JSON.stringify(pixels));

  await page.evaluate(() => { window.__browserSmashFreezeAI = true; window.__browserSmashTrainingDummy = true; });
  const step = (seconds) => page.evaluate(s => window.__browserSmashStep(s), seconds);
  const frame = () => step(1 / 60);

  const clearView = () => page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const scene = window.__browserSmashScene;
    const camera = window.smashCamera?.camera;
    const fighter = window.fighters[0].model;
    if (!THREE || !scene || !camera) return 0;
    window.__hiddenOccluders = window.__hiddenOccluders || [];
    let hidden = 0;
    fighter.traverse(node => { if (node.isMesh) node.userData.__gokuBody = true; });
    const cameraPoint = camera.position.clone();
    const bounds = new THREE.Box3().setFromObject(fighter);
    const center = bounds.getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster();
    ray.set(cameraPoint, center.clone().sub(cameraPoint).normalize());
    ray.far = Math.max(0.1, cameraPoint.distanceTo(center) - 0.5);
    for (const hit of ray.intersectObjects(scene.children, true)) {
      if (!hit.object.isMesh || hit.object.userData.__gokuBody || hit.object.isSkinnedMesh) continue;
      if (window.__hiddenOccluders.includes(hit.object) || hit.object.visible === false) continue;
      hit.object.visible = false; window.__hiddenOccluders.push(hit.object); hidden++;
      if (hidden >= 6) break;
    }
    scene.traverse(object => {
      if (hidden >= 10 || !object.isMesh || object.userData.__gokuBody) return;
      if (window.__hiddenOccluders.includes(object)) return;
      if (new THREE.Box3().setFromObject(object).containsPoint(cameraPoint)) {
        object.visible = false; window.__hiddenOccluders.push(object); hidden++;
      }
    });
    return hidden;
  });
  const restoreView = () => page.evaluate(() => {
    for (const object of window.__hiddenOccluders || []) object.visible = true;
    window.__hiddenOccluders = [];
  });

  // `faceCamera` only changes the still's yaw: the clip and the skeleton frame are the game's.
  // The simulation is paused for the exposure, because the render loop keeps advancing the mixer
  // while playwright encodes the PNG: without the pause every "contact" still was really the idle
  // frame the clip had already blended into by the time the pixels were read.
  const shot = async (name, faceCamera = true) => {
    await page.evaluate(() => window.__browserSmashSetPaused?.(true));
    await clearView();
    await page.evaluate((face) => {
      const fighter = window.fighters[0], camera = window.smashCamera?.camera;
      if (face && camera) {
        const toCamera = camera.position.clone().sub(fighter.model.position); toCamera.y = 0;
        fighter.model.rotation.y = Math.atan2(toCamera.x, toCamera.z) - (fighter.model.userData.modelFacingOffset || 0);
        fighter.model.updateMatrixWorld(true);
      }
    }, faceCamera);
    await page.waitForTimeout(160);
    await page.screenshot({ path: `${out}/${name}.png` });
    await page.evaluate(() => window.__browserSmashSetPaused?.(false));
    shots.push(name);
  };

  const clean = () => page.evaluate(() => {
    const f = window.fighters[0];
    f.dashTimer = 0; f.dashCooldown = 0; f.dodgeTimer = 0; f.hitstun = 0; f.guardBreak = 0;
    f.attackQueue.length = 0; f.attackBuffer = 0; f.comboStep = 0; f.comboWindow = 0;
    f.specialCooldown = 0; f.isGrounded = true; f.position.y = 0; f.velocity?.set?.(0, 0, 0);
    const u = f.model.userData;
    u.authoredStrikeTime = 0; u.authoredSpecialTime = 0; u.specialPoseTime = 0;
    u.lastSpecialCastId = f.specialCast?.id || 0;
    window.__browserSmashStep(1 / 60);
    f.isGrounded = true; f.position.y = 0;
  });
  const strikeState = () => page.evaluate(() => {
    const u = window.fighters[0].model.userData, a = u.authoredStrikeAction;
    return a?.getClip ? {
      clip: a.getClip().name, slot: u.lastAuthoredStrike?.slot || null,
      time: +(a.time || 0).toFixed(3), duration: +(a.getClip().duration || 0).toFixed(3),
      running: Boolean(a.isRunning?.())
    } : null;
  });
  const waitStrikePhase = async (fraction = 0.5, limit = 90) => {
    for (let i = 0; i < limit; i++) {
      await frame();
      const state = await strikeState();
      if (state && state.time >= state.duration * fraction) return state;
    }
    return strikeState();
  };
  const attackOnce = async () => {
    const before = await strikeState();
    await page.keyboard.press('j');
    let state = before;
    for (let i = 0; i < 90; i++) {
      await frame();
      state = await strikeState();
      if (state && (!before || state.slot !== before.slot || state.time < before.time) && state.time > 0 && state.running) break;
    }
    return state;
  };
  const finishStrike = async () => {
    for (let i = 0; i < 120; i++) {
      await frame();
      const state = await strikeState();
      if (!state || !state.running || state.time >= state.duration * 0.92) return state;
    }
    return strikeState();
  };
  const specialState = () => page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData, a = u.authoredSpecialAction;
    return {
      cast: f.specialCast?.id || 0, clip: u.authoredSpecialClipId || null,
      time: +(a?.time || 0).toFixed(3), duration: +(a?.getClip?.().duration || 0).toFixed(3),
      running: Boolean(a?.isRunning?.()), weight: +(a?.getEffectiveWeight?.() || 0).toFixed(2),
      remaining: +(u.authoredSpecialTime || 0).toFixed(3), pending: f.pendingSignature?.timer ?? null,
      current: u.currentClip || null, cooldown: +(f.specialCooldown || 0).toFixed(2)
    };
  });
  const waitSpecialPhase = async (fraction, limit = 120) => {
    for (let i = 0; i < limit; i++) {
      await frame();
      const state = await specialState();
      if (state.running && state.time >= state.duration * fraction) return state;
    }
    return specialState();
  };

  await clean(); await step(0.2);
  await shot('01-idle');

  await page.keyboard.down('d'); await step(0.3); await shot('02-walk');
  await page.keyboard.down('Shift'); await step(0.35); await shot('02-run');
  await page.keyboard.up('Shift'); await page.keyboard.up('d'); await step(0.2);

  await page.keyboard.press('Space'); await step(0.18); await shot('03-jump');
  await step(0.7); await shot('03-land');

  await clean(); await page.keyboard.press('j');
  const jab = await waitStrikePhase(0.45); await shot('04-jab');

  await clean(); await attackOnce(); await finishStrike(); await attackOnce();
  const cross = await waitStrikePhase(0.45); await shot('05-cross');

  await clean();
  const chainSlots = [];
  for (let i = 0; i < 5; i++) {
    const state = await attackOnce();
    chainSlots.push(state?.slot || null);
    await finishStrike();
  }
  const chain = await waitStrikePhase(0.45); await shot('06-combo5');

  await clean();
  await page.keyboard.down('Shift'); await page.keyboard.down('j');
  const heavy = await waitStrikePhase(0.45);
  await page.keyboard.up('j'); await page.keyboard.up('Shift');
  await shot('07-heavy');

  await clean();
  await page.keyboard.down('w'); await page.keyboard.down('Shift'); await page.keyboard.down('j');
  const launcher = await waitStrikePhase(0.45);
  await page.keyboard.up('j'); await page.keyboard.up('Shift'); await page.keyboard.up('w');
  await shot('08-launcher');

  await clean(); await page.keyboard.press('Space'); await step(0.16); await page.keyboard.press('j');
  const aerial = await waitStrikePhase(0.45); await shot('09-air');
  await step(0.8);

  await clean(); await page.keyboard.down('e'); await step(0.2); await shot('10-block');
  await page.keyboard.up('e'); await step(0.1);
  await page.keyboard.down('Shift'); await frame(); await page.keyboard.up('Shift');
  await step(0.1); await shot('11-dodge');
  await step(0.5);

  await clean(); await page.evaluate(() => { const f = window.fighters[0]; f.hitstun = 0.7; f.isGrounded = true; });
  await step(0.12); await shot('12-hit-heavy');
  await step(0.7);
  await clean(); await page.evaluate(() => { const f = window.fighters[0]; f.hitstun = 1.5; f.isGrounded = false; f.velocity.y = -1; });
  await step(0.2); await shot('13-knockdown');
  await step(1.2); await shot('13-getup');

  // ---- signature -------------------------------------------------------------------------------
  await clean();
  const castBefore = await specialState();
  await page.keyboard.press('k');
  const charge = await waitSpecialPhase(0.18);
  await shot('14-kamehameha-charge');
  const release = await waitSpecialPhase(0.55);
  await shot('14-kamehameha-release');
  let end = null;
  for (let i = 0; i < 160; i++) {
    await frame();
    end = await specialState();
    if (!end.running && end.remaining === 0) break;
  }
  await shot('14-kamehameha-recovery');
  check('K starts the authored Kamehameha and it drives the body',
    charge.cast > castBefore.cast && charge.clip === 'Goku_Kamehameha' && charge.running && charge.weight > 0.5 && charge.time > 0,
    JSON.stringify(charge));
  check('the pose advances through the clip while the projectile is held, then returns to idle',
    release.time > charge.time + 0.15 && charge.pending > 0 && release.pending === null && /Idle/.test(end.current || ''),
    JSON.stringify({ charge: { time: charge.time, pending: charge.pending }, release: { time: release.time, pending: release.pending }, end: { clip: end.current, remaining: end.remaining } }));

  // ---- transformations: no state reset between them, so the tiers actually advance ------------
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.transform = null; f.formStage = 0; f.transformCooldown = 0; f.formLock = 0; f.power = 100; f.meter = 100;
  });
  await frame();
  const forms = [];
  for (let i = 0; i < 3; i++) {
    // The ladder advances `formStage` when an activation lands; against a frozen dummy nothing
    // connects, so each tier is selected the way transformation.js itself reads it. The clip that
    // plays is still chosen by form id through the normal activation path.
    await page.evaluate((stage) => {
      const f = window.fighters[0];
      f.transform = null; f.formStage = stage; f.transformCooldown = 0;
      f.power = 100; f.formLock = 0; f.hitstun = 0; f.attackQueue.length = 0;
    }, i);
    await frame();
    await page.keyboard.press('i');
    let record = null;
    for (let k = 0; k < 140; k++) {
      await frame();
      record = await page.evaluate(() => {
        const f = window.fighters[0], u = f.model.userData;
        return {
          form: f.transform?.form?.id || null, label: f.transform?.form?.label || null,
          sequence: u.lastFormAnimation || null, current: u.currentClip || null,
          running: Boolean(u.authoredFormAction?.isRunning?.())
        };
      });
      if (record.form && record.sequence && record.sequence.form === record.form && record.running) break;
    }
    await shot(`15-form-${i + 1}`);
    forms.push(record);
    for (let k = 0; k < 200; k++) {
      await frame();
      const done = await page.evaluate(() => {
        const f = window.fighters[0], u = f.model.userData;
        return (f.formLock || 0) <= 0 && !(u.authoredFormTime > 0);
      });
      if (done) break;
    }
  }
  const uniqueForms = new Set(forms.map(row => row?.form).filter(Boolean));
  const uniqueClips = new Set(forms.map(row => row?.sequence?.clip).filter(Boolean));
  check('all three transformations advance and play their own sequence',
    uniqueForms.size === 3 && uniqueClips.size === 3 && forms.every(row => row && row.sequence && row.sequence.form === row.form),
    JSON.stringify(forms.map(row => ({ form: row?.form, clip: row?.sequence?.clip || null }))));

  // ---- real match ------------------------------------------------------------------------------
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.formLock = 0; f.transform = null; f.power = 0; f.meter = 0;
    window.__browserSmashFreezeAI = false; window.__browserSmashTrainingDummy = false;
  });
  await restoreView();
  const match = await page.evaluate(async () => {
    const nextFrame = () => new Promise(done => requestAnimationFrame(() => done()));
    let winner = null, samples = 0, peak = 0, ko = null, last = null;
    for (let index = 0; index < 4200 && !winner; index += 1) {
      window.__browserSmashStep(1 / 60);
      if (index % 5 === 0) await nextFrame();
      const state = window.__browserSmashRound?.state;
      for (const fighter of window.fighters || []) {
        peak = Math.max(peak, fighter.percent || 0);
        if (fighter.ko && !ko) ko = { identity: fighter.identityKey, at: index };
      }
      last = state;
      if (state?.winner) winner = state.winner;
      samples += 1;
      if (ko) break;
    }
    return { winner: winner || last?.winner || null, samples, peak, ko, wins: last?.wins || null, banner: document.body.innerText.match(/(VICTORY|DEFEAT|DRAW)[^\n]{0,60}/)?.[0] || null };
  });
  await page.evaluate(() => window.__browserSmashSetPaused?.(true));
  await shot('16-ko', false);
  check('a real match produced a natural KO and a round result', Boolean(match.ko) && Boolean(match.winner || match.wins), JSON.stringify({ winner: match.winner, ko: match.ko, wins: match.wins, banner: match.banner }));

  await writeFile(`${out}/report.json`, JSON.stringify({
    origin, preview, mount, pixels, jab, cross, chainSlots, chain, heavy, launcher, aerial,
    castBefore, charge, release, end, forms, match, shots, errors, checks
  }, null, 2));
  console.log('CLIPS ' + JSON.stringify({
    jab: jab?.clip, cross: cross?.clip, chain: chain?.clip, chainSlots,
    heavy: heavy?.clip, launcher: launcher?.clip, aerial: aerial?.clip,
    special: charge?.clip, forms: forms.map(row => row?.sequence?.clip || null)
  }));
  console.log('SUMMARY ' + JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, failures, errors, winner: match.winner }));
} catch (error) {
  console.log('FATAL', String(error?.stack || error).slice(0, 700));
  failures++;
} finally {
  await browser.close().catch(() => {});
  server.close();
}
process.exitCode = failures ? 1 : 0;
