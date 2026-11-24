// Close-up live acceptance for the repaired Goku body.
//
// This is one real character-select -> match flow, not a fixture. It captures the mounted body, the
// baked face morphs on that same head, and the Kamehameha leaving the live body. Every screenshot is
// taken from the game renderer while the match is paused for the exposure; the state checks are
// sampled from the same simulation.
//
// Software-rendered captures are composition evidence only, never hardware performance proof.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { browserLaunchOptions, captureGpu, isSoftwareRenderer } from './lib/hardware-gpu.mjs';

const root = process.cwd();
const out = 'artifacts/goku-closeup-live';
await mkdir(out, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.wasm': 'application/wasm'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    // The game only uses this inventory endpoint for optional user-model discovery. There is no
    // database in this probe, so answer with a valid empty inventory instead of a 404.
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
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
const checks = [];
let failures = 0;
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) failures += 1;
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};
const shot = async (page, name) => {
  await page.screenshot({ path: resolve(out, name + '.png') });
  console.log('CAPTURE', name + '.png');
};

const browser = await chromium.launch(browserLaunchOptions());
const errors = [];
const failedRequests = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(120_000);
  page.on('pageerror', error => errors.push(String(error?.stack || error).slice(0, 400)));
  page.on('requestfailed', request => {
    if (!/favicon\.ico/i.test(request.url())) failedRequests.push(request.url());
  });
  page.on('response', response => {
    if (response.status() >= 400 && !/favicon\.ico/i.test(response.url())) {
      failedRequests.push(response.status() + ' ' + response.url());
    }
  });

  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 250 });
  const gpu = await captureGpu(page);
  const software = isSoftwareRenderer(gpu);
  console.log('GPU', JSON.stringify({ ...gpu, softwareRenderer: software }));

  await page.click('#bbTitle [data-nav="versus"]');
  await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Goku"]'),
    null, { timeout: 30_000, polling: 200 });
  await page.evaluate(() => {
    window.__browserSmashSelect?.select('p1', 'Goku');
    window.__browserSmashSelect?.select('p2', 'Vegeta');
    window.__browserSmashSelect?.chooseArena('valley');
    document.querySelector('#play').click();
  });
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'),
    null, { timeout: 60_000, polling: 200 });
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting',
    null, { timeout: 60_000, polling: 200 });
  await page.waitForFunction(() => {
    const f = window.fighters?.[0];
    return f?.identityKey === 'goku'
      && f?.model?.userData?.characterAssetUrl
      && f?.model?.userData?.animationOverlays;
  }, null, { timeout: 120_000, polling: 200 });
  await page.waitForFunction(() => window.__browserSmashAssets?.importedReactions?.goku?.status === 'ready'
    || window.__browserSmashAssets?.importedReactions?.goku?.status === 'failed'
    || window.__browserSmashAssets?.importedReactions?.goku?.status === 'error',
  null, { timeout: 60_000, polling: 250 }).catch(() => {});
  await page.evaluate(() => {
    window.__browserSmashSkipCinematic?.();
    window.__browserSmashFreezeAI = true;
    window.__browserSmashTrainingDummy = true;
  });
  // Wait for the imported body's own mixer, not just the overlay state. The overlay is installed
  // before the first clip tick; pausing then produced a bind-pose (A-pose) body shot.
  await page.waitForFunction(() => window.fighters?.[0]?.model?.userData?.humanMixer,
    null, { timeout: 60_000, polling: 200 });
  await page.waitForFunction(() => /Goku_Idle/i.test(
    window.fighters?.[0]?.model?.userData?.idleAction?.getClip?.()?.name
      || window.fighters?.[0]?.model?.userData?.currentClip
      || ''), null, { timeout: 30_000, polling: 200 }).catch(() => {});
  await page.evaluate(() => window.__browserSmashStep(0.5));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__browserSmashSetPaused?.(true));

  // Clean, match-ready poses. The opponent stays a live, visible fighter; only the current close-up
  // framing decides whether he is in the shot.
  const resetFighters = async ({ solo = false, beam = false } = {}) => {
    await page.evaluate(({ soloPose, beamPose }) => {
      const [goku, opponent] = window.fighters;
      for (const fighter of [goku, opponent]) {
        fighter.attackQueue.length = 0;
        fighter.attackPose = 0;
        fighter.comboStep = 0;
        fighter.comboWindow = 0;
        fighter.hitstun = 0;
        fighter.guardBreak = 0;
        fighter.guardHeld = false;
        fighter.victoryPose = 0;
        fighter.velocity?.set?.(0, 0, 0);
        fighter.isGrounded = true;
        fighter.model.visible = true;
      }
      const ground = Number.isFinite(window.__browserSmashLayout?.()?.ground)
        ? window.__browserSmashLayout().ground : 0;
      if (beamPose) {
        goku.position.set(-1.5, ground, 0);
        goku.facing = 1; goku.facingZ = 0;
        opponent.position.set(6.5, ground, 0);
        opponent.facing = -1; opponent.facingZ = 0;
        // A signature already queued before the freeze can still release on the next update. The
        // opponent is the training target in this isolated beam shot, not a second caster.
        opponent.specialCooldown = 99;
        opponent.specialCast = null;
        opponent.pendingSignature = null;
        opponent.attackQueue.length = 0;
      } else {
        goku.position.set(0, ground, 0);
        goku.facing = 1; goku.facingZ = 0;
        opponent.position.set(soloPose ? 14 : 3.0, ground, 0);
        opponent.facing = -1; opponent.facingZ = 0;
      }
      goku.specialCooldown = 0;
      goku.pendingSignature = null;
      goku.specialCast = null;
      // Remove any projectile that was already in flight before this isolated cast; otherwise the
      // release probe can mistake the opponent's old beam for Goku's Kamehameha.
      const inFlight = window.browserSmashProjectiles;
      if (Array.isArray(inFlight)) {
        for (const projectile of inFlight) projectile.group?.parent?.remove?.(projectile.group);
        inFlight.length = 0;
      }
      window.__browserSmashLastShot = null;
      goku.model.updateMatrixWorld(true);
      opponent.model.updateMatrixWorld(true);
    }, { soloPose: solo, beamPose: beam });
  };

  const step = async seconds => page.evaluate(seconds => {
    window.__browserSmashSetPaused?.(false);
    const frames = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < frames; i += 1) window.__browserSmashStep(1 / 60);
    window.__browserSmashSetPaused?.(true);
  }, seconds);

  const capture = async (name, { framing = 'full', yaw = 24, pitch = 5, distance = 3.2, faceCamera = true } = {}) => {
    await page.evaluate(({ framing, yaw, pitch, distance, faceCamera }) => {
      const fighter = window.fighters[0];
      const camera = window.smashCamera;
      camera?.spectate?.({
        fighter, framing, yaw, pitch, distance, transition: 0
      });
      if (faceCamera) {
        const toCamera = camera.camera.position.clone().sub(fighter.model.position);
        toCamera.y = 0;
        fighter.model.rotation.y = Math.atan2(toCamera.x, toCamera.z)
          - (fighter.model.userData.modelFacingOffset || 0);
      }
      fighter.model.updateMatrixWorld(true);
      window.__browserSmashRenderer?.render?.(window.__browserSmashScene, camera.camera);
    }, { framing, yaw, pitch, distance, faceCamera });
    await page.waitForTimeout(180);
    await shot(page, name);
  };

  await page.addStyleTag({
    content: '#bbHudLayer, #bbHudLayer *, #combatCallout, #hud, #energyHUD, #comboNotice, #roundScore, #cameraSettings, #executeHint, #pauseMenu { display: none !important; }'
  });
  await resetFighters();
  await step(0.25);

  // ---- mounted body ---------------------------------------------------------------------------
  const body = await page.evaluate(() => {
    const f = window.fighters[0];
    const root = f.model;
    const THREE = window.__browserSmashThree;
    let joints = 0, meshes = 0, skinnedMeshes = 0, triangles = 0, degenerateTriangles = 0, nearDegenerateTriangles = 0;
    let weightedVertices = 0, mappedMaterials = 0, finiteSkinWeights = true, finiteBones = true;
    const textures = new Set();
    const materials = new Set();
    const zeroArea = [];

    root.traverse(node => {
      if (node.isBone) {
        joints += 1;
        const q = node.quaternion;
        if (![q.x, q.y, q.z, q.w].every(Number.isFinite)) finiteBones = false;
        return;
      }
      if (!node.isMesh) return;
      meshes += 1;
      if (node.isSkinnedMesh) skinnedMeshes += 1;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) {
        if (!material) continue;
        materials.add(material.name || material.uuid);
        if (material.map) {
          mappedMaterials += 1;
          const image = material.map.image;
          textures.add(`${material.name || material.uuid}:${image?.width || '?'}x${image?.height || '?'}`);
        }
      }
      const skin = node.geometry?.attributes?.skinWeight;
      if (skin) {
        for (let i = 0; i < Math.min(skin.count, 600); i += 1) {
          for (let k = 0; k < 4; k += 1) {
            if (!Number.isFinite(skin.getComponent?.(i, k) ?? skin.getX?.(i))) finiteSkinWeights = false;
          }
        }
        weightedVertices += skin.count;
      }
      const position = node.geometry?.attributes?.position;
      const index = node.geometry?.index;
      if (!position) return;
      const count = index ? index.count : position.count;
      triangles += count / 3;
      for (let i = 0; i < count; i += 3) {
        const ia = index ? index.getX(i) : i;
        const ib = index ? index.getX(i + 1) : i + 1;
        const ic = index ? index.getX(i + 2) : i + 2;
        const ax = position.getX(ia), ay = position.getY(ia), az = position.getZ(ia);
        const bx = position.getX(ib), by = position.getY(ib), bz = position.getZ(ib);
        const cx = position.getX(ic), cy = position.getY(ic), cz = position.getZ(ic);
        const abx = bx - ax, aby = by - ay, abz = bz - az;
        const acx = cx - ax, acy = cy - ay, acz = cz - az;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const area2 = nx * nx + ny * ny + nz * nz;
        if (!Number.isFinite(area2) || area2 === 0) {
          degenerateTriangles += 1;
          if (zeroArea.length < 4) zeroArea.push(node.name || 'mesh');
        } else if (area2 < 1e-12) {
          nearDegenerateTriangles += 1;
        }
      }
    });

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    let faceRoot = null;
    let faceMeshes = 0;
    const morphNames = new Set();
    root.traverse(node => {
      if (node.userData?.gokuBakedFaceRig) faceRoot = node;
      if (!node.isMesh || !node.morphTargetDictionary) return;
      const entries = Object.keys(node.morphTargetDictionary);
      for (const name of entries) morphNames.add(name);
      if (node.userData?.gokuBakedFace || node.parent === faceRoot) faceMeshes += 1;
    });
    const head = root.userData.head;
    const headWorld = head?.getWorldPosition?.(new THREE.Vector3()) || null;
    const faceWorld = faceRoot?.getWorldPosition?.(new THREE.Vector3()) || null;
    return {
      identity: f.identityKey,
      characterAssetUrl: root.userData.characterAssetUrl || null,
      joints, meshes, skinnedMeshes, weightedVertices, triangles,
      degenerateTriangles, nearDegenerateTriangles, zeroAreaMeshes: zeroArea,
      animation: {
        mixer: Boolean(root.userData.humanMixer),
        released: Boolean(root.userData.animationControllerReleased),
        idleClip: root.userData.idleAction?.getClip?.()?.name || null,
        currentClip: root.userData.currentClip || null
      },
      mappedMaterials, textures: [...textures], materials: [...materials],
      finiteSkinWeights, finiteBones,
      bounds: {
        min: box.min.toArray().map(v => +v.toFixed(3)),
        max: box.max.toArray().map(v => +v.toFixed(3)),
        height: +size.y.toFixed(3)
      },
      face: {
        root: faceRoot?.name || null,
        meshes: faceMeshes,
        morphs: [...morphNames],
        headDistance: headWorld && faceWorld ? +headWorld.distanceTo(faceWorld).toFixed(3) : null
      }
    };
  });
  check('Goku mounts through the normal match path', body.identity === 'goku'
    && /goku_body_face_rigged\.glb/.test(body.characterAssetUrl || ''), JSON.stringify({ identity: body.identity, asset: body.characterAssetUrl }));
  check('the repaired body keeps its full 73-joint rig and skinned mesh', body.joints >= 70
    && body.skinnedMeshes >= 1 && body.weightedVertices >= 20_000
    && body.finiteSkinWeights && body.finiteBones && body.bounds.height > 1.3 && body.bounds.height < 2.4,
  JSON.stringify({ joints: body.joints, skinnedMeshes: body.skinnedMeshes, weightedVertices: body.weightedVertices, height: body.bounds.height }));
  check('the repaired body has no exactly zero-area triangles left', body.degenerateTriangles === 0 && body.triangles > 70_000,
    JSON.stringify({ triangles: body.triangles, degenerate: body.degenerateTriangles, nearDegenerate: body.nearDegenerateTriangles, meshes: body.zeroAreaMeshes }));
  check('the live body has settled into its authored idle before the close-up',
    body.animation.mixer && /Goku_Idle/i.test(body.animation.currentClip || body.animation.idleClip || ''),
    JSON.stringify(body.animation));
  check('the two authored diffuse maps are mounted', body.mappedMaterials >= 2 && body.textures.length >= 2,
    JSON.stringify({ mapped: body.mappedMaterials, textures: body.textures }));
  check('the baked face rig is parented to the mounted head with all four morph families',
    Boolean(body.face.root) && body.face.meshes >= 9
      && ['Blink', 'Guard', 'Hit', 'Victory'].every(name => body.face.morphs.includes(name))
      && body.face.headDistance !== null && body.face.headDistance < 0.25,
    JSON.stringify(body.face));

  await capture('01-goku-live-match-closeup', { framing: 'full', yaw: 24, pitch: 5, distance: 4.8 });
  await page.evaluate(() => {
    const opponent = window.fighters[1];
    opponent.position.set(14, opponent.groundLevel ?? 0.14, 0);
    opponent.model.updateMatrixWorld(true);
  });
  await capture('02-goku-body-closeup', { framing: 'full', yaw: 12, pitch: 3, distance: 2.8 });

  // ---- face morphs ----------------------------------------------------------------------------
  const faceRead = () => page.evaluate(() => {
    const f = window.fighters[0];
    const report = f.model?.userData?.animationOverlayReport?.face || null;
    const root = f.model?.userData?.gokuFaceRig || null;
    let faceRoot = null;
    f.model?.traverse?.(node => { if (!faceRoot && node.userData?.gokuBakedFaceRig) faceRoot = node; });
    const THREE = window.__browserSmashThree;
    const head = f.model?.userData?.head || null;
    const facePoint = faceRoot?.getWorldPosition?.(new THREE.Vector3()) || null;
    const headPoint = head?.getWorldPosition?.(new THREE.Vector3()) || null;
    const morphWeights = report?.morphWeights || null;
    return {
      rig: root,
      report,
      morphWeights,
      faceHeadDistance: facePoint && headPoint ? +facePoint.distanceTo(headPoint).toFixed(3) : null,
      faceRootName: faceRoot?.name || null
    };
  });

  await page.evaluate(() => {
    const f = window.fighters[0];
    f.hitstun = 0;
    f.guardHeld = false;
    f.victoryPose = 0;
    const state = f.model?.userData?.animationOverlays;
    if (state) state.clock = 0;
  });
  await step(0.05);
  const neutralFace = await faceRead();
  await capture('03-goku-face-neutral', { framing: 'head', yaw: 18, pitch: 2, distance: 1.2 });
  check('the live face exposes the baked morph channel at the head',
    neutralFace.report?.baked === true && (neutralFace.report?.morphs || 0) >= 12
      && neutralFace.faceRootName === 'Goku_BakedFaceRig' && neutralFace.faceHeadDistance < 0.25,
    JSON.stringify({ report: neutralFace.report, root: neutralFace.faceRootName, distance: neutralFace.faceHeadDistance }));
  check('neutral face keeps the blink morph shut', (neutralFace.morphWeights?.Blink || 0) < 0.05,
    JSON.stringify(neutralFace.morphWeights));

  await page.evaluate(() => {
    const f = window.fighters[0];
    const state = f.model?.userData?.animationOverlays;
    if (state) {
      state.clock = 3.74;
      state.lastBlink = 1;
    }
  });
  await step(1 / 60);
  const blinkFace = await faceRead();
  await capture('04-goku-face-blink-morph', { framing: 'head', yaw: 18, pitch: 2, distance: 1.2 });
  check('the live face drives the baked Blink morph', (blinkFace.morphWeights?.Blink || 0) > 0.5,
    JSON.stringify(blinkFace.morphWeights));

  await page.evaluate(() => {
    const f = window.fighters[0];
    f.hitstun = 0.7;
    f.guardHeld = false;
    f.victoryPose = 0;
    const state = f.model?.userData?.animationOverlays;
    if (state) state.clock = 0;
  });
  await step(0.12);
  const hitFace = await faceRead();
  await capture('05-goku-face-hit-morph', { framing: 'head', yaw: 18, pitch: 2, distance: 1.2 });
  check('the live face drives the baked Hit morph and names the hit expression',
    hitFace.report?.expression === 'hit' && (hitFace.morphWeights?.Hit || 0) > 0.5,
    JSON.stringify({ expression: hitFace.report?.expression, weights: hitFace.morphWeights }));

  // ---- Kamehameha -----------------------------------------------------------------------------
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.hitstun = 0;
    f.guardHeld = false;
    f.victoryPose = 0;
    f.attackQueue.length = 0;
    f.specialCooldown = 0;
    f.specialCast = null;
    f.pendingSignature = null;
    const ground = Number.isFinite(window.__browserSmashLayout?.()?.ground)
      ? window.__browserSmashLayout().ground : 0;
    f.position.set(-1.5, ground, 0);
    f.facing = 1; f.facingZ = 0;
    const opponent = window.fighters[1];
    opponent.attackQueue.length = 0;
    opponent.specialCooldown = 99;
    opponent.specialCast = null;
    opponent.pendingSignature = null;
    opponent.position.set(2.0, ground, 0);
    opponent.facing = -1; opponent.facingZ = 0;
    const inFlight = window.browserSmashProjectiles;
    if (Array.isArray(inFlight)) {
      for (const projectile of inFlight) projectile.group?.parent?.remove?.(projectile.group);
      inFlight.length = 0;
    }
    window.__browserSmashLastShot = null;
    const state = f.model?.userData?.animationOverlays;
    if (state) state.clock = 0;
    const camera = window.smashCamera;
    camera?.spectate?.({ fighter: f, framing: 'full', yaw: 90, pitch: 4, distance: 6.0, transition: 0 });
  });
  await step(0.12);
  const kameBefore = await page.evaluate(() => ({
    cast: window.fighters[0].specialCast?.id || 0,
    cooldown: window.fighters[0].specialCooldown || 0,
    clip: window.fighters[0].model?.userData?.authoredSpecialClipId || null,
    opponentPercent: window.fighters[1].percent || 0
  }));
  await page.keyboard.down('k');
  const charge = await page.evaluate(() => {
    const f = window.fighters[0];
    window.__browserSmashSetPaused?.(false);
    for (let i = 0; i < 120; i += 1) {
      window.__browserSmashStep(1 / 60);
      const action = f.model?.userData?.authoredSpecialAction;
      const t = action?.time || 0;
      if (f.specialCast?.id && t > 0.08) {
        window.__browserSmashSetPaused?.(true);
        return {
          cast: f.specialCast.id,
          clip: f.specialCast.clip,
          actionClip: action?.getClip?.().name || null,
          time: +t.toFixed(3),
          duration: +(action?.getClip?.().duration || 0).toFixed(3),
          pending: f.pendingSignature?.timer ?? null
        };
      }
    }
    window.__browserSmashSetPaused?.(true);
    return null;
  });
  await capture('06-goku-kamehameha-charge', { framing: 'full', yaw: 90, pitch: 4, distance: 6.0, faceCamera: false });
  check('K starts the authored Kamehameha on the live body',
    Boolean(charge) && charge.cast > kameBefore.cast && charge.clip === 'Goku_Kamehameha'
      && charge.actionClip === 'Goku_Kamehameha' && charge.time > 0,
    JSON.stringify({ before: kameBefore, charge }));

  const release = await page.evaluate(() => {
    const f = window.fighters[0];
    window.__browserSmashSetPaused?.(false);
    for (let i = 0; i < 120; i += 1) {
      window.__browserSmashStep(1 / 60);
      const allProjectiles = window.__browserSmashProjectiles?.() || [];
      const projectiles = allProjectiles.filter(projectile => projectile.owner === 'p1');
      if (projectiles.length > 0) {
        window.__browserSmashSetPaused?.(true);
        return {
          i,
          cast: f.specialCast?.id || 0,
          clip: f.specialCast?.clip || null,
          pending: f.pendingSignature?.timer ?? null,
          projectiles,
          allProjectiles,
          shot: window.__browserSmashLastShot || null,
          cooldown: +(f.specialCooldown || 0).toFixed(2)
        };
      }
    }
    window.__browserSmashSetPaused?.(true);
    return { i: 120, cast: f.specialCast?.id || 0, clip: f.specialCast?.clip || null, pending: f.pendingSignature?.timer ?? null, projectiles: [], shot: null, cooldown: +(f.specialCooldown || 0).toFixed(2) };
  });
  await capture('07-goku-kamehameha-release', { framing: 'full', yaw: 90, pitch: 4, distance: 6.0, faceCamera: false });
  check('the Kamehameha releases a real beam projectile from Goku\'s palms',
    release.projectiles.length > 0 && release.projectiles.every(projectile => projectile.owner === 'p1')
      && release.shot?.source === 'special' && release.shot?.moveType === 'beam'
      && release.shot?.identity === 'Goku' && release.pending === null && release.cooldown > 0,
    JSON.stringify({ release }));

  const impact = await page.evaluate(() => {
    const f = window.fighters[0];
    const opponent = window.fighters[1];
    const startPercent = opponent.percent || 0;
    window.__browserSmashSetPaused?.(false);
    let shot = null;
    for (let i = 0; i < 90; i += 1) {
      window.__browserSmashStep(1 / 60);
      shot = window.__browserSmashLastImpact || shot;
      if (window.__browserSmashProjectiles?.().length === 0 && shot?.identity === 'Goku') break;
    }
    window.__browserSmashSetPaused?.(true);
    return {
      shot,
      startPercent,
      endPercent: +(opponent.percent || 0).toFixed(2),
      opponentHitstun: +(opponent.hitstun || 0).toFixed(2),
      currentClip: f.model?.userData?.currentClip || null,
      specialRunning: Boolean(f.model?.userData?.authoredSpecialAction?.isRunning?.())
    };
  });
  await capture('08-goku-kamehameha-impact', { framing: 'full', yaw: 90, pitch: 4, distance: 6.0, faceCamera: false });
  check('the live Kamehameha damages the opponent through the beam system',
    impact.shot?.type === 'beam' && impact.shot?.identity === 'Goku' && impact.shot?.dealt > 0
      && impact.endPercent > impact.startPercent,
    JSON.stringify(impact));

  const finalMatch = await page.evaluate(() => {
    const state = window.__browserSmashMatch?.() || null;
    return {
      status: state?.status || null,
      arena: state?.arena || null,
      fighters: window.fighters?.length || 0,
      menuHidden: document.querySelector('#menu')?.classList.contains('hidden') === true,
      opponentVisible: window.fighters?.[1]?.model?.visible !== false,
      gokuVisible: window.fighters?.[0]?.model?.visible !== false,
      paused: window.__browserSmashPaused === true || document.body.classList.contains('paused')
    };
  });
  check('all evidence comes from one live match with both fighters mounted',
    finalMatch.status === 'fighting' && finalMatch.fighters === 2 && finalMatch.menuHidden
      && finalMatch.gokuVisible && finalMatch.opponentVisible,
    JSON.stringify(finalMatch));
  check('no browser runtime errors while capturing and casting', errors.length === 0,
    errors.slice(0, 3).join(' | '));
  check('no failed asset requests while capturing and casting', failedRequests.length === 0,
    failedRequests.slice(0, 3).join(' | '));

  await page.evaluate(() => window.__browserSmashSetPaused?.(false));
  await writeFile(resolve(out, 'report.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    origin, gpu, softwareRenderer: software,
    body, neutralFace, blinkFace, hitFace, kameBefore, charge, release, impact, finalMatch,
    checks, errors, failedRequests
  }, null, 2));
  console.log('SUMMARY ' + JSON.stringify({
    passed: checks.filter(entry => entry.ok).length,
    total: checks.length,
    failures,
    captures: [
      '01-goku-live-match-closeup', '02-goku-body-closeup', '03-goku-face-neutral',
      '04-goku-face-blink-morph', '05-goku-face-hit-morph',
      '06-goku-kamehameha-charge', '07-goku-kamehameha-release', '08-goku-kamehameha-impact'
    ],
    errors: errors.length,
    failedRequests: failedRequests.length
  }));
} catch (error) {
  console.log('FATAL ' + String(error?.stack || error).slice(0, 1000));
  failures += 1;
} finally {
  await browser.close().catch(() => {});
  await new Promise(done => server.close(done));
}
process.exitCode = failures ? 1 : 0;
