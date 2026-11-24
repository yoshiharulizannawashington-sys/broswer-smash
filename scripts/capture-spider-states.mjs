// Diagnostic capture: every required Spider-Man state on the mounted imported body.
// Screenshots are taken at real input-driven peaks, not after the clip has already ended.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/spider-man-states';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForSelector('#selectScreen [data-fighter="Spider-Man"]', { timeout: 30000 });
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Spider-Man"]').click());
await page.evaluate(() => document.querySelector('#selectScreen [data-side="p1"]').click());
await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('#selectScreen [data-side="p2"]').click());
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Goku"]').click());
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 40000, polling: 200 });
await page.waitForFunction(() => window.__browserSmashAssets?.characterModels?.spider_man?.status === 'loaded', null, { timeout: 120000, polling: 300 }).catch(() => {});
await page.waitForTimeout(1200);
await page.evaluate(() => { window.__browserSmashFreezeAI = true; });
await page.evaluate(() => window.__browserSmashStep(0.6));

async function reset(distance = 1.55) {
  await page.evaluate(d => {
    const [p1, p2] = window.fighters;
    p1.position.set(-2.4, 0, 2); p2.position.set(-2.4 + d, 0, 2);
    for (const f of [p1, p2]) { f.velocity.set(0, 0, 0); f.isGrounded = true; f.hitstun = 0; f.guardBreak = 0; f.attackQueue.length = 0; f.attackPose = 0; f.hitboxes.length = 0; f.dodgeTimer = 0; f.transform = null; f.formLock = 0; f.ko = false; }
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    p2.invulnerable = 0; p2.shield = 100; p2.percent = 0;
    p1.percent = 0; p1.meter = 100; p1.power = 100;
    p1.specialCooldown = 0; p1.abilityReadyAt = {}; p1.webSwinging = false;
    window.endWebSwing?.(p1, false);
  }, distance);
  await page.evaluate(() => window.__browserSmashStep(0.22));
}

async function step(seconds) { await page.evaluate(s => window.__browserSmashStep(s), seconds); }

async function snap(name, note = '') {
  await page.waitForTimeout(120);
  const state = await page.evaluate(() => {
    const p1 = window.fighters[0];
    const c = p1.animationController;
    const u = p1.model?.userData || {};
    return {
      current: c?._active || null, enabled: c?.enabled, state: c?._select?.()?.id || null,
      attack: p1.attackQueue?.[0]?.id || p1.activeMoveId || null, hitstun: +((p1.hitstun || 0).toFixed(2)),
      grounded: p1.isGrounded, percent: +p1.percent.toFixed(1), specialCooldown: +(p1.specialCooldown || 0).toFixed(2),
      importing: { strikes: u.importedStrikeReport?.status || null, reactions: u.importedReactionReport?.status || null },
      transform: p1.transform?.id || null, webSwinging: !!p1.webSwinging, meter: p1.meter
    };
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, note, JSON.stringify(state));
  return state;
}

await reset();
await snap('01-idle');

await page.keyboard.down('d'); await step(0.5); await snap('02-walk'); await page.keyboard.up('d'); await step(0.3);
await page.keyboard.down('Shift'); await page.keyboard.down('d'); await step(0.5); await snap('03-run'); await page.keyboard.up('d'); await page.keyboard.up('Shift'); await step(0.4);

await reset();
await page.keyboard.press('Space'); await step(0.12); await snap('04-jump-rise');
await step(0.22); await snap('05-fall');
await step(0.9); await snap('06-land');

await reset();
await page.keyboard.down('a'); await step(0.25); await snap('07-turn'); await page.keyboard.up('a'); await step(0.3);

await reset();
await page.keyboard.press('j'); await step(0.12); await snap('08-jab');
await step(0.22); await page.keyboard.press('j'); await step(0.12); await snap('09-jab2');
await step(0.22); await page.keyboard.press('j'); await step(0.12); await snap('10-finisher');
await step(0.5);

await reset(2.2);
await page.keyboard.down('Shift'); await page.keyboard.press('j'); await step(0.15); await snap('11-heavy'); await page.keyboard.up('Shift'); await step(0.6);

await reset();
await page.keyboard.press('Space'); await step(0.22); await page.keyboard.press('j'); await step(0.16); await snap('12-aerial'); await step(1.2);

await reset();
await page.keyboard.down('e'); await step(0.3); await snap('13-block'); await page.keyboard.up('e'); await step(0.2);

await reset();
await page.keyboard.press('Shift'); await step(0.1); await snap('14-dodge'); await step(0.5);

await reset();
await page.keyboard.press('k'); await step(0.18); await snap('15-web-zip'); await step(0.9);
await reset();
await page.keyboard.press('l'); await step(0.2); await snap('16-web-shot'); await step(0.8);
await reset();
await page.keyboard.press('h'); await step(0.2); await snap('17-web-pull'); await step(0.8);
await reset();
await page.keyboard.press('t'); await step(0.2); await snap('18-web-swing-strike'); await step(0.8);

await reset(5);
await page.keyboard.down('g'); await step(0.3); await snap('19-web-swing'); await page.keyboard.up('g'); await step(0.6);

await reset();
await page.evaluate(() => { const p = window.fighters[0]; p.power = 100; p.meter = 100; });
await page.keyboard.press('i'); await step(0.7); await snap('20-transform'); await step(0.6);

await reset();
await page.evaluate(() => { const p = window.fighters[0]; p.power = 100; p.meter = 100; });
await page.keyboard.press('o'); await step(0.5); await snap('21-ultimate-start'); await step(0.4); await snap('22-ultimate-active'); await step(0.9); await snap('23-ultimate-recover');
await step(1.5); await snap('24-after-ultimate');

await reset();
await page.evaluate(() => { const p = window.fighters[0]; p.hitstun = 1.15; p.isGrounded = true; p.velocity.set(0,0,0); });
await step(0.28); await snap('25-knockdown');
await page.evaluate(() => { window.fighters[0].hitstun = 0; });
await step(0.22); await snap('26-get-up');

console.log('ERRORS', JSON.stringify(errors));
await browser.close();
server.close();
