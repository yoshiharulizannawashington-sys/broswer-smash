// Moveset, transformation and ultimate tests.
//
// Two halves:
//   1. pure data / rule checks against the real tables (no browser), including coverage of the
//      roster that is actually registered in main.js;
//   2. the same systems driven through the live game in headless Chromium — a real cast, real
//      simulation steps, real damage, real HUD, real keyboard and gamepad input.
//
// node scripts/test-movesets.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { MOVESETS, movesetFor, ultimateFor, slugOf } from '../public/js/combat/movesets.js';
import { ULTIMATE, meterFromDamage, canUltimate, startUltimate, updateUltimates,
  canUltimate as canCast, clearUltimates, testContext } from '../public/js/combat/ultimate.js';
import { POWER, FORM, canTransform, beginTransform, endTransform, tickTransform, transformState, powerFromDamage, NEUTRAL_MODS , gainPower } from '../public/js/combat/transformation.js';
import { DEFAULT_RULES } from '../public/js/combat/combat_rules.js';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

// ---- the roster that is actually registered ------------------------------------
const mainSource = await readFile(resolve(root, 'public/js/main.js'), 'utf8');
const rosterBlock = mainSource.match(/const roster=\[((?:"[^"]*",\s*"[^"]*"\],?\s*)+)\]/)
  || mainSource.match(/const roster=\[(.*?)\];/s);
assert.ok(rosterBlock, 'could not read the launch roster out of main.js');
const rosterNames = [...rosterBlock[1].matchAll(/\['?"([^"]+)"\s*,\s*'?"([^"]+)"'?\]/g)].map(m => m[1]);
const rosterSlugs = rosterNames.map(slugOf);
console.log(`roster: ${rosterNames.length} selectable fighters`);

{
  // 38: the approved launch roster after the three recovered promotions. The count stays pinned
  // so a silent change fails.
  check('the launch roster is the expected 38 fighters', rosterNames.length === 38, String(rosterNames.length));
  const missing = rosterSlugs.filter(slug => !MOVESETS[slug]);
  check('every registered fighter has a moveset', missing.length === 0, missing.join(', '));
  // Wolverine, Geralt and Doom Slayer are launch fighters again; their movesets and kits must
  // resolve from the launch entry, not only from the wider catalog.
  const catalogBlock = mainSource.match(/const allRoster=\[((?:\["[^"]+","[^"]+"\],?\s*)+)\]/);
  assert.ok(catalogBlock, 'could not read the character catalog out of main.js');
  const catalogSlugs = [...catalogBlock[1].matchAll(/\["([^"]+)","([^"]+)"\]/g)].map(m => slugOf(m[1]));
  const extra = Object.keys(MOVESETS).filter(key => !rosterSlugs.includes(key) && !catalogSlugs.includes(key));
  check('the moveset table has no fighters outside the roster or catalog', extra.length === 0, extra.join(', '));
  check('every fighter resolves a moveset through its display name',
    rosterNames.every(name => movesetFor(name) && movesetFor(slugOf(name))));
}

// ---- per-fighter data validation -----------------------------------------------
{
  const problems = [];
  for (const [key, set] of Object.entries(MOVESETS)) {
    const where = `${key}:`;
    if (!Array.isArray(set.lights) || set.lights.length < 3) problems.push(`${where} needs a 3-step light chain`);
    if (!Array.isArray(set.heavy) || set.heavy.length < 2) problems.push(`${where} needs two heavies`);
    if (!set.aerial) problems.push(`${where} needs an aerial attack`);
    if (!set.style) problems.push(`${where} needs a style line`);
    const form = set.form;
    if (!form) {
      // A deliberately formless fighter is valid only when the data says so; an accidental
      // missing form on anyone else is still an error.
      if (!set.formless) problems.push(`${where} has no transformation`);
    } else {
      for (const field of ['id', 'label', 'aura', 'color', 'duration', 'cost', 'drain', 'cooldown']) {
        if (form[field] === undefined) problems.push(`${where} form.${field} missing`);
      }
      if (!(form.duration > 0)) problems.push(`${where} form duration must be positive`);
      if (!(form.cost > 0 && form.cost <= POWER.max)) problems.push(`${where} form cost must be 1..100`);
      if (!form.mods || typeof form.mods !== 'object') problems.push(`${where} form needs mods`);
      if (!form.special?.label) problems.push(`${where} form needs a replaced signature move`);
    }
    const ult = set.ultimate;
    if (!ult?.label) problems.push(`${where} has no ultimate`);
    if (!['beam', 'rush', 'slam', 'storm', 'zone', 'grab', 'barrage'].includes(ult?.behaviour)) {
      problems.push(`${where} ultimate behaviour "${ult?.behaviour}" has no implementation`);
    }
    if (!(ult?.damage > 0)) problems.push(`${where} ultimate damage must be positive`);
    if (ult?.startup > 0 && ult?.recovery <= 0) problems.push(`${where} ultimate needs recovery`);
    if (!ult?.note) problems.push(`${where} ultimate needs a note for the move list`);
  }
  check('every moveset is complete and uses an implemented ultimate behaviour', problems.length === 0,
    problems.slice(0, 8).join(' | '));

  const formedSets = Object.values(MOVESETS).filter(set => !set.formless);
  const ids = formedSets.map(set => set.form.id);
  check('every transformation has a distinct id', new Set(ids).size === ids.length);
  const auras = new Set(formedSets.map(set => set.form.aura));
  check('transformations are not one shared aura', auras.size >= 6, [...auras].join(','));
  const colours = new Set(formedSets.map(set => set.form.color));
  check('transformations are visually distinct by colour too', colours.size >= 20, String(colours.size));
  const behaviours = new Set(Object.values(MOVESETS).map(set => set.ultimate.behaviour));
  check('ultimates are spread across the implemented behaviours', behaviours.size >= 6, [...behaviours].join(','));

  // A single ultimate hit must not be able to end a full round from 0%.
  const lethal = Object.entries(MOVESETS)
    .filter(([, set]) => set.ultimate.damage >= DEFAULT_RULES.maxPercent)
    .map(([key]) => key);
  check('no ultimate one-shots a fresh fighter', lethal.length === 0, lethal.join(', '));
  // Multi-hit ultimates are allowed to total more, but each event stays under the round limit.
  const heaviest = Math.max(...Object.values(MOVESETS).map(set => set.ultimate.damage));
  check('the heaviest single ultimate hit stays well under the round limit',
    heaviest < DEFAULT_RULES.maxPercent * .5, String(heaviest));
}

// ---- transformation rules ------------------------------------------------------
function fakeVec(x = 0, y = 0, z = 0) {
  const v = { x, y, z };
  v.clone = () => fakeVec(v.x, v.y, v.z);
  v.add = () => v;
  v.sub = () => v;
  v.distanceTo = () => 4;
  v.addScaledVector = () => v;
  v.length = () => Math.hypot(v.x, v.y, v.z);
  v.normalize = () => v;
  return v;
}

function fakeFighter(overrides = {}) {
  const set = MOVESETS.goku;
  return {
    identity: 'Goku', identityKey: 'goku', moveset: set, ultimateDef: set.ultimate,
    specialProfile: { label: 'KAMEHAMEHA', damage: 22 }, baseSpecialProfile: null,
    power: 100, meter: 0, ko: false, grabbedBy: null, hitstun: 0, guardBreak: 0,
    transform: null, transformCooldown: 0, incomingDamage: 1, transformMods: null,
    attackQueue: [], attackBuffer: 0, position: fakeVec(), facing: 1, facingZ: 0,
    model: { add() {}, userData: {} }, t: 0,
    ...overrides
  };
}

{
  const f = fakeFighter();
  check('a form cannot be entered without enough power', !canTransform({ ...f, power: 5 }).ok);
  check('a form refuses while in hitstun',
    canTransform({ ...f, hitstun: .4 }).reason === 'locked');
  check('a form refuses while cooling down', canTransform({ ...f, transformCooldown: 2 }).reason === 'cooldown');

  const result = beginTransform(f);
  check('a ready form activates', result.ok === true);
  check('activating spends power exactly once',
    Math.abs(f.power - (100 - MOVESETS.goku.form.cost)) < 1e-6, String(f.power));
  check('the form applies its real stat mods', f.incomingDamage === MOVESETS.goku.form.mods.defense
    && f.transformMods.damage === MOVESETS.goku.form.mods.damage, JSON.stringify(f.transformMods));
  check('the form swaps the signature move for its empowered version',
    f.specialProfile.label === MOVESETS.goku.form.special.label);
  check('a second activation is refused while the form is up',
    beginTransform(f).reason === 'active' && f.power === 100 - MOVESETS.goku.form.cost);
  check('the form begins as a charge, not a landed power-up',
    f.transform.landed === false && f.transform.charge === FORM.charge, String(f.transform.charge));
  check('the form timer does not run during the charge',
    f.transform.time === MOVESETS.goku.form.duration, String(f.transform.time));
  tickTransform(f, .1);
  check('charging does not spend form duration',
    f.transform && f.transform.landed === false && f.transform.time === MOVESETS.goku.form.duration,
    JSON.stringify({ landed: f.transform?.landed, time: f.transform?.time }));
  tickTransform(f, FORM.charge);
  check('the form lands when its charge completes',
    f.transform?.landed === true && f.transform.charge === 0);
  check('the duration starts when the form lands',
    f.transform.time < MOVESETS.goku.form.duration, String(f.transform.time));
  check('the HUD snapshot reports the remaining time', transformState(f).active
    && transformState(f).remaining > 0);

  // Drain ends the form early and restores everything.
  f.power = .05;
  tickTransform(f, .1);
  check('a drained form ends', f.transform === null);
  check('ending a form restores incoming damage and the base move',
    f.incomingDamage === 1 && f.transformMods === null && f.specialProfile.label === 'KAMEHAMEHA');
  check('ending a form starts its cooldown', f.transformCooldown > 0);

  // The HUD has to price the tier the next press actually enters. With a ladder, the base
  // entry's cost is not the cost of the second form: Goku's bar used to read 117% at 47 power
  // because it kept dividing by Super Saiyan's 40.
  const tier = fakeFighter({ formStage: 1, power: 50 });
  const tierState = transformState(tier);
  check('the HUD advertises the next tier, not the base entry',
    tierState.cost === MOVESETS.goku.forms[1].cost && tierState.duration === MOVESETS.goku.forms[1].duration,
    JSON.stringify({ cost: tierState.cost, duration: tierState.duration }));
  check('power below the next tier price is not ready',
    tierState.ready === false && tierState.reason === 'not-ready');
  tier.power = MOVESETS.goku.forms[1].cost;
  check('the next tier becomes ready at its own price', canTransform(tier).ok);

  const g = fakeFighter({ power: 0 });
  // Fill through the clamping API: assigning 200 directly bypassed the only code that enforces
  // the maximum, which is why this assertion used to pass on the old form's drain by accident.
  gainPower(g, 200);
  check('power is clamped at the maximum when it is earned', g.power === POWER.max, String(g.power));
  beginTransform(g);
  // Past this form's own duration, but before the post-form cooldown can elapse. The duration is
  // read from the moveset: hardcoding one fighter's seconds made this fail the moment a form's
  // duration was legitimately retuned, while proving nothing extra about the expiry path.
  const expiryFrames = Math.ceil(60 * (FORM.charge + (MOVESETS.goku.form.duration || 8) + 1));
  for (let i = 0; i < expiryFrames; i++) tickTransform(g, 1 / 60);
  check('a form expires on its own duration', g.transform === null && g.transformCooldown > 0);
  check('power is clamped to its maximum', g.power <= POWER.max + 1e-6, String(g.power));
  check('power is earned from damage in both directions',
    powerFromDamage(10) > 0 && powerFromDamage(10, { taken: true }) > 0
    && powerFromDamage(0, { guarded: true }) > 0);
  check('a solid hit is a real step toward a form', powerFromDamage(10) >= 8,
    String(powerFromDamage(10)));
  check('power fills at ultimate-like speed',
    powerFromDamage(10) >= meterFromDamage(10) * .8,
    `${powerFromDamage(10)} vs ${meterFromDamage(10)}`);
}

// ---- ultimate meter and runner (no DOM) ----------------------------------------
{
  check('the meter fills from damage dealt', meterFromDamage(20) > meterFromDamage(5));
  check('taking damage builds meter too', meterFromDamage(20, { taken: true }) > 0);
  check('a full ultimate is 100 meter', ULTIMATE.max === 100);

  const target = fakeFighter({ identityKey: 'vegeta', moveset: MOVESETS.vegeta });
  const owner = fakeFighter({ ultimateDef: ultimateFor(fakeFighter()), meter: 100 });
  owner.position = fakeVec(0, .6, 0);

  let hitCount = 0;
  const ctx = testContext({
    fighters: () => [owner, target],
    hit: () => { hitCount++; return true; }
  });
  const empty = startUltimate(fakeFighter({ meter: 0 }), ctx);
  check('an empty meter refuses to cast', empty.ok === false && empty.reason === 'not-ready');

  // A behaviour test needs real three.js vectors; run those in the browser below. Here we only
  // assert the gate and the meter accounting, which are pure.
  const spent = startUltimate(owner, ctx);
  check('casting spends the whole meter', owner.meter === 0 && spent?.owner === owner);
  check('a second cast is refused while the first is running', canUltimate(owner).ok === false);
  clearUltimates(ctx, 'test');
  check('clearing cancels the active ultimate and releases the caster',
    owner.casting === null);
  check('casting is impossible while stunned',
    canUltimate({ ...fakeFighter(), meter: 100, hitstun: .5, ultimateDef: ultimateFor(fakeFighter()) }).ok === false);
  check('casting is impossible while grabbed',
    canUltimate({ ...fakeFighter(), meter: 100, grabbedBy: {}, ultimateDef: ultimateFor(fakeFighter()) }).ok === false);
  void hitCount;
  void canCast;
}

// ---- transformed ultimate variant ---------------------------------------------
{
  const base = fakeFighter();
  const plain = ultimateFor(base);
  const formed = { ...base, transform: { form: MOVESETS.goku.form } };
  const powered = ultimateFor(formed);
  check('a transformed fighter casts its empowered ultimate',
    powered.label !== plain.label && powered.damage > plain.damage,
    `${plain.damage} -> ${powered.damage}`);
  check('the empowered ultimate uses the form colour', powered.color === MOVESETS.goku.form.color);
}

// ---- live game -----------------------------------------------------------------
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack || String(error)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: await readFile(localPath) });
    } catch {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  // Projectiles are advanced by the render loop, not by the fixed simulation step, so a shot
  // has to be watched across real animation frames.
  const frames = count => page.evaluate(n => new Promise(done => {
    let i = 0;
    const tick = () => { if (++i >= n) return done(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), count);
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.__browserSmashPowers
    && window.fighters?.length === 2,
  null, { timeout: 120_000, polling: 200 });

  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Goku');
    window.__browserSmashSelect?.select('p2', 'Vegeta');
    document.querySelector('#play').click();
  });
  await step(.6);

  // ---- HUD ---------------------------------------------------------------------
  const hud = await page.evaluate(() => {
    const wrap = document.getElementById('p1power');
    return {
      exists: !!wrap,
      rows: wrap ? [...wrap.querySelectorAll('[data-row]')].map(row => row.dataset.row) : [],
      labels: wrap ? wrap.textContent : ''
    };
  });
  check('the HUD shows an ultimate meter and a form gauge', hud.exists
    && hud.rows.includes('ult') && hud.rows.includes('form'), JSON.stringify(hud.rows));
  check('the HUD names both resources', /ULT/.test(hud.labels) && /FORM/.test(hud.labels));

  // ---- snapshot + label wiring --------------------------------------------------
  const snapshot = await page.evaluate(() => window.__browserSmashPowers());
  check('both fighters report their own move data',
    snapshot.p1.ultimateLabel === MOVESETS.goku.ultimate.label
    && snapshot.p2.ultimateLabel === MOVESETS.vegeta.ultimate.label,
    JSON.stringify({ p1: snapshot.p1.ultimateLabel, p2: snapshot.p2.ultimateLabel }));
  check('an empty meter is not ready', snapshot.p1.ultimateReady === false && snapshot.p1.meter === 0);
  check('the form is reported with its cost', snapshot.p1.formLabel === MOVESETS.goku.form.label
    && snapshot.p1.powerCost === MOVESETS.goku.form.cost);

  // ---- keyboard and gamepad ------------------------------------------------------
  const bindings = await page.evaluate(() => {
    const input = window.__browserSmashInput;
    const press = code => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    };
    input.buffers[1].clear(); input.buffers[2].clear();
    press('KeyI');
    const p1Transform = input.getInputs(1).transform;
    press('KeyO');
    const p1Ultimate = input.getInputs(1).ultimate;
    const p1Cross = input.getInputs(2).transform;
    press('KeyN');
    const p2Transform = input.getInputs(2).transform;
    press('KeyM');
    const p2Ultimate = input.getInputs(2).ultimate;
    // Fake pad: D-pad up (12) transforms, D-pad down (13) casts.
    const original = navigator.getGamepads;
    navigator.getGamepads = () => [{ axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 12 })) }];
    const padTransform = input.getInputs(1).transform;
    navigator.getGamepads = () => [{ axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 13 })) }];
    const padUltimate = input.getInputs(1).ultimate;
    navigator.getGamepads = original;
    return { p1Transform, p1Ultimate, p1Cross, p2Transform, p2Ultimate, padTransform, padUltimate };
  });
  check('I casts the transformation for player one', bindings.p1Transform === true);
  check('O casts the ultimate for player one', bindings.p1Ultimate === true);
  check('player one keys do not leak into player two', bindings.p1Cross === false);
  check('N and M are player two transform and ultimate',
    bindings.p2Transform === true && bindings.p2Ultimate === true);
  check('the gamepad D-pad binds transform and ultimate',
    bindings.padTransform === true && bindings.padUltimate === true);

  // ---- transformation end to end -------------------------------------------------
  const formed = await page.evaluate(() => {
    const api = window.__browserSmashPowersApi();
    const [p, c] = window.fighters;
    window.__browserSmashTrainingDummy = true;
    p.power = 100; p.hitstun = 0; p.percent = 0; c.percent = 0;
    p.position.set(0, .6, 0); c.position.set(3, .6, 0);
    p.velocity.set(0, 0, 0); c.velocity.set(0, 0, 0);
    p.facing = 1; p.facingZ = 0;
    const baseSpecial = p.specialProfile.label;
    const result = api.tryTransform(p);
    return {
      ok: result.ok, baseSpecial, special: p.specialProfile.label,
      incoming: p.incomingDamage, damage: p.transformMods?.damage,
      aura: !!p.aura, auraName: p.aura?.name || '',
      snapshot: api.snapshot(p)
    };
  });
  check('the in-game form activates for a real fighter', formed.ok === true && formed.aura);
  check('the form changes real combat numbers', formed.incoming === MOVESETS.goku.form.mods.defense
    && formed.damage === MOVESETS.goku.form.mods.damage, JSON.stringify({ i: formed.incoming, d: formed.damage }));
  check('the form swaps in the empowered signature move',
    formed.special !== formed.baseSpecial && formed.special === MOVESETS.goku.form.special.label,
    `${formed.baseSpecial} -> ${formed.special}`);
  check('the aura is that character form, not a shared one', formed.auraName.includes(MOVESETS.goku.form.id),
    formed.auraName);
  check('the HUD snapshot counts the form down', formed.snapshot.formActive === true
    && formed.snapshot.formRemaining > 0);

  const damageBefore = await page.evaluate(() => {
    const [p, c] = window.fighters;
    p.position.set(0, .6, 0); c.position.set(3, .6, 0);
    p.velocity.set(0, 0, 0); c.velocity.set(0, 0, 0);
    p.facing = 1; p.facingZ = 0; c.facing = -1; c.facingZ = 0;
    p.hitstun = 0; c.hitstun = 0;
    // A clean signature hit while transformed, resolved through the live projectile pipeline.
    window.spawnProjectile(p, { source: 'special', ...p.specialProfile });
    return { before: c.percent, shots: window.__browserSmashProjectiles().length };
  });
  // Bounded poll on real frames: projectiles are advanced by the render loop, so a synchronous
  // step burst measured a beam that had not travelled yet and blamed the move.
  await page.waitForFunction(base => window.fighters[1].percent > base, damageBefore.before,
    { timeout: 5000 }).catch(() => {});
  const damageInForm = await page.evaluate(({ before, shots }) => ({
    before, shots, after: window.fighters[1].percent
  }), damageBefore);
  check('the empowered signature deals damage through the normal pipeline',
    damageInForm.after > damageInForm.before, JSON.stringify(damageInForm));

  const expired = await page.evaluate(() => {
    const [p] = window.fighters;
    // Step until the form actually ends and read the cooldown on that frame. A fixed 12 s loop
    // also ticks the cooldown down, so a 7.6 s cooldown read back as 0 and the check failed for a
    // reason unrelated to the end-of-form path.
    let frames = 0;
    while (p.transform && frames < 60 * 25) { window.__browserSmashStep(1 / 60); frames += 1; }
    return {
      transform: p.transform, incoming: p.incomingDamage, aura: p.aura,
      special: p.specialProfile.label, cooldown: p.transformCooldown, frames
    };
  });
  check('the form ends on its own timer', expired.transform === null);
  check('ending the form restores the base move and defences',
    expired.incoming === 1 && expired.aura === null && expired.special === 'KAMEHAMEHA',
    JSON.stringify(expired));
  check('the form goes on cooldown after it ends', expired.cooldown > 0);

  // ---- ultimate end to end -------------------------------------------------------
  const cast = await page.evaluate(() => {
    const api = window.__browserSmashPowersApi();
    const [p, c] = window.fighters;
    p.transform = null; p.incomingDamage = 1; p.transformCooldown = 0;
    p.position.set(0, .6, 0); c.position.set(5, .6, 0);
    p.velocity.set(0, 0, 0); c.velocity.set(0, 0, 0);
    p.facing = 1; p.facingZ = 0; c.facing = -1; c.facingZ = 0;
    p.hitstun = 0; c.hitstun = 0; c.percent = 0; p.percent = 0;
    p.meter = 100;
    const record = window.__browserSmashTryUltimate('p1');
    return {
      started: !!record?.owner, meter: p.meter, casting: p.casting,
      label: record?.label, behaviour: record?.def?.behaviour,
      doubleCast: window.__browserSmashTryUltimate('p1')
    };
  });
  check('a full meter casts the character\'s own ultimate',
    cast.started && cast.label === MOVESETS.goku.ultimate.label, JSON.stringify(cast.label));
  check('casting spends the meter exactly once', cast.meter === 0);
  check('the caster is locked into the move', cast.casting === 'ultimate');
  check('a repeated cast cannot run twice',
    cast.doubleCast?.ok === false && cast.doubleCast?.reason === 'active', JSON.stringify(cast.doubleCast));

  const landed = await page.evaluate(() => {
    const [p, c] = window.fighters;
    const before = c.percent;
    // Goku's beam runs 0.72 startup + 0.85 active + 0.70 recovery; watch past the whole move.
    for (let i = 0; i < 220; i++) window.__browserSmashStep(1 / 60);
    return {
      before, after: c.percent, casting: p.casting, meter: p.meter,
      record: !!window.combatPowers && window.__browserSmashPowers().p1.casting
    };
  });
  check('the ultimate lands real damage on the opponent', landed.after > landed.before,
    JSON.stringify(landed));
  check('the caster regains control when the move ends', landed.casting === null);

  // Interruption: a hit during startup refunds the meter, and nothing is left running.
  const interrupted = await page.evaluate(() => {
    const api = window.__browserSmashPowersApi();
    const [p, c] = window.fighters;
    c.percent = 0; p.percent = 0; p.hitstun = 0; p.meter = 100;
    p.position.set(0, .6, 0); c.position.set(9, .6, 0);   // out of lane reach? no: interrupt first
    const record = api.tryUltimate(p);
    const started = !!record?.owner;
    p.hitstun = .35;                                      // a clean hit lands during startup
    window.__browserSmashStep(1 / 60);
    return { started, meter: p.meter, casting: p.casting, damage: c.percent };
  });
  check('an interrupted ultimate refunds its meter', interrupted.started
    && interrupted.meter === 100 && interrupted.casting === null,
  JSON.stringify(interrupted));
  check('an interrupted ultimate deals no damage', interrupted.damage === 0);

  // ---- walls stop ultimates ------------------------------------------------------
  const walls = await page.evaluate(() => {
    const api = window.__browserSmashPowersApi();
    window.__browserSmashSelect.chooseArena('deathstar');
    const layout = window.__browserSmashLayout();
    const block = (layout.blocks || []).find(b => b.top >= 3 && !b.r);
    if (!block) return { found: false };
    const midZ = (block.z0 + block.z1) / 2;
    const left = new window.__browserSmashThree.Vector3(block.x0 - 1.4, 1.4, midZ);
    const right = new window.__browserSmashThree.Vector3(block.x1 + 1.4, 1.4, midZ);
    const [p, c] = window.fighters;
    p.position.set(left.x, .6, left.z); c.position.set(right.x, .6, right.z);
    p.percent = 0; c.percent = 0; c.invulnerable = 0;
    const covered = api.coverBetween(left, right);
    const landed = api.hit(p, c, { damage: 24, kbs: 120, launchY: 9, stun: .6, kind: 'ultimate' });
    return { found: true, covered, landed, percent: c.percent };
  });
  check('a solid wall is detected between the two fighters', walls.found && walls.covered === true,
    JSON.stringify(walls));
  check('an ultimate cannot damage through a wall', walls.landed === false && walls.percent === 0);

  // ---- presentation: hit-stop, evade feedback, honest beam art ------------------
  // Regression cover for the Phase 3 fixes: hit-stop used to fire only on heavy melee, an
  // invulnerable target swallowed the hit silently, and the beam was drawn far thinner than
  // the volume that actually damages.
  const feedback = await page.evaluate(() => {
    const api = window.__browserSmashPowersApi();
    window.__browserSmashSelect.chooseArena('valley');
    const [p, c] = window.fighters;
    let stops = 0;
    const callouts = [];
    const realStop = window.requestHitStop;
    const realCallout = window.showCombatCallout;
    window.requestHitStop = seconds => { stops++; realStop?.(seconds); };
    window.showCombatCallout = (text, colour) => { callouts.push(String(text)); realCallout?.(text, colour); };
    const place = () => {
      p.position.set(0, .6, 0); c.position.set(1.6, .6, 0);
      p.facing = 1; p.facingZ = 0; c.facing = -1; c.facingZ = 0;
      c.percent = 0; c.hitstun = 0; c.guardHeld = false; c.velocity.set(0, 0, 0);
    };
    place();
    c.invulnerable = 1;
    const evaded = api.hit(p, c, { damage: 22, kbs: 120, launchY: 8, stun: .5, kind: 'ultimate' });
    const evadedPercent = c.percent;
    const evadedStops = stops;
    const evadedSaid = callouts.some(text => /EVADED/.test(text));
    place();
    c.invulnerable = 0;
    const before = stops;
    const landed = api.hit(p, c, { damage: 22, kbs: 120, launchY: 8, stun: .5, kind: 'ultimate' });
    const landedStops = stops - before;
    const landedPercent = c.percent;
    window.requestHitStop = realStop;
    window.showCombatCallout = realCallout;
    return { evaded, evadedPercent, evadedStops, evadedSaid, landed, landedStops, landedPercent };
  });
  check('a hit voided by an invulnerability window deals no damage and reports EVADED',
    feedback.evaded === false && feedback.evadedPercent === 0 && feedback.evadedStops === 0
    && feedback.evadedSaid === true, JSON.stringify(feedback));
  check('a landed ultimate hit requests hit-stop exactly once',
    feedback.landed === true && feedback.landedStops === 1 && feedback.landedPercent > 0,
    JSON.stringify(feedback));

  const beamArt = await page.evaluate(() => {
    const api = window.__browserSmashPowersApi();
    window.__browserSmashSelect.select('p1', 'Goku');
    const p = window.fighters[0];
    p.meter = 100; p.hitstun = 0; p.ko = false; p.grabbedBy = null; p.power = 100;
    const record = api.tryUltimate(p);
    const beam = record.visuals.find(v => v.kind === 'beam');
    const aim = record.visuals.find(v => v.kind === 'aim');
    let aimVisibleDuringStartup = false;
    let aimPeakOpacity = 0;
    let beamVisibleDuringStartup = false;
    const startupFrames = Math.floor(record.startup * 60);
    for (let i = 0; i < startupFrames; i++) {
      api.update(1 / 60);
      if (aim.mesh.visible) aimVisibleDuringStartup = true;
      aimPeakOpacity = Math.max(aimPeakOpacity, aim.mesh.material.opacity);
      if (beam.mesh.visible) beamVisibleDuringStartup = true;
    }
    // A beam fires at `startup + active * .42` (see planEvents), so six frames past the startup
    // boundary is still before the shot exists and would read as an invisible beam. Advance to the
    // fire moment itself; the drawing rules under test are unchanged.
    const fireFrames = Math.max(startupFrames + 1, Math.ceil((record.startup + record.active * .42) * 60) + 2);
    for (let i = startupFrames; i < fireFrames; i++) api.update(1 / 60);
    const beamVisibleWhenActive = beam.mesh.visible;
    const aimHiddenWhenActive = aim.mesh.visible === false;
    const radius = beam.mesh.geometry.parameters.radiusTop;
    const width = record.def.width;
    api.clear('test');
    return { radius, width, aimVisibleDuringStartup, aimPeakOpacity,
      beamVisibleDuringStartup, beamVisibleWhenActive, aimHiddenWhenActive };
  });
  check('a beam ultimate is drawn as wide as the volume that damages',
    Math.abs(beamArt.radius - beamArt.width * .42) < .01, JSON.stringify(beamArt));
  check('a beam ultimate telegraphs its lane during startup, then fires',
    beamArt.aimVisibleDuringStartup === true && beamArt.aimPeakOpacity > .3
    && beamArt.beamVisibleDuringStartup === false && beamArt.beamVisibleWhenActive === true
    && beamArt.aimHiddenWhenActive === true, JSON.stringify(beamArt));

  // The HUD has to say the form is running, not just leave a gauge half-full.
  const formHud = await page.evaluate(() => {
    const api = window.__browserSmashPowersApi();
    const p = window.fighters[0];
    p.power = 100; p.hitstun = 0; p.transformCooldown = 0; p.transform = null;
    const started = api.tryTransform(p).ok;
    api.drawHud([['p1', p], ['p2', window.fighters[1]]]);
    const row = document.getElementById('p1power');
    const label = row?.querySelector('[data-row="form"] .lab')?.textContent;
    const marked = row?.classList.contains('form-on');
    api.resetFighter(p);
    api.drawHud([['p1', p], ['p2', window.fighters[1]]]);
    const cleared = !row?.classList.contains('form-on');
    return { started, label, marked, cleared };
  });
  check('the HUD marks an active form and clears it afterwards',
    formHud.started === true && formHud.marked === true && formHud.label === 'ON'
    && formHud.cleared === true, JSON.stringify(formHud));

  // ---- round reset clears everything --------------------------------------------
  const reset = await page.evaluate(() => {
    const api = window.__browserSmashPowersApi();
    const [p, c] = window.fighters;
    window.__browserSmashSelect.chooseArena('valley');
    p.power = 100; p.meter = 60; p.hitstun = 0;
    api.tryTransform(p);
    const active = !!p.transform;
    window.__browserSmashSpawnFighters();
    return {
      active, transform: p.transform, aura: p.aura, casting: p.casting,
      meter: p.meter, power: p.power, snapshot: api.snapshot(p)
    };
  });
  check('a round reset ends an active form and removes its aura',
    reset.active === true && reset.transform === null && reset.aura === null);
  check('a round reset releases the caster and clears the form resource',
    reset.casting === null && reset.power === 0);
  check('a round reset keeps earned ultimate meter for the next round', reset.meter === 60);
  check('a rematch clears the meter as well',
    await page.evaluate(() => {
      const api = window.__browserSmashPowersApi();
      const [p] = window.fighters;
      p.meter = 80;
      api.resetFighter(p, { keepMeter: false });
      return p.meter === 0;
    }));

  // ---- every fighter can actually be selected, formed and cast -------------------
  const sweep = await page.evaluate(names => {
    const api = window.__browserSmashPowersApi();
    const results = [];
    for (const name of names) {
      window.__browserSmashSelect.select('p1', name);
      const p = window.fighters[0];
      const set = p.moveset;
      p.hitstun = 0; p.ko = false; p.grabbedBy = null; p.transform = null;
      p.transformCooldown = 0; p.power = 100; p.meter = 100;
      const formless = !!set?.formless;
      const formResult = api.tryTransform(p);
      const formOk = formless ? !formResult.ok : formResult.ok;
      const formLabel = p.transform?.label || '';
      api.resetFighter(p, { keepMeter: false });
      p.meter = 100; p.hitstun = 0;
      const record = api.tryUltimate(p);
      const castOk = !!record?.owner;
      api.clear('test');
      results.push({
        name, formless, moveLabels: set?.lights?.length || 0, formOk, formLabel, castOk,
        ult: record?.label || set?.ultimate?.label || ''
      });
    }
    return results;
  }, rosterNames);
  const failures = sweep.filter(row => (!row.formless && !row.formOk) || !row.castOk || row.moveLabels < 3);
  check(`all ${sweep.length} fighters cast, and every form-capable fighter forms, in the live game`,
    failures.length === 0, failures.map(f => f.name).join(', '));
  const formlessRows = sweep.filter(row => row.formless);
  check('the formless fighter refuses a transformation instead of borrowing one',
    formlessRows.length === 1 && formlessRows.every(row => row.formOk && row.formLabel === ''),
    formlessRows.map(row => row.name).join(', '));
  const formedRows = sweep.filter(row => !row.formless);
  const labels = formedRows.map(row => row.formLabel).filter(Boolean);
  check('every form-capable fighter forms into its own named state', new Set(labels).size === formedRows.length,
    `${new Set(labels).size}/${formedRows.length} distinct`);
  const ultimates = sweep.map(row => row.ult).filter(Boolean);
  check('every fighter casts its own named ultimate', new Set(ultimates).size === sweep.length,
    `${new Set(ultimates).size}/${sweep.length} distinct`);

  check('no page errors while driving forms and ultimates', pageErrors.length === 0,
    pageErrors.slice(0, 3).join('\n'));
} finally {
  await browser?.close();
  server.close();
}

console.log(`\n${checks} moveset checks passed`);
