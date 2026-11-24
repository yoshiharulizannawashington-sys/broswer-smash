// PART 10 acceptance: the legacy HUD/UI is gone, the replacement interface runs a real match,
// the procedural arenas are out of selection, and the Valley of the End still loads.
//
//   bash scripts/run-browser-test.sh scripts/verify-part10-cleanup.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/part10';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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

let failures = 0;
const checks = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

// ---------------------------------------------------------------- static inspection
const html = await readFile('public/index.html', 'utf8');
const rootHtml = await readFile('index.html', 'utf8');
check('entry has no legacy HUD containers', !/id="(hud|energyHUD|clockstack|p1bar|p2bar|p1name|p2name|p1special|p2special|specialLabel)"|class="fighter"/.test(html));
check('entry has no legacy menu title/roster rows', !/class="eyebrow"|class="title"|class="sub"|PLAYER <select|CPU <select|ARENA <select/.test(html));
check('entry hosts the modern match bar', /id="bbMatchBar"/.test(html) && /id="timer"/.test(html) && /id="status"/.test(html));
check('entry keeps a single gameplay adapter block', /id="bbAdapters" hidden/.test(html));
check('entry no longer lists procedural arenas', !/value="(volcano|ice|neon|valley)"/.test(html) && !/Obsidian Volcano|Frostfall Citadel|Neon Megacity|Valley of Echoes/.test(html));
check('entry still lists the Valley of the End', /value="finalvalley"/.test(html));
check('root entry redirects to the real entry', /public\/index\.html/.test(rootHtml) && !/id="hud"/.test(rootHtml));

// ---------------------------------------------------------------- boot
let browser;
const pageErrors = [];
const consoleErrors = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 220)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(String(m.text()).slice(0, 220)); });
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180000, polling: 250 });

  const shell = await page.evaluate(() => ({
    title: Boolean(document.querySelector('#bbTitle')),
    select: Boolean(document.querySelector('#selectScreen')),
    cards: document.querySelectorAll('#selectScreen .bs-card').length,
    arenas: [...document.querySelectorAll('#selectScreen .bs-arena')].map(n => n.dataset.arena),
    hud: Boolean(document.querySelector('#bbHudLayer')),
    barParent: document.querySelector('#bbMatchBar')?.parentElement?.id || null,
    legacy: ['#hud', '#energyHUD', '.fighter', '#clockstack', '#specialLabel', '#p1bar', '#p2bar', '#p1special'].filter(s => document.querySelector(s)),
    adaptersHidden: getComputedStyle(document.querySelector('#bbAdapters')).display === 'none',
    mapOptions: [...document.querySelectorAll('#mapSelect option')].map(o => o.value)
  }));
  check('modern title screen is the entry point', shell.title, String(shell.title));
  check('roster exposes all 38 approved fighters', shell.cards === 38, `${shell.cards} cards`);
  check('modern HUD exists and adopts the match bar', shell.hud && shell.barParent === 'bbHudLayer', `bar parent ${shell.barParent}`);
  check('no legacy HUD nodes survive in the DOM', shell.legacy.length === 0, shell.legacy.join(','));
  check('gameplay adapters are not painted', shell.adaptersHidden === true);
  check('procedural arenas are not selectable', !shell.arenas.some(k => ['volcano', 'ice', 'neon', 'valley'].includes(k)), shell.arenas.slice(0, 14).join(','));
  check('Valley of the End is selectable', shell.arenas.includes('finalvalley') && shell.mapOptions.includes('finalvalley'));
  check('arena list has no duplicate entries', new Set(shell.arenas).size === shell.arenas.length, `${shell.arenas.length} cards / ${new Set(shell.arenas).size} unique`);

  // ---------------------------------------------------------------- match setup through the new UI
  await page.click('#bbTitle [data-nav="versus"]');
  await page.evaluate(() => {
    const set = (selector, value) => { const n = document.querySelector(selector); if (!n) return; n.value = value; n.dispatchEvent(new Event('change', { bubbles: true })); };
    set('[data-rule="rounds"]', '1'); set('[data-rule="timer"]', '60'); set('[data-rule="difficulty"]', 'rookie');
  });
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="finalvalley"]');
  await page.evaluate(() => window.BrowserSmash?.startMatch?.());
  await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false, null, { timeout: 20000, polling: 250 }).catch(() => {});
  await page.waitForTimeout(500);

  await page.waitForFunction(() => getComputedStyle(document.querySelector('#bbHudLayer')).display !== 'none', null, { timeout: 15000, polling: 200 }).catch(() => {});
  const live = await page.evaluate(() => ({
    arena: window.__browserSmashMatch?.().arena,
    menuHidden: document.querySelector('#menu')?.classList.contains('hidden'),
    layer: getComputedStyle(document.querySelector('#bbHudLayer')).display,
    timer: document.querySelector('#timer')?.textContent,
    status: document.querySelector('#status')?.textContent,
    chipName: document.querySelector('.bb-float.p1 .bb-fname')?.textContent,
    chipMove: document.querySelector('.bb-float.p1')?.style.transform,
    slots: document.querySelectorAll('.bb-slot').length,
    finalValley: window.__browserSmashAssets?.finalValley?.status,
    legacy: Boolean(document.querySelector('#hud, #energyHUD, .fighter')),
    hudOrder: [...(document.querySelector('#bbHudLayer')?.children || [])].map(n => n.id || n.className)
  }));
  check('a real finalvalley match starts', live.arena === 'finalvalley' && live.menuHidden === true, String(live.arena));
  check('the Valley of the End asset is loaded', live.finalValley === 'loaded', String(live.finalValley));
  check('modern HUD is painting in-match', live.layer !== 'none' && /^\d:\d{2}$/.test(live.timer || ''), `${live.layer} ${live.timer}`);
  check('status line reports the arena', /FINAL VALLEY/i.test(live.status || ''), live.status);
  check('health chips track a named fighter', Boolean(live.chipName) && /translate\(/.test(live.chipMove || ''), `${live.chipName} ${live.chipMove}`);
  check('ability/ultimate clusters render 7 slots', live.slots === 7, `${live.slots} slots`);
  check('old HUD did not reappear during the match', live.legacy === false);

  // ---------------------------------------------------------------- pause
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const paused = await page.evaluate(() => ({ cls: document.body.classList.contains('is-paused'), layer: getComputedStyle(document.querySelector('#bbHudLayer')).display }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const resumed = await page.evaluate(() => !document.body.classList.contains('is-paused'));
  check('pause hides the match HUD', paused.cls === true && paused.layer === 'none', JSON.stringify(paused));
  check('resume restores play', resumed === true);

  // ---------------------------------------------------------------- real fight to a result
  const fight = await page.evaluate(() => {
    const fire = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code.replace('Key', '').toLowerCase(), bubbles: true }));
    const held = new Set();
    const hold = code => { if (!held.has(code)) { held.add(code); fire('keydown', code); } };
    const release = code => { if (held.delete(code)) fire('keyup', code); };
    const tap = code => { fire('keydown', code); fire('keyup', code); };
    hold('KeyE');
    let ended = false;
    for (let i = 0; i < 900; i += 1) {
      if (i % 10 < 6) { hold('KeyS'); release('KeyW'); } else { hold('KeyW'); release('KeyS'); }
      if (i % 5 === 0) tap('ShiftLeft');
      if (i % 8 === 0) tap('KeyK');
      if (i % 3 === 0) tap('KeyJ');
      if (i % 30 === 0 && (window.fighters[0].meter || 0) >= 100) tap('KeyO');
      window.__browserSmashStep(0.1);
      const menu = document.querySelector('#menu');
      const text = document.querySelector('#result')?.textContent || '';
      if (menu && !menu.classList.contains('hidden') && /VICTORY|DEFEAT|DRAW/i.test(text)) { ended = true; break; }
    }
    ['KeyE', 'KeyS', 'KeyW'].forEach(release);
    return { ended, text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(), p1: window.fighters[0].percent, p2: window.fighters[1].percent };
  });
  await page.waitForTimeout(700);
  const result = await page.evaluate(() => ({
    text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
    menuClass: document.querySelector('#menu')?.className,
    actions: [...document.querySelectorAll('#bbResultActions button')].map(b => b.dataset.result),
    legacy: Boolean(document.querySelector('#hud, .fighter'))
  }));
  check('a real match reaches victory or defeat', fight.ended && /VICTORY|DEFEAT|DRAW/i.test(result.text), result.text.slice(0, 90));
  check('result screen offers rematch, select and title', result.actions.join(',') === 'rematch,select,title', result.actions.join(','));
  await page.screenshot({ path: `${out}/result.png` });

  // ---------------------------------------------------------------- rematch
  await page.click('#bbResultActions [data-result="rematch"]');
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 15000, polling: 200 }).catch(() => {});
  const rematch = await page.evaluate(() => ({
    hidden: document.querySelector('#menu')?.classList.contains('hidden'),
    timer: document.querySelector('#timer')?.textContent,
    layer: getComputedStyle(document.querySelector('#bbHudLayer')).display,
    actions: document.querySelectorAll('#bbResultActions button').length
  }));
  check('rematch restarts a live match', rematch.hidden === true || rematch.layer !== 'none', JSON.stringify(rematch));
  check('rematch keeps one result action set', rematch.actions <= 3, `${rematch.actions}`);
  await page.screenshot({ path: `${out}/match.png` });

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  check('harness completed', false, String(error?.message || error).slice(0, 300));
} finally {
  await browser?.close();
  server.close();
}

await writeFile(`${out}/cleanup-checks.json`, JSON.stringify({ checks, failures, pageErrors, consoleErrors }, null, 2));
console.log(`\n${checks.length - failures}/${checks.length} checks passed`);
process.exit(failures ? 1 : 0);
