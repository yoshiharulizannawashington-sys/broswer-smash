// Complete live state matrix for Goku's mounted launch body.
//
// Every active state clip shipped in `goku_animated.glb` is played on the skeleton the game
// actually mounts, sampled for unresolved tracks, finite skinning and bone travel, and rendered
// into a contact sheet. Three authored duplicates are retired by documented decision; the live
// guard expression is checked separately with the baked face rig.
//
//   bash scripts/run-browser-test.sh scripts/verify-goku-state-matrix.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/goku-state-matrix');
await mkdir(out, { recursive: true });
const CLIPS = [
  'Goku_Idle', 'Goku_Walk', 'Goku_Run', 'Goku_Turn', 'Goku_Jump', 'Goku_DoubleJump',
  'Goku_Fall', 'Goku_Land', 'Goku_FlyTakeoff', 'Goku_Hover', 'Goku_FlyForward',
  'Goku_FlyBack', 'Goku_FlyTurn', 'Goku_FlyLand', 'Goku_Jab', 'Goku_Cross', 'Goku_Punch3',
  'Goku_Punch4', 'Goku_Punch5', 'Goku_Heavy', 'Goku_Kick', 'Goku_Launcher', 'Goku_AirPunch',
  'Goku_AirKick', 'Goku_Slam', 'Goku_Grab', 'Goku_Throw', 'Goku_Block', 'Goku_Dodge',
  'Goku_HitLight', 'Goku_HitHeavy', 'Goku_Knockdown', 'Goku_GetUp', 'Goku_Victory',
  'Goku_Defeat', 'Goku_KiBlast', 'Goku_KamehamehaCharge', 'Goku_Kamehameha',
  'Goku_InstantTransmission', 'Goku_DragonFist', 'Goku_Ultimate', 'Goku_FormSuperSaiyan',
  'Goku_FormSuperSaiyanBlue', 'Goku_FormUltraInstinct', 'Goku_Special', 'Goku_Air'
];
// These are authored but intentionally not launch states. Special and Air are exact aliases of
// Kamehameha and AirPunch in author-goku-clips.mjs; Punch3 is an alternate straight that the
// declared Goku moveset replaces with the Rising Dragon Kick. Retiring them is a state decision,
// not a fake binding; the active matrix still has to prove every remaining clip.
const RETIRED = Object.freeze({
  Goku_Punch3: 'alternate straight; launch light3 is Rising Dragon Kick',
  Goku_Special: 'alias of Goku_Kamehameha',
  Goku_Air: 'alias of Goku_AirPunch'
});
const ACTIVE_CLIPS = CLIPS.filter(name => !RETIRED[name]);
// Runtime aliases, not source clips. They are useful action keys but must not be counted as
// missing authored motion or as unexplained extras.
const KNOWN_EXTRA = new Set(['goku_kamehameha', 'fighting_idle']);
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => rel === dir || rel.startsWith(dir + sep))) {
      rel = 'public' + sep + rel;
    }
    const body = await readFile(resolve(root, rel));
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('nf');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120_000);
const errors = [];
const failedRequests = [];
page.on('pageerror', error => errors.push(String(error?.message || error).slice(0, 300)));
page.on('response', response => {
  if (response.status() >= 400 && !/favicon\.ico/i.test(response.url())) {
    failedRequests.push(response.status() + ' ' + response.url().slice(-120));
  }
});
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  try {
    await route.fulfill({
      status: 200, contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: await readFile(resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', '')))
    });
  } catch { await route.fulfill({ status: 404, body: 'missing' }); }
});

try {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2,
  null, { timeout: 150_000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashSelect?.select('p1', 'Goku');
    window.__browserSmashSelect?.select('p2', 'Naruto Uzumaki');
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.setRules({ roundsToWin: 1, roundSeconds: 60 });
    window.__browserSmashSetRules?.({ roundsToWin: 1, roundSeconds: 60 });
    window.__browserSmashFreezeAI = true;
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashGame.startMatch();
  });
  await page.waitForFunction(() => window.fighters?.[0]?.identity === 'Goku'
    && window.fighters[0].characterModelLoaded === true
    && window.fighters[0].model?.userData?.animationActions,
  null, { timeout: 120_000, polling: 200 });
  // The reaction GLB is fetched after the body mounts. Sampling before it lands sees only the
  // body's two controller actions and reports every authored clip as missing.
  await page.waitForFunction(() => window.fighters?.[0]?.model?.userData?.importedReactionReport?.status === 'ready',
    null, { timeout: 60_000, polling: 200 }).catch(() => {});
  await page.evaluate(() => {
    window.__browserSmashSkipCinematic?.();
    window.__browserSmashStep(0.5);
  });

  const mounted = await page.evaluate(({ expected }) => {
    const f = window.fighters[0];
    const u = f.model?.userData || {};
    const maps = [u.animationActions, u.authoredAbilityActions, u.authoredFormActions,
      u.authoredStrikeActions, u.authoredReactionActions];
    const byName = new Map();
    const add = action => {
      const clip = action?.getClip?.();
      if (clip && !byName.has(clip.name)) byName.set(clip.name, clip);
    };
    for (const map of maps) for (const action of Object.values(map || {})) add(action);
    for (const action of u.humanMixer?._actions || []) add(action);
    for (const clip of f.model.animations || []) if (clip?.name && !byName.has(clip.name)) byName.set(clip.name, clip);
    const bones = [];
    f.model.traverse(node => { if (node.isBone) bones.push(node); });
    const THREE = window.__browserSmashThree;
    const q = f.model.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();
    const heading = Math.atan2(f.facingZ || 0, f.facing || 1);
    window.__gokuMatrix = {
      fighter: f, model: f.model, byName, bones,
      mixer: new THREE.AnimationMixer(f.model),
      sheet: document.createElement('canvas')
    };
    window.__gokuMatrix.sheet.width = 1400;
    window.__gokuMatrix.sheet.height = 7 * 218;
    window.__gokuMatrix.ctx = window.__gokuMatrix.sheet.getContext('2d');
    window.__gokuMatrix.frontYaw = (Math.atan2(forward.x, forward.z) - heading) * 180 / Math.PI;
    document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = 'hidden'; });
    window.smashCamera.spectate({
      fighter: f, framing: 'full', yaw: window.__gokuMatrix.frontYaw + 24,
      pitch: 4, distance: 4.0, transition: 0
    });
    window.__browserSmashSetPaused(true);
    return {
      identity: f.identityKey || f.identity || null,
      asset: u.characterAssetUrl || null,
      bones: bones.length,
      joints: Object.keys(u.joints || {}).length,
      actions: Object.keys(u.animationActions || {}).length,
      clips: [...byName.keys()],
      missing: expected.filter(name => !byName.has(name)),
      extra: [...byName.keys()].filter(name => !expected.includes(name)),
      face: u.animationOverlayReport?.face || null
    };
  }, { expected: ACTIVE_CLIPS });

  console.log('MOUNTED', JSON.stringify({
    identity: mounted.identity, asset: mounted.asset, bones: mounted.bones,
    actions: mounted.actions, clips: mounted.clips.length,
    missing: mounted.missing, extra: mounted.extra
  }));

  const results = await page.evaluate(async ({ expected }) => {
    const s = window.__gokuMatrix, model = s.model, sheet = s.sheet, ctx = s.ctx;
    const THREE = window.__browserSmashThree;
    const canvas = document.querySelector('canvas');
    const positions = () => s.bones.map(bone => {
      bone.updateWorldMatrix(true, false);
      const e = bone.matrixWorld.elements;
      return [e[12], e[13], e[14]];
    });
    const maxDistance = (a, b) => {
      let worst = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        worst = Math.max(worst, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]));
      }
      return worst;
    };
    const rows = [];
    const full = {};
    let index = 0;
    for (const name of expected) {
      const clip = s.byName.get(name);
      if (!clip) { rows.push({ clip: name, ok: false, problems: ['clip missing from live body'] }); continue; }
      s.mixer.stopAllAction();
      const action = s.mixer.clipAction(clip);
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.setEffectiveWeight(1);
      action.play();
      const times = [0, 0.2, 0.4, 0.62, 0.82, 0.98].map(p => Math.min(clip.duration, p * Math.max(0.01, clip.duration)));
      let first = null;
      let travel = 0;
      let finite = true;
      let best = times[Math.min(2, times.length - 1)];
      for (const t of times) {
        action.time = t;
        s.mixer.update(0.0001);
        model.updateMatrixWorld(true);
        const pose = positions();
        if (pose.some(p => !p.every(Number.isFinite))) finite = false;
        if (!first) first = pose;
        else if (maxDistance(first, pose) > travel) {
          travel = maxDistance(first, pose);
          best = t;
        }
      }
      action.time = best;
      s.mixer.update(0.0001);
      model.updateMatrixWorld(true);
      await new Promise(done => requestAnimationFrame(done));
      await new Promise(done => requestAnimationFrame(done));
      const image = canvas.toDataURL('image/png');
      const box = new THREE.Box3().setFromObject(model);
      const unresolved = clip.tracks.filter(track => {
        const node = track.name.slice(0, Math.max(0, track.name.lastIndexOf('.')));
        return !model.getObjectByName(node);
      });
      if (name === 'Goku_Defeat' || name === 'Goku_Ultimate'
        || name === 'Goku_FormSuperSaiyan' || name === 'Goku_Block') full[name] = image;
      const col = index % 7, row = Math.floor(index / 7);
      ctx.fillStyle = '#0a1020';
      ctx.fillRect(col * 200, row * 218, 200, 218);
      if (image.length > 5000) {
        const img = new Image();
        img.src = image;
        await img.decode();
        ctx.drawImage(img, col * 200, row * 218, 200, 200);
      }
      ctx.fillStyle = '#d7e9ff';
      ctx.font = '11px monospace';
      ctx.fillText(`${String(index + 1).padStart(2, '0')} ${name}`.slice(0, 28), col * 200 + 5, row * 218 + 214);
      index++;
      const problems = [];
      if (!clip.tracks.length) problems.push('no tracks');
      if (unresolved.length) problems.push(`${unresolved.length} unresolved tracks`);
      if (!finite) problems.push('non-finite pose');
      if (!(clip.duration > 0)) problems.push('zero duration');
      if (travel <= 0.005) problems.push(`no measured travel (${travel.toFixed(4)} m)`);
      const rowResult = {
        clip: name, ok: problems.length === 0, problems,
        duration: +clip.duration.toFixed(3), tracks: clip.tracks.length, unresolved: unresolved.length,
        bones: s.bones.length, travel: +travel.toFixed(4), at: +best.toFixed(3),
        minY: Number.isFinite(box.min.y) ? +box.min.y.toFixed(4) : null, sheetTile: index
      };
      rows.push(rowResult);
      console.log('STATE', JSON.stringify(rowResult));
    }
    s.mixer.stopAllAction();
    return { rows, sheet: sheet.toDataURL('image/png'), full };
  }, { expected: ACTIVE_CLIPS });

  // Live guard expression check: the baked face must select guard, keep the blink channel shut,
  // and expose the head for a close-up. This is the guard-sclera regression probe.
  const retired = Object.entries(RETIRED).map(([clip, reason]) => ({
    clip, reason, presentInSource: CLIPS.includes(clip)
  }));
  const extraUnknown = mounted.extra.filter(name => !KNOWN_EXTRA.has(name));
  const guard = await page.evaluate(async () => {
    const f = window.fighters[0];
    f.guardHeld = true;
    f.guardBreak = 0;
    f.hitstun = 0;
    f.attackQueue.length = 0;
    window.__browserSmashStep(0.4);
    const report = f.model?.userData?.animationOverlayReport || null;
    const face = report?.face || null;
    window.smashCamera.spectate({
      fighter: f, framing: 'head', yaw: window.__gokuMatrix.frontYaw,
      pitch: 2, distance: 1.8, transition: 0
    });
    await new Promise(done => requestAnimationFrame(done));
    await new Promise(done => requestAnimationFrame(done));
    return {
      face,
      image: document.querySelector('canvas')?.toDataURL('image/png') || null,
      guardHeld: Boolean(f.guardHeld)
    };
  });

  await writeFile(resolve(out, 'report.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    mounted: {
      identity: mounted.identity, asset: mounted.asset, bones: mounted.bones,
      actions: mounted.actions, clips: mounted.clips,
      missing: mounted.missing, extra: mounted.extra, extraUnknown, retired
    },
    rows: results.rows,
    guard: {
      guardHeld: guard.guardHeld,
      expression: guard.face?.expression || null,
      morphWeights: guard.face?.morphWeights || null,
      blink: guard.face?.blink ?? null,
      baked: guard.face?.baked ?? null
    },
    errors, failedRequests,
    sheet: 'sheet.png', captures: Object.keys(results.full)
  }, null, 2));
  if (results.sheet?.length > 5000) {
    await writeFile(resolve(out, 'sheet.png'), Buffer.from(results.sheet.split(',')[1], 'base64'));
  }
  for (const [name, image] of Object.entries(results.full || {})) {
    if (image?.length > 5000) {
      await writeFile(resolve(out, name + '.png'), Buffer.from(image.split(',')[1], 'base64'));
    }
  }
  if (guard.image?.length > 5000) {
    await writeFile(resolve(out, 'guard-face.png'), Buffer.from(guard.image.split(',')[1], 'base64'));
  }

  const failed = results.rows.filter(row => !row.ok);
  console.log(`STATES ${results.rows.filter(row => row.ok).length}/${results.rows.length} active`);
  console.log('RETIRED', JSON.stringify(retired));
  console.log('MISSING', JSON.stringify(mounted.missing), 'EXTRA', JSON.stringify(mounted.extra),
    'EXTRA_UNKNOWN', JSON.stringify(extraUnknown));
  console.log('GUARD', JSON.stringify({
    held: guard.guardHeld, expression: guard.face?.expression,
    guard: guard.face?.morphWeights?.Guard, blink: guard.face?.morphWeights?.Blink,
    baked: guard.face?.baked
  }));
  console.log('ERRORS', JSON.stringify(errors.slice(0, 4)), 'FAILED_REQUESTS', JSON.stringify(failedRequests.slice(0, 4)));
  if (failed.length || mounted.missing.length || extraUnknown.length || errors.length || failedRequests.length
    || guard.face?.expression !== 'guard' || !(guard.face?.morphWeights?.Guard > 0.9)
    || guard.face?.morphWeights?.Blink !== 0 || guard.face?.baked !== true) {
    console.log('FAILED_STATES', JSON.stringify(failed.map(row => ({ clip: row.clip, problems: row.problems }))));
    process.exit(1);
  }
  console.log('Goku 43-state active matrix passed; 3 clips retired by documented decision.');
} finally {
  if (!browser.isConnected()) process.exitCode = process.exitCode || 1;
  await browser.close().catch(() => {});
  await new Promise(done => server.close(done));
}
