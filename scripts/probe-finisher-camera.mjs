// Phase 29.1 browser verification: does an authored finisher camera profile actually present, and
// does the camera always come back?
//
//   bash scripts/run-browser-test.sh scripts/probe-finisher-camera.mjs
//
// One `page.evaluate` per pilot drives four scenarios against the real game: a landed ultimate, a
// whiff, a real interruption and a KO. Each scenario runs until the ultimate record reports `done`.
//
// Two harness facts learned the hard way, both of which produced false failures:
//
//  1. `updateUltimates` is called from `simulationStep`, which early-returns once `started` is false.
//     A probe that KOs the player twice ends the series, after which every cast is accepted, the
//     real-time director still presents the intro, and nothing ever advances or deals damage. Each
//     pilot therefore gets a fresh match, and only one KO per match.
//  2. `main.js` imports its modules with cache-busting queries, so `import('/js/combat/ultimate.js')`
//     is a second module instance with its own ACTIVE array. Cast through `window.combatPowers`.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase291');
await mkdir(outDir, { recursive: true });

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    const body = await readFile(filePath); // read first: headers before a failed read threw
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const report = { phase: '29.1', kind: 'finisher-camera-pilot', status: 'running', pageErrors: [],
  pilots: {}, regression: {} };
const expectations = [];
const expectThat = (scope, name, ok, detail = '') => expectations.push({ scope, name, ok: Boolean(ok), detail });

const PILOTS = [
  { select: 'Saitama', key: 'saitama', behaviour: 'rush' },
  { select: 'Sasuke Uchiha', key: 'sasuke_uchiha', behaviour: 'beam' },
  { select: 'Lord Voldemort', key: 'lord_voldemort', behaviour: 'zone' },
  { select: 'Spider-Man', key: 'spider_man', behaviour: 'grab' }
];

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', e => report.pageErrors.push(String(e.message || e)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) }); }
    catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });

  const openMatch = async (p2Label = 'Superman') => {
    await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
      && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
      null, { timeout: 150_000, polling: 200 });
    await page.evaluate(({ label }) => {
      window.__browserSmashSelect.setMode('2p');
      const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
      (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
      (cards.find(c => c.dataset.fighter === label) || cards[1])?.click();
      window.__probeCallouts = [];
      const original = window.showCombatCallout;
      window.showCombatCallout = (text, color) => { window.__probeCallouts.push(String(text)); return original?.(text, color); };
    }, { label: p2Label });
    await page.click('#selectScreen [data-nav="next"]');
    const arenaCard = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
      || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
    await arenaCard.click();
    await page.click('#play');
    await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 30_000, polling: 100 });
  };

  // Regression sweep: every authored profile must still reach the camera and hand it back.
  await openMatch('Superman');
  const sweep = await page.evaluate(async ({ pilotKeys }) => {
    const fin = await import('/js/combat/cinematic_finisher.js');
    const p1 = window.fighters[0], p2 = window.fighters[1];
    const camera = window.smashCamera;
    const select = document.getElementById('cpuCharacter');
    const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const options = [...select.options].map(o => ({ label: o.textContent.trim(), key: slug(o.textContent) }));
    const rows = {};
    const trials = Object.keys(fin.FINISHERS).map(key => {
      const option = options.find(o => o.key === key);
      return option ? { key, label: option.label } : null;
    }).filter(Boolean);
    for (const { key, label } of trials) {
      select.value = label;
      select.dispatchEvent(new Event('change'));
      window.combatPowers.clear('sweep');
      for (const f of [p1, p2]) { f.percent = 0; f.hitstun = 0; f.invulnerable = 0; f.velocity.set(0, 0, 0); f.casting = null; }
      p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1;
      p2.position.set(1.06, p2.groundLevel ?? 0, 0); p2.facing = -1;
      window.__browserSmashStep(1 / 60);
      p2.meter = 100;
      const rec = window.combatPowers.tryUltimate(p2);
      let sawAuthored = null, sawImpact = false;
      for (let i = 0; i < 240 && rec?.phase !== 'done'; i++) {
        window.__browserSmashStep(1 / 60);
        const cine = camera.describeCineShot();
        if (cine.active && cine.authored?.fov != null) sawAuthored ||= cine.authored.fov;
        const beats = (window.__browserSmashFinisherTrace || []).map(t => t.beat);
        if (beats.includes('finisher') || beats.includes('impact')) sawImpact = true;
      }
      for (let i = 0; i < 4; i++) window.__browserSmashStep(1 / 60);
      const restored = camera.describeCineShot().active;
      rows[key] = { label, cast: Boolean(rec && rec.ok !== false), authored: sawAuthored,
        finisher: sawImpact, restored, cinematic: document.body.classList.contains('cinematic'),
        authoredFov: fin.FINISHERS[key].shots.finisher.fov, pilot: pilotKeys.includes(key) };
      // Leave the match alive: a KO here would end the series before the pilot scenarios run.
      p1.percent = 0; p2.percent = 0;
    }
    return rows;
  }, { pilotKeys: PILOTS.map(p => p.key) });
  for (const [key, row] of Object.entries(sweep)) {
    // `authored` is the first authored lens the camera reported for that cast, which is the intro
    // shot, not necessarily the finisher close-up. The claim under test is that authored shot data
    // reached the camera at all; the finisher lens is asserted per pilot below.
    expectThat('regression', `${key}: profile authored and reached the camera`,
      row.cast && row.authored != null && row.authored >= 26 && row.authored <= 62, JSON.stringify(row));
    expectThat('regression', `${key}: camera and chrome restored`,
      row.restored === false && row.cinematic === false, JSON.stringify(row));
    if (!row.pilot) {
      expectThat('regression', `${key}: pre-existing profile still plays its finisher`, row.finisher, JSON.stringify(row));
    }
  }
  report.regression = sweep;
  console.log(`regression sweep: ${Object.keys(sweep).length} authored profiles`);

  for (const pilot of PILOTS) {
    await openMatch(pilot.select);
    const out = await page.evaluate(async ({ identity, key }) => {
      const p1 = window.fighters[0], p2 = window.fighters[1];
      const camera = window.smashCamera;
      const fin = await import('/js/combat/cinematic_finisher.js');
      const profile = fin.finisherFor(p2.identityKey);

      const reset = () => {
        window.combatPowers.clear('probe');
        for (const f of [p1, p2]) {
          f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
          f.guardHeld = false; f.meter = 0; f.casting = null; f.ko = false;
          f.grabbedBy = null; f.grabTarget = null; f.guardBreak = 0; f.guardStun = 0;
          f.attackQueue.length = 0; f.isGrounded = true;
        }
        p1.shield = 100; p2.shield = 100;
        p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1; p1.facingZ = 0;
        p2.position.set(1.06, p2.groundLevel ?? 0, 0); p2.facing = -1; p2.facingZ = 0;
        window.__browserSmashFinisherTrace = [];
        window.__browserSmashFinisherIdentity = null;
        window.__probeCallouts = [];
        window.__browserSmashStep(1 / 60);
      };

      const scenario = mode => {
        reset();
        p2.meter = 100;
        const gate = window.combatPowers.snapshot(p2).ultimateReason;
        const rec = window.combatPowers.tryUltimate(p2);
        if (!rec || rec.ok === false) return { castOk: false, reason: rec?.reason || 'rejected', gate };
        const startFov = camera.camera.fov;
        const trace = [];
        let firstHitAt = null;
        const read = () => {
          const cine = camera.describeCineShot();
          return { phase: rec.phase, fired: rec.fired, hits: rec.hitCount, whiffs: rec.whiffs,
            cinematic: document.body.classList.contains('cinematic'),
            cine: cine.active ? { beat: cine.beat, fov: cine.fov, fitted: cine.fittedNdc,
              authoredFov: cine.authored?.fov ?? null } : null,
            beats: (window.__browserSmashFinisherTrace || []).length,
            fov: +camera.camera.fov.toFixed(2) };
        };
        trace.push({ tick: 0, ...read() });
        for (let tick = 1; tick <= 400; tick++) {
          // A whiff steps out of the lane, the column and the zone: the mark stays where it was cast.
          if (mode === 'whiff' && tick === 3) p1.position.set(0, p1.groundLevel ?? 0, 34);
          // A real interruption: the game's own hit resolver staggers the caster during startup.
          if (mode === 'interrupt' && tick === 2) {
            window.combatPowers.hit(p1, p2, { damage: 4, kbs: 40, launchY: 1.5, stun: .55, kind: 'light' });
          }
          // One KO per match: the series is 2 of 3, so this cannot end it.
          if (mode === 'opponentKO' && tick === 8) p1.percent = 160;
          window.__browserSmashStep(1 / 60);
          if (firstHitAt === null && rec.hitCount > 0) firstHitAt = +(rec.t).toFixed(2);
          const now = read();
          if (Object.keys(now).some(k => now[k] !== trace[trace.length - 1][k])) trace.push({ tick, ...now });
          if (rec.phase === 'done') break;
        }
        for (let i = 0; i < 4; i++) window.__browserSmashStep(1 / 60);
        trace.push({ tick: 'settled', ...read() });
        return {
          castOk: true, gate, startFov: +startFov.toFixed(2), trace, endReason: rec.endReason || null,
          firstHitAt, beats: (window.__browserSmashFinisherTrace || []).map(t => t.beat),
          identity: window.__browserSmashFinisherIdentity || null,
          damage: +p1.percent.toFixed(2), meterAfter: +p2.meter.toFixed(1),
          callouts: (window.__probeCallouts || []).slice(-8),
          restored: { cine: camera.describeCineShot().active,
            cinematic: document.body.classList.contains('cinematic'),
            count: window.__browserSmashFinisherCount ?? null, fov: +camera.camera.fov.toFixed(2) },
          authoredFinisherFov: profile.shots.finisher.fov, authoredLabel: profile.label,
          matchStatus: window.__browserSmashMatch().status, wins: window.__browserSmashMatch().wins
        };
      };

      const rows = { hit: scenario('hit'), whiff: scenario('whiff'),
        interrupt: scenario('interrupt'), opponentKO: scenario('opponentKO') };
      rows.transition = { status: window.__browserSmashMatch().status,
        wins: window.__browserSmashMatch().wins,
        cine: camera.describeCineShot().active,
        cinematic: document.body.classList.contains('cinematic'),
        count: window.__browserSmashFinisherCount ?? null };
      window.combatPowers.clear('rematch');
      window.__browserSmashStep(1 / 60);
      rows.rematch = { cine: camera.describeCineShot().active,
        cinematic: document.body.classList.contains('cinematic'),
        count: window.__browserSmashFinisherCount ?? null };
      return { key, behavior: p2.ultimateDef?.behaviour, range: p2.ultimateDef?.range, rows };
    }, { identity: pilot.select, key: pilot.key });

    const r = out.rows;
    for (const mode of ['hit', 'whiff', 'interrupt', 'opponentKO']) {
      const row = r[mode];
      expectThat(pilot.key, `${mode}: cast accepted`, row.castOk, JSON.stringify({ gate: row.gate, reason: row.reason }));
      if (!row.castOk) continue;
      const beats = [...new Set(row.beats || [])];
      const sawFinisher = beats.includes('finisher') || beats.includes('impact');
      expectThat(pilot.key, `${mode}: ultimate reached a conclusion`, row.endReason != null,
        `end=${row.endReason} status=${row.matchStatus}`);
      expectThat(pilot.key, `${mode}: camera released`, row.restored.cine === false, JSON.stringify(row.restored));
      expectThat(pilot.key, `${mode}: cinematic chrome cleared`, row.restored.cinematic === false, JSON.stringify(row.restored));
      expectThat(pilot.key, `${mode}: finisher director empty`, (row.restored.count ?? 0) === 0, String(row.restored.count));
      expectThat(pilot.key, `${mode}: duel lens restored`, row.restored.fov >= 26 && row.restored.fov <= 65.01,
        `${row.startFov} -> ${row.restored.fov}`);
      if (mode === 'hit') {
        expectThat(pilot.key, 'hit: authored profile used',
          row.identity?.authored === true && row.identity?.identity === pilot.key, JSON.stringify(row.identity));
        expectThat(pilot.key, 'hit: the ultimate connected', row.damage > 0, `damage=${row.damage} end=${row.endReason}`);
        expectThat(pilot.key, 'hit: cinematic chrome appears', row.trace.some(t => t.cinematic));
        expectThat(pilot.key, 'hit: a finisher/impact shot is presented', sawFinisher, JSON.stringify(beats));
        expectThat(pilot.key, 'hit: authored finisher lens reached the camera',
          row.trace.some(t => t.cine?.beat === 'finisher' && t.cine.authoredFov === row.authoredFinisherFov),
          `authored=${row.authoredFinisherFov} seen=${JSON.stringify([...new Set(row.trace.filter(t => t.cine).map(t => t.cine.authoredFov))])}`);
        expectThat(pilot.key, 'hit: the fitted frame keeps both bodies inside the margin',
          row.trace.some(t => t.cine?.fitted != null && t.cine.fitted <= 0.85),
          JSON.stringify(row.trace.filter(t => t.cine).map(t => t.cine.fitted).slice(0, 8)));
        expectThat(pilot.key, 'hit: the first strike lands after startup', row.firstHitAt > 0, String(row.firstHitAt));
      }
      if (mode === 'whiff') {
        expectThat(pilot.key, 'whiff: no finisher shot is spent', !sawFinisher, JSON.stringify(beats));
        expectThat(pilot.key, 'whiff: no damage', row.damage === 0, String(row.damage));
      }
      if (mode === 'interrupt') {
        expectThat(pilot.key, 'interrupt: the cast was interrupted', row.endReason === 'interrupted',
          `${row.endReason} ${JSON.stringify(row.callouts)}`);
        expectThat(pilot.key, 'interrupt: the meter was refunded', row.meterAfter >= 100, String(row.meterAfter));
        expectThat(pilot.key, 'interrupt: no finisher shot is spent', !sawFinisher, JSON.stringify(beats));
      }
    }
    expectThat(pilot.key, 'round transition: no cinematic survives',
      r.transition.cine === false && r.transition.cinematic === false, JSON.stringify(r.transition));
    expectThat(pilot.key, 'rematch: clean camera and director',
      r.rematch.cine === false && r.rematch.cinematic === false && (r.rematch.count ?? 0) === 0,
      JSON.stringify(r.rematch));
    report.pilots[pilot.key] = out;
    console.log(`\n== ${pilot.key} (${pilot.select}, ${out.behavior}, range ${out.range}, profile ${r.hit.authoredLabel})`);
    for (const mode of ['hit', 'whiff', 'interrupt', 'opponentKO']) {
      const row = r[mode];
      console.log(`  ${mode.padEnd(10)} cast=${row.castOk} end=${row.endReason} ${row.firstHitAt != null ? `firstHit@${row.firstHitAt}s ` : ''}`
        + `beats=${[...new Set(row.beats || [])].join(',')} dmg=${row.damage} meter=${row.meterAfter}`
        + ` lens=${row.authoredFinisherFov} restored=${JSON.stringify(row.restored)}`);
    }
    console.log(`  transition=${JSON.stringify(r.transition)} rematch=${JSON.stringify(r.rematch)}`);
  }
  report.expectations = expectations;
  report.failures = expectations.filter(e => !e.ok);
  report.status = report.pageErrors.length ? 'page-errors' : (report.failures.length ? 'failed' : 'complete');
} catch (error) {
  report.crash = String(error?.stack || error);
  report.status = 'crashed';
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
await writeFile(resolve(outDir, 'PILOT_RESULTS.json'), JSON.stringify(report, null, 2));
{
  const lines = ['# Phase 29.1 — finisher camera pilot results', '',
    `Status: **${report.status}**. ${(report.expectations || []).length - (report.failures || []).length}` +
    `/${(report.expectations || []).length} checks passed, generated by \`scripts/probe-finisher-camera.mjs\`.`,
    '', '## Regression: all authored profiles', '',
    '| Profile | Authored lens | Reached camera | Finisher shot | Camera restored |',
    '| --- | --- | --- | --- | --- |'];
  for (const [key, row] of Object.entries(report.regression || {})) {
    lines.push(`| ${key}${row.pilot ? ' (pilot)' : ''} | ${row.authoredFov} | ${row.authored === row.authoredFov ? 'yes' : 'no'}`
      + ` | ${row.finisher ? 'yes' : (row.pilot ? 'no (did not connect)' : 'NO')} | ${row.restored ? 'NO' : 'yes'} |`);
  }
  lines.push('', '## Pilots', '',
    '| Pilot | Behaviour | Landed damage | First hit | Beats presented | Authored lens | Camera restored |',
    '| --- | --- | --- | --- | --- | --- | --- |');
  for (const [key, out] of Object.entries(report.pilots || {})) {
    const hit = out.rows.hit || {};
    lines.push(`| ${key} | ${out.behavior} (range ${out.range}) | ${hit.damage ?? '—'} | `
      + `${hit.firstHitAt != null ? hit.firstHitAt + 's' : '—'} | ${[...new Set(hit.beats || [])].join(', ') || '—'} | `
      + `${hit.authoredFinisherFov ?? '—'} | ${hit.restored ? (hit.restored.cine ? 'NO' : 'yes') : '—'} |`);
  }
  const fails = report.failures || [];
  if (fails.length) { lines.push('', '## Failures', ''); for (const f of fails) lines.push(`- ${f.scope}: ${f.name} — ${f.detail}`); }
  await writeFile(resolve(outDir, 'PILOT_RESULTS.md'), lines.join('\n'));
}
const failed = (report.expectations || []).filter(e => !e.ok);
for (const e of failed) console.log(`FAIL ${e.scope}: ${e.name} — ${e.detail}`);
console.log(`\n${(report.expectations || []).length - failed.length}/${(report.expectations || []).length} checks passed; status=${report.status}`);
if (report.pageErrors?.length) console.log('page errors:', report.pageErrors.slice(0, 5));
if (report.crash) console.log('crash:', report.crash.slice(0, 900));
process.exit(report.status === 'complete' ? 0 : 1);
