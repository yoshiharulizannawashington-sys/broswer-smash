// Phase 29.8 — the visual acceptance pass, as far as this machine can take it.
//
//   bash scripts/run-browser-test.sh scripts/audit-phase298-visual.mjs
//
// Three questions:
//  1. Under `plant`, is the reduced hand travel still a convincing haul? Measured as hand path length
//     and, more importantly, how far the VICTIM is actually drawn in.
//  2. Does the plant -> haul blend happen without snapping? Peak joint angular speed per tick.
//  3. Does the release back to her stance ease, or pop? Same measure across the 0.22 s release.
//
// It also renders a deterministic filmstrip at 60 Hz timing. That is not a recording of live play (this
// machine runs the live loop at ~4 fps); it is the frame sequence the animation would show at normal
// speed, which is the closest available substitute for watching it on a display.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const shotDir = resolve(root, 'docs/phase298/strip');
const outDir = resolve(root, 'artifacts/dev/phase29');
await mkdir(shotDir, { recursive: true });
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
  const scene = window.__browserSmashScene;
  const camera = window.smashCamera.camera;
  const V = scene.position.clone();
  window.__origRender = renderer.render.bind(renderer);
  renderer.render = () => {};
  window.requestAnimationFrame = () => 0;
  const CASTER = () => window.fighters[1];
  const VICTIM = () => window.fighters[0];
  const world = (f, name) => {
    const j = f.model?.userData?.[name];
    if (!j) return null;
    j.getWorldPosition(V);
    return { x: +V.x.toFixed(4), y: +V.y.toFixed(4), z: +V.z.toFixed(4) };
  };
  const ang = (f, name) => {
    const j = f.model?.userData?.[name];
    return j ? [+j.rotation.x.toFixed(4), +j.rotation.y.toFixed(4), +j.rotation.z.toFixed(4)] : null;
  };
  window.__vis = {
    begin({ budget = 'plant', noHaul = false } = {}) {
      const caster = CASTER(), victim = VICTIM();
      window.combatPowers.clear('p298vis');
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
      window.__visRecord = rec;
      return { ok: rec?.ok !== false, label: rec?.label };
    },
    /** One rendered step, sampled: the per-tick record the transition metrics run on. */
    step() {
      const caster = CASTER(), victim = VICTIM();
      window.__browserSmashStep(1 / 60);
      window.combatPowers.applyCinematicPose?.(1 / 60);
      const rec = window.__visRecord;
      return {
        t: +(Number(rec?.t) || 0).toFixed(3),
        gap: +Math.hypot(caster.position.x - victim.position.x, caster.position.z - victim.position.z).toFixed(3),
        victimX: +victim.position.x.toFixed(4), casterX: +caster.position.x.toFixed(4),
        haul: rec?.__haul ? { beat: rec.__haul.beat, intensity: +rec.__haul.intensity.toFixed(3) } : null,
        hands: { left: world(caster, 'leftHand'), right: world(caster, 'rightHand') },
        joints: { torso: ang(caster, 'torso'), rightFore: ang(caster, 'rightFore'),
          leftArm: ang(caster, 'leftArm'), rightLeg: ang(caster, 'rightLeg') }
      };
    },
    /** Frame the pair from the side and grab a PNG of the current state. */
    capture() {
      const caster = CASTER(), victim = VICTIM();
      const midX = (caster.position.x + victim.position.x) / 2;
      const midZ = (caster.position.z + victim.position.z) / 2;
      camera.position.set(midX + 1.2, 2.0, 5.2);
      camera.lookAt(midX, 1.1, midZ);
      camera.updateMatrixWorld(true);
      window.__origRender(scene, camera);
      return window.__browserSmashRenderer.domElement.toDataURL('image/png');
    },
    restore() { window.__browserSmashRenderer.render = window.__origRender; }
  };
});

/** Joint angular speed per tick, in degrees, from the sampled Euler triples. */
function speeds(rows, joint) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].joints[joint], b = rows[i].joints[joint];
    if (!a || !b) continue;
    let worst = 0;
    for (let k = 0; k < 3; k++) {
      let d = b[k] - a[k];
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      worst = Math.max(worst, Math.abs(d));
    }
    out.push({ t: rows[i].t, deg: +(worst * 180 / Math.PI).toFixed(2) });
  }
  return out;
}

const save = async (dataUrl, name) => {
  const file = 'phase298/strip/' + name;
  await writeFile(resolve(root, 'docs', file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  return file;
};

const runs = {};
const stripFrames = [];
const STRIP_AT = [0.55, 0.8, 1.05, 1.3, 1.55, 1.8, 2.05, 2.3, 2.55, 2.8];
for (const budget of ['plant', 'chain', 'per-reel']) {
  await page.evaluate(b => window.__vis.begin({ budget: b }), budget);
  const rows = [];
  for (let i = 0; i < 200; i++) {
    const row = await page.evaluate(() => window.__vis.step());
    rows.push(row);
    if (budget === 'plant') {
      const due = STRIP_AT.find(t => !stripFrames.some(f => f.t === t) && row.t >= t);
      if (due != null) {
        const file = await save(await page.evaluate(() => window.__vis.capture()),
          'plant-' + due.toFixed(2).replace('.', '-') + 's.png');
        stripFrames.push({ t: due, file });
      }
    }
  }
  // Release window stepped in real time, so the wall-clock ease can actually finish.
  const release = [];
  for (let i = 0; i < 18; i++) {
    release.push(await page.evaluate(async () => {
      const row = await window.__vis.step();
      await new Promise(r => setTimeout(r, 20));
      return row;
    }));
  }
  if (budget === 'plant') {
    for (const [i, label] of [[5, '2-98s'], [11, '3-08s'], [17, '3-18s']]) {
      const file = await save(await page.evaluate(() => window.__vis.capture()), 'plant-release-' + label + '.png');
      stripFrames.push({ t: rows.length / 60 + i * 0.02, file, note: 'release +' + (i * 0.02).toFixed(2) + 's' });
    }
  }
  const reel = rows.filter(r => r.haul && r.haul.beat !== 'settle');
  const hands = rows.map(r => r.hands.left).filter(Boolean);
  let path = 0;
  for (let i = 1; i < hands.length; i++) path += Math.hypot(hands[i].x - hands[i - 1].x, hands[i].y - hands[i - 1].y, hands[i].z - hands[i - 1].z);
  const tSpeeds = speeds(rows, 'torso'), fSpeeds = speeds(rows, 'rightFore'), aSpeeds = speeds(rows, 'leftArm');
  const peak = list => +Math.max(0, ...list.map(s => s.deg)).toFixed(2);
  const fast = list => list.filter(s => s.deg > 6).length;
  const relSpeeds = speeds(release, 'rightFore');
  runs[budget] = {
    reelTicks: reel.length,
    casterTravel: +(rows.at(-1).casterX - rows[0].casterX).toFixed(3),
    victimTravel: +(rows[0].victimX - rows.at(-1).victimX).toFixed(3),
    finalGap: rows.at(-1).gap,
    handPath: +path.toFixed(3),
    peakDegPerTick: { torso: peak(tSpeeds), rightFore: peak(fSpeeds), leftArm: peak(aSpeeds) },
    ticksOver6Deg: { torso: fast(tSpeeds), rightFore: fast(fSpeeds), leftArm: fast(aSpeeds) },
    releasePeakDegPerTick: +Math.max(0, ...relSpeeds.map(s => s.deg)).toFixed(2),
    releaseIntensity: release.map(r => r.haul?.intensity ?? null),
    releaseBeatEnd: release.at(-1).haul?.beat ?? 'clear'
  };
  console.log('run ' + budget.padEnd(9) + ' ' + JSON.stringify(runs[budget]));
}

await page.evaluate(() => window.__vis.restore());
await writeFile(resolve(outDir, 'grab-haul-visual.json'), JSON.stringify({
  kind: 'grab-haul-visual', generatedAt: new Date().toISOString(),
  note: 'per-tick samples at 60 Hz; strip frames are deterministic renders at simulation times, not a recording of live play',
  runs, stripFrames, pageErrors }, null, 2));
console.log('strip ' + stripFrames.length + ' frames, page errors ' + pageErrors.length);
await browser.close();
await new Promise(done => server.close(done));
