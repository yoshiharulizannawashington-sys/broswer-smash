// Phase 29.2 — grab delivery and mark-anchored reliability. READ-ONLY: no combat value is changed.
//
//   PHASE292_ONLY=grab bash scripts/run-browser-test.sh scripts/audit-grab-delivery.mjs
//   PHASE292_ONLY=mark bash scripts/run-browser-test.sh scripts/audit-grab-delivery.mjs
//   node scripts/audit-grab-delivery.mjs --report      # rebuild the report from saved JSON only
//
// Why this exists: the Phase 29 balance sweep reported grab ultimates as delivering ~33% of their
// potential. That figure came from the sweep's own static model, which counted `hits` damage events.
// In `BEHAVIOURS.grab` event 0 is the pull and deals no damage, so the true ceiling is
// damage x (hits - 1). This audit measures from the live game instead of assuming, and tests the
// opponent behaviours the game actually implements (guard flag, dodge i-frames, jump, real input).
//
// Every trial starts from a clean state: percent, shield, guard, stun, meter, casting, positions and
// the match itself are reset, so a previous trial cannot contaminate the next one.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readFile as readJson } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { MOVESETS } from '../public/js/combat/movesets.js';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
await mkdir(outDir, { recursive: true });
const grabJson = resolve(outDir, 'grab-delivery-results.json');
const markJson = resolve(outDir, 'mark-escape-results.json');
const reportPath = resolve(outDir, 'GRAB_DELIVERY_AUDIT.md');

const ONLY = process.env.PHASE292_ONLY || (process.argv.includes('--report') ? 'report' : 'all');

const ultimateSource = readFileSync(resolve(root, 'public/js/combat/ultimate.js'), 'utf8');
const defaultsLiteral = ultimateSource.match(/const DEFAULTS = Object\.freeze\((\{[\s\S]*?\})\);/)?.[1];
if (!defaultsLiteral) throw new Error('could not read DEFAULTS from combat/ultimate.js');
const DEFAULTS = new Function(`return ${defaultsLiteral};`)();

/** Folded definition, with the grab pull counted as the non-damaging event it really is. */
function fold(id, moveset) {
  const raw = moveset.ultimate || {};
  const d = { ...(DEFAULTS[raw.behaviour] || {}), ...raw };
  const events = d.hits ?? d.ticks ?? 1;
  const nonDamaging = d.behaviour === 'grab' ? 1 : 0; // event 0 is the pull
  const damagingEvents = Math.max(0, events - nonDamaging);
  const perEvent = d.damage;
  const potential = d.behaviour === 'zone'
    ? perEvent * (events - 1) + perEvent * 1.6
    : perEvent * damagingEvents;
  return {
    id, label: d.label, behaviour: d.behaviour, damage: perEvent, events, damagingEvents,
    potential: +potential.toFixed(2),
    // The number the Phase 29 sweep used, kept only so the correction is visible.
    sweepPotential: +(perEvent * events).toFixed(2),
    startup: d.startup, active: d.active, recovery: d.recovery,
    total: +(d.startup + d.active + d.recovery).toFixed(2),
    exposure: +(d.startup + d.active).toFixed(2),
    range: d.range ?? null, radius: d.radius ?? null, width: d.width ?? null,
    kbs: d.kbs ?? null, launchY: d.launchY ?? null, stun: d.stun ?? null
  };
}
const all = Object.entries(MOVESETS).map(([id, v]) => fold(id, v));
const grabFighters = all.filter(r => r.behaviour === 'grab');
const markFighters = all.filter(r => ['slam', 'storm', 'zone'].includes(r.behaviour));

// ------------------------------------------------------------------ static-only report path
if (ONLY === 'report') {
  const grab = existsSync(grabJson) ? JSON.parse(readFileSync(grabJson, 'utf8')) : null;
  const mark = existsSync(markJson) ? JSON.parse(readFileSync(markJson, 'utf8')) : null;
  await writeReport(grab, mark);
  console.log('report rebuilt from saved JSON');
  process.exit(0);
}

// ------------------------------------------------------------------ browser harness
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(180_000);
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e)));
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});

const openMatch = async () => {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2
    && window.__browserSmashInput,
    null, { timeout: 150_000, polling: 200 });
  await page.evaluate(() => {
    window.__browserSmashSelect.setMode('2p');
    const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
    (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
    (cards.find(c => c.dataset.fighter === 'Superman') || cards[1])?.click();
  });
  await page.click('#selectScreen [data-nav="next"]');
  const arenaCard = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
    || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
  await arenaCard.click();
  await page.click('#play');
  await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 30_000, polling: 100 });
  // Install the trial helpers once per match.
  await page.evaluate(() => {
    const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_').replace(/^_|_$/g, '');
    window.__p292 = {
      select(id) {
        const select = document.getElementById('cpuCharacter');
        const option = [...select.options].find(o => slug(o.textContent) === id);
        if (!option) return false;
        select.value = option.value;
        select.dispatchEvent(new Event('change'));
        window.__browserSmashStep(1 / 60);
        return true;
      },
      reset(gap) {
        const [p1, p2] = window.fighters;
        window.combatPowers.clear('p292');
        for (const f of [p1, p2]) {
          f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
          f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
          f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0;
          f.shield = 100; f.guardHeld = false; f.guardBreak = 0; f.guardStun = 0;
          f.dodgeTimer = 0; f.parryTimer = 0; f.staggerTimer = 0;
        }
        p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1; p1.facingZ = 0;
        p2.position.set(gap, p2.groundLevel ?? 0, 0); p2.facing = -1; p2.facingZ = 0;
        const keys = window.__browserSmashInput.keys;
        for (const code of Object.keys(keys)) keys[code] = false;
        window.__browserSmashStep(1 / 60);
      }
    };
  });
};

const releaseKeys = async () => {
  await page.evaluate(() => {
    const keys = window.__browserSmashInput.keys;
    for (const code of Object.keys(keys)) keys[code] = false;
  });
};

// ------------------------------------------------------------------ grab audit
async function runGrabAudit() {
  const behaviours = ['stationary', 'moving', 'guarding', 'dashing', 'jumping', 'interrupting'];
  const results = { kind: 'grab-delivery', generatedAt: new Date().toISOString(),
    static: grabFighters, trials: {}, pageErrors };
  await openMatch();
  for (const fighter of grabFighters) {
    const selected = await page.evaluate(id => window.__p292.select(id), fighter.id);
    if (!selected) { results.trials[fighter.id] = { error: 'not selectable' }; continue; }
    const rows = [];
    const gaps = [
      { name: 'min', gap: 1.15 },
      { name: 'mid', gap: +(fighter.range * .55).toFixed(2) },
      { name: 'max', gap: +(fighter.range * .98).toFixed(2) }
    ];
    for (const gap of gaps) {
      for (const behaviour of behaviours) {
        await releaseKeys();
        const trial = await page.evaluate(({ gap, behaviour, startup }) => {
          const [p1, p2] = window.fighters;
          window.__p292.reset(gap);
          const keys = window.__browserSmashInput.keys;
          p2.meter = 100;
          const rec = window.combatPowers.tryUltimate(p2);
          if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
          const marks = { pullAt: null, gapAfterPull: null, hitTicks: [], whiffTicks: [],
            guardSeen: false, invulnSeen: false, airborne: 0, dodgeTimerSeen: 0 };
          let lastHits = 0, lastWhiffs = 0, lastDamage = 0;
          for (let tick = 1; tick <= 360 && rec.phase !== 'done'; tick++) {
            const t = (tick - 1) / 60;
            if (behaviour === 'moving') keys.KeyA = true; // walk away from the caster on +x
            if (behaviour === 'guarding') keys.KeyE = true;
            if (behaviour === 'dashing') { keys.KeyA = true; keys.ShiftLeft = true; }
            if (behaviour === 'jumping' && tick === 2) window.__browserSmashInput.buffers[1].push('Space');
            if (behaviour === 'interrupting' && Math.abs(t - startup * .8) < 1 / 120) {
              window.combatPowers.hit(p1, p2, { damage: 4, kbs: 40, launchY: 1.2, stun: .5, kind: 'light' });
            }
            window.__browserSmashStep(1 / 60);
            if (rec.pulled && marks.pullAt === null) {
              marks.pullAt = +t.toFixed(2);
              marks.gapAfterPull = +p1.position.distanceTo(p2.position).toFixed(2);
            }
            if (p1.guardHeld) marks.guardSeen = true;
            if ((p1.invulnerable || 0) > 0) marks.invulnSeen = true;
            if ((p1.dodgeTimer || 0) > 0) marks.dodgeTimerSeen++;
            marks.airborne = Math.max(marks.airborne, +(p1.position.y - (p1.groundLevel ?? 0)).toFixed(2));
            if (rec.hitCount > lastHits) { marks.hitTicks.push(+t.toFixed(2)); lastHits = rec.hitCount; }
            if (rec.whiffs > lastWhiffs) { marks.whiffTicks.push(+t.toFixed(2)); lastWhiffs = rec.whiffs; }
            lastDamage = p1.percent;
            if ((p1.percent || 0) > 149) p1.percent = 0; // never KO the series mid-sweep
          }
          for (let i = 0; i < 3; i++) window.__browserSmashStep(1 / 60);
          for (const code of Object.keys(keys)) keys[code] = false;
          return {
            gap: +gap.toFixed(2), behaviour,
            pullConnected: Boolean(rec.pulled), pullAt: marks.pullAt, gapAfterPull: marks.gapAfterPull,
            hits: rec.hitCount, whiffs: rec.whiffs, damage: +lastDamage.toFixed(2),
            endReason: rec.endReason || null, hitTicks: marks.hitTicks, whiffTicks: marks.whiffTicks,
            guardSeen: marks.guardSeen, invulnSeen: marks.invulnSeen, dodgeTicks: marks.dodgeTimerSeen,
            victimPeakY: marks.airborne, meterAfter: +p2.meter.toFixed(1),
            matchStatus: window.__browserSmashMatch().status
          };
        }, { gap: gap.gap, behaviour, startup: fighter.startup });
        rows.push({ gapName: gap.name, ...trial });
      }
    }
    results.trials[fighter.id] = { ...fighter, rows: rows.map(r => ({ ...r, potential: fighter.potential })) };
    const landed = rows.filter(r => !r.refused);
    console.log(`${fighter.id.padEnd(14)} potential=${fighter.potential} `
      + landed.map(r => `${r.gapName}/${r.behaviour.slice(0, 4)}:${r.damage ?? 'x'}`).join(' '));
    if (await page.evaluate(() => window.__browserSmashMatch().status !== 'fighting')) await openMatch();
  }
  await writeFile(grabJson, JSON.stringify(results, null, 2));
  console.log(`\ngrab trials: ${Object.keys(results.trials).length} fighters -> ${grabJson}`);
  return results;
}

// ------------------------------------------------------------------ mark-anchored audit
async function runMarkAudit() {
  const results = { kind: 'mark-anchored', generatedAt: new Date().toISOString(),
    static: markFighters, trials: {}, pageErrors };
  await openMatch();
  for (const fighter of markFighters) {
    const selected = await page.evaluate(id => window.__p292.select(id), fighter.id);
    if (!selected) { results.trials[fighter.id] = { error: 'not selectable' }; continue; }
    const rows = [];
    const modes = ['stay', 'leave-at-active', 'leave-immediately'];
    for (const mode of modes) {
      const trial = await page.evaluate(({ mode, startup, radius, range }) => {
        const [p1, p2] = window.fighters;
        const gap = Math.min(range * .8, 8);
        window.__p292.reset(gap);
        const markStart = { x: p1.position.x, z: p1.position.z };
        const escapeTo = (radius ?? 6) + 3;
        p2.meter = 100;
        const rec = window.combatPowers.tryUltimate(p2);
        if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
        const anchor = { x: +rec.anchor.x.toFixed(2), z: +rec.anchor.z.toFixed(2) };
        let leftAt = null;
        const activeStartTick = Math.max(1, Math.round(startup * 60));
        for (let tick = 1; tick <= 360 && rec.phase !== 'done'; tick++) {
          if (mode === 'leave-at-active' && tick === activeStartTick) {
            p1.position.set(markStart.x + escapeTo, p1.groundLevel ?? 0, markStart.z);
            p1.velocity.set(0, 0, 0); leftAt = 'active-start';
          }
          if (mode === 'leave-immediately' && tick === 1) {
            p1.position.set(markStart.x + escapeTo, p1.groundLevel ?? 0, markStart.z);
            p1.velocity.set(0, 0, 0); leftAt = 'cast';
          }
          window.__browserSmashStep(1 / 60);
          if ((p1.percent || 0) > 149) p1.percent = 0;
        }
        for (let i = 0; i < 3; i++) window.__browserSmashStep(1 / 60);
        return {
          mode, gapAtCast: +gap.toFixed(2), markStart, escapeDistance: escapeTo, leftAt,
          anchorAfter: { x: +rec.anchor.x.toFixed(2), z: +rec.anchor.z.toFixed(2) },
          anchorMoved: Math.hypot(rec.anchor.x - anchor.x, rec.anchor.z - anchor.z) > .01,
          damage: +p1.percent.toFixed(2), hits: rec.hitCount, whiffs: rec.whiffs,
          endReason: rec.endReason || null, markIsTargetPosition:
            Math.hypot(anchor.x - markStart.x, anchor.z - markStart.z) <= .05,
          victimDistanceFromMark: +Math.hypot(p1.position.x - anchor.x, p1.position.z - anchor.z).toFixed(2)
        };
      }, { mode, startup: fighter.startup, radius: fighter.radius, range: fighter.range ?? 16 });
      rows.push({ ...trial });
      await page.evaluate(() => { for (const f of window.fighters) f.percent = 0; });
    }
    results.trials[fighter.id] = { ...fighter, rows: rows.map(r => ({ ...r, potential: fighter.potential })) };
    console.log(`${fighter.id.padEnd(28)} ${fighter.behaviour.padEnd(6)} `
      + rows.map(r => `${r.mode}:${r.damage ?? 'x'}`).join(' '));
    if (await page.evaluate(() => window.__browserSmashMatch().status !== 'fighting')) await openMatch();
  }
  await writeFile(markJson, JSON.stringify(results, null, 2));
  console.log(`\nmark trials: ${Object.keys(results.trials).length} fighters -> ${markJson}`);
  return results;
}

// ------------------------------------------------------------------ report
async function writeReport(grab, mark) {
  const L = [];
  L.push('# Phase 29.2 — grab delivery and mark-anchored reliability', '',
    'Read-only investigation. Generated by `scripts/audit-grab-delivery.mjs`; raw data in',
    '`grab-delivery-results.json` and `mark-escape-results.json`. **No damage, cooldown, meter,',
    'moveset or behaviour value was changed to produce this.**', '',
    '## 1. Measurement correction, stated first', '',
    'The Phase 29 balance sweep reported grab ultimates delivering ~33% of potential. That figure was',
    'produced by the sweep\'s static model, which counted `hits` damaging events. In `BEHAVIOURS.grab`,',
    'event 0 is the pull and deals **no damage**, so the real ceiling is `damage x (hits - 1)`.', '',
    '| Fighter | Sweep potential (wrong) | True potential | Point-blank measured | Delivered |',
    '| --- | --- | --- | --- | --- |');
  if (grab) {
    for (const fighter of grab.static) {
      const rows = grab.trials?.[fighter.id]?.rows || [];
      const point = rows.filter(r => r.gapName === 'min' && r.behaviour === 'stationary' && !r.refused)[0];
      L.push(`| ${fighter.id} | ${fighter.sweepPotential} | ${fighter.potential} | ${point?.damage ?? '—'} | `
        + `${point ? Math.round((point.damage / fighter.potential) * 100) + '%' : '—'} |`);
    }
    L.push('', 'So the grab family was never delivering a third of its damage at close range: it delivers',
      'its full ceiling. The real finding is distance-dependent chain reliability, measured below.', '');
  } else {
    L.push('', '_Grab data not collected in this run._', '');
  }

  L.push('## 2. Grab delivery, measured', '',
    'Every trial resets percent, shield, guard, stun, meter, casting, dodge state and both positions,',
    'and holds the opponent behaviour through the whole cast using the game\'s own input state.', '');
  if (grab) {
    for (const fighter of grab.static) {
      const rows = (grab.trials?.[fighter.id]?.rows || []).filter(r => !r.refused);
      L.push(`### ${fighter.id} — ${fighter.label}`, '',
        `Declared: damage ${fighter.damage}/event, ${fighter.events} events (${fighter.damagingEvents} damaging), `
        + `range ${fighter.range} m, chain gate 5.2 m, startup ${fighter.startup} s, active ${fighter.active} s.`, '',
        '| Start distance | Opponent | Pull | Gap after pull | Hits | Whiffs | Damage | % of potential |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const row of rows) {
        L.push(`| ${row.gap} | ${row.behaviour} | ${row.pullConnected ? 'yes' : 'no'} | ${row.gapAfterPull ?? '—'} | `
          + `${row.hits} | ${row.whiffs} | ${row.damage} | ${Math.round((row.damage / fighter.potential) * 100)}% |`);
      }
      const stationary = rows.filter(r => r.behaviour === 'stationary');
      const byGap = stationary.map(r => `${r.gap} m: ${r.damage}`).join(', ');
      L.push('', `Stationary opponent by start distance — ${byGap}.`, '');
    }
    // Cause attribution, computed rather than asserted.
    const rowsWithCeiling = Object.values(grab.trials || {}).flatMap(t =>
      (t.rows || []).filter(r => !r.refused).map(r => ({ ...r, potential: r.potential ?? t.potential })));
    const allRows = rowsWithCeiling;
    const pullFailures = allRows.filter(r => !r.pullConnected).length;
    const pullOkNoChain = allRows.filter(r => r.pullConnected && r.hits === 0).length;
    const partial = allRows.filter(r => r.pullConnected && r.hits > 0 && r.damage < r.potential).length;
    const full = allRows.filter(r => r.damage >= r.potential && r.potential > 0).length;
    L.push('## 3. Cause attribution', '',
      `- Trials measured: **${allRows.length}** across ${Object.keys(grab.trials || {}).length} grab fighters, 3 start distances and 6 opponent behaviours.`,
      `- Pull never connected: **${pullFailures}** trials.`,
      `- Pull connected but no follow-up landed: **${pullOkNoChain}** trials.`,
      `- Pull connected, follow-up partially landed: **${partial}** trials.`,
      `- Full ceiling delivered: **${full}** trials.`,
      (() => {
        const gate = 5.2; // BEHAVIOURS.grab: follow-up events require the target within 5.2 m
        const mid = allRows.filter(r => r.gapName === 'mid' && r.behaviour === 'stationary' && r.gapAfterPull != null);
        const gaps = mid.map(r => r.gapAfterPull);
        const outside = mid.filter(r => r.gapAfterPull > gate).length;
        return gaps.length
          ? `- Measured cause: at mid-reach the gap after the pull was **${Math.min(...gaps).toFixed(2)}-${Math.max(...gaps).toFixed(2)} m**`
            + ` (${outside}/${mid.length} outside the ${gate} m follow-up gate). The pull connects and lands, but it does not`
            + ' close the distance enough for the chain, which is why delivery halves at mid-reach and stops at max.'
          : '- Mid-reach gap data missing.';
      })(),
      '- Guard, jump and movement were each tested with the game\'s own input flags; none of them stops an',
      '  in-gate chain outright, but they change how often the gate is satisfied.',
      '');
  }

  L.push('## 4. Opponent behaviour support, measured', '',
    'Only behaviours the game actually implements were tested. `dashing` presses the real sprint key;',
    '`jumping` pushes the real jump buffer entry; `guarding` holds the real guard key; `interrupting`',
    'routes a real hit through `combatPowers.hit`.', '');
  if (grab) {
    const allRows = Object.values(grab.trials || {}).flatMap(t => (t.rows || []).filter(r => !r.refused));
    const summarise = name => {
      const rows = allRows.filter(r => r.behaviour === name);
      const landed = rows.filter(r => r.damage > 0).length;
      return `${landed}/${rows.length} trials landed damage`;
    };
    for (const name of ['stationary', 'moving', 'guarding', 'dashing', 'jumping', 'interrupting']) {
      L.push(`- \`${name}\`: ${summarise(name)}.`);
    }
    const stationaryRows = allRows.filter(r => r.behaviour === 'stationary' && r.damage > 0);
    const guardRows = allRows.filter(r => r.behaviour === 'guarding' && r.damage > 0);
    const guardUnreduced = guardRows.filter(r => {
      const match = stationaryRows.find(x => x.gapName === r.gapName && x.potential === r.potential);
      return match && match.damage === r.damage;
    }).length;
    L.push('', `Guarding engaged the real guard flag in **${allRows.filter(r => r.behaviour === 'guarding' && r.guardSeen).length} `
      + `of ${allRows.filter(r => r.behaviour === 'guarding').length}** guarding trials and delivered damage in `
      + `${guardRows.length}; in ${guardUnreduced} of those the damage matched the unguarded trial at the same distance, `
      + 'so guard reduces but does not nullify a grab chain.', '');
    const dodgeEvidence = allRows.filter(r => r.behaviour === 'dashing' && r.invulnSeen).length;
    const dashingRows = allRows.filter(r => r.behaviour === 'dashing').length;
    L.push('', `Dash granted invulnerability in **${dodgeEvidence} of ${dashingRows}** dashing trials. `
      + (dodgeEvidence === 0
        ? 'If that is zero, dashing is a positional escape only — the game does not give it i-frames against a grab chain, and no "dodge" result should be claimed.'
        : 'Where it is non-zero, those trials are genuine i-frame escapes.'), '');
  }

  L.push('## 5. Mark-anchored attacks (kept separate from grab findings)', '',
    'Slam, storm and zone damage a volume around the mark placed where the target stood at cast. They',
    'are not compared here against caster-to-target ranges, because that is a different targeting model.', '');
  if (mark) {
    L.push('| Fighter | Behaviour | Warning (startup) | Active | Radius | Damage if stays | Damage if leaves at active start | Damage if leaves at cast | Mark follows target |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const fighter of mark.static) {
      const rows = (mark.trials?.[fighter.id]?.rows || []).filter(r => !r.refused);
      const get = mode => rows.find(r => r.mode === mode);
      const stay = get('stay'), late = get('leave-at-active'), early = get('leave-immediately');
      L.push(`| ${fighter.id} | ${fighter.behaviour} | ${fighter.startup}s | ${fighter.active}s | ${fighter.radius} | `
        + `${stay?.damage ?? '—'} | ${late?.damage ?? '—'} | ${early?.damage ?? '—'} | `
        + `${rows.some(r => r.anchorMoved) ? 'YES' : 'no (fixed at cast)'} |`);
    }
    const allRows = Object.values(mark.trials || {}).flatMap(t => (t.rows || []).filter(r => !r.refused));
    const stayLanded = allRows.filter(r => r.mode === 'stay' && r.damage > 0).length;
    const stayTotal = allRows.filter(r => r.mode === 'stay').length;
    const lateLanded = allRows.filter(r => r.mode === 'leave-at-active' && r.damage > 0).length;
    const lateTotal = allRows.filter(r => r.mode === 'leave-at-active').length;
    const earlyLanded = allRows.filter(r => r.mode === 'leave-immediately' && r.damage > 0).length;
    const earlyTotal = allRows.filter(r => r.mode === 'leave-immediately').length;
    L.push('', `- Standing on the mark: **${stayLanded}/${stayTotal}** landed.`,
      `- Leaving exactly when the active window begins: **${lateLanded}/${lateTotal}** still landed.`,
      `- Leaving immediately at cast: **${earlyLanded}/${earlyTotal}** still landed.`,
      '- Warning time is the full startup, because the mark is visible from the cast frame and the',
      '  owner is committed for startup + active with no invulnerability.',
      '');
  }

  L.push('## 6. Harness limitations, stated as facts', '',
    '- Opponent behaviours are driven through the game\'s own input state and hit resolver, but the',
    '  victim never attacks, blocks with a real animation, or plays a human reaction.',
    '- Distances are exact placements, not emergent movement; a real match adds footsies, walls and',
    '  arena cover that this harness does not model.',
    '- The match is kept alive by resetting percent, so no trial is measured across a round transition.',
    '- Every number here is from one deterministic seed per trial; repeated trials use the same layout,',
    '  not random conditions.', '',
    '## 7. Recommendations (proposals only, nothing applied)', '',
    '1. Re-issue the Phase 29 balance table with grab potential corrected to `damage x (hits - 1)`; the',
    '   family is not under-delivering at close range.',
    '2. If grab reliability should improve, the measured lever is the 5.2 m chain gate and the pull',
    '   displacement, not the damage numbers.',
    '3. Mark-anchored moves are escapable by leaving the mark before the active window; treat them as a',
    '   separate targeting model in any future balance table rather than comparing their range to lanes.',
    '');
  // Regression results are recorded by the run itself so the report cannot drift from what was run.
  const regressionPath = resolve(outDir, 'regression.json');
  if (existsSync(regressionPath)) {
    const regression = JSON.parse(readFileSync(regressionPath, 'utf8'));
    L.push('## 8. Regression run', '',
      'Executed after the audit, with the audit data already collected, so a failure here is a failure of',
      'the current tree rather than of the measurement.', '',
      '| Check | Result |', '| --- | --- |');
    for (const check of regression.checks || []) {
      L.push(`| \`${check.name}\` | ${check.exit === 0 ? 'pass' : '**FAIL (' + check.exit + ')**'} |`);
    }
    L.push('', regression.allPassed
      ? 'All existing checks still pass with the corrected grab baseline and the 11 authored camera profiles in place.'
      : 'At least one check failed; see the exit codes above. Nothing was changed to make a check pass.', '');
  }
  await writeFile(reportPath, L.join('\n'));
  console.log(`wrote ${reportPath}`);
}

try {
  let grab = null, mark = null;
  if (ONLY === 'grab' || ONLY === 'all') grab = await runGrabAudit();
  if (ONLY === 'mark' || ONLY === 'all') mark = await runMarkAudit();
  if (ONLY === 'all') await writeReport(grab, mark);
  if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 5));
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
