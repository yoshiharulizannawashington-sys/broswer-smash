// Phase 29.5 — Wonder Woman grab-continuity pilot: baseline vs experiment, guard-during-chain, and
// the collateral checks that prove nothing else moved.
//
//   PHASE295_MODE=compare bash scripts/run-browser-test.sh scripts/audit-phase295.mjs
//   PHASE295_MODE=marks   bash scripts/run-browser-test.sh scripts/audit-phase295.mjs
//
// The experiment is opt-in through `public/js/combat/experiments.js`: with no flag, the shipped
// numbers are used. Every cell here records the flag it ran under, so a result can never be
// attributed to the wrong build.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
const frameDir = resolve(root, 'artifacts/dev/phase295');
await mkdir(outDir, { recursive: true });
await mkdir(frameDir, { recursive: true });
const MODE = process.env.PHASE295_MODE || 'compare';

const ultimateSource = readFileSync(resolve(root, 'public/js/combat/ultimate.js'), 'utf8');
const GATE = Number((ultimateSource.match(/const GRAB_GATE = ([0-9.]+)/) || [])[1]) || 5.2;
const DEFAULTS = new Function(`return ${ultimateSource.match(/const DEFAULTS = Object\.freeze\((\{[\s\S]*?\})\);/)[1]};`)();
const WW = DEFAULTS.grab && { damage: 20, hits: 3, kbs: 128, launchY: 10.4, range: 13, startup: .5, active: 1.05 };

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
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
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
  await page.evaluate(() => {
    const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_').replace(/^_|_$/g, '');
    window.__p295 = {
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
        window.combatPowers.clear('p295');
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
        window.__browserSmashHitTrace = [];
        window.__browserSmashGrabTrace = [];
        window.__browserSmashExperiments = {};
        window.__browserSmashStep(1 / 60);
      },
      // One cast, observed at the same fixed step as the game. `flags` is the experiment set.
      cast(input) {
        window.__p295.reset(input.gap);
        window.__browserSmashExperiments = { ...input.flags };
        const [p1, p2] = window.fighters;
        const keys = window.__browserSmashInput.keys;
        if (input.guard) keys.KeyE = true;
        p2.meter = 100;
        const rec = window.combatPowers.tryUltimate(p2);
        if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
        const shieldStart = p1.shield;
        let ticks = 0;
        for (; ticks < 400 && rec.phase !== 'done'; ticks++) {
          window.__browserSmashStep(1 / 60);
          if ((p1.percent || 0) > 149) p1.percent = 0;
        }
        const stunLeft = +(p1.hitstun || 0).toFixed(2);
        const guardHeldEnd = !!p1.guardHeld;
        for (const code of Object.keys(keys)) keys[code] = false;
        const hits = (window.__browserSmashHitTrace || []).filter(h => h.ultimate === rec.label);
        const grab = (window.__browserSmashGrabTrace || []).filter(g => g.label === rec.label);
        return {
          refused: false, label: rec.label, ticks,
          damage: +p1.percent.toFixed(2), hits: hits.map(h => ({ damage: h.damage, guarded: h.guarded })),
          grab, guardHeldEnd, stunLeft,
          shieldSpent: +(shieldStart - p1.shield).toFixed(2), endReason: rec.endReason || null
        };
      }
    };
  });
};
await openMatch();

const CONFIGS = [
  { name: 'baseline', flags: {} },
  { name: 'both', flags: { 'grab-continuity': true } },
  { name: 'knockback', flags: { 'grab-continuity-knockback': true } },
  { name: 'reassert', flags: { 'grab-continuity-reassert': true } }
];

if (MODE === 'compare') {
  const results = { kind: 'grab-continuity-pilot', generatedAt: new Date().toISOString(), gate: GATE,
    wonderWoman: WW, configs: CONFIGS.map(c => c.name), cells: [], collateral: [], guardChain: [], pageErrors };
  const distances = [{ name: 'point-blank', gap: 1.15 }, { name: '32%', gap: 4.2 },
    { name: '50%', gap: 6.5 }, { name: '60%', gap: 7.8 }];
  if (await page.evaluate(() => window.__p295.select('wonder_woman'))) {
    for (const distance of distances) {
      for (const config of CONFIGS) {
        const cell = await page.evaluate(input => window.__p295.cast(input), { gap: distance.gap, flags: config.flags });
        results.cells.push({ distance: distance.name, gap: distance.gap, config: config.name, ...cell });
        if (!cell.refused) {
          console.log('WW ' + distance.name + ' ' + config.name + ': ' + cell.damage + 'd '
            + cell.hits.length + ' hits gaps[' + cell.grab.map(g => g.gap).join(',') + ']'
            + ' reasserted=' + cell.grab.filter(g => g.reasserted).length);
        } else {
          console.log('WW ' + distance.name + ' ' + config.name + ': refused ' + cell.refused);
        }
        if (await page.evaluate(() => window.__browserSmashMatch().status) !== 'fighting') await openMatch();
      }
    }
    // Guard held from before the cast, through the whole chain: does the flag make guard live?
    for (const config of [CONFIGS[0], CONFIGS[1]]) {
      const cell = await page.evaluate(input => window.__p295.cast(input), { gap: 1.15, flags: config.flags, guard: true });
      results.guardChain.push({ config: config.name, ...cell });
      console.log('guard ' + config.name + ': damage ' + cell.damage + ' guarded='
        + cell.hits.map(h => h.guarded).join(',') + ' guardHeldAtEvents='
        + cell.grab.map(g => g.guardHeld).join(',') + ' stunLeft ' + cell.stunLeft);
    }
  }
  // Collateral: the other two grab fighters under the same flag, plus one non-grab ultimate.
  for (const id of ['spider_man', 'iron_spider']) {
    if (!await page.evaluate(id => window.__p295.select(id), id)) continue;
    for (const config of [CONFIGS[0], CONFIGS[1]]) {
      const cell = await page.evaluate(input => window.__p295.cast(input), { gap: 6.5, flags: config.flags });
      results.collateral.push({ fighter: id, config: config.name, ...cell });
      console.log('collateral ' + id + ' ' + config.name + ': ' + (cell.refused ? 'refused' : cell.damage + 'd'));
    }
  }
  if (await page.evaluate(() => window.__p295.select('green_lantern_hal_jordan'))) {
    for (const config of [CONFIGS[0], CONFIGS[1]]) {
      const cell = await page.evaluate(input => window.__p295.cast(input), { gap: 1.15, flags: config.flags });
      results.collateral.push({ fighter: 'green_lantern_hal_jordan', config: config.name, ...cell });
      console.log('collateral zone ' + config.name + ': ' + (cell.refused ? 'refused' : cell.damage + 'd'));
    }
  }
  await writeFile(resolve(outDir, 'grab-continuity-pilot-results.json'), JSON.stringify(results, null, 2));
  console.log('cells ' + results.cells.length + ', collateral ' + results.collateral.length);
}

if (MODE === 'marks') {
  const shots = [];
  for (const pick of [{ id: 'aquaman', label: 'storm' }, { id: 'lord_voldemort', label: 'zone' }]) {
    if (!await page.evaluate(id => window.__p295.select(id), pick.id)) continue;
    const setup = await page.evaluate(() => {
      window.__p295.reset(6);
      const [p1, p2] = window.fighters;
      p2.meter = 100;
      const rec = window.combatPowers.tryUltimate(p2);
      if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
      return { ok: true, startup: rec.startup, active: rec.active, total: rec.total,
        firstEventAt: rec.events[0].at, lastEventAt: rec.events[rec.events.length - 1].at, label: rec.label };
    });
    if (!setup.ok) { console.log(pick.id + ' refused'); continue; }
    // A frame every 0.1 s from cast to the end of recovery: dense enough to say whether the ring
    // survives the damaging window, which the 29.4 stills could not establish.
    const step = .1;
    const frames = Math.ceil(setup.total / step) + 1;
    for (let i = 0; i < frames; i++) {
      await page.evaluate(seconds => window.__browserSmashStep(seconds), step);
      const t = +((i + 1) * step).toFixed(2);
      const file = pick.label + '-t' + String(Math.round(t * 100)).padStart(3, '0') + '.png';
      await page.screenshot({ path: resolve(frameDir, file) });
      const visible = await page.evaluate(() => {
        const rec = (window.combatPowers.activeUltimates?.() || [])[0];
        return null;
      }).catch(() => null);
      shots.push({ behaviour: pick.label, t, phase: t < setup.startup ? 'startup'
        : t <= setup.startup + setup.active ? 'active' : 'recovery', file, ...visible });
    }
    console.log(pick.label + ': ' + frames + ' frames, first event ' + setup.firstEventAt
      + ', last ' + setup.lastEventAt + ', total ' + setup.total + ' — ' + setup.label);
    await page.evaluate(() => { for (const f of window.fighters) f.percent = 0; window.combatPowers.clear('marks'); });
    if (await page.evaluate(() => window.__browserSmashMatch().status) !== 'fighting') await openMatch();
  }
  await writeFile(resolve(outDir, 'mark-telegraph-frames.json'), JSON.stringify(
    { kind: 'mark-telegraph-frames', generatedAt: new Date().toISOString(), step: .1, shots, pageErrors }, null, 2));
  console.log('frames ' + shots.length);
}

// Frame-by-frame telegraph capture with the simulation frozen.
//
// The `marks` mode above is kept as a record of a failed approach: screenshots take real time while
// the live loop keeps simulating, so the match clock drifted and the ultimate had already ended.
// Pausing first removes that drift, and each frame also records the mark ring's own material state,
// so the answer does not depend on reading a 900 px image.
if (MODE === 'telegraph') {
  const rows = [];
  for (const pick of [{ id: 'aquaman', label: 'storm' }, { id: 'lord_voldemort', label: 'zone' }]) {
    if (!await page.evaluate(id => window.__p295.select(id), pick.id)) continue;
    const setup = await page.evaluate(() => {
      window.__p295.reset(6);
      window.__browserSmashPause.open();
      // The pause panel would cover the arena; the simulation stays frozen either way.
      document.querySelector('[aria-label="Match paused"]')?.remove();
      document.body.classList.remove('is-paused');
      const [p1, p2] = window.fighters;
      p2.meter = 100;
      const rec = window.combatPowers.tryUltimate(p2);
      if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
      return { ok: true, startup: rec.startup, active: rec.active, total: rec.total,
        firstEventAt: rec.events[0].at, lastEventAt: rec.events[rec.events.length - 1].at, label: rec.label };
    });
    if (!setup.ok) { console.log(pick.id + ' refused'); continue; }
    const frames = Math.floor(setup.total / .1) + 1;
    for (let i = 0; i < frames; i++) {
      const state = await page.evaluate(() => {
        for (let k = 0; k < 6; k++) window.__browserSmashStep(1 / 60);
        const scene = window.scene || window.__browserSmashAssets?.scene || null;
        let group = null;
        scene?.traverse?.(node => { if (!group && String(node.name || '').startsWith('ultimate:')) group = node; });
        const ring = group?.children?.find(c => c.geometry?.type === 'TorusGeometry') || null;
        const live = (window.combatPowers.activeUltimates?.() || [])[0] || null;
        return { sceneFound: !!scene, groupFound: !!group, ringFound: !!ring,
          ringVisible: ring ? ring.visible !== false : null,
          ringOpacity: ring ? +Number(ring.material?.opacity ?? 0).toFixed(3) : null,
          ringScale: ring ? +Number(ring.scale?.x ?? 0).toFixed(2) : null,
          phase: live?.phase || null, fired: live?.fired ?? null };
      });
      const t = +((i + 1) * .1).toFixed(2);
      const file = 'freeze-' + pick.label + '-t' + String(Math.round(t * 100)).padStart(3, '0') + '.png';
      await page.screenshot({ path: resolve(frameDir, file) });
      rows.push({ behaviour: pick.label, t, inActive: t >= setup.startup && t <= setup.startup + setup.active, file, ...state });
      if (i % 4 === 0 || (state.phase === 'recovery' && rows.filter(r => r.behaviour === pick.label).length < frames)) {
        console.log(pick.label + ' t' + t + ' ' + state.phase + ' fired=' + state.fired
          + ' ring=' + state.ringVisible + '/' + state.ringOpacity + 'x' + state.ringScale);
      }
    }
    await page.evaluate(() => { window.__browserSmashPause.close(); for (const f of window.fighters) f.percent = 0; window.combatPowers.clear('telegraph'); });
    console.log(pick.label + ' captured ' + frames + ' frames (events ' + setup.firstEventAt + '..' + setup.lastEventAt + ')');
  }
  await writeFile(resolve(outDir, 'mark-telegraph-freeze.json'), JSON.stringify(
    { kind: 'mark-telegraph-freeze', generatedAt: new Date().toISOString(), step: .1, frozen: true, rows, pageErrors }, null, 2));
  const markRows = rows.filter(r => r.ringFound);
  console.log('ring rows ' + markRows.length + '/' + rows.length
    + ' visible-in-active ' + markRows.filter(r => r.inActive && r.ringVisible).length
    + '/' + markRows.filter(r => r.inActive).length);
}

if (pageErrors.length) console.log('page errors: ' + JSON.stringify(pageErrors.slice(0, 5)));
await browser.close();
await new Promise(done => server.close(done));
