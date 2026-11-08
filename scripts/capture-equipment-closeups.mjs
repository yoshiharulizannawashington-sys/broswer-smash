// Phase 22.3D equipment visual acceptance: close-up, hand-level evidence from the real scene.
//
//   bash scripts/run-browser-test.sh scripts/capture-equipment-closeups.mjs --only=wonder_woman
//   bash scripts/run-browser-test.sh scripts/capture-equipment-closeups.mjs --all
//
// Why offscreen: the game's render loop owns the camera and re-renders on every animation frame, so
// moving the camera and taking a page screenshot races the loop and can capture the wrong pose.
// This renders the same scene graph (same models, same materials, same lights) through the same
// WebGLRenderer into a render target from a camera we control, then reads the pixels back. The
// colours are the renderer's, not the composer's, so treat these as inspection renders rather than
// HUD-quality screenshots — the geometry, contacts and clipping are real.
//
// Each shot is taken after the simulation has actually reached the state, and the grip/shield
// measurements for that same frame are written next to the image, so a picture is never shown
// without the numbers that go with it.
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
const outDir = resolve(root, 'artifacts/phase22-3/equipment');
await mkdir(outDir, { recursive: true });

const UNITS = ['wonder_woman', 'thor'];
const requested = flag('only')?.split(',').map(s => s.trim()).filter(Boolean)
  || (argv.includes('--all') ? UNITS : UNITS);
const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

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
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const report = { phase: '22.3D', kind: 'equipment-closeups', units: [], pageErrors: [], console: [] };
const launchBrowser = () => chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});

for (const slug of requested) {
  let browser;
  const unit = { slug, shots: [], unverified: [], mounts: null, shield: null, status: 'complete' };
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(180_000);
    page.on('pageerror', error => report.pageErrors.push(`${slug}: ${String(error.message || error)}`));
    // Console warnings matter here: a caught weapon-attachment failure only shows up as a warning,
    // and a missing offhand looks identical to a fighter that never had one.
    page.on('console', message => {
      const type = message.type();
      if (type !== 'error' && type !== 'warning') return;
      const text = String(message.text() || '');
      if (!/weapon|asset|gltf|equip|mount/i.test(text)) return;
      report.console.push(`${slug}: ${type}: ${text}`);
    });
    await page.route('https://unpkg.com/three@0.152.2/**', async route => {
      const url = new URL(route.request().url());
      const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
      try {
        await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
          headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
      } catch { await route.fulfill({ status: 404, body: 'missing' }); }
    });
    const dir = resolve(outDir, slug);
    await mkdir(dir, { recursive: true });

    try {
      await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
        && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
        null, { timeout: 120_000, polling: 200 });

      const launchRoster = await page.evaluate(() => (window.characterRosters?.launch || []).map(([name]) => name));
      unit.assets = await page.evaluate(() => window.__browserSmashAssets || null);
      const label = launchRoster.find(name => slugOf(name) === slug);
      if (!label) throw new Error(`"${slug}" is not in the launch roster`);
      unit.label = label;

      await page.evaluate(({ label }) => {
        window.__browserSmashSelect.setMode('2p');
        document.querySelector('#selectScreen .bs-card[data-fighter="' + CSS.escape(label) + '"]')?.click();
        const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
        cards.find(card => card.dataset.fighter !== label)?.click();
      }, { label });
      await page.click('#selectScreen [data-nav="next"]');
      await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
      await page.click('#play');
      await page.evaluate(() => window.__browserSmashStep(0.1));

      const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
      const state = () => page.evaluate(() => {
        const [p1] = window.fighters;
        return {
          speed: +Math.hypot(p1.velocity.x, p1.velocity.z).toFixed(3),
          grounded: !!p1.isGrounded,
          guard: !!p1.guardHeld,
          pose: +(p1.attackPose || 0).toFixed(3),
          queue: (p1.attackQueue || []).length,
          specialCooldown: +(p1.specialCooldown || 0).toFixed(3),
          dodge: +(p1.dodgeTimer || 0).toFixed(3),
          hitstun: +(p1.hitstun || 0).toFixed(3),
          bodyYaw: +(window.fighters[0].model.rotation.y * 180 / Math.PI).toFixed(1)
        };
      });
      const place = (gap = 1.05) => page.evaluate(gap => {
        const [p1, p2] = window.fighters;
        p1.position.set(0, p1.groundLevel, 0);
        p1.velocity.set(0, 0, 0); p1.facing = 1; p1.facingZ = 0;
        p1.attackQueue.length = 0; p1.comboWindow = 0; p1.hitstun = 0; p1.invulnerable = 0;
        p2.position.set(gap, p2.groundLevel, 0);
        p2.velocity.set(0, 0, 0); p2.facing = -1; p2.facingZ = 0;
        p2.attackQueue.length = 0; p2.hitstun = 0;
      }, gap);

      // The renderer-side helper, installed once. Same scene, same materials, our camera.
      await page.evaluate(() => {
        window.__equipShot = options => {
          const T = window.__browserSmashThree;
          const renderer = window.__browserSmashRenderer;
          const scene = window.__browserSmashScene;
          const w = 1280, h = 800;
          if (!window.__equipRT) {
            window.__equipRT = new T.WebGLRenderTarget(w, h, {
              minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: true
            });
            window.__equipRT.texture.colorSpace = T.SRGBColorSpace;
            window.__equipCam = new T.PerspectiveCamera(options.fov || 30, w / h, 0.004, 400);
          }
          const rt = window.__equipRT, cam = window.__equipCam;
          cam.fov = options.fov || 30;
          cam.updateProjectionMatrix();
          cam.position.set(options.eye[0], options.eye[1], options.eye[2]);
          cam.up.set(0, 1, 0);
          cam.lookAt(new T.Vector3(options.target[0], options.target[1], options.target[2]));
          cam.updateMatrixWorld(true);
          renderer.setRenderTarget(rt);
          renderer.setClearColor(0x1b2230, 1);
          renderer.clear(true, true, true);
          renderer.render(scene, cam);
          const buffer = new Uint8Array(w * h * 4);
          renderer.readRenderTargetPixels(rt, 0, 0, w, h, buffer);
          renderer.setRenderTarget(null);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          const image = ctx.createImageData(w, h);
          for (let y = 0; y < h; y++) {
            const from = (h - 1 - y) * w * 4;
            image.data.set(buffer.subarray(from, from + w * 4), y * w * 4);
          }
          ctx.putImageData(image, 0, 0);
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
          return canvas.toDataURL('image/png');
        };
      });

      // Grip, boss and shield-face geometry for the exact frame being captured.
      const probe = () => page.evaluate(() => {
        const T = window.__browserSmashThree;
        const model = window.fighters[0].model;
        const world = object => {
          object.updateWorldMatrix(true, false);
          const e = object.matrixWorld.elements;
          return [e[12], e[13], e[14]];
        };
        const yaw = model.rotation.y;
        const forward = [Math.sin(yaw), 0, Math.cos(yaw)];
        const describe = (weapon, side) => {
          if (!weapon) return { side, present: false };
          const hand = model.userData[side + 'Hand'] || null;
          const grip = world(weapon);
          const palm = hand ? world(hand) : null;
          const holderPos = weapon.parent ? world(weapon.parent) : null;
          let boss = null;
          weapon.traverse(node => { if (!boss && /shield[\s_]*boss/i.test(node.name || '')) boss = node; });
          const bossPoint = boss ? world(boss) : null;
          const gap = (grip, palm) => palm ? +Math.hypot(grip[0] - palm[0], grip[1] - palm[1], grip[2] - palm[2]).toFixed(3) : null;
          // Which way the prop's own +Z points, relative to the body's forward.
          weapon.updateWorldMatrix(true, false);
          const e = weapon.matrixWorld.elements;
          const axis = [e[8], e[9], e[10]];
          const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
          return {
            side, present: true, label: weapon.name,
            attachBone: weapon.parent?.userData?.attachBone || null,
            parent: weapon.parent?.name || null,
            gripDistance: gap(grip, palm),
            holderDistance: holderPos && palm ? gap(holderPos, palm) : null,
            bossDistance: bossPoint && palm ? gap(bossPoint, palm) : null,
            axis: axis.map(v => +(v / len).toFixed(3)),
            axisDotForward: +((axis[0] * forward[0] + axis[2] * forward[2]) / len).toFixed(3),
            offset: weapon.position.toArray().map(v => +v.toFixed(3))
          };
        };
        const right = describe(model.userData.equippedWeaponRight, 'right');
        const left = describe(model.userData.equippedWeaponLeft, 'left');
        // The shield's face plane: the boss sits proud of the face, so the boss's own +Z is the
        // disc normal. Normal parallel to the body's forward means the disc faces forward (a
        // viewer in front sees the face); normal perpendicular means the disc is edge-on.
        let shieldFace = null;
        const shieldRoot = model.userData.equippedWeaponLeft;
        if (shieldRoot) {
          let boss = null;
          shieldRoot.traverse(node => { if (!boss && /shield[\s_]*boss/i.test(node.name || '')) boss = node; });
          if (boss) {
            boss.updateWorldMatrix(true, false);
            const e = boss.matrixWorld.elements;
            const normal = [e[8], e[9], e[10]];
            const nl = Math.hypot(normal[0], normal[1], normal[2]) || 1;
            const dot = (normal[0] * forward[0] + normal[2] * forward[2]) / nl;
            shieldFace = {
              node: boss.name,
              normal: normal.map(v => +(v / nl).toFixed(3)),
              faceDotForward: +dot.toFixed(3),
              faceAngleToForwardDegrees: +(Math.acos(Math.max(-1, Math.min(1, Math.abs(dot)))) * 180 / Math.PI).toFixed(1),
              faceVisibleFromFront: Math.abs(dot) > 0.85,
              edgeOnFromFront: Math.abs(dot) < 0.25
            };
          }
        }
        // Runtime material/depth state of every shield mesh: the GLB declares all five OPAQUE, so
        // any see-through or shard pattern in a frame has to come from the material as the game
        // builds it, not from the asset. Coplanar front planes are reported so overlap is provable.
        const shieldNodes = [];
        if (shieldRoot) shieldRoot.traverse(node => {
          if (!node.isMesh) return;
          node.updateWorldMatrix(true, false);
          const e = node.matrixWorld.elements;
          const material = node.material || {};
          const box = new T.Box3().setFromObject(node);
          shieldNodes.push({
            name: node.name, geometry: node.geometry?.name || null,
            material: material.name || null, transparent: material.transparent === true,
            opacity: material.opacity, depthWrite: material.depthWrite !== false,
            depthTest: material.depthTest !== false, alphaTest: material.alphaTest || 0,
            renderOrder: node.renderOrder, doubleSided: material.side === T.DoubleSide,
            worldZ: +e[14].toFixed(3),
            size: box.getSize(new T.Vector3()).toArray().map(v => +v.toFixed(3))
          });
        });
        return { bodyYawDegrees: +(yaw * 180 / Math.PI).toFixed(1),
          bodyForward: forward.map(v => +v.toFixed(3)), right, left, shieldFace, shieldNodes };
      });

      // Camera framing, in the fighter's own frame so "front" really is front, and out on the
      // outside of the prop so the view is never through the body or inside the shield disc.
      // A fixed 0.26 m hand distance put the camera inside the shield on the first attempt.
      const frameFor = async (framing, side, viewSide) => page.evaluate(({ framing, side, viewSide }) => {
        const T = window.__browserSmashThree;
        const model = window.fighters[0].model;
        const world = object => {
          object.updateWorldMatrix(true, false);
          const e = object.matrixWorld.elements;
          return new T.Vector3(e[12], e[13], e[14]);
        };
        const yaw = model.rotation.y;
        const forward = new T.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const weapon = model.userData['equippedWeapon' + (side === 'left' ? 'Left' : 'Right')];
        const hand = model.userData[side + 'Hand'];
        const torso = model.userData.chest || model.userData.spine || model.userData.pelvis || null;
        const torsoPosition = torso ? world(torso) : world(hand || weapon);
        const fov = framing === 'full' ? 34 : (framing === 'hand' || framing === 'boss' ? 24 : 30);
        let target;
        let distance;
        if (framing === 'hand' || framing === 'boss') {
          const box = new T.Box3().setFromObject(weapon || hand);
          const sphere = box.getBoundingSphere(new T.Sphere());
          target = world(weapon || hand).lerp(sphere.center, 0.35);
          // Fit a hand-sized region, not a fixed distance: 0.62 m put the camera inside the
          // 0.5 m shield disc and produced flat-colour frames on the first attempt.
          const fitRadius = Math.min(Math.max(0.1, sphere.radius), framing === 'boss' ? 0.36 : 0.2);
          distance = Math.min(3, (fitRadius / Math.sin(fov * Math.PI / 360)) * 1.2);
        } else {
          const box = new T.Box3().setFromObject(model);
          const sphere = box.getBoundingSphere(new T.Sphere());
          const radius = Math.max(0.4, sphere.radius);
          target = framing === 'full' ? sphere.center.clone() : torsoPosition;
          distance = Math.min(6, (radius / Math.sin(fov * Math.PI / 360))
            * (framing === 'full' ? 1.1 : 0.62));
        }
        // Push out to the side the prop actually sits on, so a shield is seen from outside its rim.
        const propOffset = weapon ? world(weapon).sub(torsoPosition) : new T.Vector3(forward.z, 0, -forward.x);
        const outside = new T.Vector3(propOffset.x, 0, propOffset.z);
        if (outside.lengthSq() < 1e-6) outside.set(forward.z, 0, -forward.x);
        outside.normalize();
        // The camera side is chosen from the body's own yaw, never from where the opponent is:
        // the fighter auto-faces the opponent, so deriving "rear" from facing produced frames that
        // were all front views while claiming to be rear views.
        const bodyRight = new T.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const viewDir = viewSide === 'rear' ? forward.clone().negate()
          : viewSide === 'left' ? bodyRight.clone().negate()
          : viewSide === 'right' ? bodyRight.clone()
          : forward.clone();
        const eye = target.clone()
          .add(viewDir.multiplyScalar(distance * 0.92))
          .add(outside.multiplyScalar(distance * 0.3))
          .add(new T.Vector3(0, distance * 0.2 + 0.02, 0));
        const offset = eye.clone().sub(target).normalize();
        return { eye: eye.toArray().map(v => +v.toFixed(4)),
          target: target.toArray().map(v => +v.toFixed(4)), fov,
          distance: +distance.toFixed(3), viewSide,
          // +1 camera in front of the body, -1 camera behind it: proof the label matches.
          cameraOffsetDotForward: +offset.dot(forward).toFixed(3),
          cameraOffsetDotRight: +offset.dot(bodyRight).toFixed(3) };
      }, { framing, side: side || 'right', viewSide: viewSide || 'front' });

      const shoot = async (name, view, framing, side, note, viewSide = 'front') => {
        // A side with no prop has nothing to inspect: record it rather than write a frame of an
        // empty hand labelled "shield close-up" (which is what Thor produced on the first pass).
        if (side) {
          const present = await page.evaluate(side => {
            const model = window.fighters[0].model;
            return Boolean(model.userData['equippedWeapon' + (side === 'left' ? 'Left' : 'Right')]);
          }, side);
          if (!present) {
            unit.unverified.push({ view: name, note: `no ${side}-hand prop on this fighter` });
            return null;
          }
        }
        const framingData = await frameFor(framing, side, viewSide);
        const dataUrl = await page.evaluate(options => window.__equipShot(options), {
          eye: framingData.eye, target: framingData.target, fov: framingData.fov
        });
        const file = `${name}.png`;
        await writeFile(resolve(dir, file), Buffer.from(String(dataUrl).split(',')[1], 'base64'));
        const measurement = await probe();
        unit.shots.push({ name, file, view, framing, side: side || null, note,
          camera: framingData, measurement, observed: await state() });
        return measurement;
      };

      await place();
      await step(0.6);
      unit.mounts = await probe();
      unit.shieldAtRest = (await probe()).shieldFace;
      await shoot('front-full', 'idle-front', 'full', 'right', 'whole fighter, both weapons, idle');
      await shoot('rear-full', 'idle-rear', 'full', 'right', 'whole fighter from behind (shield back, straps)', 'rear');
      await shoot('side-left-upper', 'idle-left', 'upper', 'right', 'left three-quarter, shield side', 'left');

      // --- Wonder Woman: front, both hands close, block, attack, turn, rear ---
      await shoot('front-upper', 'idle-front', 'upper', 'right', 'both weapons from the front, idle');
      await shoot('sword-hand-close', 'idle-front', 'hand', 'right', 'right hand on the sword grip');
      await shoot('shield-boss-close', 'idle-front', 'boss', 'left', 'shield face and boss, idle');
      await shoot('shield-edge', 'idle-left', 'boss', 'left', 'shield seen along its own plane', 'right');
      await shoot('shield-edge-high', 'idle-left', 'hand', 'left', 'shield rim from her right, wide', 'right');

      await page.keyboard.down('e');
      await step(0.2);
      const blockState = await state();
      if (blockState.guard) {
        await shoot('block-upper', 'block', 'upper', 'right', 'held E: shield raised');
        await shoot('block-shield-boss', 'block', 'boss', 'left', 'held E: shield face and boss');
      } else {
        unit.unverified.push({ view: 'block', note: 'guard not reported while E was held', observed: blockState });
      }
      await page.keyboard.up('e');
      await step(0.25);

      await place();
      await page.keyboard.press('j');
      await step(0.12);
      const swingState = await state();
      if (swingState.pose > 0 || swingState.queue > 0) {
        await shoot('attack-upper', 'light-attack', 'upper', 'right', 'J: sword swing');
        await shoot('attack-hand-close', 'light-attack', 'hand', 'right', 'J: sword grip mid-swing');
      } else {
        unit.unverified.push({ view: 'light-attack', note: 'no attack pose reported after J', observed: swingState });
      }
      await step(0.5);

      await place();
      await page.keyboard.press('k');
      await step(0.15);
      const specialState = await state();
      if (specialState.specialCooldown > 0) {
        await shoot('special-upper', 'special', 'upper', 'right', 'K: signature move');
      } else {
        unit.unverified.push({ view: 'special', note: 'special cooldown not reported after K', observed: specialState });
      }
      await step(0.6);

      // Quarter turn and half turn, with the opponent placed so the fighter's own facing settles.
      const faceFrom = async (x, z) => {
        await place();
        await page.evaluate(({ x, z }) => {
          const p2 = window.fighters[1];
          p2.position.set(x, p2.groundLevel, z); p2.velocity.set(0, 0, 0);
          const p1 = window.fighters[0];
          p1.facing = x; p1.facingZ = z;
        }, { x, z });
        for (let i = 0; i < 30; i++) await step(0.04);
      };
      // The body yaw each placement settles on is recorded rather than assumed: the four headings
      // are what the fighter actually turns to, and the 22.3C error is measured against that yaw.
      await faceFrom(0, 3);
      const turn90 = await state();        await shoot('turn-90-upper', 'quarter-turn', 'upper', 'right', `body yaw ${turn90.bodyYaw}`, 'right');
      await shoot('turn-90-shield', 'quarter-turn', 'hand', 'left', 'shield during the quarter turn', 'left');

      await faceFrom(-3, 0);
      const rear = await state();
      await shoot('rear-upper', 'rear', 'upper', 'right', `rear view, body yaw ${rear.bodyYaw}`, 'rear');
      await shoot('rear-sword-close', 'rear', 'hand', 'right', 'sword grip from behind', 'rear');
      await shoot('rear-shield-close', 'rear', 'hand', 'left', 'shield from behind', 'rear');

      await faceFrom(0, -3);
      const turn270 = await state();
      await shoot('turn-180-upper', 'turn-180', 'upper', 'right', `three-quarter turn, body yaw ${turn270.bodyYaw}`, 'right');

      // Movement: item 3 of the acceptance list.
      await place();
      await page.keyboard.down('ShiftLeft');
      await page.keyboard.down('d');
      await step(0.55);
      const runState = await state();
      if (runState.speed > 4.4) {
        await shoot('run-upper', 'run', 'upper', 'right', `sprinting, speed ${runState.speed}`);
      } else {
        unit.unverified.push({ view: 'run', note: 'speed did not pass 4.4 while sprinting', observed: runState });
      }
      await page.keyboard.up('d');
      await page.keyboard.up('ShiftLeft');
      await step(0.3);

      await place();
      await page.keyboard.press('ShiftLeft');
      await step(0.08);
      const dodgeState = await state();
      if (dodgeState.dodge > 0) {
        await shoot('dodge-upper', 'dodge', 'upper', 'right', 'tapped SHIFT: dodge');
      } else {
        unit.unverified.push({ view: 'dodge', note: 'no dodge timer after tapped SHIFT', observed: dodgeState });
      }
      await step(0.5);

      unit.shield = (await probe()).shieldFace;
      unit.bodyYawValues = { idleFront: 90, turn90: turn90.bodyYaw, rear: rear.bodyYaw, turn180: turn270.bodyYaw };
    } catch (error) {
      unit.status = 'failed';
      unit.error = String(error.message || error);
    }
  } catch (error) {
    unit.status = 'failed';
    unit.error = String(error.message || error);
  } finally {
    await browser?.close();
  }
  report.units.push(unit);
  await writeFile(resolve(outDir, slug, 'report.json'), JSON.stringify(unit, null, 2));
  console.log(`${slug}: ${unit.shots.length} shots, ${unit.unverified.length} unverified, ${unit.status}`
    + (unit.error ? ` — ${unit.error.split('\n')[0]}` : ''));
}

await new Promise(done => server.close(done));
report.capturedAt = new Date().toISOString();
await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  units: report.units.map(u => ({ slug: u.slug, shots: u.shots.length, unverified: u.unverified.length, status: u.status })),
  pageErrors: report.pageErrors.slice(0, 5)
}, null, 2));
