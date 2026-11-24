// Phase 29.8.1 — plant hand-back repair: measure every frame, per joint, by quaternion angle.
//
//   bash scripts/run-browser-test.sh scripts/audit-phase298-1-handback.mjs
//
// Phase 29.8 measured a 99.9 deg/tick one-frame pop on the lead arm when plant handed the body back.
// This script localises the worst tick, reports it per joint and per policy, and re-checks the exit
// paths and the control run. Filmstrip frames are deterministic renders at 60 Hz simulation times,
// framed on the MIDPOINT between the two fighters so the pull line is judgeable.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
const stripDir = resolve(root, 'docs/phase298/strip');
await mkdir(outDir, { recursive: true });
await mkdir(stripDir, { recursive: true });

const JOINTS = ['torso', 'pelvis', 'leftArm', 'leftFore', 'rightArm', 'rightFore', 'leftLeg', 'rightLeg'];
const STRIP_AT = [0.5, 0.8, 1.1, 1.4, 1.7, 2.0, 2.3, 2.6, 2.8];

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

await page.evaluate(names => {
  const renderer = window.__browserSmashRenderer;
  const scene = window.__browserSmashScene;
  const camera = window.smashCamera.camera;
  const V = scene.position.clone();
  window.__origRender = renderer.render.bind(renderer);
  renderer.render = () => {};
  window.requestAnimationFrame = () => 0;
  const CASTER = () => window.fighters[1];
  const VICTIM = () => window.fighters[0];
  const q = (f, name) => {
    const j = f.model?.userData?.[name];
    return j?.quaternion ? [+j.quaternion.x.toFixed(6), +j.quaternion.y.toFixed(6),
      +j.quaternion.z.toFixed(6), +j.quaternion.w.toFixed(6)] : null;
  };
  const hand = (f, name) => {
    const j = f.model?.userData?.[name];
    if (!j) return null;
    j.getWorldPosition(V);
    return { x: +V.x.toFixed(3), y: +V.y.toFixed(3), z: +V.z.toFixed(3) };
  };
  window.__hb = {
    begin({ budget = 'plant', noHaul = false } = {}) {
      const caster = CASTER(), victim = VICTIM();
      window.combatPowers.clear('p2981');
      window.__browserSmashNoHaul = noHaul;
      window.__browserSmashCasterBudget = budget;
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
      window.__hbRecord = rec;
      return { ok: rec?.ok !== false, label: rec?.label };
    },
    step() {
      const caster = CASTER(), victim = VICTIM();
      window.__browserSmashStep(1 / 60);
      window.combatPowers.applyCinematicPose?.(1 / 60);
      const rec = window.__hbRecord;
      const qs = {};
      for (const name of names) qs[name] = q(caster, name);
      return { t: +(Number(rec?.t) || 0).toFixed(3),
        intensity: rec?.__haul ? +rec.__haul.intensity.toFixed(3) : null,
        beat: rec?.__haul?.beat ?? null, quats: qs,
        hands: { left: hand(caster, 'leftHand'), right: hand(caster, 'rightHand') },
        victimX: +victim.position.x.toFixed(3), casterX: +caster.position.x.toFixed(3) };
    },
    capture() {
      const caster = CASTER(), victim = VICTIM();
      const midX = (caster.position.x + victim.position.x) / 2;
      const midZ = (caster.position.z + victim.position.z) / 2;
      // Framed on the midpoint with both bodies and the ground in shot, so the pull line is judgeable.
      camera.position.set(midX - 0.5, 2.35, midZ + 7.0);
      camera.lookAt(midX, 1.05, midZ);
      camera.updateMatrixWorld(true);
      window.__origRender(scene, camera);
      return window.__browserSmashRenderer.domElement.toDataURL('image/png');
    },
    exit(kind) {
      const caster = CASTER(), victim = VICTIM();
      if (kind === 'interrupt') window.combatPowers.clear('test-interrupt');
      else if (kind === 'escape') victim.grabReel = null;
      else if (kind === 'match-end') { caster.ko = true; window.combatPowers.clear('match-end'); }
      return kind;
    },
    state() {
      const caster = CASTER();
      const rec = window.__hbRecord;
      return { haulAlive: Boolean(rec?.__haul), intensity: rec?.__haul ? +rec.__haul.intensity.toFixed(3) : null,
        held: Boolean(caster.__haulRecord) };
    },
    restore() { window.__browserSmashRenderer.render = window.__origRender; }
  };
}, JOINTS);

const quatAngleDeg = (a, b) => {
  if (!a || !b) return null;
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return +(2 * Math.acos(dot) * 180 / Math.PI).toFixed(3);
};

/** Worst per-tick angular change, per joint, with the tick it happened on. */
function worstPerTick(rows) {
  const out = {};
  for (const name of JOINTS) {
    let best = { deg: 0, tick: null };
    for (let i = 1; i < rows.length; i++) {
      const deg = quatAngleDeg(rows[i - 1].quats[name], rows[i].quats[name]);
      if (deg != null && deg > best.deg) best = { deg: +deg.toFixed(2), tick: i, t: rows[i].t };
    }
    out[name] = best;
  }
  const worst = Object.entries(out).reduce((a, b) => (b[1].deg > a[1].deg ? b : a), ['none', { deg: 0 }]);
  return { perJoint: out, worstJoint: worst[0], worstDeg: worst[1].deg, worstTick: worst[1].tick ?? null };
}

const save = async (dataUrl, name) => {
  await writeFile(resolve(stripDir, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
  return 'phase298/strip/' + name;
};

const results = { cast: {}, release: {}, exits: {}, strip: [] };
for (const budget of ['plant', 'chain', 'per-reel']) {
  await page.evaluate(b => window.__hb.begin({ budget: b }), budget);
  const rows = [];
  for (let i = 0; i < 200; i++) {
    const row = await page.evaluate(() => window.__hb.step());
    rows.push(row);
    if (budget === 'plant') {
      const due = STRIP_AT.find(t => !results.strip.some(f => f.t === t) && row.t >= t);
      if (due != null) results.strip.push({ t: due, file: await save(await page.evaluate(() => window.__hb.capture()), 'plant-' + due.toFixed(2).replace('.', '-') + 's.png') });
    }
  }
  const cast = worstPerTick(rows);
  results.cast[budget] = { ...cast, intensityTail: rows.slice(-3).map(r => r.intensity),
    victimDraw: +(rows[0].victimX - rows.at(-1).victimX).toFixed(3) };
  // Release window in real time: the hand-back is wall-clock timed.
  const release = [];
  for (let i = 0; i < 20; i++) {
    release.push(await page.evaluate(async () => {
      const row = await window.__hb.step();
      await new Promise(r => setTimeout(r, 16));
      return row;
    }));
  }
  results.release[budget] = { ...worstPerTick(release), intensity: release.map(r => r.intensity) };
  if (budget === 'plant') {
    for (const [i, label] of [[2, '0-03s'], [7, '0-11s'], [13, '0-21s']]) {
      results.strip.push({ t: 'release+' + label, file: await save(await page.evaluate(() => window.__hb.capture()), 'plant-release-' + label + '.png') });
    }
  }
  console.log('cast ' + budget.padEnd(9) + ' ' + JSON.stringify({ worstJoint: cast.worstJoint,
    worstDeg: cast.worstDeg, worstTick: cast.worstTick,
    top: Object.entries(cast.perJoint).sort((a, b) => b[1].deg - a[1].deg).slice(0, 3)
      .map(([n, v]) => n + ':' + v.deg) }));
  console.log('release ' + budget.padEnd(9) + ' ' + JSON.stringify({ worstJoint: results.release[budget].worstJoint,
    worstDeg: results.release[budget].worstDeg, intensity: results.release[budget].intensity }));
}

// Control: the identical cast with the overlay suppressed. Any per-tick spike that also appears here
// belongs to the move's own animation, not to the haul overlay, and must not be attributed to it.
await page.evaluate(() => window.__hb.begin({ budget: 'plant', noHaul: true }));
const controlRows = [];
for (let i = 0; i < 200; i++) controlRows.push(await page.evaluate(() => window.__hb.step()));
const control = worstPerTick(controlRows);
results.control = { ...control, intensityTail: controlRows.slice(-3).map(r => r.intensity) };
console.log('control  plant-noHaul ' + JSON.stringify({ worstJoint: control.worstJoint,
  worstDeg: control.worstDeg, worstTick: control.worstTick,
  top: Object.entries(control.perJoint).sort((a, b) => b[1].deg - a[1].deg).slice(0, 3)
    .map(([n, v]) => n + ':' + v.deg) }));

// Exit paths, with a no-overlay control.
for (const kind of ['interrupt', 'escape', 'match-end']) {
  for (const noHaul of [false, true]) {
    await page.evaluate(nh => window.__hb.begin({ noHaul: nh, budget: 'plant' }), noHaul);
    for (let i = 0; i < 54; i++) await page.evaluate(() => window.__hb.step());
    const before = await page.evaluate(() => window.__hb.state());
    await page.evaluate(k => window.__hb.exit(k), kind);
    let clearedAt = null;
    const seq = [];
    for (let i = 0; i < 30; i++) {
      const row = await page.evaluate(async () => {
        window.__hb.step0 = 0;
        const st = window.__hb.state();
        await new Promise(r => setTimeout(r, 16));
        return st;
      });
      await page.evaluate(() => window.__hb.step());
      seq.push(row);
      if (!row.haulAlive && clearedAt == null) clearedAt = i;
    }
    results.exits[kind + (noHaul ? '/control' : '/haul')] = { before, clearedAt, held: seq.at(-1).held,
      intensityTail: seq.slice(-2).map(s => s.intensity) };
    console.log('exit ' + (kind + (noHaul ? '/control' : '/haul')).padEnd(20) + JSON.stringify(results.exits[kind + (noHaul ? '/control' : '/haul')]));
  }
}

await page.evaluate(() => window.__hb.restore());
await writeFile(resolve(outDir, 'grab-haul-handback.json'), JSON.stringify({
  kind: 'grab-haul-handback', generatedAt: new Date().toISOString(),
  note: 'per-tick quaternion angle; strip framed on the midpoint between both fighters; deterministic renders, not live play',
  measuredAt60Hz: true, results, pageErrors }, null, 2));
console.log('strip ' + results.strip.length + ' frames, page errors ' + pageErrors.length);
await browser.close();
await new Promise(done => server.close(done));
