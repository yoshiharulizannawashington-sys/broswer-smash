import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const outDir = resolve(process.cwd(), 'artifacts/dev/phase28427');
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl',
  '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 560, height: 420 } });
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
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  const booted = await wait(() => Boolean(window.__browserSmashStep && window.fighters), 45000);
  await page.evaluate(() => { const s = document.querySelector('#p1Character'); const o = s && [...s.options].find(i => i.value === 'Kaze');
    if (o) { s.value = 'Kaze'; s.dispatchEvent(new Event('change', { bubbles: true })); } document.querySelector('#play')?.click(); });
  const imported = await wait(() => { const u = window.fighters?.[0]?.model?.userData; if (!u?.assetUrl || !u.hasAnimationClips) return false;
    let b = 0; window.fighters[0].model.traverse?.(n => { if (n.isSkinnedMesh) b = Math.max(b, n.skeleton?.bones?.length || 0); }); return b >= 40; }, 45000);
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; document.body.setAttribute('tabindex', '-1'); document.body.focus();
    window.smashCamera.spectate({ fighter: window.fighters[0], framing: 'full', yaw: 30, pitch: 8 }); });
  const grabClipName = await page.evaluate(() => { const a = window.fighters[0].model.userData.grabAction; return a ? a.getClip().name : null; });
  console.log('BOOT ' + booted + ' IMPORTED ' + imported + ' grabActionClip=' + grabClipName);
  const reset = dx => page.evaluate(d => { const [p, c] = window.fighters;
    p.hitstun = 0; p.velocity.set(0,0,0); p.position.y = 0; p.percent = 0;
    p.grabCooldown = 0; p.grabTarget = null; p.grabHold = 0; p.heldThrow = null; p.grabbedBy = null;
    p.attackQueue.length = 0; p.activeMoveId = null;
    c.hitstun = 0; c.velocity.set(0,0,0); c.grabbedBy = null; c.percent = 0;
    c.position.set(p.position.x + d, 0, p.position.z); p.facing = 1; }, dx);
  const sample = () => page.evaluate(() => { const f = window.fighters[0], c = window.fighters[1], u = f.model.userData, a = u.lastMoveAction;
    return { clip: a ? a.getClip().name : null, t: a ? +a.time.toFixed(2) : null, w: a ? +a.getEffectiveWeight().toFixed(2) : null,
      q: (f.attackQueue || []).length, move: f.activeMoveId || null, grab: !!f.grabTarget, held: !!c.grabbedBy,
      hold: +(f.grabHold || 0).toFixed(2), cd: +(f.grabCooldown || 0).toFixed(2), cpuPct: +c.percent.toFixed(1),
      cpuV: +Math.hypot(c.velocity.x, c.velocity.z).toFixed(1) }; });
  const press = async k => { await page.keyboard.down(k); await adv(1); await page.keyboard.up(k); };
  const rowsFor = async n => { const r = []; for (let i = 0; i < n; i++) { await adv(1); r.push(await sample()); } return r; };
  await reset(1.1); for (let i = 0; i < 3; i++) await adv(1);
  await press('u');
  const first = await rowsFor(30);
  await writeFile(resolve(outDir, 'lifecycle-first.json'), JSON.stringify(first));
  console.log('STARTUP_CLIP ' + JSON.stringify([...new Set(first.map(r => r.clip))]) + ' firstClip=' + first[0].clip);
  console.log('THROW ' + JSON.stringify({ holdFrames: first.filter(r => r.grab).length, maxHold: Math.max(...first.map(r => r.hold)),
    cpuPct: first[first.length-1].cpuPct, launch: Math.max(...first.map(r => r.cpuV)), cdAfter: first[first.length-1].cd,
    cleared: first[first.length-1].grab === false && first[first.length-1].held === false }));
  // Second press inside the cooldown must not start another move.
  await press('u');
  const during = await rowsFor(6);
  console.log('COOLDOWN ' + JSON.stringify({ cd: first[first.length-1].cd, grabbedAgain: during.some(r => r.grab), q: during.map(r => r.q) }));
  for (let i = 0; i < 70; i++) await adv(1);
  await reset(1.1); for (let i = 0; i < 3; i++) await adv(1);
  await press('u');
  const second = await rowsFor(24);
  console.log('REPEAT ' + JSON.stringify({ clips: [...new Set(second.map(r => r.clip))], grabbed: second.some(r => r.grab),
    cpuPct: second[second.length-1].cpuPct, cleared: second[second.length-1].grab === false }));
  await reset(1.15); for (let i = 0; i < 3; i++) await adv(1);
  const before = await page.evaluate(() => window.fighters[1].percent);
  await press('j');
  const jab = await rowsFor(20);
  console.log('JAB ' + JSON.stringify({ clips: [...new Set(jab.map(r => r.clip))], before: +before.toFixed(1),
    after: +jab[jab.length-1].cpuPct.toFixed(1) }));
  console.log('DONE frameErrors=' + JSON.stringify(await page.evaluate(() => window.__frameErrors.slice(0, 3))));
} catch (e) { console.log('ERROR ' + String((e && e.message) || e).slice(0, 200)); }
finally { await browser.close(); }
