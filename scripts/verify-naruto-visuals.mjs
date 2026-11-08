// Naruto's authored clips, captured on the rendered rig, with the dispatch chain recorded from the
// same frame as each screenshot.
//
// A passing animation test only proves the system *selected* a clip. This records, per action:
// the input, whether the cast succeeded, the ability/signature id, the resolved motion slot, the
// clip actually driving the mixer with the highest weight, the cooldown stamp and the visible
// effect, plus a cropped frame of the body at the same instant. Anything the runtime cannot report
// is printed as unverified rather than assumed.
//
//   bash scripts/run-browser-test.sh scripts/verify-naruto-visuals.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/naruto-visuals';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1120, height: 760 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 260)));

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
  window.__browserSmashSelect?.chooseArena('valley');
  window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.evaluate(() => {
  const f = window.fighters[0], c = window.fighters[1];
  f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
  c.position.set(2.4, .6, 0);
  c.invulnerable = 999;
  window.smashCamera?.spectate?.({ fighter: f, framing: 'full', yaw: 55, pitch: 6 });
});
await page.locator('canvas').first().click({ position: { x: 240, y: 180 }, force: true });
await page.waitForTimeout(500);

const step = async (seconds = 0.4) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) await page.evaluate(dt => window.__browserSmashStep?.(dt), 0.05);
};
const reset = () => page.evaluate(() => {
  const f = window.fighters[0];
  f.power = 100; f.transformCooldown = 0; f.abilityReadyAt = {}; f.specialCooldown = 0;
  f.comboStep = 0; f.comboWindow = 0; f.attackQueue.length = 0; f.hitstun = 0; f.guardBreak = 0;
  f.abilityLastCast = null; f.abilityCast = null;
  if (f.transform) f.transform = null;
  // Earlier captures showed leftover Rasengan orbs on top of the Shadow Clone shot: the world
  // carries VFX between actions, so a clean frame has to clear it explicitly.
  const clear = list => { if (!Array.isArray(list)) return 0; let n = 0; for (const item of list) { item?.parent?.remove?.(item); n += 1; } list.length = 0; return n; };
  clear(window.shadowClones);
  clear(window.projectiles);
  clear(window.combatEffects);
  clear(window.orbitalEffects);
  const target = window.fighters[1];
  target.invulnerable = 999; target.percent = 0; target.hitstun = 0; target.ko = false;
  target.attackQueue.length = 0;
});

const snapshot = label => page.evaluate(name => {
  const f = window.fighters[0];
  window.__browserSmashAttackTick?.();
  f.model.updateMatrixWorld(true);
  const motion = window.__browserSmashAttackMotion?.()?.p1 || null;
  // The clip actually driving the rig: the controller's own report, not a guessed internal field.
  const described = (() => { try { return f.animationController?.describe?.() || null; } catch (error) { return { error: String(error?.message || error) }; } })();
  const clips = described?.active ? [{ clip: described.active, weight: described.weight ?? null, time: described.time ?? null }] : [];
  const seen = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node._actions)) {
      for (const action of node._actions) {
        const weight = typeof action.getEffectiveWeight === 'function' ? action.getEffectiveWeight() : action.weight;
        if ((weight || 0) > 0.001 && action.isRunning?.()) clips.push({ clip: action.getClip?.()?.name || '?', weight: +Number(weight).toFixed(3), time: +Number(action.time || 0).toFixed(2) });
      }
    }
    for (const key of ['mixer', 'animation', 'controller', 'anim', '_mixer']) {
      const value = node[key];
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(f);
  clips.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  return {
    action: name,
    input: f.lastInputName || null,
    abilityCast: f.abilityCast || null,
    abilityLastCast: f.abilityLastCast || null,
    specialCooldown: +(f.specialCooldown || 0).toFixed(2),
    abilityReadyAt: f.abilityReadyAt || null,
    attackPose: +(f.attackPose || 0).toFixed(2),
    motionPose: motion?.pose ?? null,
    motionSet: motion?.set ?? null,
    form: f.transform?.form?.id ?? f.transform?.label ?? null,
    controller: described,
    topClips: clips.slice(0, 3),
    cloneCount: Array.isArray(window.shadowClones) ? window.shadowClones.length : null,
    projectiles: Array.isArray(window.projectiles) ? window.projectiles.length : null,
    callout: String(document.body.innerText || '').split('\n').filter(Boolean).slice(-3).join(' / ').slice(-140)
  };
}, label);

const rows = [];
const shoot = async (name, keys, { hold = 0.4, combo = 0 } = {}) => {
  await reset();
  for (let i = 0; i < combo; i++) { await page.keyboard.press('j'); await step(0.12); }
  if (keys) { await page.keyboard.press(keys); }
  await step(hold);
  const record = await snapshot(name);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  const file = `${out}/naruto-${name}.png`;
  await page.screenshot({ path: file, clip: { x: 220, y: 60, width: 680, height: 660 } });
  rows.push({ ...record, file });
  console.log('ROW', name, JSON.stringify({ cast: record.abilityCast?.motion || null, last: record.abilityLastCast?.label || null, pose: record.motionPose, set: record.motionSet, top: record.topClips[0]?.clip || null, form: record.form }));
};

await shoot('light-combo-1', 'j');
await shoot('light-combo-3', null, { combo: 3 });
await shoot('heavy', null, { combo: 0 });
// The heavy is queued through the same resolver the key path uses; the harness cannot hold a
// modifier, so this records the queued move rather than a key press.
await page.evaluate(() => {
  const f = window.fighters[0];
  f.attackQueue.push({ id: 'heavy', kind: 'heavy', t: 4, total: 8, damage: 10, hit: false, active: 0 });
  window.__browserSmashAttackTick();
});
await step(0.2);
rows.push({ ...(await snapshot('heavy-queued')), file: null });
await page.screenshot({ path: `${out}/naruto-heavy-queued.png`, clip: { x: 220, y: 60, width: 680, height: 660 } });

await shoot('rasenshuriken', 'k');
await shoot('shadow-clone', 'l');
await shoot('rasengan', 'h');

const forms = [];
for (let stage = 1; stage <= 5; stage++) {
  await shoot(`form-${stage}`, 'i', { hold: 0.5 });
  const before = rows[rows.length - 1];
  await page.keyboard.press('k');
  await step(0.5);
  const record = await snapshot(`form-${stage}-signature`);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  const file = `${out}/naruto-form-${stage}-signature.png`;
  await page.screenshot({ path: file, clip: { x: 220, y: 60, width: 680, height: 660 } });
  rows.push({ ...record, file });
  forms.push({ stage, form: before.form, label: record.abilityLastCast?.label || record.callout, motion: record.motionSet, clip: record.topClips[0]?.clip || null });
  // End the transformation so the next key press starts the next stage from base form.
  await page.evaluate(() => { const f = window.fighters[0]; if (f.transform) f.transform.time = 0; });
  await step(0.3);
}
console.log('FORMS', JSON.stringify(forms));

const problems = [];
for (const row of rows) {
  if (/rasengan/.test(row.action) && !/rasengan/i.test(String(row.motionSet || row.abilityCast?.motion || ''))) problems.push(`${row.action}: motion slot is ${row.motionSet}`);
  if (/shadow-clone/.test(row.action) && row.abilityLastCast?.type !== 'clones') problems.push(`${row.action}: no clones cast`);
  if (/rasenshuriken/.test(row.action) && !(row.specialCooldown > 0)) problems.push(`${row.action}: no cooldown stamp`);
  if (/(form-\d)$/.test(row.action) && !row.form) problems.push(`${row.action}: no active form`);
  if (!row.topClips.length) problems.push(`${row.action}: no running clip visible to the probe`);
}
// ---- CPU attack coverage: sample the executing move, never the queue tail.
const CPU_MOVES = ['heavy', 'heavyLauncher', 'heavySlam', 'finisher', 'light1', 'aerialLight', 'airHeavy'];
const cpu = [];
for (const id of CPU_MOVES) {
  const row = await page.evaluate(moveId => {
    const c = window.fighters[1];
    c.attackQueue.length = 0;
    c.comboStep = moveId === 'finisher' ? 5 : 1;
    c.attackQueue.push({ id: moveId, kind: moveId.startsWith('heavy') ? (moveId === 'heavySlam' ? 'slam' : 'heavy') : 'melee', t: 4, total: 8, damage: 10, hit: false, active: 0 });
    window.__browserSmashAttackTick();
    c.model.updateMatrixWorld(true);
    const report = window.__browserSmashAttackMotion?.()?.p2 || null;
    return { requested: moveId, resolvedQueueHead: c.attackQueue[0]?.id ?? null, pose: report?.pose ?? null, set: report?.set ?? null, controller: (() => { try { return c.animationController?.describe?.() || null; } catch (e) { return null; } })() };
  }, id);
  cpu.push(row);
  console.log('CPU', JSON.stringify(row));
}
const cpuResolved = cpu.filter(row => row.pose !== null);
const cpuUnresolved = cpu.filter(row => row.pose === null).map(row => row.requested);

await writeFile(`${out}/naruto-visuals.json`, JSON.stringify({ generatedAt: new Date().toISOString(), rows, forms, problems, cpu, errors }, null, 2));
console.log('PROBLEMS', JSON.stringify(problems));
console.log('CPU_COVERAGE', JSON.stringify({ exercised: cpuResolved.map(r => `${r.requested}->${r.pose}`), unresolved: cpuUnresolved }));
console.log('ERRORS', errors.slice(0, 3));
console.log(`Captured ${rows.length} Naruto actions with dispatch records.`);
await browser.close();
server.close();
