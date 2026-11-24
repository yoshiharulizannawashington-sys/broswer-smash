// Thor's carry across idle, movement, attacks, landings and transitions.
//
//   bash scripts/run-browser-test.sh scripts/audit-thor-carry-states.mjs
//
// This is an audit only; it never edits the carry policy. Each state is reached through the real
// input path and one fixed step, then frozen while the transform is read. The report checks:
//   * both hands against the authored wooden haft (10 cm contact threshold)
//   * axial haft position (normalized along the shaft, 0..1)
//   * palm orientation from the hand bone's across-palm / finger / palm-normal axes
//   * wrist bend and twist relative to the forearm
//   * finger wrap, reported as unsupported because this rig has no finger bones
//   * prop orientation relative to Thor's facing and world up
//   * body, floor and camera clearance reported by weapon_carry.js.
// A state fails when an expected hand is off the haft or outside the shaft, when the haft does not
// cross the palm within 60 degrees, when the wrist bends/twists past its limit, when an idle/movement/
// landing prop points behind the body or head-below-hand, when mesh clearance penetrates the body or
// floor past its threshold, or when the right hand slides more than 15% of the haft across states.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/thor-carry-states');
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
  handToHaft: 0.10,
  slideRange: 0.15,
  // weaponCarryClearance.bodyGap subtracts the head/torso safety radii from a box gap, so a
  // negative value is common for a hand-held prop. Clearance failures use actual mesh vertices
  // against body capsules instead; the reported bodyGap is retained for comparison.
  bodyPenetration: 0.02,
  floorGap: -0.01,
  cameraGap: 0.05,
  orientationDotForward: 0,
  haftUpDot: -0.35,
  // The haft should cross the palm, not run through the palm normal or along the fingers.
  palmAcrossMaxDeg: 60,
  wristBendMaxDeg: 50,
  wristTwistMaxDeg: 40
};
const report = {
  subject: 'Thor', generatedAt: new Date().toISOString(), thresholds,
  scenarios: [], failures: [], pageErrors: [], consoleErrors: [],
  axialSlide: null, status: 'complete'
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
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
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
      && u.rightHand && u.leftHand && u.head && u.torso;
  }, null, { timeout: 180_000, polling: 250 });

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  const state = () => page.evaluate(() => {
    const f = window.fighters[0];
    const u = f.model?.userData || {};
    return {
      state: f.state, grounded: !!f.isGrounded,
      y: +f.position.y.toFixed(3),
      speed: +Math.hypot(f.velocity.x, f.velocity.z).toFixed(3),
      attackPose: +(f.attackPose || 0).toFixed(3),
      casting: f.casting || null,
      dodgeTimer: +(f.dodgeTimer || 0).toFixed(3),
      dashTimer: +(f.dashTimer || 0).toFixed(3),
      queue: (f.attackQueue || []).map(a => a.label || a.type || 'attack'),
      stowed: Boolean(f.weaponStowed),
      carry: u.weaponCarry || null,
      match: window.__browserSmashMatch().status
    };
  });

  const reset = async () => {
    await page.evaluate(() => window.__browserSmashSetPaused(false));
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p1.position.set(0, p1.groundLevel || 0, 0);
      p2.position.set(1.65, p2.groundLevel || 0, 0);
      p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
      p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
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
      window.smashCamera?.spectate?.({ fighter: p1, framing: 'full', distance: 3.4, yaw: 38, pitch: 4 });
    });
    await step(0.45);
  };

  const measure = () => page.evaluate(() => {
    const f = window.fighters[0];
    const u = f.model.userData;
    const weapon = u.equippedWeaponRight;
    if (!weapon) return { error: 'Thor has no equippedWeaponRight' };
    f.model.updateMatrixWorld(true, true);
    weapon.updateWorldMatrix(true, true);
    const V = weapon.position.constructor;
    const world = bone => {
      if (!bone) return null;
      bone.updateWorldMatrix(true, false);
      const e = bone.matrixWorld.elements;
      return [e[12], e[13], e[14]];
    };
    const allNodes = [];
    const namedHaft = [];
    weapon.traverse(node => {
      const attr = node.geometry?.attributes?.position;
      if (!attr) return;
      allNodes.push(node);
      if (/haft|handle|grip|shaft/i.test(node.name || '')) namedHaft.push(node);
    });
    const haftNodes = namedHaft.length ? namedHaft : allNodes;
    const sample = (nodes, limit) => {
      const points = [], names = [];
      for (const node of nodes) {
        const attr = node.geometry.attributes.position;
        node.updateWorldMatrix(true, false);
        const v = new V();
        const stride = Math.max(1, Math.floor(attr.count / limit));
        for (let i = 0; i < attr.count; i += stride) {
          v.fromBufferAttribute(attr, i);
          if (node.isSkinnedMesh) node.applyBoneTransform?.(i, v);
          node.localToWorld(v);
          points.push([v.x, v.y, v.z]);
          names.push(node.name || '');
        }
      }
      return { points, names };
    };
    const haftSample = sample(haftNodes, 400);
    const points = haftSample.points;
    const allSample = sample(allNodes, 600);
    const allPoints = allSample.points;
    if (!points.length || !allPoints.length) return { error: 'Thor weapon exposes no geometry points' };
    const e = weapon.matrixWorld.elements;
    const origin = new V(e[12], e[13], e[14]);
    const haftAxis = new V(e[4], e[5], e[6]).normalize();
    const zAxis = new V(e[8], e[9], e[10]).normalize();
    const projections = points.map(p => {
      const d = new V(p[0] - origin.x, p[1] - origin.y, p[2] - origin.z);
      return d.dot(haftAxis);
    });
    const min = Math.min(...projections);
    const max = Math.max(...projections);
    const length = max - min;
    const yaw = f.model.rotation.y;
    const forward = [Math.sin(yaw), 0, Math.cos(yaw)];
    const head = world(u.head), torso = world(u.torso), pelvis = world(u.pelvis);
    const rightHandWorld = world(u.rightHand), rightForeWorld = world(u.rightFore);
    const pointSegment = (p, a, b) => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const denom = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      const t = denom ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / denom)) : 0;
      return Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t), p[2] - (a[2] + ab[2] * t));
    };
    const capsules = [];
    if (head && torso) capsules.push({ part: 'head', a: torso, b: head, radius: 0.16 });
    if (torso && pelvis) capsules.push({ part: 'torso', a: pelvis, b: torso, radius: 0.24 });
    if (pelvis) capsules.push({ part: 'pelvis', a: pelvis, b: pelvis, radius: 0.20 });
    // Exclude the grip assembly itself from body clearance. The socket around the hand can be a
    // few centimetres inside the conservative torso capsule without the head or haft entering the
    // body; a larger radius avoids calling the grip a body intersection.
    const isGrip = point => (rightHandWorld && Math.hypot(point[0] - rightHandWorld[0],
      point[1] - rightHandWorld[1], point[2] - rightHandWorld[2]) < 0.16)
      || (rightForeWorld && Math.hypot(point[0] - rightForeWorld[0],
        point[1] - rightForeWorld[1], point[2] - rightForeWorld[2]) < 0.12);
    let bodyPenetration = 0, bodyPart = null, bodyComponent = null;
    const bodyParts = {};
    for (let i = 0; i < allPoints.length; i += 1) {
      const point = allPoints[i];
      if (isGrip(point)) continue;
      for (const capsule of capsules) {
        const depth = capsule.radius - pointSegment(point, capsule.a, capsule.b);
        if (depth > bodyPenetration) {
          bodyPenetration = depth; bodyPart = capsule.part; bodyComponent = allSample.names[i] || null;
        }
        if (depth > 0) {
          const previous = bodyParts[capsule.part] || { depth: 0, vertices: 0 };
          bodyParts[capsule.part] = { depth: Math.max(previous.depth, depth),
            vertices: previous.vertices + 1 };
        }
      }
    }
    for (const key of Object.keys(bodyParts)) bodyParts[key].depth = +bodyParts[key].depth.toFixed(3);
    const minAll = [0, 1, 2].map(axis => Math.min(...allPoints.map(point => point[axis])));
    const maxAll = [0, 1, 2].map(axis => Math.max(...allPoints.map(point => point[axis])));
    const camera = window.__browserSmashCamera;
    const clampedCamera = camera?.position ? camera.position.clone().clamp(
      new V(minAll[0], minAll[1], minAll[2]), new V(maxAll[0], maxAll[1], maxAll[2])) : null;
    const cameraGap = camera?.position && clampedCamera
      ? +camera.position.distanceTo(clampedCamera).toFixed(3) : null;
    const floorGap = +(minAll[1] - (f.position?.y || 0)).toFixed(3);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const scale = (a, value) => [a[0] * value, a[1] * value, a[2] * value];
    const normalize3 = a => { const n = Math.hypot(...a) || 1; return scale(a, 1 / n); };
    const angleDeg = (a, b) => +(Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI).toFixed(1);
    const acuteDeg = (a, b) => +(Math.acos(Math.min(1, Math.abs(dot(a, b)))) * 180 / Math.PI).toFixed(1);
    const projectPerp = (v, axis) => sub(v, scale(axis, dot(v, axis)));
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const boneFrame = bone => {
      if (!bone) return null;
      bone.updateWorldMatrix(true, false);
      const m = bone.matrixWorld.elements;
      return {
        position: [m[12], m[13], m[14]],
        x: normalize3([m[0], m[1], m[2]]),
        y: normalize3([m[4], m[5], m[6]]),
        z: normalize3([m[8], m[9], m[10]])
      };
    };
    const hands = {};
    for (const side of ['left', 'right']) {
      const handBone = u[side + 'Hand'] || null;
      const foreBone = u[side + 'Fore'] || null;
      const handFrame = boneFrame(handBone);
      const foreFrame = boneFrame(foreBone);
      const hand = handFrame?.position || null;
      let toHaft = null;
      let slide = null;
      if (hand) {
        let nearest = Infinity;
        for (const point of points) {
          const d = Math.hypot(hand[0] - point[0], hand[1] - point[1], hand[2] - point[2]);
          if (d < nearest) nearest = d;
        }
        toHaft = +nearest.toFixed(3);
        if (length > 1e-5) {
          const d = new V(hand[0] - origin.x, hand[1] - origin.y, hand[2] - origin.z);
          slide = +((d.dot(haftAxis) - min) / length).toFixed(3);
        }
      }
      let palm = null;
      let wrist = null;
      if (handFrame) {
        // The imported Thor rig has no finger or palm bones. These are the hand bone's own axes:
        // +Y runs from wrist toward the fingers, +Z is the authored palm normal, and +X runs
        // across the palm. The values are reported so the axis assumption is auditable.
        const fingerToHaftDeg = angleDeg(handFrame.y, haftAxis.toArray());
        const palmNormalToHaftDeg = angleDeg(handFrame.z, haftAxis.toArray());
        const haftAcrossPalmDeg = acuteDeg(haftAxis.toArray(), handFrame.x);
        palm = {
          axes: { x: handFrame.x, y: handFrame.y, z: handFrame.z },
          fingerToHaftDeg,
          palmNormalToHaftDeg,
          haftAcrossPalmDeg,
          fingerDotHaft: +Math.abs(dot(handFrame.y, haftAxis.toArray())).toFixed(3),
          palmNormalDotHaft: +Math.abs(dot(handFrame.z, haftAxis.toArray())).toFixed(3),
          haftAcrossPalmDot: +Math.abs(dot(handFrame.x, haftAxis.toArray())).toFixed(3)
        };
        if (foreFrame) {
          const foreDirection = normalize3(sub(handFrame.position, foreFrame.position));
          const foreX = projectPerp(foreFrame.x, foreDirection);
          const handX = projectPerp(handFrame.x, foreDirection);
          const twist = Math.atan2(dot(cross(foreX, handX), foreDirection), dot(foreX, handX));
          wrist = {
            foreDirection,
            bendDeg: angleDeg(foreDirection, handFrame.y),
            twistDeg: +(twist * 180 / Math.PI).toFixed(1),
            foreToHaftDeg: angleDeg(foreDirection, haftAxis.toArray())
          };
        }
      }
      hands[side] = {
        position: hand, toHaft, slide, onHaft: toHaft !== null && toHaft <= 0.10,
        palm, wrist,
        // No finger/thumb joints are present in thor_rigged.glb (24 nodes total), so a finger
        // curl or wrap cannot be measured. The contact and palm orientation stay measurable.
        fingerWrap: { supported: false,
          reason: 'Thor rig has no finger or thumb bones; only Hand and ForeArm joints exist' }
      };
    }
    return {
      state: f.state,
      stowed: Boolean(f.weaponStowed),
      carry: u.weaponCarry || null,
      weapon: {
        kind: u.weaponKind || null, label: u.weaponLabel || null,
        parent: weapon.parent?.name || null,
        visible: weapon.visible !== false,
        scale: +weapon.scale.x.toFixed(3)
      },
      haft: {
        nodeCount: haftNodes.length,
        namedNodeCount: namedHaft.length,
        points: points.length,
        axis: haftAxis.toArray().map(v => +v.toFixed(3)),
        length: +length.toFixed(3),
        min: +min.toFixed(3),
        max: +max.toFixed(3)
      },
      hands,
      bothHandsOnHaft: hands.left.onHaft && hands.right.onHaft,
      offhand: {
        side: 'left',
        toHaft: hands.left.toHaft,
        slide: hands.left.slide,
        onHaft: hands.left.onHaft,
        position: hands.left.position
      },
      fingerWrap: { supported: false,
        reason: 'Thor rig has no finger or thumb bones; only Hand and ForeArm joints exist' },
      orientation: {
        axis: zAxis.toArray().map(v => +v.toFixed(3)),
        axisDotForward: +(zAxis.x * forward[0] + zAxis.z * forward[2]).toFixed(3),
        haftUpDot: +haftAxis.y.toFixed(3),
        haftForwardDot: +(haftAxis.x * forward[0] + haftAxis.z * forward[2]).toFixed(3)
      },
      body: {
        penetration: +bodyPenetration.toFixed(3), part: bodyPart, component: bodyComponent,
        parts: bodyParts, floorGap, cameraGap, points: allPoints.length,
        bounds: { min: minAll.map(v => +v.toFixed(3)), max: maxAll.map(v => +v.toFixed(3)) }
      },
      clearance: u.weaponCarryClearance || null,
      holder: weapon.parent ? {
        local: weapon.parent.position.toArray().map(v => +v.toFixed(3)),
        rotation: weapon.parent.quaternion.toArray().map(v => +v.toFixed(4))
      } : null
    };
  });

  const stepUntilState = (target, maxSeconds = 1) => page.evaluate(({ target, maxSeconds }) => {
    const dt = 1 / 60;
    let last = null;
    for (let elapsed = 0; elapsed <= maxSeconds; elapsed += dt) {
      window.__browserSmashStep(dt);
      const f = window.fighters[0];
      last = {
        state: f.state, grounded: !!f.isGrounded,
        attackPose: +(f.attackPose || 0).toFixed(3),
        casting: f.casting || null,
        dodgeTimer: +(f.dodgeTimer || 0).toFixed(3)
      };
      if (f.state === target) { window.__browserSmashSetPaused(true); break; }
    }
    return last;
  }, { target, maxSeconds });

  const capture = async (id, category, note, expectedState = null, expectedCarry = null) => {
    await page.evaluate(() => window.__browserSmashSetPaused(true));
    const observed = await state();
    const measured = await measure();
    await page.evaluate(() => window.__browserSmashSetPaused(false));
    const entry = { id, category, note, expectedState, expectedCarry, observed, measured };
    report.scenarios.push(entry);
    console.log('STATE ' + id + ' ' + JSON.stringify({
      state: observed.state, carry: observed.carry?.mode || null,
      attackPose: observed.attackPose, casting: observed.casting,
      hands: measured.hands && {
        left: measured.hands.left.toHaft, right: measured.hands.right.toHaft
      },
      slides: measured.hands && {
        left: measured.hands.left.slide, right: measured.hands.right.slide
      },
      orientation: measured.orientation,
      body: measured.body,
      clearance: measured.clearance
    }));
    return entry;
  };

  await reset();
  await step(0.6);
  await capture('idle', 'idle', 'settled idle, no input');

  await page.keyboard.down('d');
  await step(0.06);
  await capture('idle-to-walk', 'transition', 'D held, early carry ramp');
  await step(0.49);
  await capture('walk', 'movement', 'D held, settled walk');
  // Shift is both sprint and dash. Wait out the initial dodge before taking the run sample rather
  // than calling a dodge frame "run".
  await reset();
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('d');
  await stepUntilState('run', 2.0);
  await capture('run', 'movement', 'Shift+D held, run state', 'run', 'carry');
  await page.keyboard.up('d');
  await page.keyboard.up('ShiftLeft');
  await step(0.3);

  await reset();
  await page.keyboard.down('d');
  await step(0.3);
  await page.keyboard.up('d');
  await step(0.08);
  await capture('walk-to-idle', 'transition', 'D released, early carry decay');
  await step(0.3);

  await reset();
  await page.keyboard.down('d');
  await step(0.3);
  await page.keyboard.press('j');
  await stepUntilState('attack-startup', 0.5);
  await capture('walk-to-attack', 'transition', 'D held, J startup', 'attack-startup', 'two-handed');
  await page.keyboard.up('d');
  await step(0.4);

  await reset();
  await page.keyboard.press('j');
  await stepUntilState('attack-active', 0.8);
  // Step past the first active frame so the two-handed solver has its settled active pose; the
  // transition sample above deliberately keeps the first-startup frame.
  await page.evaluate(() => window.__browserSmashSetPaused(false));
  await step(0.06);
  await capture('light-attack', 'attack', 'J active, settled pose', 'attack-active', 'two-handed');
  await step(0.4);

  await reset();
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.press('j');
  await stepUntilState('attack-active', 1.0);
  await page.evaluate(() => window.__browserSmashSetPaused(false));
  await step(0.06);
  await capture('heavy-attack', 'attack', 'Shift+J active, settled pose', 'attack-active', 'two-handed');
  await page.keyboard.up('ShiftLeft');
  await step(0.4);

  await reset();
  await page.keyboard.down('e');
  await step(0.3);
  await capture('guard', 'attack', 'E held, two-handed guard', 'block', 'two-handed');
  await page.keyboard.up('e');
  await step(0.4);

  await reset();
  await page.keyboard.press('k');
  await step(0.16);
  await capture('signature', 'attack', 'K signature active');
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
  await capture('ultimate-startup', 'attack', 'O ultimate startup', null, 'ultimate');
  await step(0.55);
  await capture('ultimate-active', 'attack', 'O ultimate active', null, 'ultimate');
  await step(0.55);
  await capture('ultimate-recovery', 'transition', 'O ultimate recovery', null, 'ultimate');
  await step(1.0);

  await reset();
  await page.keyboard.press('Space');
  await step(0.2);
  await capture('jump-rise', 'movement', 'Space rising');
  await step(0.3);
  await capture('jump-apex', 'movement', 'Space apex');
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

  const idleEntry = report.scenarios.find(entry => entry.id === 'idle');
  const expectedHandsFor = entry => {
    const mode = String(entry.measured?.carry?.mode || 'idle');
    return mode === 'two-handed' || mode === 'two-handed-carry' ? ['left', 'right'] : ['right'];
  };
  const fail = (entry, type, detail) => {
    const failure = { state: entry.id, category: entry.category, type, ...detail };
    entry.failures = entry.failures || [];
    entry.failures.push(failure);
    report.failures.push(failure);
  };
  const slides = { left: [], right: [] };

  for (const entry of report.scenarios) {
    const m = entry.measured;
    if (m.error) { fail(entry, 'measurement', { error: m.error }); continue; }
    if (entry.expectedState && entry.observed.state !== entry.expectedState) {
      fail(entry, 'scenario', { expectedState: entry.expectedState, actualState: entry.observed.state });
    }
    if (entry.expectedCarry && entry.measured.carry?.mode !== entry.expectedCarry) {
      fail(entry, 'scenario', { expectedCarry: entry.expectedCarry, actualCarry: entry.measured.carry?.mode || null });
    }
    const expectedHands = expectedHandsFor(entry);
    entry.expectedHands = expectedHands;
    entry.offhand = { ...m.offhand, expected: expectedHands.includes('left') };
    entry.fingerWrap = m.fingerWrap || null;
    for (const side of expectedHands) {
      const hand = m.hands?.[side];
      const offhand = side === 'left';
      if (!hand || hand.toHaft === null || hand.toHaft > thresholds.handToHaft) {
        fail(entry, offhand ? 'offhand-contact' : 'contact', {
          hand: side, toHaft: hand?.toHaft ?? null, expectedMax: thresholds.handToHaft });
      }
      if (hand && hand.onHaft && hand.palm) {
        const palm = hand.palm;
        if (palm.haftAcrossPalmDeg > thresholds.palmAcrossMaxDeg) {
          fail(entry, offhand ? 'offhand-palm-orientation' : 'palm-orientation', {
            hand: side, haftAcrossPalmDeg: palm.haftAcrossPalmDeg,
            fingerToHaftDeg: palm.fingerToHaftDeg,
            palmNormalToHaftDeg: palm.palmNormalToHaftDeg,
            axes: palm.axes, limit: thresholds.palmAcrossMaxDeg
          });
        }
      }
      if (hand && hand.onHaft && hand.wrist) {
        const wrist = hand.wrist;
        if (wrist.bendDeg > thresholds.wristBendMaxDeg
          || Math.abs(wrist.twistDeg) > thresholds.wristTwistMaxDeg) {
          fail(entry, offhand ? 'offhand-wrist-orientation' : 'wrist-orientation', {
            hand: side, bendDeg: wrist.bendDeg, twistDeg: wrist.twistDeg,
            foreToHaftDeg: wrist.foreToHaftDeg, limits: {
              bendDeg: thresholds.wristBendMaxDeg, twistDeg: thresholds.wristTwistMaxDeg
            }
          });
        }
      }
      // A slide is only meaningful while the hand is actually on the haft; an off-haft hand
      // already produces a contact failure, and its projection would pollute the axial range.
      if (hand && hand.onHaft && hand.slide !== null) {
        slides[side].push({ id: entry.id, slide: hand.slide });
        if (hand.slide < -0.02 || hand.slide > 1.02) {
          fail(entry, 'axial-slide', { hand: side, slide: hand.slide, haftMin: m.haft.min, haftMax: m.haft.max });
        }
      } else if (!hand) {
        fail(entry, 'axial-slide', { hand: side, slide: hand?.slide ?? null });
      }
    }
    if (!m.clearance || !m.body) {
      fail(entry, 'clearance', { error: 'no weaponCarryClearance or mesh bounds reported' });
    } else {
      if (!Number.isFinite(m.body.penetration) || m.body.penetration > thresholds.bodyPenetration) {
        fail(entry, 'clearance', { key: 'bodyPenetration', value: m.body.penetration,
          limit: thresholds.bodyPenetration, part: m.body.part, component: m.body.component,
          parts: m.body.parts, reportedBodyGap: m.clearance.bodyGap });
      }
      for (const key of ['floorGap', 'cameraGap']) {
        const value = m.body[key];
        const limit = thresholds[key];
        if (typeof value !== 'number' || value < limit) fail(entry, 'clearance', { key, value, limit });
      }
    }
    const facingState = ['idle', 'movement', 'landing'].includes(entry.category);
    if (m.orientation.haftUpDot < thresholds.haftUpDot
      || (facingState && m.orientation.axisDotForward < thresholds.orientationDotForward)) {
      fail(entry, 'orientation', {
        axisDotForward: m.orientation.axisDotForward,
        haftUpDot: m.orientation.haftUpDot,
        limits: { axisDotForward: facingState ? thresholds.orientationDotForward : null,
          haftUpDot: thresholds.haftUpDot }
      });
    }
    if (idleEntry?.measured && entry !== idleEntry) {
      entry.slideDeltaFromIdle = {};
      for (const side of ['left', 'right']) {
        const a = idleEntry.measured.hands?.[side]?.slide;
        const b = m.hands?.[side]?.slide;
        if (typeof a === 'number' && typeof b === 'number') entry.slideDeltaFromIdle[side] = +(b - a).toFixed(3);
      }
    }
  }

  report.fingerWrap = {
    supported: false,
    reason: 'thor_rigged.glb has no finger or thumb bones; only Hand and ForeArm joints exist',
    evidence: '24 glTF nodes and the runtime LeftHand/LeftForeArm/RightHand/RightForeArm only'
  };
  report.axialSlide = {};
  for (const side of ['left', 'right']) {
    const values = slides[side].map(v => v.slide);
    const range = values.length ? +(Math.max(...values) - Math.min(...values)).toFixed(3) : null;
    report.axialSlide[side] = { range, min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null, samples: slides[side] };
    if (range !== null && range > thresholds.slideRange) {
      report.failures.push({ state: 'all', type: 'axial-slide-range', hand: side,
        range, limit: thresholds.slideRange, samples: slides[side] });
    }
  }
  report.status = report.failures.length || report.pageErrors.length || report.consoleErrors.length
    ? 'failed' : 'complete';
  console.log('SUMMARY ' + JSON.stringify({
    status: report.status, states: report.scenarios.length,
    failures: report.failures.length, axialSlide: report.axialSlide,
    failuresByType: report.failures.reduce((out, failure) => {
      out[failure.type] = (out[failure.type] || 0) + 1; return out;
    }, {})
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
