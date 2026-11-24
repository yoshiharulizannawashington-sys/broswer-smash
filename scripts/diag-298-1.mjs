// Phase 29.8.1 diagnostic — where exactly does the plant overlay's per-tick spike come from?
//
// Prints the raw per-tick series around the worst frame for plant and for the no-overlay control, so
// the cause is read off the data instead of inferred: is the jump the pose appearing at full strength,
// a base-capture artefact, or the game's own animation?
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
await mkdir(resolve(root, 'artifacts/dev/phase29'), { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) relative = 'public' + sep + relative;
    const body = await readFile(resolve(root, relative));
    res.writeHead(200, { 'Content-Type': mime[extname(relative).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(180_000);
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: await readFile(resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''))) }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
  && window.__browserSmashMatch && window.__browserSmashStep && window.__browserSmashRenderer
  && window.fighters?.length === 2, null, { timeout: 150_000, polling: 200 });
await page.evaluate(() => {
  window.__browserSmashSelect.setMode('2p');
  const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
  (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
  (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[1])?.click();
});
await page.click('#selectScreen [data-nav="next"]', { force: true });
const arenaCard = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
  || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
await arenaCard.click({ force: true });
await page.click('#play', { force: true });
await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 30_000, polling: 100 });

await page.evaluate(() => {
  const renderer = window.__browserSmashRenderer;
  renderer.render = () => {};
  window.requestAnimationFrame = () => 0;
  const CASTER = () => window.fighters[1];
  const VICTIM = () => window.fighters[0];
  const q = (f, name) => {
    const j = f.model?.userData?.[name];
    return j?.quaternion ? [+j.quaternion.x.toFixed(5), +j.quaternion.y.toFixed(5),
      +j.quaternion.z.toFixed(5), +j.quaternion.w.toFixed(5)] : null;
  };
  window.__diag = {
    begin({ noHaul = false } = {}) {
      const caster = CASTER(), victim = VICTIM();
      window.combatPowers.clear('diag');
      window.__browserSmashNoHaul = noHaul;
      window.__browserSmashCasterBudget = 'plant';
      for (const f of [caster, victim]) {
        f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
        f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
        f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0; f.shield = 100;
        f.guardHeld = false; f.guardBreak = 0; f.grabReel = null; f.model.visible = true;
      }
      caster.position.set(0, caster.groundLevel ?? 0, 0); caster.facing = 1;
      victim.position.set(4.74, victim.groundLevel ?? 0, 0); victim.facing = -1;
      const keys = window.__browserSmashInput.keys;
      for (const code of Object.keys(keys)) keys[code] = false;
      window.__browserSmashExperiments = { 'grab-continuity-pull': true };
      window.__browserSmashStep(1 / 60);
      caster.meter = 100;
      const rec = window.combatPowers.tryUltimate(caster);
      window.__diagRecord = rec;
      return { ok: rec?.ok !== false, label: rec?.label ?? null, total: rec?.total ?? null };
    },
    step() {
      const caster = CASTER(), victim = VICTIM();
      window.__browserSmashStep(1 / 60);
      window.combatPowers.applyCinematicPose?.(1 / 60);
      const rec = window.__diagRecord;
      return {
        tick: null,
        t: +(Number(rec?.t) || 0).toFixed(3),
        reel: Boolean(victim.grabReel),
        intensity: rec?.__haul ? +rec.__haul.intensity.toFixed(3) : null,
        hasBase: Boolean(rec?.__haul?.base),
        baseSize: rec?.__haul?.base ? rec.__haul.base.size : 0,
        tug: rec?.__haul ? +rec.__haul.tug.toFixed(3) : null,
        fore: q(caster, 'rightFore'), arm: q(caster, 'leftArm')
      };
    }
  };
});

const angle = (a, b) => {
  if (!a || !b) return null;
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return +(2 * Math.acos(dot) * 180 / Math.PI).toFixed(2);
};

for (const [tag, noHaul] of [['plant', false], ['control', true]]) {
  const begin = await page.evaluate(nh => window.__diag.begin({ noHaul: nh }), noHaul);
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(await page.evaluate(() => window.__diag.step()));
  console.log('begin ' + tag + ' ' + JSON.stringify(begin));
  for (let i = 1; i < rows.length; i++) {
    const dFore = angle(rows[i - 1].fore, rows[i].fore);
    if (i < 3 || i > 25 || dFore > 5) {
      console.log(tag + ' i=' + String(i).padStart(2) + ' t=' + rows[i].t + ' reel=' + rows[i].reel
        + ' int=' + rows[i].intensity + ' base=' + rows[i].baseSize + ' tug=' + rows[i].tug
        + ' foreDegPerTick=' + dFore);
    }
  }
}
await browser.close();
await new Promise(done => server.close(done));
