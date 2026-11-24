// Infantry melee acceptance: every named basic attack through the real keyboard path, against a
// live opponent whose decisions are frozen (it still takes damage, hitstun and knockback).
//
//   bash scripts/run-browser-test.sh scripts/accept-infantry-melee.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/infantry-melee';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(150000);
const errors = [];
const failedRequests = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(-70)}`); });

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 130000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Infantry"]'), null, { timeout: 20000, polling: 200 });
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Infantry"]').click());
await page.evaluate(() => document.querySelector('#selectScreen [data-side="p2"]').click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Goku"]').click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(2200);

// Freeze only the opponent's decisions: its body, damage, hitstun and knockback stay live.
await page.evaluate(() => {
  const [p1, p2] = window.fighters;
  const idle = { left:false, right:false, up:false, down:false, run:false, sprint:false, jump:false, attack:false, special:false, special2:false, special3:false, grab:false, dodge:false, shield:false, parry:false, ascend:false, descend:false, flightToggle:false, brake:false, webSwing:false, vertical:0 };
  if (!p2.__probeSim) {
    p2.__probeSim = p2.simulate.bind(p2);
    p2.simulate = dt => p2.__probeSim(dt, { getInputs: () => ({ ...idle, shield: !!p2.__probeGuard }) });
  }
  const originalScale = p1.scaleAttack.bind(p1);
  p1.scaleAttack = attack => {
    const queued = originalScale(attack);
    queueMicrotask(() => (window.__probeLabels = window.__probeLabels || []).push({ id: queued.id, label: queued.label, aerial: !!queued.aerial, damage: +queued.damage.toFixed(2) }));
    return queued;
  };
});

const step = async frames => page.evaluate(n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); }, frames);
const reset = async ({ dist = 1.2, face = true, guard = false } = {}) => page.evaluate(({ dist, face, guard }) => {
  const [p1, p2] = window.fighters;
  p1.position.set(0, 0, 0); p2.position.set(dist, 0, 0);
  p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
  p1.facing = face ? 1 : -1; p1.facingZ = 0;
  p2.facing = -1; p2.facingZ = 0;
  p1.attackBuffer = 0; p1.attackQueue.length = 0; p1.hitboxes.length = 0;
  p1.comboStep = 0; p1.comboWindow = 0; p1.comboHitCount = 0;
  p1.guardBreak = 0; p1.hitstun = 0; p1.attackPose = 0; p1.dodgeTimer = 0; p1.dashTimer = 0;
  p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.guardBreak = 0; p2.shield = 100;
  p2.guardHeld = !!guard; p2.__probeGuard = !!guard;
  p2.attackQueue.length = 0; p2.hitboxes.length = 0;
  window.__browserSmashCombatEvents = [];
  window.__probeLabels = [];
}, { dist, face, guard });
const read = async () => page.evaluate(() => {
  const [p1, p2] = window.fighters;
  return {
    identityKey: p1.identityKey,
    moveset: p1.moveset ? { key: p1.moveset.key, lights: p1.moveset.lights, heavy: p1.moveset.heavy, aerial: p1.moveset.aerial } : null,
    p1Pos: [p1.position.x, p1.position.y, p1.position.z].map(v => +v.toFixed(2)),
    p2Pos: [p2.position.x, p2.position.y, p2.position.z].map(v => +v.toFixed(2)),
    hitboxes: p1.hitboxes.map(h => ({ pos: [h.pos.x, h.pos.y, h.pos.z].map(v => +v.toFixed(2)), radius: h.radius })),
    move: p1.activeMoveId,
    queued: p1.attackQueue.map(a => ({ id: a.id, label: a.label, t: +a.t.toFixed(2) })),
    labels: (window.__probeLabels || []).slice(),
    p1Percent: +p1.percent.toFixed(2), p2Percent: +p2.percent.toFixed(2),
    p2Hitstun: +p2.hitstun.toFixed(3), p2Velocity: +Math.hypot(p2.velocity.x, p2.velocity.y, p2.velocity.z).toFixed(2),
    p2Shield: +p2.shield.toFixed(1),
    events: (window.__browserSmashCombatEvents || []).slice()
  };
});

const results = {};

// --- light string: Rifle Butt -> Combat Cross -> Boot Kick --------------------------------
await reset();
await page.keyboard.press('j');
await step(4);
results.light1 = await read();
await page.evaluate(() => { const [p1, p2] = window.fighters; p1.position.set(0, 0, 0); p1.velocity.set(0, 0, 0); p2.position.set(1.2, 0, 0); p2.velocity.set(0, 0, 0); p2.hitstun = 0; });
await step(26);
await page.keyboard.press('j');
await step(4);
results.light2 = await read();
await page.evaluate(() => { const [p1, p2] = window.fighters; p1.position.set(0, 0, 0); p1.velocity.set(0, 0, 0); p2.position.set(1.2, 0, 0); p2.velocity.set(0, 0, 0); p2.hitstun = 0; });
await step(26);
await page.keyboard.press('j');
await step(4);
results.light3 = await read();
await step(48);
results.lightString = await read();
await page.screenshot({ path: `${out}/light-string.png` });

// --- reach ---------------------------------------------------------------------------------
await reset({ dist: 2.2 });
await page.keyboard.press('j');
await step(6);
results.lightAtRange = await read();
await step(48);
results.lightAtRangeAfter = await read();

// --- whiff / negative control ---------------------------------------------------------------
await reset({ face: false });
await page.keyboard.press('j');
await step(54);
results.miss = await read();

// --- Armour Breaker (neutral heavy) ----------------------------------------------------------
await reset();
await page.keyboard.down('Shift');
await step(30);
await page.evaluate(() => { const [p1, p2] = window.fighters; p1.position.set(0, 0, 0); p2.position.set(1.3, 0, 0); p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0); p1.facing = 1; p1.facingZ = 0; });
await page.keyboard.press('j');
await step(1);
await page.keyboard.up('Shift');
await step(3);
results.heavy1 = await read();
await step(6);
results.heavy1Mid = await read();
await step(44);
results.heavy1After = await read();
await page.screenshot({ path: `${out}/armour-breaker.png` });

// --- Stock Slam (up + heavy) ----------------------------------------------------------------
await reset();
await page.keyboard.down('Shift');
await page.keyboard.down('w');
await step(30);
await page.evaluate(() => { const [p1, p2] = window.fighters; p1.position.set(0, 0, 0); p2.position.set(1.3, 0, 0); p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0); p1.facing = 1; p1.facingZ = 0; });
await page.keyboard.press('j');
await step(1);
await page.keyboard.up('w');
await page.keyboard.up('Shift');
await step(3);
results.heavy2 = await read();
await step(6);
results.heavy2Mid = await read();
await step(44);
results.heavy2After = await read();

// --- Jump Knee (aerial) ---------------------------------------------------------------------
await reset({ dist: 1.4 });
await page.keyboard.press('Space');
await step(9);
await page.keyboard.press('j');
await step(4);
results.aerial = await read();
await step(45);
results.aerialAfter = await read();
await page.screenshot({ path: `${out}/jump-knee.png` });

// --- block ----------------------------------------------------------------------------------
await reset({ dist: 1.2, guard: true });
await page.keyboard.press('j');
await step(40);
results.blocked = await read();

// --- assertions -----------------------------------------------------------------------------
const labelOf = r => r.labels.map(l => l.label);
check('the match fighter carries its authored moveset', results.light1.moveset?.key === 'infantry', JSON.stringify({ identityKey: results.light1.identityKey, moveset: results.light1.moveset }));
check('light 1 is Rifle Butt', labelOf(results.light1).includes('Rifle Butt'), JSON.stringify(labelOf(results.light1)));
check('light 1 deals damage once', results.light1.p2Percent > 0 && results.light1.events.length === 1, JSON.stringify({ p2: results.light1.p2Percent, events: results.light1.events.length }));
check('light 2 is Combat Cross', labelOf(results.light2).includes('Combat Cross'), JSON.stringify(labelOf(results.light2)));
check('light 3 is Boot Kick', labelOf(results.light3).includes('Boot Kick'), JSON.stringify(labelOf(results.light3)));
check('three-hit string resolves and damages', results.light3.p2Percent > results.light1.p2Percent && results.light3.events.length >= 3, JSON.stringify({ p2: results.light3.p2Percent, events: results.light3.events.length }));
check('light connects at 2.2 m', results.lightAtRangeAfter.p2Percent > 0, JSON.stringify({ p2: results.lightAtRangeAfter.p2Percent }));
check('facing-away light misses (negative control)', results.miss.p2Percent === 0, JSON.stringify({ p2: results.miss.p2Percent }));
check('heavy is Armour Breaker and deals damage', labelOf(results.heavy1).includes('Armour Breaker') && results.heavy1After.p2Percent > 0, JSON.stringify({ labels: labelOf(results.heavy1), p2: results.heavy1After.p2Percent }));
check('up-heavy is Stock Slam and deals damage', labelOf(results.heavy2).includes('Stock Slam') && results.heavy2After.p2Percent > 0, JSON.stringify({ labels: labelOf(results.heavy2), p2: results.heavy2After.p2Percent }));
check('aerial is Jump Knee and deals damage', labelOf(results.aerial).includes('Jump Knee') && results.aerialAfter.p2Percent > 0, JSON.stringify({ labels: labelOf(results.aerial), p2: results.aerialAfter.p2Percent }));
check('block reduces damage', results.blocked.p2Percent > 0 && results.blocked.p2Percent < results.light1.p2Percent && results.blocked.events.some(e => e.guarded), JSON.stringify({ blocked: results.blocked.p2Percent, clean: results.light1.p2Percent }));
check('hitstun and knockback are applied', (results.light1.events[0]?.hitstun || 0) > 0 && results.light1.p2Velocity > 0, JSON.stringify({ hitstun: results.light1.events[0]?.hitstun, velocity: results.light1.p2Velocity }));
check('no page errors', errors.length === 0, errors.join(' | '));
check('no failed asset requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

const failed = checks.filter(c => !c.ok);
await writeFile(`${out}/acceptance.json`, JSON.stringify({ results, checks, errors, failedRequests }, null, 2));
console.log('SUMMARY ' + JSON.stringify({ passed: checks.length - failed.length, total: checks.length, failures: failed.map(c => c.name) }));
await browser.close();
server.close();
process.exitCode = failed.length ? 1 : 0;
