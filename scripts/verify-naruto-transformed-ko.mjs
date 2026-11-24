// Focused Naruto A1 edge: a real KO while a transformation is active, then a clean rematch.
//
// The existing A1 probe deliberately stopped short of this case because its focused reset helper
// left the result state unresolved. This suite uses the game's normal select, one-round rules,
// form input and KO/result path, then starts the result-screen rematch through #play.
//
//   bash scripts/run-browser-test.sh scripts/verify-naruto-transformed-ko.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { HARDWARE_GPU, assertHardwareGpu, browserLaunchOptions, captureGpu, isSoftwareRenderer } from './lib/hardware-gpu.mjs';

const root = process.cwd();
const out = resolve(root, 'artifacts/a1-naruto');
await mkdir(out, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png'
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
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};
const errors = [];
const failedRequests = [];
let browser;
try {
  browser = await chromium.launch(browserLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => errors.push(String(error?.stack || error).slice(0, 300)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push('console: ' + message.text().slice(0, 220));
  });
  page.on('response', response => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url().slice(-110)}`);
  });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  const gpu = await captureGpu(page);
  const softwareRenderer = isSoftwareRenderer(gpu);
  console.log('GPU ' + JSON.stringify({ ...gpu, softwareRenderer }));
  if (HARDWARE_GPU) assertHardwareGpu(gpu, 'Naruto transformed-KO hardware acceptance');

  await page.evaluate(() => {
    const select = window.__browserSmashSelect;
    window.__browserSmashTrainingDummy = true;
    select?.chooseArena('valley');
    select?.setRules({ roundsToWin: 1, roundSeconds: 60 });
    window.__browserSmashSetRules?.({ roundsToWin: 1, roundSeconds: 60 });
    select?.select('p1', 'Naruto Uzumaki');
    select?.select('p2', 'Thor');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting',
    null, { timeout: 60000, polling: 100 });
  await page.locator('canvas').first().click({ position: { x: 320, y: 220 }, force: true });
  await page.waitForTimeout(350);

  const step = async (seconds = 0.3) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) {
      await page.evaluate(dt => window.__browserSmashStep?.(dt), 0.05);
    }
  };
  const state = () => page.evaluate(() => {
    const f = window.fighters[0];
    const foe = window.fighters[1];
    const match = window.__browserSmashMatch?.() || null;
    return {
      clip: f.model?.userData?.currentClip || f.animationController?._active || null,
      transform: f.transform ? {
        id: f.transform.form?.id || null,
        label: f.transform.label || null,
        landed: f.transform.landed === true
      } : null,
      p1Percent: +(f.percent || 0).toFixed(1),
      foePercent: +(foe.percent || 0).toFixed(1),
      match,
      result: window.__browserSmashLastResult || null,
      resultText: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
      play: (document.querySelector('#play')?.textContent || '').trim(),
      victory: window.__browserSmashVictoryState?.() || null,
      control: window.__browserSmashControlMode?.() || null
    };
  });

  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    const [f, foe] = window.fighters;
    const ground = f.groundLevel ?? 0;
    f.position.set(0, ground, -12);
    foe.position.set(3.0, ground, -12);
    f.velocity?.set?.(0, 0, 0);
    foe.velocity?.set?.(0, 0, 0);
    f.percent = 0; f.hitstun = 0; f.ko = false; f.isGrounded = true;
    foe.percent = 0; foe.hitstun = 0; foe.ko = false; foe.isGrounded = true;
    f.power = 100; f.meter = 100; f.transformCooldown = 0; f.formLock = 0;
    f.attackQueue.length = 0; f.attackBuffer = 0;
  });
  await page.keyboard.press('i');
  await step(0.8);
  const form = await state();

  // The opponent is made vulnerable only after the form is confirmed active. One round means this
  // KO is the match result, not a round-two transition.
  await page.evaluate(() => {
    const foe = window.fighters[1];
    foe.percent = 999;
    foe.invulnerable = 0;
    foe.ko = false;
    foe.hitstun = 0;
  });
  let outcome = await state();
  for (let i = 0; i < 60 && outcome.match?.status !== 'match-over'; i += 1) {
    await step(0.1);
    outcome = await state();
  }
  // The presentation holds the authored victory shot before showResult() runs. Give the real
  // render loop time to complete that hold instead of treating the first match-over tick as the UI.
  await page.waitForFunction(() => Boolean(window.__browserSmashLastResult)
    || /VICTORY|DEFEAT/i.test(document.querySelector('#result')?.textContent || ''),
  null, { timeout: 10000, polling: 100 }).catch(() => {});
  outcome = await state();
  await page.screenshot({ path: resolve(out, 'transformed-ko-result.png') });
  check('a live KO while a transformation is active reaches a match result',
    Boolean(form.transform?.landed) && outcome.match?.status === 'match-over'
      && Boolean(outcome.result)
      && /VICTORY\s*·\s*NARUTO/i.test(String(outcome.resultText || ''))
      && outcome.result?.winner === 'p1',
    JSON.stringify({ form, outcome }));

  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting'
    && window.fighters?.[0]?.characterModelLoaded === true, null, { timeout: 30000, polling: 100 });
  await step(1.0);
  const rematch = await state();
  console.log('rematch state ' + JSON.stringify(rematch));
  check('the transformed-KO rematch starts a fresh match with the form cleared',
    rematch.match?.status === 'fighting'
      && rematch.transform === null
      && rematch.p1Percent === 0
      && rematch.resultText === '',
    JSON.stringify(rematch));

  await writeFile(resolve(out, 'transformed-ko.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    fighter: 'Naruto Uzumaki',
    hardwareMode: HARDWARE_GPU,
    gpu,
    softwareRenderer,
    checks,
    form,
    outcome,
    rematch,
    errors,
    failedRequests
  }, null, 2) + '\n');
  console.log(`\nNaruto transformed-KO ${checks.filter(c => c.ok).length}/${checks.length} checks passed`);
} finally {
  await browser?.close().catch(() => {});
  server.close();
}

if (checks.some(check => !check.ok) || errors.length || failedRequests.length) process.exitCode = 1;
