// Audit the shared resting-arm settle across the whole select roster.
//
// For every fighter it freezes the idle at one phase, temporarily bypasses the settle, records the
// raw clip pose, then re-enables the settle and records the posed result. The bypass is injected
// into the module request at test time; no game source is modified.
//
//   PLAYWRIGHT_BROWSERS_PATH=.tools/playwright/browsers bash scripts/run-browser-test.sh \
//     scripts/audit-arm-settle.mjs --mode=preview --tag=roster
//
// Output: artifacts/arm-settle-audit/<tag>/report.json + screenshots.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = argv.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const TAG = flag('tag', 'roster');
const MODE = flag('mode', 'preview');
const SHOTS = flag('shots', 'none');
const LIMIT = Number(flag('limit', '0')) || Infinity;
const OFFSET = Number(flag('offset', '0')) || 0;
const NAMES = (flag('names', '') || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
const out = resolve(root, 'artifacts/arm-settle-audit', TAG);
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
const page = await browser.newPage({ viewport: { width: 1000, height: 820 } });
const cdp = await page.context().newCDPSession(page);
const INITIAL_DISABLE = argv.includes('--disable-from-start');
if (INITIAL_DISABLE) await page.addInitScript(() => { globalThis.__armSettleDisabled = true; });
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error?.message || error).slice(0, 240)));
page.on('console', message => {
  if (message.type() === 'error') pageErrors.push('console: ' + message.text().slice(0, 200));
});
// Test-only bypass. The real runtime never sets this flag.
await page.route('**/resting_arms.js*', async route => {
  const response = await route.fetch();
  const source = await response.text();
  const patched = source.replace(
    'export function settleRestingArms(root) {',
    `export function settleRestingArms(root) {
  const rawUserData = root?.userData;
  if (rawUserData?.leftArm && rawUserData.rightArm && !rawUserData.__rawArmQ) {
    rawUserData.__rawArmQ = [rawUserData.leftArm.quaternion.clone(), rawUserData.rightArm.quaternion.clone()];
  }
  if (globalThis.__armSettleDisabled === true) return false;`
  );
  await route.fulfill({ response, body: patched });
});

await page.goto(origin + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__browserSmashSelect && window.characterRosters?.all?.length),
  null, { timeout: 120_000, polling: 100 });
await page.click('#bbTitle [data-nav="versus"]').catch(() => {});
await page.waitForTimeout(500);
await page.evaluate(() => window.__browserSmashSelect.show());

const roster = await page.evaluate(() => window.characterRosters.all.map(([name, archetype]) => ({ name, archetype })));
const filtered = NAMES.length
  ? roster.filter(entry => NAMES.some(name => entry.name.toLowerCase() === name || entry.name.toLowerCase().includes(name)))
  : roster;
const selected = filtered.slice(OFFSET, OFFSET + LIMIT);
console.log(`ROSTER ${roster.length} AUDIT ${selected.length}`);

const shot = async file => {
  // Direct CDP capture skips Playwright's per-shot font wait; the clip is the preview canvas.
  const canvas = page.locator('#selectScreen [data-role="previewcanvas"]');
  const box = await canvas.count() ? await canvas.boundingBox() : null;
  const params = { format: 'png', captureBeyondViewport: false };
  if (box) params.clip = { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 };
  const { data } = await cdp.send('Page.captureScreenshot', params);
  await writeFile(file, Buffer.from(data, 'base64'));
};

const measure = () => page.evaluate(() => {
  const debug = window.__fighterPreviewDebug;
  const root = debug?.root;
  const rig = debug?.rig;
  const joints = rig?.joints;
  if (!root || !joints?.leftArm || !joints.rightArm || !joints.leftFore || !joints.rightFore) {
    return { error: 'no preview rig', bones: debug?.bones || 0, idle: debug?.idle || null };
  }
  root.updateMatrixWorld(true);
  const THREE = window.__browserSmashThree;
  const wp = node => node.getWorldPosition(new THREE.Vector3());
  const local = node => root.worldToLocal(wp(node));
  const L = joints.leftArm, R = joints.rightArm, LF = joints.leftFore, RF = joints.rightFore;
  const LH = joints.leftHand, RH = joints.rightHand;
  const ls = wp(L), rs = wp(R), le = wp(LF), re = wp(RF);
  const lh = LH ? wp(LH) : null, rh = RH ? wp(RH) : null;
  const ll = local(L), rl = local(R), lel = local(LF), rel = local(RF);
  const calibration = root.userData?.rigCalibration || null;
  const lateral = ll.clone().sub(rl).setY(0);
  if (lateral.lengthSq() < 1e-8) lateral.set(1, 0, 0); else lateral.normalize();
  const side = (elbow, shoulder) => elbow.clone().sub(shoulder).setY(0).dot(lateral);
  const shoulderY = ls.y;
  const bones = (() => {
    const names = [];
    root.traverse(node => { if (node.isBone && node.name) names.push(node.name); });
    names.sort();
    return { count: names.length, names };
  })();
  const skeletonBones = (() => {
    let count = 0;
    root.traverse(node => { if (node.isSkinnedMesh && node.skeleton?.bones) count = Math.max(count, node.skeleton.bones.length); });
    return count;
  })();
  return {
    idle: debug.idle || null,
    rigKind: rig.kind || null,
    bones: debug.bones || bones.count,
    skeletonBones,
    handles: [L.name, LF.name],
    shoulderY: +shoulderY.toFixed(3),
    shoulderSide: +(ll.x - rl.x).toFixed(3),
    shoulderSpan: +ls.distanceTo(rs).toFixed(4),
    upperArm: +((le.distanceTo(ls) + re.distanceTo(rs)) / 2).toFixed(4),
    forearm: +((lh ? lh.distanceTo(le) : 0) + (rh ? rh.distanceTo(re) : 0)) / 2 || null,
    calibration: calibration ? {
      source: calibration.source,
      scale: calibration.scale,
      height: calibration.height,
      arm: calibration.arm,
      restingArm: calibration.restingArm,
      unit: calibration.unit
    } : null,
    elbow: [LF, RF].map(n => +(wp(n).y - shoulderY).toFixed(4)),
    hand: [LH, RH].map(n => (n ? +(wp(n).y - shoulderY).toFixed(4) : null)),
    elbowSide: [side(lel, ll), side(rel, rl)].map(v => +v.toFixed(4)),
    handSide: [LH ? side(local(LH), ll) : null, RH ? side(local(RH), rl) : null],
    elbowLocal: [lel.toArray(), rel.toArray()].map(a => a.map(v => +v.toFixed(4))),
    handLocal: [LH ? local(LH).toArray() : null, RH ? local(RH).toArray() : null],
    boneSignature: bones.names.join('|')
  };
});

const rows = [];
const save = async () => {
  const report = {
    generatedAt: new Date().toISOString(), tag: TAG, mode: MODE,
    renderer: 'SwiftShader', rosterCount: roster.length, offset: OFFSET,
    preview: rows, pageErrors: [...new Set(pageErrors)]
  };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
};

if (MODE === 'preview' || MODE === 'all') {
for (const [index, entry] of selected.entries()) {
  const { name } = entry;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const row = { index: OFFSET + index, name, archetype: entry.archetype };
  try {
    await page.evaluate(() => window.__browserSmashSelect.show());
    await page.evaluate(candidate => window.__browserSmashSelect.select('p1', candidate), name);
    await page.waitForFunction(({ name }) => {
      const status = document.querySelector('[data-role="previewstatus"]');
      return window.__browserSmashSelect?.state?.p1 === name
        && status?.dataset?.state && !['loading', 'missing'].includes(status.dataset.state);
    }, { name }, { timeout: 90_000, polling: 100 });
    await page.waitForTimeout(900);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const status = await page.evaluate(() => {
      const node = document.querySelector('[data-role="previewstatus"]');
      return { state: node?.dataset?.state || null, text: node?.textContent?.trim() || null,
        clips: node?.dataset?.clips || null };
    });
    row.status = status;
    if (status.state === 'fallback' || status.state === 'missing') {
      row.skipped = 'no rigged preview: ' + status.text;
      rows.push(row); await save();
      console.log('SKIP ' + JSON.stringify(row));
      continue;
    }
    // Pin the mixer at its current idle phase so the bypass and the settle are compared on the
    // same clip frame. The bypass only skips the post-mixer arm write.

    const before = await page.evaluate(() => {
      globalThis.__armSettleDisabled = true;
      const debug = window.__fighterPreviewDebug;
      if (debug?.mixer) debug.mixer.timeScale = 0;
      const raw = debug?.root?.userData?.__rawArmQ;
      if (!raw || !debug?.rig?.joints?.leftArm || !debug?.rig?.joints?.rightArm) return false;
      debug.rig.joints.leftArm.quaternion.copy(raw[0]);
      debug.rig.joints.rightArm.quaternion.copy(raw[1]);
      debug.root.updateMatrixWorld(true);
      return true;
    });
    if (!before) throw new Error('could not restore raw arm pose');
    row.before = await measure();
    if (row.before?.error) {
      rows.push(row); await save();
      console.log('ERROR ' + JSON.stringify(row));
      continue;
    }
    if (SHOTS === 'all' || SHOTS === 'transitions') {
      const beforeFile = resolve(out, `before-${String(OFFSET + index).padStart(2, '0')}-${slug}.png`);
      await shot(beforeFile);
      row.beforeFile = beforeFile.replace(root + sep, '');
    }

    await page.evaluate(() => {
      globalThis.__armSettleDisabled = false;
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    row.after = await measure();
    if (SHOTS !== 'none') {
      const afterFile = resolve(out, `after-${String(OFFSET + index).padStart(2, '0')}-${slug}.png`);
      await shot(afterFile);
      row.afterFile = afterFile.replace(root + sep, '');
    }

    // Geometry of the change. Triggers use the raw pose; a settled arm should move the elbow down
    // or stay put. A hand that rises or an elbow that flips across the torso is the regression
    // shape this audit is looking for.
    const trig = [0, 1].map(i => row.before.elbow[i] >= -0.30);
    const dElbow = [0, 1].map(i => +(row.after.elbow[i] - row.before.elbow[i]).toFixed(4));
    const dHand = [0, 1].map(i => row.before.hand[i] == null || row.after.hand[i] == null
      ? null : +(row.after.hand[i] - row.before.hand[i]).toFixed(4));
    // elbowSide is measured outward from that shoulder, so an elbow inside the torso is negative
    // on the left and positive on the right. Moving from inside to outside is the settle doing its
    // job; only a move from outside to inside is a torso crossing.
    const insideTorso = (i, value) => i === 0 ? value < -0.005 : value > 0.005;
    const sideFlip = [0, 1].map(i => !insideTorso(i, row.before.elbowSide[i])
      && insideTorso(i, row.after.elbowSide[i]));
    const changed = dElbow.some(v => Math.abs(v) > 0.001) || dHand.some(v => v != null && Math.abs(v) > 0.001);
    const flags = [];
    for (const i of [0, 1]) {
      if (!trig[i]) continue;
      if (dElbow[i] > 0.005) flags.push(`${i ? 'R' : 'L'} elbow rose ${dElbow[i]} m`);
      if (dHand[i] != null && dHand[i] > 0.02) flags.push(`${i ? 'R' : 'L'} hand rose ${dHand[i]} m`);
      if (sideFlip[i]) flags.push(`${i ? 'R' : 'L'} elbow crossed into the torso`);
      if (dElbow[i] < -0.45) flags.push(`${i ? 'R' : 'L'} elbow over-dropped ${(-dElbow[i]).toFixed(2)} m`);
    }
    const asym = trig[0] !== trig[1] && Math.abs(dElbow[0] - dElbow[1]) > 0.15;
    if (asym) flags.push('one arm settled far more than the other');
    row.trigger = trig;
    row.delta = { elbow: dElbow, hand: dHand };
    row.changed = changed;
    row.flags = flags;
    rows.push(row);
    await save();
    console.log('AUDIT ' + JSON.stringify({ index: row.index, name, status, trigger: trig,
      before: { elbow: row.before.elbow, hand: row.before.hand },
      after: { elbow: row.after.elbow, hand: row.after.hand }, delta: row.delta, flags,
      skeletonBones: row.after.skeletonBones, bones: row.after.bones, rigKind: row.after.rigKind }));

  } catch (error) {
    row.error = String(error?.message || error).slice(0, 400);
    rows.push(row);
    await save();
    console.log('FAIL ' + JSON.stringify(row));
  }
}
}

// One live idle per actual skeleton type. The action is disabled before the match is created, so
// the before frame is the untouched clip pose; enabling it afterwards tests the real live path.
const LIVE_REPS = [
  ['Kaze', 'shared-19'], ['Infantry', 'Infantry-24'], ['Arnold Schwarzenegger', 'Arnold-53'],
  ['Superman', 'Superman-82'], ['Hulk (Bruce Banner)', 'Hulk-65'],
  ['Green Lantern (Hal Jordan)', 'GreenLantern-59'], ['The Flash (Barry Allen)', 'Flash-66'],
  ['Aquaman', 'Aquaman-56'], ['Doctor Strange', 'DoctorStrange-228'], ['Goku', 'Goku-73'],
  ['Vegeta', 'Vegeta-311'], ['Saitama', 'Saitama-158'], ['Luigi', 'Luigi-91'],
  ['Link', 'Link-202'], ['Lord Voldemort', 'Voldemort-68'], ['Spider-Man', 'SpiderMan-178'],
  ['Iron Spider', 'IronSpider-107'], ['Naruto Uzumaki', 'Naruto-19'],
  ['Mario', 'shared-19-Mario']
];
const liveSelected = (NAMES.length
  ? LIVE_REPS.filter(([name]) => NAMES.some(n => name.toLowerCase() === n || name.toLowerCase().includes(n)))
  : LIVE_REPS).slice(OFFSET, OFFSET + LIMIT);
const liveRows = [];
const saveLive = async () => {
  const report = {
    generatedAt: new Date().toISOString(), tag: TAG, mode: MODE,
    renderer: 'SwiftShader', preview: rows, live: liveRows,
    pageErrors: [...new Set(pageErrors)]
  };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
};
const measureLive = () => page.evaluate(() => {
  const THREE = window.__browserSmashThree;
  const f = window.fighters?.[0];
  const root = f?.model;
  const u = root?.userData;
  if (!root || !u?.leftArm || !u.rightArm || !u.leftFore || !u.rightFore) {
    return { error: 'no live rig', clip: u?.currentClip || null };
  }
  root.updateMatrixWorld(true);
  const wp = node => node.getWorldPosition(new THREE.Vector3());
  const local = node => root.worldToLocal(wp(node));
  const L = u.leftArm, R = u.rightArm, LF = u.leftFore, RF = u.rightFore;
  const LH = u.leftHand, RH = u.rightHand;
  const ll = local(L), rl = local(R), lel = local(LF), rel = local(RF);
  const lateral = ll.clone().sub(rl).setY(0);
  if (lateral.lengthSq() < 1e-8) lateral.set(1, 0, 0); else lateral.normalize();
  const side = (elbow, shoulder) => elbow.clone().sub(shoulder).setY(0).dot(lateral);
  const shoulderY = wp(L).y;
  const bones = [];
  root.traverse(node => { if (node.isBone && node.name) bones.push(node.name); });
  bones.sort();
  let skeletonBones = 0;
  root.traverse(node => { if (node.isSkinnedMesh && node.skeleton?.bones) skeletonBones = Math.max(skeletonBones, node.skeleton.bones.length); });
  const running = (u.humanMixer?._actions || []).filter(a => a.isRunning() && a.getEffectiveWeight() > 0.05).map(a => a.getClip().name);
  return {
    identity: f.identity, clip: u.currentClip || null, actions: running,
    idle: u.idleAction?.getClip?.()?.name || null,
    ownership: u.clipOwnership || null,
    bones: bones.length, skeletonBones, shoulderY: +shoulderY.toFixed(3),
    elbow: [LF, RF].map(n => +(wp(n).y - shoulderY).toFixed(4)),
    hand: [LH, RH].map(n => (n ? +(wp(n).y - shoulderY).toFixed(4) : null)),
    elbowSide: [side(lel, ll), side(rel, rl)].map(v => +v.toFixed(4)),
    handSide: [LH ? side(local(LH), ll) : null, RH ? side(local(RH), rl) : null],
    handLocal: [LH ? local(LH).toArray() : null, RH ? local(RH).toArray() : null],
    boneSignature: bones.join('|')
  };
});

if (MODE === 'live' || MODE === 'all') {
  for (const [index, entry] of liveSelected.entries()) {
    const [name, family] = entry;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const row = { index, name, family };
    try {
      await page.evaluate(() => {
        globalThis.__armSettleDisabled = true;
        window.__browserSmashSelect.show();
        window.__browserSmashSelect.select('p1', 'Goku');
        window.__browserSmashSelect.select('p2', 'Vegeta');
        window.__browserSmashSelect.chooseArena?.('tournament');
      });
      await page.evaluate(candidate => window.__browserSmashSelect.select('p1', candidate), name);
      await page.evaluate(() => document.querySelector('#play')?.click());
      await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'),
        null, { timeout: 60_000, polling: 100 });
      await page.evaluate(() => window.__browserSmashSkipCinematic?.());
      await page.waitForFunction(({ name }) => {
        const f = window.fighters?.[0];
        const u = f?.model?.userData;
        return f?.identity === name && u?.idleAction && (u.idleAction.getClip()?.name || '').length > 0;
      }, { name }, { timeout: 120_000, polling: 150 });
      await page.evaluate(() => {
        window.__browserSmashTrainingDummy = true;
        window.__browserSmashFreezeAI = true;
        window.__browserSmashStep(1.2);
        const f = window.fighters[0];
        f.position.set(0, 0, 0);
        f.velocity.set(0, 0, 0);
        if (f.model.userData?.humanMixer) f.model.userData.humanMixer.timeScale = 0;
        window.smashCamera.spectate({ fighter: f, framing: 'full', yaw: 0, pitch: 4 });
      });
      await page.waitForTimeout(900);
      // Freeze the simulation at the idle frame. The before pose is untouched because the settle
      // was disabled before the match was created.
      await page.evaluate(() => window.__browserSmashSetPaused?.(true));
      row.before = await measureLive();
      if (row.before?.error) {
        liveRows.push(row); await saveLive();
        console.log('LIVE ERROR ' + JSON.stringify(row));
        continue;
      }
      const beforeFile = resolve(out, `live-before-${String(index).padStart(2, '0')}-${slug}.png`);
      await shot(beforeFile);
      row.beforeFile = beforeFile.replace(root + sep, '');
      // Run the same helper the live path uses, on this exact frozen pose. Ownership and the
      // idle/locomotion gate are reproduced here rather than bypassed.
      await page.evaluate(async () => {
        globalThis.__armSettleDisabled = false;
        const f = window.fighters?.[0];
        const root = f?.model;
        const u = root?.userData;
        if (!root || !u || u.clipOwnership?.arms) return;
        if (!/idle|stand|walk|run|sprint|strafe|locomotion/i.test(String(u.currentClip || ''))) return;
        const module = await import('/public/js/anim/resting_arms.js');
        module.settleRestingArms(root);
        root.updateMatrixWorld(true);
      });
      row.after = await measureLive();
      const afterFile = resolve(out, `live-after-${String(index).padStart(2, '0')}-${slug}.png`);
      await shot(afterFile);
      row.afterFile = afterFile.replace(root + sep, '');
      await page.evaluate(() => window.__browserSmashSetPaused?.(false));
      const trig = [0, 1].map(i => row.before.elbow[i] >= -0.30);
      const dElbow = [0, 1].map(i => +(row.after.elbow[i] - row.before.elbow[i]).toFixed(4));
      const dHand = [0, 1].map(i => row.before.hand[i] == null || row.after.hand[i] == null ? null : +(row.after.hand[i] - row.before.hand[i]).toFixed(4));
      row.trigger = trig;
      row.delta = { elbow: dElbow, hand: dHand };
      row.changed = dElbow.some(v => Math.abs(v) > 0.001) || dHand.some(v => v != null && Math.abs(v) > 0.001);
      liveRows.push(row);
      await saveLive();
      console.log('LIVE ' + JSON.stringify({ index, name, family, ownership: row.before.ownership,
        trigger: trig, before: { elbow: row.before.elbow, hand: row.before.hand },
        after: { elbow: row.after.elbow, hand: row.after.hand }, delta: row.delta,
        bones: row.after.bones, skeletonBones: row.after.skeletonBones, clip: row.before.clip }));
    } catch (error) {
      row.error = String(error?.message || error).slice(0, 400);
      liveRows.push(row);
      await saveLive();
      console.log('LIVE FAIL ' + JSON.stringify(row));
    }
  }
}

await saveLive();
console.log('SUMMARY ' + JSON.stringify({ preview: rows.length, live: liveRows.length,
  changed: rows.filter(r => r.changed).length,
  flagged: rows.filter(r => r.flags?.length).length,
  errors: rows.filter(r => r.error).length + liveRows.filter(r => r.error).length,
  pageErrors: [...new Set(pageErrors)] }));
await browser.close();
server.close();
