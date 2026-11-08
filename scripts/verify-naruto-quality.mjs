// Every reachable Naruto action, driven by real keys, sampled inside the page in one call.
//
// The earlier version spent a round trip per frame and timed out under software rendering. Sampling
// in-page keeps the same evidence - dispatched cast, running authored slot, weight, bone deltas - at
// a fraction of the cost. Distinctness is reported by slot, so two ids resolving to one clip cannot
// pass as two animations.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/naruto-quality';
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashSelect?.chooseArena('valley');
  window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(3000);
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  const a = window.fighters[0], b = window.fighters[1];
  a.position.set(0, 0, 0); b.position.set(2.8, 0, 0);
  a.velocity?.set?.(0, 0, 0); b.velocity?.set?.(0, 0, 0);
  // Sampler installed once in the page: one call per action instead of one per frame.
  window.__samplePose = async (count) => {
    const f = window.fighters[0];
    const pick = n => { let b = null; f.model.traverse(x => { if (!b && x.isBone && new RegExp(n, 'i').test(x.name || '')) b = x; }); return b ? b.quaternion.toArray() : null; };
    const rows = [];
    for (let i = 0; i < count; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const u = f.model.userData;
      const acts = u.authoredAbilityActions || {};
      const running = Object.entries(acts).filter(([, a]) => a.isRunning() && a.getEffectiveWeight() > 0.01)
        .map(([slot, a]) => ({ slot, weight: +a.getEffectiveWeight().toFixed(2) }));
      const special = u.authoredSpecialAction?.isRunning() && u.authoredSpecialAction.getEffectiveWeight() > 0.01
        ? { slot: 'special', weight: +u.authoredSpecialAction.getEffectiveWeight().toFixed(2) } : null;
      if (special) running.push(special);
      rows.push({ arm: pick('rightarm'), fore: pick('rightfore'), torso: pick('torso'), running,
        cast: f.abilityCast?.motion || null, castAt: f.abilityCast?.at ?? null, equip: u.equipmentState?.state || null });
    }
    return rows;
  };
});
await page.locator('canvas').first().click({ position: { x: 330, y: 230 }, force: true });

const reset = () => page.evaluate(() => {
  const f = window.fighters[0];
  f.specialCooldown = 0; f.attackQueue.length = 0; f.hitstun = 0; f.guardBreak = 0; f.hitLag = 0;
  f.isGrounded = true; f.velocity?.set?.(0, 0, 0);
  if (f.abilityReadyAt && typeof f.abilityReadyAt === 'object') for (const k of Object.keys(f.abilityReadyAt)) f.abilityReadyAt[k] = 0;
});
const restPose = () => page.evaluate(() => window.__samplePose(1)).then(rows => rows[0]);
const dist = (a, b) => (a && b) ? Number(Math.max(...a.map((v, k) => Math.abs(v - b[k]))).toFixed(3)) : 0;

const actions = [
  { name: 'light-combo', keys: ['j'], taps: 5 },
  { name: 'rasengan', keys: ['h'] },
  { name: 'shadowClone', keys: ['l'] },
  { name: 'signature', keys: ['k'] },
  { name: 'aerial', keys: ['Space', 'j'] },
  { name: 'ultimate', keys: ['o'] }
];
const results = [];
for (const action of actions) {
  await reset();
  const rest = await page.evaluate(() => {
    const f = window.fighters[0];
    const pick = n => { let b = null; f.model.traverse(x => { if (!b && x.isBone && new RegExp(n, 'i').test(x.name || '')) b = x; }); return b ? b.quaternion.toArray() : null; };
    return { arm: pick('rightarm'), fore: pick('rightfore'), torso: pick('torso') };
  });
  const frames = [];
  if (action.taps) {
    for (let tap = 0; tap < action.taps; tap++) {
      await page.keyboard.press(action.keys[0]);
      frames.push(...await page.evaluate(() => window.__samplePose(4)));
    }
  } else {
    for (const key of action.keys) await page.keyboard.press(key);
    frames.push(...await page.evaluate(() => window.__samplePose(8)));
  }
  const slots = [...new Set(frames.flatMap(f => f.running.map(r => r.slot)))];
  const cast = frames.find(f => f.cast && f.castAt !== rest.castAt)?.cast || null;
  const file = `${out}/naruto-${action.name}.png`;
  await page.screenshot({ path: file });
  results.push({
    name: action.name, keys: action.keys.join('+'), cast, slots,
    maxArm: Math.max(0, ...frames.map(f => dist(rest.arm, f.arm))),
    maxFore: Math.max(0, ...frames.map(f => dist(rest.fore, f.fore))),
    maxTorso: Math.max(0, ...frames.map(f => dist(rest.torso, f.torso))),
    equip: [...new Set(frames.map(f => f.equip).filter(Boolean))],
    file
  });
}
await writeFile(`${out}/naruto-quality.json`, JSON.stringify({ generatedAt: new Date().toISOString(), results, errors }, null, 2));
for (const r of results) console.log('ACTION', JSON.stringify(r));
console.log('DISTINCT_SLOTS', JSON.stringify([...new Set(results.flatMap(r => r.slots))]));
console.log('PAGE_ERRORS', JSON.stringify(errors.slice(0, 2)));
await browser.close(); server.close();
