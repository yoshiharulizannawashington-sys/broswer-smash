import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const outDir = resolve(process.cwd(), 'artifacts/dev/phase28426');
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl',
  '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 560, height: 420 } });
page.setDefaultTimeout(60000);
page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('NAV ' + f.url()); });
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
  console.log('BOOT ' + booted + ' IMPORTED ' + imported + ' focus=' + await page.evaluate(() => document.activeElement?.tagName));
  const reset = dx => page.evaluate(d => { const [p, c] = window.fighters;
    p.hitstun = 0; p.velocity.set(0,0,0); p.position.y = 0; p.percent = 0;
    p.grabCooldown = 0; p.grabTarget = null; p.grabHold = 0; p.heldThrow = null; p.grabbedBy = null;
    p.attackQueue.length = 0; p.activeMoveId = null;
    c.hitstun = 0; c.velocity.set(0,0,0); c.grabbedBy = null; c.percent = 0;
    c.position.set(p.position.x + d, 0, p.position.z); p.facing = 1; }, dx);
  const sample = () => page.evaluate(() => { const THREE = window.__browserSmashThree;
    const f = window.fighters[0], c = window.fighters[1], u = f.model.userData, a = u.lastMoveAction;
    const hand = u.rightHand, holder = hand?.getObjectByName?.('weapon-holder') || hand?.userData?.weaponHolder;
    const eq = holder?.children.find(x => String(x.name || '').startsWith('Equipped')) || null;
    let grip = null;
    if (eq && hand) { hand.updateWorldMatrix(true, false); eq.updateWorldMatrix(true, false);
      const h = new THREE.Vector3(), g = new THREE.Vector3(); hand.getWorldPosition(h); eq.getWorldPosition(g);
      grip = +h.distanceTo(g).toFixed(4); }
    return { clip: a ? a.getClip().name : null, t: a ? +a.time.toFixed(2) : null,
      w: a ? +a.getEffectiveWeight().toFixed(2) : null, q: (f.attackQueue || []).length, move: f.activeMoveId || null,
      grab: !!f.grabTarget, held: !!c.grabbedBy, hold: +(f.grabHold || 0).toFixed(2),
      throwT: f.heldThrow ? +(f.heldThrow.t || 0).toFixed(2) : null,
      cpuPct: +c.percent.toFixed(1), cpuStun: +(c.hitstun || 0).toFixed(2),
      gap: +Math.hypot(f.position.x - c.position.x, f.position.z - c.position.z).toFixed(2), grip,
      impact: window.__browserSmashLastImpact ? { type: window.__browserSmashLastImpact.type, dealt: window.__browserSmashLastImpact.dealt } : null }; });
  const runGrab = async dx => {
    await reset(dx); for (let i = 0; i < 3; i++) await adv(1);
    await page.keyboard.down('u'); await adv(1); await page.keyboard.up('u');
    const rows = []; for (let i = 0; i < 30; i++) { await adv(1); rows.push(await sample()); }
    await writeFile(resolve(outDir, `grab-${dx}.json`), JSON.stringify(rows));
    console.log('GRAB@' + dx + ' ' + JSON.stringify({ clips: [...new Set(rows.map(r => r.clip))],
      firstGrab: rows.findIndex(r => r.grab), holdFrames: rows.filter(r => r.grab).length,
      maxHold: Math.max(...rows.map(r => r.hold)), heldSeen: rows.some(r => r.held),
      throwSeen: rows.some(r => r.throwT !== null), cpuPct: rows[rows.length-1].cpuPct,
      moves: [...new Set(rows.map(r => r.move))], grips: [...new Set(rows.map(r => r.grip))] }));
    for (let i = 0; i < 60; i++) await adv(1);
  };
  await runGrab(0.7); await runGrab(0.9); await runGrab(1.1);
  await reset(1.1); for (let i = 0; i < 3; i++) await adv(1);
  const before = await page.evaluate(() => window.fighters[1].percent);
  await page.keyboard.down('j'); await adv(1); await page.keyboard.up('j');
  const jrows = []; for (let i = 0; i < 22; i++) { await adv(1); jrows.push(await sample()); }
  const after = await page.evaluate(() => window.fighters[1].percent);
  await writeFile(resolve(outDir, 'jab.json'), JSON.stringify({ before, after, rows: jrows }));
  console.log('JAB ' + JSON.stringify({ clips: [...new Set(jrows.map(r => r.clip))], before: +before.toFixed(1), after: +after.toFixed(1),
    stun: Math.max(...jrows.map(r => r.cpuStun)), impact: jrows.map(r => r.impact).filter(Boolean).slice(0, 2), grip: jrows[0].grip }));
  console.log('DONE frameErrors=' + JSON.stringify(await page.evaluate(() => window.__frameErrors.slice(0, 3))));
} catch (e) { console.log('ERROR ' + String((e && e.message) || e).slice(0, 200)); }
finally { await browser.close(); }
