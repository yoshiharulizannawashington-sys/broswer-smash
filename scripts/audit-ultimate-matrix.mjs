// Phase 22.8: individual verification of every ultimate, one row per move.
//
//   mkdir -p artifacts/phase22-8
//   PROBE_PHASE=matrix PROBE_BATCH=a PROBE_CASE=superman,iron_man_tony_stark \
//     bash scripts/run-browser-test.sh scripts/audit-ultimate-matrix.mjs
//   PROBE_PHASE=reconcile bash scripts/run-browser-test.sh scripts/audit-ultimate-matrix.mjs
//
// Phase 22.7 proved one representative per behaviour. This probe assumes nothing from that: a move
// that shares a resolver with another ultimate can still have its own damage, timing, range,
// targeting or cleanup, so every one of the 34 authored ultimates gets its own measured row.
//
// Verification only. It changes no rule, balance value or manifest. Failures are recorded with the
// evidence needed to tell a game defect from an intended mechanic from a harness limitation; no
// failure is repaired here.
//
// Every cast goes through the game's own module instance (`window.combatPowers.tryUltimate`) and
// the real fixed 1/60 s step. A bare `import()` would be a second module instance with its own
// ACTIVE list, which is what made a phantom ultimate read as a real one in 22.6.
//
// Per move, five casts:
//   open + guarded against a shield defender   -> guard scale 0.18
//   open + guarded against a bare defender     -> guard scale 0.28
//   one cast into 6 s of invulnerability       -> must land nothing
// and every damage tick is traced individually, so a multi-hit move is measured hit by hit.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase22-8');
await mkdir(outDir, { recursive: true });
const PHASE = process.env.PROBE_PHASE || 'matrix';
const BATCH = process.env.PROBE_BATCH || 'all';
const TAG = process.env.PROBE_TAG ? '-' + process.env.PROBE_TAG : '';
const outFile = resolve(outDir, 'matrix-' + BATCH + TAG + '.json');
const CASE_FILTER = (process.env.PROBE_CASE || '').split(',').map(s => s.trim()).filter(Boolean);
const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// ---------------------------------------------------------------- authored data (source of truth)
const movesetSrc = await readFile(resolve(root, 'public/js/combat/movesets.js'), 'utf8');
const parseUlt = body => {
  const block = body.match(/ultimate: ult\(\{([\s\S]*?)\n    \}\)/);
  if (!block) return null;
  const text = block[1];
  const label = text.match(/label:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/);
  const num = key => {
    const m = text.match(new RegExp(key + ':\\s*(-?[\\d.]+)'));
    return m ? Number(m[1]) : null;
  };
  return {
    label: label ? (label[1] ?? label[2]) : null,
    behaviour: (text.match(/behaviour:\s*'([a-z]+)'/) || [])[1] || null,
    damage: num('damage'), hits: num('hits'), ticks: num('ticks'),
    startup: num('startup'), active: num('active'), recovery: num('recovery'),
    range: num('range'), radius: num('radius'), width: num('width'), gap: num('gap'),
    kbs: num('kbs'), launchY: num('launchY'), stun: num('stun')
  };
};
const MOVESETS = [];
for (const match of movesetSrc.matchAll(/\n  ([a-z0-9_]+): Object\.freeze\(\{([\s\S]*?)\n  \}\)/g)) {
  MOVESETS.push({ key: match[1], ultimate: parseUlt(match[2]) });
}
// Display-name lookup, exactly as the module builds it: underscore keys first, then its alias table.
const BY_NAME = {};
for (const entry of MOVESETS) BY_NAME[entry.key.replace(/_/g, ' ')] = entry.key;
const ALIAS = {};
const aliasBlock = movesetSrc.match(/Object\.entries\(\{([\s\S]*?)\n\}\)\)/);
if (aliasBlock) {
  for (const m of aliasBlock[1].matchAll(/'([^']+)':\s*'([a-z0-9_]+)'/g)) {
    BY_NAME[m[1]] = m[2];
    ALIAS[m[2]] = m[1];
  }
}

/** Damage events a behaviour plans. Grab's first contact is the pull, which deals no damage. */
const planHits = def => {
  if (!def) return null;
  if (def.behaviour === 'grab') return Math.max(0, (def.hits || 1) - 1);
  if (def.behaviour === 'zone') return def.ticks || 4;
  if (def.behaviour === 'storm' || def.behaviour === 'rush' || def.behaviour === 'barrage') return def.hits || 1;
  return 1;
};
const RESOLVER = behaviour => 'BEHAVIOURS.' + behaviour + ' -> hitTargets -> ctx.hit -> combatPowers.hit';
const GUIDE_DEFENDERS = key => (key === 'wonder_woman' || key === 'thor')
  ? { shield: 'Link', bare: 'Aquaman' }   // the caster cannot also be the defender
  : { shield: 'Wonder Woman', bare: 'Thor' };

// ---------------------------------------------------------------- reconcile (no browser)
if (PHASE === 'reconcile') {
  const files = (await readdir(outDir)).filter(name => /^matrix-.*\.json$/.test(name));
  const ranked = [];
  for (const name of files) {
    const path = resolve(outDir, name);
    ranked.push({ name, mtime: (await stat(path)).mtimeMs, body: JSON.parse(await readFile(path, 'utf8')) });
  }
  ranked.sort((a, b) => a.mtime - b.mtime);
  const byKey = new Map();
  const duplicates = [];
  for (const file of ranked) {
    for (const row of file.body.rows || []) {
      if (byKey.has(row.key)) duplicates.push({ key: row.key, keptFrom: file.name, replacedFrom: byKey.get(row.key).__file });
      byKey.set(row.key, { ...row, __file: file.name });
    }
  }
  const rows = [];
  const missing = [];
  for (const entry of MOVESETS) {
    const row = byKey.get(entry.key);
    if (row) { const { __file, ...clean } = row; rows.push({ ...clean, source: __file }); continue; }
    missing.push(entry.key);
    rows.push({
      key: entry.key, character: ALIAS[entry.key] || entry.key, label: entry.ultimate?.label ?? null,
      behaviour: entry.ultimate?.behaviour ?? null,
      resolver: entry.ultimate ? RESOLVER(entry.ultimate.behaviour) : null,
      plannedHits: planHits(entry.ultimate), classification: entry.ultimate?.behaviour === 'grab' ? 'unblockable' : 'blockable',
      status: 'NOT_MEASURED', failureReasons: ['no batch produced a row for this move'],
      checks: [], cases: null, source: null
    });
  }
  const rosterKeys = MOVESETS.map(m => m.key);
  const extra = rows.filter(row => !rosterKeys.includes(row.key));
  const counts = rows.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
  const report = {
    phase: '22.8', kind: 'ultimate-per-move-matrix', status: 'reconciled',
    roster: {
      source: 'public/js/combat/movesets.js', movesetCount: MOVESETS.length,
      behaviours: MOVESETS.reduce((acc, m) => { const b = m.ultimate?.behaviour; if (b) acc[b] = (acc[b] || 0) + 1; return acc; }, {})
    },
    reconciliation: {
      movesetCount: MOVESETS.length, resultCount: rows.length,
      keysMissing: missing.length, missingKeys: missing,
      extraRows: extra.map(row => row.key), duplicateRows: duplicates,
      allRosterMovesHaveResult: missing.length === 0,
      statusCounts: counts
    },
    rows,
    measured: rows.filter(row => row.status !== 'NOT_MEASURED').length,
    failures: rows.flatMap(row => (row.checks || []).filter(c => !c.ok).map(c => ({ key: row.key, check: c.name, detail: c.detail }))),
    findings: rows.flatMap(row => (row.findings || []).map(detail => ({ key: row.key, detail }))),
    blocked: rows.filter(row => row.status === 'BLOCKED_BY_TEST_SETUP').map(row => row.key),
    notMeasured: rows.filter(row => row.status === 'NOT_MEASURED').map(row => row.key)
  };
  // A duplicate row means the same move was re-run later (before/after batches); the newest row
  // wins and every duplicate is recorded, so duplicates do not make the matrix incomplete.
  report.status = report.reconciliation.allRosterMovesHaveResult
    && report.reconciliation.extraRows.length === 0
    ? 'complete' : 'incomplete';
  const mergedPath = resolve(outDir, 'ultimate-matrix' + TAG + '.json');
  await writeFile(mergedPath, JSON.stringify(report, null, 1));
  console.log(`reconciled ${rows.length}/${MOVESETS.length} moves · ${JSON.stringify(counts)}`);
  if (missing.length) console.log('  NOT_MEASURED ' + missing.join(', '));
  for (const failure of report.failures) console.log('  FAIL ' + failure.key + ' ' + failure.check + ' — ' + failure.detail);
  console.log(`status ${report.status} · wrote ${mergedPath}`);
  process.exit(0);
}

// ---------------------------------------------------------------- static file server
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const requested = CASE_FILTER.length ? MOVESETS.filter(m => CASE_FILTER.includes(m.key)) : MOVESETS;
const report = {
  phase: '22.8', kind: 'ultimate-per-move-matrix', batch: BATCH, status: 'running',
  roster: {
    source: 'public/js/combat/movesets.js',
    moves: MOVESETS.map(({ key, ultimate }) => ({ key, name: ALIAS[key] || key, ...ultimate, plannedHits: planHits(ultimate) })),
    selectable: [], missingSelectEntries: []
  },
  rows: [], failures: [], pageErrors: []
};
const note = (row, name, ok, detail, { blocked = false } = {}) => {
  row.checks.push({ name, ok: !!ok, detail: detail ?? null, ...(blocked ? { blocked: true } : {}) });
};

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => report.pageErrors.push(String(error.message || error)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
    } catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });

  const boot = async () => {
    await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
      && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
      null, { timeout: 150_000, polling: 200 });
    // The game's own callouts explain any miss (invulnerable, cover, meter) without guessing.
    await page.evaluate(() => {
      window.__auditCallouts = [];
      if (window.__auditCalloutHooked) return;
      const original = window.showCombatCallout;
      window.showCombatCallout = (text, color) => {
        window.__auditCallouts.push(String(text));
        if (window.__auditCallouts.length > 80) window.__auditCallouts.shift();
        return original?.(text, color);
      };
      window.__auditCalloutHooked = true;
    });
  };
  const liveFrames = async (count = 3) => page.evaluate(async count => {
    const start = window.__browserSmashAssets?.app?.frames || 0;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && (window.__browserSmashAssets?.app?.frames || 0) - start < count) {
      await new Promise(done => setTimeout(done, 40));
    }
    return (window.__browserSmashAssets?.app?.frames || 0) - start;
  }, count);
  const read = () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const snap = f => ({
      identity: f.identity, offhand: f.model?.userData?.offhandKind ?? null,
      percent: +f.percent.toFixed(3), shield: +(f.shield ?? 100).toFixed(2),
      hitstun: +(f.hitstun || 0).toFixed(3), guardStun: +(f.guardStun || 0).toFixed(3),
      guardBreak: +(f.guardBreak || 0).toFixed(3), guardHeld: !!f.guardHeld,
      invulnerable: +(f.invulnerable || 0).toFixed(3), casting: f.casting,
      ultimate: f.ultimateDef ? { label: f.ultimateDef.label, behaviour: f.ultimateDef.behaviour,
        damage: f.ultimateDef.damage, hits: f.ultimateDef.hits || 1, ticks: f.ultimateDef.ticks || null,
        startup: f.ultimateDef.startup, active: f.ultimateDef.active, recovery: f.ultimateDef.recovery } : null
    });
    return { p1: snap(p1), p2: snap(p2), status: window.__browserSmashMatch().status,
      inMenu: document.body.classList.contains('in-menu') };
  });
  const selectSlot = (selector, label) => page.evaluate(async ({ selector, label, slug }) => {
    const select = document.querySelector(selector);
    if (!select) return { ok: false, reason: 'missing ' + selector };
    select.value = label;
    select.dispatchEvent(new Event('change'));
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const fighter = window.fighters[selector === '#p1Character' ? 0 : 1];
      const asset = String(fighter.model?.userData?.characterAssetUrl || '');
      const landed = asset.includes('/roster/' + slug + '.glb') || asset.endsWith('/' + slug + '/' + slug + '.glb');
      if (fighter.identity === label && landed) return { ok: true, identity: fighter.identity };
      await new Promise(done => setTimeout(done, 40));
    }
    const fighter = window.fighters[selector === '#p1Character' ? 0 : 1];
    return { ok: false, reason: `stayed ${fighter.identity}`, identity: fighter.identity };
  }, { selector, label, slug: slugOf(label) });
  const selectP1 = label => selectSlot('#p1Character', label);
  const selectP2 = label => selectSlot('#cpuCharacter', label);
  const startMatch = async (defender, attacker) => {
    await page.evaluate(({ defender, attacker }) => {
      window.__browserSmashSelect.setMode('2p');
      const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
      const pick = (name, fallback) => (cards.find(card => card.dataset.fighter === name)
        || cards[fallback])?.click();
      pick(defender, 0);
      pick(attacker, 1);
    }, { defender, attacker });
    await page.click('#selectScreen [data-nav="next"]');
    await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
    await page.click('#play');
    await page.evaluate(() => window.__browserSmashStep(0.1));
  };
  const stepUntil = (expression, maxSeconds = 3) => page.evaluate(({ expression, maxSeconds }) => {
    const test = new Function('p1', 'p2', 'return ' + expression);
    const ticks = Math.ceil(maxSeconds * 60);
    for (let tick = 0; tick < ticks; tick++) {
      if (test(window.fighters[0], window.fighters[1])) return { ok: true, simulated: +(tick / 60).toFixed(2) };
      window.__browserSmashStep(1 / 60);
    }
    return { ok: false, simulated: +(ticks / 60).toFixed(2) };
  }, { expression, maxSeconds });
  /** Neutral state: both fighters reset, positions known, nothing mid-move, no stale ultimate. */
  const reset = (gap = 1.02) => page.evaluate(({ gap }) => {
    window.combatPowers.clear('audit');
    window.__auditCallouts = [];
    const [p1, p2] = window.fighters;
    for (const fighter of [p1, p2]) {
      fighter.percent = 0; fighter.velocity.set(0, 0, 0);
      fighter.hitstun = 0; fighter.invulnerable = 0; fighter.guardBreak = 0; fighter.guardStun = 0;
      fighter.guardRegenDelay = 0; fighter.dodgeTimer = 0; fighter.attackQueue.length = 0;
      fighter.comboWindow = 0; fighter.specialCooldown = 0; fighter.grabCooldown = 0;
      fighter.attackBuffer = 0; fighter.parryTimer = 0; fighter.parryCooldown = 0;
      fighter.counterWindow = 0; fighter.meter = 0; fighter.guardHeld = false;
      fighter.shield = 100;
    }
    p1.position.set(0, p1.groundLevel, 0); p1.facing = 1; p1.facingZ = 0;
    p2.position.set(gap, p2.groundLevel, 0); p2.facing = -1; p2.facingZ = 0;
    // Keep the CPU out of the measurement: P2 is driven only by the probe's own cast.
    p2.aiLevel = 0; p2.cpuControlled = false;
    return { inMenu: document.body.classList.contains('in-menu') };
  }, { gap });
  const ensureLive = async (defender, attacker) => {
    const state = await read();
    if (state.inMenu || state.status === 'match-over' || state.status === 'round-over') {
      await startMatch(defender, attacker);
      await liveFrames(3);
    }
    if ((await read()).p2.identity !== attacker) {
      await selectP2(attacker);
      await liveFrames(2);
    }
    await reset();
    return (await read()).p2.identity;
  };

  await boot();
  // A batch runs many casts back to back; the stock 80 s round would expire in the middle of a
  // later cast and clear the move. The engine caps a round at 300 s, which covers a batch.
  await page.evaluate(() => window.__browserSmashSetRules?.({ roundsToWin: 5, roundSeconds: 300 }));
  const lists = await page.evaluate(() => {
    const options = slot => [...document.querySelectorAll(slot + ' option')].map(o => o.value);
    const cards = [...document.querySelectorAll('#selectScreen .bs-card')].map(c => c.dataset.fighter);
    return { p1: options('#p1Character'), cpu: options('#cpuCharacter'), cards };
  });
  const offered = [...new Set([...lists.p1, ...lists.cpu, ...lists.cards])].filter(Boolean);
  report.roster.selectable = offered;
  const optionByKey = {};
  for (const name of offered) {
    const key = BY_NAME[String(name).toLowerCase()];
    if (key && !optionByKey[key]) optionByKey[key] = name;
  }
  for (const move of report.roster.moves) {
    if (optionByKey[move.key]) move.character = optionByKey[move.key];
    else report.roster.missingSelectEntries.push(move.key);
  }

  /** One cast, traced tick by tick. Every damage event is kept with its own before/after values. */
  const measureCase = async ({ key, character, defender, guarded, invulnerable = false }) => {
    // The defender is P1: swap its model before the neutral reset, or a "bare" case would still be
    // measuring the previous defender's offhand.
    if ((await read()).p1.identity !== defender) {
      await selectP1(defender);
      await liveFrames(2);
    }
    const setup = await ensureLive(defender, character);
    if (setup !== character) {
      return { defender, guarded, invulnerable, blocked: 'caster stayed ' + setup, hits: [], damage: 0, cast: false };
    }
    await stepUntil('!(p1.attackPose > 0) && !(p1.attackQueue||[]).length && !(p1.hitstun > 0)', 1);
    const armed = await page.evaluate(({ invulnerable }) => {
      const p1 = window.fighters[0];
      // Ultimates do not consult the parry window; keeping it shut isolates the guard branch.
      p1.parryTimer = 0; p1.parryCooldown = 9;
      if (invulnerable) p1.invulnerable = 6;
      return { offhand: p1.model?.userData?.offhandKind ?? null, invulnerable: p1.invulnerable };
    }, { invulnerable });
    if (guarded) {
      await page.keyboard.down('e');
      const engaged = await stepUntil('p1.guardHeld === true', 0.5);
      if (!engaged.ok) {
        await page.keyboard.up('e');
        return { defender, guarded, invulnerable, offhand: armed.offhand, blocked: 'guard never engaged',
          hits: [], damage: 0, cast: false, castingPlayer: null };
      }
    }
    const before = await read();
    await page.evaluate(() => { window.fighters[1].meter = 100; });
    const started = await page.evaluate(() => {
      const p2 = window.fighters[1];
      const record = window.combatPowers.tryUltimate(p2);
      window.__auditRecord = record && record.ok !== false ? record : null;
      return {
        ok: Boolean(record && record.ok !== false),
        reason: record?.reason || null,
        total: record?.total != null ? +record.total.toFixed(3) : null,
        // Which slot actually owns the running record, read from the record instead of assumed.
        ownerIsP2: record ? record.owner === window.fighters[1] : null
      };
    });
    const plan = await page.evaluate(() => {
      const record = window.__auditRecord;
      if (!record) return null;
      return {
        label: record.label, id: record.id, total: +record.total.toFixed(3),
        events: record.events.map((event, index) => ({ index, at: +event.at.toFixed(3), kind: event.kind })),
        def: { behaviour: record.def.behaviour, damage: record.def.damage,
          hits: record.def.hits ?? null, ticks: record.def.ticks ?? null,
          startup: record.def.startup, active: record.def.active, recovery: record.def.recovery,
          range: record.def.range ?? null, radius: record.def.radius ?? null, width: record.def.width ?? null }
      };
    });
    // The runner's own event times, so each scheduled event can be checked against where the
    // defender actually was when it fired (a marked strike can fire into empty space).
    await page.evaluate(plan => { window.__auditPlanEvents = plan?.events ?? []; }, plan);
    const trace = await page.evaluate(({ maxSeconds, guarded }) => {
      const [p1, p2] = window.fighters;
      const record = window.__auditRecord;
      const hits = [];
      let last = p1.percent;
      let lastShield = p1.shield;
      const startX = p1.position.x;
      const startZ = p1.position.z;
      let moved = 0;
      let guardLostAt = null;
      // Hit-stop freezes the simulation for a few frames per confirmed hit. It is real time but
      // not move time, so it is counted here and the event clock is read from the runner's own
      // record (`ultT`) instead of from this loop's tick count.
      let hitStopTicks = 0;
      const eventTimes = (window.__auditPlanEvents || []).map(event => event.at);
      const eventProbes = [];
      let nextEvent = 0;
      const ticks = Math.ceil(maxSeconds * 60);
      let tick = 0;
      for (; tick < ticks; tick++) {
        window.__browserSmashStep(1 / 60);
        if ((window.__browserSmashMatch?.()?.hitStop || 0) > 0) hitStopTicks++;
        moved = Math.max(moved, Math.hypot(p1.position.x - startX, p1.position.z - startZ));
        if (guarded && guardLostAt === null && !p1.guardHeld) guardLostAt = +((tick + 1) / 60).toFixed(3);
        if (p1.percent > last + 1e-6) {
          hits.push({
            index: hits.length, tick: tick + 1, at: +((tick + 1) / 60).toFixed(3),
            ultT: record ? +record.t.toFixed(3) : null, hitStopTicks,
            damage: +(p1.percent - last).toFixed(3),
            percentBefore: +last.toFixed(3), percentAfter: +p1.percent.toFixed(3),
            shieldBefore: +lastShield.toFixed(2), shieldAfter: +p1.shield.toFixed(2),
            guard: !!p1.guardHeld, hitstun: +p1.hitstun.toFixed(3),
            guardStun: +p1.guardStun.toFixed(3), guardBreak: +p1.guardBreak.toFixed(3)
          });
          last = p1.percent;
          lastShield = p1.shield;
        }
        // Where the defender stood at each scheduled event, measured against the same volume the
        // behaviour tests (`radius + hurtboxRadius`) so a whiff can be explained with numbers.
        while (nextEvent < eventTimes.length && record && record.t >= eventTimes[nextEvent] - 1e-6) {
          const point = p1.position.clone();
          point.y += .9;
          const centre = record.anchor.clone();
          centre.y += .3;
          eventProbes.push({
            at: eventTimes[nextEvent], ultT: +record.t.toFixed(3),
            target: { x: +p1.position.x.toFixed(2), y: +p1.position.y.toFixed(2), z: +p1.position.z.toFixed(2) },
            anchor: { x: +record.anchor.x.toFixed(2), y: +record.anchor.y.toFixed(2), z: +record.anchor.z.toFixed(2) },
            radius: record.def.radius ?? null,
            distance: +point.distanceTo(centre).toFixed(2),
            limit: record.def.radius != null ? +(record.def.radius + (p1.hurtboxRadius || .7)).toFixed(2) : null
          });
          nextEvent++;
        }
        if (tick > 1 && !p2.casting && (!record || record.phase === 'done')) break;
      }
      return {
        hits, eventProbes, simulated: +((tick + 1) / 60).toFixed(3),
        percent: +p1.percent.toFixed(3), shield: +p1.shield.toFixed(2),
        guardBreak: +p1.guardBreak.toFixed(3), hitstun: +p1.hitstun.toFixed(3),
        guardStun: +p1.guardStun.toFixed(3), travelled: +moved.toFixed(2),
        invulnerable: +p1.invulnerable.toFixed(3), guardHeld: !!p1.guardHeld, guardLostAt
      };
    }, { maxSeconds: 6, guarded });
    const meta = await page.evaluate(() => {
      const record = window.__auditRecord;
      const scene = window.__browserSmashScene;
      const leftovers = scene
        ? scene.children.filter(o => String(o.name || '').startsWith('ultimate:')).map(o => o.name)
        : null;
      return {
        endReason: record?.endReason ?? null, phase: record?.phase ?? null,
        fired: record?.fired ?? null, hitCount: record?.hitCount ?? null, whiffs: record?.whiffs ?? null,
        interrupted: !!record?.interrupted, t: record ? +record.t.toFixed(3) : null,
        eventCount: record?.events?.length ?? null,
        castingAfter: !!window.fighters[1].casting, leftovers
      };
    });
    if (meta.endReason && meta.endReason !== 'finished') {
      // The runner cleared the move for a match-state reason rather than finishing it, so this
      // cast is not a measurement of the move. Round end and KO are harness conditions here: the
      // probe disables the CPU, so nothing else in the match can end the round.
      if (guarded) await page.keyboard.up('e');
      await page.evaluate(() => window.combatPowers.clear('audit'));
      return { defender, guarded, invulnerable: !!invulnerable, offhand: armed.offhand,
        blocked: `runner ended ${meta.endReason} before the move completed`,
        hits: trace.hits, damage: 0, cast: started.ok, record: meta,
        castingPlayer: started.ownerIsP2 === true ? 'p2' : started.ownerIsP2 === false ? 'p1' : null };
    }
    const callouts = await page.evaluate(() => (window.__auditCallouts || []).slice(-8));
    if (guarded) await page.keyboard.up('e');
    await page.evaluate(() => window.combatPowers.clear('audit'));
    const after = await read();
    const offset = plan?.def.behaviour === 'grab' ? 1 : 0;
    return {
      defender, guarded, invulnerable: !!invulnerable, offhand: armed.offhand,
      castingPlayer: started.ownerIsP2 === true ? 'p2' : started.ownerIsP2 === false ? 'p1' : null,
      cast: started.ok, castReason: started.reason || null,
      plan, expectedHits: planHits(plan?.def ?? null),
      before: { percent: before.p1.percent, shield: before.p1.shield, invulnerable: before.p1.invulnerable },
      after: { percent: after.p1.percent, shield: after.p1.shield, guardBreak: after.p1.guardBreak,
        hitstun: after.p1.hitstun, guardHeld: after.p1.guardHeld, offhand: after.p1.offhand },
      hits: trace.hits,
      eventProbes: trace.eventProbes,
      damage: +(trace.percent - before.p1.percent).toFixed(3),
      firstDamage: trace.hits[0]?.damage ?? 0,
      shieldSpent: +(before.p1.shield - trace.shield).toFixed(2),
      guardBreak: trace.guardBreak, guardStun: trace.guardStun, hitstun: trace.hitstun,
      travelled: trace.travelled, guardLostAt: trace.guardLostAt, simulated: trace.simulated,
      timing: trace.hits.map((hit, index) => {
        const planned = plan?.events[offset + index] ?? null;
        return { hit: hit.at, tick: hit.tick, ult: hit.ultT, hitStopTicks: hit.hitStopTicks,
          planned: planned?.at ?? null,
          ultDelta: planned && hit.ultT !== null ? +(hit.ultT - planned.at).toFixed(3) : null,
          wallDelta: planned ? +(hit.at - planned.at).toFixed(3) : null };
      }),
      record: meta, callouts, blocked: null
    };
  };

  for (const entry of requested) {
    const character = optionByKey[entry.key];
    const row = {
      key: entry.key, character: character ?? null, label: entry.ultimate?.label ?? null,
      behaviour: entry.ultimate?.behaviour ?? null,
      resolver: entry.ultimate ? RESOLVER(entry.ultimate.behaviour) : null,
      plannedHits: planHits(entry.ultimate),
      classification: entry.ultimate?.behaviour === 'grab' ? 'unblockable' : 'blockable',
      authored: entry.ultimate,
      cases: null, checks: [], status: 'NOT_MEASURED', failureReasons: [], findings: []
    };
    report.rows.push(row);
    if (!character) {
      row.status = 'BLOCKED_BY_TEST_SETUP';
      row.failureReasons.push('no character-select entry for this moveset key');
      note(row, 'selectEntry', false, row.failureReasons[0], { blocked: true });
      await writeFile(outFile, JSON.stringify(report, null, 1));
      continue;
    }
    const defenders = GUIDE_DEFENDERS(entry.key);
    try {
      await selectP2(character);
      await liveFrames(2);
      const shieldOpen = await measureCase({ key: entry.key, character, defender: defenders.shield, guarded: false });
      const shieldGuarded = await measureCase({ key: entry.key, character, defender: defenders.shield, guarded: true });
      const bareOpen = await measureCase({ key: entry.key, character, defender: defenders.bare, guarded: false });
      const bareGuarded = await measureCase({ key: entry.key, character, defender: defenders.bare, guarded: true });
      const invulnerable = await measureCase({ key: entry.key, character, defender: defenders.bare,
        guarded: false, invulnerable: true });
      row.cases = {
        shield: { defender: defenders.shield, open: shieldOpen, guarded: shieldGuarded },
        bare: { defender: defenders.bare, open: bareOpen, guarded: bareGuarded },
        invulnerable
      };

      const all = [shieldOpen, shieldGuarded, bareOpen, bareGuarded, invulnerable];
      const guardedCases = [shieldGuarded, bareGuarded];
      const openCases = [shieldOpen, bareOpen];

      // ---- setup: every case must have been arranged as intended, or the row is not measurable.
      for (const item of all) {
        if (item.blocked) note(row, 'caseSetup', false, `${item.defender}${item.guarded ? ' guarded' : ''}: ${item.blocked}`, { blocked: true });
      }
      const offhandOk = shieldGuarded.offhand === 'shield' && shieldOpen.offhand === 'shield'
        && bareGuarded.offhand !== 'shield' && bareOpen.offhand !== 'shield';
      note(row, 'defenderOffhand', offhandOk,
        `shield defender offhand ${shieldOpen.offhand}, bare defender offhand ${bareOpen.offhand}`,
        { blocked: !offhandOk });

      // ---- cast lifecycle and cleanup, from the runner's own record.
      const castOk = all.every(item => item.cast);
      note(row, 'castStarted', castOk, all.filter(item => !item.cast).map(item => `${item.defender}: ${item.castReason}`).join('; ') || null);
      const completed = all.every(item => item.record?.endReason === 'finished'
        && item.record?.fired === item.record?.eventCount);
      note(row, 'castCompleted', completed, all.map(item => `${item.defender}: ${item.record?.endReason}`
        + ` ${item.record?.fired}/${item.record?.eventCount} events`).join(' | '));
      const cleanup = all.every(item => item.record?.castingAfter === false
        && Array.isArray(item.record?.leftovers) && item.record.leftovers.length === 0);
      note(row, 'cleanup', cleanup, all.map(item => `${item.defender}: casting ${item.record?.castingAfter},`
        + ` leftover ${JSON.stringify(item.record?.leftovers)}`).join(' | '));

      // ---- landed hits: planned count, individually observed count, and the runner's own count.
      for (const item of all.filter(entryCase => !entryCase.invulnerable)) {
        const label = `${item.defender}${item.guarded ? ' guarded' : ' open'}`;
        const observed = item.hits.length;
        const planned = item.expectedHits;
        const runnerCount = item.record?.hitCount ?? null;
        note(row, 'hitsLanded', observed === planned && runnerCount === planned,
          `${label}: observed ${observed}/${planned}, runner hitCount ${runnerCount}, whiffs ${item.record?.whiffs},`
          + ` damage ${item.damage}%, callouts ${[...new Set(item.callouts)].join('|') || 'none'}`);
        // Event clock: the runner's own `record.t` at the hit, which is the clock the events are
        // scheduled on. One fixed tick of tolerance. The wall delta and the hit-stop frames are
        // kept beside it, so the gap between the two clocks is visible instead of hidden.
        const timingOk = item.timing.length > 0 && item.timing.every(entryTiming => entryTiming.ultDelta !== null
          && Math.abs(entryTiming.ultDelta) <= 0.05);
        note(row, 'hitTiming', timingOk, `${label}: ` + item.timing.map(t => `tick ${t.tick} ult ${t.ult}s`
          + (t.planned === null ? '' : ` vs ${t.planned}s (${t.ultDelta >= 0 ? '+' : ''}${t.ultDelta})`)
          + ` wall ${t.hit}s (${t.wallDelta >= 0 ? '+' : ''}${t.wallDelta}) hitStop ${t.hitStopTicks}`).join(', '));
      }
      // A planned event that fired but found no target is recorded as a per-move finding as well
      // as a failed check: on a marked-zone move it usually means the previous hit launched the
      // target out of the mark before the next stage landed.
      for (const item of all.filter(entryCase => !entryCase.invulnerable && entryCase.hits.length < (entryCase.expectedHits || 0))) {
        const missed = (item.eventProbes || []).find(probe => probe.limit !== null && probe.distance > probe.limit);
        row.findings.push(`${item.defender}${item.guarded ? ' guarded' : ' open'}: ${item.hits.length}/${item.expectedHits}`
          + ` planned damage events landed; runner fired ${item.record?.fired}/${item.record?.eventCount}`
          + ` with ${item.record?.whiffs} whiffs, so the event fired with no target in its volume`
          + (missed ? `. At ${missed.ultT}s the defender was ${missed.distance} m from the mark`
            + ` (volume limit ${missed.limit} m, height ${missed.target.y} m)` : ''));
      }
      const openFirsts = openCases.map(item => item.firstDamage);
      note(row, 'openDamage', openCases.every(item => item.firstDamage > 0 && item.hits.length === item.expectedHits),
        openCases.map((item, i) => `${item.defender} open ${item.damage}% first ${item.firstDamage}%`).join(' | '));

      // ---- guard behaviour, measured on the first damage hit of each defender.
      if (row.classification === 'blockable') {
        for (const item of guardedCases) {
          const open = item.defender === defenders.shield ? shieldOpen : bareOpen;
          const scale = open.firstDamage > 0 ? +(item.firstDamage / open.firstDamage).toFixed(3) : null;
          const expected = item.offhand === 'shield' ? 0.18 : 0.28;
          const guardAtHits = item.hits.map(hit => hit.guard);
          // The guard scale is measured on the first damage hit. Later hits may land unguarded
          // because the shield emptied and the guard broke mid-chain (fighter3D.js:184 gates the
          // guard on `guardBreak <= 0 && shield > 0`). That is depletion, not a shield leak, so
          // the row requires every unguarded hit to be explained by a break or an empty shield.
          const guardDrops = item.hits.map(hit => ({ tick: hit.tick, guard: hit.guard,
            shieldBefore: hit.shieldBefore, shieldAfter: hit.shieldAfter, guardBreak: hit.guardBreak }));
          const dropsExplained = guardDrops.every(drop => drop.guard
            || drop.guardBreak > 0 || drop.shieldAfter <= 0.01 || drop.shieldBefore <= 0.01);
          note(row, 'guardScale', scale !== null && Math.abs(scale - expected) <= 0.02 && dropsExplained,
            `${item.defender} (${item.offhand}): guarded ${item.firstDamage}% vs open ${open.firstDamage}%`
            + ` scale ${scale} expected ${expected}, guardAtHits ${JSON.stringify(guardAtHits)},`
            + ` shield -${item.shieldSpent}, guardBreak ${item.guardBreak}, drops ${JSON.stringify(guardDrops)},`
            + ` callouts ${[...new Set(item.callouts)].join('|') || 'none'}`);
        }
      } else {
        for (const item of guardedCases) {
          const open = item.defender === defenders.shield ? shieldOpen : bareOpen;
          const guardAtHits = item.hits.map(hit => hit.guard);
          const sameAsOpen = Math.abs(item.damage - open.damage) <= 0.05;
          const drainOnly = item.shieldSpent < 12 && item.guardBreak === 0;
          note(row, 'unblockable', guardAtHits.length > 0 && guardAtHits.every(g => !g) && sameAsOpen && drainOnly,
            `${item.defender}: guardAtHits ${JSON.stringify(guardAtHits)}, guarded ${item.damage}% vs open`
            + ` ${open.damage}%, shield -${item.shieldSpent}, guardBreak ${item.guardBreak}`);
        }
      }

      // ---- invulnerability: a real miss, not a reduced hit.
      const invulnCallouts = [...new Set(invulnerable.callouts)];
      note(row, 'invulnerability', invulnerable.cast && invulnerable.damage === 0
        && invulnerable.hits.length === 0 && invulnCallouts.some(text => /EVADED/.test(text)),
        `damage ${invulnerable.damage}%, hits ${invulnerable.hits.length}, whiffs ${invulnerable.record?.whiffs},`
        + ` callouts ${invulnCallouts.join('|') || 'none'}`);

      row.status = row.checks.some(check => check.blocked) ? 'BLOCKED_BY_TEST_SETUP'
        : row.checks.some(check => !check.ok) ? 'FAIL' : 'PASS';
      row.failureReasons = row.checks.filter(check => !check.ok).map(check => `${check.name}: ${check.detail}`);
      if (row.status !== 'PASS') {
        report.failures.push({ key: row.key, status: row.status, reasons: row.failureReasons });
      }
    } catch (error) {
      row.status = 'BLOCKED_BY_TEST_SETUP';
      row.failureReasons.push('probe error: ' + String(error && error.message || error));
      report.failures.push({ key: row.key, status: row.status, reasons: row.failureReasons });
    }
    const guardedShield = row.cases?.shield?.guarded;
    const openShield = row.cases?.shield?.open;
    const scale = row.cases && openShield?.firstDamage > 0 && guardedShield
      ? +(guardedShield.firstDamage / openShield.firstDamage).toFixed(3) : null;
    console.log(`${row.status.padEnd(22)} ${row.key.padEnd(28)} ${String(row.behaviour).padEnd(8)}`
      + ` hits ${row.cases?.shield?.open?.hits.length ?? 0}/${row.plannedHits} scale ${scale}`
      + `${row.status === 'PASS' ? '' : ' — ' + row.failureReasons.slice(0, 2).join(' | ')}`);
    // Write after every move so a batch that hits the harness time limit keeps the rows it finished.
    await writeFile(outFile, JSON.stringify(report, null, 1));
  }
  report.status = report.failures.length ? 'failed' : 'complete';
} catch (error) {
  report.status = 'error';
  report.error = String(error && error.stack || error);
  report.failures.push({ key: null, status: 'error', reasons: [String(error && error.message || error)] });
} finally {
  await browser.close();
  server.close();
  await writeFile(outFile, JSON.stringify(report, null, 1));
  console.log(`\nstatus ${report.status} · rows ${report.rows.length}/${requested.length}`
    + ` · pageErrors ${report.pageErrors.length} · wrote ${outFile}`);
  for (const failure of report.failures) console.log('  FAIL ' + failure.key + ' — ' + failure.reasons.join(' | '));
}
