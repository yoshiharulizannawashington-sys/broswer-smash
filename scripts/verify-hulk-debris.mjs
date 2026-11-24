import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
await mkdir('artifacts/hulk', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 180)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 180)); });
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Hulk (Bruce Banner)');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
  window.__browserSmashFreezeAI = true;
  window.__browserSmashTrainingDummy = true;
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(2800);
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', key: 'l', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyL', key: 'l', bubbles: true }));
});
await page.waitForFunction(() => Boolean(window.fighters?.[0]?.debrisSequence), null, { timeout: 15000, polling: 50 });
const setup = await page.evaluate(() => {
  const f = window.fighters[0];
  const p = (window.browserSmashProjectiles || []).slice(-1)[0] || null;
  return {
    identity: f.identity, ability: f.abilityLastCast?.label || null,
    phase: f.debrisSequence?.phase || null,
    shot: p ? { type: p.moveType, damage: p.damage, speed: p.velocity?.length?.(), chunks: p.group?.children?.[0]?.children?.length || 0 } : null
  };
});
await page.waitForFunction(() => window.fighters?.[0]?.debrisSequence?.phase === 'hold', null, { timeout: 10000, polling: 16 });
// Keep the live collision deterministic: the cinematic may have moved the opponent while the
// pickup played. Put the real CPU body 3.5 m in front of Hulk, then let the real projectile fly.
await page.evaluate(() => {
  const f = window.fighters[0], foe = window.fighters[1];
  const d = Math.hypot(f.facing, f.facingZ) || 1;
  foe.position.set(f.position.x + f.facing / d * 3.5, 0, f.position.z + f.facingZ / d * 3.5);
  foe.velocity?.set?.(0, 0, 0); foe.invulnerable = 0; foe.hitstun = 0; foe.percent = 0;
});
await page.evaluate(() => window.__browserSmashSetPaused(true));
const pickup = await page.evaluate(() => {
  const f = window.fighters[0];
  return { phase: f.debrisSequence?.phase || null, pose: f.debrisPose?.phase || null,
    preview: Boolean(f.debrisSequence?.group?.parent), position: f.debrisSequence?.group?.position?.toArray?.().map(v => +v.toFixed(2)) || null,
    rockParent: f.debrisSequence?.group?.parent?.name || f.debrisSequence?.group?.parent?.type || null,
    rockLocal: f.debrisSequence?.group?.position?.toArray?.().map(v => +v.toFixed(2)) || null,
    spectating: Boolean(window.smashCamera?.spectateState),
    camera: window.smashCamera?.camera?.position?.toArray?.().map(v => +v.toFixed(2)) || null,
    hand: f.model?.userData?.rightHand?.name || null };
});
await page.screenshot({ path: 'artifacts/hulk/debris-pickup.png' });
await page.evaluate(() => window.__browserSmashSetPaused(false));
// Advance the same fixed simulation step the game uses in play; the pickup beat is 0.45 s and the
// hold is another 0.45 s, so 0.95 s lands the release deterministically on software WebGL.
await page.evaluate(() => window.__browserSmashStep(0.95));
await page.waitForFunction(() => !window.fighters?.[0]?.debrisSequence && (window.browserSmashProjectiles || []).some(p => p.moveType === 'debris'), null, { timeout: 20000, polling: 16 });
await page.waitForTimeout(120);
await page.evaluate(() => window.__browserSmashSetPaused(true));
const release = await page.evaluate(() => {
  const f = window.fighters[0];
  return { phase: f.debrisSequence?.phase || null, pose: f.debrisPose?.phase || null,
    preview: Boolean(f.debrisSequence?.group?.parent), projectiles: (window.browserSmashProjectiles || []).map(p => p.moveType),
    spectating: Boolean(window.smashCamera?.spectateState), camera: window.smashCamera?.camera?.position?.toArray?.().map(v => +v.toFixed(2)) || null };
});
await page.screenshot({ path: 'artifacts/hulk/debris-throw.png' });
await page.evaluate(() => window.__browserSmashSetPaused(false));
await page.evaluate(() => window.__browserSmashStep(2));
await page.waitForFunction(() => window.fighters?.[1]?.percent >= 20 || (window.browserSmashProjectiles || []).length === 0, null, { timeout: 20000, polling: 100 }).catch(() => {});
await page.waitForTimeout(500);
const after = await page.evaluate(() => {
  const f = window.fighters[0], foe = window.fighters[1];
  return {
    percent: Math.round(foe.percent), hitstun: +(foe.hitstun || 0).toFixed(2),
    live: (window.browserSmashProjectiles || []).map(p => p.moveType),
    impact: window.__browserSmashLastImpact || null,
    projectileState: (window.browserSmashProjectiles || []).map(p => ({ type: p.moveType, life: +(+p.life).toFixed(2), pos: p.group.position.toArray().map(v => +v.toFixed(2)), vel: p.velocity.toArray().map(v => +v.toFixed(2)) })),
    hulk: f.position.toArray().map(v => +v.toFixed(2)), foe: foe.position.toArray().map(v => +v.toFixed(2)),
    callout: document.body.innerText.split('\n').filter(Boolean).slice(-3).join(' / ').slice(-140)
  };
});
console.log('DEBRIS ' + JSON.stringify({ setup, pickup, release, before: await page.evaluate(() => window.__debrisBefore), after, errors }));
await browser.close();
server.close();
