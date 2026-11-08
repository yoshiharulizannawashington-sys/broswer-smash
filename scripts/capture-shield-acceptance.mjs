// Phase 22.3G equipment acceptance: the real match frame, through the game's own render path.
//
//   bash scripts/run-browser-test.sh scripts/capture-shield-acceptance.mjs
//
// Unlike the 22.3D-F inspection renders (own camera, own render target) every image here is a
// page screenshot: the match camera, both fighters, the HUD, and the pixels the engine puts on
// screen. `main.js` drives the frame with `composer.render()`, and this build's composer is a
// pass-through to `renderer.render(scene, camera)` created with `antialias: true`, so a page
// screenshot is the composer path with MSAA on, at normal gameplay distance.
//
// Two framings per state, both from the same live frame: the whole viewport (what a player sees)
// and a pixel crop around the shield, located by projecting the shield boss through the camera the
// renderer actually used. The crop is a crop, not a separate render, so upscaled geometry cannot
// hide behind a different camera.
//
// The projection needs the match camera, which the page does not expose, so the harness wraps
// `renderer.render` once and remembers the camera argument. That is observation, not a change to
// what is drawn: the wrapper calls through unchanged.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';
import { chromium } from 'playwright';

// --- minimal PNG crop, so the detail image is cut out of the very frame that was captured ---
// Taking a second cropped screenshot runs a few frames later, and under load the fighter has moved
// by the time it lands (measured drift of 7-115 px in the first pass). Cropping the saved frame is
// exact by construction.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
const crc32 = buffer => {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, header = null;
  const idat = [];
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
  if (!header) throw new Error('PNG without IHDR');
  if (header.depth !== 8 || header.interlace !== 0) throw new Error(`unsupported PNG: depth ${header.depth}, interlace ${header.interlace}`);
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[header.color];
  if (!channels) throw new Error('unsupported PNG colour type ' + header.color);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = header.width * channels;
  const pixels = Buffer.alloc(stride * header.height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const line = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let value = source[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[x] = value & 0xff;
    }
    previous = line;
  }
  return { width: header.width, height: header.height, channels, pixels };
}
function encodePng(image) {
  const { width, height, channels, pixels } = image;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4, 8), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : channels === 3 ? 2 : channels === 1 ? 0 : 4;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
function cropImage(image, x, y, width, height) {
  const cx = Math.max(0, Math.min(image.width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  const w = Math.max(1, Math.min(image.width - cx, Math.round(width)));
  const h = Math.max(1, Math.min(image.height - cy, Math.round(height)));
  const pixels = Buffer.alloc(w * h * image.channels);
  for (let row = 0; row < h; row += 1) {
    const from = ((cy + row) * image.width + cx) * image.channels;
    image.pixels.copy(pixels, row * w * image.channels, from, from + w * image.channels);
  }
  return { width: w, height: h, channels: image.channels, pixels };
}

const root = process.cwd();
const argv = process.argv.slice(2);
const flag = name => {
  const hit = argv.find(arg => arg.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};
// The cloud runner renders through SwiftShader, where a 2160x1350 screenshot costs about 20 s. At
// 1:1 device pixels a shot costs a few seconds, so a pass fits inside the command budget and the
// crop is still made of real rendered pixels.
const only = flag('only')?.split(',').map(s => s.trim()).filter(Boolean) || null;
const wanted = name => !only || only.includes(name);
const outDir = resolve(root, 'artifacts/phase22-3/acceptance');
await mkdir(outDir, { recursive: true });

const CSS_VIEWPORT = { width: 1280, height: 800 };
const DEVICE_SCALE = 1;
const CROP_MAX = 520; // CSS px cap on the detail crop

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
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const report = { phase: '22.3G', kind: 'shield-acceptance', renderPath: null, shots: [], unverified: [], pageErrors: [], console: [], status: 'complete' };
// A pass can be split across commands (--only=a,b): keep what earlier passes already proved.
try {
  const previous = JSON.parse(await readFile(resolve(outDir, 'report.json'), 'utf8'));
  if (previous?.shots?.length) {
    report.shots = previous.shots;
    report.unverified = (previous.unverified || []).filter(u => !wanted(u.view));
    report.renderPath = previous.renderPath || null;
  }
} catch { /* first pass */ }
const saveReport = async () => {
  report.shots.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
};
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
try {
  const page = await browser.newPage({ viewport: CSS_VIEWPORT, deviceScaleFactor: DEVICE_SCALE });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => report.pageErrors.push(String(error.message || error)));
  page.on('console', message => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = String(message.text() || '');
    if (!/weapon|asset|gltf|equip|mount|shield/i.test(text)) return;
    report.console.push(`${type}: ${text}`);
  });
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
    } catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 200 });

  const launchRoster = await page.evaluate(() => (window.characterRosters?.launch || []).map(([name]) => name));
  const label = launchRoster.find(name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_') === 'wonder_woman');
  if (!label) throw new Error('Wonder Woman is not in the launch roster');
  report.fighter = label;

  // Observe the camera the renderer is actually handed, then call through untouched.
  await page.evaluate(() => {
    const renderer = window.__browserSmashRenderer;
    const original = renderer.render.bind(renderer);
    window.__renderObserver = { calls: 0, camera: null };
    renderer.render = (scene, camera) => {
      window.__renderObserver.calls += 1;
      window.__renderObserver.camera = camera;
      return original(scene, camera);
    };
  });

  // Render-path evidence: what the canvas was created with, and whether frames keep coming through
  // the composer (main.js increments `assets.app.frames` in the same statement as composer.render).
  const framesBefore = await page.evaluate(() => ({ frames: window.__browserSmashAssets?.app?.frames || 0,
    calls: window.__renderObserver.calls }));
  await page.waitForTimeout(900);
  const framesAfter = await page.evaluate(() => ({ frames: window.__browserSmashAssets?.app?.frames || 0,
    calls: window.__renderObserver.calls, camera: window.__renderObserver.camera?.type || null }));
  report.renderPath = await page.evaluate(frames => {
    const renderer = window.__browserSmashRenderer;
    const gl = renderer.getContext();
    const attributes = gl.getContextAttributes() || {};
    return {
      composerIsPassThrough: typeof window.__browserSmashAssets?.app === 'object',
      canvasAntialias: attributes.antialias === true,
      contextAttributes: { antialias: attributes.antialias, depth: attributes.depth, stencil: attributes.stencil,
        alpha: attributes.alpha, preserveDrawingBuffer: attributes.preserveDrawingBuffer, samples: attributes.samples ?? null },
      pixelRatio: renderer.getPixelRatio(),
      canvasBackingStore: [renderer.domElement.width, renderer.domElement.height],
      cssSize: [window.innerWidth, window.innerHeight],
      toneMapping: renderer.toneMapping,
      outputColorSpace: renderer.outputColorSpace,
      shadows: renderer.shadowMap.enabled,
      framesInWindow: frames.frames,
      rendererCallsInWindow: frames.calls,
      cameraType: frames.camera,
      canvasIsOnScreen: (() => {
        const rect = renderer.domElement.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(renderer.domElement).display !== 'none';
      })(),
      loopRunning: frames.frames > 0 && frames.calls > 0
    };
  }, { frames: framesAfter.frames - framesBefore.frames, calls: framesAfter.calls - framesBefore.calls });

  // --- start the match: Wonder Woman vs an inert second player ---
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
    const [p1, p2] = window.fighters;
    const model = p1.model;
    return {
      speed: +Math.hypot(p1.velocity.x, p1.velocity.z).toFixed(3),
      grounded: !!p1.isGrounded,
      guard: !!p1.guardHeld,
      pose: +(p1.attackPose || 0).toFixed(3),
      queue: (p1.attackQueue || []).map(a => a.label || a.type || 'attack'),
      specialCooldown: +(p1.specialCooldown || 0).toFixed(3),
      dodge: +(p1.dodgeTimer || 0).toFixed(3),
      hitstun: +(p1.hitstun || 0).toFixed(3),
      bodyYaw: +(model.rotation.y * 180 / Math.PI).toFixed(1),
      shieldPresent: Boolean(model.userData.equippedWeaponLeft),
      swordPresent: Boolean(model.userData.equippedWeaponRight),
      opponent: { x: +p2.position.x.toFixed(2), z: +p2.position.z.toFixed(2) }
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

  // Shield screen placement, from the camera the renderer used for the frame on screen.
  const shieldScreen = () => page.evaluate(() => {
    const T = window.__browserSmashThree;
    const camera = window.__renderObserver?.camera;
    const model = window.fighters[0].model;
    const shield = model.userData.equippedWeaponLeft;
    if (!shield) return { present: false };
    if (!camera) return { present: true, error: 'renderer camera not observed' };
    let boss = null;
    shield.traverse(node => { if (!boss && /shield[\s_]*boss/i.test(node.name || '')) boss = node; });
    const anchor = new T.Vector3();
    (boss || shield).getWorldPosition(anchor);
    const projected = anchor.clone().project(camera);
    const w = window.innerWidth, h = window.innerHeight;
    const toCss = v => [Math.round((v.x * 0.5 + 0.5) * w), Math.round((-v.y * 0.5 + 0.5) * h)];
    // On-screen extent, so "normal gameplay distance" is reported in pixels instead of asserted.
    const box = new T.Box3().setFromObject(shield);
    const xs = [], ys = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new T.Vector3(x, y, z).project(camera);
      const [px, py] = toCss(p);
      xs.push(px); ys.push(py);
    }
    const [cx, cy] = toCss(projected);
    return {
      present: true,
      anchor: anchor.toArray().map(v => +v.toFixed(3)),
      cssCentre: [cx, cy],
      ndc: [+projected.x.toFixed(3), +projected.y.toFixed(3), +projected.z.toFixed(3)],
      screenBoxCss: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      screenWidthCss: Math.max(...xs) - Math.min(...xs),
      screenHeightCss: Math.max(...ys) - Math.min(...ys),
      // Behind the camera or outside the frustum means the crop would show sky or the arena.
      inFrontOfCamera: projected.z < 1,
      insideViewport: Math.abs(projected.x) < 0.9 && Math.abs(projected.y) < 0.85
    };
  });

  // Attachment and shield state for the frame being captured.
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
    const gap = (a, b) => (a && b) ? +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(3) : null;
    const describe = (weapon, side) => {
      if (!weapon) return { side, present: false };
      const hand = model.userData[side + 'Hand'] || null;
      const grip = world(weapon);
      const palm = hand ? world(hand) : null;
      const holder = weapon.parent ? world(weapon.parent) : null;
      weapon.updateWorldMatrix(true, false);
      const e = weapon.matrixWorld.elements;
      const axis = [e[8], e[9], e[10]];
      const length = Math.hypot(...axis) || 1;
      return {
        side, present: true, label: weapon.name,
        parent: weapon.parent?.name || null, parentIsBone: !!weapon.parent?.isBone,
        attachBone: weapon.parent?.userData?.attachBone || null,
        attachIsHand: weapon.parent?.userData?.attachIsHand === true,
        gripDistance: gap(grip, palm), holderDistance: gap(holder, palm),
        axisDotForward: +((axis[0] * forward[0] + axis[2] * forward[2]) / length).toFixed(3),
        offset: weapon.position.toArray().map(v => +v.toFixed(3))
      };
    };
    const shield = model.userData.equippedWeaponLeft;
    const parts = [];
    if (shield) shield.traverse(node => {
      if (!node.isMesh) return;
      const size = new T.Box3().setFromObject(node).getSize(new T.Vector3());
      const material = node.material || {};
      parts.push({ name: node.name, size: size.toArray().map(v => +v.toFixed(4)),
        transparent: material.transparent === true, opacity: material.opacity,
        depthWrite: material.depthWrite !== false, depthTest: material.depthTest !== false,
        doubleSided: material.side === T.DoubleSide, renderOrder: node.renderOrder });
    });
    let faceNormalDot = null, bossDistance = null;
    if (shield) {
      let boss = null;
      shield.traverse(node => { if (!boss && /shield[\s_]*boss/i.test(node.name || '')) boss = node; });
      if (boss) {
        boss.updateWorldMatrix(true, false);
        const e = boss.matrixWorld.elements;
        const n = [e[8], e[9], e[10]];
        const nl = Math.hypot(...n) || 1;
        faceNormalDot = +((n[0] * forward[0] + n[2] * forward[2]) / nl).toFixed(3);
        const palm = model.userData.leftHand ? world(model.userData.leftHand) : null;
        bossDistance = gap(world(boss), palm);
      }
    }
    return { bodyYawDegrees: +(yaw * 180 / Math.PI).toFixed(1),
      right: describe(model.userData.equippedWeaponRight, 'right'),
      left: describe(shield, 'left'),
      shieldFaceNormalDotForward: faceNormalDot, shieldBossToHand: bossDistance,
      shieldParts: parts };
  });

  const shots = report.shots;
  const shoot = async (name, view, note) => {
    if (!wanted(name)) return null;
    const before = await state();
    const screen = await shieldScreen();
    const frameFile = `${name}-frame.png`;
    const cropFile = `${name}-shield.png`;
    const frameBuffer = await page.screenshot();
    await writeFile(resolve(outDir, frameFile), frameBuffer);
    let crop = null;
    if (screen.present && screen.inFrontOfCamera && screen.insideViewport) {
      const image = decodePng(frameBuffer);
      const scale = image.width / CSS_VIEWPORT.width;
      const [left, top, right, bottom] = screen.screenBoxCss;
      const width = Math.min(CROP_MAX, Math.max(240, (right - left) + 240));
      const height = Math.min(CROP_MAX, Math.max(240, (bottom - top) + 240));
      const centreX = ((left + right) / 2) * scale;
      const centreY = ((top + bottom) / 2) * scale;
      const cut = cropImage(image, centreX - (width * scale) / 2, centreY - (height * scale) / 2,
        width * scale, height * scale);
      await writeFile(resolve(outDir, cropFile), encodePng(cut));
      crop = { file: cropFile, source: 'cropped from the same captured frame',
        shieldScreenBoxCss: screen.screenBoxCss, pixels: [cut.width, cut.height] };
    } else {
      report.unverified = report.unverified.filter(u => u.view !== name);
      report.unverified.push({ view: name, note: 'shield not inside the match camera frustum; crop skipped',
        screen, observed: before });
    }
    const after = await state();
    const measurement = await probe();
    const afterScreen = await shieldScreen();
    const drift = (screen.cssCentre && afterScreen.cssCentre)
      ? Math.hypot(screen.cssCentre[0] - afterScreen.cssCentre[0], screen.cssCentre[1] - afterScreen.cssCentre[1])
      : null;
    const shot = { name, view, note, frame: frameFile, crop, screen,
      screenDriftCss: drift === null ? null : +drift.toFixed(2),
      measured: measurement, observed: before, observedAfter: after };
    report.shots = report.shots.filter(entry => entry.name !== name).concat(shot);
    await saveReport();
    const parts = (measurement.shieldParts || []).length;
    console.log(`${name}: yaw ${measurement.bodyYawDegrees} shield ${screen.screenWidthCss?.toFixed(0)}px `
      + `parts ${parts} guard ${before.guard} pose ${before.pose} speed ${before.speed}`
      + (crop ? '' : ' (no crop)'));
    return { before, screen, measurement };
  };

  await place();
  await step(0.6);
  await shoot('01-idle-front', 'idle', 'idle at normal match distance, both weapons drawn');

  if (wanted('02-walk')) {
    await page.keyboard.down('d');
    await step(0.45);
    await shoot('02-walk', 'walk', `walking, speed ${(await state()).speed}`);
    await page.keyboard.up('d');
    await step(0.25);
  } else await place();

  if (wanted('03-run')) {
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('d');
    await step(0.55);
    const runState = await state();
    if (runState.speed > 4.4) await shoot('03-run', 'run', `sprinting, speed ${runState.speed}`);
    else report.unverified.push({ view: 'run', note: 'speed did not pass 4.4', observed: runState });
    await page.keyboard.up('d');
    await page.keyboard.up('ShiftLeft');
    await step(0.3);
  }

  if (wanted('04-block')) {
    await place();
    await page.keyboard.down('e');
    await step(0.2);
    const blockState = await state();
    if (blockState.guard) await shoot('04-block', 'block', 'held E: guard reported, shield raised');
    else report.unverified.push({ view: 'block', note: 'guard not reported while E held', observed: blockState });
    await page.keyboard.up('e');
    await step(0.25);
  }

  if (wanted('05-light-attack')) {
    await place();
    await page.keyboard.press('j');
    await step(0.12);
    const lightState = await state();
    if (lightState.pose > 0 || lightState.queue.length) await shoot('05-light-attack', 'light-attack', 'J: sword swing');
    else report.unverified.push({ view: 'light-attack', note: 'no attack pose after J', observed: lightState });
    await step(0.5);
  }

  if (wanted('06-heavy-attack')) {
    await place();
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.press('j');
    await step(0.14);
    const heavyState = await state();
    if (heavyState.pose > 0 || heavyState.queue.length) await shoot('06-heavy-attack', 'heavy-attack', 'SHIFT + J');
    else report.unverified.push({ view: 'heavy-attack', note: 'no heavy pose', observed: heavyState });
    await page.keyboard.up('ShiftLeft');
    await step(0.55);
  }

  if (wanted('07-special')) {
    await place();
    await page.keyboard.press('k');
    await step(0.15);
    const specialState = await state();
    if (specialState.specialCooldown > 0) await shoot('07-special', 'special', 'K: signature move');
    else report.unverified.push({ view: 'special', note: 'no special cooldown after K', observed: specialState });
    await step(0.6);
  }

  if (wanted('08-dodge')) {
    await place();
    await page.keyboard.press('ShiftLeft');
    await step(0.08);
    const dodgeState = await state();
    if (dodgeState.dodge > 0) await shoot('08-dodge', 'dodge', 'tapped SHIFT: dodge');
    else report.unverified.push({ view: 'dodge', note: 'no dodge timer after tapped SHIFT', observed: dodgeState });
    await step(0.5);
  }

  // Turning: opponent placed around the fighter so its own auto-facing settles on each heading.
  const faceFrom = async (x, z, name, note) => {
    if (!wanted(name)) return;
    await place();
    await page.evaluate(({ x, z }) => {
      const [p1, p2] = window.fighters;
      p2.position.set(x, p2.groundLevel, z); p2.velocity.set(0, 0, 0);
      p1.facing = x; p1.facingZ = z;
    }, { x, z });
    for (let i = 0; i < 30; i += 1) await step(0.04);
    const settled = await state();
    await shoot(name, name, `${note} (body yaw ${settled.bodyYaw})`);
  };
  await faceFrom(0, 3, '09-turn-90', 'quarter turn');
  await faceFrom(-3, 0, '10-turn-180', 'half turn, shield back to camera');
  await faceFrom(0, -3, '11-turn-270', 'three-quarter turn');
  await page.evaluate(() => { window.fighters[0].facing = 1; window.fighters[0].facingZ = 0; });
  await step(0.2);

  // Blocking again with the camera on the other side: the raised shield seen edge-on.
  if (wanted('12-block-turn')) {
    await place();
    await page.keyboard.down('e');
    await step(0.25);
    if ((await state()).guard) await shoot('12-block-turn', 'block-turn', 'guard held, shield presented to the opponent');
    else report.unverified.push({ view: 'block-turn', note: 'guard not reported', observed: await state() });
    await page.keyboard.up('e');
    await step(0.2);
  }

  report.summary = {
    shots: report.shots.length,
    unverified: report.unverified.length,
    pageErrors: report.pageErrors.length,
    shieldPartsSeen: [...new Set(report.shots.flatMap(s => (s.measured.shieldParts || []).map(p => p.name)))],
    shieldPartCount: report.shots.length ? report.shots[report.shots.length - 1].measured.shieldParts.length : 0,
    ringThicknessWorld: report.shots.length
      ? report.shots[report.shots.length - 1].measured.shieldParts
        .filter(p => /ring/i.test(p.name))
        .map(p => ({ name: p.name, size: p.size }))
      : []
  };
} catch (error) {
  report.status = 'failed';
  report.error = String(error.message || error);
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  status: report.status,
  error: report.error || null,
  renderPath: report.renderPath,
  summary: report.summary,
  unverified: report.unverified.map(u => ({ view: u.view, note: u.note })),
  pageErrors: report.pageErrors.slice(0, 5),
  console: report.console.slice(0, 8)
}, null, 2));
if (report.status === 'failed') process.exitCode = 1;
