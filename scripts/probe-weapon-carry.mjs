// State-aware weapon carry/stow acceptance for Thor and Kaze.
//   bash scripts/run-browser-test.sh scripts/probe-weapon-carry.mjs
//
// Each subject is selected as P1 in a real 2P match. The mixer is frozen for each capture so the
// image and the measured hand/weapon transforms describe the same frame.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/weapon-carry');
await mkdir(out, { recursive: true });
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
    res.writeHead(404); res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const checks = [];
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks.push(name);
  console.log(`  ok  ${name}${detail ? ' — ' + detail : ''}`);
}

const subjects = [
  { name: 'Thor', p1: 'Thor', p2: 'Kaze' },
  { name: 'Kaze', p1: 'Kaze', p2: 'Thor' }
];

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const reports = {};

  for (const subject of subjects) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(180_000);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error?.stack || error)));
    page.on('console', message => {
      if (message.type() === 'error' && !/404 \(Not Found\)/.test(message.text())) errors.push(message.text());
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
    await page.click(`#selectScreen .bs-card[data-fighter="${subject.p1}"]`);
    await page.click(`#selectScreen .bs-card[data-fighter="${subject.p2}"]`);
    await page.click('#selectScreen [data-nav="next"]');
    await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
    await page.evaluate(() => {
      window.__browserSmashSelect.setMode('2p');
      window.__browserSmashTrainingDummy = true;
    });
    await page.click('#play');
    await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting'
      && window.__browserSmashSetWeaponCarry && window.fighters[0].model?.userData?.weaponKind,
      null, { timeout: 120_000, polling: 200 });

    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p1.position.set(-7, p1.groundLevel || 0, -11);
      p2.position.set(7, p2.groundLevel || 0, -11);
      p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
      for (const f of [p1, p2]) {
        f.velocity.set(0, 0, 0);
        f.hitstun = 0;
        f.attackQueue.length = 0;
        f.guardBreak = 0;
        f.dodgeTimer = 0;
        f.weaponStowed = false;
        f.isGrounded = true;
      }
      window.smashCamera?.spectate?.({ fighter: p1, framing: 'full', distance: 3.2, yaw: 45, pitch: 3 });
    });
    await page.evaluate(() => window.__browserSmashStep(0.5));

    const read = () => page.evaluate(() => {
      const f = window.fighters[0];
      const u = f.model?.userData || {};
      const world = bone => {
        if (!bone) return null;
        bone.updateWorldMatrix(true, false);
        const e = bone.matrixWorld.elements;
        return [e[12], e[13], e[14]].map(v => +v.toFixed(3));
      };
      const handGap = (() => {
        const left = world(u.leftHand), right = world(u.rightHand);
        return left && right ? +Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]).toFixed(3) : null;
      })();
      const holder = u.equippedWeaponRight?.parent;
      return {
        identity: f.identity, state: f.state, stowed: Boolean(f.weaponStowed),
        carry: window.__browserSmashAssets?.weaponCarry?.[f.identityKey] || u.weaponCarry || null,
        clearance: u.weaponCarryClearance || null,
        handGap,
        hands: { left: world(u.leftHand), right: world(u.rightHand) },
        shoulders: { left: world(u.leftArm), right: world(u.rightArm) },
        holder: holder ? {
          local: holder.position.toArray().map(v => +v.toFixed(3)),
          visible: holder.visible
        } : null,
        arms: {
          leftArm: u.leftArm?.quaternion.toArray().map(v => +v.toFixed(4)) || null,
          rightArm: u.rightArm?.quaternion.toArray().map(v => +v.toFixed(4)) || null,
          leftFore: u.leftFore?.quaternion.toArray().map(v => +v.toFixed(4)) || null,
          rightFore: u.rightFore?.quaternion.toArray().map(v => +v.toFixed(4)) || null
        },
        weaponKind: u.weaponKind || null, weaponLabel: u.weaponLabel || null
      };
    });

    const snapCamera = () => page.evaluate(() => {
      const f = window.fighters[0];
      const cam = window.__browserSmashCamera;
      cam.position.set(f.position.x + 2.55, f.position.y + 1.18, f.position.z + 2.55);
      cam.lookAt(f.position.x, f.position.y + 1.02, f.position.z);
      cam.updateMatrixWorld(true);
      window.__browserSmashRenderer.render(window.__browserSmashScene, cam);
    });
    const freeze = () => page.evaluate(() => {
      window.__browserSmashSetPaused(true);
      const f = window.fighters[0];
      const mixer = f.model?.userData?.humanMixer;
      if (mixer) mixer.timeScale = 0;
    });
    const unfreeze = () => page.evaluate(() => {
      window.__browserSmashSetPaused(false);
      const f = window.fighters[0];
      const mixer = f.model?.userData?.humanMixer;
      if (mixer) mixer.timeScale = 1;
    });
    const resetPose = async () => {
      await unfreeze();
      await page.evaluate(() => {
        const [p1, p2] = window.fighters;
        p1.position.set(-7, p1.groundLevel || 0, -11);
        p2.position.set(7, p2.groundLevel || 0, -11);
        p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
        for (const f of [p1, p2]) {
          f.velocity.set(0, 0, 0);
          f.hitstun = 0;
          f.attackQueue.length = 0;
          f.guardBreak = 0;
          f.dodgeTimer = 0;
          f.weaponStowed = false;
          f.isGrounded = true;
        }
      });
      await page.evaluate(() => window.__browserSmashStep(0.35));
    };
    const capture = async (label) => {
      await page.evaluate(() => window.__browserSmashStep(0.016));
      await snapCamera();
      await page.waitForTimeout(160);
      const report = await read();
      await page.screenshot({ path: resolve(out, `${subject.name.toLowerCase()}-${label}.png`) });
      console.log('CAPTURE ' + subject.name + ' ' + label + ' ' + JSON.stringify(report));
      return report;
    };

    // Idle is a hard no-op: same arm quaternions with the layer bypassed and enabled.
    await resetPose();
    await freeze();
    await page.evaluate(() => window.__browserSmashSetWeaponCarry(false));
    const idleBefore = await capture('idle-off');
    await page.evaluate(() => window.__browserSmashSetWeaponCarry(true));
    const idleAfter = await capture('idle');
    const armDelta = ['leftArm', 'rightArm', 'leftFore', 'rightFore'].reduce((max, key) => {
      const a = idleBefore.arms[key], b = idleAfter.arms[key];
      if (!a || !b) return max;
      return Math.max(max, ...a.map((v, i) => Math.abs(v - b[i])));
    }, 0);
    check(`${subject.name} idle arms are byte-close with the layer on`, armDelta < 0.002, String(armDelta));
    check(`${subject.name} idle reports untouched arms`, idleAfter.carry?.idleArmsUntouched === true,
      JSON.stringify(idleAfter.carry));

    // Carry: walk input produces the carry pose and a mounted weapon.
    await unfreeze();
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.weaponStowed = false;
      f.velocity.set(0, 0, 0);
    });
    await page.keyboard.down('d');
    await page.evaluate(() => window.__browserSmashStep(0.55));
    await freeze();
    const carry = await capture('carry');
    await page.keyboard.up('d');
    check(`${subject.name} carries while walking`, /^carry|two-handed-carry$/.test(String(carry.carry?.mode)),
      JSON.stringify(carry.carry));
    check(`${subject.name} carry keeps the weapon visible and mounted`, carry.holder?.visible !== false && carry.holder?.local,
      JSON.stringify(carry.holder));
    check(`${subject.name} carry reports body/camera clearance`, carry.clearance
      && Number.isFinite(carry.clearance.bodyGap) && Number.isFinite(carry.clearance.cameraGap),
      JSON.stringify(carry.clearance));

    // Two-handed grip: guard raises the offhand to the right hand.
    await unfreeze();
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.velocity.set(0, 0, 0);
      f.weaponStowed = false;
    });
    await page.evaluate(() => window.__browserSmashStep(0.25));
    await page.keyboard.down('e');
    await page.evaluate(() => window.__browserSmashStep(0.30));
    await freeze();
    const twoHanded = await capture('two-handed');
    await page.keyboard.up('e');
    check(`${subject.name} guard selects the two-handed pose`, twoHanded.carry?.mode === 'two-handed',
      JSON.stringify(twoHanded.carry));
    check(`${subject.name} two-handed hands meet on the grip`, twoHanded.handGap !== null && twoHanded.handGap < 0.26,
      String(twoHanded.handGap));

    // Stow: G puts the weapon on the back and leaves the hands to the body clip.
    await unfreeze();
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.velocity.set(0, 0, 0);
      f.weaponStowed = false;
    });
    await page.evaluate(() => window.__browserSmashStep(0.25));
    await page.keyboard.press('g');
    await page.evaluate(() => window.__browserSmashStep(0.30));
    await freeze();
    const stowed = await capture('stow');
    check(`${subject.name} G selects the stow pose`, stowed.carry?.mode === 'stow' && stowed.stowed === true,
      JSON.stringify(stowed.carry));
    check(`${subject.name} stow mounts the weapon behind the torso`, stowed.holder?.local?.[2] < -0.08,
      JSON.stringify(stowed.holder));
    check(`${subject.name} stow does not touch the idle arm layer`, stowed.carry?.idleArmsUntouched === true,
      JSON.stringify(stowed.carry));

    // Draw again, then verify that a guard input draws a stowed weapon before posing.
    await unfreeze();
    await page.keyboard.press('g');
    await page.evaluate(() => window.__browserSmashStep(0.25));
    await freeze();
    const drawn = await capture('drawn');
    check(`${subject.name} G restores the hand mount`, drawn.stowed === false && drawn.carry?.mode !== 'stow'
      && drawn.holder?.local?.[2] > -0.08, JSON.stringify({ stowed: drawn.stowed, carry: drawn.carry, holder: drawn.holder }));
    await unfreeze();
    await page.keyboard.press('g');
    await page.evaluate(() => window.__browserSmashStep(0.20));
    await page.keyboard.down('e');
    await page.evaluate(() => window.__browserSmashStep(0.30));
    await freeze();
    const drawnByGuard = await capture('guard-draw');
    await page.keyboard.up('e');
    check(`${subject.name} guard draws a stowed weapon`, drawnByGuard.stowed === false
      && drawnByGuard.carry?.mode === 'two-handed', JSON.stringify(drawnByGuard.carry));
    check(`${subject.name} has no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));

    reports[subject.name] = { idleBefore, idleAfter, carry, twoHanded, stowed, armDelta, errors };
    await page.close();
  }

  await writeFile(resolve(out, 'report.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), subjects: reports, checks
  }, null, 2) + '\n');
  console.log('SUMMARY ' + JSON.stringify({ checks: checks.length, subjects: subjects.map(s => s.name) }));
} finally {
  await browser?.close();
  server.close();
}
