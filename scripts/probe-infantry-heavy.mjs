// Why does the heavy string stop at Armour Breaker? Traces the attack timeline frame by frame.
//   bash scripts/run-browser-test.sh scripts/probe-infantry-heavy.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/infantry-heavy-probe';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    const body = await readFile(resolve(root, rel));
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);

try {
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 90000, polling: 250 });
  await page.click('#bbTitle [data-nav="versus"]');
  await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Infantry"]'), null, { timeout: 30000, polling: 200 });
  await page.evaluate(() => {
    document.querySelector('#selectScreen [data-side="p1"]').click();
    document.querySelector('#selectScreen [data-fighter="Infantry"]').click();
    document.querySelector('#selectScreen [data-side="p2"]').click();
    document.querySelector('#selectScreen [data-fighter="Kaze"]').click();
    document.querySelector('#play').click();
  });
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 60000, polling: 200 });
  await page.waitForFunction(() => window.fighters?.[0]?.model?.userData?.equippedWeaponRight, null, { timeout: 90000, polling: 250 });
  await page.waitForTimeout(800);

  console.log('MOTIONS ' + JSON.stringify(await page.evaluate(() => {
    const out = {};
    for (const slot of ['light1', 'light2', 'light3', 'heavy', 'heavy2', 'launcher']) {
      try { out[slot] = window.__browserSmashAttackMotion?.('Infantry', slot) || null; } catch (e) { out[slot] = 'error: ' + e.message; }
    }
    return out;
  })).slice(0, 1200));

  await page.evaluate(() => {
    const p2 = window.fighters[1];
    const idle = { left: false, right: false, up: false, down: false, run: false, sprint: false, jump: false, attack: false, special: false, special2: false, special3: false, grab: false, dodge: false, shield: false, parry: false, ascend: false, descend: false, flightToggle: false, brake: false, webSwing: false, vertical: 0 };
    p2.__probeSim = p2.simulate.bind(p2);
    p2.simulate = dt => p2.__probeSim(dt, { getInputs: () => ({ ...idle }) });
    const [p1] = window.fighters;
    p1.position.set(0, 0, 0); p2.position.set(0.9, 0, 0);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    p1.attackQueue.length = 0; p1.hitboxes.length = 0; p1.comboStep = 0; p1.comboWindow = 0; p1.attackPose = 0;
    p2.percent = 0; p2.hitstun = 0; p2.shield = 0; p2.invulnerable = 0;
    p2.position.y = 0; p1.position.y = 0;
  });
  await page.evaluate(() => window.__browserSmashStep(0.1));

  const trace = [];
  const sample = () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const q = p1.attackQueue[0];
    return {
      move: p1.activeMoveId || null,
      t: q ? +q.t.toFixed(3) : null,
      total: q ? +(q.total || 0).toFixed(3) : null,
      start: q ? +(q.start || 0).toFixed(3) : null,
      active: q ? +(q.active || 0).toFixed(3) : null,
      hits: p1.hitboxes.length,
      percent: +p2.percent.toFixed(2),
      strike: p1.model?.userData?.lastAuthoredStrike?.clip || null,
      comboStep: p1.comboStep || 0
    };
  });

  for (const combo of [0, 1]) {
    await page.keyboard.down('Shift');
    await page.keyboard.down('j'); await page.evaluate(() => window.__browserSmashStep(0.033)); await page.keyboard.up('j');
    await page.keyboard.up('Shift');
    for (let i = 0; i < 22; i += 1) {
      trace.push({ combo, frame: i, ...(await sample()) });
      await page.evaluate(() => window.__browserSmashStep(0.05));
    }
  }
  console.log('TRACE ' + JSON.stringify(trace));
  await page.screenshot({ path: `${out}/heavy-contact.png` });
} catch (error) {
  console.log('FATAL', String(error?.message || error).slice(0, 400));
} finally {
  await browser.close().catch(() => {});
  server.close();
}
