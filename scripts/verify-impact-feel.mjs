// Batch 1 acceptance: impact feel (hit-stop, camera knock, presentation flash) measured at runtime
// through the same spawnImpact path every confirmed hit uses, then a real melee connection.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/impact-feel';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
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
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForTimeout(600);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(1200);

// Grade the same impact path the game calls: light, medium and heavy.
const graded = await page.evaluate(() => {
  const sample = intensity => {
    const at = window.fighters[1].position.clone();
    at.y += 1.1;
    window.spawnImpact(at, intensity, null, 'unarmed');
    const read = {
      freeze: window.__browserSmashHitStop(),
      shake: window.smashCamera?.shake ?? 0,
      cls: document.body.className
    };
    return read;
  };
  return { light: sample(6), medium: sample(11), heavy: sample(20) };
});
await page.screenshot({ path: `${out}/01-heavy-impact.png` });
check('light input still produces a readable hit', graded.light.freeze > 0 && graded.light.shake > 0, JSON.stringify(graded.light));
check('medium reads heavier than light', graded.medium.freeze >= graded.light.freeze && graded.medium.shake > graded.light.shake, JSON.stringify({ light: graded.light.shake, medium: graded.medium.shake }));
check('heavy reads heaviest', graded.heavy.freeze > graded.medium.freeze && graded.heavy.shake > graded.medium.shake, JSON.stringify({ freeze: graded.heavy.freeze, shake: graded.heavy.shake }));
check('presentation flash grades with the hit', /bb-impact-heavy/.test(graded.heavy.cls) && /bb-impact-light/.test(graded.light.cls), graded.light.cls + ' | ' + graded.heavy.cls);

// The freeze must clear itself, not stack into a permanent stall.
const settled = await page.evaluate(() => {
  for (let i = 0; i < 40; i += 1) window.__browserSmashStep(0.02);
  return {
    freeze: window.__browserSmashHitStop(),
    flash: document.body.className,
    moving: window.fighters.every(f => Number.isFinite(f.position?.x))
  };
});
check('impact freeze decays back to live play', settled.freeze === 0, JSON.stringify(settled));

// Real melee. `percent`/`hitstun` are the authoritative damage signals (fighter3D owns `percent`);
// the pair is pinned every frame because the simulation moves both bodies and lets the CPU retreat,
// which is why the earlier probe only ever measured a swing. A connection is credited whether the
// player's jab or the CPU's own strike lands, so this proves registration, not a scripted hit.
const melee = await page.evaluate(() => {
  const [hero, opponent] = window.fighters;
  const read = f => ({ percent: Number(f.percent) || 0, stun: Number(f.hitstun) || 0 });
  const before = { player: read(hero), cpu: read(opponent) };
  let peakFreeze = 0;
  let peakShake = 0;
  let playerPeakStun = 0;
  let cpuPeakStun = 0;
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: 'j', bubbles: true }));
  for (let swing = 0; swing < 6; swing += 1) {
    key('keydown', 'KeyJ');
    for (let i = 0; i < 26; i += 1) {
      // Keep the duel at jab range in front of the player, with both bodies settled.
      opponent.position.set(hero.position.x, hero.position.y, hero.position.z - 1.25);
      opponent.velocity?.set?.(0, 0, 0);
      opponent.hitstun = Math.min(Number(opponent.hitstun) || 0, 0.4);
      hero.hitstun = 0;
      hero.facing = Math.atan2(opponent.position.x - hero.position.x, opponent.position.z - hero.position.z);
      hero.model.rotation.y = hero.facing;
      window.__browserSmashStep(1 / 60);
      window.__browserSmashAttackTick?.();
      peakFreeze = Math.max(peakFreeze, window.__browserSmashHitStop());
      peakShake = Math.max(peakShake, window.smashCamera?.shake ?? 0);
      cpuPeakStun = Math.max(cpuPeakStun, Number(opponent.hitstun) || 0);
      playerPeakStun = Math.max(playerPeakStun, Number(hero.hitstun) || 0);
    }
    key('keyup', 'KeyJ');
    window.__browserSmashStep(0.1);
  }
  return { before, after: { player: read(hero), cpu: read(opponent) }, peakFreeze, peakShake, cpuPeakStun, playerPeakStun };
});
await page.screenshot({ path: `${out}/02-melee-impact.png` });
const playerConnected = melee.after.cpu.percent > melee.before.cpu.percent || melee.cpuPeakStun > 0.05;
const cpuConnected = melee.after.player.percent > melee.before.player.percent || melee.playerPeakStun > 0.05;
const connected = playerConnected || cpuConnected;
check('a real melee connection registers damage', connected, JSON.stringify({ playerConnected, cpuConnected, before: melee.before, after: melee.after, stuns: [melee.cpuPeakStun, melee.playerPeakStun] }));
check('the player\'s own jab lands on the opponent', playerConnected, JSON.stringify(melee.after.cpu));
check('a real connection also freezes and knocks the camera', connected && melee.peakFreeze > 0 && melee.peakShake > 0, JSON.stringify({ freeze: melee.peakFreeze, shake: melee.peakShake }));

await writeFile(`${out}/report.json`, JSON.stringify({ checks, graded, settled, melee, errors }, null, 2));
console.log('SUMMARY', JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, errors: errors.length, melee }));
await browser.close(); server.close();
