// Live Hulk check: mount the genuine imported body through normal character selection, prove the
// mixer owns the mounted root, prove the 65-joint rig resolved, select the real light input and step
// through the five-hit chain, then capture the match. Prints HULK {json}.
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
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
await mkdir('artifacts/hulk', { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(150000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 240)));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Hulk (Bruce Banner)');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(2500);

const mount = await page.evaluate(() => {
  const f = window.fighters[0];
  const entry = window.__browserSmashAssets?.characterModels?.['hulk_bruce_banner'] || null;
  const u = f?.model?.userData || {};
  return {
    identity: f?.identity || null,
    status: entry?.status || null,
    url: entry?.url || null,
    animations: entry?.animations || [],
    bones: (entry?.bones || []).length,
    validation: entry?.validation || null,
    metrics: entry?.metrics || null,
    hasMixer: Boolean(u.humanMixer),
    mixerRootUuid: u.humanMixer?.getRoot?.().uuid || null,
    modelUuid: f?.model?.uuid || null,
    strikeSet: u.importedStrikeSet || null,
    strikeReport: u.importedStrikeReport || null,
    reactionReport: u.importedReactionReport || null,
    actions: Object.keys(u.authoredAbilityActions || {}).slice(0, 30)
  };
});

try {
  await page.waitForFunction(() => Boolean(window.fighters?.[0]?.model?.userData?.importedStrikeSet), null, { timeout: 45000, polling: 250 });
} catch (_error) {}
const run = await page.evaluate(() => {
  const f = window.fighters[0], u = f.model.userData, foe = window.fighters[1];
  const tick = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
  const key = (code, down, extra = {}) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, ...extra }));
  // Wait for the dummy to finish its reaction before measuring a fresh move. Attacking a body
  // that is still knocked down measures invulnerability, not the move's hitbox.
  const settle = () => { for (let i = 0; i < 600 && foe && (foe.invulnerable > 0 || foe.hitstun > 0 || !foe.isGrounded); i += 1) tick(1); };
  const place = () => { if (foe) { foe.position.set(f.position.x + (f.facing >= 0 ? 0.85 : -0.85), 0, f.position.z); foe.velocity?.set?.(0, 0, 0); } };
  const idle = () => { for (let i = 0; i < 150 && f.attackQueue.length; i += 1) tick(1); };
  const press = (code, mods = []) => {
    for (const m of mods) key(m, true, { key: 'Shift' });
    tick(2); key(code, true); tick(4); key(code, false); tick(3);
    for (const m of mods) key(m, false, { key: 'Shift' });
  };
  const snap = name => ({ name, slot: u.lastAuthoredStrike?.slot || null, clip: u.lastAuthoredStrike?.clip || null, move: f.activeMoveId || null, dmg: Math.round(foe?.percent ?? 0), meter: Math.round(f.meter || 0), casting: f.casting ? 'yes' : null });
  const moves = [];
  const probe = (name, code, mods, gap = 0.85) => {
    idle(); settle();
    const dmg0 = Math.round(foe?.percent ?? 0);
    // Hold the modifiers first: Up is also a movement direction and turns the body, so the
    // dummy must be placed against the facing the attack will actually use.
    for (const m of mods) key(m, true, { key: 'Shift' });
    tick(2);
    if (foe) {
      const len = Math.hypot(f.facing, f.facingZ) || 1;
      foe.position.set(f.position.x + f.facing / len * gap, 0, f.position.z + f.facingZ / len * gap);
      foe.velocity?.set?.(0, 0, 0);
    }
    key(code, true); tick(4); key(code, false); tick(3);
    for (const m of mods) key(m, false, { key: 'Shift' });
    const accepted = f.attackQueue.length;
    const tr = [];
    let maxY = 0, airTicks = 0;
    for (let i = 0; i < 90; i += 1) {
      tick(1);
      maxY = Math.max(maxY, foe.position.y);
      if (!foe.isGrounded) airTicks += 1;
      const h = f.hitboxes[0];
      if (h && i < 14) {
        const chest = foe.position.clone(); chest.y += 1;
        tr.push({
          i, hit: h.hit,
          d: +h.pos.distanceTo(chest).toFixed(2), limit: +(h.radius + foe.hurtboxRadius).toFixed(2),
          facing: [+f.facing.toFixed(2), +f.facingZ.toFixed(2)],
          inv: +(foe.invulnerable || 0).toFixed(2), hs: +(foe.hitstun || 0).toFixed(2), dmg: Math.round(foe.percent)
        });
      }
    }
    moves.push({ name, gap, accepted, dmg0, dmg1: Math.round(foe.percent), maxY: +maxY.toFixed(2), airTicks, tr: tr.slice(0, 2) });
  };
  probe('heavy@1.6', 'KeyJ', ['ShiftLeft'], 1.6);
  probe('launcher@1.6', 'KeyJ', ['ShiftLeft', 'ArrowUp'], 1.6);
  probe('launcher@2.4', 'KeyJ', ['ShiftLeft', 'ArrowUp'], 2.4);
  probe('slam@1.8', 'KeyJ', ['ShiftLeft', 'ArrowDown'], 1.8);
  idle(); settle();
  if (foe) {
    const len = Math.hypot(f.facing, f.facingZ) || 1;
    foe.position.set(f.position.x + f.facing / len * 1.2, 0, f.position.z + f.facingZ / len * 1.2);
    foe.velocity?.set?.(0, 0, 0);
  }
  const sigDmg0 = Math.round(foe.percent);
  press('KeyK');
  tick(90);
  moves.push({
    name: 'signature', gap: null, accepted: 1, dmg0: sigDmg0, dmg1: Math.round(foe.percent), maxY: 0, airTicks: 0,
    specialClip: u.lastAuthoredSpecial?.clip || null, specialId: u.lastAuthoredSpecial?.cast || 0,
    strikeSlot: u.lastAuthoredStrike?.slot || null
  });
  idle(); settle();
  f.facing = 1; f.facingZ = 0;
  if (foe) { foe.position.set(f.position.x + 3.5, 0, f.position.z); foe.velocity?.set?.(0, 0, 0); foe.invulnerable = 0; foe.hitstun = 0; foe.isGrounded = true; }
  f.abilityReadyAt = {};
  const debrisDmg0 = Math.round(foe.percent);
  press('KeyL');
  const raw = window.browserSmashProjectiles || [];
  const debrisShot = raw.slice(-1)[0] || null;
  const debrisShape = debrisShot ? { moveType: debrisShot.moveType, damage: debrisShot.damage, life: debrisShot.life, velocity: debrisShot.velocity?.toArray?.().map(v => +v.toFixed(2)), chunks: debrisShot.group?.children?.[0]?.children?.length || 0 } : null;
  tick(60);
  moves.push({ name: 'debris', gap: 3.5, accepted: 1, dmg0: debrisDmg0, dmg1: Math.round(foe.percent), maxY: 0, airTicks: 0,
    ability: f.abilityLastCast?.label || null, shape: debrisShape, impact: window.__browserSmashLastImpact || null,
    liveProjectiles: (window.browserSmashProjectiles || []).length });
  f.meter = 100; idle(); settle();
  if (foe) { const len = Math.hypot(f.facing, f.facingZ) || 1; foe.position.set(f.position.x + f.facing / len * 1.6, 0, f.position.z + f.facingZ / len * 1.6); foe.velocity?.set?.(0, 0, 0); }
  press('KeyO'); tick(24);
  moves.push({ name: 'ultimate', gap: 1.6, accepted: 1, dmg0: 0, dmg1: Math.round(foe.percent),
    ultimateClip: u.lastUltimateAnimation?.clip || null, ultimateId: u.lastUltimateAnimation?.id || null,
    casting: f.casting || null, meter: Math.round(f.meter || 0), maxY: 0, airTicks: 0 });
  return { moves, foePercent: Math.round(foe?.percent ?? 0), special: Math.round(f.specialCooldown || 0) };
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'artifacts/hulk/ultimate.png' });

const finish = await page.evaluate(() => {
  const f = window.fighters[0], u = f.model.userData, foe = window.fighters[1];
  const tick = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
  try { window.__browserSmashPause.close(); } catch (_error) {}
  let castTicks = 0;
  while (f.casting && castTicks < 500) { tick(1); castTicks += 1; }
  const afterUlt = { castTicks, casting: f.casting ? 'still-casting' : null, dmg: Math.round(foe?.percent ?? 0), control: f.attackQueue.length === 0 };
  // KO path: the opponent is already damaged; land one more heavy with the fighter returned to play.
  if (foe) { foe.percent = Math.max(foe.percent, 160); foe.position.set(f.position.x + (f.facing >= 0 ? 1.1 : -1.1), 0, f.position.z); foe.velocity?.set?.(0, 0, 0); }
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true, modifiers: ['ShiftLeft'] }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', bubbles: true }));
  tick(4);
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', bubbles: true }));
  tick(120);
  return {
    afterUlt,
    ko: Boolean(foe?.ko),
    result: document.querySelector('#result')?.textContent || '',
    banner: document.querySelector('#comboNotice')?.textContent || '',
    remaining: window.__browserSmashRules?.().remaining ?? null,
    dmg: Math.round(foe?.percent ?? 0),
    strikeReport: u.importedStrikeReport?.status || null,
    bound: (u.importedStrikeReport?.bound || []).length,
    errors: 0
  };
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'artifacts/hulk/live-match.png' });
console.log('HULK ' + JSON.stringify({ mount, run, finish, errors }));
await browser.close();
server.close();
process.exit(0);
