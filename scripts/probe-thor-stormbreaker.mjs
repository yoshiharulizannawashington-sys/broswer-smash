// Thor's Stormbreaker across the states that the raised grip can affect.
//
//   bash scripts/run-browser-test.sh scripts/probe-thor-stormbreaker.mjs --tag=before
//
// The grip now sits 1.02 authored units up the shaft, so the hand is no longer at the prop origin.
// This measures the prop as the match actually poses it: world bounds against Thor's head, chest,
// pelvis and the floor, the distance from the shaft to the active camera, and the hand-to-origin
// offset that the raised grip intentionally introduces. Idle arm quaternions are recorded so a
// prop-only fix can be proved not to have touched the settled arms.
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
const tag = flag('tag') || 'current';
const outDir = resolve(root, 'artifacts/thor-stormbreaker', tag);
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
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const report = { tag, states: [], pageErrors: [], consoleErrors: [], idle: null, status: 'complete' };
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

  // This is the selection path the working carry probe uses. Toggling 2P before picking the cards
  // can leave the select screen on a hidden page, so mode is set after the arena.
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
      && u.equippedWeaponRight
      && u.equippedWeaponRight.userData?.kind === 'stormbreaker'
      && u.rightHand && u.head && u.torso;
  }, null, { timeout: 180_000, polling: 200 });

  const reset = async (gap = 1.65) => {
    await page.evaluate(gap => {
      const [p1, p2] = window.fighters;
      p1.position.set(0, p1.groundLevel || 0, 0);
      p2.position.set(gap, p2.groundLevel || 0, 0);
      p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
      p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
      for (const f of [p1, p2]) {
        f.attackQueue.length = 0;
        f.hitstun = 0;
        f.guardBreak = 0;
        f.dodgeTimer = 0;
        f.weaponStowed = false;
        f.isGrounded = true;
      }
      window.smashCamera?.spectate?.({ fighter: p1, framing: 'full', distance: 3.4, yaw: 38, pitch: 4 });
    }, gap);
    await page.evaluate(() => window.__browserSmashStep(0.45));
  };
  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  const state = () => page.evaluate(() => {
    const f = window.fighters[0];
    return {
      state: f.state, casting: f.casting || null, grounded: !!f.isGrounded,
      y: +f.position.y.toFixed(3), speed: +Math.hypot(f.velocity.x, f.velocity.z).toFixed(3),
      attackPose: +(f.attackPose || 0).toFixed(3),
      queue: (f.attackQueue || []).map(a => a.label || a.type || 'attack'),
      meter: +(f.meter || 0).toFixed(1),
      ultimate: f.ultimateDef?.label || null,
      match: window.__browserSmashMatch().status,
      carry: f.model?.userData?.weaponCarry || null
    };
  });

  const measure = () => page.evaluate(() => {
    const f = window.fighters[0];
    const u = f.model.userData;
    const weapon = u.equippedWeaponRight;
    const world = bone => {
      if (!bone) return null;
      bone.updateWorldMatrix(true, false);
      const e = bone.matrixWorld.elements;
      return [e[12], e[13], e[14]];
    };
    f.model.updateWorldMatrix(true, true);
    weapon.updateWorldMatrix(true, true);
    // Compute the static prop's world bounds from its vertices. Three's Box3.setFromObject on a
    // skinned parent can include bind-pose extents, but the weapon itself is rigid.
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const points = [], pointNames = [];
    weapon.traverse(node => {
      const attr = node.geometry?.attributes?.position;
      if (!attr) return;
      node.updateWorldMatrix(true, false);
      const v = new node.position.constructor();
      const stride = Math.max(1, Math.floor(attr.count / 500));
      for (let i = 0; i < attr.count; i += stride) {
        v.fromBufferAttribute(attr, i);
        if (node.isSkinnedMesh) node.applyBoneTransform?.(i, v);
        node.localToWorld(v);
        points.push([v.x, v.y, v.z]);
        pointNames.push(node.name || '');
        for (let axis = 0; axis < 3; axis++) {
          const value = [v.x, v.y, v.z][axis];
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
    });
    const boxCenter = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const center = boxCenter;
    const head = world(u.head), torso = world(u.torso), pelvis = world(u.pelvis);
    const rightHand = world(u.rightHand), rightFore = world(u.rightFore);
    const camera = window.__browserSmashCamera || window.__browserSmashRenderer?.camera;
    const camPos = camera ? camera.position.toArray() : null;
    const clamp = p => [Math.max(min[0], Math.min(max[0], p[0])),
      Math.max(min[1], Math.min(max[1], p[1])), Math.max(min[2], Math.min(max[2], p[2]))];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const pointSegment = (p, a, b) => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const denom = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      const t = denom ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / denom)) : 0;
      return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
    };
    // Body capsules, excluding the right hand/forearm: contact there is the grip itself.
    const capsules = [];
    if (head && torso) capsules.push({ part: 'head', a: torso, b: head, radius: 0.16 });
    if (torso && pelvis) capsules.push({ part: 'torso', a: pelvis, b: torso, radius: 0.24 });
    if (pelvis) capsules.push({ part: 'pelvis', a: pelvis, b: pelvis, radius: 0.20 });
    const byPart = {};
    const isGrip = point => (rightHand && dist(point, rightHand) < 0.11)
      || (rightFore && dist(point, rightFore) < 0.08);
    let penetration = 0, part = null, component = null;
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (isGrip(point)) continue;
      for (const capsule of capsules) {
        const d = pointSegment(point, capsule.a, capsule.b);
        const depth = capsule.radius - d;
        if (depth > penetration) { penetration = depth; part = capsule.part; component = pointNames[i]; }
        if (depth > 0) {
          const previous = byPart[capsule.part] || { depth: 0, vertices: 0 };
          byPart[capsule.part] = { depth: Math.max(previous.depth, depth), vertices: previous.vertices + 1 };
        }
      }
    }
    for (const name of Object.keys(byPart)) byPart[name].depth = +byPart[name].depth.toFixed(3);
    const boxNearCamera = camPos ? clamp(camPos) : null;
    const cameraGap = camPos ? dist(camPos, boxNearCamera) : null;
    const grip = world(weapon);
    const hand = rightHand;
    const gripToHand = grip && hand ? dist(grip, hand) : null;
    const handToShaft = hand ? Math.min(...points.map(p => dist(p, hand))) : null;
    const cameraLocal = camPos && camera ? (() => {
      // Is the prop behind the near plane / inside the camera? A point-to-box gap alone misses a
      // prop that fills the lens, so also report the nearest prop point in camera space.
      const cam = camera;
      const v = new (weapon.position.constructor)(...boxCenter);
      const local = v.clone().applyMatrix4(cam.matrixWorldInverse);
      return { z: +local.z.toFixed(3), near: +cam.near.toFixed(3) };
    })() : null;
    return {
      identity: f.identity, state: f.state, casting: f.casting || null,
      body: String(u.characterAssetUrl || ''),
      weapon: {
        kind: u.weaponKind, label: u.weaponLabel,
        parent: weapon.parent?.name || null,
        origin: grip, gripToHand: gripToHand === null ? null : +gripToHand.toFixed(3),
        handToShaft: handToShaft === null ? null : +handToShaft.toFixed(3),
        scale: +weapon.scale.x.toFixed(3),
        bounds: { min: min.map(v => +v.toFixed(3)), max: max.map(v => +v.toFixed(3)) },
        size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map(v => +v.toFixed(3)),
        floorGap: +(min[1] - (f.position?.y || 0)).toFixed(3),
        headGap: head ? +(dist(head, clamp(head)) - 0.16).toFixed(3) : null,
        torsoGap: torso ? +(dist(torso, clamp(torso)) - 0.24).toFixed(3) : null,
        pelvisGap: pelvis ? +(dist(pelvis, clamp(pelvis)) - 0.20).toFixed(3) : null,
        bodyPenetration: +penetration.toFixed(3), bodyPart: part, bodyComponent: component, bodyParts: byPart,
        cameraGap: cameraGap === null ? null : +cameraGap.toFixed(3),
        cameraCenter: cameraLocal
      },
      carry: u.weaponCarry || null,
      clearance: u.weaponCarryClearance || null,
      arms: {
        leftArm: u.leftArm?.quaternion.toArray().map(v => +v.toFixed(5)) || null,
        rightArm: u.rightArm?.quaternion.toArray().map(v => +v.toFixed(5)) || null,
        leftFore: u.leftFore?.quaternion.toArray().map(v => +v.toFixed(5)) || null,
        rightFore: u.rightFore?.quaternion.toArray().map(v => +v.toFixed(5)) || null
      }
    };
  });

  const sweep = async label => page.evaluate(name => {
    window.__browserSmashSetPaused(true);
    const f = window.fighters[0];
    const u = f.model.userData;
    const weapon = u.equippedWeaponRight;
    const holder = weapon.parent;
    const mixer = f.model.userData.humanMixer;
    if (mixer) mixer.timeScale = 0;
    const base = holder.quaternion.clone();
    const Quat = holder.quaternion.constructor;
    const Vec = weapon.position.constructor;
    const axes = [
      { name: 'x', axis: new Vec(1, 0, 0) },
      { name: 'y', axis: new Vec(0, 1, 0) },
      { name: 'z', axis: new Vec(0, 0, 1) }
    ];
    const world = bone => {
      bone.updateWorldMatrix(true, false);
      const e = bone.matrixWorld.elements;
      return [e[12], e[13], e[14]];
    };
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const segment = (p, a, b) => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const denom = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      const t = denom ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / denom)) : 0;
      return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
    };
    const capsules = [];
    const head = world(u.head), torso = world(u.torso), pelvis = world(u.pelvis);
    const rightHand = world(u.rightHand), rightFore = world(u.rightFore);
    if (head && torso) capsules.push({ part: 'head', a: torso, b: head, radius: 0.16 });
    if (torso && pelvis) capsules.push({ part: 'torso', a: pelvis, b: torso, radius: 0.24 });
    if (pelvis) capsules.push({ part: 'pelvis', a: pelvis, b: pelvis, radius: 0.20 });
    const isGrip = point => (rightHand && dist(point, rightHand) < 0.11)
      || (rightFore && dist(point, rightFore) < 0.08);
    const points = [];
    const bounds = () => {
      points.length = 0;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      weapon.updateWorldMatrix(true, true);
      weapon.traverse(node => {
        const attr = node.geometry?.attributes?.position;
        if (!attr) return;
        node.updateWorldMatrix(true, false);
        const v = new Vec();
        const stride = Math.max(1, Math.floor(attr.count / 500));
        for (let i = 0; i < attr.count; i += stride) {
          v.fromBufferAttribute(attr, i);
          if (node.isSkinnedMesh) node.applyBoneTransform?.(i, v);
          node.localToWorld(v);
          points.push([v.x, v.y, v.z]);
          for (let axis = 0; axis < 3; axis++) {
            const value = [v.x, v.y, v.z][axis];
            min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
          }
        }
      });
      return { min, max };
    };
    const measureCurrent = () => {
      const { min, max } = bounds();
      const parts = {};
      for (const point of points) {
        if (isGrip(point)) continue;
        for (const capsule of capsules) {
          const d = segment(point, capsule.a, capsule.b);
          if (d < capsule.radius) {
            const depth = capsule.radius - d;
            parts[capsule.part] = Math.max(parts[capsule.part] || 0, depth);
          }
        }
      }
      const camera = window.__browserSmashCamera;
      const clampCamera = p => [Math.max(min[0], Math.min(max[0], p[0])),
        Math.max(min[1], Math.min(max[1], p[1])), Math.max(min[2], Math.min(max[2], p[2]))];
      return {
        parts: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, +value.toFixed(3)])),
        max: +Math.max(0, ...Object.values(parts)).toFixed(3),
        floorGap: +(min[1] - (f.position?.y || 0)).toFixed(3),
        cameraGap: camera ? +dist(camera.position.toArray(), clampCamera(camera.position.toArray())).toFixed(3) : null
      };
    };
    const results = [];
    const angles = axisName => axisName === 'z'
      ? [-2.6, -2.4, -2.2, -2.0, -1.8, -1.6, -1.5, -1.4, -1.2, -1.0, -0.8, -0.6, -0.4, -0.2,
        0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6]
      : [-1.2, -1.0, -0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1,
        0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    for (const { name: axisName, axis } of axes) {
      for (const extra of angles(axisName)) {
        holder.quaternion.copy(base).multiply(new Quat().setFromAxisAngle(axis, extra));
        holder.updateWorldMatrix(true, true);
        results.push({ axis: axisName, extra: +extra.toFixed(2), ...measureCurrent() });
      }
    }
    holder.quaternion.copy(base);
    holder.updateWorldMatrix(true, true);
    // Grip height: the prop origin is below the palm, so this is the local shaft point the hand
    // closes on. A valid grip must stay on the wooden haft (local y 0.01–0.95), not inside the head.
    const basePosition = weapon.position.clone();
    const gripResults = [];
    for (const authored of [-0.2, -0.4, -0.5, -0.6, -0.7, -0.8, -0.9, -0.95, -1.0, -1.02]) {
      weapon.position.set(basePosition.x, authored * weapon.scale.y - 0.045, basePosition.z);
      holder.updateWorldMatrix(true, true);
      const gripLocal = -weapon.position.y / weapon.scale.y;
      gripResults.push({ authored, gripLocal: +gripLocal.toFixed(3),
        onHaft: gripLocal >= 0.01 && gripLocal <= 0.95, ...measureCurrent() });
    }
    weapon.position.copy(basePosition);
    holder.updateWorldMatrix(true, true);
    return { name, results, gripResults };
  }, label);

  const capture = async (label, note) => {
    await step(0.016);
    await page.waitForTimeout(120);
    const observed = await state();
    const measured = await measure();
    const file = label + '.png';
    await page.screenshot({ path: resolve(outDir, file) });
    const entry = { label, file, note, observed, measured };
    report.states.push(entry);
    console.log('CAPTURE ' + label + ' ' + JSON.stringify({ observed, measured: {
      body: measured.weapon.bodyPart, penetration: measured.weapon.bodyPenetration,
      floorGap: measured.weapon.floorGap, cameraGap: measured.weapon.cameraGap,
      gripToHand: measured.weapon.gripToHand, handToShaft: measured.weapon.handToShaft
    } }));
    return entry;
  };

  // Staged orbit around the fighter's own facing axis. Front is +forward, side is +right and rear
  // is -forward; using world axes here silently produced two side views for a fighter facing +X.
  const captureViews = async label => {
    await page.evaluate(() => {
      window.__browserSmashSetPaused(true);
      const mixer = window.fighters[0].model?.userData?.humanMixer;
      if (mixer) mixer.timeScale = 0;
      // The idle reset puts the opponent directly in front of a true front camera. Hide it for
      // the staged orbit so the measured fighter is actually visible.
      const other = window.fighters[1];
      if (other?.model) {
        window.__stageOtherVisible = other.model.visible;
        other.model.visible = false;
      }
    });
    for (const [view, angle] of [['front', 0], ['side', Math.PI / 2], ['rear', Math.PI]]) {
      await page.evaluate(({ angle }) => {
        const f = window.fighters[0];
        const camera = window.__browserSmashCamera;
        const forward = new window.__browserSmashThree.Vector3(f.facing || 0, 0, f.facingZ || 0);
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
        forward.normalize();
        const right = new window.__browserSmashThree.Vector3(forward.z, 0, -forward.x);
        const direction = forward.clone().multiplyScalar(Math.cos(angle))
          .add(right.clone().multiplyScalar(Math.sin(angle)));
        const distance = 2.5;
        camera.position.set(
          f.position.x + direction.x * distance,
          f.position.y + 1.15,
          f.position.z + direction.z * distance
        );
        camera.lookAt(f.position.x, f.position.y + 1.05, f.position.z);
        camera.updateMatrixWorld(true);
        window.__browserSmashRenderer.render(window.__browserSmashScene, camera);
      }, { angle });
      await page.waitForTimeout(60);
      await page.screenshot({ path: resolve(outDir, `${label}-${view}.png`) });
    }
    await page.evaluate(() => {
      const other = window.fighters[1];
      if (other?.model && window.__stageOtherVisible !== undefined) {
        other.model.visible = window.__stageOtherVisible;
        delete window.__stageOtherVisible;
      }
      window.__browserSmashSetPaused(false);
      const mixer = window.fighters[0].model?.userData?.humanMixer;
      if (mixer) mixer.timeScale = 1;
    });
  };

  // A side/rear inspection camera for the frames where a front gameplay shot cannot show whether
  // the broad head is passing through the torso. This is a staged view, not a different match state.
  const captureFrozen = async (label, note) => {
    await step(0.016);
    await page.evaluate(() => {
      window.__browserSmashSetPaused(true);
      const mixer = window.fighters[0].model?.userData?.humanMixer;
      if (mixer) mixer.timeScale = 0;
    });
    const observed = await state();
    const measured = await measure();
    await page.screenshot({ path: resolve(outDir, label + '.png') });
    await captureViews(label);
    await page.evaluate(() => {
      window.__browserSmashSetPaused(false);
      const mixer = window.fighters[0].model?.userData?.humanMixer;
      if (mixer) mixer.timeScale = 1;
    });
    report.states.push({ label, file: label + '.png', note, observed, measured });
    console.log('CAPTURE ' + label + ' ' + JSON.stringify({ observed, measured: {
      body: measured.weapon.bodyPart, penetration: measured.weapon.bodyPenetration,
      floorGap: measured.weapon.floorGap, cameraGap: measured.weapon.cameraGap
    } }));
  };

  const captureFrom = async (label, note, yaw, distance = 2.5) => {
    await step(0.016);
    await page.evaluate(({ yaw, distance }) => {
      const f = window.fighters[0];
      const camera = window.__browserSmashCamera;
      const angle = yaw * Math.PI / 180;
      camera.position.set(
        f.position.x + Math.sin(angle) * distance,
        f.position.y + 1.15,
        f.position.z + Math.cos(angle) * distance
      );
      camera.lookAt(f.position.x, f.position.y + 1.05, f.position.z);
      camera.updateMatrixWorld(true);
      window.__browserSmashRenderer.render(window.__browserSmashScene, camera);
    }, { yaw, distance });
    await page.waitForTimeout(100);
    const observed = await state();
    const measured = await measure();
    const file = label + '.png';
    await page.screenshot({ path: resolve(outDir, file) });
    report.states.push({ label, file, note, observed, measured });
    console.log('CAPTURE ' + label + ' ' + JSON.stringify({ observed, measured: {
      body: measured.weapon.bodyPart, penetration: measured.weapon.bodyPenetration,
      floorGap: measured.weapon.floorGap, cameraGap: measured.weapon.cameraGap
    } }));
  };

  await reset();
  await step(0.7);
  const idle = await capture('idle', 'settled idle, no input');
  report.idle = idle.measured;
  await captureViews('idle');
  if (argv.includes('--sweep')) {
    report.idleSweep = await sweep('idle');
    await page.evaluate(() => {
      window.__browserSmashSetPaused(false);
      const mixer = window.fighters[0].model?.userData?.humanMixer;
      if (mixer) mixer.timeScale = 1;
    });
  }

  await page.keyboard.down('d');
  await step(0.65);
  await capture('walk', 'held D');
  await page.keyboard.up('d');
  await step(0.3);

  await reset();
  await page.keyboard.press('Space');
  await step(0.2);
  await capture('jump', 'Space, rising');
  await step(0.3);
  await capture('jump-apex', 'Space, apex');
  await step(1.2);

  await reset();
  await page.keyboard.press('Space');
  await step(0.08);
  await page.keyboard.press('j');
  await step(0.14);
  await capture('aerial-attack', 'Space then J, airborne');
  await step(1.0);

  await reset();
  await page.keyboard.press('j');
  await step(0.13);
  await capture('light-attack', 'J active');
  await step(0.5);

  await reset();
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.press('j');
  await step(0.15);
  await capture('heavy-attack', 'SHIFT + J active');
  await page.keyboard.up('ShiftLeft');
  await step(0.6);

  await reset();
  await page.keyboard.press('k');
  await step(0.16);
  await capture('signature', 'K signature');
  await step(0.7);

  // Ultimate: the meter is set to ready, then O casts through the real input path.
  await reset(4.2);
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.meter = 100;
    f.casting = null;
    f.attackQueue.length = 0;
    f.weaponStowed = false;
  });
  await page.keyboard.press('o');
  await step(0.08);
  await capture('ultimate-startup', 'O, startup');
  await step(0.55);
  await captureFrozen('ultimate-active', 'O, first storm hit window');
  if (argv.includes('--sweep')) {
    report.ultimateSweep = await sweep('ultimate-active');
    await page.evaluate(() => {
      window.__browserSmashSetPaused(false);
      const mixer = window.fighters[0].model?.userData?.humanMixer;
      if (mixer) mixer.timeScale = 1;
    });
  }
  await step(0.55);
  await capture('ultimate-recovery', 'O, second storm hit / recovery');
  await step(1.0);
  await capture('ultimate-end', 'O, after the authored beat');

  report.status = report.pageErrors.length ? 'page-errors' : 'complete';
  console.log('STATUS ' + report.status + ' states=' + report.states.length);
} catch (error) {
  report.status = 'failed';
  report.error = String(error?.stack || error);
  console.error(report.error);
} finally {
  await browser.close();
  server.close();
  await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
}
if (report.status !== 'complete') process.exitCode = 1;
