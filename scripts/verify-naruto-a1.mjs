// Focused Naruto A1 live probe for states the roster-wide A0 gate does not prove:
//   1. sprint/run selection after the Shift-triggered dodge window;
//   2. form exit back to the base signature;
//   3. Rasenshuriken origin from the right hand; and
//   4. ultimate cast return-to-control after the live O key.
//
// This is supplemental to `verify-launch-roster.mjs` (match), `verify-naruto-49-state.mjs`
// (49-clip matrix), `verify-naruto-signatures.mjs` (forms) and `verify-naruto-combat.mjs`
// (keyboard combat). It does not replace any of them and it does not claim hardware acceptance.
// The transformed-KO/match-end edge is covered separately by
// `verify-naruto-transformed-ko.mjs`.
//
//   bash scripts/run-browser-test.sh scripts/verify-naruto-a1.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { HARDWARE_GPU, assertHardwareGpu, browserLaunchOptions, captureGpu, isSoftwareRenderer } from './lib/hardware-gpu.mjs';

const root = process.cwd();
const out = 'artifacts/a1-naruto';
await mkdir(out, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png'
};
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('nf');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};

const browser = await chromium.launch(browserLaunchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
const errors = [];
const failedRequests = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 260)));
page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || '' }));

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
  && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
const gpu = await captureGpu(page);
const softwareRenderer = isSoftwareRenderer(gpu);
console.log('GPU ' + JSON.stringify({ ...gpu, softwareRenderer }));
if (HARDWARE_GPU) assertHardwareGpu(gpu, 'Naruto A1 hardware acceptance');

await page.evaluate(() => {
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashSelect?.chooseArena('valley');
  window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false,
  null, { timeout: 20000, polling: 100 }).catch(() => {});
await page.waitForFunction(() => window.__bbLoading?.describe?.().visible === false,
  null, { timeout: 20000, polling: 100 }).catch(() => {});
await page.locator('canvas').first().click({ position: { x: 320, y: 220 }, force: true });
await page.waitForTimeout(400);

const step = async (seconds = 0.35) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) {
    await page.evaluate(dt => window.__browserSmashStep?.(dt), 0.05);
  }
};
const reset = () => page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  const [f, foe] = window.fighters;
  const ground = f.groundLevel ?? 0;
  for (const fighter of [f, foe]) {
    fighter.position.set(fighter === f ? 0 : 3.0, ground, -12);
    fighter.velocity?.set?.(0, 0, 0);
    fighter.isGrounded = true;
    fighter.hitstun = 0;
    fighter.guardBreak = 0;
    fighter.dodgeTimer = 0;
    fighter.guardHeld = false;
    fighter.attackQueue.length = 0;
    fighter.attackPose = 0;
    fighter.comboStep = 0;
    fighter.comboWindow = 0;
    fighter.ko = false;
    fighter.percent = 0;
  }
  f.facing = 1; f.facingZ = 0; f.power = 100; f.meter = 100;
  f.specialCooldown = 0; f.transformCooldown = 0; f.formLock = 0;
  f.transform = null;
  if (f.baseSpecialProfile) f.specialProfile = f.baseSpecialProfile;
  foe.invulnerable = 999;
  window.__browserSmashStep?.(0.2);
});
const read = () => page.evaluate(() => {
  const f = window.fighters[0];
  return {
    clip: f.model?.userData?.currentClip || f.animationController?._active || null,
    speed: +Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0).toFixed(2),
    grounded: Boolean(f.isGrounded),
    dodgeTimer: +(f.dodgeTimer || 0).toFixed(2),
    y: +f.position.y.toFixed(2),
    transform: f.transform ? { id: f.transform.form?.id || null, label: f.transform.label || null, landed: f.transform.landed === true } : null,
    special: String(f.specialProfile?.label || ''),
    casting: f.casting || null,
    meter: +(f.meter || 0).toFixed(0),
    formStage: f.formStage ?? null
  };
});

// ---- movement: walk, then sprint/run after the Shift dodge window -------------------------
await reset();
await page.keyboard.down('d');
await step(0.45);
const walk = await read();
await page.keyboard.up('d');
await step(0.15);
check('walk state selects the walk clip', walk.clip === 'walk' && walk.speed > 0.35,
  JSON.stringify(walk));

await reset();
await page.keyboard.down('Shift');
await page.keyboard.down('d');
await step(0.18);
const duringDodge = await read();
await step(0.8);
const sprint = await read();
await page.keyboard.up('d');
await page.keyboard.up('Shift');
await step(0.15);
check('sprint input moves with a grounded run/sprint clip after the dodge window',
  (sprint.clip === 'run' || sprint.clip === 'sprint') && sprint.speed > 0.35 && !sprint.dodgeTimer,
  JSON.stringify({ duringDodge, sprint }));
await page.screenshot({ path: `${out}/live-run.png` });

// ---- form exit: the special must return to the base signature ------------------------------
await reset();
await page.keyboard.press('i');
await step(0.8);
const form = await read();
await page.evaluate(() => { const f = window.fighters[0]; if (f.transform) f.transform.time = 0; });
await step(0.3);
const afterForm = await read();
check('transformation exits and restores RASENSHURIKEN',
  form.transform?.landed === true && afterForm.transform === null && /RASENSHURIKEN/.test(afterForm.special.toUpperCase()),
  JSON.stringify({ form, afterForm }));

// ---- signature projectile origin: right hand, no chest fallback ----------------------------
await reset();
await page.evaluate(() => {
  const [f, foe] = window.fighters;
  window.__browserSmashLastShot = null;
  f.specialCooldown = 0;
  foe.position.set(12, 0, -12); // keep the spinning projectile alive long enough to sample its origin
  f.facing = 1; f.facingZ = 0;
});
await page.keyboard.press('k');
// The authored Rasenshuriken owns a wind-up before the projectile spawns; sample after it releases.
await step(0.6);
const signature = await page.evaluate(() => ({
  shot: window.__browserSmashLastShot || null,
  projectiles: window.browserSmashProjectiles?.length || 0,
  cooldown: +(window.fighters[0].specialCooldown || 0).toFixed(2)
}));
check('signature launches from the right hand, not the chest',
  signature.shot?.policy === 'rightHand' && signature.shot?.fallback === false,
  JSON.stringify(signature));

// ---- ultimate: cast, spend meter, return control -------------------------------------------
await reset();
await page.evaluate(() => {
  const f = window.fighters[0];
  f.meter = 100; f.power = 100; f.casting = null; f.attackQueue.length = 0;
});
await page.keyboard.press('o');
await step(0.35);
const ultimateCast = await read();
await step(3.2);
const ultimateEnd = await read();
check('ultimate casts, spends meter and returns control',
  (ultimateCast.casting === 'ultimate' || ultimateCast.meter < 100)
    && ultimateEnd.casting === null && ultimateEnd.meter === 0,
  JSON.stringify({ ultimateCast, ultimateEnd }));
await page.screenshot({ path: `${out}/live-ultimate.png` });

// A KO during a transformation is covered by `verify-naruto-transformed-ko.mjs`, not this probe.
// That suite activates the form first, verifies the form is landed, forces a real one-round KO,
// checks the victory result, and starts the result-screen rematch. This probe keeps its focused
// form-exit and ultimate-return checks independent of that match-end path.

check('no page errors during the A1 probe', errors.length === 0, errors.slice(0, 3).join(' | '));
check('no failed asset requests during the A1 probe', failedRequests.length === 0, JSON.stringify(failedRequests.slice(0, 3)));

const report = {
  generatedAt: new Date().toISOString(),
  fighter: 'Naruto Uzumaki',
  hardwareMode: HARDWARE_GPU,
  hardwareVerified: HARDWARE_GPU,
  evidenceClass: HARDWARE_GPU
    ? 'live-browser hardware-GPU acceptance'
    : 'live-browser software (headless Chromium/SwiftShader)',
  gpu: { ...gpu, softwareRenderer },
  softwareRenderer,
  checks,
  samples: { walk, duringDodge, sprint, form, afterForm, signature, ultimateCast, ultimateEnd },
  errors,
  failedRequests
};
await writeFile(resolve(out, 'live-a1-probe.json'), JSON.stringify(report, null, 2) + '\n');
await browser.close();
server.close();
const failures = checks.filter(c => !c.ok);
console.log(`\nA1 PROBE ${checks.length - failures.length}/${checks.length} checks passed`);
if (failures.length || errors.length || failedRequests.length) process.exitCode = 1;
