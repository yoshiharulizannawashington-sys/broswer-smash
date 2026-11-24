// Real-match acceptance for the presentation visibility gate.
//
// Starts Hulk vs Goku through the gameplay API, captures normal combat, a staged victory,
// its result panel, a rematch, a staged defeat, the title, and a newly started match. It checks
// the floating .bb-float chips directly; the capture screenshots keep the UI visible so a human
// can inspect the same frames.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/presentation-nameplates';
await mkdir(out, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'public/index.html';
    if (!(relative === 'public' || relative.startsWith('public' + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

let browser;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`);
  if (!ok) failed += 1;
};
const probe = () => page.evaluate(() => {
  const layer = document.querySelector('#bbHudLayer');
  const floats = [...document.querySelectorAll('.bb-float')].map((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
      display: style.display, opacity: style.opacity, width: Math.round(rect.width), height: Math.round(rect.height),
      left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom),
      nameClipped: (() => {
        const name = node.querySelector('.bb-fname');
        return name ? name.scrollWidth > name.clientWidth + 1 : false;
      })()
    };
  });
  const menu = document.querySelector('#menu');
  const result = document.querySelector('#result');
  const resultRect = result?.getBoundingClientRect();
  return {
    status: window.__browserSmashMatch?.().status || null,
    winner: window.__browserSmashMatch?.().winner || null,
    matchOver: window.__browserSmashVictoryState?.() || null,
    menuHidden: menu ? menu.classList.contains('hidden') : null,
    menuClass: menu?.className || null,
    bodyClass: document.body.className,
    introActive: window.__browserSmashPresentation?.report?.().intro?.active ?? null,
    layerDisplay: layer ? getComputedStyle(layer).display : null,
    layerClass: layer?.className || null,
    layerStyle: layer?.getAttribute('style') || '',
    presentation: Boolean(layer?.classList.contains('bb-presentation')),
    floats: floats,
    floatsContainerDisplay: (() => { const n = document.querySelector('.bb-floats'); return n ? getComputedStyle(n).display : null; })(),
    matchBarBottom: (() => { const n = document.getElementById('bbMatchBar'); return n ? Math.round(n.getBoundingClientRect().bottom) : 0; })(),
    resultText: (result?.textContent || '').replace(/\s+/g, ' ').trim(),
    resultRect: resultRect ? { width: Math.round(resultRect.width), height: Math.round(resultRect.height), visible: getComputedStyle(result).display !== 'none' && resultRect.width > 0 } : null
  };
});
const settle = async (ms = 450) => page.waitForTimeout(ms);

let page;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.stack || error).slice(0, 240)));

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
  await page.click('#bbTitle [data-nav="versus"]');
  await page.evaluate(() => {
    window.__browserSmashIntroSeconds = 0;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSelect.select('p1', 'Hulk (Bruce Banner)');
    window.__browserSmashSelect.select('p2', 'Goku');
    window.BrowserSmash.startMatch();
  });
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting'
    && window.fighters?.[0]?.identityKey === 'hulk_bruce_banner'
    && window.fighters?.[0]?.model?.userData?.victoryAction?.getClip?.()
    && window.fighters?.[1]?.model?.userData?.defeatAction?.getClip?.(), null, { timeout: 120000, polling: 200 });
  await settle(500);

  const live = await probe();
  await page.screenshot({ path: `${out}/live-combat.png` });
  check('live combat shows both floating nameplates',
    live.status === 'fighting' && live.floats.length === 2
      && live.floats.every(chip => chip.display !== 'none' && chip.width > 0 && chip.height > 0)
      && live.floatsContainerDisplay !== 'none',
    JSON.stringify(live));
  check('floating nameplates use compact names without truncation',
    /^HULK/i.test(live.floats[0]?.text || '') && /^GOKU/i.test(live.floats[1]?.text || '')
      && live.floats.every(chip => chip.nameClipped === false),
    JSON.stringify(live.floats.map(chip => chip.text)));
  check('floating nameplates stay inside the viewport below the match bar',
    live.floats.every(chip => chip.left >= 0 && chip.top >= live.matchBarBottom
      && chip.right <= 1280 && chip.bottom <= 720),
    JSON.stringify({ bar: live.matchBarBottom, chips: live.floats.map(chip => ({ l: chip.left, t: chip.top, r: chip.right, b: chip.bottom })) }));

  // Win as Hulk through the real match-end branch. Capture the presentation before the panel.
  await page.evaluate(() => {
    const step = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
    for (let i = 0; i < 40 && window.__browserSmashMatch().status !== 'match-over'; i += 1) {
      window.fighters[1].percent = 999;
      step(6);
    }
    step(24);
  });
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'match-over', null, { timeout: 20000, polling: 100 });
  await settle(650);
  const victory = await probe();
  await page.screenshot({ path: `${out}/victory-presentation.png` });
  check('victory presentation is staged before the result panel',
    victory.status === 'match-over' && victory.menuHidden === true && victory.resultText.length === 0,
    JSON.stringify({ status: victory.status, menuHidden: victory.menuHidden, result: victory.resultText.slice(0, 60) }));
  check('victory presentation hides the P1 floating nameplate',
    victory.presentation && victory.floats[0]?.width === 0 && victory.floatsContainerDisplay === 'none',
    JSON.stringify(victory.floats[0]));
  check('victory presentation hides the CPU floating nameplate',
    victory.presentation && victory.floats[1]?.width === 0 && victory.floatsContainerDisplay === 'none',
    JSON.stringify(victory.floats[1]));
  await settle(500);
  const victoryStill = await probe();
  check('victory presentation keeps the floats hidden across UI frames',
    victoryStill.presentation && victoryStill.floats.every(chip => chip.width === 0),
    JSON.stringify(victoryStill.floats));

  await page.evaluate(() => {
    for (let i = 0; i < 900 && !document.querySelector('#result')?.textContent.trim(); i += 1) window.__browserSmashStep(1 / 60);
  });
  await settle(600);
  const victoryResult = await probe();
  await page.screenshot({ path: `${out}/victory-result.png` });
  check('victory result panel remains readable after presentation',
    /^VICTORY/i.test(victoryResult.resultText) && victoryResult.resultRect?.visible === true && victoryResult.resultRect?.width >= 300,
    JSON.stringify(victoryResult.resultRect));

  // Rematch through the API, then capture normal live combat again.
  await page.evaluate(() => window.BrowserSmash.rematch());
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting', null, { timeout: 20000, polling: 100 });
  await page.waitForFunction(() => {
    const layer = document.querySelector('#bbHudLayer');
    return layer && getComputedStyle(layer).display !== 'none' && !layer.classList.contains('bb-hidden');
  }, null, { timeout: 15000, polling: 100 }).catch(() => {});
  await settle(250);
  const rematch = await probe();
  await page.screenshot({ path: `${out}/rematch-live.png` });
  check('rematch restores both floating nameplates',
    rematch.status === 'fighting' && rematch.presentation === false && rematch.floats.every(chip => chip.width > 0 && chip.display !== 'none'),
    JSON.stringify(rematch));

  // Lose as Hulk. The same real match-end branch must hide the chips again.
  await page.evaluate(() => {
    const step = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
    for (let i = 0; i < 40 && window.__browserSmashMatch().status !== 'match-over'; i += 1) {
      window.fighters[0].percent = 999;
      step(6);
    }
    step(20);
  });
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'match-over', null, { timeout: 20000, polling: 100 });
  await settle(650);
  const defeat = await probe();
  await page.screenshot({ path: `${out}/defeat-presentation.png` });
  check('defeat presentation is staged before the result panel',
    defeat.status === 'match-over' && defeat.menuHidden === true && defeat.resultText.length === 0,
    JSON.stringify({ status: defeat.status, menuHidden: defeat.menuHidden, result: defeat.resultText.slice(0, 60) }));
  check('defeat presentation hides both floating nameplates',
    defeat.presentation && defeat.floats.every(chip => chip.width === 0) && defeat.floatsContainerDisplay === 'none',
    JSON.stringify(defeat.floats));

  await page.evaluate(() => {
    for (let i = 0; i < 900 && !document.querySelector('#result')?.textContent.trim(); i += 1) window.__browserSmashStep(1 / 60);
  });
  await settle(600);
  const defeatResult = await probe();
  await page.screenshot({ path: `${out}/defeat-result.png` });
  check('defeat result panel remains readable after presentation',
    /^DEFEAT/i.test(defeatResult.resultText) && defeatResult.resultRect?.visible === true && defeatResult.resultRect?.width >= 300,
    JSON.stringify(defeatResult.resultRect));

  // Return to the title and start a brand-new match: no stale gate may survive.
  await page.evaluate(() => window.BrowserSmash.returnToTitle());
  await settle(500);
  const title = await probe();
  check('return to title clears the presentation gate', title.presentation === false && /bb-title/.test(title.menuClass || ''), JSON.stringify({ presentation: title.presentation, menuClass: title.menuClass }));

  await page.evaluate(() => window.BrowserSmash.startMatch());
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting', null, { timeout: 20000, polling: 100 });
  await page.waitForFunction(() => {
    const layer = document.querySelector('#bbHudLayer');
    return layer && getComputedStyle(layer).display !== 'none' && !layer.classList.contains('bb-hidden');
  }, null, { timeout: 15000, polling: 100 }).catch(() => {});
  await settle(250);
  const fresh = await probe();
  await page.screenshot({ path: `${out}/fresh-match-live.png` });
  check('a newly started match restores normal nameplates',
    fresh.status === 'fighting' && fresh.presentation === false && fresh.floats.every(chip => chip.width > 0 && chip.display !== 'none'),
    JSON.stringify(fresh));

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\nPresentation nameplate checks: ${15 - failed}/15 passed.`);
  process.exitCode = failed ? 1 : 0;
} finally {
  if (browser) await browser.close();
  server.close();
}
