// Phase 29.8.4 — read-only diagnosis of the tick-17 left-leg reading.
//
//   bash scripts/run-browser-test.sh scripts/diag-298-4.mjs
//
// The A/B reported a 180.0 deg change on `leftLeg` at tick 17 with intensity 0, tug 0 and no reel,
// where the overlay writes nothing at all. This script changes no animation code. Per tick from cast
// start through tick 21, in BOTH traces, it records the joint object's identity and its parent's, the
// raw local quaternion, the world quaternion decomposed from matrixWorld, and whether the model itself
// was swapped. That distinguishes "the object was replaced, so the sampler compared two different
// bones" from "the same bone really rotated 180 degrees".
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
await mkdir(outDir, { recursive: true });

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
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e)));
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
  const ids = new WeakMap();
  let nextId = 1;
  const idOf = obj => {
    if (!obj) return null;
    if (!ids.has(obj)) ids.set(obj, nextId++);
    return ids.get(obj);
  };
  const sample = () => {
    const caster = CASTER();
    const bone = caster.model?.userData?.leftLeg || null;
    const rec = window.__d4Record;
    const row = {
      t: +(Number(rec?.t) || 0).toFixed(3),
      reel: Boolean(VICTIM().grabReel),
      intensity: rec?.__haul ? +rec.__haul.intensity.toFixed(3) : null,
      hasBone: Boolean(bone), modelId: idOf(caster.model),
      boneId: idOf(bone), parentId: idOf(bone?.parent),
      boneName: bone?.name || null, parentName: bone?.parent?.name || null
    };
    if (bone?.quaternion) {
      row.quat = [+bone.quaternion.x.toFixed(5), +bone.quaternion.y.toFixed(5),
        +bone.quaternion.z.toFixed(5), +bone.quaternion.w.toFixed(5)];
      const wq = bone.quaternion.clone();
      bone.matrixWorld.decompose(bone.position.clone(), wq, bone.position.clone());
      row.worldQuat = [+wq.x.toFixed(5), +wq.y.toFixed(5), +wq.z.toFixed(5), +wq.w.toFixed(5)];
      row.euler = [+bone.rotation.x.toFixed(4), +bone.rotation.y.toFixed(4), +bone.rotation.z.toFixed(4)];
    }
    return row;
  };
  window.__d4 = {
    begin({ noHaul = false, gap = 3.0 } = {}) {
      const caster = CASTER(), victim = VICTIM();
      window.combatPowers.clear('d4');
      window.__browserSmashNoHaul = noHaul;
      window.__browserSmashCasterBudget = 'plant';
      for (const f of [caster, victim]) {
        f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
        f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
        f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0; f.shield = 100;
        f.guardHeld = false; f.guardBreak = 0; f.grabReel = null; f.model.visible = true;
      }
      caster.position.set(0, caster.groundLevel ?? 0, 0); caster.facing = 1;
      victim.position.set(gap, victim.groundLevel ?? 0, 0); victim.facing = -1;
      const keys = window.__browserSmashInput.keys;
      for (const code of Object.keys(keys)) keys[code] = false;
      window.__browserSmashExperiments = { 'grab-continuity-pull': true };
      window.__browserSmashStep(1 / 60);
      caster.meter = 100;
      const rec = window.combatPowers.tryUltimate(caster);
      window.__d4Record = rec;
      return { ok: rec?.ok !== false, label: rec?.label ?? null, modelId: idOf(caster.model) };
    },
    step() {
      window.__browserSmashStep(1 / 60);
      window.combatPowers.applyCinematicPose?.(1 / 60);
      return sample();
    },
    peek() { return sample(); }
  };
});

const angleDeg = (a, b) => {
  if (!a || !b) return null;
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return +(2 * Math.acos(dot) * 180 / Math.PI).toFixed(2);
};

const out = { traces: {}, pageErrors };
for (const [tag, noHaul] of [['overlay-on', false], ['overlay-off', true]]) {
  const begin = await page.evaluate(nh => window.__d4.begin({ noHaul: nh }), noHaul);
  const rows = [await page.evaluate(() => window.__d4.peek())];
  for (let i = 0; i < 21; i++) rows.push(await page.evaluate(() => window.__d4.step()));
  const series = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], prev = rows[i - 1];
    series.push({ tick: i, t: r.t, boneId: r.boneId, parentId: r.parentId, modelId: r.modelId,
      hasBone: r.hasBone, reel: r.reel, intensity: r.intensity,
      localDegPerTick: prev ? angleDeg(prev.quat, r.quat) : null,
      worldDegPerTick: prev ? angleDeg(prev.worldQuat, r.worldQuat) : null,
      identityChanged: prev ? prev.boneId !== r.boneId : false,
      parentChanged: prev ? prev.parentId !== r.parentId : false,
      modelChanged: prev ? prev.modelId !== r.modelId : false,
      quat: r.quat, worldQuat: r.worldQuat, euler: r.euler, boneName: r.boneName, parentName: r.parentName });
  }
  const worstLocal = series.reduce((a, b) => ((b.localDegPerTick ?? 0) > (a.localDegPerTick ?? 0) ? b : a), { localDegPerTick: 0 });
  const worstWorld = series.reduce((a, b) => ((b.worldDegPerTick ?? 0) > (a.worldDegPerTick ?? 0) ? b : a), { worldDegPerTick: 0 });
  out.traces[tag] = { begin, worstLocal, worstWorld,
    identityChanges: series.filter(s => s.identityChanged).map(s => s.tick),
    parentChanges: series.filter(s => s.parentChanged).map(s => s.tick),
    modelChanges: series.filter(s => s.modelChanged).map(s => s.tick),
    missingBoneTicks: series.filter(s => !s.hasBone).length, series };
  console.log(tag + ' begin ' + JSON.stringify(begin));
  console.log(tag + ' worstLocal ' + JSON.stringify({ tick: worstLocal.tick, deg: worstLocal.localDegPerTick,
    boneId: worstLocal.boneId, identityChanged: worstLocal.identityChanged, parentChanged: worstLocal.parentChanged,
    reel: worstLocal.reel, intensity: worstLocal.intensity }));
  console.log(tag + ' worstWorld ' + JSON.stringify({ tick: worstWorld.tick, deg: worstWorld.worldDegPerTick }));
  console.log(tag + ' boneIdChanges ' + JSON.stringify(out.traces[tag].identityChanges)
    + ' parentChanges ' + JSON.stringify(out.traces[tag].parentChanges)
    + ' modelChanges ' + JSON.stringify(out.traces[tag].modelChanges)
    + ' missingBoneTicks ' + out.traces[tag].missingBoneTicks);
}

for (const tag of ['overlay-on', 'overlay-off']) {
  console.log('--- ' + tag + ' ticks 14-19');
  for (const s of out.traces[tag].series.filter(r => r.tick >= 14 && r.tick <= 19)) {
    console.log(tag + ' tick=' + s.tick + ' t=' + s.t + ' reel=' + s.reel + ' int=' + s.intensity
      + ' bone=' + s.boneId + '/' + s.boneName + ' parent=' + s.parentId + '/' + s.parentName
      + ' local=' + s.localDegPerTick + ' world=' + s.worldDegPerTick + ' identChg=' + s.identityChanged);
  }
}

await writeFile(resolve(outDir, 'diag-leftleg-17.json'), JSON.stringify({
  kind: 'diag-leftleg-17', generatedAt: new Date().toISOString(),
  note: 'read-only; no animation change', out }, null, 2));
console.log('written, page errors ' + pageErrors.length);
await browser.close();
await new Promise(done => server.close(done));
