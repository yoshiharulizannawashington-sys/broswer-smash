// Pose stills frozen at the sampled frame: the game clock is virtual, and each still renders one
// frame through an explicitly placed camera, so the camera cannot drift back to the arena framing.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const outDir = resolve(process.cwd(), 'artifacts/dev/phase28424/shots');
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl',
  '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.setDefaultTimeout(60000);
await page.addInitScript(() => {
  let virtual = 0; const queue = [];
  performance.now = () => virtual;
  window.requestAnimationFrame = cb => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  window.__advance = (n = 1, dt = 1000 / 60) => {
    for (let i = 0; i < n; i++) { virtual += dt; for (const cb of queue.splice(0, queue.length)) cb(virtual); }
    return queue.length;
  };
});
const mute = on => page.evaluate(v => { const r = window.__browserSmashRenderer; if (!r) return; if (v) { if (!r.__o) r.__o = r.render; r.render = () => {}; } else if (r.__o) { r.render = r.__o; delete r.__o; } }, on);
const adv = n => page.evaluate(k => window.__advance(k), n);
const wait = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { await mute(true); if (await page.evaluate(fn)) return true; await adv(1); await page.waitForTimeout(5); } return false; };
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await wait(() => Boolean(window.__browserSmashStep && window.fighters), 45000);
  await page.evaluate(() => { const s = document.querySelector('#p1Character'); const o = s && [...s.options].find(i => i.value === 'Kaze');
    if (o) { s.value = 'Kaze'; s.dispatchEvent(new Event('change', { bubbles: true })); } document.querySelector('#play')?.click(); });
  await wait(() => { const u = window.fighters?.[0]?.model?.userData; if (!u?.assetUrl || !u.hasAnimationClips) return false;
    let b = 0; window.fighters[0].model.traverse?.(n => { if (n.isSkinnedMesh) b = Math.max(b, n.skeleton?.bones?.length || 0); }); return b >= 40; }, 45000);
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; });
  await wait(() => { const h = window.fighters?.[0]?.model?.userData?.rightHand;
    const w = h?.getObjectByName?.('weapon-holder') || h?.userData?.weaponHolder;
    return Boolean(w && w.children.some(c => String(c.name || '').startsWith('Equipped'))); }, 20000);
  await page.evaluate(() => { const [p, c] = window.fighters; p.hitstun = 0; p.velocity.set(0,0,0); p.position.y = 0; p.percent = 0;
    c.position.set(p.position.x + 1.2, p.position.y, p.position.z); c.percent = 0; c.hitstun = 0; c.velocity.set(0,0,0); p.facing = 1;
    window.smashCamera.spectate({ fighter: p, framing: 'full', yaw: 20, pitch: 6 }); });
  await page.locator('canvas').first().click({ position: { x: 320, y: 240 }, force: true });
  const still = async (name, dx, dy, dz) => {
    await mute(false);
    await page.evaluate(([ox, oy, oz]) => {
      const r = window.__browserSmashRenderer, cam = window.smashCamera.camera, p = window.fighters[0].position;
      cam.position.set(p.x + ox, p.y + oy, p.z + oz); cam.lookAt(p.x, p.y + 1.0, p.z); cam.updateMatrixWorld(true);
      r.render(window.__browserSmashScene, cam);
    }, [dx, dy, dz]);
    await page.screenshot({ path: resolve(outDir, name + '.jpg'), type: 'jpeg', quality: 84 });
    await mute(true);
  };
  const read = () => page.evaluate(() => { const THREE = window.__browserSmashThree, f = window.fighters[0], u = f.model.userData, a = u.lastMoveAction;
    const hand = u.rightHand, holder = hand?.getObjectByName?.('weapon-holder') || hand?.userData?.weaponHolder;
    const eq = holder?.children.find(c => String(c.name || '').startsWith('Equipped')) || null;
    let grip = null;
    if (eq && hand) { hand.updateWorldMatrix(true, false); eq.updateWorldMatrix(true, false);
      const h = new THREE.Vector3(), g = new THREE.Vector3(); hand.getWorldPosition(h); eq.getWorldPosition(g); grip = +h.distanceTo(g).toFixed(4); }
    const c = window.fighters[1], dur = a ? a.getClip().duration : 0, t = a ? a.time : 0, n = a ? a.getClip().name : '';
    return { clip: n, t: +t.toFixed(2), phase: !/jab|punch|attack|kick|slash/i.test(n) ? 'idle' : t < dur * .35 ? 'startup' : t < dur * .7 ? 'active' : 'recovery',
      grip, cpuPct: +c.percent.toFixed(1), gap: +Math.hypot(f.position.x - c.position.x, f.position.z - c.position.z).toFixed(2) }; });
  await page.keyboard.down('j'); await adv(1); await page.keyboard.up('j');
  let r = await read();
  for (let i = 0; i < 12 && r.phase === 'startup'; i++) { await adv(1); r = await read(); }
  console.log('WINDUP ' + JSON.stringify(r));
  await still('knight-attack-front', 2.4, 1.3, 2.4);
  await still('knight-attack-side', 3.0, 1.2, 0.2);
  console.log('ACTIVE ' + JSON.stringify(await read()));
  for (let i = 0; i < 12 && (await read()).phase !== 'recovery'; i++) await adv(1);
  console.log('RECOVERY ' + JSON.stringify(await read()));
  await still('knight-attack-recovery', 2.4, 1.3, 2.4);
  console.log('DONE');
} catch (e) { console.log('ERROR ' + String((e && e.message) || e).slice(0, 240)); }
finally { await browser.close(); }
