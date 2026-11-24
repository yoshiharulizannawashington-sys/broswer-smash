// Both outcomes of the staged match end: the victory and defeat panels must be visibly on screen
// after the hold, not merely written into the DOM behind a hidden menu.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
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
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 20000, polling: 100 });
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`); if (!ok) failed += 1; };
const probe = async (label, loserIndex) => {
  await page.evaluate(({ loserIndex }) => {
    const step = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
    for (let i = 0; i < 40 && window.__browserSmashMatch().status !== 'match-over'; i += 1) { window.fighters[loserIndex].percent = 999; step(6); }
    for (let i = 0; i < 900; i += 1) {
      const v = window.__browserSmashVictoryState?.();
      if (v && v.hold === 0 && document.querySelector('#result')?.textContent.trim()) break;
      window.__browserSmashStep(1 / 60);
    }
  }, { loserIndex });
  await page.waitForTimeout(1600); // menu fade + any defeat presentation beat
  const diag = await page.evaluate(() => {
    const menu = document.querySelector('#menu');
    const result = document.querySelector('#result');
    const foot = result.parentElement;
    const cs = getComputedStyle(menu);
    return {
      menuClass: menu.className, menuStyle: menu.getAttribute('style') || '',
      transition: [cs.transitionProperty, cs.transitionDuration, cs.transitionDelay].join(' '),
      anims: menu.getAnimations().map(a => ({ name: a.animationName || a.id || 'anim', state: a.playState, time: Math.round(a.currentTime || 0) })),
      foot: [getComputedStyle(foot).display, Math.round(foot.getBoundingClientRect().height)],
      result: [getComputedStyle(result).display, Math.round(result.getBoundingClientRect().height)],
      hiddenClass: menu.classList.contains('hidden')
    };
  });
  console.log('DIAG', JSON.stringify(diag));
  const state = await page.evaluate(() => {
    const panel = document.querySelector('#result');
    const rect = panel.getBoundingClientRect();
    const centre = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      text: panel.textContent.trim(), opacity: Number(getComputedStyle(document.querySelector('#menu')).opacity),
      width: Math.round(rect.width), height: Math.round(rect.height), hit: Boolean(centre?.closest('#result')),
      match: window.__browserSmashMatch()
    };
  });
  const words = label === 'victory' ? /^VICTORY/ : /^DEFEAT/;
  check(`${label}: headline names the outcome`, words.test(state.text), state.text.slice(0, 50));
  check(`${label}: winner is ${label === 'victory' ? 'p1' : 'p2'}`, state.match.winner === (label === 'victory' ? 'p1' : 'p2'), JSON.stringify(state.match.winner));
  check(`${label}: panel is visible and hit-testable`,
    state.hit && state.opacity > 0.95 && state.width >= 300 && state.height >= 80, JSON.stringify(state).slice(0, 220));
  await page.screenshot({ path: `artifacts/result-${label}.png` });
};
await probe('victory', 1);
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 20000, polling: 100 });
await probe('defeat', 0);
check('no page errors across both result paths', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
console.log(failed ? `\n${failed} result-panel check(s) failed.` : '\nResult panel verified for both outcomes (6 checks).');
process.exitCode = failed ? 1 : 0;
