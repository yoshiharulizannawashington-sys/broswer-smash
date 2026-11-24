// Release sign-off capture: the ten screens a player actually sees, shot from the shipped build.
//
//   bash scripts/run-browser-test.sh scripts/capture-phase20.mjs
//
// Every frame comes from the real game (same server, same Three.js route, same step hook the
// gameplay suite uses). Shots are taken after the simulation is stepped so the paused software
// renderer has drawn the frame being described, and each shot is best-effort: a missing panel is
// reported as a failure instead of aborting the rest of the set. It also measures the HUD/settings
// overlap at 1366x768 and 1024x640, which is the layout defect this phase fixes.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase20');
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
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const shots = [];
const failures = [];
const pageErrors = [];

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(180_000);
page.on('pageerror', error => pageErrors.push(String(error.message || error)));
page.on('console', message => { if (message.type() === 'error') pageErrors.push('console: ' + message.text()); });
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try {
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
  } catch { await route.fulfill({ status: 404, body: 'missing' }); }
});

async function shot(name, note = '') {
  const file = resolve(outDir, `${name}.png`);
  try {
    await page.waitForTimeout(650);
    await page.screenshot({ path: file });
    shots.push({ name, note, file });
    console.log(`  shot ${name} ${note}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`  FAIL ${name}: ${error.message}`);
  }
}

async function overlapReport(label) {
  const boxes = await page.evaluate(() => {
    const read = selector => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    return { settings: read('#cameraSettings'), cpu: read('.fighter.right'), timer: read('#timer'), viewport: { w: innerWidth, h: innerHeight } };
  });
  const hit = (a, b) => Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
  return { label, ...boxes, settingsOverCpu: hit(boxes.settings, boxes.cpu), settingsOverTimer: hit(boxes.settings, boxes.timer) };
}

// Declared outside try: the finally block reports these, and a block-scoped const would be a
// ReferenceError there - which is exactly what exited this capture with code 1 after every shot.
let overlap1366 = null;
let overlap1024 = null;
try {
  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__browserSmashSelect), null, { timeout: 180_000 });
  await page.waitForSelector('#selectScreen [data-role="previewcanvas"]', { timeout: 60_000 });

  // 1. title / main menu
  await page.evaluate(() => window.__browserSmashSelect.showTitle?.());
  await shot('01-main-menu', 'title screen with the match-setup entry points');

  // 2. character select
  await page.evaluate(() => window.__browserSmashSelect.show?.());
  await page.waitForFunction(() => {
    const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
    return status && ['ready', 'fallback', 'unavailable'].includes(status.dataset.state);
  }, null, { timeout: 120_000 });
  await page.evaluate(() => window.__browserSmashSelect.select('p1', 'Superman'));
  await shot('02-character-select', 'fighter step, P1 preview');

  // 3. arena selection
  await page.click('#selectScreen [data-nav="next"]');
  await shot('03-arena-select', 'arena step');
  await page.click('#selectScreen [data-nav="back"]');

  // 4. live combat HUD
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__browserSmashStep?.(0.4));
  await shot('04-combat-hud', 'round live, HUD and settings panel');
  overlap1366 = await overlapReport('1366x768');

  await page.setViewportSize({ width: 1024, height: 640 });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__browserSmashStep?.(0.2));
  await shot('05-combat-hud-1024', 'smaller laptop viewport');
  overlap1024 = await overlapReport('1024x640');
  await page.setViewportSize({ width: 1366, height: 768 });

  // 6. pause menu
  await page.evaluate(() => window.__browserSmashPause?.open?.());
  await shot('06-pause-menu', 'pause menu over a live round');
  await page.evaluate(() => window.__browserSmashPause?.close?.());

  // 7. training
  await page.evaluate(() => { window.__browserSmashPause?.close?.(); document.querySelector('#practice')?.click(); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__browserSmashStep?.(0.3));
  await shot('07-training', 'training panel and dummy');
  await page.evaluate(() => { document.querySelector('#menu')?.classList.add('hidden'); });

  // 8. tournament bracket
  await page.evaluate(() => window.__browserSmashTournamentStart?.());
  await shot('08-tournament', 'eight-fighter bracket');

  // 9. flight
  await page.evaluate(() => {
    window.__browserSmashTournamentLeave?.();
    document.querySelector('#play')?.click();
  });
  await page.waitForTimeout(1800);
  await page.keyboard.press('f');
  await page.evaluate(() => window.__browserSmashStep?.(0.8));
  await shot('09-flight', 'flight state mid-round');

  // 10. destruction / impact
  await page.evaluate(() => {
    const [p1, p2] = window.fighters || [];
    const at = (p1?.position || { x: 0, y: 1, z: 0 });
    for (let i = 0; i < 6; i++) {
      window.spawnImpact?.({ x: at.x + i * 0.6, y: 1.1, z: at.z - 1.2 }, 20, 0xffc06a);
    }
    window.__browserSmashStep?.(0.2);
  });
  await shot('10-destruction', 'impact bursts at ground level');

  // 11/12. result screens
  await page.evaluate(() => {
    const cpu = window.fighters?.[1];
    if (cpu) cpu.percent = 999;
    window.__browserSmashStep?.(0.5);
  });
  await page.waitForTimeout(1200);
  await shot('11-victory', 'match result after a KO');

  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    const p1 = window.fighters?.[0];
    if (p1) p1.percent = 999;
    window.__browserSmashStep?.(0.5);
  });
  await page.waitForTimeout(1200);
  await shot('12-defeat', 'defeat result');
} finally {
  const report = { shots, failures, pageErrors, overlap: [overlap1366, overlap1024] };
  await writeFile(resolve(outDir, 'capture-report.json'), JSON.stringify(report, null, 2));
  console.log('\nOVERLAP ' + JSON.stringify(report.overlap));
  console.log('FAILURES ' + JSON.stringify(failures));
  console.log('PAGE ERRORS ' + JSON.stringify(pageErrors.slice(0, 5)));
  await browser.close();
  await new Promise(done => server.close(done));
}
