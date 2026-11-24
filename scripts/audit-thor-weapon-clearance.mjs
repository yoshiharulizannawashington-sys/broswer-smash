// Thor's Stormbreaker clearance against the body, floor, stage walls and gameplay camera.
//
//   bash scripts/run-browser-test.sh scripts/audit-thor-weapon-clearance.mjs
//
// This is an audit only; it does not edit the carry, weapon or stage code. It stages Thor beside
// a Hogwarts nave column so the wall pass exercises real collision volumes, then samples idle,
// attacks and the landing. For every state it reports:
//   * cape: presence and clearance (the imported Thor rig has no cape mesh or cape bone)
//   * torso and legs: weapon vertices against bone capsules, with the deepest point/component
//   * floor: lowest weapon vertex against the stage ground
//   * walls: weapon vertices inside the camera solver's stage solids (columns/walls)
//   * gameplay camera: AABB gap, nearest vertex, view-space depth and near-plane crossing
// The camera is the live duel camera, not a test-only spectator shot.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/thor-weapon-clearance');
await mkdir(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const bytes = await readFile(resolve(root, relative));
    res.writeHead(200, { 'Content-Type': mime[extname(relative).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const thresholds = {
  bodyPenetration: 0.02,
  wallPenetration: 0.02,
  floorGap: -0.01,
  cameraGap: 0.05,
  cameraNearCross: 0
};
const report = {
  subject: 'Thor', generatedAt: new Date().toISOString(), thresholds,
  arena: null, stagePosition: null, cape: null, wallContext: null,
  scenarios: [], failures: [], worst: {}, pageErrors: [], consoleErrors: [],
  status: 'complete'
};

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => report.pageErrors.push(String(error?.stack || error)));
  page.on('console', message => {
    if (message.type() === 'error' && !/404 \(Not Found\)/.test(message.text())) {
      report.consoleErrors.push(message.text());
    }
  });
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
    } catch (error) {
      await route.fulfill({ status: 404, body: String(error?.message || error) });
    }
  });

  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 200 });
  await page.click('#menu [data-nav="versus"]');
  await page.waitForSelector('#selectScreen .bs-card', { state: 'visible' });
  await page.click('#selectScreen .bs-card[data-fighter="Thor"]');
  await page.click('#selectScreen .bs-card[data-fighter="Kaze"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="hogwarts"]');
  await page.evaluate(() => {
    window.__browserSmashSelect.setMode('2p');
    window.__browserSmashTrainingDummy = true;
  });
  await page.click('#play');
  await page.waitForFunction(() => {
    const f = window.fighters?.[0];
    const u = f?.model?.userData || {};
    return window.__browserSmashMatch().status === 'fighting'
      && /thor_rigged\.glb|\/thor\/thor\.glb|\/roster\/thor\.glb/.test(String(u.characterAssetUrl || ''))
      && u.equippedWeaponRight?.userData?.kind === 'stormbreaker'
      && u.rightHand && u.leftHand && u.head && u.torso && u.pelvis;
  }, null, { timeout: 180_000, polling: 250 });
  // Let the authored Hall and its camera volumes finish streaming before positioning Thor.
  await page.waitForFunction(() => window.__browserSmashWorld?.location === 'hogwarts',
    null, { timeout: 60_000, polling: 200 }).catch(() => {});

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  const state = () => page.evaluate(() => {
    const f = window.fighters[0];
    return {
      state: f.state, grounded: !!f.isGrounded,
      x: +f.position.x.toFixed(3), z: +f.position.z.toFixed(3),
      y: +f.position.y.toFixed(3), ground: +(f.groundLevel ?? 0).toFixed(3),
      speed: +Math.hypot(f.velocity.x, f.velocity.z).toFixed(3),
      attackPose: +(f.attackPose || 0).toFixed(3),
      casting: f.casting || null,
      weaponStowed: Boolean(f.weaponStowed),
      carry: f.model?.userData?.weaponCarry || null,
      cameraMode: window.smashCamera?.spectateState ? 'spectate' : 'gameplay',
      match: window.__browserSmashMatch().status
    };
  });

  const reset = async () => {
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      const ground = Number(p1.groundLevel) || 0;
      // The column is at x -20, z -32.1 with r 1.6. A 0.7 m hurtbox puts the legal limit at
      // x -17.7; use -17.69 so the wall pass is a real near-wall stress rather than an open-floor
      // idle. The body remains just outside the column while the hammer can reach the stone.
      p1.position.set(-17.69, ground, -32.1);
      p2.position.set(-14.69, ground, -32.1);
      p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
      p1.facing = -1; p1.facingZ = 0; p2.facing = 1; p2.facingZ = 0;
      for (const f of [p1, p2]) {
        f.attackQueue.length = 0;
        f.hitstun = 0;
        f.guardBreak = 0;
        f.guardHeld = false;
        f.dodgeTimer = 0;
        f.weaponStowed = false;
        f.isGrounded = true;
        f.casting = null;
      }
      window.smashCamera?.snap?.();
    });
    await step(0.55);
  };

  const measure = () => page.evaluate(() => {
    const f = window.fighters[0];
    const u = f.model.userData;
    const weapon = u.equippedWeaponRight;
    if (!weapon) return { error: 'Thor has no equippedWeaponRight' };
    const V = weapon.position.constructor;
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const clamp = (p, min, max) => p.map((value, i) => Math.max(min[i], Math.min(max[i], value)));
    const pointSegment = (p, a, b) => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const denom = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      const t = denom ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / denom)) : 0;
      return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
    };
    const world = bone => {
      if (!bone) return null;
      bone.updateWorldMatrix(true, false);
      const e = bone.matrixWorld.elements;
      return [e[12], e[13], e[14]];
    };

    f.model.updateMatrixWorld(true, true);
    weapon.updateWorldMatrix(true, true);

    const nodes = [];
    const points = [], names = [];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let componentCount = 0;
    weapon.traverse(node => {
      const attr = node.geometry?.attributes?.position;
      if (!attr) return;
      nodes.push(node);
      node.updateWorldMatrix(true, false);
      const v = new V();
      const stride = Math.max(1, Math.floor(attr.count / 800));
      for (let i = 0; i < attr.count; i += stride) {
        v.fromBufferAttribute(attr, i);
        if (node.isSkinnedMesh) node.applyBoneTransform?.(i, v);
        node.localToWorld(v);
        points.push([v.x, v.y, v.z]);
        names.push(node.name || '');
        for (let axis = 0; axis < 3; axis += 1) {
          const value = [v.x, v.y, v.z][axis];
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
      componentCount += 1;
    });
    if (!points.length) return { error: 'Thor weapon exposes no geometry points' };

    const pelvis = world(u.pelvis), torso = world(u.torso), neck = world(u.neck);
    const head = world(u.head);
    const rightHand = world(u.rightHand), rightFore = world(u.rightFore);
    const leftLeg = world(u.leftLeg), leftShin = world(u.leftShin), leftFoot = world(u.leftFoot);
    const rightLeg = world(u.rightLeg), rightShin = world(u.rightShin), rightFoot = world(u.rightFoot);
    const bodyCapsules = [];
    if (pelvis && torso) bodyCapsules.push({ part: 'torso', a: pelvis, b: torso, radius: 0.24 });
    if (pelvis) bodyCapsules.push({ part: 'torso', a: pelvis, b: pelvis, radius: 0.20 });
    if (torso && neck) bodyCapsules.push({ part: 'torso', a: torso, b: neck, radius: 0.18 });
    if (neck && head) bodyCapsules.push({ part: 'head', a: neck, b: head, radius: 0.16 });
    if (leftLeg && leftShin) bodyCapsules.push({ part: 'left-leg', a: leftLeg, b: leftShin, radius: 0.15 });
    if (leftShin && leftFoot) bodyCapsules.push({ part: 'left-leg', a: leftShin, b: leftFoot, radius: 0.12 });
    if (leftFoot) bodyCapsules.push({ part: 'left-leg', a: leftFoot, b: leftFoot, radius: 0.10 });
    if (rightLeg && rightShin) bodyCapsules.push({ part: 'right-leg', a: rightLeg, b: rightShin, radius: 0.15 });
    if (rightShin && rightFoot) bodyCapsules.push({ part: 'right-leg', a: rightShin, b: rightFoot, radius: 0.12 });
    if (rightFoot) bodyCapsules.push({ part: 'right-leg', a: rightFoot, b: rightFoot, radius: 0.10 });

    // The grip is held in the hand; exclude only the hand/forearm attachment regions from body
    // contact, matching the existing carry audit's 16 cm / 12 cm grip exclusion.
    const isGrip = point => (rightHand && dist(point, rightHand) < 0.16)
      || (rightFore && dist(point, rightFore) < 0.12);
    const body = { parts: {}, worst: { depth: 0, part: null, component: null }, excludedPoints: 0 };
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      if (isGrip(point)) { body.excludedPoints += 1; continue; }
      for (const capsule of bodyCapsules) {
        const depth = capsule.radius - pointSegment(point, capsule.a, capsule.b);
        if (depth > 0) {
          const previous = body.parts[capsule.part] || { depth: 0, vertices: 0, component: null };
          body.parts[capsule.part] = {
            depth: Math.max(previous.depth, depth),
            vertices: previous.vertices + 1,
            component: depth > previous.depth ? names[i] || null : previous.component
          };
        }
        if (depth > body.worst.depth) {
          body.worst = { depth: depth, part: capsule.part, component: names[i] || null,
            point: point.map(v => +v.toFixed(3)) };
        }
      }
    }
    for (const part of Object.keys(body.parts)) {
      body.parts[part].depth = +body.parts[part].depth.toFixed(3);
    }
    body.worst.depth = +body.worst.depth.toFixed(3);

    // The live duel camera, not the spectator helper.
    const camera = window.__browserSmashCamera;
    const cameraInfo = { mode: window.smashCamera?.spectateState ? 'spectate' : 'gameplay' };
    if (camera?.position) {
      camera.updateMatrixWorld(true);
      const camPos = camera.getWorldPosition(new V()).toArray();
      const near = camera.near;
      const boxGap = dist(camPos, clamp(camPos, min, max));
      const vertexGap = Math.min(...points.map(point => dist(point, camPos)));
      let nearCrossings = 0, behind = 0, minDepth = Infinity;
      for (const point of points) {
        const view = new V(point[0], point[1], point[2]).applyMatrix4(camera.matrixWorldInverse);
        if (view.z >= 0) { behind += 1; continue; }
        const depth = -view.z;
        minDepth = Math.min(minDepth, depth);
        if (depth < near) nearCrossings += 1;
      }
      Object.assign(cameraInfo, {
        position: camPos.map(v => +v.toFixed(3)),
        near: +near.toFixed(3),
        boxGap: +boxGap.toFixed(3),
        vertexGap: +vertexGap.toFixed(3),
        minDepth: Number.isFinite(minDepth) ? +minDepth.toFixed(3) : null,
        nearCrossings,
        behind,
        insideWeaponBox: boxGap <= 1e-4
      });
    } else {
      cameraInfo.available = false;
    }

    // Stage solids are the same collision volumes the camera solver uses. Table tops are below
    // head height and are excluded; columns and walls remain.
    const blocks = (window.smashCamera?.collisionBlocks || [])
      .map((block, index) => ({ ...block, index }))
      .filter(block => Number.isFinite(block.top) && block.top > 2);
    const blockDepth = (point, block) => {
      const bottom = Number.isFinite(block.bottom) ? block.bottom : -Infinity;
      if (point[1] < bottom || point[1] > block.top) return null;
      if (block.r != null) {
        const d = Math.hypot(point[0] - block.x, point[2] - block.z);
        if (d > block.r) return null;
        return Math.min(block.r - d, point[1] - bottom, block.top - point[1]);
      }
      if (point[0] < block.x0 || point[0] > block.x1
        || point[2] < block.z0 || point[2] > block.z1) return null;
      return Math.min(point[0] - block.x0, block.x1 - point[0],
        point[2] - block.z0, block.z1 - point[2], point[1] - bottom, block.top - point[1]);
    };
    const blockGap = (point, block) => {
      const bottom = Number.isFinite(block.bottom) ? block.bottom : -Infinity;
      if (block.r != null) {
        const horizontal = Math.max(0, Math.hypot(point[0] - block.x, point[2] - block.z) - block.r);
        const vertical = point[1] < bottom ? bottom - point[1] : point[1] > block.top ? point[1] - block.top : 0;
        return Math.hypot(horizontal, vertical);
      }
      const dx = point[0] < block.x0 ? block.x0 - point[0] : point[0] > block.x1 ? point[0] - block.x1 : 0;
      const dz = point[2] < block.z0 ? block.z0 - point[2] : point[2] > block.z1 ? point[2] - block.z1 : 0;
      const dy = point[1] < bottom ? bottom - point[1] : point[1] > block.top ? point[1] - block.top : 0;
      return Math.hypot(dx, dy, dz);
    };
    const walls = { available: blocks.length > 0, blockCount: blocks.length,
      intersecting: 0, worst: { depth: 0, block: null, component: null, point: null },
      nearest: { gap: Infinity, block: null, component: null, point: null } };
    for (let i = 0; i < points.length; i += 1) {
      for (const block of blocks) {
        const depth = blockDepth(points[i], block);
        if (depth && depth > 0) {
          walls.intersecting += 1;
          if (depth > walls.worst.depth) {
            walls.worst = { depth: depth, block: block.index, component: names[i] || null,
              kind: block.r != null ? 'cylinder' : 'box',
              center: block.r != null ? [+block.x.toFixed(2), +block.z.toFixed(2)] : null,
              point: points[i].map(v => +v.toFixed(3)) };
          }
        }
        const gap = blockGap(points[i], block);
        if (gap < walls.nearest.gap) {
          walls.nearest = { gap: gap, block: block.index, component: names[i] || null,
            kind: block.r != null ? 'cylinder' : 'box',
            center: block.r != null ? [+block.x.toFixed(2), +block.z.toFixed(2)] : null,
            point: points[i].map(v => +v.toFixed(3)) };
        }
      }
    }
    walls.worst.depth = +walls.worst.depth.toFixed(3);
    walls.nearest.gap = Number.isFinite(walls.nearest.gap) ? +walls.nearest.gap.toFixed(3) : null;

    // The imported Thor GLB has one body mesh and no separate cape/cloak mesh or cape bone.
    const capeMeshes = [], capeBones = [];
    f.model.traverse(node => {
      if (node.isMesh && /cape|cloak|robe/i.test(`${node.name || ''} ${node.material?.name || ''}`)) capeMeshes.push(node.name);
      if (node.isBone && /cape|cloak|robe/i.test(node.name || '')) capeBones.push(node.name);
    });
    const cape = {
      present: capeMeshes.length > 0,
      meshCount: capeMeshes.length,
      boneCount: capeBones.length,
      meshes: capeMeshes,
      bones: capeBones
    };
    if (!cape.present) {
      cape.reason = 'thor_rigged.glb has no separately identifiable cape/cloak mesh and no cape bone; the imported body is one undifferentiated skinned mesh, so cape clearance cannot be isolated';
      cape.limitation = 'not measured as a pass; the procedural fallback cape is not the live model';
    }

    const floorY = Number.isFinite(f.groundLevel) ? f.groundLevel : (f.position?.y || 0);
    const lowestIndex = points.reduce((best, point, index) => point[1] < points[best][1] ? index : best, 0);
    const floor = {
      groundY: +floorY.toFixed(3),
      minY: +min[1].toFixed(3),
      gap: +(min[1] - floorY).toFixed(3),
      component: names[lowestIndex] || null,
      point: points[lowestIndex].map(v => +v.toFixed(3))
    };

    return {
      state: f.state,
      cameraMode: cameraInfo.mode,
      weapon: {
        kind: u.weaponKind || null, label: u.weaponLabel || null,
        stowed: Boolean(f.weaponStowed), visible: weapon.visible !== false, nodes: nodes.length,
        sampledPoints: points.length, components: componentCount,
        bounds: { min: min.map(v => +v.toFixed(3)), max: max.map(v => +v.toFixed(3)) }
      },
      body, cape, floor, walls, camera: cameraInfo,
      clearance: u.weaponCarryClearance || null,
      carry: u.weaponCarry || null
    };
  });

  const stepUntilState = (target, maxSeconds = 1) => page.evaluate(({ target, maxSeconds }) => {
    const dt = 1 / 60;
    let last = null;
    for (let elapsed = 0; elapsed <= maxSeconds; elapsed += dt) {
      window.__browserSmashStep(dt);
      const f = window.fighters[0];
      last = { state: f.state, grounded: !!f.isGrounded, attackPose: +(f.attackPose || 0).toFixed(3) };
      if (f.state === target) { window.__browserSmashSetPaused(true); break; }
    }
    return last;
  }, { target, maxSeconds });

  const aggregateSamples = samples => {
    const first = samples[0].measured;
    const aggregate = {
      state: first.state, cameraMode: first.cameraMode, weapon: first.weapon,
      cape: first.cape, clearance: first.clearance, carry: first.carry,
      body: { parts: {}, worst: { depth: 0, part: null, component: null }, excludedPoints: 0 },
      floor: null, walls: null, camera: null, sampledFrames: samples.length
    };
    for (const sample of samples) {
      const m = sample.measured;
      if (!m || m.error) continue;
      const at = { frame: sample.frame, state: sample.observed.state };
      for (const [part, value] of Object.entries(m.body?.parts || {})) {
        const previous = aggregate.body.parts[part];
        if (!previous || value.depth > previous.depth) {
          aggregate.body.parts[part] = { ...value, ...at };
        }
      }
      if ((m.body?.worst?.depth || 0) > aggregate.body.worst.depth) {
        aggregate.body.worst = { ...m.body.worst, ...at };
      }
      aggregate.body.excludedPoints = Math.max(aggregate.body.excludedPoints, m.body?.excludedPoints || 0);
      if (!aggregate.floor || m.floor.gap < aggregate.floor.gap) aggregate.floor = { ...m.floor, ...at };
      if (m.walls?.available) {
        if (!aggregate.walls) {
          aggregate.walls = { ...m.walls, framesWithIntersection: m.walls.worst.depth > 0 ? 1 : 0 };
        } else {
          if (m.walls.worst.depth > aggregate.walls.worst.depth) {
            aggregate.walls.worst = { ...m.walls.worst, ...at };
          }
          if (m.walls.nearest.gap < aggregate.walls.nearest.gap) {
            aggregate.walls.nearest = { ...m.walls.nearest, ...at };
          }
          aggregate.walls.intersecting = Math.max(aggregate.walls.intersecting, m.walls.intersecting);
          aggregate.walls.framesWithIntersection += m.walls.worst.depth > 0 ? 1 : 0;
        }
      }
      const camera = m.camera;
      if (!aggregate.camera
        || (camera.boxGap != null && camera.boxGap < aggregate.camera.boxGap)
        || (camera.nearCrossings || 0) > (aggregate.camera.nearCrossings || 0)) {
        aggregate.camera = { ...camera, ...at };
      }
    }
    return aggregate;
  };

  const capture = async (id, category, note, expectedState = null,
    { frames = 6, stepSeconds = 1 / 60 } = {}) => {
    await page.evaluate(() => window.__browserSmashSetPaused(true));
    const observed = await state();
    const samples = [];
    for (let frame = 0; frame < frames; frame += 1) {
      const frameObserved = await state();
      // A state-end is part of the action, but do not sample a wholly different state as if it
      // were the requested pose. Idle/signature/ultimate have no expected state and use the full
      // window; light/heavy stop at their recovery boundary.
      if (expectedState && frame > 0 && frameObserved.state !== expectedState) break;
      const frameMeasured = await measure();
      samples.push({ frame, observed: frameObserved, measured: frameMeasured });
      if (frame === frames - 1) break;
      await page.evaluate(() => window.__browserSmashSetPaused(false));
      await step(stepSeconds);
      await page.evaluate(() => window.__browserSmashSetPaused(true));
    }
    await page.evaluate(() => window.__browserSmashSetPaused(false));
    const measured = aggregateSamples(samples);
    const entry = { id, category, note, expectedState, observed,
      observedEnd: samples.at(-1)?.observed || null, frameCount: samples.length, samples, measured };
    report.scenarios.push(entry);
    console.log('STATE ' + id + ' ' + JSON.stringify({
      frames: samples.length, state: observed.state, camera: measured.camera?.mode,
      body: measured.body && { worst: measured.body.worst, parts: measured.body.parts },
      cape: measured.cape && { present: measured.cape.present, reason: measured.cape.reason || null },
      floor: measured.floor,
      walls: measured.walls && { available: measured.walls.available,
        worst: measured.walls.worst, nearest: measured.walls.nearest },
      camera: measured.camera
    }));
    return entry;
  };

  await reset();
  await step(0.4);
  await capture('idle', 'idle', 'settled idle beside a nave column', null, { frames: 8 });

  await reset();
  await page.keyboard.press('j');
  await stepUntilState('attack-active', 0.8);
  await page.evaluate(() => window.__browserSmashSetPaused(false));
  await step(0.06);
  await capture('light-attack', 'attack', 'J active, settled pose', 'attack-active', { frames: 8 });

  await reset();
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.press('j');
  await stepUntilState('attack-active', 1.0);
  await page.evaluate(() => window.__browserSmashSetPaused(false));
  await step(0.06);
  await capture('heavy-attack', 'attack', 'Shift+J active, settled pose', 'attack-active', { frames: 8 });
  await page.keyboard.up('ShiftLeft');

  await reset();
  await page.keyboard.press('k');
  await step(0.16);
  await capture('signature', 'attack', 'K signature active', null, { frames: 10 });
  await step(0.7);

  await reset();
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.meter = 100;
    f.casting = null;
    f.attackQueue.length = 0;
    f.weaponStowed = false;
  });
  await page.keyboard.press('o');
  await step(0.08);
  await capture('ultimate-startup', 'attack', 'O ultimate startup', null, { frames: 8 });
  await step(0.55);
  await capture('ultimate-active', 'attack', 'O ultimate active', null, { frames: 10 });
  await step(0.55);
  await capture('ultimate-recovery', 'attack', 'O ultimate recovery', null, { frames: 10 });

  await reset();
  await page.keyboard.press('Space');
  await step(0.5);
  await capture('jump-apex', 'landing', 'Space apex before touchdown', null, { frames: 6 });
  const landed = await page.evaluate(() => {
    let airborne = false;
    for (let i = 0; i < 180; i += 1) {
      window.__browserSmashStep(1 / 60);
      const f = window.fighters[0];
      if (!f.isGrounded) airborne = true;
      if (airborne && f.isGrounded) { window.__browserSmashSetPaused(true); return true; }
    }
    return false;
  });
  await capture('landing', 'landing', landed ? 'first grounded frame after airborne' : 'no landing detected');

  const fail = (entry, type, detail) => {
    const failure = { ...detail, state: entry.id, category: entry.category, type };
    entry.failures = entry.failures || [];
    entry.failures.push(failure);
    report.failures.push(failure);
  };

  const worst = {
    torso: { depth: 0 }, legs: { depth: 0 }, head: { depth: 0 },
    floor: { gap: Infinity }, walls: { depth: 0, nearestGap: Infinity },
    camera: { boxGap: Infinity }
  };
  const better = (value, current) => Number.isFinite(value) && value < current;

  for (const entry of report.scenarios) {
    const m = entry.measured;
    if (m.error) { fail(entry, 'measurement', { error: m.error }); continue; }
    if (entry.expectedState && entry.observed.state !== entry.expectedState) {
      fail(entry, 'scenario', { expectedState: entry.expectedState, actualState: entry.observed.state });
    }
    const bodyParts = m.body.parts || {};
    const torsoDepth = Math.max(bodyParts.torso?.depth || 0, 0);
    const legDepth = Math.max(bodyParts['left-leg']?.depth || 0, bodyParts['right-leg']?.depth || 0, 0);
    const headDepth = Math.max(bodyParts.head?.depth || 0, 0);
    if (torsoDepth > thresholds.bodyPenetration) {
      fail(entry, 'torso-penetration', { depth: torsoDepth, part: bodyParts.torso,
        limit: thresholds.bodyPenetration });
    }
    if (legDepth > thresholds.bodyPenetration) {
      fail(entry, 'leg-penetration', { depth: legDepth,
        left: bodyParts['left-leg'] || null, right: bodyParts['right-leg'] || null,
        limit: thresholds.bodyPenetration });
    }
    if (headDepth > thresholds.bodyPenetration) {
      fail(entry, 'head-penetration', { depth: headDepth, part: bodyParts.head,
        limit: thresholds.bodyPenetration });
    }
    if (m.floor.gap < thresholds.floorGap) {
      fail(entry, 'floor-penetration', m.floor);
    }
    if (m.walls?.available && m.walls.worst.depth > thresholds.wallPenetration) {
      fail(entry, 'wall-penetration', { ...m.walls.worst, limit: thresholds.wallPenetration });
    }
    const camera = m.camera || {};
    const cameraCross = camera.nearCrossings || 0;
    if ((camera.boxGap != null && camera.boxGap < thresholds.cameraGap)
      || cameraCross > thresholds.cameraNearCross || camera.insideWeaponBox) {
      fail(entry, 'camera-intersection', { boxGap: camera.boxGap, nearCrossings: cameraCross,
        insideWeaponBox: !!camera.insideWeaponBox, limit: thresholds.cameraGap });
    }

    // Aggregate the worst state per requested category.
    for (const [key, depth] of [['torso', torsoDepth], ['legs', legDepth], ['head', headDepth]]) {
      if (depth > worst[key].depth) {
        worst[key] = { depth, state: entry.id, part: key,
          components: key === 'torso' ? bodyParts.torso?.component
            : key === 'legs' ? (legDepth === bodyParts['left-leg']?.depth ? 'left' : 'right')
              : bodyParts.head?.component };
      }
    }
    if (better(m.floor.gap, worst.floor.gap)) worst.floor = { ...m.floor, state: entry.id };
    if (m.walls?.available && m.walls.worst.depth > worst.walls.depth) {
      worst.walls = { ...worst.walls, ...m.walls.worst, state: entry.id };
    }
    if (m.walls?.available && Number.isFinite(m.walls.nearest.gap)
      && m.walls.nearest.gap < worst.walls.nearestGap) {
      worst.walls = { ...worst.walls, nearestGap: m.walls.nearest.gap,
        nearestState: entry.id, nearest: m.walls.nearest };
    }
    if (camera.boxGap != null && better(camera.boxGap, worst.camera.boxGap)) {
      worst.camera = { ...camera, state: entry.id };
    }
    entry.worst = { torso: torsoDepth, legs: legDepth, head: headDepth, floor: m.floor.gap,
      wall: m.walls?.worst?.depth ?? null, camera: camera.boxGap ?? null };
  }

  report.cape = report.scenarios[0]?.measured?.cape || {
    present: false, reason: 'cape measurement unavailable'
  };
  report.arena = 'hogwarts';
  report.stagePosition = report.scenarios[0]?.observed ? {
    x: -17.69, z: -32.1, note: 'west nave column at x -20, z -32.1, r 1.6; Thor hurtbox 0.7 m, body edge 0.01 m short of the column'
  } : null;
  report.worst = worst;
  report.wallContext = (() => {
    const entry = report.scenarios[0];
    const nearest = report.worst.walls?.nearest ? {
      ...report.worst.walls.nearest,
      state: report.worst.walls.nearestState || report.worst.walls.nearest.state
    } : null;
    return entry?.measured?.walls ? {
      available: entry.measured.walls.available,
      blockCount: entry.measured.walls.blockCount,
      worst: report.worst.walls || null,
      nearest,
      note: 'camera-solver stage solids above 2 m; tables and floor are excluded'
    } : null;
  })();
  report.status = report.failures.length || report.pageErrors.length || report.consoleErrors.length
    ? 'failed' : 'complete';
  console.log('SUMMARY ' + JSON.stringify({
    status: report.status, states: report.scenarios.length, failures: report.failures.length,
    failuresByType: report.failures.reduce((out, failure) => {
      out[failure.type] = (out[failure.type] || 0) + 1; return out;
    }, {}), worst: report.worst, cape: report.cape, wallContext: report.wallContext
  }, null, 2));
} catch (error) {
  report.status = 'failed';
  report.error = String(error?.stack || error);
  console.error(report.error);
} finally {
  await browser.close();
  server.close();
  await writeFile(resolve(outDir, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
}
if (report.status !== 'complete') process.exitCode = 1;
