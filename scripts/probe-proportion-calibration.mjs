// Bind-time proportion calibration acceptance.
//   bash scripts/run-browser-test.sh scripts/probe-proportion-calibration.mjs
//
// Verifies the real mounted bodies, not a standalone math module:
//   - Infantry (24-joint HD soldier), Aquaman (56-bone imported body) and Hulk (65-bone Biped)
//     publish a bind-time limb profile from their own skeleton.
//   - resting-arm targets and foot thresholds are derived from those profiles, not the old fixed
//     0.32 m / 0.30 m values.
//   - the calibrated foot layer plants feet during a live walk on all three bodies.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/proportion-calibration');
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
const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

const subjects = [
  { name: 'Infantry', slug: 'infantry', longLimbed: false },
  { name: 'Aquaman', slug: 'aquaman', longLimbed: false },
  { name: 'Hulk (Bruce Banner)', slug: 'hulk', longLimbed: true }
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
    page.on('pageerror', error => {
      const detail = String(error?.stack || error);
      errors.push(detail);
      console.error('PAGEERROR ' + detail);
    });
    page.on('console', message => {
      if (message.type() === 'error' && !/404 \(Not Found\)/.test(message.text())) {
        errors.push(message.text());
        console.error('CONSOLE ' + message.text());
      }
    });
    await page.route('https://unpkg.com/three@0.152.2/**', async route => {
      const url = new URL(route.request().url());
      const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
      try {
        await route.fulfill({
          status: 200, contentType: 'text/javascript; charset=utf-8',
          headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath)
        });
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
    await page.click(`#selectScreen .bs-card[data-fighter="${subject.name}"]`);
    await page.click('#selectScreen .bs-card[data-fighter="Kaze"]');
    await page.click('#selectScreen [data-nav="next"]');
    await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
    await page.evaluate(() => {
      window.__browserSmashSelect.setMode('2p');
      window.__browserSmashTrainingDummy = true;
    });
    await page.click('#play');
    await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting'
      && window.fighters?.[0]?.model?.userData?.rigCalibration
      && window.fighters[0].model.userData.currentClip, null, { timeout: 120_000, polling: 200 });
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p1.position.set(-7, p1.groundLevel || 0.18, -11);
      p2.position.set(7, p2.groundLevel || 0.18, -11);
      p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
      for (const f of [p1, p2]) {
        f.velocity.set(0, 0, 0);
        f.hitstun = 0;
        f.attackQueue.length = 0;
        f.guardBreak = 0;
        f.dodgeTimer = 0;
        f.isGrounded = true;
      }
      window.smashCamera?.spectate?.({ fighter: p1, framing: 'full', distance: 3.2, yaw: 45, pitch: 4 });
    });
    await page.evaluate(() => window.__browserSmashStep(0.8));

    const read = () => page.evaluate(() => {
      const f = window.fighters[0];
      const u = f.model?.userData || {};
      const cal = u.rigCalibration || f.animationController?.calibration || null;
      const targets = u.restingArmTargets || null;
      const report = u.locomotionReport || null;
      const heightOf = key => {
        const bone = u[key];
        if (!bone) return null;
        bone.updateWorldMatrix(true, false);
        return +bone.getWorldPosition(new window.__browserSmashThree.Vector3()).y.toFixed(4);
      };
      const shoulderY = heightOf('leftArm');
      const elbowY = heightOf('leftFore');
      return {
        identity: f.identity, state: f.state, clip: u.currentClip || null,
        calibration: cal, targets, report,
        elbow: shoulderY !== null && elbowY !== null ? +(elbowY - shoulderY).toFixed(4) : null,
        model: u.characterAssetUrl || u.modelUrl || null,
        controller: Boolean(f.animationController?.ready),
        feet: report?.feet || null
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
    const idle = await read();
    await snapCamera();
    await page.waitForTimeout(160);
    await page.screenshot({ path: resolve(out, `${subject.slug}-idle.png`) });
    console.log(`CAPTURE ${subject.slug} idle ${JSON.stringify(idle)}`);

    const cal = idle.calibration;
    check(`${subject.name} publishes a bind-time calibration`, cal?.source === 'bind',
      JSON.stringify(cal));
    check(`${subject.name} measures both arm segments`, cal?.arm?.upper > 0.12 && cal?.arm?.fore > 0.08,
      JSON.stringify(cal?.arm));
    check(`${subject.name} measures its bind-time shoulder width`,
      cal?.arm?.shoulderWidth > 0.20 && cal?.arm?.shoulderWidth < 0.90,
      JSON.stringify({ shoulderWidth: cal?.arm?.shoulderWidth, arm: cal?.arm }));
    check(`${subject.name} measures both leg segments`, cal?.leg?.upper > 0.20 && cal?.leg?.lower > 0.20,
      JSON.stringify(cal?.leg));
    check(`${subject.name} derives arm reach from its own segments`,
      close(cal.arm.reach, cal.arm.upper + cal.arm.fore, 0.002) && cal.arm.reach > 0.35,
      JSON.stringify(cal.arm));
    check(`${subject.name} derives the resting elbow drop from the upper arm`,
      close(cal.restingArm.drop, cal.arm.upper * 0.95, 0.002)
      && close(cal.restingArm.trigger, cal.arm.upper * 1.02, 0.002),
      JSON.stringify(cal.restingArm));
    check(`${subject.name} derives its shoulder-width rest offset and reach target`,
      close(cal.restingArm.side, Math.max(cal.arm.upper * 0.18, cal.arm.shoulderWidth * 0.13), 0.002)
      && close(cal.restingArm.reach, cal.arm.reach * 0.95, 0.002)
      && cal.restingArm.handRise >= 0.01
      && cal.restingArm.handRise <= Math.max(0.01, cal.arm.reach * 0.02) + 0.0001
      && close(cal.restingArm.elbow.min, cal.arm.upper * 0.55, 0.002)
      && close(cal.restingArm.elbow.max, cal.restingArm.drop, 0.002)
      && close(cal.restingArm.elbow.lateral, cal.arm.shoulderWidth * 0.03, 0.002),
      JSON.stringify(cal.restingArm));
    check(`${subject.name} publishes the resting-arm targets actually used`,
      idle.targets?.source === 'bind'
      && close(idle.targets.drop, cal.restingArm.drop, 0.002)
      && close(idle.targets.forward, cal.restingArm.forward, 0.002)
      && close(idle.targets.side, cal.restingArm.side, 0.002)
      && close(idle.targets.restReach, cal.restingArm.reach, 0.002)
      && close(idle.targets.handRise, cal.restingArm.handRise, 0.002)
      && close(idle.targets.elbowLimit, cal.restingArm.elbow.max, 0.002)
      && close(idle.targets.elbowLateral, cal.restingArm.elbow.lateral, 0.002),
      JSON.stringify(idle.targets));
    check(`${subject.name} settles its elbow toward the derived drop`,
      idle.elbow !== null && idle.targets?.leftTriggered
      && Math.abs(idle.elbow + idle.targets.drop) < 0.05,
      JSON.stringify({ elbow: idle.elbow, drop: idle.targets?.drop }));
    check(`${subject.name} derives foot thresholds from its measured contact height`,
      cal.foot.contactHeight > 0.02
      && close(cal.foot.drift, cal.leg.reach * 0.42, 0.002)
      && close(cal.foot.contactLimit, Math.min(cal.foot.contactHeight, cal.foot.walkContactHeight)
        + Math.max(0.06, cal.leg.reach * 0.08), 0.002)
      && close(cal.foot.vertical, Math.max(0.06, cal.leg.reach * 0.16), 0.002)
      && close(cal.foot.releaseHeight, cal.foot.contactHeight + Math.max(0.18, cal.leg.reach * 0.10), 0.002),
      JSON.stringify(cal.foot));

    if (subject.longLimbed) {
      check(`${subject.name} is the long-limbed calibration subject`,
        cal.arm.reach > 0.70 && cal.leg.reach > 0.88,
        JSON.stringify({ arm: cal.arm.reach, leg: cal.leg.reach, height: cal.height }));
    }

    // Walk: the calibrated foot layer must be live and report both legs and the derived thresholds.
    await page.keyboard.down('d');
    await page.evaluate(() => window.__browserSmashStep(0.55));
    // A walk cycle has an airborne beat; sample several sub-steps and accept the first frame with a
    // planted ankle. A single arbitrary phase is not a fair contact test on a longer-legged rig.
    let walking = await read();
    // Hulk's authored walk has a short contact phase; sample at real frame steps for up to three
    // seconds so a long-legged rig is not judged on the phase nearest the start of the walk.
    for (let i = 0; i < 180; i += 1) {
      await page.evaluate(() => window.__browserSmashStep(1 / 60));
      const sample = await read();
      walking = sample;
      if (sample.report?.feet?.some(foot => foot.contact)) break;
    }
    await snapCamera();
    await page.waitForTimeout(160);
    await page.screenshot({ path: resolve(out, `${subject.slug}-walk.png`) });
    await page.keyboard.up('d');
    console.log(`CAPTURE ${subject.slug} walk ${JSON.stringify(walking)}`);
    check(`${subject.name} foot layer is active during walk`,
      walking.report?.state === 'active' && walking.report?.calibration?.source === 'bind',
      JSON.stringify(walking.report));
    check(`${subject.name} foot layer uses the bind-time leg length`,
      walking.report?.calibration?.legReach > 0.2
      && close(walking.report.calibration.legReach, walking.report.legLength, 0.08),
      JSON.stringify({ legReach: walking.report?.calibration?.legReach, legLength: walking.report?.legLength }));
    check(`${subject.name} foot layer uses the calibrated contact thresholds`,
      walking.report?.calibration?.foot
      && close(walking.report.calibration.foot.contactHeight, cal.foot.contactHeight, 0.002)
      && close(walking.report.calibration.foot.drift, cal.foot.drift, 0.002)
      && close(walking.report.calibration.foot.contactLimit, cal.foot.contactLimit, 0.002),
      JSON.stringify(walking.report?.calibration?.foot));
    check(`${subject.name} plants a stance foot while walking`,
      walking.report?.feet?.some(foot => foot.contact)
      && walking.report.feet.filter(foot => foot.contact)
        .every(foot => foot.height > -0.08 && foot.height < 0.5),
      JSON.stringify(walking.report?.feet));
    check(`${subject.name} foot targets stay inside the measured leg reach`,
      walking.report?.feet?.every(foot => !foot.contact || foot.reach > 0.2
        && Number.isFinite(foot.slide)), JSON.stringify(walking.report?.feet));
    check(`${subject.name} stride cadence comes from the measured leg`,
      walking.report?.stride > 0.75 && walking.report?.stride < 1.25,
      JSON.stringify({ stride: walking.report?.stride, legLength: walking.report?.legLength }));
    check(`${subject.name} has no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));

    reports[subject.name] = { idle, walking, errors };
    await page.close();
  }

  const infantry = reports.Infantry.idle.calibration;
  const aquaman = reports.Aquaman.idle.calibration;
  const hulk = reports['Hulk (Bruce Banner)'].idle.calibration;
  check('the three rigs produce distinct arm reaches',
    new Set([infantry.arm.reach, aquaman.arm.reach, hulk.arm.reach].map(v => v.toFixed(2))).size === 3,
    JSON.stringify({ infantry: infantry.arm.reach, aquaman: aquaman.arm.reach, hulk: hulk.arm.reach }));
  check('the long-limbed Hulk reach exceeds the Infantry reach',
    hulk.arm.reach > infantry.arm.reach * 1.15,
    JSON.stringify({ hulk: hulk.arm.reach, infantry: infantry.arm.reach }));

  await writeFile(resolve(out, 'report.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    subjects: reports,
    checks
  }, null, 2) + '\n');
  console.log('SUMMARY ' + JSON.stringify({ checks: checks.length, subjects: subjects.map(s => s.name) }));
} finally {
  await browser?.close();
  server.close();
}
