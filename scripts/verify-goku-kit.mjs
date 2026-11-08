// Goku kit probe: exercises the authored attack slots through real inputs and checks which motion
// actually reached his body, then activates a transformation and reports its real effects.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/goku';
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
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(1200);

// Walk the whole input space the move map covers and record which authored slots the body reached.
const kit = await page.evaluate(() => {
  const fighter = window.fighters[0];
  const key = (type, code, extra = {}) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code.replace('Key', '').toLowerCase(), bubbles: true, ...extra }));
  const seen = new Set();
  const press = (codes, steps = 4) => {
    codes.forEach(code => key('keydown', code));
    for (let i = 0; i < steps; i += 1) {
      window.__browserSmashStep(0.05);
      if (fighter.attackMotionPose) seen.add(fighter.attackMotionPose);
    }
    codes.forEach(code => key('keyup', code));
    window.__browserSmashStep(0.1);
    if (fighter.attackMotionPose) seen.add(fighter.attackMotionPose);
  };
  // Lights: the chain advances on each press.
  for (let i = 0; i < 6; i += 1) press(['KeyJ'], 4);
  press(['ShiftLeft', 'KeyJ'], 6);      // heavy
  press(['KeyS', 'KeyJ'], 6);           // slam family
  press(['KeyW', 'KeyJ'], 6);           // launcher family
  press(['Space'], 3);
  press(['KeyJ'], 4);                   // air attack
  press(['KeyJ', 'KeyJ'], 4);           // air finisher attempt
  return { seen: [...seen] };
});
check('Goku reaches his authored attack slots in play', kit.seen.length >= 5 && kit.seen.every(slot => slot.startsWith('light') || ['heavy', 'heavyLauncher', 'heavySlam'].includes(slot)), kit.seen.join(','));
await page.screenshot({ path: `${out}/06-goku-kit.png` });

const transform = await page.evaluate(() => {
  const fighter = window.fighters[0];
  const before = {
    form: fighter.form?.key || null,
    cost: fighter.form?.cost ?? null,
    speed: fighter.speed ?? null,
    power: fighter.power ?? null,
    keys: Object.keys(fighter).filter(k => /form|power|aura|transform/i.test(k))
  };
  fighter.power = 100;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', key: 'i', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyI', key: 'i', bubbles: true }));
  for (let i = 0; i < 20; i += 1) window.__browserSmashStep(0.05);
  const after = {
    form: fighter.form?.key || null,
    formName: fighter.form?.name || null,
    mods: fighter.form?.mods || null,
    power: fighter.power ?? null,
    costume: window.__browserSmashFormCostume?.() || null,
    aura: Boolean(fighter.model?.userData?.aura || fighter.model?.children?.some(n => /aura/i.test(n.name || '')))
  };
  return { before, after };
});
await page.screenshot({ path: `${out}/07-goku-transform.png` });
const changedForm = Boolean(transform.after.form) && transform.after.form !== transform.before.form;
check('transformation activates a real form', changedForm, JSON.stringify({ before: transform.before.form, after: transform.after.form, name: transform.after.formName }));
check('the form changes appearance and stats', Boolean(transform.after.mods) && (transform.after.aura || Boolean(transform.after.costume)), JSON.stringify({ mods: transform.after.mods, aura: transform.after.aura }));

await writeFile(`${out}/kit-report.json`, JSON.stringify({ checks, kit, transform, errors }, null, 2));
console.log('SUMMARY', JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, slots: kit.seen, form: transform.after.form, errors: errors.length }));
await browser.close(); server.close();
