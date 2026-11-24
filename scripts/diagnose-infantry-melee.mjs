// Diagnostic: Infantry melee through the real keyboard path, with the CPU's decisions frozen.
// Records facing, selected move, hitbox spawn, active frames, combat ledger and defender percent.
//
//   bash scripts/run-browser-test.sh scripts/diagnose-infantry-melee.mjs
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

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(150000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));

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
await page.waitForTimeout(2500);

// Freeze the opponent's decisions, not its body: it still takes damage and reacts.
await page.evaluate(() => {
  const p2 = window.fighters[1];
  if (!p2.__probeSim) {
    const idle = { left:false, right:false, up:false, down:false, run:false, sprint:false, jump:false, attack:false, special:false, special2:false, special3:false, grab:false, dodge:false, shield:false, parry:false, ascend:false, descend:false, flightToggle:false, brake:false, webSwing:false, vertical:0 };
    p2.__probeSim = p2.simulate.bind(p2);
    p2.simulate = dt => p2.__probeSim(dt, { getInputs: () => idle });
  }
});

async function caseRun({ name, dist = 1.05, face = true, heavy = false, aerial = false }) {
  await page.evaluate(({ dist, face }) => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, 0, 0); p2.position.set(dist, 0, 0);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.facing = face ? 1 : -1; p1.facingZ = 0;
    p2.facing = -1; p2.facingZ = 0;
    p1.attackBuffer = 0; p1.attackQueue.length = 0; p1.hitboxes.length = 0;
    p1.comboStep = 0; p1.comboWindow = 0; p1.comboHitCount = 0;
    p1.guardBreak = 0; p1.hitstun = 0; p1.attackPose = 0;
    p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.guardHeld = false; p2.guardBreak = 0;
    p2.attackQueue.length = 0; p2.hitboxes.length = 0; p2.percent = 0;
    window.__browserSmashCombatEvents = [];
    window.__probeTrace = [];
    window.__probeRun = { name: '', before: 0 };
  }, { dist, face });

  if (heavy) await page.keyboard.down('Shift');
  if (aerial) await page.keyboard.press('Space');
  await page.keyboard.press('j');
  if (heavy) await page.keyboard.up('Shift');
  await page.waitForTimeout(60);
  const snapshot = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const dx = p2.position.x - p1.position.x, dz = p2.position.z - p1.position.z;
    const horizontal = Math.hypot(dx, dz);
    const facingDot = horizontal > .001 ? (dx / horizontal) * p1.facing + (dz / horizontal) * p1.facingZ : 0;
    return {
      activeMoveId: p1.activeMoveId, queue: p1.attackQueue.map(a => ({ id: a.id, label: a.label, t: +a.t.toFixed(3), start: +a.start.toFixed(3), end: +a.end.toFixed(3), total: +a.total.toFixed(3), reach: +a.reach.toFixed(2), damage: +a.damage.toFixed(2), hit: a.hit })),
      hitboxes: p1.hitboxes.map(h => ({ pos: [h.pos.x, h.pos.y, h.pos.z].map(v => +v.toFixed(2)), radius: h.radius, damage: +h.damage.toFixed(2) })),
      distance: +horizontal.toFixed(2), facingDot: +facingDot.toFixed(2), facing: p1.facing,
      p2Percent: p2.percent, p1Percent: p1.percent,
      events: (window.__browserSmashCombatEvents || []).slice(-4)
    };
  });
  await page.evaluate(() => window.__browserSmashStep(0.55));
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    return {
      activeMoveId: p1.activeMoveId, queue: p1.attackQueue.length, hitboxes: p1.hitboxes.length,
      p2Percent: p2.percent, p1Percent: p1.percent,
      events: (window.__browserSmashCombatEvents || []).slice(-4)
    };
  });
  return { name, dist, face, heavy, aerial, snapshot, after };
}

const cases = [];
cases.push(await caseRun({ name: 'light, natural facing (repro)', face: false }));
cases.push(await caseRun({ name: 'light, facing target', face: true }));
cases.push(await caseRun({ name: 'light, facing target at 1.6 m', dist: 1.6 }));
cases.push(await caseRun({ name: 'light, facing target at 2.2 m', dist: 2.2 }));
cases.push(await caseRun({ name: 'heavy, facing target', dist: 1.3, heavy: true }));
cases.push(await caseRun({ name: 'aerial, facing target', dist: 1.3, aerial: true }));

for (const c of cases) {
  console.log(`CASE ${c.name} · move=${c.snapshot.activeMoveId} dist=${c.snapshot.distance} dot=${c.snapshot.facingDot} p2 ${c.snapshot.p2Percent}->${c.after.p2Percent} events=${c.after.events.length}`);
  if (c.snapshot.queue.length) console.log('  queue ' + JSON.stringify(c.snapshot.queue));
  if (c.snapshot.hitboxes.length) console.log('  hitbox ' + JSON.stringify(c.snapshot.hitboxes));
  if (c.after.events.length) console.log('  ledger ' + JSON.stringify(c.after.events));
}
await page.screenshot({ path: `${out}/last-case.png` });
await writeFile(`${out}/diagnosis.json`, JSON.stringify({ cases, errors }, null, 2));
console.log('ERRORS ' + JSON.stringify(errors));
await browser.close();
server.close();
