// Focused vertical-slice probe: start a real match, verify pause, force a real defeat through the
// engine's own damage state, then use the results buttons. Kept short because software rendering
// runs this game at roughly one frame per second.
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
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForTimeout(600);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#bbLoading')?.hidden !== false, null, { timeout: 15000, polling: 150 }).catch(() => {});
await page.waitForFunction(() => document.querySelector('#bbHudLayer') && getComputedStyle(document.querySelector('#bbHudLayer')).display !== 'none', null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/10-match.png` });

const framed = await page.evaluate(() => {
  const report = window.smashCamera?.report?.(window.fighters[0], window.fighters[1]);
  const inside = b => b && ['minX', 'maxX', 'minY', 'maxY'].every(k => Math.abs(b[k]) <= 1.15);
  return { ok: Boolean(report?.fighters?.every(f => inside(f.bounds))), camY: report?.camera?.y, feet: window.fighters[0]?.position?.y, mode: window.__browserSmashMatch?.().arena };
});
check('both fighters inside the frame during a real match', framed.ok, `camY=${framed.camY} feet=${framed.feet} arena=${framed.mode}`);

await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const paused = await page.evaluate(() => {
  const menu = document.querySelector('#pauseMenu');
  return { open: Boolean(menu) && menu.hidden === false, heading: menu?.querySelector('h2')?.textContent || null, stats: (menu?.querySelector('[data-role="stats"]')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) };
});
await page.screenshot({ path: `${out}/11-pause.png` });
check('Escape opens the pause screen', paused.open, JSON.stringify(paused));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
check('Escape resumes and closes the pause screen', await page.evaluate(() => document.querySelector('#pauseMenu')?.hidden === true));

// A loss through the engine's own KO path: zero P1's stock and let the round logic resolve it.
let ended = false;
for (let attempt = 0; attempt < 45; attempt++) {
  ended = await page.evaluate(() => {
    const result = document.querySelector('#result');
    const menu = document.querySelector('#menu');
    const shown = Boolean(result) && menu && !menu.classList.contains('hidden') && /DEFEAT/i.test(result.textContent || '');
    if (!shown && window.fighters?.[0]) {
      window.fighters[0].percent = 999;
      window.fighters[0].ko = true;
      window.fighters[0].stock = 0;
    }
    return shown;
  });
  if (ended) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1400);
const defeat = await page.evaluate(() => ({
  text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 170),
  defeatClass: document.querySelector('#result')?.classList.contains('bb-defeat'),
  menuDefeat: document.querySelector('#menu')?.classList.contains('bb-defeat'),
  buttons: [...document.querySelectorAll('#bbResultActions [data-result]')].map(b => b.dataset.result)
}));
await page.screenshot({ path: `${out}/12-defeat.png` });
check('a real loss produces the DEFEAT result', ended && /DEFEAT/i.test(defeat.text), defeat.text.slice(0, 80));
check('the loss gets the defeat treatment', defeat.defeatClass === true);
check('results offer rematch / character select / main menu', defeat.buttons.join(',') === 'rematch,select,title', defeat.buttons.join(','));

await page.click('#bbResultActions [data-result="select"]');
await page.waitForTimeout(1200);
const returned = await page.evaluate(() => ({
  setup: document.querySelector('#menu')?.classList.contains('bb-setup'),
  title: document.querySelector('#menu')?.classList.contains('bb-title'),
  resultEmpty: (document.querySelector('#result')?.textContent || '').trim().length === 0,
  step1: Boolean(document.querySelector('.bs-step[data-step="1"]')) && document.querySelector('.bs-step[data-step="1"]').hidden === false
}));
await page.screenshot({ path: `${out}/13-character-select.png` });
check('CHARACTER SELECT returns to the live setup screen', returned.setup && !returned.title && returned.resultEmpty && returned.step1, JSON.stringify(returned));

await writeFile(`${out}/defeat-report.json`, JSON.stringify({ checks, framed, paused, defeat, returned, errors }, null, 2));
console.log('SUMMARY', JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, errors: errors.length }));
await browser.close(); server.close();
