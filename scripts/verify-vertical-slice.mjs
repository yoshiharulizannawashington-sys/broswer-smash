// Vertical-slice flow probe: title -> fighters -> arena -> loading -> match -> pause -> defeat
// -> character select, using the game's real controls and reading its real state.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/slice';
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
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
const shot = async name => { await page.screenshot({ path: `${out}/${name}.png` }); };

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 170000, polling: 250 });
await page.waitForTimeout(1200);
await shot('01-title');
check('title screen present', await page.evaluate(() => Boolean(document.querySelector('#bbTitle'))));

await page.click('#bbTitle [data-nav="versus"]');
await page.waitForSelector('.bs-step[data-step="1"]:not([hidden])', { timeout: 15000 });
await shot('02-fighters');

const pick = async (re, side) => page.evaluate(({ src, side }) => {
  const rx = new RegExp(src, 'i');
  if (side) document.querySelector(`.bs-side[data-side="${side}"]`)?.click();
  const card = [...document.querySelectorAll('[data-role="roster"] .bs-card')].find(c => rx.test(c.textContent || ''));
  card?.click();
  return card?.textContent?.trim().slice(0, 40) || null;
}, { src: re.source, side });
const pickedP1 = await pick(/naruto/i, 'p1');
await page.waitForTimeout(400);
const pickedP2 = await pick(/goku/i, 'p2');
await page.waitForTimeout(600);
const selection = await page.evaluate(() => ({ p1: window.__browserSmashSelect?.state?.p1, p2: window.__browserSmashSelect?.state?.p2 }));
check('fighter cards select P1/P2', pickedP1 && pickedP2 && selection.p1 && selection.p2, JSON.stringify(selection));

await page.click('#selectScreen [data-nav="next"]');
await page.waitForSelector('.bs-step[data-step="2"]:not([hidden])', { timeout: 15000 });
await shot('03-arena');
const arenaPick = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.bs-arena')];
  const before = document.querySelector('#mapSelect')?.value;
  const target = cards.find(c => c.dataset.arena === 'finalvalley') || cards.find(c => c.dataset.arena !== before) || cards[0];
  target?.click();
  return { clicked: target?.dataset.arena || null, before };
});
await page.waitForTimeout(900);
const arenaNow = await page.evaluate(() => ({ map: document.querySelector('#mapSelect')?.value, applied: window.__browserSmashMatch?.().arena, label: document.querySelector('.bb-load-arena')?.textContent }));
check('arena card changes the real map', arenaPick.clicked && arenaNow.map === arenaPick.clicked, JSON.stringify(arenaNow));
await shot('04-arena-selected');

// START FIGHT is the real #play button, moved into the setup footer on step 2.
const playVisible = await page.evaluate(() => { const b = document.querySelector('#play'); return b ? !b.hidden && b.offsetParent !== null : false; });
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForTimeout(400);
const loadingState = await page.evaluate(() => window.__bbLoading?.describe?.() || null);
check('loading screen shows on match start', loadingState?.visible === true, JSON.stringify(loadingState));
await shot('05-loading');
check('START FIGHT is a visible control on the arena step', playVisible);
await page.waitForFunction(() => !document.querySelector('#bbLoading')?.offsetParent || document.querySelector('#bbLoading')?.hidden, null, { timeout: 20000, polling: 200 }).catch(() => {});
const loadingAfter = await page.evaluate(() => window.__bbLoading?.describe?.() || null);
check('loading screen clears on real readiness', loadingAfter?.visible === false, JSON.stringify(loadingAfter));
// The match intro is the game's own cinematic beat; capture whatever it presents at this point.
await page.waitForTimeout(350);
await shot('05b-intro');
const introState = await page.evaluate(() => ({ body: document.body.className, cue: [...document.querySelectorAll('body *')].filter(n => n.offsetParent && /ROUND 01|FIGHT|VS\b/i.test((n.textContent || '').trim().slice(0, 40)) && n.children.length === 0).length }));

await page.waitForFunction(() => document.querySelector('#bbHudLayer') && getComputedStyle(document.querySelector('#bbHudLayer')).display !== 'none', null, { timeout: 30000, polling: 250 });
await page.waitForTimeout(2500);
await shot('06-hud');
const camera = await page.evaluate(() => {
  const report = window.smashCamera?.report?.(window.fighters[0], window.fighters[1]) || null;
  return { report, mode: window.__browserSmashMatch?.(), feet: window.fighters[0]?.position?.y ?? 0, hud: Boolean(document.querySelector('#bbHudLayer')) };
});
// `report` bounds are each model's full Box3, which includes weapons and effect geometry that can
// extend past the visible head. 1.15 NDC is the honest tolerance for that; the screenshot is the
// visual proof that both bodies are inside the frame.
const inside = b => b && ['minX', 'maxX', 'minY', 'maxY'].every(k => Math.abs(b[k]) <= 1.15);
check('both fighters framed by the live camera', camera.report?.fighters?.every(f => inside(f.bounds)), JSON.stringify(camera.report?.fighters?.map(f => f.bounds)));
check('camera sits above the fighters', (camera.report?.camera?.y || 0) > (camera.feet || 0) + 1, 'camY=' + camera.report?.camera?.y + ' feet=' + camera.feet);

await page.keyboard.press('Escape');
await page.waitForTimeout(900);
const paused = await page.evaluate(() => document.querySelector('#pauseMenu')?.hidden === false);
await shot('07-pause');
check('escape opens the pause screen', paused);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// Defeat is produced by the game's own round resolution: zero P1's stock and let it run.
for (let i = 0; i < 50; i++) {
  const done = await page.evaluate(() => {
    const text = document.querySelector('#result')?.textContent || '';
    if (/DEFEAT/i.test(text)) return true;
    if (window.fighters?.[0]) {
      window.fighters[0].percent = 999;
      window.fighters[0].ko = true;
      window.fighters[0].stock = 0;
    }
    return false;
  });
  if (done) break;
  await page.waitForTimeout(600);
}
await page.waitForTimeout(1400);
const defeat = await page.evaluate(() => ({
  text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 150),
  defeatClass: document.querySelector('#result')?.classList.contains('bb-defeat'),
  menuDefeat: document.querySelector('#menu')?.classList.contains('bb-defeat'),
  buttons: [...document.querySelectorAll('#bbResultActions [data-result]')].map(b => b.dataset.result)
}));
await shot('08-defeat');
check('defeat result rendered', /DEFEAT/i.test(defeat.text), defeat.text.slice(0, 70));
check('defeat uses the loss treatment', defeat.defeatClass === true);
check('results offer rematch / select / menu', defeat.buttons.join(',') === 'rematch,select,title', defeat.buttons.join(','));

await page.click('#bbResultActions [data-result="select"]');
await page.waitForTimeout(900);
const returned = await page.evaluate(() => ({
  setup: document.querySelector('#menu')?.classList.contains('bb-setup'),
  hasTitle: document.querySelector('#menu')?.classList.contains('bb-title'),
  result: (document.querySelector('#result')?.textContent || '').trim(),
  step1: !document.querySelector('.bs-step[data-step="1"]')?.hidden
}));
await shot('09-character-select');
check('character select returns to the real setup', returned.setup && !returned.hasTitle && returned.step1, JSON.stringify(returned));

const report = { checks, errors, selection, arenaPick, arenaNow, introState, camera: camera.report, defeat, returned };
await writeFile(`${out}/slice-report.json`, JSON.stringify(report, null, 2));
console.log('SUMMARY', JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, errors: errors.length }));
await browser.close(); server.close();
