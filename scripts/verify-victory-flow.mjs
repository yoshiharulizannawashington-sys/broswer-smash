// Victory-flow probe: enables the real intro (automation defaults it off), observes its sequence,
// then fights the CPU with real key input and deterministic simulation stepping until the engine
// awards a round — so the result screen reports statistics the match actually produced.
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
await page.evaluate(() => { window.__browserSmashIntros = true; window.__browserSmashIntroSeconds = 6; });
await page.waitForTimeout(400);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
  // Real rule controls: one round to win, 60 s round, easiest CPU.
  const set = (selector, value) => {
    const node = document.querySelector(selector);
    if (!node) return false;
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
    return node.value === value;
  };
  window.__probeRules = [set('[data-rule="rounds"]', '1'), set('[data-rule="timer"]', '60'), set('[data-rule="difficulty"]', 'rookie')];
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());

// ---- Intro sequence -----------------------------------------------------------------------
await page.waitForTimeout(900);
const introEarly = await page.evaluate(() => {
  const wrap = document.querySelector('#browserSmashCinematic');
  const plate = selector => wrap?.querySelector(selector)?.textContent || null;
  return {
    present: Boolean(wrap),
    report: window.__browserSmashPresentation?.report?.().intro || null,
    plateA: plate('[data-role="plate-a"]'),
    plateB: plate('[data-role="plate-b"]'),
    tag: plate('[data-role="tag"]'),
    hudHidden: (() => { const node = document.querySelector('#bbHudLayer') || document.querySelector('#hud'); if (!node) return true; const style = getComputedStyle(node); return style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0'; })()
  };
});
await page.screenshot({ path: `${out}/20-intro-entrance.png` });
check('intro presents both fighters and the arena', introEarly.present && /NARUTO/i.test(introEarly.plateA || '') && /GOKU/i.test(introEarly.plateB || '') && /ROUND/i.test(introEarly.tag || ''), JSON.stringify({ a: introEarly.plateA, b: introEarly.plateB, tag: introEarly.tag }));
check('intro holds the HUD back', introEarly.hudHidden === true);
check('intro reports itself as running', introEarly.report?.active === true, JSON.stringify({ elapsed: introEarly.report?.elapsed, duration: introEarly.report?.duration }));

await page.waitForTimeout(2100);
const introMid = await page.evaluate(() => ({
  report: window.__browserSmashPresentation?.report?.().intro || null
}));
await page.screenshot({ path: `${out}/21-intro-dialogue.png` });
check('intro speaks character dialogue', (introMid.report?.lines || []).length >= 2, JSON.stringify(introMid.report?.lines));

await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false, null, { timeout: 12000, polling: 250 }).catch(() => {});
const afterIntro = await page.evaluate(() => ({
  report: window.__browserSmashPresentation?.report?.().intro || null,
  hudVisible: (() => { const node = document.querySelector('#bbHudLayer') || document.querySelector('#hud'); if (!node) return false; const style = getComputedStyle(node); return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'; })(),
  started: !document.querySelector('#menu') || document.querySelector('#menu').classList.contains('hidden')
}));
await page.screenshot({ path: `${out}/22-round-start.png` });
check('intro ends and hands back to the match', afterIntro.report?.active === false && afterIntro.hudVisible === true && afterIntro.started === true, JSON.stringify({ report: afterIntro.report, hud: afterIntro.hudVisible }));

// ---- Real fight: kite, guard, chip with the ranged signature, retry via real rematches ------
function fightRound() {
  const fire = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code.replace('Key', '').toLowerCase(), bubbles: true }));
  const held = new Set();
  const hold = code => { if (!held.has(code)) { held.add(code); fire('keydown', code); } };
  const release = code => { if (held.delete(code)) fire('keyup', code); };
  const tap = code => { fire('keydown', code); fire('keyup', code); };
  hold('KeyE'); // guard while retreating
  const trace = [];
  let ended = false;
  for (let i = 0; i < 660; i += 1) {
    // Half the time back away, half the time step in, so the CPU cannot simply corner the player.
    if (i % 10 < 6) { hold('KeyS'); release('KeyW'); } else { hold('KeyW'); release('KeyS'); }
    if (i % 5 === 0) tap('ShiftLeft'); // dodge
    if (i % 8 === 0) tap('KeyK'); // ranged signature
    if (i % 3 === 0) tap('KeyJ'); // melee when close
    if (i % 30 === 0 && (window.fighters[0].meter || 0) >= 100) tap('KeyO');
    window.__browserSmashStep(0.1);
    if (i % 60 === 0) trace.push({ i, p1: Math.round(window.fighters[0].percent), p2: Math.round(window.fighters[1].percent), meter: Math.round(window.fighters[0].meter || 0) });
    const menu = document.querySelector('#menu');
    const text = document.querySelector('#result')?.textContent || '';
    if (menu && !menu.classList.contains('hidden') && /VICTORY|DEFEAT|DRAW/i.test(text)) { ended = true; break; }
  }
  ['KeyE', 'KeyS', 'KeyW'].forEach(release);
  return {
    ended,
    p1: Math.round(window.fighters[0].percent),
    p2: Math.round(window.fighters[1].percent),
    trace,
    text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
    timer: document.querySelector('#timer')?.textContent || null
  };
}

const attempts = [];
let won = false;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const result = await page.evaluate(fightRound);
  attempts.push({ attempt, ...result });
  if (!result.ended) break;
  if (/VICTORY/i.test(result.text)) { won = true; break; }
  if (attempt < 3) {
    await page.click('#bbResultActions [data-result="rematch"]');
    await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 20000, polling: 250 }).catch(() => {});
    await page.waitForTimeout(700);
  }
}
await page.waitForTimeout(900);
const victory = await page.evaluate(() => ({
  text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
  defeatClass: document.querySelector('#result')?.classList.contains('bb-defeat'),
  buttons: [...document.querySelectorAll('#bbResultActions [data-result]')].map(b => b.dataset.result)
}));
await page.screenshot({ path: `${out}/23-victory.png` });
check('a real fight ends in a VICTORY', won && /VICTORY/i.test(victory.text), victory.text.slice(0, 100));

const dealt = Number((victory.text.match(/DAMAGE DEALT (\d+)%/) || [])[1]);
const hits = Number((victory.text.match(/HITS LANDED (\d+)/) || [])[1]);
const biggest = Number((victory.text.match(/BIGGEST HIT (\d+)%/) || [])[1]);
check('victory statistics come from the fight', dealt > 0 && hits > 0 && biggest > 0 && biggest < 900, `dealt=${dealt} hits=${hits} biggest=${biggest}`);
check('victory keeps the win treatment', victory.defeatClass === false && victory.buttons.join(',') === 'rematch,select,title', victory.buttons.join(','));

if (won) {
  await page.click('#bbResultActions [data-result="rematch"]');
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden') && document.querySelector('#bbHudLayer') && getComputedStyle(document.querySelector('#bbHudLayer')).display !== 'none', null, { timeout: 25000, polling: 250 }).catch(() => {});
  const rematch = await page.evaluate(() => ({
    menuHidden: document.querySelector('#menu')?.classList.contains('hidden'),
    hud: getComputedStyle(document.querySelector('#bbHudLayer')).display !== 'none',
    result: (document.querySelector('#result')?.textContent || '').trim(),
    timer: document.querySelector('#timer')?.textContent || null
  }));
  await page.screenshot({ path: `${out}/24-rematch.png` });
  check('REMATCH starts a fresh match', rematch.menuHidden === true && rematch.hud === true && rematch.result.length === 0, JSON.stringify(rematch));
}

await writeFile(`${out}/victory-report.json`, JSON.stringify({ checks, introEarly, introMid, afterIntro, attempts, victory, errors }, null, 2));
console.log('SUMMARY', JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, errors: errors.length }));
await browser.close(); server.close();
