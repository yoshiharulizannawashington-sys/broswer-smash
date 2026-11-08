// Are the five authored GLB stages explorable worlds or single combat stages?
//
// This measures the playable environment instead of inferring it from asset size:
//   · the playable rectangle the game actually clamps fighters into
//   · how far a fighter can walk along each axis before it stops (the invisible wall)
//   · what fraction of that rectangle is solid, i.e. how much of the visible map has collision
//   · whether the game pulls a fighter back when it is placed far outside the rectangle
//   · the flight ceiling inside a staged match
//   · what bounds apply in free-exploration mode
// It changes no gameplay code and writes artifacts/arena-exploration/audit.json.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/arena-exploration';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForTimeout(400);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(1200);

const ARENAS = ['asgard', 'hogwarts', 'deathstar', 'tournament', 'starktower'];
const results = [];

for (const key of ARENAS) {
  // The map select is what `effectiveLayout()` reads, so it has to change before the switch; calling
  // the apply hook alone left every measurement running against the previous arena's rectangle.
  await page.evaluate(k => {
    const select = document.querySelector('#mapSelect');
    const menu = document.querySelector('#menuMapSelect');
    if (menu) menu.value = k;
    if (select) { select.value = k; select.dispatchEvent(new Event('change')); }
    window.__browserSmashApplyMap(k);
  }, key);
  await page.waitForTimeout(900);
  const meta = await page.evaluate(() => {
    const layout = window.__browserSmashLayout();
    const selected = document.querySelector('#mapSelect')?.value || null;
    const b = layout.bounds;
    return {
      label: layout.label,
      kind: layout.kind || null,
      ringOut: Boolean(layout.ringOut),
      bounds: b,
      width: Math.round(b.x1 - b.x0),
      depth: Math.round(b.z1 - b.z0),
      area: Math.round((b.x1 - b.x0) * (b.z1 - b.z0)),
      ground: layout.ground,
      blocks: (layout.blocks || []).length,
      roamBounds: layout.roamBounds || null,
      arena: window.__browserSmashAssets?.authoredArena || null,
      spawn: layout.spawns?.[0] || null,
      spawnClear: (() => { const sp = layout.spawns?.[0]; return sp ? !window.__browserSmashSolidAt(sp.x, (sp.y ?? 0) + 1, sp.z) : false; })(),
      applyState: window.__browserSmashApplyMapState || null,
      selected
    };
  });
  if (meta.label === 'Final Valley' && key !== 'finalvalley') console.log('SWITCH-FAILED', key, JSON.stringify(meta.applyState));
  await page.screenshot({ path: `${out}/${key}.png` });

  // Walk each axis from the spawn with a real held key; the end point is where the fence stops him.
  const extents = {};
  for (const [code, axis] of [['d', '+x'], ['a', '-x'], ['s', '+z'], ['w', '-z']]) {
    await page.evaluate(() => {
      const f = window.fighters[0];
      const spawn = window.__browserSmashLayout().spawns[0];
      f.position.set(spawn.x, (spawn.y ?? 0) + 0.02, spawn.z);
      f.velocity.set(0, 0, 0); f.hitstun = 0; f.guardBreak = 0; f.isGrounded = true;
      f.attackQueue.length = 0; f.flightMode = false;
      const dummy = window.fighters[1];
      if (dummy) dummy.position.set(spawn.x + 2.5, spawn.y ?? 0, spawn.z + 2.5);
    });
    await page.keyboard.down(code);
    extents[axis] = await page.evaluate(() => {
      const f = window.fighters[0];
      // Long enough to actually reach the fence: 240 frames only covered ~24 m of walking.
      for (let i = 0; i < 960; i += 1) window.__browserSmashStep(1 / 60);
      return { x: +f.position.x.toFixed(1), z: +f.position.z.toFixed(1), y: +f.position.y.toFixed(1) };
    });
    await page.keyboard.up(code);
    // Where the walk ended tells you what stopped it: the playable rectangle's edge, or something else.
    const b = meta.bounds, pad = 0.9;
    const atEdge = (axis === '+x' && Math.abs(extents[axis].x - (b.x1 - pad)) < 2.2)
      || (axis === '-x' && Math.abs(extents[axis].x - (b.x0 + pad)) < 2.2)
      || (axis === '+z' && Math.abs(extents[axis].z - (b.z1 - pad)) < 2.2)
      || (axis === '-z' && Math.abs(extents[axis].z - (b.z0 + pad)) < 2.2);
    extents[axis].stoppedBy = atEdge ? 'stage-fence' : 'geometry-or-other';
  }

  // One long walk, sampled over time, so a mid-room stop can be read rather than guessed at.
  let trace = null;
  if (key === 'deathstar') {
    await page.evaluate(() => {
      const f = window.fighters[0];
      const spawn = window.__browserSmashLayout().spawns[0];
      f.position.set(spawn.x, (spawn.y ?? 0) + 0.02, spawn.z);
      f.velocity.set(0, 0, 0); f.hitstun = 0; f.guardBreak = 0; f.flightMode = false;
    });
    await page.keyboard.down('d');
    trace = await page.evaluate(() => {
      const f = window.fighters[0];
      const rows = [];
      for (let i = 0; i < 960; i += 1) {
        window.__browserSmashStep(1 / 60);
        if (i % 40 === 0) rows.push({ frame: i, x: +f.position.x.toFixed(1), z: +f.position.z.toFixed(1), y: +f.position.y.toFixed(1), grounded: Boolean(f.isGrounded), solidAhead: window.__browserSmashSolidAt(f.position.x + 0.8, f.position.y + 0.9, f.position.z) });
      }
      return rows;
    });
    await page.keyboard.up('d');
  }

  // Solid coverage: how much of the playable rectangle has collision at chest height.
  const coverage = await page.evaluate(() => {
    const b = window.__browserSmashLayout().bounds;
    let total = 0, solid = 0;
    for (let x = b.x0; x <= b.x1; x += 2) {
      for (let z = b.z0; z <= b.z1; z += 2) {
        total += 1;
        if (window.__browserSmashSolidAt(x, 1.1, z)) solid += 1;
      }
    }
    return { samples: total, solid, pct: +((100 * solid) / total).toFixed(1) };
  });

  // Fence test: drop the fighter far outside and see whether the game pulls him back.
  const fence = await page.evaluate(() => {
    const f = window.fighters[0];
    const b = window.__browserSmashLayout().bounds;
    const asked = { x: b.x1 + 40, z: (b.z0 + b.z1) / 2 };
    f.position.set(asked.x, 1, asked.z);
    f.velocity.set(0, 0, 0);
    window.__browserSmashStep(1 / 60);
    return { askedX: +asked.x.toFixed(1), endedX: +f.position.x.toFixed(1), pulledBack: f.position.x < asked.x - 1 };
  });

  // Flight ceiling inside the staged match.
  const ceiling = await page.evaluate(() => {
    const f = window.fighters[0];
    f.canFly = true; f.flightMode = true;
    f.position.set(0, 2, (window.__browserSmashLayout().bounds.z0 + window.__browserSmashLayout().bounds.z1) / 2);
    f.velocity.set(0, 0, 0);
    let peak = 0;
    for (let i = 0; i < 320; i += 1) { f.velocity.y = 12; window.__browserSmashStep(1 / 30); peak = Math.max(peak, f.position.y); }
    f.flightMode = false;
    return +peak.toFixed(1);
  });

  // Camera clearance: the staged camera must stay above the floor and out of collision.
  const camera = await page.evaluate(() => {
    const f = window.fighters[0];
    const layout = window.__browserSmashLayout();
    const sp = layout.spawns?.[0] || { x: 0, y: layout.ground ?? 0, z: 0 };
    f.position.set(sp.x, (sp.y ?? 0) + 0.02, sp.z);
    f.velocity.set(0, 0, 0);
    for (let i = 0; i < 50; i += 1) window.__browserSmashStep(1 / 60);
    const cam = window.smashCamera?.camera || window.camera || null;
    if (!cam?.position) return { available: false };
    const at = cam.position;
    return {
      available: true,
      x: +at.x.toFixed(1), y: +at.y.toFixed(1), z: +at.z.toFixed(1),
      aboveGround: at.y > (layout.ground ?? 0) + 0.4,
      insideSolid: Boolean(window.__browserSmashSolidAt(at.x, at.y, at.z)),
      grounded: f.isGrounded !== false,
      settledY: +f.position.y.toFixed(2),
      spawnY: +(sp.y ?? 0).toFixed(2)
    };
  });

  results.push({ key, ...meta, extents, coverage, fence, flightCeiling: ceiling, camera, trace });
  console.log('ARENA', key, JSON.stringify({ label: meta.label, selected: meta.selected, bounds: meta.bounds, blocks: meta.blocks, arena: meta.arena, coverage, fence, ceiling, extents }));
}

// Free exploration: what replaces the match rectangle on these authored stages?
const exploreButton = await page.evaluate(() => {
  const candidates = ['#explore', '[data-mode="exploration"]', '[data-entry="explore"]'];
  for (const selector of candidates) {
    const node = document.querySelector(selector);
    if (node) { node.click(); return selector; }
  }
  const button = [...document.querySelectorAll('button')].find(b => /free exploration|explore/i.test(b.textContent || ''));
  if (button) { button.click(); return 'text:' + (button.textContent || '').trim().slice(0, 30); }
  return null;
});
await page.waitForTimeout(1500);
const explorationState = await page.evaluate(sel => {
  const f = window.fighters[0];
  const layout = window.__browserSmashLayout();
  const before = f.position.clone?.() || { x: f.position.x, z: f.position.z };
  f.position.set(300, 1, 300);
  f.velocity.set(0, 0, 0);
  for (let i = 0; i < 4; i += 1) window.__browserSmashStep(1 / 60);
  return {
    clicked: sel,
    fighterBounds: f.bounds || null,
    roamBounds: layout.roamBounds || null,
    layout: layout.label,
    askedX: 300,
    endedX: +f.position.x.toFixed(1),
    endedZ: +f.position.z.toFixed(1),
    startedFrom: { x: +before.x.toFixed(1), z: +before.z.toFixed(1) }
  };
}, exploreButton);

// A stage is explorable when the player can move, the stage contains them, the spawn is usable,
// the camera is clear, and the authored map actually applied. These are regressions, not opinions:
// any failed check exits non-zero so a future map edit cannot silently break movement or framing.
function gateArena(arena) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
  add('map applied', arena.applyState?.ok !== false && (!arena.selected || arena.selected === arena.key),
    { selected: arena.selected, applyState: arena.applyState });
  add('fighter is contained', arena.fence?.pulledBack === true, arena.fence);
  add('spawn is clear of collision', arena.spawnClear === true, arena.spawn);
  const sp = arena.spawn || { x: 0, z: 0 };
  const travel = Object.fromEntries(Object.entries(arena.extents || {}).map(([axis, at]) => [axis, +Math.hypot(at.x - sp.x, at.z - sp.z).toFixed(1)]));
  const totalTravel = Object.values(travel).reduce((sum, value) => sum + value, 0);
  add('movement reaches the stage', totalTravel >= 12, { totalTravel, travel });
  add('stage floor supports the fighter', arena.camera?.available === true && arena.camera.grounded === true
    && Math.abs(arena.camera.settledY - arena.camera.spawnY) < 0.75, { coverage: arena.coverage, grounded: arena.camera?.grounded, settledY: arena.camera?.settledY, spawnY: arena.camera?.spawnY });
  add('flight has usable headroom', arena.flightCeiling >= 8, arena.flightCeiling);
  add('camera stays clear', arena.camera?.available === true && arena.camera.aboveGround === true && arena.camera.insideSolid === false, arena.camera);
  return { key: arena.key, label: arena.label, checks, ok: checks.every(c => c.ok) };
}
const gates = results.map(gateArena);
const globalChecks = [
  { name: 'all five authored stages measured', ok: new Set(results.map(r => r.key)).size === 5 && results.length === 5, detail: results.map(r => r.key) },
  { name: 'free exploration is bounded', ok: explorationState.endedX < explorationState.askedX - 1, detail: { askedX: explorationState.askedX, endedX: explorationState.endedX, endedZ: explorationState.endedZ } },
  { name: 'no page errors', ok: errors.length === 0, detail: errors }
];
const gateFailures = gates.flatMap(g => g.checks.filter(c => !c.ok).map(c => ({ arena: g.key, check: c.name, detail: c.detail })))
  .concat(globalChecks.filter(c => !c.ok).map(c => ({ arena: 'all', check: c.name, detail: c.detail })));
const gateSummary = { arenas: gates.length, checks: gates.reduce((n, g) => n + g.checks.length, 0) + globalChecks.length, failed: gateFailures.length };
const report = { arenas: results, exploration: explorationState, errors, gates: { summary: gateSummary, arenas: gates, global: globalChecks, failures: gateFailures } };
await writeFile(`${out}/audit.json`, JSON.stringify(report, null, 2));
console.log('EXPLORATION', JSON.stringify(explorationState));
console.log('ERRORS', errors.length);
console.log('EXPLORATION GATES', JSON.stringify(gateSummary), gateFailures.length ? JSON.stringify(gateFailures) : 'all checks passed');
if (gateFailures.length || errors.length) process.exitCode = 1;
await browser.close(); server.close();
