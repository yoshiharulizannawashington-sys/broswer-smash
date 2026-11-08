// Phase 22.9: multi-stage storm targeting.
//
//   PROBE_TAG=before bash scripts/run-browser-test.sh scripts/audit-storm-targeting.mjs
//   PROBE_TAG=after  bash scripts/run-browser-test.sh scripts/audit-storm-targeting.mjs
//
// Phase 22.8 found that Link (2/3), Aang (2/4) and Hashirama (2/3) lose later strikes of their
// storm ultimates. This probe measures why, strike by strike, and then measures the same eight
// storms again after the repair.
//
// Per strike it records the mark the behaviour uses, the target's position, horizontal distance,
// vertical gap, 3-D distance, the volume limit, whether the strike was inside a sphere or a
// vertical column, the target's velocity and hitstun, and whether it landed. Damage and the landed
// flag are derived from the tick samples that bracket the scheduled event, not from in-loop
// attribution, so a strike cannot be credited to the wrong frame.
//
// Cases per move: stationary against a shield and a bare defender, the same two guarded
// (0.18 / 0.28), an airborne target, a target that steps out of the mark mid-cast, an invulnerable
// target, and the same move cast by player 1.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase22-9');
await mkdir(outDir, { recursive: true });
const tag = (process.env.PROBE_TAG || 'run').replace(/[^a-z0-9-]/gi, '');
const outFile = resolve(outDir, `storm-targeting-${tag}.json`);
const CASE_FILTER = (process.env.PROBE_CASE || '').split(',').map(s => s.trim()).filter(Boolean);
const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// ---------------------------------------------------------------- authored storm definitions
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
    damage: num('damage'), hits: num('hits'), ticks: num('ticks'), gap: num('gap'),
    startup: num('startup'), active: num('active'), recovery: num('recovery'),
    range: num('range'), radius: num('radius'), launchY: num('launchY'), stun: num('stun')
  };
};
const MOVESETS = [];
for (const match of movesetSrc.matchAll(/\n  ([a-z0-9_]+): Object\.freeze\(\{([\s\S]*?)\n  \}\)/g)) {
  MOVESETS.push({ key: match[1], ultimate: parseUlt(match[2]) });
}
const STORMS = MOVESETS.filter(entry => entry.ultimate?.behaviour === 'storm');
const BY_NAME = {};
for (const entry of MOVESETS) BY_NAME[entry.key.replace(/_/g, ' ')] = entry.key;
const aliasBlock = movesetSrc.match(/Object\.entries\(\{([\s\S]*?)\n\}\)\)/);
if (aliasBlock) for (const m of aliasBlock[1].matchAll(/'([^']+)':\s*'([a-z0-9_]+)'/g)) BY_NAME[m[1]] = m[2];
const NAME_OF = {};
for (const [name, key] of Object.entries(BY_NAME)) if (!NAME_OF[key]) NAME_OF[key] = name;

// A caster cannot defend against itself; Thor's storm is measured against Link and Aquaman.
const defendersFor = key => key === 'thor'
  ? { shield: 'Link', bare: 'Aquaman', p1: 'Aquaman' }
  : { shield: 'Wonder Woman', bare: 'Thor', p1: 'Thor' };

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

const requested = CASE_FILTER.length ? STORMS.filter(entry => CASE_FILTER.includes(entry.key)) : STORMS;
const report = {
  phase: '22.9', kind: 'storm-targeting', tag,
  source: { file: 'public/js/combat/ultimate.js', behaviour: 'storm' },
  authored: STORMS.map(({ key, ultimate }) => ({ key, name: NAME_OF[key] || key, ...ultimate })),
  moves: [], failures: [], pageErrors: []
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
    const snap = fighter => ({
      identity: fighter.identity, offhand: fighter.model?.userData?.offhandKind ?? null,
      percent: +fighter.percent.toFixed(3), shield: +(fighter.shield ?? 100).toFixed(2),
      hitstun: +(fighter.hitstun || 0).toFixed(3), guardBreak: +(fighter.guardBreak || 0).toFixed(3),
      guardHeld: !!fighter.guardHeld, invulnerable: +(fighter.invulnerable || 0).toFixed(3),
      casting: fighter.casting
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
    return { ok: false, reason: `stayed ${fighter.identity}` };
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
      fighter.counterWindow = 0; fighter.meter = 0; fighter.guardHeld = false; fighter.shield = 100;
    }
    p1.position.set(0, p1.groundLevel, 0); p1.facing = 1; p1.facingZ = 0;
    p2.position.set(gap, p2.groundLevel, 0); p2.facing = -1; p2.facingZ = 0;
    p2.aiLevel = 0; p2.cpuControlled = false;
    return { inMenu: document.body.classList.contains('in-menu') };
  }, { gap });
  const ensureLive = async (defender, attacker, { p1IsAttacker = false } = {}) => {
    const state = await read();
    if (state.inMenu || state.status === 'match-over' || state.status === 'round-over') {
      await startMatch(p1IsAttacker ? attacker : defender, p1IsAttacker ? defender : attacker);
      await liveFrames(3);
    }
    if (p1IsAttacker) {
      if ((await read()).p1.identity !== attacker) { await selectP1(attacker); await liveFrames(2); }
      if ((await read()).p2.identity !== defender) { await selectP2(defender); await liveFrames(2); }
    } else {
      if ((await read()).p2.identity !== attacker) { await selectP2(attacker); await liveFrames(2); }
      if ((await read()).p1.identity !== defender) { await selectP1(defender); await liveFrames(2); }
    }
    await reset();
    return read();
  };

  await boot();
  await page.evaluate(() => window.__browserSmashSetRules?.({ roundsToWin: 5, roundSeconds: 300 }));
  const options = await page.evaluate(() => [...document.querySelectorAll('#cpuCharacter option')].map(o => o.value));
  const optionByKey = {};
  for (const name of options) { const key = BY_NAME[String(name).toLowerCase()]; if (key && !optionByKey[key]) optionByKey[key] = name; }

  /**
   * Cast, sample every fixed tick, and derive each strike afterwards. Damage and the landed flag
   * come from the samples bracketing the event time, so attribution cannot drift by a frame.
   */
  const runCase = async ({ guarded = false, invulnerable = false, airborne = false,
    escape = 0, caster = 'p2', defenderLabel, attackerLabel }) => {
    if (guarded) {
      await page.keyboard.down('e');
      const engaged = await stepUntil('p1.guardHeld === true', 0.5);
      if (!engaged.ok) {
        await page.keyboard.up('e');
        return { blocked: 'guard never engaged', strikes: [], damage: 0, hits: 0 };
      }
    }
    const setup = await page.evaluate(({ invulnerable, airborne }) => {
      const [p1, p2] = window.fighters;
      const target = window.__auditCasterIsP1 ? p2 : p1;
      if (target === p1) { p1.parryTimer = 0; p1.parryCooldown = 9; }
      if (invulnerable) target.invulnerable = 6;
      if (airborne) {
        target.position.y = (target.groundLevel || 0) + 7;
        target.velocity.y = 9;
        target.isGrounded = false;
      }
      return { targetOffhand: target.model?.userData?.offhandKind ?? null };
    }, { invulnerable, airborne });
    const before = await read();
    const started = await page.evaluate(({ caster }) => {
      const owner = caster === 'p1' ? window.fighters[0] : window.fighters[1];
      owner.meter = 100;
      window.__auditCasterIsP1 = caster === 'p1';
      const record = window.combatPowers.tryUltimate(owner);
      window.__auditRecord = record && record.ok !== false ? record : null;
      return { ok: Boolean(record && record.ok !== false), reason: record?.reason || null };
    }, { caster });
    const plan = await page.evaluate(() => {
      const record = window.__auditRecord;
      if (!record) return null;
      const target = window.__auditCasterIsP1 ? window.fighters[1] : window.fighters[0];
      return {
        label: record.label, total: +record.total.toFixed(2),
        events: record.events.map((event, index) => ({ index, at: +event.at.toFixed(3), kind: event.kind })),
        def: { behaviour: record.def.behaviour, damage: record.def.damage, hits: record.def.hits ?? null,
          radius: record.def.radius ?? null, active: record.def.active, startup: record.def.startup },
        marks: record.marks.map(mark => ({ x: +mark.x.toFixed(3), y: +mark.y.toFixed(3), z: +mark.z.toFixed(3) })),
        anchor: { x: +record.anchor.x.toFixed(3), y: +record.anchor.y.toFixed(3), z: +record.anchor.z.toFixed(3) },
        allMarksAtAnchor: record.marks.every(mark => mark.distanceTo(record.anchor) < 1e-6),
        hurtbox: +((target.hurtboxRadius || .7)).toFixed(2)
      };
    });
    const trace = await page.evaluate(({ maxSeconds, escape }) => {
      const record = window.__auditRecord;
      const target = window.__auditCasterIsP1 ? window.fighters[1] : window.fighters[0];
      const casterFighter = window.__auditCasterIsP1 ? window.fighters[0] : window.fighters[1];
      const samples = [];
      let escapedAt = null;
      const ticks = Math.ceil(maxSeconds * 60);
      let tick = 0;
      for (; tick < ticks; tick++) {
        const previous = samples.length ? samples[samples.length - 1].percent : target.percent;
        window.__browserSmashStep(1 / 60);
        samples.push({
          tick: tick + 1, t: record ? +record.t.toFixed(3) : null,
          percent: +target.percent.toFixed(3), hitCount: record ? record.hitCount : null,
          pos: { x: +target.position.x.toFixed(2), y: +target.position.y.toFixed(2), z: +target.position.z.toFixed(2) },
          vel: { x: +target.velocity.x.toFixed(2), y: +target.velocity.y.toFixed(2), z: +target.velocity.z.toFixed(2) },
          hitstun: +target.hitstun.toFixed(2), grounded: !!target.isGrounded
        });
        // A lateral step taken after the strike that triggered it: that strike still counts, and
        // every later one is marked as after the escape.
        if (escape && escapedAt === null && target.percent > previous + 1e-6) {
          target.position.x += escape;
          escapedAt = +record.t.toFixed(3);
        }
        if (tick > 1 && !casterFighter.casting && (!record || record.phase === 'done')) break;
      }
      return { samples, escapedAt, percent: +target.percent.toFixed(3),
        simulated: +((tick + 1) / 60).toFixed(3),
        targetShield: +target.shield.toFixed(2), targetHitstun: +target.hitstun.toFixed(3) };
    }, { maxSeconds: 7, escape });
    const meta = await page.evaluate(() => {
      const record = window.__auditRecord;
      const scene = window.__browserSmashScene;
      const leftovers = scene
        ? scene.children.filter(o => String(o.name || '').startsWith('ultimate:')).map(o => o.name)
        : null;
      return {
        endReason: record?.endReason ?? null, fired: record?.fired ?? null,
        hitCount: record?.hitCount ?? null, whiffs: record?.whiffs ?? null,
        eventCount: record?.events?.length ?? null, t: record ? +record.t.toFixed(2) : null,
        castingAfter: !!(window.__auditCasterIsP1 ? window.fighters[0].casting : window.fighters[1].casting),
        leftovers
      };
    });
    const callouts = await page.evaluate(() => (window.__auditCallouts || []).slice(-6));
    if (guarded) await page.keyboard.up('e');
    await page.evaluate(() => window.combatPowers.clear('audit'));
    const after = await read();

    // Derive each strike from the samples around its scheduled time.
    const strikes = (plan?.events || []).map(event => {
      const mark = plan.marks[event.index] ?? plan.anchor;
      // The last sample strictly before the event is the state the behaviour samples. The strike's
      // result is the first *change* after it, not simply the next sample: a frozen or half-tick
      // frame can carry the event's rounded timestamp while the damage still lands one frame later.
      let preIndex = 0;
      for (let index = 0; index < trace.samples.length; index++) {
        const sample = trace.samples[index];
        if (sample.t !== null && sample.t < event.at - 1e-9) preIndex = index;
      }
      const pre = trace.samples[preIndex] ?? null;
      let post = null;
      for (let index = preIndex + 1; index < trace.samples.length; index++) {
        const sample = trace.samples[index];
        if (sample.percent > (pre?.percent ?? 0) + 1e-9 || sample.hitCount > (pre?.hitCount ?? 0)) {
          post = sample;
          break;
        }
      }
      const horizontal = pre ? Math.hypot(pre.pos.x - mark.x, pre.pos.z - mark.z) : null;
      const vertical = pre ? (pre.pos.y + .9) - (mark.y + .3) : null;
      const distance = pre ? Math.hypot(horizontal, vertical) : null;
      const limit = plan ? +((plan.def.radius || 0) + plan.hurtbox).toFixed(2) : null;
      const damage = pre && post ? +(post.percent - pre.percent).toFixed(3) : 0;
      const landed = pre && post ? post.hitCount > pre.hitCount : false;
      return {
        index: event.index, planned: event.at, ultT: pre ? pre.t : null, tick: pre ? pre.tick : null,
        mark, target: pre ? pre.pos : null, velocity: pre ? pre.vel : null,
        hitstun: pre ? pre.hitstun : null, grounded: pre ? pre.grounded : null,
        horizontal: horizontal === null ? null : +horizontal.toFixed(2),
        vertical: vertical === null ? null : +vertical.toFixed(2),
        distance: distance === null ? null : +distance.toFixed(2), limit,
        inSphere: distance !== null && distance <= limit,
        inColumn: horizontal !== null && horizontal <= limit,
        damage, landed,
        afterEscape: trace.escapedAt !== null && pre !== null && pre.t > trace.escapedAt
      };
    });

    return {
      defender: defenderLabel, attacker: attackerLabel, caster,
      targetOffhand: setup.targetOffhand, guardEngaged: guarded ? before.p1.guardHeld : false,
      cast: started.ok, castReason: started.reason || null, plan, strikes,
      escapedAt: trace.escapedAt,
      hits: meta.hitCount ?? strikes.filter(strike => strike.landed).length,
      damage: +(trace.percent - (caster === 'p1' ? before.p2.percent : before.p1.percent)).toFixed(3),
      before: caster === 'p1' ? before.p2.percent : before.p1.percent,
      after: caster === 'p1' ? after.p2.percent : after.p1.percent,
      shieldSpent: +(100 - trace.targetShield).toFixed(2), record: meta, callouts,
      simulated: trace.simulated
    };
  };

  for (const entry of requested) {
    const attacker = optionByKey[entry.key];
    const move = {
      key: entry.key, character: attacker ?? null, label: entry.ultimate?.label ?? null,
      authored: entry.ultimate, defenders: defendersFor(entry.key),
      cases: {}, checks: [], status: 'NOT_MEASURED', failureReasons: [], evidence: []
    };
    report.moves.push(move);
    if (!attacker) {
      move.status = 'BLOCKED_BY_TEST_SETUP';
      move.failureReasons.push('no select entry');
      continue;
    }
    const defenders = defendersFor(entry.key);
    const planned = entry.ultimate.hits || 1;
    try {
      await selectP2(attacker);
      await liveFrames(2);
      for (const [name, defender, extra] of [
        ['stationaryShield', defenders.shield, { guarded: false }],
        ['guardedShield', defenders.shield, { guarded: true }],
        ['stationaryBare', defenders.bare, { guarded: false }],
        ['guardedBare', defenders.bare, { guarded: true }],
        ['airborne', defenders.bare, { airborne: true }],
        ['escape', defenders.bare, { escape: 12 }],
        ['invulnerable', defenders.bare, { invulnerable: true }]
      ]) {
        const state = await ensureLive(defender, attacker);
        if (state.p1.identity !== defender || state.p2.identity !== attacker) {
          move.cases[name] = { blocked: `setup ${state.p1.identity}/${state.p2.identity}`, strikes: [], hits: 0, damage: 0 };
          continue;
        }
        move.cases[name] = await runCase({ ...extra, caster: 'p2', defenderLabel: defender, attackerLabel: attacker });
      }
      {
        const state = await ensureLive(defenders.p1, attacker, { p1IsAttacker: true });
        move.cases.p1Cast = state.p1.identity !== attacker
          ? { blocked: `caster stayed ${state.p1.identity}`, strikes: [], hits: 0, damage: 0 }
          : await runCase({ caster: 'p1', defenderLabel: defenders.p1, attackerLabel: attacker });
      }

      const push = (name, ok, detail) => move.checks.push({ name, ok: !!ok, detail });
      const stationary = [move.cases.stationaryShield, move.cases.stationaryBare];
      const guarded = [move.cases.guardedShield, move.cases.guardedBare];
      push('castStarted', Object.values(move.cases).every(c => c.blocked || c.cast),
        Object.entries(move.cases).filter(([, c]) => !c.blocked && !c.cast).map(([n]) => n).join(', ') || null);
      push('stationaryHits', stationary.every(c => c.hits === planned),
        stationary.map(c => `${c.defender}: ${c.hits}/${planned} strikes, ${c.damage}%, whiffs ${c.record?.whiffs}`).join(' | '));
      push('guardedHits', guarded.every(c => c.hits === planned),
        guarded.map(c => `${c.defender}: ${c.hits}/${planned} strikes, ${c.damage}%`).join(' | '));
      for (const [name, expected] of [['guardedShield', 0.18], ['guardedBare', 0.28]]) {
        const open = name === 'guardedShield' ? move.cases.stationaryShield : move.cases.stationaryBare;
        const first = move.cases[name].strikes.find(strike => strike.landed)?.damage ?? null;
        const openFirst = open.strikes.find(strike => strike.landed)?.damage ?? null;
        const scale = first && openFirst ? +(first / openFirst).toFixed(3) : null;
        push(name + 'Scale', scale !== null && Math.abs(scale - expected) <= 0.02,
          `guarded ${first} vs open ${openFirst} scale ${scale} expected ${expected}`);
      }
      const invulnerable = move.cases.invulnerable;
      push('invulnerability', invulnerable.damage === 0 && invulnerable.hits === 0,
        `damage ${invulnerable.damage}%, hits ${invulnerable.hits},`
        + ` callouts ${[...new Set(invulnerable.callouts || [])].join('|') || 'none'}`);
      const escape = move.cases.escape;
      const escapedStrikes = escape.strikes.filter(strike => strike.afterEscape);
      const escapeApplicable = escape.strikes.length > 1;
      push('escapeRespected', !escapeApplicable
        || (escapedStrikes.length > 0 && escapedStrikes.every(strike => !strike.landed)),
        escapeApplicable
          ? `${escape.hits}/${planned} landed; after the step at ${escape.escapedAt}s `
            + JSON.stringify(escapedStrikes.map(strike => ({ at: strike.ultT, landed: strike.landed, horizontal: strike.horizontal })))
          : `single-strike move: no later strike can be escaped (step at ${escape.escapedAt}s)`);
      push('p1CastHits', move.cases.p1Cast.hits === planned,
        `P1 cast: ${move.cases.p1Cast.hits}/${planned} strikes, ${move.cases.p1Cast.damage}%`);
      push('cleanup', Object.values(move.cases).every(c => c.blocked
        || (c.record?.endReason === 'finished' && c.record?.castingAfter === false
          && Array.isArray(c.record?.leftovers) && c.record.leftovers.length === 0)),
        Object.entries(move.cases).map(([name, c]) => `${name}: ${c.record?.endReason}/${c.record?.fired}/${c.record?.eventCount}`).join(' '));

      // The phase evidence: strikes that were inside the column but outside the sphere and missed.
      move.evidence = stationary.flatMap(c => c.strikes
        .filter(strike => !strike.landed && strike.inColumn)
        .map(strike => ({ defender: c.defender, strike: strike.index, ultT: strike.ultT,
          horizontal: strike.horizontal, distance: strike.distance, limit: strike.limit,
          height: strike.target.y, velocityY: strike.velocity.y })));
      move.status = move.checks.some(check => !check.ok) ? 'FAIL' : 'PASS';
      move.failureReasons = move.checks.filter(check => !check.ok).map(check => `${check.name}: ${check.detail}`);
      if (move.status !== 'PASS') report.failures.push({ key: move.key, reasons: move.failureReasons });
    } catch (error) {
      move.status = 'BLOCKED_BY_TEST_SETUP';
      move.failureReasons.push('probe error: ' + String(error && error.message || error));
      report.failures.push({ key: move.key, reasons: move.failureReasons });
    }
    const stationaryShield = move.cases.stationaryShield;
    console.log(`${move.status.padEnd(6)} ${move.key.padEnd(20)} strikes ${stationaryShield?.hits ?? 0}/${planned}`
      + ` columnMisses ${move.evidence.length}`
      + `${move.status === 'PASS' ? '' : ' — ' + move.failureReasons.slice(0, 2).join(' | ')}`);
    await writeFile(outFile, JSON.stringify(report, null, 1));
  }
  report.status = report.failures.length ? 'failed' : 'complete';
} catch (error) {
  report.status = 'error';
  report.error = String(error && error.stack || error);
} finally {
  await browser.close();
  server.close();
  await writeFile(outFile, JSON.stringify(report, null, 1));
  console.log(`\nstatus ${report.status} · moves ${report.moves.length}/${requested.length}`
    + ` · pageErrors ${report.pageErrors.length} · wrote ${outFile}`);
  for (const failure of report.failures) console.log('  FAIL ' + failure.key + ' — ' + failure.reasons.join(' | '));
}
