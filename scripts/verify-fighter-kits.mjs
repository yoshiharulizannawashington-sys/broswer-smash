// The four character kits, proven in the running game.
//
//   bash scripts/run-browser-test.sh scripts/verify-fighter-kits.mjs
//
// Every check is read off the live simulation (percent, velocity, abilityLastCast, transform,
// moveset) or driven through the real keyboard / roster-select path. A kit entry that never casts,
// a clone that never strikes, or an ultimate that locks the round all fail here.
//
// The four characters are exercised inside ONE match and switched through the real P1 character
// select, which is also the roster-swap path that has to re-attach the right kit.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/fighter-kits';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 180)));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter]'), null, { timeout: 30000, polling: 200 });

const SLOT_KEYS = ['l', 'h', 't', 'y'];
// The four-kit sweep is long enough to risk the harness time cap on a software renderer, so a run
// can be scoped to one identity: KIT_ONLY=naruto_uzumaki. The default is all four.
const only = (process.env.KIT_ONLY || '').split(',').map(part => part.trim()).filter(Boolean);
const KITS = {
  'Naruto Uzumaki': { key: 'naruto_uzumaki', slots: ['SHADOW CLONE JUTSU', 'RASENGAN', 'GIANT RASENGAN', 'KUNAI THROW'], signature: 'RASENSHURIKEN', forms: ['SAGE MODE', 'NINE-TAILS CHAKRA MODE', 'KURAMA LINK MODE', 'SIX PATHS SAGE MODE', 'BARYON MODE'] },
  Superman: { key: 'superman', slots: ['FREEZE BREATH', 'SUPER STRENGTH', 'SUPER SPEED'], signature: 'HEAT VISION', forms: ['SOLAR OVERCHARGE'] },
  Goku: { key: 'goku', slots: ['KI BLAST', 'INSTANT TRANSMISSION', 'DRAGON FIST'], signature: 'KAMEHAMEHA', forms: ['SUPER SAIYAN', 'SUPER SAIYAN BLUE', 'ULTRA INSTINCT'] },
  'Spider-Man': { key: 'spider_man', slots: ['WEB SHOT', 'WEB PULL', 'WEB SWING STRIKE'], signature: 'WEB ZIP STRIKE', forms: ['SPIDER-SENSE OVERDRIVE'] }
};

/** Freeze the CPU, place both fighters, clear control state. */
async function stage(distance = 1.6) {
  await page.evaluate(d => {
    const [p1, p2] = window.fighters;
    const idle = { left: false, right: false, up: false, down: false, run: false, sprint: false, jump: false, attack: false, special: false, special2: false, special3: false, special4: false, special5: false, grab: false, dodge: false, shield: false, parry: false, ascend: false, descend: false, flightToggle: false, brake: false, webSwing: false, vertical: 0 };
    for (const fighter of [p1, p2]) {
      fighter.ko = false;
      fighter.hitstun = 0;
      fighter.guardBreak = 0;
      fighter.guardStun = 0;
      fighter.invulnerable = 0;
      fighter.attackPose = 0;
      fighter.attackQueue.length = 0;
      fighter.hitboxes.length = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.isGrounded = true;
      fighter.abilityReadyAt = {};
      fighter.abilityLastCast = null;
      fighter.percent = 0;
      fighter.meter = 0;
      fighter.power = 0;
    }
    // Only the CPU is frozen. P1 keeps the real input path: replacing its `simulate` with an
    // idle-input wrapper is what made every player attack in this harness whiff.
    if (!p2.__kitProbeSim) {
      p2.__kitProbeSim = p2.simulate.bind(p2);
      p2.simulate = dt => p2.__kitProbeSim(dt, { getInputs: () => ({ ...idle }) });
    }
    p1.position.set(-d / 2, 0, 0); p2.position.set(d / 2, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
  }, distance);
}

async function step(frames = 40) {
  await page.evaluate(n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); }, frames);
}

// Start the match on the first kit; the rest are reached through the real P1 roster select.
const order = Object.keys(KITS).filter(name => !only.length || only.includes(KITS[name].key));
await page.evaluate(n => {
  document.querySelector('#selectScreen [data-side="p1"]')?.click();
  document.querySelector(`#selectScreen [data-fighter="${n}"]`)?.click();
  document.querySelector('#play').click();
}, order[0]);
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 40000, polling: 200 });
await page.waitForTimeout(1500);

for (let index = 0; index < order.length; index += 1) {
  const name = order[index];
  const expected = KITS[name];
  console.log(`\n=== ${name}`);
  if (index > 0) {
    const swap = await page.evaluate(async target => {
      const select = document.querySelector('#p1Character');
      if (!select) return { skipped: true };
      select.value = target;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 350));
      const f = window.fighters[0];
      const ladder = (f.moveset?.forms?.length ? f.moveset.forms : [f.moveset?.form]).filter(Boolean);
      return { skipped: false, key: f.identityKey, moveset: f.moveset?.key || null, forms: ladder.map(x => x.label) };
    }, name);
    // This is the roster-swap requirement itself: the same fighter object must own the new kit.
    check(`${name}: roster swap re-attaches this identity's own moveset`,
      !swap.skipped && swap.moveset === expected.key && swap.key === expected.key, JSON.stringify(swap));
    check(`${name}: roster swap brings its own form ladder`,
      !swap.skipped && JSON.stringify(swap.forms.slice(0, expected.forms.length)) === JSON.stringify(expected.forms),
      JSON.stringify(swap.forms));
  }

  const assigned = await page.evaluate(() => {
    const f = window.fighters[0];
    return {
      identity: f.identity, key: f.identityKey, moveset: f.moveset?.key || null,
      signature: f.specialProfile?.label || null,
      forms: (f.moveset?.forms?.length ? f.moveset.forms : [f.moveset?.form]).filter(Boolean).map(form => form.label),
      ultimate: f.ultimateDef?.label || null
    };
  });
  check(`${name}: fighter owns its own moveset`, assigned.key === expected.key && assigned.moveset === expected.key,
    JSON.stringify({ identity: assigned.identity, key: assigned.key, moveset: assigned.moveset }));
  check(`${name}: signature is ${expected.signature}`, assigned.signature === expected.signature, String(assigned.signature));
  check(`${name}: form ladder is ${expected.forms.join(' / ')}`,
    JSON.stringify(assigned.forms.slice(0, expected.forms.length)) === JSON.stringify(expected.forms),
    JSON.stringify(assigned.forms));

  await page.waitForTimeout(600);
  const hud = await page.evaluate(() => (document.querySelector('#p1power')?.textContent || '').replace(/\s+/g, ' '));
  check(`${name}: in-match HUD names every kit slot`, expected.slots.every(label => hud.includes(label)),
    hud.slice(0, 200));

  // The kunai's animation is a separate clip-only GLB bound to the kit motion, so wait for that
  // load rather than casting into a body whose throw clip has not arrived yet.
  if (expected.key === 'naruto_uzumaki') {
    const imported = await page.waitForFunction(() => {
      const report = window.__browserSmashAssets?.importedAbilities?.naruto_uzumaki;
      return report?.status === 'ready' ? report : null;
    }, null, { timeout: 15000 }).then(handle => handle.jsonValue()).catch(() => null);
    check('Naruto: kunai throw clip is bound to the kit', Boolean(imported?.bound?.includes('kunai')),
      JSON.stringify(imported && { status: imported.status, bound: imported.bound, clips: imported.clips }));
  }

  // ---- basic attacks -----------------------------------------------------
  await stage(1.6);
  await page.keyboard.press('j');
  await step(36);
  const light = await page.evaluate(() => ({ percent: +window.fighters[1].percent.toFixed(2), pose: +(window.fighters[0].attackPose || 0).toFixed(2) }));
  check(`${name}: light attack executes and damages`, light.percent > 0, JSON.stringify(light));

  await stage(1.6);
  await page.keyboard.down('Shift');
  await page.keyboard.press('j');
  await page.keyboard.up('Shift');
  await step(44);
  const heavy = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));
  check(`${name}: heavy attack executes and damages`, heavy > 0, String(heavy));

  // ---- each kit slot: cast, damage, real cooldown -----------------------
  // Bounded polls rather than sleeps: the software renderer advances the render loop unevenly, so a
  // fixed wait sometimes read the frame BEFORE the cast and then blamed the kit for a whiff.
  for (let slot = 0; slot < expected.slots.length; slot += 1) {
    const label = expected.slots[slot];
    await stage(slot === 2 ? 3.6 : 3.2);
    const before = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));
    const priorStamp = await page.evaluate(() => window.fighters[0].abilityLastCast?.at || 0);
    await page.keyboard.press(SLOT_KEYS[slot]);
    // Detect the new cast and sample its cooldown in the SAME in-page poll. A separate evaluate
    // round trip after the poll could land a whole second later on a slow software frame and burn
    // most of a 1.9 s kunai cooldown before it was read, which looked like a missing cooldown.
    const castRead = await page.waitForFunction(probe => {
      const f = window.fighters[0];
      const last = f.abilityLastCast;
      if (!last || last.label !== probe.name) return null;
      if (probe.priorStamp && last.at === probe.priorStamp) return null;
      return {
        remaining: +((f.abilityReadyAt?.[probe.slotIndex] || 0) - performance.now() / 1000).toFixed(2)
      };
    }, { name: label, slotIndex: slot + 1, priorStamp }, { timeout: 6000 })
      .then(handle => handle.jsonValue()).catch(() => null);
    const executed = !!castRead;
    const readyIn = castRead?.remaining ?? 0;
    const damaged = await page.waitForFunction(
      base => window.fighters[1].percent > base,
      before, { timeout: 6000 }
    ).then(() => true).catch(() => false);
    const after = await page.evaluate(slotIndex => {
      const f = window.fighters[0];
      return {
        percent: +window.fighters[1].percent.toFixed(2),
        cast: f.abilityLastCast?.label || null,
        stamp: f.abilityLastCast?.at || 0
      };
    }, slot + 1);
    check(`${name}: ${label} executes on ${SLOT_KEYS[slot].toUpperCase()}`, executed, String(after.cast));
    check(`${name}: ${label} deals real damage`, damaged, `${before} -> ${after.percent}`);
    if (expected.key === 'naruto_uzumaki' && label === 'KUNAI THROW') {
      // Proof the body plays this move's own authored clip, not a reused strike: the kit path sets
      // `authoredAbilityAction` from `abilityCast.motion` on the frame the cast resolves.
      const thrown = await page.waitForFunction(() => {
        const action = window.fighters[0].model?.userData?.authoredAbilityAction;
        const live = action && (action.isRunning?.() || (action.enabled === true && (action.getEffectiveWeight?.() ?? 0) > 0.5));
        return live ? action.getClip().name : null;
      }, null, { timeout: 6000 }).then(handle => handle.jsonValue()).catch(() => null);
      check('Naruto: KUNAI THROW plays the authored throw clip', /kunai/i.test(thrown || ''), String(thrown));
    }

    // Read the cooldown the cast actually stamped. Re-pressing was timing-dependent: the input
    // buffer is frame-counted, so on a slow software renderer a buffered press could still be
    // consumed after a short cooldown had elapsed and read as a faulty second cast.
    check(`${name}: ${label} applies a real cooldown`, readyIn > 0.2,
      `${readyIn}s remaining on slot ${slot + 1}`);
  }

  // ---- the kunai's own authored clip, measured on the mounted skeleton ----
  // Playing a named action is not proof that the body moved: sample a hand bone through the throw
  // and require real displacement, the same standard the Infantry clips are held to.
  if (expected.key === 'naruto_uzumaki') {
    await stage(3.2);
    await page.keyboard.press('y');
    const throwProbe = await page.evaluate(() => new Promise(done => {
      const fighter = window.fighters[0];
      const model = fighter.model;
      // Sample every Rigify deform bone. The clip is authored on the DEF chain, and a single hand
      // bone can be a control the exported animation does not drive (ORG/MCH/tweak bones), which
      // reads as zero travel even while the body is visibly throwing. Any real deformation shows
      // up as displacement of at least one DEF bone.
      const bones = [];
      model?.traverse(node => { if (node.isBone && /^DEF-/.test(node.name)) bones.push(node); });
      if (!bones.length) return done({ error: 'no Rigify DEF bones on the mounted Naruto rig' });
      const started = performance.now();
      let clip = null, base = null, max = 0, peak = null, cast = null;
      const tick = () => {
        cast = fighter.abilityLastCast?.label || cast;
        const action = model.userData?.authoredAbilityAction;
        const live = action && (action.isRunning?.() || (action.enabled === true && (action.getEffectiveWeight?.() ?? 0) > 0.5));
        if (live) {
          clip = action.getClip().name;
          if (!base) base = bones.map(bone => { const point = bone.position.clone(); bone.getWorldPosition(point); return point; });
          bones.forEach((bone, index) => {
            const point = bone.position.clone();
            bone.getWorldPosition(point);
            const distance = point.distanceTo(base[index]);
            if (distance > max) { max = distance; peak = bone.name; }
          });
        }
        if (performance.now() - started < 1500) return requestAnimationFrame(tick);
        done({ clip, travel: +max.toFixed(3), peak, cast, bones: bones.length });
      };
      tick();
    }));
    check('Naruto: KUNAI THROW moves the mounted skeleton',
      /kunai/i.test(throwProbe.clip || '') && throwProbe.travel > 0.05, JSON.stringify(throwProbe));
  }

  // ---- range and facing -------------------------------------------------
  await stage(60);
  // Slot 3 is the committed one for every kit. Naruto's slot 4 is a long-range projectile by
  // design, so using "the last slot" here would test the kunai's reach, not a whiff.
  await page.keyboard.press(SLOT_KEYS[2]);
  await step(50);
  const far = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));
  check(`${name}: a committed kit slot whiffs at 60 m`, far === 0, String(far));

  await stage(1.6);
  await page.evaluate(() => { const [p1] = window.fighters; p1.facing = -1; p1.facingZ = 0; });
  await page.keyboard.press('j');
  await step(30);
  const backwards = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));
  check(`${name}: attacks facing away miss`, backwards === 0, String(backwards));

  // ---- form ladder: activate, change numbers, expire, restore ----------
  for (let stageIndex = 0; stageIndex < expected.forms.length; stageIndex += 1) {
    await stage(1.8);
    await page.evaluate(() => { const f = window.fighters[0]; f.power = 100; f.transformCooldown = 0; });
    await page.keyboard.press('i');
    await step(12);
    const formed = await page.evaluate(() => ({
      label: window.fighters[0].transform?.label || null,
      damage: window.fighters[0].transformMods?.damage ?? 1,
      defense: window.fighters[0].incomingDamage ?? 1,
      special: window.fighters[0].specialProfile?.label || null
    }));
    check(`${name}: form ${stageIndex + 1} is ${expected.forms[stageIndex]}`, formed.label === expected.forms[stageIndex], String(formed.label));
    check(`${name}: ${expected.forms[stageIndex]} changes real numbers`, formed.damage !== 1 || formed.defense !== 1,
      JSON.stringify({ damage: formed.damage, defense: formed.defense, special: formed.special }));

    await page.evaluate(() => { const f = window.fighters[0]; if (f.transform) f.transform.time = 0.02; });
    await step(24);
    const expired = await page.evaluate(() => ({
      active: Boolean(window.fighters[0].transform),
      damage: window.fighters[0].transformMods?.damage ?? 1,
      defense: window.fighters[0].incomingDamage ?? 1,
      signature: window.fighters[0].specialProfile?.label || null
    }));
    check(`${name}: ${expected.forms[stageIndex]} expires and restores the base kit`,
      !expired.active && expired.damage === 1 && expired.defense === 1 && expired.signature === expected.signature,
      JSON.stringify(expired));
  }

  // ---- ultimate ---------------------------------------------------------
  await stage(2.2);
  await page.evaluate(() => { const f = window.fighters[0]; f.meter = 100; f.transformCooldown = 0; });
  const ultimateLabel = await page.evaluate(() => window.fighters[0].ultimateDef?.label || null);
  await page.keyboard.press('o');
  await step(24);
  const casting = await page.evaluate(() => ({ casting: Boolean(window.fighters[0].casting), label: window.fighters[0].casting?.label || null }));
  check(`${name}: ultimate starts (${ultimateLabel})`, casting.casting, JSON.stringify(casting));
  await step(210);
  const resolved = await page.evaluate(() => ({
    percent: +window.fighters[1].percent.toFixed(2),
    casting: Boolean(window.fighters[0].casting),
    stuck: (window.fighters[0].attackQueue || []).some(a => a.ultimate)
  }));
  check(`${name}: ultimate deals real damage`, resolved.percent > 0, String(resolved.percent));
  check(`${name}: ultimate ends and releases the fighter`, !resolved.casting && !resolved.stuck, JSON.stringify(resolved));

  await page.screenshot({ path: `${out}/${expected.key}.png` }).catch(() => {});
}

// ---- reset must leave the last fighter with a working kit --------------
const afterReset = await page.evaluate(() => {
  const f = window.fighters[0];
  window.combatPowers?.clear?.('reset');
  window.combatPowers?.resetFighter?.(f, { keepMeter: false });
  return { key: f.identityKey, moveset: f.moveset?.key || null, power: f.power, meter: f.meter };
});
check('reset keeps the fighter on its own moveset and clears resources',
  afterReset.moveset === afterReset.key && afterReset.power === 0 && afterReset.meter === 0, JSON.stringify(afterReset));

check('no page errors during the four-kit run', errors.length === 0, errors.slice(0, 3).join(' | '));

const passed = checks.filter(c => c.ok).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
server.close();
process.exit(passed === checks.length ? 0 : 1);
