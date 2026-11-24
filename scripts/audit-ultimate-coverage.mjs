// Phase 22.7: complete ultimate defensive coverage.
//
//   mkdir -p artifacts/phase22-7
//   PROBE_PHASE=registry bash scripts/run-browser-test.sh scripts/audit-ultimate-coverage.mjs
//   PROBE_PHASE=coverage PROBE_CASE=beam,rush,storm bash scripts/run-browser-test.sh scripts/audit-ultimate-coverage.mjs
//
// Phase 22.6 proved one behaviour (Superman's slam). This probe covers the rest of the behaviours
// that actually exist in the game, driving every cast through `window.combatPowers.tryUltimate`
// (the game's own module instance and context) and, where marked, through the player's real
// ultimate key. It never imports a combat module directly: a bare import is a second module
// instance with its own ACTIVE list, which is what made the 22.6 ultimate read as a phantom.
//
//   registry   every moveset's ultimate, which of them a player can actually select, and whether
//              the runtime definition matches the authored data.
//   coverage   each remaining behaviour against Wonder Woman and Link (shield) and Thor and
//              Aquaman (bare), guarded and unguarded, with every damage tick timed.
//   special    how each behaviour interacts with invulnerability and parry.
//
// Nothing here changes a rule: it measures the shield, guard and cover behaviour the game already
// has and reports what it finds.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase22-7');
await mkdir(outDir, { recursive: true });
const PHASE = process.env.PROBE_PHASE || 'all';
const phaseOn = name => PHASE === 'all' || PHASE === name;
const TAG = process.env.PROBE_TAG ? '-' + process.env.PROBE_TAG : '';
const outFile = resolve(outDir, 'ultimate-coverage-' + PHASE + TAG + '.json');
const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const DEFENDERS = (process.env.PROBE_DEFENDERS || 'Wonder Woman,Link,Thor,Aquaman').split(',');
const CASE_FILTER = (process.env.PROBE_CASE || '').split(',').map(s => s.trim()).filter(Boolean);

// One representative per remaining behaviour, all of them characters the select screens offer and
// none of them one of the defenders, so no row is a mirror and every caster is a normal pick.
const CATEGORIES = [
  { behaviour: 'beam', attacker: 'Iron Man (Tony Stark)' },
  { behaviour: 'rush', attacker: 'Naruto Uzumaki' },
  { behaviour: 'storm', attacker: 'Master Chief' },
  { behaviour: 'zone', attacker: 'Green Lantern (Hal Jordan)' },
  { behaviour: 'grab', attacker: 'Spider-Man' },
  { behaviour: 'barrage', attacker: 'Arnold Schwarzenegger' }
];

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

const report = {
  phase: '22.7', kind: 'ultimate-defensive-coverage', status: 'running',
  registry: { source: 'public/js/combat/movesets.js', moves: [], behaviours: {}, selectable: [], unreachable: [] },
  coverage: [], special: [], failures: [], unverified: [], pageErrors: []
};
const fail = (check, detail) => report.failures.push({ check, detail });

// ---------------------------------------------------------------- registry (source of truth)
// The authored data is parsed, not imported: this is the same file the game ships, and the runtime
// phase re-checks that what a fighter actually receives matches what is written here.
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
  const behaviour = (text.match(/behaviour:\s*'([a-z]+)'/) || [])[1] || null;
  return {
    label: label ? (label[1] ?? label[2]) : null,
    behaviour,
    damage: num('damage') ?? num('damage'),
    hits: num('hits'), ticks: num('ticks'),
    startup: num('startup'), active: num('active'), recovery: num('recovery'),
    range: num('range'), radius: num('radius'), width: num('width'), gap: num('gap'),
    kbs: num('kbs'), launchY: num('launchY'), stun: num('stun')
  };
};
const MOVESETS = [];
for (const match of movesetSrc.matchAll(/\n  ([a-z0-9_]+): Object\.freeze\(\{([\s\S]*?)\n  \}\)/g)) {
  const entry = parseUlt(match[2]);
  MOVESETS.push({ key: match[1], ultimate: entry });
}
// Display-name lookup, exactly as the module builds it: underscore keys first, then its alias table.
const BY_NAME = {};
for (const entry of MOVESETS) BY_NAME[entry.key.replace(/_/g, ' ')] = entry.key;
const aliasBlock = movesetSrc.match(/Object\.entries\(\{([\s\S]*?)\n\}\)\)/);
if (aliasBlock) for (const m of aliasBlock[1].matchAll(/'([^']+)':\s*'([a-z0-9_]+)'/g)) BY_NAME[m[1]] = m[2];

report.registry.moves = MOVESETS.map(({ key, ultimate }) => ({
  key,
  label: ultimate?.label ?? null,
  behaviour: ultimate?.behaviour ?? null,
  damage: ultimate?.damage ?? null,
  hits: ultimate?.hits ?? null,
  ticks: ultimate?.ticks ?? null,
  startup: ultimate?.startup ?? null,
  active: ultimate?.active ?? null,
  recovery: ultimate?.recovery ?? null,
  range: ultimate?.range ?? null,
  radius: ultimate?.radius ?? null,
  width: ultimate?.width ?? null
}));
for (const move of report.registry.moves) {
  if (!move.behaviour) { fail('registry', `${move.key} has no ultimate definition`); continue; }
  report.registry.behaviours[move.behaviour] = (report.registry.behaviours[move.behaviour] || 0) + 1;
}
for (const category of CATEGORIES) {
  if (!report.registry.behaviours[category.behaviour]) {
    fail('registry coverage', `no ultimate implements behaviour "${category.behaviour}"`);
  }
}

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
    // The game's own callouts explain any miss (meter empty, evaded, cover) without guessing.
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
    if (state.inMenu || state.status === 'match-over') {
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

  // ------------------------------------------------------------ registry: runtime reachability
  if (phaseOn('registry')) {
    await boot();
    const lists = await page.evaluate(() => {
      const options = slot => [...document.querySelectorAll(slot + ' option')].map(o => o.value);
      const cards = [...document.querySelectorAll('#selectScreen .bs-card')].map(c => c.dataset.fighter);
      return { p1: options('#p1Character'), cpu: options('#cpuCharacter'), cards };
    });
    const offered = [...new Set([...lists.p1, ...lists.cpu, ...lists.cards])].filter(Boolean);
    const selectableKeys = new Set(offered.map(name => BY_NAME[String(name).toLowerCase()]).filter(Boolean));
    report.registry.selectable = offered;
    report.registry.unreachable = report.registry.moves
      .filter(move => !selectableKeys.has(move.key))
      .map(move => ({ key: move.key, label: move.label }));
    report.registry.offeredCount = offered.length;
    report.registry.movesetCount = MOVESETS.length;
    // A move that exists in data but cannot be picked is not a defect this phase fixes; it is
    // recorded so no later report claims it was verified in play.
    for (const move of report.registry.unreachable) {
      report.unverified.push({ area: 'registry', detail: `${move.key} (${move.label}) has a moveset but no select entry` });
      console.log(`unreachable  ${move.key.padEnd(28)} ${move.label}`);
    }
    console.log(`movesets ${MOVESETS.length}, selectable characters ${offered.length}`);
    console.log('behaviours:', JSON.stringify(report.registry.behaviours));
    for (const category of CATEGORIES) {
      const parsed = report.registry.moves.find(move => move.behaviour === category.behaviour
        && BY_NAME[category.attacker.toLowerCase()] === move.key);
      if (!parsed) { fail('registry representative', `${category.attacker} is not a ${category.behaviour} caster`); continue; }
      await selectP2(category.attacker);
      await liveFrames(1);
      const runtime = (await read()).p2.ultimate;
      const match = runtime && runtime.label === parsed.label && runtime.behaviour === parsed.behaviour
        && Math.abs(runtime.damage - parsed.damage) < 0.001;
      category.runtime = { runtime, parsed, match };
      if (!match) fail('registry runtime', `${category.behaviour}: runtime ${JSON.stringify(runtime)} vs data ${JSON.stringify(parsed)}`);
      console.log(`registry     ${category.behaviour.padEnd(8)} ${category.attacker} · ${parsed.label}`
        + ` ${parsed.damage}/hit ${runtime?.hits ?? 1} hits · ${parsed.startup}s startup · match ${match}`);
    }
  }

  // ------------------------------------------------------------ coverage: the real measurement
  if (phaseOn('coverage') || phaseOn('special')) {
    await boot();
  }
  const selected = category => !CASE_FILTER.length || CASE_FILTER.includes(category.behaviour);

  /**
   * One cast, traced tick by tick. Returns every damage event with the simulated time it landed,
   * so a multi-hit move is measured hit by hit instead of as one lump.
   */
  const traceCast = async ({ defender, guarded, viaKey, category, pinShield = null }) => {
    await reset();
    await stepUntil('!(p1.attackPose > 0) && !(p1.attackQueue||[]).length && !(p1.hitstun > 0)', 1);
    await page.evaluate(({ pinShield }) => {
      const p1 = window.fighters[0];
      // Ultimates do not consult the parry window; keeping it shut isolates the guard branch.
      p1.parryTimer = 0; p1.parryCooldown = 9;
      if (pinShield !== null) p1.shield = pinShield;
    }, { pinShield });
    if (guarded) {
      await page.keyboard.down('e');
      const engaged = await stepUntil('p1.guardHeld === true', 0.5);
      if (!engaged.ok) {
        return { guarded, defender, category, guardEngaged: false, cast: false, landed: false,
          hits: [], damage: 0, firstDamage: 0, shieldSpent: 0, guardBreak: 0, offhand: null };
      }
    }
    const before = await read();
    let started;
    if (viaKey) {
      await page.evaluate(() => { window.fighters[1].meter = 100; });
      await page.keyboard.press('m');
      const consumed = await stepUntil('p2.meter < 100 || p2.casting === "ultimate"', 0.5);
      started = { ok: consumed.ok, reason: consumed.ok ? null : 'ultimate key was not consumed' };
    } else {
      started = await page.evaluate(() => {
        const p2 = window.fighters[1];
        p2.meter = 100;
        const record = window.combatPowers.tryUltimate(p2);
        window.__auditRecord = record && record.ok !== false ? record : null;
        return {
          ok: Boolean(record && record.ok !== false),
          reason: record?.reason || null,
          total: record?.total ?? null,
          events: record?.events ?? null,
          def: record?.def ?? null
        };
      });
    }
    const plan = await page.evaluate(() => {
      const record = window.__auditRecord;
      if (!record) return null;
      return {
        label: record.label, id: record.id, total: record.total,
        events: record.events.map(event => ({ at: +event.at.toFixed(3), kind: event.kind, index: event.index ?? null })),
        def: { behaviour: record.def.behaviour, damage: record.def.damage, hits: record.def.hits ?? null,
          ticks: record.def.ticks ?? null, startup: record.def.startup, active: record.def.active,
          recovery: record.def.recovery, range: record.def.range, radius: record.def.radius ?? null }
      };
    });
    // Step the fixed tick and record each damage event with its landing time and how far the
    // defender had been pushed when it landed. Stops when the cast ends, never early.
    const trace = await page.evaluate(({ maxSeconds }) => {
      const [p1, p2] = window.fighters;
      const hits = [];
      let last = p1.percent;
      const startX = p1.position.x;
      const startZ = p1.position.z;
      let moved = 0;
      let guardLostAt = null;
      const ticks = Math.ceil(maxSeconds * 60);
      let tick = 0;
      for (; tick < ticks; tick++) {
        window.__browserSmashStep(1 / 60);
        moved = Math.max(moved, Math.hypot(p1.position.x - startX, p1.position.z - startZ));
        if (guardLostAt === null && !p1.guardHeld) guardLostAt = +((tick + 1) / 60).toFixed(3);
        if (p1.percent > last + 1e-6) {
          hits.push({ at: +((tick + 1) / 60).toFixed(3), damage: +(p1.percent - last).toFixed(3),
            shield: +p1.shield.toFixed(2), travelled: +moved.toFixed(2),
            x: +p1.position.x.toFixed(2), hitstun: +p1.hitstun.toFixed(2), guard: !!p1.guardHeld });
          last = p1.percent;
        }
        if (tick > 1 && !p2.casting) break;
      }
      return {
        hits, guardLostAt, simulated: +((tick + 1) / 60).toFixed(3),
        percent: +p1.percent.toFixed(3), shield: +p1.shield.toFixed(2),
        guardBreak: +p1.guardBreak.toFixed(3), hitstun: +p1.hitstun.toFixed(3),
        guardStun: +p1.guardStun.toFixed(3), travelled: +moved.toFixed(2),
        invulnerable: +p1.invulnerable.toFixed(3)
      };
    }, { maxSeconds: 5 });
    const callouts = await page.evaluate(() => (window.__auditCallouts || []).slice(-6));
    if (guarded) await page.keyboard.up('e');
    await page.evaluate(() => window.combatPowers.clear('audit'));
    const after = await read();
    const expected = plan
      ? (plan.def.behaviour === 'grab' ? plan.events.filter(e => e.kind === 'contact').length - 1
        : plan.def.behaviour === 'zone' ? (plan.def.ticks || plan.events.length)
          : plan.def.behaviour === 'slam' || plan.def.behaviour === 'beam' ? plan.events.length
            : (plan.def.hits || plan.events.length))
      : null;
    return {
      category, defender, guarded, viaKey: !!viaKey,
      offhand: before.p1.offhand, beforePercent: before.p1.percent, beforeShield: before.p1.shield,
      guardEngaged: guarded ? before.p1.guardHeld : false,
      cast: started.ok, castReason: started.reason || null,
      plan, expectedHits: expected,
      hits: trace.hits, hitCount: trace.hits.length,
      damage: +(trace.percent - before.p1.percent).toFixed(3),
      firstDamage: trace.hits[0]?.damage ?? 0,
      shieldSpent: +(before.p1.shield - trace.shield).toFixed(2),
      guardBreak: trace.guardBreak, hitstun: trace.hitstun, guardStun: trace.guardStun,
      travelled: trace.travelled, guardLostAt: trace.guardLostAt, simulated: trace.simulated,
      settled: !after.p2.casting, callouts,
      invulnerable: before.p1.invulnerable,
      meterAfter: after.p2.meter
    };
  };

  if (phaseOn('coverage')) {
    for (const category of CATEGORIES.filter(selected)) {
      const attacker = category.attacker;
      console.log(`\n=== ${category.behaviour} · ${attacker} ===`);
      await selectP2(attacker);
      await liveFrames(2);
      for (const [index, defender] of DEFENDERS.entries()) {
        await ensureLive(defender, attacker);
        await selectP1(defender);
        await liveFrames(2);
        await ensureLive(defender, attacker);
        const guarded = await traceCast({ defender, guarded: true, category: category.behaviour });
        const open = await traceCast({ defender, guarded: false, category: category.behaviour });
        // One defender per category also drives the cast through the player's own key, so the
        // engine path is never accepted as proof that the key path works.
        const keyOpen = index === 2
          ? await traceCast({ defender, guarded: false, category: category.behaviour, viaKey: true })
          : null;
        const def = guarded.plan?.def || null;
        const row = {
          category: category.behaviour, attacker, label: guarded.plan?.label ?? null,
          defender, offhand: guarded.offhand,
          def, expectedHits: guarded.expectedHits,
          guarded: { damage: guarded.damage, first: guarded.firstDamage, hits: guarded.hitCount,
            perHit: guarded.hits.map(h => h.damage), shieldSpent: guarded.shieldSpent,
            guardBreak: guarded.guardBreak, travel: guarded.travelled, guardEngaged: guarded.guardEngaged },
          open: { damage: open.damage, first: open.firstDamage, hits: open.hitCount,
            perHit: open.hits.map(h => h.damage), travel: open.travelled },
          key: keyOpen ? { damage: keyOpen.damage, first: keyOpen.firstDamage, hits: keyOpen.hitCount,
            cast: keyOpen.cast } : null,
          guardScale: open.firstDamage > 0 ? +(guarded.firstDamage / open.firstDamage).toFixed(3) : null,
          guardLostAt: guarded.guardLostAt,
          guardAtHits: guarded.hits.map(hit => hit.guard),
          // A grab's first planned event is the pull, which deals no damage, so its damage hits
          // line up with the events after it.
          timing: guarded.hits.map((hit, i) => ({ measured: hit.at,
            planned: guarded.plan?.events[def?.behaviour === 'grab' ? i + 1 : i]?.at ?? null })),
          callouts: [...new Set([...guarded.callouts])],
          landed: { guarded: guarded.hitCount > 0, open: open.hitCount > 0, key: keyOpen ? keyOpen.hitCount > 0 : null },
          castAccepted: guarded.cast && open.cast && (!keyOpen || keyOpen.cast),
          invulnerable: [guarded.invulnerable, open.invulnerable]
        };
        row.ok = row.castAccepted && row.landed.guarded && row.landed.open
          && (row.key ? row.key.cast && row.landed.key : true)
          && row.guarded.hits >= (row.expectedHits || 1);
        report.coverage.push(row);
        if (!row.castAccepted) fail(`${category.behaviour}/${defender} cast`, JSON.stringify({ guarded: guarded.castReason, open: open.castReason }));
        if (!row.landed.guarded || !row.landed.open) {
          fail(`${category.behaviour}/${defender} landed`, `guarded ${guarded.hitCount} hits, open ${open.hitCount}, callouts ${row.callouts.join('|')}`);
        }
        if (row.key && !row.key.cast) fail(`${category.behaviour}/${defender} key cast`, keyOpen?.castReason || 'not consumed');
        if (row.key && Math.abs(row.key.first - row.open.first) > 0.01) {
          fail(`${category.behaviour}/${defender} key path`, `key ${row.key.first}% vs engine ${row.open.first}%`);
        }
        // A grab's pull applies forced hitstun, and the fighter simulation only guards while
        // `hitstun <= 0` (fighter3D.js:184). The pull therefore forces the guard down for the whole
        // chain, which makes grab-type ultimates genuinely unblockable. That is measured and
        // reported as its own behaviour instead of being forced into a guard-scale comparison.
        row.classification = category.behaviour === 'grab' ? 'unblockable' : 'blockable';
        if (row.classification === 'unblockable') {
          const droppedBeforeDamage = guarded.hits.every(hit => hit.guard === false);
          const sameAsOpen = Math.abs(row.guarded.damage - row.open.damage) <= 0.05;
          const drainOnly = row.guarded.shieldSpent < 12 && row.guarded.guardBreak === 0;
          row.ok = row.ok && droppedBeforeDamage && sameAsOpen && drainOnly;
          if (!(droppedBeforeDamage && sameAsOpen && drainOnly)) {
            fail(`${category.behaviour}/${defender} unblockable`, `guard at hits ${JSON.stringify(row.guardAtHits)},`
              + ` guarded ${row.guarded.damage}% vs open ${row.open.damage}%, shield -${row.guarded.shieldSpent}`);
          }
        } else {
          const expected = row.offhand === 'shield' ? 0.18 : 0.28;
          row.ok = row.ok && row.guardScale !== null && Math.abs(row.guardScale - expected) <= 0.02;
          if (row.guardScale === null || Math.abs(row.guardScale - expected) > 0.02) {
            fail(`${category.behaviour}/${defender} guard scale`, `${row.guardScale}, expected ${expected} (offhand ${row.offhand})`);
          }
        }
        console.log(`${defender.padEnd(13)} ${String(row.offhand).padEnd(7)} guarded ${String(row.guarded.damage).padStart(7)}%`
          + ` (${row.guarded.hits}/${row.expectedHits} hits) open ${String(row.open.damage).padStart(7)}% (${row.open.hits} hits)`
          + ` scale ${row.guardScale} shield -${row.guarded.shieldSpent}`
          + `${row.key ? ` key ${row.key.damage}%` : ''} ${row.ok ? '' : 'FAIL ' + row.callouts.join('|')}`);
      }
    }
  }

  // ------------------------------------------------------------ special: invulnerability, parry
  if (phaseOn('special')) {
    for (const category of CATEGORIES.filter(selected)) {
      const attacker = category.attacker;
      await selectP2(attacker);
      await liveFrames(2);
      for (const caseKind of ['invulnerable', 'parry']) {
        const defender = 'Thor';
        await ensureLive(defender, attacker);
        const result = await page.evaluate(({ caseKind }) => {
          window.combatPowers.clear('audit');
          const [p1, p2] = window.fighters;
          for (const fighter of [p1, p2]) {
            fighter.percent = 0; fighter.velocity.set(0, 0, 0); fighter.hitstun = 0;
            fighter.guardBreak = 0; fighter.guardHeld = false; fighter.meter = 0; fighter.shield = 100;
            fighter.attackQueue.length = 0; fighter.parryTimer = 0; fighter.parryCooldown = 0;
          }
          p1.position.set(0, p1.groundLevel, 0); p1.facing = 1; p1.facingZ = 0;
          p2.position.set(1.02, p2.groundLevel, 0); p2.facing = -1; p2.facingZ = 0;
          if (caseKind === 'invulnerable') p1.invulnerable = 6;
          if (caseKind === 'parry') { p1.parryTimer = 6; p1.parryCooldown = 0; }
          return { percent: p1.percent, parryTimer: p1.parryTimer, invulnerable: p1.invulnerable };
        }, { caseKind });
        const started = await page.evaluate(() => {
          const p2 = window.fighters[1];
          p2.meter = 100;
          const record = window.combatPowers.tryUltimate(p2);
          return { ok: Boolean(record && record.ok !== false), label: record?.label ?? null };
        });
        const trace = await page.evaluate(({ maxSeconds }) => {
          const p1 = window.fighters[0];
          const p2 = window.fighters[1];
          const ticks = Math.ceil(maxSeconds * 60);
          let tick = 0;
          let parryAtHit = null;
          let invulnerableAtHit = null;
          let hits = 0;
          let last = p1.percent;
          for (; tick < ticks; tick++) {
            window.__browserSmashStep(1 / 60);
            if (p1.percent > last + 1e-6) {
              hits++;
              if (parryAtHit === null) parryAtHit = +p1.parryTimer.toFixed(2);
              if (invulnerableAtHit === null) invulnerableAtHit = +p1.invulnerable.toFixed(2);
              last = p1.percent;
            }
            if (tick > 1 && !p2.casting) break;
          }
          return { percent: +p1.percent.toFixed(3), parryTimer: +p1.parryTimer.toFixed(2),
            invulnerable: +p1.invulnerable.toFixed(2), parryAtHit, invulnerableAtHit, hits,
            simulated: +((tick + 1) / 60).toFixed(2), hitstun: +p1.hitstun.toFixed(2) };
        }, { maxSeconds: 5 });
        const callouts = await page.evaluate(() => (window.__auditCallouts || []).slice(-4));
        await page.evaluate(() => window.combatPowers.clear('audit'));
        const row = { category: category.behaviour, caseKind, defender, cast: started.ok,
          label: started.label, damage: trace.percent, hits: trace.hits,
          parryAtHit: trace.parryAtHit, invulnerableAtHit: trace.invulnerableAtHit,
          setup: result, callouts };
        // Invulnerability must read as a real miss. Parry is not consulted by the ultimate
        // resolver at all (combat_powers.hit has no parry branch), so the check is that the move
        // still lands at full damage while the parry window is open.
        row.ok = caseKind === 'invulnerable'
          ? row.cast && trace.percent === 0 && trace.hits === 0
          : row.cast && trace.percent > 0 && trace.hits > 0 && trace.parryAtHit > 0;
        if (!row.ok) {
          fail(`${category.behaviour} ${caseKind}`, `damage ${trace.percent}% hits ${trace.hits}`
            + ` parryAtHit ${trace.parryAtHit} invulnerableAtHit ${trace.invulnerableAtHit}`);
        }
        report.special.push(row);
        if (caseKind === 'invulnerable' && row.cast && trace.percent > 0) {
          fail(`${category.behaviour} invulnerability`, `${trace.percent}% landed through 6 s of invulnerability`);
        }
        console.log(`special      ${category.behaviour.padEnd(8)} ${caseKind.padEnd(12)} damage ${row.damage}%`
          + ` callouts ${callouts.join('|')}`);
      }
    }
  }

  report.status = report.failures.length ? 'failed' : 'complete';
} catch (error) {
  report.status = 'error';
  report.error = String(error && error.stack || error);
  report.failures.push({ check: 'probe', detail: String(error && error.message || error) });
} finally {
  await browser.close();
  server.close();
  await writeFile(outFile, JSON.stringify(report, null, 1));
  console.log(`\nstatus ${report.status} · failures ${report.failures.length}`
    + ` · pageErrors ${report.pageErrors.length} · wrote ${outFile}`);
  for (const failure of report.failures) console.log('  FAIL ' + failure.check + ' — ' + failure.detail);
}
