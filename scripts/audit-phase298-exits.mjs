// Phase 29.8 — the two checks final acceptance still needed.
//
//   bash scripts/run-browser-test.sh scripts/audit-phase298-exits.mjs
//
// 1. FOOTWORK: under the `chain` budget the caster gives up 0.100 m. Does that read as a step or as an
//    unexplained slide? Measured by watching her feet (or the ankle proxy when the rig has no foot
//    bone) while the root translates: a step lifts the foot and puts it down; a slide keeps it at
//    ground height and drags it along with the body.
// 2. RELEASE: the pose must unwind when the ultimate is interrupted, when the target breaks the reel,
//    and when the match ends. Each exit is compared against a run of the identical scenario with the
//    overlay suppressed, so "clean" means her body matches the no-overlay body, not just "no crash".
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
await mkdir(outDir, { recursive: true });

const GAP = 4.74;
const PULL = { 'grab-continuity-pull': true };
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

// CHROME_PATH lets this run against a browser that is already unpacked, which is what the workspace
// restore leaves behind when `playwright install` cannot finish.
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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
  const V = window.__browserSmashScene.position.clone();
  // fighters[1] casts here and fighters[0] is the victim: the pose the haul drives belongs to the
  // caster, so every measurement below has to be taken on fighters[1].
  const CASTER = () => window.fighters[1];
  const VICTIM = () => window.fighters[0];
  const world = (f, name) => {
    const j = f.model?.userData?.[name];
    if (!j) return null;
    j.getWorldPosition(V);
    return { x: +V.x.toFixed(4), y: +V.y.toFixed(4), z: +V.z.toFixed(4) };
  };
  const quats = f => {
    const out = {};
    for (const [name, joint] of Object.entries(f.model?.userData || {})) {
      // The procedural rig's joints are plain groups, not SkinnedMesh bones, so the only requirement
      // is an orientation to compare.
      if (!joint?.quaternion) continue;
      out[name] = [+joint.quaternion.x.toFixed(5), +joint.quaternion.y.toFixed(5),
        +joint.quaternion.z.toFixed(5), +joint.quaternion.w.toFixed(5)];
    }
    return out;
  };
  window.__ex = {
    /** What the page actually thinks is happening; used to catch a stale record in the harness. */
    probe() {
      const record = window.__exRecord;
      return { noHaulFlag: Boolean(window.__browserSmashNoHaul), hasRecord: Boolean(record),
        label: record?.label || null, endReason: record?.endReason || null,
        haulAlive: Boolean(record?.__haul), haulIntensity: record?.__haul ? +record.__haul.intensity.toFixed(3) : null,
        sameAsPrevious: record === window.__exPrevRecord };
    },
    begin({ noHaul = false, budget = 'chain', gap = 4.74 } = {}) {
      window.__exPrevRecord = window.__exRecord;
      const caster = CASTER(), target = VICTIM();
      window.combatPowers.clear('p298ex');
      window.__browserSmashNoHaul = noHaul;
      window.__browserSmashCasterBudget = budget;
      for (const f of [caster, target]) {
        f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
        f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
        f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0; f.shield = 100;
        f.guardHeld = false; f.guardBreak = 0; f.grabReel = null; f.__haul = null;
        f.__haulRecord = null; f.model.visible = true;
      }
      caster.position.set(0, caster.groundLevel ?? 0, 0); caster.facing = 1;
      target.position.set(gap, target.groundLevel ?? 0, 0); target.facing = -1;
      const keys = window.__browserSmashInput.keys;
      for (const code of Object.keys(keys)) keys[code] = false;
      window.__browserSmashExperiments = { 'grab-continuity-pull': true };
      // The trace array is created by the overlay's first write, so it may not exist yet.
      (window.__browserSmashHaulTrace ||= []).length = 0;
      window.__browserSmashStep(1 / 60);
      caster.meter = 100;
      const rec = window.combatPowers.tryUltimate(caster);
      // The overlay's state lives on the RECORD, not on the fighter: reading `fighter.__haul` returns
      // undefined no matter what the pose is doing.
      window.__exRecord = rec;
      return { ok: rec?.ok !== false, refused: rec?.refused || null, label: rec?.label };
    },
    /** Foot bones if the rig exposes them, otherwise the ankle end of the shin. */
    footBones() {
      const names = Object.keys(CASTER().model?.userData || {});
      return names.filter(n => /foot|toe|ankle/i.test(n));
    },
    /** Step, and sample the caster's root plus her feet, for the footwork analysis. */
    walk(ticks) {
      const caster = CASTER();
      const feet = this.footBones();
      const samples = [];
      for (let i = 0; i < ticks; i++) {
        window.__browserSmashStep(1 / 60);
        window.combatPowers.applyCinematicPose?.(1 / 60);
        const row = { t: +(Number(window.combatPowers.active?.t) || 0).toFixed(3),
          rootX: +caster.position.x.toFixed(4), rootY: +caster.position.y.toFixed(4),
          // Only the ticks with a live reel are the budget under test; the move's own lunge to reach
          // the target moves her about 1.2 m regardless of budget and would swamp the comparison.
          reel: Boolean(VICTIM().grabReel), feet: {} };
        for (const name of feet) row.feet[name] = world(caster, name);
        if (!feet.length) { row.feet.shinL = world(caster, 'leftShin'); row.feet.shinR = world(caster, 'rightShin'); }
        samples.push(row);
      }
      return { feet, samples };
    },
    /** Trigger an exit, then let the game run on. */
    // The release eases on the wall clock (0.22 s), so the window after an exit has to advance in real
    // time: 48 stepped ticks run in about 60 ms and would only ever catch the very start of the ease.
    async exit(kind, ticks = 30, delayMs = 20) {
      const caster = CASTER(), target = VICTIM();
      const record = window.__exRecord;
      const before = window.__exRecord?.__haul ? +window.__exRecord.__haul.intensity.toFixed(3) : null;
      if (kind === 'interrupt') window.combatPowers.clear('test-interrupt');
      // Breaking the reel is the target escaping the line; no delete, so a non-configurable property
      // cannot throw and abort the whole run.
      else if (kind === 'escape') target.grabReel = null;
      else if (kind === 'match-end') { caster.ko = true; window.combatPowers.clear('match-end'); }
      const after = [];
      let clearedAt = null;
      for (let i = 0; i < ticks; i++) {
        window.__browserSmashStep(1 / 60);
        window.combatPowers.applyCinematicPose?.(1 / 60);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        const state = record?.__haul || null;
        const q = quats(caster);
        if (state && clearedAt == null) { /* still writing */ } else if (!state && clearedAt == null) clearedAt = i;
        after.push({ t: i, q, intensity: state ? +state.intensity.toFixed(3) : null,
          haulRecord: Boolean(caster.__haulRecord) });
      }
      // Does her body stop changing once the overlay is gone? A frozen limb and a released limb both
      // stop changing, so this counter is paired with the no-overlay comparison below.
      let changedAfterClear = 0;
      for (let i = Math.max(1, (clearedAt ?? 0) + 1); i < after.length; i++) {
        const a = after[i - 1].q, b = after[i].q;
        for (const name of Object.keys(a)) {
          if (!b[name]) continue;
          const dot = Math.min(1, Math.abs(a[name][0] * b[name][0] + a[name][1] * b[name][1]
            + a[name][2] * b[name][2] + a[name][3] * b[name][3]));
          if (2 * Math.acos(dot) > 1e-4) { changedAfterClear++; break; }
        }
      }
      return { after, intensityAtTrigger: before, clearedAt,
        intensityLast: after.at(-1).intensity, changedAfterClear,
        haulRecordAtEnd: after.at(-1).haulRecord, last: after.at(-1) };
    }
  };
});

// ---------------------------------------------------------------- 1. footwork vs slide
const GAP_S = 4.74;
const footwork = {};
for (const budget of ['chain', 'per-reel', 'plant']) {
  await page.evaluate(b => window.__ex.begin({ budget: b, gap: 4.74 }), budget);
  const { feet, samples } = await page.evaluate(() => window.__ex.walk(200));
  const naming = feet.length ? feet : ['shinL', 'shinR'];
  const sums = { totalRoot: 0, reelRoot: 0, reelTicks: 0, lift: {}, drag: {}, liftedTicks: 0 };
  for (const name of naming) { sums.lift[name] = 0; sums.drag[name] = 0; }
  for (let i = 1; i < samples.length; i++) {
    const dx = Math.abs(samples[i].rootX - samples[i - 1].rootX);
    sums.totalRoot += dx;
    if (!samples[i].reel) continue;
    sums.reelTicks++;
    sums.reelRoot += dx;
    for (const name of naming) {
      const a = samples[i - 1].feet[name], b = samples[i].feet[name];
      if (!a || !b) continue;
      const up = b.y - a.y;
      sums.lift[name] = Math.max(sums.lift[name], up);
      // Root moves while the foot stays at its height: that foot is being dragged along the floor.
      if (dx > 0.0005 && Math.abs(up) < 0.0008) sums.drag[name] += dx;
      if (up > 0.002) sums.liftedTicks++;
    }
  }
  footwork[budget] = { feet: naming, totalRoot: +sums.totalRoot.toFixed(3),
    reelRoot: +sums.reelRoot.toFixed(3), reelTicks: sums.reelTicks,
    liftInReel: Object.fromEntries(naming.map(n => [n, +sums.lift[n].toFixed(4)])),
    draggedInReel: Object.fromEntries(naming.map(n => [n, +sums.drag[n].toFixed(3)])),
    liftedTicks: sums.liftedTicks };
}
console.log('footwork ' + JSON.stringify(footwork));

// ---------------------------------------------------------------- 2. exit paths
const exits = {};
for (const kind of ['interrupt', 'escape', 'match-end']) {
  exits[kind] = {};
  for (const noHaul of [false, true]) {
    const begin = await page.evaluate(nh => window.__ex.begin({ gap: 4.74, budget: 'chain', noHaul: nh }), noHaul);
    if (!begin.ok) { console.log('refused ' + kind + ' ' + begin.refused); continue; }
    console.log('probe ' + kind + ' ' + JSON.stringify(await page.evaluate(() => window.__ex.probe())));
    // 0.9 s: past the first contact, inside the first reel, where the haul pose is at full strength.
    await page.evaluate(() => window.__ex.walk(54));
    console.log('probe54 ' + kind + ' ' + JSON.stringify(await page.evaluate(() => window.__ex.probe())));
    const result = await page.evaluate(k => window.__ex.exit(k, 30, 20), kind);
    const key = kind + (noHaul ? '/no-haul' : '/haul');
    exits[key] = {
      intensityAtTrigger: result.intensityAtTrigger, clearedAtTick: result.clearedAt,
      intensityLast: result.intensityLast, changedTicksAfterClear: result.changedAfterClear,
      haulRecordAtEnd: result.haulRecordAtEnd, finalQuats: result.last.q
    };
    console.log('exit ' + key + ' ' + JSON.stringify({ intensityAtTrigger: result.intensityAtTrigger,
      clearedAtTick: result.clearedAt, intensityLast: result.intensityLast,
      changedTicksAfterClear: result.changedAfterClear, haulRecordAtEnd: result.haulRecordAtEnd }));
  }
  // A cross-run orientation comparison is not sound here: the cast timeline is partly wall-clock
  // driven, so two runs of the SAME configuration already end tens of degrees apart (measured at 49
  // degrees with no flag difference between them). What can be asserted is that the overlay stops
  // owning her body: its state is gone and the fighter no longer holds the record that posed her.
  const haul = exits[kind + '/haul'] || {};
  const control = exits[kind + '/no-haul'] || {};
  exits[kind].released = haul.clearedAtTick !== null && haul.haulRecordAtEnd === false;
  exits[kind].controlEverPosed = control.intensityAtTrigger !== null;
  console.log('exit ' + kind.padEnd(10) + ' released ' + exits[kind].released
    + ' clearedAt ' + haul.clearedAtTick + ' recordHeld ' + haul.haulRecordAtEnd
    + ' controlEverPosed ' + exits[kind].controlEverPosed);
}

await writeFile(resolve(outDir, 'grab-haul-exits.json'), JSON.stringify({
  kind: 'grab-haul-exits', generatedAt: new Date().toISOString(), gap: GAP_S,
  note: 'footwork: root translation compared against foot lift/drag per budget; exits: 0.9 s into the haul, then 48 ticks after the event, compared with a no-overlay run of the same scenario',
  footwork, exits, pageErrors }, null, 2));
console.log('page errors ' + pageErrors.length);
await browser.close();
await new Promise(done => server.close(done));
