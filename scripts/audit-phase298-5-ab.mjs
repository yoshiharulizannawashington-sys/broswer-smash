// Phase 29.8.5 — the matched A/B, now protected against rig replacement.
//
//   bash scripts/run-browser-test.sh scripts/audit-phase298-5-ab.mjs
//
// 29.8.4 showed a 180 deg "animation spike" was really the sampler comparing two different rig
// instances across a model swap. This audit makes that impossible to misread again:
//   - every joint sample records its own object id, its parent's id and the model's id;
//   - a per-tick angular difference is only computed when all three are unchanged;
//   - comparisons crossing an identity change are EXCLUDED and reported with their ticks;
//   - the run FAILS if identity metadata is missing from any sample;
//   - the reel gate from 29.8.2 is preserved: a trace with no reel fails the audit.
// Measurement only: no animation code is touched.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
await mkdir(outDir, { recursive: true });

const AUTHORED = ['pelvis', 'torso', 'head', 'leftClavicle', 'rightClavicle', 'leftArm', 'leftFore',
  'leftHand', 'rightArm', 'rightFore', 'rightHand', 'leftLeg', 'leftShin', 'leftFoot', 'rightLeg',
  'rightShin', 'rightFoot'];
const GAPS = [3.0, 2.2, 4.0];

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
  renderer.render = () => {};
  window.requestAnimationFrame = () => 0;
  const CASTER = () => window.fighters[1];
  const VICTIM = () => window.fighters[0];
  const ids = new WeakMap();
  let nextId = 1;
  let reelId = 0;
  let wasReel = false;
  const idOf = obj => {
    if (!obj) return null;
    if (!ids.has(obj)) ids.set(obj, nextId++);
    return ids.get(obj);
  };
  const q = (f, name) => {
    const j = f.model?.userData?.[name];
    return j?.quaternion ? [+j.quaternion.x.toFixed(6), +j.quaternion.y.toFixed(6),
      +j.quaternion.z.toFixed(6), +j.quaternion.w.toFixed(6)] : null;
  };
  const sample = (caster, victim, tick) => {
    const rec = window.__abRecord;
    const quats = {}, ident = {};
    for (const name of names) {
      const joint = caster.model?.userData?.[name];
      quats[name] = q(caster, name);
      ident[name] = { bone: idOf(joint), parent: idOf(joint?.parent), model: idOf(caster.model) };
    }
    return {
      tick, t: +(Number(rec?.t) || 0).toFixed(3),
      reel: Boolean(victim.grabReel), reelId, fired: Number(rec?.fired) || 0,
      intensity: rec?.__haul ? +rec.__haul.intensity.toFixed(4) : null,
      tug: rec?.__haul ? +rec.__haul.tug.toFixed(4) : null,
      victimPercent: +(victim.percent || 0).toFixed(1), victimX: +victim.position.x.toFixed(3),
      quats, ident
    };
  };
  window.__ab = {
    begin({ noHaul = false, gap = 3.0, budget = 'plant' } = {}) {
      const caster = CASTER(), victim = VICTIM();
      window.combatPowers.clear('p2985');
      window.__browserSmashNoHaul = noHaul;
      window.__browserSmashCasterBudget = budget;
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
      window.__abRecord = rec;
      reelId = 0; wasReel = false;
      return { ok: rec?.ok !== false, label: rec?.label ?? null, total: rec?.total ?? null };
    },
    step(tick) {
      const caster = CASTER(), victim = VICTIM();
      window.__browserSmashStep(1 / 60);
      window.combatPowers.applyCinematicPose?.(1 / 60);
      const reel = Boolean(victim.grabReel);
      if (reel && !wasReel) reelId++;
      wasReel = reel;
      return sample(caster, victim, tick);
    },
    exit(kind) {
      const caster = CASTER();
      if (kind === 'interrupt') window.combatPowers.clear('test-interrupt');
      else { caster.ko = true; window.combatPowers.clear('match-end'); }
    }
  };
}, AUTHORED);

const angleDeg = (a, b) => {
  if (!a || !b) return null;
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return +(2 * Math.acos(dot) * 180 / Math.PI).toFixed(3);
};

const crossesIdentity = (prev, row, name) => {
  const a = prev?.ident?.[name], b = row?.ident?.[name];
  if (!a || !b) return null;
  return a.bone !== b.bone || a.parent !== b.parent || a.model !== b.model;
};

/** Per-tick angular change, never computed across an identity change. Exclusions are reported. */
function perTick(rows) {
  const out = [];
  out.crossedTicks = [];
  out.missingIdentity = 0;
  for (let i = 1; i < rows.length; i++) {
    const deltas = {};
    let worst = { joint: null, deg: 0 };
    for (const name of AUTHORED) {
      const crossed = crossesIdentity(rows[i - 1], rows[i], name);
      if (crossed == null) { out.missingIdentity++; continue; }
      if (crossed) {
        if (!out.crossedTicks.includes(rows[i].tick)) out.crossedTicks.push(rows[i].tick);
        continue;
      }
      const deg = angleDeg(rows[i - 1].quats[name], rows[i].quats[name]);
      if (deg == null) continue;
      deltas[name] = deg;
      if (deg > worst.deg) worst = { joint: name, deg };
    }
    out.push({ tick: rows[i].tick, t: rows[i].t, worstJoint: worst.joint, worstDeg: worst.deg, deltas,
      intensity: rows[i].intensity, tug: rows[i].tug,
      intensityDelta: rows[i].intensity != null && rows[i - 1].intensity != null
        ? +(rows[i].intensity - rows[i - 1].intensity).toFixed(4) : null,
      tugDelta: rows[i].tug != null && rows[i - 1].tug != null
        ? +(rows[i].tug - rows[i - 1].tug).toFixed(4) : null });
  }
  out.worst = out.reduce((a, b) => (b.worstDeg > a.worstDeg ? b : a), { worstDeg: 0 });
  return out;
}

/** Overlay differential, skipping any joint whose identity changed within either trace. */
function differential(a, b) {
  const baseA = a.rows.find(r => r.reel)?.tick;
  const baseB = b.rows.find(r => r.reel)?.tick;
  if (baseA == null || baseB == null) return null;
  const span = Math.min(a.rows.length - baseA, b.rows.length - baseB);
  const out = [];
  out.skipped = 0;
  for (let k = 0; k < span; k++) {
    const ra = a.rows[baseA + k], rb = b.rows[baseB + k];
    const pa = a.rows[baseA + k - 1], pb = b.rows[baseB + k - 1];
    const deltas = {};
    let worst = { joint: null, deg: 0 };
    for (const j of AUTHORED) {
      const ca = ra.ident?.[j], cb = rb.ident?.[j];
      if (!ca || !cb) continue;
      if (k > 0) {
        const da = pa?.ident?.[j], db = pb?.ident?.[j];
        if (da && ca.bone !== da.bone) { out.skipped++; continue; }
        if (db && cb.bone !== db.bone) { out.skipped++; continue; }
      }
      const deg = angleDeg(ra.quats[j], rb.quats[j]);
      if (deg == null) continue;
      deltas[j] = deg;
      if (deg > worst.deg) worst = { joint: j, deg };
    }
    out.push({ k, tickA: ra.tick, tickB: rb.tick, intensityA: ra.intensity, tugA: ra.tug,
      worstJoint: worst.joint, worstDiff: worst.deg, deltas });
  }
  return out;
}

async function runTrace({ noHaul, gap, ticks = 150 }) {
  const begin = await page.evaluate(([nh, g]) => window.__ab.begin({ noHaul: nh, gap: g }), [noHaul, gap]);
  if (!begin.ok) return { begin, rows: [], reels: 0 };
  const rows = [];
  for (let i = 0; i < ticks; i++) rows.push(await page.evaluate(t => window.__ab.step(t), i));
  return { begin, rows, reels: rows.filter(r => r.reel).length,
    firstReel: rows.find(r => r.reel)?.tick ?? null, events: rows.at(-1)?.fired ?? 0 };
}

const results = { traces: {}, verdicts: {} };
let A = null, B = null, gapUsed = null;
for (const gap of GAPS) {
  A = await runTrace({ noHaul: false, gap });
  B = await runTrace({ noHaul: true, gap });
  console.log('gap ' + gap + ' on reels=' + A.reels + ' firstReelTick=' + A.firstReel + ' events=' + A.events
    + ' | off reels=' + B.reels + ' firstReelTick=' + B.firstReel + ' events=' + B.events);
  if (A.reels > 0 && B.reels > 0) { gapUsed = gap; break; }
  console.log('gap ' + gap + ' REJECTED: a trace never entered a reel, so no comparison is valid.');
}

const fail = async reason => {
  console.log('AUDIT FAILED: ' + reason);
  await writeFile(resolve(outDir, 'grab-haul-ab5.json'), JSON.stringify({
    kind: 'grab-haul-ab-identity', generatedAt: new Date().toISOString(), failed: true, reason,
    traces: results.traces, pageErrors }, null, 2));
  process.exitCode = 2;
};

if (gapUsed == null) {
  await fail('no gap produced a reel in both traces');
} else {
  const onTicks = perTick(A.rows);
  const offTicks = perTick(B.rows);
  results.traces.on = { reels: A.reels, firstReelTick: A.firstReel, events: A.events,
    excludedTicks: onTicks.crossedTicks, missingIdentity: onTicks.missingIdentity };
  results.traces.off = { reels: B.reels, firstReelTick: B.firstReel, events: B.events,
    excludedTicks: offTicks.crossedTicks, missingIdentity: offTicks.missingIdentity };
  if (onTicks.missingIdentity > 0 || offTicks.missingIdentity > 0) {
    await fail('identity metadata missing from ' + (onTicks.missingIdentity + offTicks.missingIdentity) + ' joint samples');
  } else {
    const diff = differential(A, B);
    const worstOn = onTicks.worst;
    const worstOff = offTicks.worst;
    const worstDiff = (diff || []).reduce((x, y) => (y.worstDiff > x.worstDiff ? y : x), { worstDiff: 0 });
    const entryFrames = onTicks.filter(r => r.tick >= A.firstReel - 1 && r.tick <= A.firstReel + 5)
      .map(r => ({ tick: r.tick, intensity: r.intensity, intensityDelta: r.intensityDelta,
        worstDeg: r.worstDeg, joint: r.worstJoint }));
    const tugPeak = onTicks.reduce((x, y) => (Math.abs(y.tugDelta ?? 0) > Math.abs(x.tugDelta ?? 0) ? y : x), { tugDelta: 0 });
    const tugWindow = onTicks.filter(r => Math.abs(r.tick - (tugPeak.tick ?? 0)) <= 3)
      .map(r => ({ tick: r.tick, tug: r.tug, tugDelta: r.tugDelta, worstDeg: r.worstDeg, joint: r.worstJoint }));

    // Release: same identity-protected measurement, stepped in real time so the wall-clock ease runs.
    const releases = {};
    for (const kind of ['interrupt', 'match-end']) {
      await page.evaluate(g => window.__ab.begin({ gap: g }), gapUsed);
      for (let i = 0; i < 54; i++) await page.evaluate(t => window.__ab.step(t), i);
      await page.evaluate(k => window.__ab.exit(k), kind);
      const rows = [];
      let clearedAt = null;
      for (let i = 0; i < 24; i++) {
        const row = await page.evaluate(async t => {
          const r = window.__ab.step(t);
          await new Promise(res => setTimeout(res, 16));
          return r;
        }, 0);
        rows.push(row);
        if (row.intensity == null && clearedAt == null) clearedAt = i;
      }
      const rel = perTick(rows);
      releases[kind] = { clearedAtTick: clearedAt, worstReleaseDeg: rel.worst?.worstDeg ?? 0,
        worstJoint: rel.worst?.worstJoint ?? null, crossedTicks: rel.crossedTicks,
        missingIdentity: rel.missingIdentity, intensityHead: rows.slice(0, 8).map(r => r.intensity) };
      console.log('release ' + kind.padEnd(10) + ' ' + JSON.stringify(releases[kind]));
    }

    results.verdicts = {
      gapUsed, excludedTicks: { on: onTicks.crossedTicks, off: offTicks.crossedTicks },
      differentialSkipped: diff?.skipped ?? null,
      overlayOnWorst: { tick: worstOn.tick, joint: worstOn.worstJoint, deg: worstOn.worstDeg },
      overlayOffWorst: { tick: worstOff.tick, joint: worstOff.worstJoint, deg: worstOff.worstDeg },
      worstOverlayDifferential: { k: worstDiff.k, joint: worstDiff.worstJoint, deg: worstDiff.worstDiff },
      entryFrames, tugWindow, releases,
      combat: { maxVictimPercent: Math.max(0, ...A.rows.map(r => r.victimPercent ?? 0)),
        drawIn: +(A.rows[0].victimX - A.rows.at(-1).victimX).toFixed(3) }
    };
    console.log('excluded on=' + JSON.stringify(onTicks.crossedTicks) + ' off=' + JSON.stringify(offTicks.crossedTicks)
      + ' diffSkipped=' + (diff?.skipped ?? null));
    console.log('on-worst ' + JSON.stringify(results.verdicts.overlayOnWorst)
      + ' off-worst ' + JSON.stringify(results.verdicts.overlayOffWorst));
    console.log('entry ' + JSON.stringify(entryFrames));
    console.log('tug-window ' + JSON.stringify(tugWindow));
    console.log('combat ' + JSON.stringify(results.verdicts.combat));
    await writeFile(resolve(outDir, 'grab-haul-ab5.json'), JSON.stringify({
      kind: 'grab-haul-ab-identity', generatedAt: new Date().toISOString(), failed: false,
      note: 'identity-protected: no per-tick difference is computed across a bone/parent/model change',
      results, onTicks, offTicks, diff, pageErrors }, null, 2));
    console.log('written, page errors ' + pageErrors.length);
  }
}
await browser.close();
await new Promise(done => server.close(done));
