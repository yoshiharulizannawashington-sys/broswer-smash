import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const outDir = resolve(process.cwd(), 'artifacts/dev/phase28425');
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl',
  '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.setDefaultTimeout(60000);
await page.addInitScript(() => {
  let v = 0; const q = []; window.__frameErrors = [];
  performance.now = () => v;
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__advance = (n = 1, dt = 1000 / 60) => { for (let i = 0; i < n; i++) { v += dt; for (const cb of q.splice(0, q.length)) { try { cb(v); } catch (e) { window.__frameErrors.push(String((e && e.message) || e)); } } } return q.length; };
});
const mute = on => page.evaluate(v => { const r = window.__browserSmashRenderer; if (!r) return;
  if (v) { if (!r.__o) r.__o = r.render; r.render = () => {}; } else if (r.__o) { r.render = r.__o; delete r.__o; } }, on);
const adv = n => page.evaluate(k => window.__advance(k), n);
const wait = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { await mute(true); if (await page.evaluate(fn)) return true; await adv(1); await page.waitForTimeout(5); } return false; };
const out = { states: {}, hit: null };
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  const booted = await wait(() => Boolean(window.__browserSmashStep && window.fighters), 45000);
  await page.evaluate(() => { const s = document.querySelector('#p1Character'); const o = s && [...s.options].find(i => i.value === 'Kaze');
    if (o) { s.value = 'Kaze'; s.dispatchEvent(new Event('change', { bubbles: true })); } document.querySelector('#play')?.click(); });
  const imported = await wait(() => { const u = window.fighters?.[0]?.model?.userData; if (!u?.assetUrl || !u.hasAnimationClips) return false;
    let b = 0; window.fighters[0].model.traverse?.(n => { if (n.isSkinnedMesh) b = Math.max(b, n.skeleton?.bones?.length || 0); }); return b >= 40; }, 45000);
  console.log('BOOT ' + booted + ' IMPORTED ' + imported);
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; window.__keys = [];
    window.addEventListener('keydown', e => window.__keys.push(e.key));
    const [p, c] = window.fighters; p.hitstun = 0; p.velocity.set(0,0,0); p.position.y = 0; p.percent = 0;
    c.position.set(p.position.x + 1.25, 0, p.position.z); c.hitstun = 0; c.velocity.set(0,0,0); c.percent = 0; p.facing = 1;
    window.smashCamera.spectate({ fighter: p, framing: 'full', yaw: 20, pitch: 8 }); });
  await page.locator('canvas').first().click({ position: { x: 320, y: 240 }, force: true });
  await page.evaluate(() => { window.__g = 0; });
  let groundedRun = 0;
  for (let i = 0; i < 90 && groundedRun < 3; i++) { await adv(1); groundedRun = await page.evaluate(() => window.fighters[0].isGrounded ? (window.__g += 1) : (window.__g = 0)); }
  const sample = () => page.evaluate(() => { const THREE = window.__browserSmashThree, cam = window.smashCamera.camera;
    const f = window.fighters[0], u = f.model.userData, a = u.lastMoveAction;
    const base = new THREE.Vector3(); f.model.getWorldPosition(base);
    const head = base.clone(); head.y += 1.7; const pj = v => v.clone().project(cam);
    const h = pj(head), ft = pj(base);
    const running = (u.humanMixer?._actions || []).filter(x => x.isRunning() && x.getEffectiveWeight() > 0.01)
      .map(x => x.getClip().name + ':' + x.getEffectiveWeight().toFixed(2));
    return { gnd: !!f.isGrounded, spd: +Math.hypot(f.velocity.x, f.velocity.z).toFixed(1), clip: a ? a.getClip().name : null,
      t: a ? +a.time.toFixed(2) : null, mixerT: +u.humanMixer.time.toFixed(2), running,
      vis: [h, ft].every(v => Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1), camD: +cam.position.distanceTo(base).toFixed(1),
      stun: +(f.hitstun || 0).toFixed(2), cpuPct: +window.fighters[1].percent.toFixed(1) }; });
  const runState = async (name, keys, frames, tap) => {
    for (const k of keys) await page.keyboard.down(k);
    if (tap) { await page.keyboard.down(tap); await adv(1); await page.keyboard.up(tap); }
    const rows = []; for (let i = 0; i < frames; i++) { await adv(1); rows.push(await sample()); }
    for (const k of keys.slice().reverse()) await page.keyboard.up(k);
    out.states[name] = rows;
    console.log('STATE ' + name + ' ' + JSON.stringify({ gnd: rows.filter(r => r.gnd).length + '/' + rows.length,
      vis: rows.filter(r => r.vis).length + '/' + rows.length, mixer: rows[0].mixerT + '->' + rows[rows.length-1].mixerT,
      clips: [...new Set(rows.map(r => r.clip))], running: [...new Set(rows.flatMap(r => r.running))].slice(0, 4),
      spd: Math.max(...rows.map(r => r.spd)), camD: rows[0].camD, cpuPct: rows[rows.length-1].cpuPct }));
    return rows;
  };
  await runState('idle', [], 10);
  await runState('walk', ['d'], 12);
  await runState('run', ['d','Shift'], 12);
  for (let i = 0; i < 8; i++) await adv(1);
  await runState('jab', [], 24, 'j');
  for (let i = 0; i < 6; i++) await adv(1);
  await runState('grab', [], 18, 'u');
  await page.evaluate(() => { const [p, c] = window.fighters; p.hitstun = 0; p.velocity.set(0,0,0);
    c.position.set(p.position.x + 0.95, 0, p.position.z); c.percent = 0; window.__browserSmashFreezeAI = false; });
  let hitFrame = -1;
  for (let i = 0; i < 180; i++) { await adv(1); if (await page.evaluate(() => window.fighters[0].hitstun > 0)) { hitFrame = i; break; } }
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; });
  const hitRows = []; for (let i = 0; i < 12; i++) { await adv(1); hitRows.push(await sample()); }
  out.hit = { hitFrame, rows: hitRows };
  console.log('HIT ' + JSON.stringify({ hitFrame, clips: [...new Set(hitRows.map(r => r.clip))],
    stunMax: Math.max(...hitRows.map(r => r.stun)), gnd: hitRows.filter(r => r.gnd).length + '/' + hitRows.length }));
  const after = await runState('walkAfterHit', ['d','Shift'], 14);
  console.log('CROSSFADE ' + JSON.stringify({ clips: [...new Set(after.map(r => r.clip))],
    staleHitStillRunning: after.some(r => r.running.some(x => /^hit/.test(x))), last: after[after.length-1].running }));
  await writeFile(resolve(outDir, 'cycle.json'), JSON.stringify(out, null, 2));
  console.log('DONE frameErrors=' + JSON.stringify(await page.evaluate(() => window.__frameErrors.slice(0, 3))));
} catch (e) { console.log('ERROR ' + String((e && e.message) || e).slice(0, 240)); }
finally { await browser.close(); }
