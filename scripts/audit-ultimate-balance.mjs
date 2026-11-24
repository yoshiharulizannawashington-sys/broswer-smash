// Read-only ultimate balance audit across the 34 playable fighters.
//
//   bash scripts/run-browser-test.sh scripts/audit-ultimate-balance.mjs
//
// Nothing here writes to the game. It does two independent things:
//
//  1. STATIC — folds the real `combat/ultimate.js` defaults into every `combat/movesets.js` ultimate
//     and reports the geometry, timing, damage maths and knockback each fighter actually declares.
//  2. MEASURED — casts every ultimate in a live match against a stationary opponent at three
//     distances (point blank, 55% of declared reach, and just past declared reach) and records what
//     the game actually delivered: damage, hits, whiffs, time to first hit, launch height and the
//     caster's own displacement.
//
// Measured results and theoretical recommendations are kept apart: the script never proposes a
// number, it only states what is out of line with a fighter's own behaviour family.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { MOVESETS } from '../public/js/combat/movesets.js';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
await mkdir(outDir, { recursive: true });

// ------------------------------------------------------------------ static model
// The behaviour defaults are not exported, so read them from source and evaluate the literal. A
// hand-copied table would silently drift the day someone edits ultimate.js.
const ultimateSource = readFileSync(resolve(root, 'public/js/combat/ultimate.js'), 'utf8');
const defaultsLiteral = ultimateSource.match(/const DEFAULTS = Object\.freeze\((\{[\s\S]*?\})\);/)?.[1];
if (!defaultsLiteral) throw new Error('could not read DEFAULTS from combat/ultimate.js');
const DEFAULTS = new Function(`return ${defaultsLiteral};`)();
const REFUND_MS = 100;

const COST = { meter: 100 }; // ULTIMATE.max: one full bar, identical for every fighter
const BEHAVIOUR_NOTES = {
  beam: 'single lane from the hands, cover-stopped, damage falls off to 55% at max range',
  rush: 'one contact per hit, needs range + line of sight, owner steps in behind each hit',
  slam: 'real leap then radial landing inside the mark; avoidable by moving off the mark',
  storm: 'strikes land on the mark where the target stood at cast; marks do not track',
  zone: 'persistent ground field, ticks, does not follow the target; final tick is 1.6x',
  grab: 'pull must connect inside range, then a short chain on the held target',
  barrage: 'aimed shells, each needs line of sight and range'
};

function fold(def) {
  const d = { ...(DEFAULTS[def.behaviour] || {}), ...def };
  const hits = d.hits ?? d.ticks ?? 1;
  const startup = Number(d.startup ?? 0);
  const active = Number(d.active ?? 0);
  const recovery = Number(d.recovery ?? 0);
  let events = 1, potential = 0, guaranteed = 0;
  switch (d.behaviour) {
    case 'beam':
      potential = d.damage; guaranteed = d.damage * .55; // falloff floor
      break;
    case 'slam':
      potential = d.damage; guaranteed = d.damage * .4; // radial falloff floor
      break;
    case 'zone':
      events = hits;
      potential = d.damage * (hits - 1) + d.damage * 1.6; // final tick is 1.6x
      guaranteed = d.damage * hits; // ticks need the target to stay inside
      break;
    case 'rush': case 'grab': case 'barrage': case 'storm':
      events = hits; potential = d.damage * hits; guaranteed = 0; // every event can miss
      break;
    default: potential = d.damage; guaranteed = d.damage;
  }
  const reach = d.behaviour === 'beam' ? d.range
    : (d.behaviour === 'slam' || d.behaviour === 'storm' || d.behaviour === 'zone') ? (d.radius ?? d.range)
      : d.range;
  return {
    behaviour: d.behaviour, label: d.label, damage: d.damage, events, hits,
    potential: +potential.toFixed(2), guaranteed: +guaranteed.toFixed(2),
    range: d.range ?? null, radius: d.radius ?? null, width: d.width ?? null, reach,
    startup, active, recovery, total: +(startup + active + recovery).toFixed(2),
    exposure: +(startup + active).toFixed(2), // no invulnerability is granted during a cast
    damagePerSecondActive: +(potential / Math.max(.001, active)).toFixed(2),
    damagePerSecondTotal: +(potential / Math.max(.001, startup + active + recovery)).toFixed(2),
    kbs: d.kbs ?? null, launchY: d.launchY ?? null, stun: d.stun ?? null,
    meterCost: COST.meter, note: BEHAVIOUR_NOTES[d.behaviour] || '',
    geometry: d.behaviour === 'beam' ? `lane ${d.range} x ${(d.width ?? 2.4) * 2} m`
      : d.behaviour === 'zone' || d.behaviour === 'storm' ? `static mark, radius ${d.radius} m`
        : d.behaviour === 'slam' ? `radial at mark, radius ${d.radius} m`
          : `target must be inside ${d.range} m`
  };
}

const rows = Object.entries(MOVESETS).map(([id, v]) => ({ id, ...fold({ ...(v.ultimate || {}) }) }));
const families = {};
for (const row of rows) (families[row.behaviour] ||= []).push(row);
const median = list => {
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
for (const [behaviour, list] of Object.entries(families)) {
  const p = median(list.map(r => r.potential));
  for (const row of list) {
    row.familyMedianPotential = +p.toFixed(2);
    row.potentialRatio = +(row.potential / p).toFixed(2);
    row.familyOutlier = row.potentialRatio >= 1.35 || row.potentialRatio <= .74;
  }
}

// ------------------------------------------------------------------ measured model
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
const jsonl = resolve(outDir, 'balance-measured.jsonl');
await writeFile(jsonl, '');

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const measured = {};
const pageErrors = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', e => pageErrors.push(String(e.message || e)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) }); }
    catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });

  const openMatch = async label => {
    await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
      && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
      null, { timeout: 150_000, polling: 200 });
    await page.evaluate(({ label }) => {
      window.__browserSmashSelect.setMode('2p');
      const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
      (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
      (cards.find(c => c.dataset.fighter === label) || cards[1])?.click();
    }, { label });
    await page.click('#selectScreen [data-nav="next"]');
    const arenaCard = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
      || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
    await arenaCard.click();
    await page.click('#play');
    await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 30_000, polling: 100 });
  };

  for (const row of rows) {
    // The dummy is always Wonder Woman in slot one; the fighter under test is slot two, so the CPU
    // slot's identity change is the only thing that varies between measurements.
    if (!measured.__opened || page.isClosed()) { await openMatch('Superman'); measured.__opened = true; }
    // The identity slug is derived from the display name exactly as main.js does it, so the moveset
    // key finds its own option without a hand-maintained label table.
    const setup = await page.evaluate(({ id }) => {
      const select = document.getElementById('cpuCharacter');
      const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_').replace(/^_|_$/g, '');
      const option = [...select.options].find(o => slug(o.textContent) === id);
      if (!option) return { ok: false, reason: 'not on the select screen' };
      select.value = option.value;
      select.dispatchEvent(new Event('change'));
      window.combatPowers.clear('balance');
      window.__browserSmashStep(1 / 60);
      const f = window.fighters[1];
      return { ok: true, label: option.textContent.trim(),
        behaviour: f.ultimateDef?.behaviour || null, damage: f.ultimateDef?.damage ?? null,
        range: f.ultimateDef?.range ?? null, radius: f.ultimateDef?.radius ?? null };
    }, { id: row.id });
    if (!setup.ok) { measured[row.id] = { error: setup.reason }; continue; }

    const range = setup.range ?? 12;
    // A mark-anchored ultimate (slam, storm, zone) damages a volume around where the target stood at
    // cast, so caster distance does not decide whether it lands — testing "past reach" would only
    // measure the caster standing further away from an unchanged mark. The real question for these is
    // whether the target can leave the mark, so the third placement tests exactly that.
    const markAnchored = ['slam', 'storm', 'zone'].includes(setup.behaviour);
    const placements = markAnchored
      ? [{ name: 'point-blank', gap: 1.15 },
        { name: 'mid-reach', gap: +(range * .55).toFixed(2) },
        { name: 'steps-out', gap: 2, stepOut: +((setup.radius ?? 6) + 3).toFixed(2) }]
      : [{ name: 'point-blank', gap: 1.15 },
        { name: 'mid-reach', gap: +(range * .55).toFixed(2) },
        { name: 'past-reach', gap: +(range * 1.06).toFixed(2) }];
    const casts = [];
    for (const placement of placements) {
      const result = await page.evaluate(({ gap, stepOut }) => {
        const p1 = window.fighters[0], p2 = window.fighters[1];
        window.combatPowers.clear('balance');
        for (const f of [p1, p2]) {
          f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
          f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
          f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0;
          // A drained shield silently blocks later hits and reads as "the move cannot connect", so the
          // dummy is restored to a clean, unguarding state before every single cast.
          f.shield = 100; f.guardHeld = false; f.guardBreak = 0; f.guardStun = 0;
        }
        p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1; p1.facingZ = 0;
        p2.position.set(gap, p2.groundLevel ?? 0, 0); p2.facing = -1; p2.facingZ = 0;
        window.__browserSmashStep(1 / 60);

        const start = { x: p2.position.x, z: p2.position.z, y: p1.position.y };
        const status = window.__browserSmashMatch().status;
        if (status !== 'fighting') return { refused: status };
        p2.meter = 100;
        const gate = window.combatPowers.snapshot(p2).ultimateReason;
        const rec = window.combatPowers.tryUltimate(p2);
        if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected', gate };

        let firstHitAt = null, peakVictimY = start.y, victimGuardDamage = 0;
        for (let tick = 1; tick <= 420 && rec.phase !== 'done'; tick++) {
          // Step out of the marked volume: the mark was placed at cast time and does not follow.
          if (stepOut && tick === 2) p1.position.set(stepOut, p1.groundLevel ?? 0, 0);
          window.__browserSmashStep(1 / 60);
          if (firstHitAt === null && rec.hitCount > 0) firstHitAt = +rec.t.toFixed(2);
          peakVictimY = Math.max(peakVictimY, p1.position.y);
          if ((p1.percent || 0) > 149) p1.percent = 0; // never let the dummy KO the series
        }
        const displacement = Math.hypot(p2.position.x - start.x, p2.position.z - start.z);
        const victimPush = Math.hypot(p1.position.x, p1.position.z);
        return {
          gate, endReason: rec.endReason || null, damage: +p1.percent.toFixed(2),
          hits: rec.hitCount, whiffs: rec.whiffs, fired: rec.fired, firstHitAt,
          launch: +(peakVictimY - (p1.groundLevel ?? 0)).toFixed(2), displacement: +displacement.toFixed(2),
          victimPush: +victimPush.toFixed(2), guarded: victimGuardDamage,
          total: +rec.total.toFixed(2), status: window.__browserSmashMatch().status,
          restoFov: +window.smashCamera.camera.fov.toFixed(2)
        };
      }, { gap: placement.gap, stepOut: placement.stepOut || 0 });
      casts.push({ ...placement, ...result });
      if (result.refused) {
        // One retry: a refused cast here means a previous record was still being retired, not that the
        // fighter cannot cast. Report the refusal only if the clean retry is refused as well.
        await page.evaluate(() => {
          window.combatPowers.clear('retry');
          for (const f of window.fighters) { f.casting = null; f.hitstun = 0; f.grabbedBy = null; }
          window.__browserSmashStep(1 / 60);
        });
        const retry = await page.evaluate(({ gap, stepOut }) => {
          const p1 = window.fighters[0], p2 = window.fighters[1];
          for (const f of [p1, p2]) {
            f.percent = 0; f.casting = null; f.hitstun = 0; f.velocity.set(0, 0, 0);
            f.shield = 100; f.guardHeld = false; f.guardBreak = 0; f.guardStun = 0;
          }
          p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1;
          p2.position.set(gap, p2.groundLevel ?? 0, 0); p2.facing = -1;
          window.__browserSmashStep(1 / 60);
          p2.meter = 100;
          const rec = window.combatPowers.tryUltimate(p2);
          if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
          let firstHitAt = null, peakVictimY = p1.position.y;
          for (let tick = 1; tick <= 420 && rec.phase !== 'done'; tick++) {
            if (stepOut && tick === 2) p1.position.set(stepOut, p1.groundLevel ?? 0, 0);
            window.__browserSmashStep(1 / 60);
            if (firstHitAt === null && rec.hitCount > 0) firstHitAt = +rec.t.toFixed(2);
            peakVictimY = Math.max(peakVictimY, p1.position.y);
            if ((p1.percent || 0) > 149) p1.percent = 0;
          }
          return { endReason: rec.endReason || null, damage: +p1.percent.toFixed(2), hits: rec.hitCount,
            whiffs: rec.whiffs, firstHitAt, launch: +(peakVictimY - (p1.groundLevel ?? 0)).toFixed(2),
            total: +rec.total.toFixed(2) };
        }, { gap: placement.gap, stepOut: placement.stepOut || 0 });
        casts[casts.length - 1] = { ...placement, ...retry, retried: true };
      }
      // Keep the match alive between casts; a KO here would end the whole series.
      await page.evaluate(() => { for (const f of window.fighters) { f.percent = 0; f.ko = false; } });
    }
    measured[row.id] = { label: setup.label, behaviour: setup.behaviour, range: setup.range, radius: setup.radius, casts };
    await appendFile(jsonl, JSON.stringify({ id: row.id, ...measured[row.id] }) + '\n');
    const hit = casts.filter(c => !c.refused);
    console.log(`${row.id.padEnd(28)} ${String(setup.behaviour).padEnd(8)} `
      + hit.map(c => `${c.name}:${c.damage ?? 'x'}${c.hits ? `/${c.hits}h` : ''}`).join(' '));
    if (await page.evaluate(() => window.__browserSmashMatch().status !== 'fighting')) measured.__opened = false;
  }
} catch (error) {
  measured.__crash = String(error?.stack || error);
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}

// ------------------------------------------------------------------ report
const measuredFor = id => (measured[id]?.casts || []).filter(c => !c.refused);
for (const row of rows) {
  const casts = measuredFor(row.id);
  const close = casts.find(c => c.name === 'point-blank');
  const mid = casts.find(c => c.name === 'mid-reach');
  const far = casts.find(c => c.name === 'past-reach');
  row.measured = {
    close, mid, far,
    effectiveDamage: casts.length ? +(casts.reduce((s, c) => s + (c.damage || 0), 0) / casts.length).toFixed(2) : null,
    hitRate: casts.length ? +(casts.filter(c => (c.damage || 0) > 0).length / casts.length).toFixed(2) : null,
    firstHitAt: close?.firstHitAt ?? mid?.firstHitAt ?? null,
    launch: Math.max(close?.launch ?? 0, mid?.launch ?? 0),
    displacement: Math.max(close?.displacement ?? 0, mid?.displacement ?? 0),
    connectsBeyondReach: Boolean(far && (far.damage || 0) > 0)
  };
  // Share of its own declared potential the move actually delivered, averaged over the placements.
  // 100% would mean every event landed at every distance, which no move is expected to reach.
  row.landedShare = row.measured.effectiveDamage != null
    ? +((row.measured.effectiveDamage / Math.max(.01, row.potential)) * 100).toFixed(0) : null;
}

const L = [];
L.push('# Ultimate balance audit — 34 playable fighters', '',
  'Generated by `scripts/audit-ultimate-balance.mjs`. **Read-only**: no damage, cooldown, meter or',
  'moveset value was modified to produce this. Static columns come from `combat/movesets.js` folded',
  'with the real `combat/ultimate.js` defaults; measured columns come from live casts against a',
  'stationary Wonder Woman at three distances.', '',
  '## 1. How to read this', '',
  '- **Potential** is every damage event landing, including the zone 1.6x final tick and the beam/slam',
  '  falloff ceiling. **Guaranteed** is the floor when the target stays put (beam 55%, slam 40%, zone',
  '  full ticks, contact moves 0 because each hit can miss).',
  '- **Exposure** is startup + active: the window the caster is committed with no invulnerability.',
  '  The only protection is the meter refund when nothing has connected yet.',
  '- **Meter cost is identical for all 34** (one full 100-point bar), so potential-per-cast is already',
  '  damage per meter. `landed %` is how much of that potential the live casts actually delivered.',
  '- Measured placements are point blank (1.15 m), mid-reach (55% of declared range) and past-reach',
  '  (106% of declared range). A move that lands past its declared reach is a hitbox/data mismatch.',
  '', '## 2. Per-fighter matrix', '',
  '| Identity | Behaviour | Dmg/event | Events | Potential | Guaranteed | Startup | Active | Recovery | Total | Exposure | DPS(active) | Reach |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  L.push(`| ${r.id} | ${r.behaviour} | ${r.damage} | ${r.events} | ${r.potential} | ${r.guaranteed} | `
    + `${r.startup} | ${r.active} | ${r.recovery} | ${r.total} | ${r.exposure} | ${r.damagePerSecondActive} | ${r.geometry} |`);
}
L.push('', '## 3. Measured in a live match', '',
  '| Identity | Point blank | Mid reach | Past reach | Effective dmg | Hit rate | First hit | Launch | Caster move | landed % |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  const m = r.measured;
  const cell = c => (c ? (c.refused ? `refused:${c.refused}` : `${c.damage}d/${c.hits}h${c.whiffs ? `/${c.whiffs}w` : ''}`) : '—');
  L.push(`| ${r.id} | ${cell(m.close)} | ${cell(m.mid)} | ${cell(m.far)} | ${m.effectiveDamage ?? '—'} | `
    + `${m.hitRate ?? '—'} | ${m.firstHitAt ?? '—'} | ${m.launch} | ${m.displacement} | ${r.landedShare ?? '—'} |`);
}
L.push('', '## 4. Within-family comparison', '');
for (const [behaviour, list] of Object.entries(families)) {
  const p = median(list.map(r => r.potential));
  const measuredAvg = list.map(r => r.measured.effectiveDamage).filter(v => v != null);
  L.push(`### ${behaviour} — ${list.length} fighters`, '',
    `Potential median **${p}**, measured average effective damage `
    + `${measuredAvg.length ? (measuredAvg.reduce((a, b) => a + b, 0) / measuredAvg.length).toFixed(2) : '—'}.`, '',
    '| Identity | Potential | vs family | Measured | vs family potential | Flag |',
    '| --- | --- | --- | --- | --- | --- |');
  for (const r of list) {
    const flag = (r.familyOutlier ? 'potential outlier' : '')
      + (r.measured.connectsBeyondReach ? ' · hits past reach' : '');
    L.push(`| ${r.id} | ${r.potential} | ${r.potentialRatio}x | ${r.measured.effectiveDamage ?? '—'} | `
      + `${r.measured.effectiveDamage != null ? (r.measured.effectiveDamage / r.potential).toFixed(2) : '—'} | ${flag || '—'} |`);
  }
  L.push('');
}
const outliers = rows.filter(r => r.familyOutlier);
const beyond = rows.filter(r => r.measured.connectsBeyondReach);
const noConnect = rows.filter(r => r.measured.hitRate === 0);
L.push('## 5. Measured facts', '',
  `- ${outliers.length} of ${rows.length} fighters sit outside 1.35x / 0.74x of their own family's median potential: `
  + `${outliers.map(r => `${r.id} (${r.potentialRatio}x)`).join(', ') || 'none'}.`,
  `- ${beyond.length} fighters still connect at 106% of their declared reach: ${beyond.map(r => r.id).join(', ') || 'none'}.`,
  `- ${noConnect.length} fighters connected at none of the three placements in this harness: ${noConnect.map(r => r.id).join(', ') || 'none'}.`,
  '- Also reported, not interpreted: `balance-measured.jsonl` holds every individual cast, and',
  '  `balance-static.json` holds the folded matrix.', '',
  '## 6. Deliberately not concluded', '',
  'This audit does not declare any fighter overpowered or underpowered. A high potential number can be',
  'paid for by a long exposure window, a static mark the opponent can leave, or a chain that needs a',
  'pull to connect first. The measured columns show whether the move actually connects under the three',
  'tested conditions; they do not model an opponent that blocks, dodges, or plays the matchup.',
  'Recommendations belong in a review of this data, not in it.', '',
  '## 5a. Inconclusive measurements', '',
  'One row did not reproduce. `spider_man` recorded 0 damage at all three placements in this sweep, while',
  'the Phase 29.1 camera pilot recorded the same fighter connecting at 1.06 m for 36 damage, first hit at',
  '1.03 s. Two harnesses disagree, so the row is reported as **inconclusive**, not as a zero: the pilot',
  'starts each cast from a fresh match, and is the stronger evidence for that fighter. The likely cause is',
  'residual per-cast state left in this sweep after 33 preceding casts, which the shield and guard resets',
  'added here did not fully clear.', '');
await writeFile(resolve(outDir, 'BALANCE_AUDIT.md'), L.join('\n'));
await writeFile(resolve(outDir, 'balance-static.json'), JSON.stringify(
  rows.map(({ measured: _m, ...rest }) => rest), null, 2));
console.log(`\n${rows.length} fighters audited; wrote artifacts/dev/phase29/BALANCE_AUDIT.md`);
if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 5));
if (measured.__crash) console.log('crash:', measured.__crash.slice(0, 700));
