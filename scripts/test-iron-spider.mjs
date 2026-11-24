// Iron Spider end-to-end check. Drives the real game in a browser and asserts on simulation
// state, not on screenshots: the fighter is selectable, mounts through the normal roster path,
// stands on the floor on flat and raised stages, moves, attacks, takes hits, fires its
// signature move with the mechanical-leg VFX attached (and disposes them), and can be played
// as player 2. Screenshots are written to artifacts/ for a human look at the same run.
//
// The production runtime is the source-backed 107-bone body with the supplied Object_122
// mechanical-arm mesh repaired and mounted. This test proves the native arm is visible, the
// procedural fallback is not used, and the signature still passes through the normal hit path.
//
// node scripts/test-iron-spider.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { HARDWARE_GPU, assertHardwareGpu, browserLaunchOptions, captureGpu, isSoftwareRenderer } from './lib/hardware-gpu.mjs';

const root = process.cwd();
const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    // The optional model-import API only exists behind the Vite plugin. Answer it here so a static
    // host does not log a 404 that the game is explicitly designed to tolerate.
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  results.push(name);
  console.log(`  ok  ${name}`);
}

let browser;
try {
  browser = await chromium.launch(browserLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  const consoleErrors = [];
  const missingRequests = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', response => {
    const url = response.url();
    if (response.status() >= 400 && /models\/characters|\.glb|\.fbx|\.gltf/.test(url)) {
      missingRequests.push(response.status() + ' ' + url);
    }
  });

  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    // keep the local Three copy routing intact; GPU capture happens after the app boots below.
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: await readFile(localPath)
      });
    } catch {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 200 });
  const gpu = await captureGpu(page);
  const softwareRenderer = isSoftwareRenderer(gpu);
  console.log('GPU ' + JSON.stringify({ ...gpu, softwareRenderer }));
  if (HARDWARE_GPU) assertHardwareGpu(gpu, 'Iron Spider hardware acceptance');

  // ---- Selection ----------------------------------------------------------
  const card = await page.evaluate(() => {
    const node = document.querySelector('#selectScreen .bs-card[data-fighter="Iron Spider"]');
    return node ? { text: node.textContent.replace(/\s+/g, ' ').trim(), cards: document.querySelectorAll('#selectScreen .bs-card').length } : null;
  });
  check('Iron Spider has its own character-select card', Boolean(card), card ? `${card.cards} cards` : 'no card');
  check('the card advertises the signature move', /SPIDER-LEG ASSAULT/.test(card.text), card.text);
  // The game boots on the title sheet, so enter the same way a player does before touching
  // the select cards. The previous version assumed the select panel was already visible.
  await page.locator('[data-nav="versus"]').first().click();
  await page.waitForFunction(() => {
    const screen = document.querySelector('#selectScreen');
    return Boolean(screen && !screen.hidden && screen.getClientRects().length > 0);
  }, null, { timeout: 10_000 });
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-select.png') });
  await page.locator('#selectScreen .bs-grid').scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-roster.png') });

  await page.click('#selectScreen .bs-card[data-fighter="Iron Spider"]');
  await page.click('#selectScreen .bs-card[data-fighter="Goku"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.evaluate(() => document.querySelector('#play').click());
  await page.waitForFunction(() => window.fighters?.[0]?.characterModelLoaded === true, null, { timeout: 120_000 });
  await page.evaluate(() => window.__browserSmashStep(20));
  await page.waitForFunction(() => {
    const model = window.fighters?.[0]?.model;
    return Boolean(model?.userData?.nativeSpiderLegs || model?.userData?.spiderLegs);
  }, null, { timeout: 30_000 });

  const identity = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    return {
      identity: p1.identity,
      key: p1.identityKey,
      special: p1.specialProfile?.label,
      archetype: p1.archetype,
      imported: p1.characterModelLoaded,
      assets: window.__browserSmashAssets?.characterModels || {},
      opponent: p2.identity
    };
  });
  check('P1 is Iron Spider', identity.identity === 'Iron Spider' && identity.key === 'iron_spider', JSON.stringify(identity));
  check('the opponent is still a separate fighter', identity.opponent === 'Goku');
  check('the signature move is SPIDER-LEG ASSAULT', identity.special === 'SPIDER-LEG ASSAULT');
  // Iron Spider is served by the repaired, source-backed runtime GLB. It keeps the supplied
  // 107-bone body and 57 clips, and now mounts the supplied Object_122 arm mesh; the procedural
  // appendage rig is retained only as a fallback when that mesh is absent.
  const spiderAsset = identity.assets?.iron_spider || null;
  check('the roster body is what ships, reported loaded with no rig issue',
    identity.imported === true && spiderAsset?.status === 'loaded'
      && (spiderAsset?.validation?.issues || []).length === 0,
    JSON.stringify({ imported: identity.imported, asset: spiderAsset }));
  check('Iron Spider mounts the source-backed 57-clip body',
    /\/models\/characters\/iron_spider\/iron_spider_source_animated\.glb$/.test(String(spiderAsset?.url || '')),
    String(spiderAsset?.url || ''));
  const clipInventory = await page.evaluate(() => ({
    actions: Object.keys(window.fighters[0].model.userData.animationActions || {}).length,
    animations: (window.__browserSmashAssets?.characterModels?.iron_spider?.animations || []).length
  }));
  // `animationActions` is an alias map as well as a clip map; the mounted asset inventory is the
  // authoritative count of the 32 source plus 25 supplemental clips.
  check('all 57 source-plus-supplement clips are exposed', clipInventory.animations === 57, JSON.stringify(clipInventory));
  const appendages = await page.evaluate(() => {
    const p = window.fighters[0];
    const model = p.model;
    const arm = model.getObjectByName?.('Object_122') || null;
    const native = model.userData.nativeSpiderLegs || null;
    const procedural = model.userData.spiderLegs || null;
    return {
      native,
      procedural: procedural ? { legs: procedural.legs?.length || 0 } : null,
      arm: arm ? (() => {
        const position = arm.geometry?.attributes?.position;
        const skinIndex = arm.geometry?.attributes?.skinIndex;
        const skinWeight = arm.geometry?.attributes?.skinWeight;
        let spiderDominant = 0;
        let unweighted = 0;
        if (position && skinIndex && skinWeight) {
          for (let i = 0; i < position.count; i += 1) {
            const weights = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
            const indices = [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)];
            let slot = 0;
            for (let c = 1; c < 4; c += 1) if (weights[c] > weights[slot]) slot = c;
            if (weights[slot] <= 0) { unweighted += 1; continue; }
            if (/spider/i.test(arm.skeleton.bones[indices[slot]]?.name || '')) spiderDominant += 1;
          }
        }
        const THREE = window.__browserSmashThree;
        arm.skeleton?.update?.();
        arm.computeBoundingBox?.();
        const box = arm.boundingBox?.clone?.().applyMatrix4(arm.matrixWorld) || null;
        return {
          name: arm.name,
          skinned: Boolean(arm.isSkinnedMesh),
          vertices: position?.count || 0,
          bones: arm.skeleton?.bones?.length || 0,
          parent: arm.parent?.name || null,
          spiderBones: (arm.skeleton?.bones || []).filter(bone => /spider/i.test(bone.name || '')).length,
          spiderDominant,
          unweighted,
          tipBones: (arm.skeleton?.bones || []).filter(bone => /spider.*leg/i.test(bone.name || '') && !(bone.children?.length)).map(bone => bone.name),
          idleBounds: box ? box.getSize(new THREE.Vector3()).toArray().map(value => +value.toFixed(3)) : null
        };
      })() : null
    };
  });
  check('the supplied Object_122 arm mesh is mounted on the imported body with its native bone groups',
    appendages.native?.mesh === 'Object_122' && appendages.native?.bones >= 20
      && appendages.arm?.skinned && appendages.arm.vertices === 1110 && appendages.arm.bones === 107,
    JSON.stringify(appendages));
  check('the native arm mesh replaces the procedural four-leg fallback',
    Boolean(appendages.native) && !appendages.procedural,
    JSON.stringify(appendages));
  check('the native arm exposes four terminal spider-leg bones',
    appendages.arm?.tipBones?.length === 4,
    JSON.stringify(appendages.arm?.tipBones));
  // The three acceptance criteria for the supplied arm: it is bound to the native spider-leg
  // chain, it sits at body scale rather than the authored 45x51x58 m box, and it is driven by the
  // clips (checked below during the signature sweep).
  check('all 1,110 arm vertices are weighted to the native spider-leg chain',
    appendages.arm?.spiderDominant === 1110 && appendages.arm?.unweighted === 0
      && appendages.arm?.spiderBones >= 20,
    JSON.stringify({ dominant: appendages.arm?.spiderDominant, unweighted: appendages.arm?.unweighted, spiderBones: appendages.arm?.spiderBones }));
  check('the repaired arm sits at body scale, not the authored 45x51x58 m bounds',
    Array.isArray(appendages.arm?.idleBounds) && appendages.arm.idleBounds.every(value => value > 0.2 && value < 2.5),
    JSON.stringify(appendages.arm?.idleBounds));

  // ---- Floor contact and rig ---------------------------------------------
  const rig = await page.evaluate(() => {
    const p = window.fighters[0];
    const check = window.__browserSmashRigCheck(p);
    const box = new window.__browserSmashThree.Box3().setFromObject(p.model);
    return { ok: check.ok, issues: check.issues, feetY: check.metrics.feetY, height: check.metrics.height, minY: box.min.y, ground: p.position.y };
  });
  check('the fighter rig passes the structural gate', rig.ok, rig.issues.join('; '));
  check('the feet stand on the stage floor', Math.abs(rig.minY - rig.ground) < 0.12, `min y ${rig.minY.toFixed(3)} vs ground ${rig.ground.toFixed(3)}`);
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-idle.png') });

  // ---- Designed native-bone stow / retract -------------------------------
  // No stow clip exists in the source library, so this is a deliberate procedural fold of the
  // supplied 21-bone appendage chain, not a visibility toggle and not a repurposed source pose.
  // The check proves the folded envelope, the reversible blend, the input path, and that all 57
  // clips (including the two static source poses) are untouched.
  const readStow = () => page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const p = window.fighters[0];
    const arm = p.model.getObjectByName?.('Object_122') || null;
    if (!arm) return null;
    arm.skeleton?.update?.();
    const spiderBones = (arm.skeleton?.bones || []).filter(bone => /spider/i.test(bone.name || ''));
    const tipBones = spiderBones.filter(bone => !(bone.children?.length));
    const tips = tipBones.map(bone => ({
      name: bone.name,
      pos: bone.getWorldPosition(new THREE.Vector3()).toArray().map(value => +value.toFixed(4))
    }));
    const tipBox = new THREE.Box3();
    for (const bone of tipBones) tipBox.expandByPoint(bone.getWorldPosition(new THREE.Vector3()));
    const tipSize = tipBox.isEmpty() ? null : tipBox.getSize(new THREE.Vector3()).toArray().map(value => +value.toFixed(4));
    const actions = p.model.userData.animationActions || {};
    const sourceClips = Object.values(actions)
      .map(action => action?.getClip?.())
      .filter(clip => clip && /@(collection|skill07-03)$/.test(clip.name || ''))
      .map(clip => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.length, uuid: clip.uuid }));
    return {
      stowed: p.ironSpiderStowed === true,
      state: p.model.userData.nativeSpiderStow ? {
        progress: +p.model.userData.nativeSpiderStow.progress.toFixed(4),
        target: p.model.userData.nativeSpiderStow.target,
        chains: p.model.userData.nativeSpiderStow.chains,
        folds: p.model.userData.nativeSpiderStow.folds,
        deployments: p.model.userData.nativeSpiderStow.deployments
      } : null,
      visible: arm.visible === true,
      materialVisible: [].concat(arm.material || []).every(material => material?.visible !== false),
      parent: arm.parent?.name || null,
      mesh: arm.name,
      clipCount: Object.keys(actions).length,
      sourceClips,
      boneQuats: spiderBones.map(bone => ({ name: bone.name, q: bone.quaternion.toArray().map(value => +value.toFixed(6)) })),
      tipSize,
      tips
    };
  });
  const resetStowArena = () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p1.hitstun = 0; p1.attackQueue.length = 0;
    p1.attackBuffer = 0; p1.attackPose = 0; p1.specialCooldown = 0;
    p2.position.set(8, p2.groundLevel, -12); p2.velocity.set(0, 0, 0);
    p2.hitstun = 0; p2.attackQueue.length = 0;
    window.__browserSmashStep(0.35);
  });
  // Freeze the CPU before the stow input test: an AI special must not put the player into
  // hitstun between the key press and the sampled fold.
  await page.evaluate(() => { window.__browserSmashTrainingDummy = true; window.__browserSmashFreezeAI = true; });
  await resetStowArena();
  const stowBefore = await readStow();
  check('Iron Spider starts with the native appendages deployed, not hidden',
    stowBefore?.mesh === 'Object_122' && stowBefore.visible && stowBefore.materialVisible
      && !stowBefore.stowed && stowBefore.state?.progress === 0
      && stowBefore.state?.chains === 4 && stowBefore.clipCount > 0,
    JSON.stringify(stowBefore));
  await page.keyboard.press('g');
  await step(0.08);
  const stowTransition = await readStow();
  await step(0.6);
  const stowFolded = await readStow();
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-stow-folded.png') });
  await page.keyboard.press('g');
  await step(0.6);
  const stowRedeployed = await readStow();
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-stow-redeployed.png') });

  const quatAngle = (a, b) => {
    if (!a || !b) return 0;
    const dot = Math.abs(a.q.reduce((sum, value, index) => sum + value * b.q[index], 0));
    return 2 * Math.acos(Math.min(1, dot));
  };
  const foldedMotion = Math.max(...stowFolded.boneQuats.map(bone => {
    const before = stowBefore.boneQuats.find(entry => entry.name === bone.name);
    return quatAngle(before, bone);
  }));
  const restoredMotion = Math.max(...stowRedeployed.boneQuats.map(bone => {
    const before = stowBefore.boneQuats.find(entry => entry.name === bone.name);
    return quatAngle(before, bone);
  }));
  const envelopeRatio = stowFolded.tipSize.map((value, index) => value / stowBefore.tipSize[index]);
  const sourceClipsUnchanged = JSON.stringify(stowBefore.sourceClips) === JSON.stringify(stowFolded.sourceClips)
    && JSON.stringify(stowBefore.sourceClips) === JSON.stringify(stowRedeployed.sourceClips);
  check('G folds the appendages into a compact native-bone envelope without hiding the mesh',
    stowFolded.stowed && stowFolded.visible && stowFolded.materialVisible
      && stowFolded.parent === stowBefore.parent && stowFolded.mesh === 'Object_122'
      && stowFolded.state?.progress === 1 && stowFolded.state?.target === 1
      && stowFolded.state?.folds === 1 && stowFolded.state?.chains === 4
      && envelopeRatio.every(value => value < 0.62) && foldedMotion > 0.05,
    JSON.stringify({ before: stowBefore.tipSize, folded: stowFolded.tipSize, envelopeRatio, foldedMotion, state: stowFolded.state }));
  check('the stow transition blends through the native chain and a second press redeploys it',
    stowTransition.state?.progress > 0 && stowTransition.state?.progress < 1
      && stowRedeployed.stowed === false && stowRedeployed.state?.progress === 0
      && stowRedeployed.state?.deployments === 1
      && stowRedeployed.visible && stowRedeployed.materialVisible
      && stowRedeployed.tipSize.every((value, index) => Math.abs(value - stowBefore.tipSize[index]) < 0.06)
      && restoredMotion < 0.06,
    JSON.stringify({ transition: stowTransition.state, redeployed: stowRedeployed.state, restoredMotion, before: stowBefore.tipSize, after: stowRedeployed.tipSize }));
  check('stowing changes no animation clip, including the source-defective static poses',
    stowFolded.clipCount === stowBefore.clipCount && stowRedeployed.clipCount === stowBefore.clipCount
      && stowBefore.sourceClips.length >= 1 && sourceClipsUnchanged,
    JSON.stringify({ before: stowBefore.sourceClips, folded: stowFolded.sourceClips, counts: [stowFolded.clipCount, stowRedeployed.clipCount] }));
  // A committed attack must deploy the appendages first; folded legs are neutral presentation,
  // never a way to attack from a hidden or smaller hitbox.
  await page.keyboard.press('g');
  await step(0.6);
  const stowBeforeAttack = await readStow();
  await page.keyboard.press('j');
  await step(0.12);
  const stowDuringAttack = await page.evaluate(() => ({
    stowed: window.fighters[0].ironSpiderStowed === true,
    target: window.fighters[0].model.userData.nativeSpiderStow?.target ?? null,
    progress: window.fighters[0].model.userData.nativeSpiderStow?.progress ?? null,
    attackQueued: window.fighters[0].attackQueue.length,
    visible: window.fighters[0].model.getObjectByName?.('Object_122')?.visible === true
  }));
  check('an attack deploys the stowed appendages before it can land',
    stowBeforeAttack.stowed && !stowDuringAttack.stowed
      && stowDuringAttack.target === 0 && stowDuringAttack.visible,
    JSON.stringify({ before: stowBeforeAttack.state, attack: stowDuringAttack }));
  await step(1.2);

  // ---- Run ---------------------------------------------------------------
  // Freeze the CPU so these checks measure Iron Spider, not an exchange with Goku.
  await page.evaluate(() => { window.__browserSmashTrainingDummy = true; });
  const startX = await page.evaluate(() => window.fighters[0].position.x);
  await page.keyboard.down('d');
  await step(0.6);
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-run.png') });
  await page.keyboard.up('d');
  const runState = await page.evaluate(() => {
    const p = window.fighters[0];
    const box = new window.__browserSmashThree.Box3().setFromObject(p.model);
    return { x: p.position.x, minY: box.min.y, y: p.position.y, ground: p.groundLevel, grounded: p.isGrounded };
  });
  check('the fighter runs forward', runState.x - startX > 1, `moved ${(runState.x - startX).toFixed(2)} m`);
  // A running stride drops a boot below the model origin by design; the rig gate allows
  // 0.25 m, so anything past that is a detached or mis-scaled limb rather than a stride.
  check('the feet stay attached to the model origin while running', runState.minY - runState.y > -0.25,
    `model min y ${runState.minY.toFixed(3)} vs fighter y ${runState.y.toFixed(3)}`);
  check('running keeps the fighter on the floor', runState.grounded && Math.abs(runState.y - runState.ground) < 0.08,
    JSON.stringify(runState));

  // ---- Jump and land ------------------------------------------------------
  await page.keyboard.press('Space');
  await step(0.22);
  const airborne = await page.evaluate(() => ({
    y: window.fighters[0].position.y,
    grounded: window.fighters[0].isGrounded,
    ground: window.fighters[0].groundLevel
  }));
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-jump.png') });
  await step(1.6);
  const landed = await page.evaluate(() => {
    const p = window.fighters[0];
    return { y: p.position.y, grounded: p.isGrounded, ground: p.groundLevel, velocityY: p.velocity.y };
  });
  check('jumping lifts the fighter off the floor', airborne.y > airborne.ground + 0.3, JSON.stringify(airborne));
  check('the fighter lands back on the floor', landed.grounded && Math.abs(landed.y - landed.ground) < 0.08, JSON.stringify(landed));

  // ---- Melee -------------------------------------------------------------
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0); p1.facing = 1; p1.facingZ = 0;
    p1.hitstun = 0; p1.attackQueue.length = 0; p1.attackBuffer = 0;
    p2.position.set(1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0); p2.percent = 0;
    p2.hitstun = 0; p2.guardHeld = false; p2.attackQueue.length = 0;
  });
  await page.keyboard.press('j');
  await step(0.16);
  const melee = await page.evaluate(() => ({
    queue: window.fighters[0].attackQueue.length,
    pose: window.fighters[0].attackPose,
    percent: window.fighters[1].percent,
    stun: window.fighters[1].hitstun
  }));
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-attack.png') });
  check('the attack animates', melee.queue > 0 || melee.pose > 0, JSON.stringify(melee));
  check('the attack damages and stuns the opponent', melee.percent > 0 && melee.stun > 0, JSON.stringify(melee));

  // ---- Signature move ----------------------------------------------------
  // The supplied Object_122 arm is a skinned mesh on the fighter, driven by the native
  // 107-bone animation library. No leg mesh is spawned or removed when the move fires.
  const armState = () => page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const p = window.fighters[0];
    const arm = p.model?.getObjectByName?.('Object_122') || null;
    if (!arm) return null;
    arm.skeleton?.update?.();
    arm.computeBoundingBox?.();
    const box = arm.boundingBox?.clone?.().applyMatrix4(arm.matrixWorld) || null;
    return {
      mesh: arm.name,
      skinned: Boolean(arm.isSkinnedMesh),
      visible: arm.visible,
      parentName: arm.parent?.name || null,
      clip: p.model.userData.currentClip || null,
      // Bone names are sanitized by GLTFLoader (`spider leg L Bone001` -> `spider_leg_L_Bone001`),
      // so sample every spider bone and compare by exact name.
      legs: (arm.skeleton?.bones || []).filter(bone => /spider/i.test(bone.name || ''))
        .map(bone => ({ name: bone.name, q: bone.quaternion.toArray().map(value => +value.toFixed(6)) })),
      size: box ? box.getSize(new THREE.Vector3()).toArray().map(value => +value.toFixed(3)) : null,
      min: box ? box.min.toArray().map(value => +value.toFixed(3)) : null,
      max: box ? box.max.toArray().map(value => +value.toFixed(3)) : null
    };
  });
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -14); p1.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p1.hitstun = 0; p1.specialCooldown = 0; p1.attackQueue.length = 0;
    p2.position.set(1.6, p2.groundLevel, -14); p2.velocity.set(0, 0, 0);
    p2.percent = 0; p2.hitstun = 0; p2.guardHeld = false; p2.invulnerable = 0;
  });
  const armBefore = await armState();
  await page.keyboard.press('k');
  // The repaired native arm's four terminal bones are sampled into contact volumes while the
  // shockwave is open. Sample after the wave has opened rather than at the old leg pose's first
  // frame; this is the same active-window timing used by the live acceptance probe.
  await step(0.28);
  const special = await page.evaluate(() => ({
    cooldown: window.fighters[0].specialCooldown,
    label: window.fighters[0].specialProfile?.label,
    percent: window.fighters[1].percent,
    tipVolumes: (window.fighters[0].legTipVolumes || []).map(tip => ({
      bone: tip.bone, leg: tip.leg, radius: tip.radius,
      pos: tip.pos.toArray().map(value => +value.toFixed(3))
    }))
  }));
  const armDuring = await armState();
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-special.png') });
  check('the signature move fires', special.cooldown > 0 && special.label === 'SPIDER-LEG ASSAULT', JSON.stringify(special));
  check('the fighter carries the supplied Object_122 arm before the move',
    Boolean(armBefore) && armBefore.mesh === 'Object_122' && armBefore.skinned && armBefore.visible,
    JSON.stringify(armBefore));
  check('the sweep plays the supplied signature clip',
    /skill07/i.test(String(armDuring?.clip || '')), `${armBefore?.clip} -> ${armDuring?.clip}`);
  check('the supplied arm stays attached and bounded during the sweep',
    armDuring?.parentName === armBefore?.parentName
      && Array.isArray(armDuring?.size) && armDuring.size.every(value => value > 0 && value < 4),
    JSON.stringify({ parent: armBefore?.parentName, size: armDuring?.size }));
  const legMotion = (() => {
    const before = new Map((armBefore?.legs || []).map(bone => [bone.name, bone.q]));
    let best = { angle: 0, bone: null };
    for (const after of armDuring?.legs || []) {
      const from = before.get(after.name);
      if (!from) continue;
      const dot = Math.abs(from.reduce((sum, value, index) => sum + value * after.q[index], 0));
      const angle = 2 * Math.acos(Math.min(1, dot));
      if (angle > best.angle) best = { angle, bone: after.name };
    }
    return best;
  })();
  check('the native spider-leg bones animate during the supplied clip', legMotion.angle > 0.05,
    `${(legMotion.angle * 180 / Math.PI).toFixed(1)}° on ${legMotion.bone} · ${armDuring?.legs?.length || 0} spider bones sampled`);
  check('the spider-leg sweep damages an adjacent opponent', special.percent > 0, `${special.percent.toFixed(1)}%`);
  check('the signature exposes four native leg-tip contact volumes',
    special.tipVolumes?.length === 4 && special.tipVolumes.every(tip => tip.radius > 0 && /spider.*leg/i.test(tip.bone)),
    JSON.stringify(special.tipVolumes));
  const armOwnership = await page.evaluate(() => {
    const fighter = window.fighters[0];
    const arm = fighter.model.getObjectByName?.('Object_122') || null;
    let parent = arm?.parent || null;
    let owned = false;
    while (parent) { if (parent === fighter.model) { owned = true; break; } parent = parent.parent; }
    return { owned, parentName: arm?.parent?.name || null, visible: arm?.visible ?? false };
  });
  check('the native arm belongs to the fighter, not to a spawned effect',
    armOwnership.owned && armOwnership.visible, JSON.stringify(armOwnership));
  await step(1.2);
  const armAfter = await armState();
  check('the native arm remains mounted after the sweep',
    armAfter?.mesh === 'Object_122' && armAfter.visible && armAfter.parentName === armBefore?.parentName,
    JSON.stringify(armAfter));
  const clearedTipVolumes = await page.evaluate(() => (window.fighters[0].legTipVolumes || []).length);
  check('native leg-tip volumes clear when the sweep ends', clearedTipVolumes === 0, String(clearedTipVolumes));

  // ---- Native leg-tip contact -------------------------------------------
  // Put the opponent on a rear native tip after the cast has started. The target is behind the
  // shockwave's facing cone, so only the native leg-tip volume can land this hit.
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -29); p1.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p1.hitstun = 0; p1.specialCooldown = 0;
    p1.attackQueue.length = 0; p1.attackBuffer = 0; p1.lastSignatureContact = null; p1.legTipVolumes = [];
    p2.position.set(2.8, p2.groundLevel, -29); p2.velocity.set(0, 0, 0);
    p2.percent = 0; p2.hitstun = 0; p2.guardHeld = false; p2.invulnerable = 0;
  });
  await page.keyboard.press('k');
  await step(0.06);
  const tipPlacement = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const tips = p1.legTipVolumes || [];
    const frontDot = tip => (tip.pos.x - p1.position.x) * p1.facing + (tip.pos.z - p1.position.z) * p1.facingZ;
    const tip = tips.find(candidate => frontDot(candidate) < -0.35) || tips[0] || null;
    if (!tip) return { count: tips.length, tip: null };
    p2.position.set(tip.pos.x, Math.max(p2.groundLevel, tip.pos.y - 1), tip.pos.z);
    p2.velocity.set(0, 0, 0); p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0;
    return { count: tips.length, tip: { bone: tip.bone, radius: tip.radius, frontDot: +frontDot(tip).toFixed(3) } };
  });
  await page.keyboard.press('F3');
  await step(0.02);
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-leg-tip-volumes.png') });
  await page.keyboard.press('F3');
  await step(0.18);
  const tipHit = await page.evaluate(() => ({
    percent: window.fighters[1].percent,
    contact: window.fighters[0].lastSignatureContact
  }));
  check('a native leg-tip volume can land the signature outside the shockwave cone',
    Boolean(tipPlacement.tip) && tipHit.percent > 0 && tipHit.contact?.source === 'leg-tip',
    JSON.stringify({ placement: tipPlacement, hit: tipHit }));

  // ---- Knockout ----------------------------------------------------------
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p2.percent = 340;
    p1.position.set(0, p1.groundLevel, -12); p1.facing = 1; p1.facingZ = 0;
    p1.velocity.set(0, 0, 0); p1.hitstun = 0; p1.attackQueue.length = 0; p1.attackBuffer = 0;
    p2.position.set(1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0);
    p2.hitstun = 0; p2.guardHeld = false; p2.invulnerable = 0;
  });
  await page.keyboard.press('j');
  await step(0.4);
  const ko = await page.evaluate(() => window.__browserSmashMatch());
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-knockout.png') });
  check('a knockout ends the round', ko.round > 1 || ko.status !== 'fighting', JSON.stringify(ko));

  // ---- Raised platform ---------------------------------------------------
  const raised = await page.evaluate(() => {
    // The knockout above ended the match, so restart on the penthouse arena first.
    window.__browserSmashSelect.chooseArena('starktower');
    document.querySelector('#play').click();
    window.__browserSmashStep(0.3);
    const p = window.fighters[0];
    // Drop onto the 1.0 m dais in the penthouse layout: the feet must rest on its top.
    p.position.set(44, 1.5, -14.5);
    p.velocity.set(0, 0, 0);
    window.__browserSmashStep(0.6);
    const check = window.__browserSmashRigCheck(p);
    const box = new window.__browserSmashThree.Box3().setFromObject(p.model);
    return {
      arena: window.__browserSmashMatch().arena,
      y: p.position.y,
      ground: p.groundLevel,
      grounded: p.isGrounded,
      minY: box.min.y,
      ok: check.ok,
      issues: check.issues
    };
  });
  // The match-start interstitial hides on the render loop, not on the deterministic simulation
  // step. Wait for the real loading gate so this capture shows the fighter on the dais.
  await page.waitForFunction(() => {
    const loading = document.querySelector('#bbLoading');
    return Boolean(window.__browserSmashControlMode?.().started
      && (!loading || loading.hidden)
      && (window.__browserSmashFrames || 0) > 2);
  }, null, { timeout: 10_000 });
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-raised-stage.png') });
  check('the fighter stands on a raised platform', raised.grounded && raised.y > 0.9 && Math.abs(raised.ground - raised.y) < 0.08, JSON.stringify(raised));
  check('the feet sit on the platform surface', Math.abs(raised.minY - raised.y) < 0.14, `min y ${raised.minY.toFixed(3)} vs platform ${raised.y.toFixed(3)}`);
  check('the rig is still valid on the raised stage', raised.ok, raised.issues.join('; '));

  // ---- Player 2 ----------------------------------------------------------
  await page.evaluate(() => {
    window.__browserSmashSelect.select('p2', 'Iron Spider');
    window.__browserSmashSelect.setMode('2p');
    window.__browserSmashStep(0.05);
    document.querySelector('#play').click();
  });
  await step(0.2);
  await page.waitForFunction(() => {
    const loading = document.querySelector('#bbLoading');
    return Boolean(window.__browserSmashControlMode?.().started
      && (!loading || loading.hidden)
      && (window.__browserSmashFrames || 0) > 2);
  }, null, { timeout: 10_000 });
  const p2Identity = await page.evaluate(() => ({
    identity: window.fighters[1].identity,
    key: window.fighters[1].identityKey,
    special: window.fighters[1].specialProfile?.label,
    mode: window.__browserSmashMatch().mode
  }));
  check('Iron Spider can be player 2', p2Identity.identity === 'Iron Spider' && p2Identity.mode === '2p', JSON.stringify(p2Identity));

  const p2Start = await page.evaluate(() => window.fighters[1].position.x);
  await page.keyboard.down('ArrowLeft');
  await step(0.6);
  await page.keyboard.up('ArrowLeft');
  const p2Moved = await page.evaluate(() => window.fighters[1].position.x);
  check('player 2 Iron Spider moves', p2Start - p2Moved > 0.8, `moved ${(p2Start - p2Moved).toFixed(2)} m`);

  // Iron Spider taking a hit, through the normal P2 attack path rather than a synthetic one.
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0); p1.percent = 0; p1.hitstun = 0;
    p2.position.set(-1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0);
    p2.facing = 1; p2.facingZ = 0; p2.attackQueue.length = 0; p2.attackBuffer = 0; p2.hitstun = 0;
  });
  await page.keyboard.press(',');
  await step(0.18);
  const hitReact = await page.evaluate(() => ({
    percent: window.fighters[0].percent,
    stun: window.fighters[0].hitstun,
    velocity: window.fighters[0].velocity.toArray().map(v => +v.toFixed(2))
  }));
  check('Iron Spider takes damage and hit stun', hitReact.percent > 0 && hitReact.stun > 0, JSON.stringify(hitReact));
  check('the hit knocks the fighter back', Math.hypot(hitReact.velocity[0], hitReact.velocity[2]) > 0.2, JSON.stringify(hitReact.velocity));
  await step(0.4);
  // Player 2's special button is '.' - see public/js/smash_input.js.
  await page.keyboard.press('.');
  await step(0.12);
  const p2Special = await page.evaluate(() => ({
    cooldown: window.fighters[1].specialCooldown,
    label: window.fighters[1].specialProfile?.label
  }));
  check('player 2 can fire SPIDER-LEG ASSAULT', p2Special.cooldown > 0, p2Special.label);
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-player2.png') });

  // ---- Rematch / stage travel / camera -----------------------------------
  const framing = await page.evaluate(() => ({
    distance: window.smashCamera.framing.distance,
    y: window.smashCamera.camera.position.y,
    fov: window.smashCamera.camera.fov
  }));
  check('the camera stays pulled back and elevated', framing.distance > 5 && framing.y > 2, JSON.stringify(framing));

  const travel = await page.evaluate(() => {
    window.__browserSmashTravel('hogwarts_great_hall', 'Great Hall');
    window.__browserSmashStep(0.3);
    const [p1, p2] = window.fighters;
    const a = window.__browserSmashRigCheck(p1);
    const b = window.__browserSmashRigCheck(p2);
    // Report what each fighter is wearing and which gate clause rejected it: "rig1:false" on its
    // own does not say whether the body, the skeleton or the ground contact is at fault.
    const brief = (fighter, check) => ({
      body: fighter.model?.userData?.characterAssetUrl || (fighter.model?.userData?.sculptedBody ? 'sculpted' : 'prefab'),
      ok: check.ok,
      issues: check.issues,
      feetY: check.metrics.feetY,
      height: check.metrics.height,
      headAbovePelvis: check.metrics.headAbovePelvis,
      missingBones: check.rig?.missing || null
    });
    return { arena: window.__browserSmashMatch().arena, rig1: a.ok, rig2: b.ok,
      feet1: a.metrics.feetY, feet2: b.metrics.feetY, detail: [brief(p1, a), brief(p2, b)] };
  });
  check('stage travel keeps both fighters valid and grounded',
    travel.arena === 'hogwarts_great_hall' && travel.rig1 && travel.rig2
      && Math.abs(travel.feet1) < 0.12 && Math.abs(travel.feet2) < 0.12,
    JSON.stringify(travel));

  // ---- Complete a fresh best-of-three match ------------------------------
  // Earlier checks prove individual mechanics; this closes the loop to a real result screen.
  // It starts a fresh match so the round counter and win totals are unambiguous.
  await page.evaluate(() => {
    const select = window.__browserSmashSelect;
    select.setMode('1p');
    select.setRules({ roundsToWin: 2, roundSeconds: 80 });
    select.select('p1', 'Iron Spider');
    select.select('p2', 'Goku');
    select.chooseArena('tournament');
    window.__browserSmashFreezeAI = true;
    window.__browserSmashGame.startMatch();
    window.__browserSmashStep(0.2);
  });
  await page.waitForFunction(() => window.fighters?.[0]?.identity === 'Iron Spider'
    && window.fighters?.[0]?.characterModelLoaded === true
    && window.__browserSmashControlMode?.().started === true, null, { timeout: 30_000 });
  for (let round = 0; round < 2; round++) {
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0);
      p1.facing = 1; p1.facingZ = 0; p1.hitstun = 0; p1.attackQueue.length = 0;
      p1.attackBuffer = 0; p1.attackCooldown = 0;
      p2.position.set(1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0);
      p2.percent = 340; p2.hitstun = 0; p2.guardHeld = false; p2.invulnerable = 0;
      window.__browserSmashStep(0.1);
    });
    await page.keyboard.press('j');
    await page.evaluate(() => window.__browserSmashStep(0.6));
    if (round === 0) {
      await page.waitForFunction(() => window.__browserSmashMatch().round > 1, null, { timeout: 10_000 });
      await page.evaluate(() => window.__browserSmashStep(1.5));
    }
  }
  // The match-end ceremony runs on a presentation hold. Headless SwiftShader can render fewer
  // real frames than wall-clock seconds, so advance the same deterministic simulation clock the
  // rest of this suite uses through the hold, then wait for the real matchend payload.
  await page.evaluate(() => window.__browserSmashStep(4));
  await page.waitForFunction(() => Boolean(window.__browserSmashLastResult), null, { timeout: 5_000 });
  const completeMatch = await page.evaluate(() => ({
    match: window.__browserSmashMatch(),
    result: window.__browserSmashLastResult,
    victory: window.__browserSmashVictoryState?.()
  }));
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-match-complete.png') });
  check('a complete match reaches a result',
    completeMatch.match?.status !== 'fighting' && Boolean(completeMatch.result),
    JSON.stringify({ match: completeMatch.match, result: completeMatch.result?.text }));
  check('the completed best-of-three is an Iron Spider victory',
    /VICTORY\s*·\s*IRON SPIDER/i.test(String(completeMatch.result?.text || ''))
      && completeMatch.result?.winner === 'p1'
      && completeMatch.result?.stats?.wins?.[0] === 2
      && completeMatch.result?.stats?.wins?.[1] === 0,
    JSON.stringify({ text: completeMatch.result?.text, winner: completeMatch.result?.winner, wins: completeMatch.result?.stats?.wins }));

  // ---- Separate rematch after victory ------------------------------------
  const rematchLabel = (await page.locator('#play').textContent().catch(() => '')).trim();
  check('the victory result offers REMATCH', /^REMATCH$/i.test(rematchLabel), rematchLabel);
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting'
    && window.fighters?.[0]?.identity === 'Iron Spider'
    && window.fighters?.[0]?.characterModelLoaded === true
    && window.__browserSmashControlMode?.().started === true, null, { timeout: 30_000 });
  // The result curtain closes and the fresh round re-enters over a presentation hold. Waiting
  // only for status='fighting' can read state before that hold resets the fighters.
  await page.waitForFunction(() => {
    const loading = document.querySelector('#bbLoading');
    return Boolean(window.__browserSmashControlMode?.().started
      && (!loading || loading.hidden)
      && (window.__browserSmashFrames || 0) > 2);
  }, null, { timeout: 10_000 });
  await page.evaluate(() => { window.__browserSmashLastResult = null; });
  // The result curtain closes and the fresh round's entrance presentation owns the opening
  // seconds. Let that hold finish before poking percent, or the pending reset overwrites it.
  await page.evaluate(() => window.__browserSmashStep(4.0));
  const afterVictoryRematch = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const arm = p1.model?.getObjectByName?.('Object_122');
    return {
      status: window.__browserSmashMatch().status,
      p1: p1.identity, p2: p2.identity,
      p1Percent: p1.percent, p2Percent: p2.percent,
      p1Grounded: p1.isGrounded,
      p1Meter: p1.meter,
      result: (document.querySelector('#result')?.textContent || '').trim(),
      armVisible: arm?.visible === true,
      nativeArm: Boolean(p1.model?.userData?.nativeSpiderLegs)
    };
  });
  check('rematch after victory starts a fresh Iron Spider match',
    afterVictoryRematch.status === 'fighting'
      && afterVictoryRematch.p1 === 'Iron Spider' && afterVictoryRematch.p2 === 'Goku'
      && afterVictoryRematch.p1Percent === 0 && afterVictoryRematch.p2Percent === 0
      && afterVictoryRematch.p1Grounded && afterVictoryRematch.p1Meter === 0
      && afterVictoryRematch.result === ''
      && afterVictoryRematch.armVisible && afterVictoryRematch.nativeArm,
    JSON.stringify(afterVictoryRematch));
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-rematch-after-victory.png') });

  // ---- Separate defeat result --------------------------------------------
  // This is a best-of-three: one lost round starts the next round and clears damage. Force two
  // losses so the game's own KO/round/result path resolves a real DEFEAT, not a round reset.
  let defeat = { text: '', status: '', result: null };
  for (let round = 0; round < 2; round += 1) {
    await page.evaluate(() => {
      const p1 = window.fighters[0];
      window.__browserSmashTrainingDummy = false;
      p1.percent = 999;
      p1.ko = false;
      p1.invulnerable = 0;
    });
    for (let i = 0; i < 50; i += 1) {
      await page.evaluate(() => window.__browserSmashStep(0.2));
      defeat = await page.evaluate(() => ({
        text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
        status: window.__browserSmashMatch?.().status || '',
        result: window.__browserSmashLastResult || null,
        round: window.__browserSmashMatch?.().round || 0,
        p1: window.fighters?.[0] ? {
          percent: window.fighters[0].percent,
          ko: window.fighters[0].ko,
          defeated: window.fighters[0].forceDefeatPose === true
        } : null
      }));
      if (/DEFEAT|VICTORY|DRAW/i.test(defeat.text) && defeat.status === 'match-over') break;
      if (round === 0 && defeat.round > 1) break;
    }
    if (round === 0) {
      await page.waitForFunction(() => window.__browserSmashMatch?.().round > 1, null, { timeout: 10_000 });
      await page.evaluate(() => window.__browserSmashStep(0.5));
    }
  }
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-defeat.png') });
  check('Iron Spider reaches a real DEFEAT result',
    /DEFEAT\s*·\s*GOKU/i.test(defeat.text)
      && defeat.status === 'match-over'
      && defeat.result?.winner === 'p2'
      && defeat.result?.stats?.wins?.[0] === 0
      && defeat.result?.stats?.wins?.[1] === 2,
    JSON.stringify({ text: defeat.text, status: defeat.status, round: defeat.round, winner: defeat.result?.winner, wins: defeat.result?.stats?.wins, p1: defeat.p1 }));

  // ---- Separate rematch after defeat ------------------------------------
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting'
    && window.fighters?.[0]?.identity === 'Iron Spider'
    && window.fighters?.[0]?.characterModelLoaded === true
    && window.__browserSmashControlMode?.().started === true, null, { timeout: 30_000 });
  // The result curtain closes and the fresh round re-enters over a presentation hold. Waiting
  // only for status='fighting' can read state before that hold resets the fighters.
  await page.waitForFunction(() => {
    const loading = document.querySelector('#bbLoading');
    return Boolean(window.__browserSmashControlMode?.().started
      && (!loading || loading.hidden)
      && (window.__browserSmashFrames || 0) > 2);
  }, null, { timeout: 10_000 });
  await page.evaluate(() => { window.__browserSmashLastResult = null; });
  // The result curtain closes and the fresh round's entrance presentation owns the opening
  // seconds. Let that hold finish before poking percent, or the pending reset overwrites it.
  await page.evaluate(() => window.__browserSmashStep(4.0));
  const afterDefeatRematch = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const arm = p1.model?.getObjectByName?.('Object_122');
    return {
      status: window.__browserSmashMatch().status,
      p1: p1.identity, p2: p2.identity,
      p1Percent: p1.percent, p2Percent: p2.percent,
      p1Grounded: p1.isGrounded,
      p1Meter: p1.meter,
      result: (document.querySelector('#result')?.textContent || '').trim(),
      armVisible: arm?.visible === true,
      nativeArm: Boolean(p1.model?.userData?.nativeSpiderLegs)
    };
  });
  check('rematch after defeat starts a fresh Iron Spider match',
    afterDefeatRematch.status === 'fighting'
      && afterDefeatRematch.p1 === 'Iron Spider' && afterDefeatRematch.p2 === 'Goku'
      && afterDefeatRematch.p1Percent === 0 && afterDefeatRematch.p2Percent === 0
      && afterDefeatRematch.p1Grounded && afterDefeatRematch.p1Meter === 0
      && afterDefeatRematch.result === ''
      && afterDefeatRematch.armVisible && afterDefeatRematch.nativeArm,
    JSON.stringify(afterDefeatRematch));
  await page.screenshot({ path: resolve(artifacts, 'iron-spider-rematch-after-defeat.png') });

  check('no browser runtime errors during play', errors.length === 0, errors.join('\n'));
  check('no console errors during play', consoleErrors.length === 0, consoleErrors.join('\n'));
  check('no missing model requests', missingRequests.length === 0, missingRequests.join('\n'));

  await mkdir(resolve(artifacts, 'iron-spider'), { recursive: true });
  // Keep software and hardware evidence physically separate. Only a real hardware run may create
  // hardware-run.json; SwiftShader writes software-run.json and can never overwrite the hardware
  // acceptance record.
  const reportName = HARDWARE_GPU ? 'hardware-run.json' : 'software-run.json';
  await writeFile(resolve(artifacts, 'iron-spider', reportName), JSON.stringify({
    generatedAt: new Date().toISOString(),
    hardwareMode: HARDWARE_GPU,
    hardwareVerified: HARDWARE_GPU,
    evidenceClass: HARDWARE_GPU
      ? 'live-browser hardware-GPU acceptance'
      : 'live-browser software (headless Chromium/SwiftShader)',
    gpu, softwareRenderer,
    checks: results, passed: results.length, errors, consoleErrors, missingRequests
  }, null, 2));
  console.log('EVIDENCE ' + resolve(artifacts, 'iron-spider', reportName));
  console.log(`\nIron Spider test passed (${results.length} checks).`);
} finally {
  await browser?.close();
  server.close();
}
