// Focused live acceptance for the promoted Mario Happi body.
// The full verify-hd-fighter.mjs pass already captured the inspection/match frames and measured
// walk/run/jump states; this shorter pass exists because that harness exceeds the cloud command
// window after the imported body adds a second animation set. It checks the promoted asset path,
// the 25 retargeted clips and a real landed hit through the normal input path, then exits.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const out = 'artifacts/hd-fighter/mario';
await mkdir(out, { recursive: true });
const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = {};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  // Exercise the real roster path, not the body-swap review path: Mario is persisted as P1 and
  // Goku as CPU exactly as the selection screen does before the title is shown.
  await page.addInitScript(() => {
    localStorage.setItem('browserSmashP1', 'Mario');
    localStorage.setItem('browserSmashCPU', 'Goku');
  });
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 80000, polling: 250 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/final-title.png` });
  // Open the actual character-select screen and select Mario through its public API. This is the
  // view a player sees before a match, not a body-swap review route.
  await page.evaluate(() => document.querySelector('[data-nav="versus"]')?.click());
  try {
    await page.waitForSelector('#selectScreen', { state: 'visible', timeout: 15000 });
    await page.evaluate(() => window.__browserSmashSelect?.select('p1', 'Mario'));
    await page.waitForFunction(() => {
      const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
      return status && ['ready', 'fallback', 'unavailable'].includes(status.dataset.state);
    }, null, { timeout: 30000, polling: 200 });
    const previewState = await page.evaluate(() => {
      const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
      const canvas = document.querySelector('#selectScreen [data-role="previewcanvas"]');
      return { state: status?.dataset.state || 'missing', text: status?.textContent || '', width: canvas?.clientWidth || 0, height: canvas?.clientHeight || 0 };
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/final-selection.png` });
    report.preview = previewState;
    check('character-select preview renders Mario', previewState.state === 'ready' && previewState.width > 0, JSON.stringify(previewState));
    await page.evaluate(() => document.querySelector('#selectScreen')?.classList.add('hidden'));
  } catch (error) {
    report.preview = { error: String(error?.message || error) };
    check('character-select preview renders Mario', false, report.preview.error);
    await page.evaluate(() => document.querySelector('#selectScreen')?.classList.add('hidden'));
  }
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
    document.querySelector('#play')?.click();
  });
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
  await page.waitForTimeout(1800);

  const body = await page.evaluate(() => {
    const fighter = window.fighters[0];
    const model = fighter.model;
    let meshes = 0, skinned = 0;
    const clips = new Set();
    model?.traverse(node => {
      if (node.isSkinnedMesh) skinned += 1;
      if (node.isMesh) meshes += 1;
    });
    const mixer = model?.userData?.humanMixer;
    if (mixer) for (const action of mixer._actions || []) clips.add(action._clip?.name || action.getClip?.().name);
    const jointNames = ['pelvis', 'torso', 'head', 'leftArm', 'rightArm', 'leftFore', 'rightFore', 'leftLeg', 'rightLeg', 'leftShin', 'rightShin'];
    return {
      identity: fighter.identity,
      asset: model?.userData?.characterAssetUrl || null,
      meshes, skinned,
      boundJoints: jointNames.filter(j => model?.userData?.[j]).length,
      clips: [...clips],
      height: (() => { try { return +window.__browserSmashRigCheck?.(fighter)?.metrics?.height?.toFixed?.(3); } catch { return null; } })(),
      feetY: (() => { try { return +window.__browserSmashRigCheck?.(fighter)?.metrics?.feetY?.toFixed?.(3); } catch { return null; } })()
    };
  });
  report.body = body;
  console.log('BODY', JSON.stringify(body));

  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(-1.1, 0, 2);
    p2.position.set(1.0, 0, 2);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.percent = 0; p2.percent = 0; p2.hitstun = 0;
    p1.facing = 1; p1.facingZ = 0;
    p1.attackCooldown = 0; p1.attackTimer = 0; p1.state = 'idle';
    window.__browserSmashStep(0.2);
  });
  await page.waitForTimeout(500);
  await page.keyboard.down('j');
  const combat = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p2.position.set(0.9, p2.position.y, 2);
    p2.percent = 0; p2.hitstun = 0;
    p1.attackCooldown = 0; p1.attackTimer = 0;
    const before = p2.percent;
    for (let i = 0; i < 50; i += 1) window.__browserSmashStep(1 / 60);
    return { before, after: p2.percent };
  });
  await page.keyboard.up('j');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/final-live.png` });
  report.combat = combat;

  check('real selection path loads the Mario identity', body.identity === 'Mario', JSON.stringify({ identity: body.identity }));
  check('imported Mario body is mounted', body.asset === '/models/characters/imported/mario_happi/mario_happi_animated.glb' && body.meshes > 0 && body.skinned >= 3, JSON.stringify({ asset: body.asset, meshes: body.meshes, skinned: body.skinned }));
  check('25 retargeted clips are wired', body.clips.length >= 25 && body.boundJoints >= 11, JSON.stringify({ clips: body.clips.length, boundJoints: body.boundJoints }));
  check('feet are on the arena floor', body.feetY == null || Math.abs(body.feetY) < 0.2, JSON.stringify({ feetY: body.feetY, height: body.height }));
  check('a real jab lands and deals damage', combat.after > combat.before, JSON.stringify(combat));
  check('no page errors', errors.length === 0, errors.join(' | '));

  report.checks = checks;
  report.errors = errors;
  await writeFile(`${out}/live-check.json`, JSON.stringify(report, null, 2));
  const failed = checks.filter(c => !c.ok);
  console.log('SUMMARY', JSON.stringify({ passed: checks.length - failed.length, total: checks.length, failures: failed.map(c => `${c.name}: ${c.detail}`), errors: errors.length }));
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
