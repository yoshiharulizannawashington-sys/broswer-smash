// Camera perspective, HUD suppression and Chromebook layout probe.
// Verifies the duel shot is behind and above P1 on the P1->CPU axis, that the HUD tracks real match
// state, that the intro covers it, and that the screens stay usable at 1024x600 and 900x600.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/polish';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
const shot = name => page.screenshot({ path: `${out}/${name}.png` });

// Reads layout defects that a screenshot alone can hide: off-screen or tiny controls, horizontal
// overflow, and the two known crowding pairs (camera panel vs fighter plate, ability row vs legend).
const layout = () => page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight;
  const issues = [];
  const label = node => (node.id ? '#' + node.id : node.className ? '.' + String(node.className).split(' ')[0] : node.tagName);
  for (const node of document.querySelectorAll('button, select, input')) {
    if (!node.offsetParent) continue;
    const r = node.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) issues.push('tiny:' + label(node));
    if (r.right > vw + 2 || r.left < -2 || r.bottom > vh + 2 || r.top < -2) issues.push('offscreen:' + label(node));
  }
  const rect = selector => {
    const node = document.querySelector(selector);
    if (!node || !node.offsetParent) return null;
    const r = node.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  };
  const overlap = (a, b) => Boolean(a && b && a.l < b.r - 2 && b.l < a.r - 2 && a.t < b.b - 2 && b.t < a.b - 2);
  const overlaps = {
    cameraVsFighter: overlap(rect('#cameraSettings'), rect('.fighter')),
    clusterVsLegend: overlap(rect('.bb-cluster.bb-p1'), rect('.bottom')),
    clusterVsCamera: overlap(rect('.bb-cluster.bb-p1'), rect('#cameraSettings'))
  };
  return { vw, vh, scrollOverflow: document.documentElement.scrollWidth - vw, issues, overlaps };
});

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForTimeout(800);
await shot('01-title-1280');
await page.setViewportSize({ width: 1024, height: 600 });
await page.waitForTimeout(400);
await shot('02-title-1024');
const layoutTitle1024 = await layout();
await page.setViewportSize({ width: 900, height: 600 });
await page.waitForTimeout(400);
await shot('03-title-900');
const layoutTitle900 = await layout();
await page.setViewportSize({ width: 1280, height: 720 });

await page.evaluate(() => { window.__browserSmashIntros = true; window.__browserSmashIntroSeconds = 4; });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForTimeout(500);
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#selectScreen [data-nav="next"]')?.click());
await page.waitForTimeout(500);
await shot('04-arena-1280');
const layoutArena1280 = await layout();
await page.setViewportSize({ width: 1024, height: 600 });
await page.waitForTimeout(400);
await shot('05-arena-1024');
const layoutArena1024 = await layout();
await page.setViewportSize({ width: 900, height: 600 });
await page.waitForTimeout(400);
await shot('06-arena-900');
const layoutArena900 = await layout();
await page.setViewportSize({ width: 1280, height: 720 });

await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#bbLoading')?.hidden !== false, null, { timeout: 15000, polling: 150 }).catch(() => {});
await page.waitForTimeout(500);
const introHud = await page.evaluate(() => {
  const layer = document.querySelector('#bbHudLayer');
  return {
    cinematic: Boolean(document.querySelector('#browserSmashCinematic')),
    hudDisplay: layer ? getComputedStyle(layer).display : null,
    hudOpacity: layer ? getComputedStyle(layer).opacity : null
  };
});
await shot('07-intro-hud');
check('intro hides the gameplay HUD visually', introHud.cinematic === true && introHud.hudDisplay === 'none', JSON.stringify(introHud));

await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false, null, { timeout: 15000, polling: 250 }).catch(() => {});
await page.waitForTimeout(1200);
const duel = await page.evaluate(() => {
  const a = window.fighters[0], b = window.fighters[1];
  const report = window.smashCamera.report(a, b);
  const c = window.smashCamera.camera.position;
  const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
  const len = Math.hypot(dx, dz) || 1;
  // Positive would mean the camera sits on the CPU's side of P1.
  const behind = ((c.x - a.position.x) * dx + (c.z - a.position.z) * dz) / len;
  return {
    report,
    behind,
    camY: +c.y.toFixed(2),
    p1Y: +(a.position.y || 0).toFixed(2),
    p1Height: report.fighters[0].bounds.heightFraction,
    p2Height: report.fighters[1].bounds.heightFraction,
    mode: window.__browserSmashCameraMode?.() || null
  };
});
await shot('08-duel-1280');
check('camera sits behind P1 on the duel axis', duel.behind < -2, `behind=${duel.behind.toFixed(2)}`);
check('camera sits above P1', duel.camY > duel.p1Y + 2, `camY=${duel.camY} p1Y=${duel.p1Y}`);
check('both fighters stay framed in the duel shot', duel.report.fighters.every(f => f.bounds.onScreen !== false), JSON.stringify(duel.report.fighters.map(f => f.bounds)));
check('P1 reads as the foreground fighter', duel.p1Height >= duel.p2Height, `p1=${duel.p1Height} p2=${duel.p2Height}`);

const hudState = await page.evaluate(() => {
  const p1 = window.fighters[0], p2 = window.fighters[1];
  const chip = selector => {
    const node = document.querySelector(selector);
    return { pct: Number((node?.querySelector('.bb-fpct')?.textContent || '').replace('%', '')), name: node?.querySelector('.bb-fname')?.textContent || '' };
  };
  return {
    chip1: chip('.bb-float.p1'),
    chip2: chip('.bb-float.p2'),
    p1Percent: p1.percent,
    p2Percent: p2.percent,
    timer: document.querySelector('#timer')?.textContent || null,
    round: document.querySelector('#roundScore')?.textContent?.replace(/\s+/g, ' ').trim() || null,
    slots: [...document.querySelectorAll('.bb-slot .bb-cd')].map(n => n.textContent)
  };
});
check('floating health chips match real damage', Math.abs(hudState.chip1.pct - (100 - hudState.p1Percent)) <= 1 && Math.abs(hudState.chip2.pct - (100 - hudState.p2Percent)) <= 1, JSON.stringify({ chip1: hudState.chip1, p1: hudState.p1Percent, chip2: hudState.chip2, p2: hudState.p2Percent }));

await page.evaluate(() => {
  const a = window.fighters[0], b = window.fighters[1];
  a.position.y = 9; a.velocity.y = 1.2; a.isGrounded = false;
  b.position.y = 6.5; b.velocity.y = 0.8; b.isGrounded = false;
});
await page.waitForTimeout(1400);
const aerial = await page.evaluate(() => {
  const a = window.fighters[0], b = window.fighters[1];
  const report = window.smashCamera.report(a, b);
  return { onScreen: report.fighters.map(f => f.bounds.onScreen), heights: report.fighters.map(f => f.bounds.heightFraction), p1y: +a.position.y.toFixed(2), p2y: +b.position.y.toFixed(2) };
});
await shot('09-aerial-1280');
check('aerial duel keeps both fighters framed', aerial.onScreen.every(Boolean), JSON.stringify(aerial));

await page.keyboard.press('Escape');
await page.waitForTimeout(800);
const pause = await page.evaluate(() => ({ open: document.querySelector('#pauseMenu')?.hidden === false, heading: document.querySelector('#pauseMenu h2')?.textContent || null }));
await shot('10-pause-1280');
check('pause screen opens during the duel', pause.open === true, JSON.stringify(pause));
await page.setViewportSize({ width: 1024, height: 600 });
await page.waitForTimeout(500);
await shot('11-pause-1024');
const layoutPause1024 = await layout();
await page.setViewportSize({ width: 900, height: 600 });
await page.waitForTimeout(500);
await shot('12-pause-900');
const layoutPause900 = await layout();
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

await page.setViewportSize({ width: 1024, height: 600 });
await page.waitForTimeout(700);
await shot('13-hud-1024');
const layoutHud1024 = await layout();
await page.setViewportSize({ width: 900, height: 600 });
await page.waitForTimeout(700);
await shot('14-hud-900');
const layoutHud900 = await layout();

// A real loss resolves to the results panel at the smallest tested size.
for (let i = 0; i < 40; i++) {
  const done = await page.evaluate(() => {
    const result = document.querySelector('#result');
    const menu = document.querySelector('#menu');
    const shown = Boolean(result) && menu && !menu.classList.contains('hidden') && /DEFEAT|VICTORY/i.test(result.textContent || '');
    if (!shown && window.fighters?.[0]) { window.fighters[0].percent = 999; window.fighters[0].ko = true; window.fighters[0].stock = 0; }
    return shown;
  });
  if (done) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1200);
await shot('15-results-900');
const layoutResults900 = await layout();
const results = await page.evaluate(() => ({
  text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
  actionsInside: [...document.querySelectorAll('#bbResultActions button')].every(button => {
    const r = button.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  })
}));
check('results actions stay on screen at 900x600', results.actionsInside === true, results.text.slice(0, 60));

const allLayouts = { layoutTitle1024, layoutTitle900, layoutArena1280, layoutArena1024, layoutArena900, layoutPause1024, layoutPause900, layoutHud1024, layoutHud900, layoutResults900 };
const problems = Object.entries(allLayouts).flatMap(([screen, value]) => (value.issues || []).map(issue => `${screen}:${issue}`));
const crowded = Object.entries(allLayouts).flatMap(([screen, value]) => Object.entries(value.overlaps || {}).filter(([, hit]) => hit).map(([pair]) => `${screen}:${pair}`));
check('no controls off screen or under-sized', problems.length === 0, problems.slice(0, 8).join(' | '));
check('no HUD crowding at tested sizes', crowded.length === 0, crowded.slice(0, 8).join(' | '));

await writeFile(`${out}/polish-report.json`, JSON.stringify({ checks, introHud, duel, aerial, hudState, pause, results, layouts: allLayouts, problems, crowded, errors }, null, 2));
console.log('SUMMARY', JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, problems, crowded, errors: errors.length }));
await browser.close(); server.close();
