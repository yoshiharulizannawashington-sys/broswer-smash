// Full clip matrix for the imported 19-bone test fixture (?showcaseCharacter=link_test).
// Drives real inputs through the existing controller and proves the skeleton actually deforms for
// each state, rather than trusting that a clip exists: every state reports how many bones moved and
// how far, plus a screenshot.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/clip-matrix';
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));

await page.goto(origin + '/?showcaseCharacter=link_test', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => { window.__browserSmashSelect?.select?.('p1', 'Goku'); window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki'); });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const fighter = window.fighters[0];
  let skeleton = null;
  fighter.model.traverse(n => { if (!skeleton && n.isSkinnedMesh) skeleton = n.skeleton; });
  window.__clipSkeleton = skeleton;
  window.__clipSample = () => {
    if (!skeleton) return { bones: 0, moved: 0, delta: 0 };
    const now = skeleton.bones.map(b => b.getWorldPosition(new window.__browserSmashThree.Vector3()));
    const base = window.__clipLast || now;
    let moved = 0, delta = 0;
    now.forEach((p, i) => { const d = p.distanceTo(base[i]); if (d > 0.002) moved += 1; delta += d; });
    window.__clipLast = now;
    return { bones: now.length, moved, delta: +delta.toFixed(3) };
  };
  window.__clipKey = (down, code) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: 'x', bubbles: true }));
  window.__clipStep = n => { for (let i = 0; i < n; i += 1) { window.__browserSmashStep(1 / 60); window.__browserSmashAttackTick?.(); } };
  window.__clipSample();
});

const states = [
  ['idle', 'window.__clipStep(30)'],
  ['walk', "window.__clipKey(true,'KeyD');window.__clipStep(40);window.__clipKey(false,'KeyD')"],
  ['run', "window.__clipKey(true,'ShiftLeft');window.__clipKey(true,'KeyD');window.__clipStep(45);window.__clipKey(false,'KeyD');window.__clipKey(false,'ShiftLeft')"],
  ['jump', "window.__clipKey(true,'Space');window.__clipStep(4);window.__clipKey(false,'Space');window.__clipStep(22)"],
  ['light1', "window.__clipKey(true,'KeyJ');window.__clipStep(3);window.__clipKey(false,'KeyJ');window.__clipStep(8)"],
  ['light2', "window.__clipKey(true,'KeyJ');window.__clipStep(3);window.__clipKey(false,'KeyJ');window.__clipStep(8)"],
  ['light3', "window.__clipKey(true,'KeyJ');window.__clipStep(3);window.__clipKey(false,'KeyJ');window.__clipStep(8)"],
  ['heavy', "window.__clipKey(true,'ShiftLeft');window.__clipKey(true,'KeyJ');window.__clipStep(4);window.__clipKey(false,'KeyJ');window.__clipKey(false,'ShiftLeft');window.__clipStep(12)"],
  ['airAttack', "window.__clipKey(true,'Space');window.__clipStep(6);window.__clipKey(false,'Space');window.__clipKey(true,'KeyJ');window.__clipStep(3);window.__clipKey(false,'KeyJ');window.__clipStep(10)"],
  ['hitReact', "window.fighters[0].hitstun=0.5;window.fighters[0].percent=(window.fighters[0].percent||0)+12;window.__clipStep(12)"],
  ['knockback', "window.fighters[0].hitstun=1.2;window.fighters[0].percent=(window.fighters[0].percent||0)+40;window.__clipStep(20)"],
  ['ko', "window.fighters[0].percent=180;window.fighters[0].hitstun=2;window.__clipStep(40)"]
];

const results = [];
for (const [name, script] of states) {
  await page.evaluate(s => { const fighter = window.fighters[0]; const before = { x: fighter.position.x, z: fighter.position.z }; window.__clipStep(2); eval(s); window.__clipMoved = { dx: +(fighter.position.x - before.x).toFixed(2), dz: +(fighter.position.z - before.z).toFixed(2) }; }, script);
  const pose = await page.evaluate(() => window.__clipSample());
  const moved = await page.evaluate(() => window.__clipMoved);
  await page.screenshot({ path: `${out}/${String(results.length + 1).padStart(2, '0')}-${name}.png` });
  results.push({ state: name, ...pose, ...moved });
}

const summary = await page.evaluate(() => ({
  modelUrl: window.fighters?.[0]?.model?.userData?.sourceUrl || window.fighters?.[0]?.model?.userData?.modelUrl || null,
  bones: window.__clipSkeleton?.bones?.length ?? 0,
  percent: Math.round(window.fighters?.[0]?.percent ?? 0),
  opponent: window.fighters?.[1]?.identity
}));
await writeFile(`${out}/report.json`, JSON.stringify({ summary, results, errors }, null, 2));
console.log('CLIPMATRIX ' + JSON.stringify({ summary, results, errors: errors.slice(-4) }));
await browser.close(); server.close();
