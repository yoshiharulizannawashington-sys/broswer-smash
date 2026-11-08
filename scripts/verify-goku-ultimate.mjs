// Proves Goku's authored ultimate motion drives his rendered body INSIDE the cinematic, not merely
// before or after it: samples rig-joint quaternions while the cast is running, and reports which
// pose source the choreography layer is using.
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

const result = await page.evaluate(() => {
  const fighter = window.fighters[0];
  const slots = ['torso', 'pelvis', 'rightArm', 'leftArm', 'rightFore', 'leftFore', 'rightLeg', 'leftLeg'];
  const jointsOf = () => {
    const out = {};
    for (const slot of slots) {
      const joint = fighter.model?.userData?.[slot];
      if (joint?.quaternion) out[slot] = joint.quaternion.toArray();
    }
    return out;
  };
  fighter.meter = 100;
  const rest = jointsOf();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO', key: 'o', bubbles: true }));
  const peak = {};
  let sawCine = false;
  let source = null;
  for (let i = 0; i < 70; i += 1) {
    window.__browserSmashStep(0.05);
    sawCine = sawCine || Boolean(window.smashCamera?.describeCineShot?.().active);
    source = window.__browserSmashCinematicPoseSource || source;
    const now = jointsOf();
    for (const [slot, q] of Object.entries(now)) {
      const base = rest[slot];
      if (!base) continue;
      let delta = 0;
      for (let k = 0; k < 4; k += 1) delta = Math.max(delta, Math.abs(q[k] - base[k]));
      peak[slot] = Math.max(peak[slot] || 0, delta);
    }
  }
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyO', key: 'o', bubbles: true }));
  return { peak, sawCine, source, moving: Object.values(peak).filter(v => v > 0.05).length, meter: fighter.meter };
});

await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/05-goku-ultimate-body.png` });
check('ultimate runs a cinematic', result.sawCine === true);
check('the cinematic drives Goku\'s authored ultimate motion', result.source === 'authored-set', String(result.source));
check('authored motion moves multiple joints during the cast', result.moving >= 3, JSON.stringify(result.peak));

await page.waitForFunction(() => !window.smashCamera?.describeCineShot?.().active, null, { timeout: 20000, polling: 250 }).catch(() => {});
const after = await page.evaluate(() => ({
  cine: Boolean(window.smashCamera?.describeCineShot?.().active),
  menuHidden: document.querySelector('#menu')?.classList.contains('hidden') === true,
  casting: Boolean(window.fighters[0].casting)
}));
check('control and camera return afterwards', after.cine === false && after.menuHidden === true, JSON.stringify(after));

await writeFile(`${out}/ultimate-body-report.json`, JSON.stringify({ checks, result, after, errors }, null, 2));
console.log('SUMMARY', JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, moving: result.moving, source: result.source, errors: errors.length }));
await browser.close(); server.close();
