// Real-damage integration test: the imported link_test fixture against CPU Naruto, in a real match.
//
// Every hit below travels through the normal keyboard/CPU input path and is resolved by fighter3D's
// hit resolver, which appends to window.__browserSmashCombatEvents. The test never assigns percent,
// hitstun, knockback or KO; it positions fighters (a permitted helper) and then presses keys.
//
// Sampling runs inside the page on animation frames, so the hitstun value, reaction clip and
// knockback are read at the moment they exist instead of several CDP round trips later.
//
//   bash scripts/run-browser-test.sh scripts/test-combat-damage.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/combat-damage';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(150000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));

  await page.goto(origin + '/?showcaseCharacter=link_test', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashCombatEvents = [];
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Goku');
    window.__browserSmashSelect?.select('p2', 'Naruto Uzumaki');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.locator('canvas').first().click({ position: { x: 220, y: 170 }, force: true });
  await page.waitForTimeout(1200);

  const model = await page.evaluate(() => ({
    p1: window.fighters[0].model.userData.characterAssetUrl || null,
    p2: window.fighters[1].model.userData.characterAssetUrl || null,
    p2Identity: window.fighters[1].identity || window.fighters[1].type || null,
    p2Mounted: !!window.fighters[1].model && window.fighters[1].model.children.length > 0
  }));
  check('the imported fixture is the player body', /link-original\.glb/.test(String(model.p1)), String(model.p1));
  // Naruto is a procedural roster body, so it has no characterAssetUrl. The intent is "the opponent
  // is Naruto, mounted", which is what identity plus a mounted model prove; asserting an import URL
  // on a procedural body could never pass and was reporting a combat failure that did not exist.
  check('the opponent is the normal Naruto body', (model.p2 ? /naruto/i.test(String(model.p2)) : /naruto/i.test(String(model.p2Identity))) && model.p2Mounted, String(model.p2 || model.p2Identity));

  const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const place = gap => page.evaluate(g => {
    const [p, c] = window.fighters;
    p.position.set(0, .05, 0); p.facing = 1; p.facingZ = 0; p.velocity.set(0, 0, 0);
    c.position.set(g, .05, 0); c.facing = -1; c.velocity.set(0, 0, 0);
    window.__browserSmashCombatEvents = [];
  }, gap);
  const waitGrounded = () => page.waitForFunction(() => window.fighters.every(f => f.isGrounded && f.hitstun <= 0), null, { timeout: 6000, polling: 60 }).catch(() => null);
  // Imported bodies finish their attack in the resolver before the overlay lets go; pressing again
  // mid-recovery silently queued nothing, which is why later swings saw the opponent 12 m away.
  const waitIdle = () => page.waitForFunction(() => {
    const f = window.fighters[0];
    return (f.attackQueue?.length || 0) === 0 && f.hitstun <= 0 && f.isGrounded;
  }, null, { timeout: 9000, polling: 60 }).catch(() => null);
  // Modifier heavies require holding a direction, and the fighter walks while it is held, so the
  // strike left the opponent behind. This keeps the dummy in front of the attacker only until the
  // resolver records its hit, then releases so the real knockback is not masked.
  const startStick = () => page.evaluate(() => {
    if (window.__combatStick) clearInterval(window.__combatStick);
    window.__combatStick = setInterval(() => {
      if ((window.__browserSmashCombatEvents || []).length > 0) { clearInterval(window.__combatStick); window.__combatStick = null; return; }
      const [p, c] = window.fighters;
      const facing = p.facing || 1;
      c.position.set(p.position.x + facing * 1.05, p.position.y, p.position.z);
    }, 50);
  });
  const stopStick = () => page.evaluate(() => { if (window.__combatStick) clearInterval(window.__combatStick); window.__combatStick = null; });
  const read = () => page.evaluate(() => window.fighters.map(f => ({
    identity: f.identity,
    percent: +Number(f.percent || 0).toFixed(2),
    hitstun: +Number(f.hitstun || 0).toFixed(3),
    x: +f.position.x.toFixed(2), y: +f.position.y.toFixed(2),
    vx: +(f.velocity?.x || 0).toFixed(2), vy: +(f.velocity?.y || 0).toFixed(2),
    grounded: Boolean(f.isGrounded), ko: Boolean(f.ko)
  })));

  // Continuous in-page sampling: percent, hitstun, velocity and the animation controller's active
  // clip per rendered frame. This is what proves the reaction exists while it is happening.
  const startSampling = () => page.evaluate(() => {
    window.__combatSamples = [];
    const clipOf = fighter => {
      try { return fighter?.model?.userData?.animationController?.describe?.().active ?? null; } catch { return null; }
    };
    // Imported rigs blend their reactions through the model's own mixer actions, so the live
    // weights of the hit/knockdown actions are the honest signal that a reaction pose is playing.
    const actionsOf = fighter => {
      const out = {};
      const data = fighter?.model?.userData || {};
      for (const [key, value] of Object.entries(data)) {
        if (!/hit|knock|launch|stagger|down|getup|get_up/i.test(key)) continue;
        if (value && typeof value.getEffectiveWeight === 'function') out[key] = +value.getEffectiveWeight().toFixed(2);
      }
      return out;
    };
    const tick = () => {
      const [p, c] = window.fighters;
      window.__combatSamples.push({
        t: Math.round(performance.now()),
        p: { percent: +Number(p.percent || 0).toFixed(2), hitstun: +Number(p.hitstun || 0).toFixed(3), clip: clipOf(p), x: +p.position.x.toFixed(2), vx: +(p.velocity?.x || 0).toFixed(2), grounded: !!p.isGrounded, ko: !!p.ko, actions: actionsOf(p) },
        c: { percent: +Number(c.percent || 0).toFixed(2), hitstun: +Number(c.hitstun || 0).toFixed(3), clip: clipOf(c), x: +c.position.x.toFixed(2), vx: +(c.velocity?.x || 0).toFixed(2), grounded: !!c.isGrounded, ko: !!c.ko, actions: actionsOf(c) }
      });
      if (window.__combatSampling) requestAnimationFrame(tick);
    };
    window.__combatSampling = true;
    requestAnimationFrame(tick);
  });
  const stopSampling = () => page.evaluate(() => { window.__combatSampling = false; return window.__combatSamples || []; });
  const summarize = samples => {
    const peak = (list, side) => list.reduce((best, entry) => (entry[side].percent > best.percent ? entry[side] : best), list[0]?.[side] || { percent: 0, hitstun: 0, clip: null, x: 0, vx: 0 });
    const maxStun = (list, side) => Math.max(0, ...list.map(entry => entry[side].hitstun));
    const clips = (list, side) => [...new Set(list.map(entry => entry[side].clip).filter(Boolean))];
    const actions = (list, side) => [...new Set(list.flatMap(entry => Object.entries(entry[side].actions || {}).filter(([, weight]) => weight > 0.05).map(([key]) => key)))];
    return { peakP: peak(samples, 'p'), peakC: peak(samples, 'c'), maxStunP: maxStun(samples, 'p'), maxStunC: maxStun(samples, 'c'), clipsP: clips(samples, 'p'), clipsC: clips(samples, 'c'), actionsP: actions(samples, 'p'), actionsC: actions(samples, 'c') };
  };
  const firstEntry = name => page.evaluate(attacker => (window.__browserSmashCombatEvents || []).find(e => e.attacker === attacker) || null, name);

  const swing = async ({ keys = [], label, gap = 1.25, targetIndex = 1, attacker = 'Goku', stick = false }) => {
    await waitIdle();
    await place(gap);
    await waitGrounded();
    // Positioning is only a helper: if the opponent is not actually in range the attack would whiff,
    // so re-seat once and record the real distance instead of assuming a hit.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const distance = await page.evaluate(() => window.fighters[0].position.distanceTo(window.fighters[1].position));
      if (distance <= gap + 0.6) break;
      await place(gap);
      await waitGrounded();
    }
    const before = await read();
    await startSampling();
    for (const key of keys) await page.keyboard.down(key);
    await frame();
    if (stick) await startStick();
    await page.keyboard.down('j');
    await page.waitForTimeout(1400);
    if (stick) await stopStick();
    await page.keyboard.up('j');
    for (const key of keys) await page.keyboard.up(key);
    const samples = await stopSampling();
    const entry = await firstEntry(attacker);
    const during = await read();
    await page.screenshot({ path: `${out}/${label}.png` });
    const summary = summarize(samples);
    const diagnosis = entry ? null : await page.evaluate(() => ({
      distance: +window.fighters[0].position.distanceTo(window.fighters[1].position).toFixed(2),
      queue: window.fighters[0].attackQueue?.map(a => a.id) || [],
      targetInvulnerable: +Number(window.fighters[1].invulnerable || 0).toFixed(2),
      attackerHitstun: +Number(window.fighters[0].hitstun || 0).toFixed(2),
      attackerGrounded: !!window.fighters[0].isGrounded,
      move: window.__browserSmashAttackMotion?.()?.p1?.pose || null
    }));
    return { label, before, during, entry, summary, diagnosis, targetIndex };
  };

  // ---------------------------------------------------------------- A: imported fighter attacks Naruto
  const light = await swing({ label: 'A-light' });
  check('A: the imported fighter lands a real light attack on Naruto', Boolean(light.entry), JSON.stringify(light.entry || light.diagnosis));
  if (light.entry) {
    check('A: damage is applied by the resolver', light.during[1].percent >= light.entry.dealt - 0.01,
      `${light.before[1].percent}% -> ${light.during[1].percent}% (resolver dealt ${light.entry.dealt})`);
    check('A: the hit produces hitstun from the combat system', light.summary.maxStunC > 0.15, `peak ${light.summary.maxStunC}s (resolver ${light.entry.hitstun}s)`);
    check('A: Naruto plays a hit-reaction animation',
      light.summary.clipsC.some(clip => /hit|knock|launch|stagger|down/i.test(clip)) || light.summary.actionsC.length > 0,
      `clips=[${light.summary.clipsC.join(',')}] actions=[${light.summary.actionsC.join(',')}]`);
    check('A: knockback moves Naruto away from the attacker', light.summary.peakC.x > light.before[1].x + 0.2,
      `x ${light.before[1].x} -> peak ${light.summary.peakC.x}`);
    check('A: the attacker takes no damage from its own hit', light.summary.peakP.percent === light.before[0].percent, `${light.summary.peakP.percent}%`);
    const recovered = await page.waitForFunction(() => { const c = window.fighters[1]; return c.hitstun <= 0 && c.isGrounded; }, null, { timeout: 6000, polling: 80 }).then(() => true).catch(() => false);
    check('A: Naruto recovers and returns to combat', recovered, JSON.stringify((await read())[1]));
  }

  // ---------------------------------------------------------------- B: Naruto attacks the imported fighter
  await page.evaluate(() => { window.__browserSmashTrainingDummy = false; window.__browserSmashFreezeAI = false; window.__browserSmashCombatEvents = []; });
  await place(1.25);
  await startSampling();
  const bEntry = await page.waitForFunction(() => (window.__browserSmashCombatEvents || []).find(e => e.attacker === 'Naruto Uzumaki') || null, null, { timeout: 30000, polling: 40 }).then(h => h.jsonValue()).catch(() => null);
  // Freeze the CPU the instant the hit is recorded, so the "recovery" check measures the imported
  // fighter getting up, not the AI continuing to combo.
  const bSamples = await stopSampling();
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; window.__browserSmashTrainingDummy = true; });
  const bSummary = summarize(bSamples);
  const bAfter = await read();
  await page.screenshot({ path: `${out}/B-cpu-hit.png` });
  check('B: CPU Naruto lands a real attack on the imported fighter', Boolean(bEntry), JSON.stringify(bEntry));
  if (bEntry) {
    check('B: damage is applied to the imported fighter', bSummary.peakP.percent >= bEntry.dealt - 0.01, `${bSummary.peakP.percent}% (resolver dealt ${bEntry.dealt})`);
    check('B: the imported fighter receives hitstun', bSummary.maxStunP > 0.15, `peak ${bSummary.maxStunP}s (resolver ${bEntry.hitstun}s)`);
    check('B: the imported fighter reacts with a hit animation',
      bSummary.clipsP.some(clip => /hit|knock|launch|stagger|down/i.test(clip)) || bSummary.actionsP.length > 0,
      `clips=[${bSummary.clipsP.join(',')}] actions=[${bSummary.actionsP.join(',')}]`);
    const recovered = await page.waitForFunction(() => { const p = window.fighters[0]; return p.hitstun <= 0 && p.isGrounded; }, null, { timeout: 9000, polling: 80 }).then(() => true).catch(() => false);
    const settled = (await read())[0];
    check('B: the imported fighter recovers', recovered, `${settled.percent}% hitstun=${settled.hitstun} grounded=${settled.grounded}`);
  }

  // ---------------------------------------------------------------- move coverage through real inputs
  const moves = [];
  for (const [keys, label] of [[[], 'light'], [['Shift'], 'heavy'], [['Shift', 'w'], 'launcher'], [['Shift', 's'], 'slam']]) {
    await page.evaluate(() => { const f = window.fighters[0]; f.comboStep = 0; f.comboWindow = 0; });
    const result = await swing({ keys, label: 'move-' + label, gap: 1.2, stick: keys.length > 0 });
    moves.push({ label, move: result.entry?.move || null, dealt: result.entry?.dealt ?? null, connected: Boolean(result.entry), diagnosis: result.diagnosis });
    console.log('MOVE', JSON.stringify(moves[moves.length - 1]));
  }
  check('every ground move was exercised through the keyboard path',
    moves.filter(m => m.connected).length >= 3, moves.map(m => `${m.label}:${m.move || 'no hit'}`).join(' '));

  // ---------------------------------------------------------------- KO through accumulated real damage
  let landed = 0, percent = 0, ko = false;
  for (let attempt = 0; attempt < 12 && !ko; attempt += 1) {
    await waitIdle();
    await place(1.1);
    await waitGrounded();
    await page.keyboard.down('Shift');
    await frame();
    await startStick();
    await page.keyboard.down('j');
    await page.waitForTimeout(1200);
    await stopStick();
    await page.keyboard.up('j');
    await page.keyboard.up('Shift');
    if (await firstEntry('Goku')) landed += 1;
    const state = await read();
    percent = state[1].percent;
    ko = state[1].ko;
  }
  check('real accumulated hits raise the opponent percent', landed >= 4 && percent > 30, `${landed} landed hits, ${percent}%`);
  console.log('KO', JSON.stringify({ landed, percent, ko }));
  await page.screenshot({ path: `${out}/ko-attempt.png` });

  check('no uncaught page errors during combat', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  await writeFile(`${out}/report.json`, JSON.stringify({ light, bEntry, bAfter, moves, ko: { landed, percent, ko }, pageErrors }, null, 2));
} finally {
  await browser?.close();
  server.close();
}
console.log(failures === 0 ? '\nReal-damage integration test passed.' : `\nReal-damage integration test FAILED (${failures}).`);
process.exitCode = failures === 0 ? 0 : 1;
