// End-to-end attack trace for Knight-as-Kaze on a virtual 1/60 s clock.
// rAF + performance.now are captured before page scripts run; the renderer is muted during the
// trace so frames cost animation+simulation only, and restored for the evidence stills.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const outDir = resolve(process.cwd(), 'artifacts/dev/phase28424');
await mkdir(resolve(outDir, 'shots'), { recursive: true });
const t0 = Date.now();
const errors = [];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl',
  '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
page.setDefaultTimeout(60000);
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
await page.addInitScript(() => {
  let virtual = 0; const queue = []; window.__frameErrors = [];
  performance.now = () => virtual;
  window.requestAnimationFrame = cb => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  window.__advance = (n = 1, dt = 1000 / 60) => {
    for (let i = 0; i < n; i++) {
      virtual += dt;
      for (const cb of queue.splice(0, queue.length)) { try { cb(virtual); } catch (e) { window.__frameErrors.push(String((e && e.message) || e)); } }
    }
    return queue.length;
  };
});
const mute = on => page.evaluate(v => {
  const r = window.__browserSmashRenderer;
  if (!r) return 'no-renderer';
  if (v) { if (!r.__orig) r.__orig = r.render; r.render = () => {}; return 'muted'; }
  if (r.__orig) { r.render = r.__orig; delete r.__orig; }
  return 'restored';
}, on);
const wait = async (fn, deadlineMs, label) => {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    await mute(true);
    if (await page.evaluate(fn)) return true;
    await page.evaluate(() => window.__advance?.(1));
    await page.waitForTimeout(5);
  }
  console.log('TIMEOUT ' + label + ' after ' + deadlineMs + 'ms');
  return false;
};
const out = { weapon: null, attack: [], heavy: [], grab: [], damage: {}, errors };
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  const booted = await wait(() => Boolean(window.__browserSmashStep && window.fighters), 45000, 'boot');
  console.log('BOOT ' + booted + ' in ' + (Date.now() - t0) + 'ms frames=' + await page.evaluate(() => window.__browserSmashFrames || 0));
  await page.evaluate(() => {
    const s = document.querySelector('#p1Character');
    const o = s && [...s.options].find(i => i.value === 'Kaze');
    if (o) { s.value = 'Kaze'; s.dispatchEvent(new Event('change', { bubbles: true })); }
    document.querySelector('#play')?.click();
  });
  const imported = await wait(() => {
    const f = window.fighters?.[0], u = f?.model?.userData;
    if (!u?.assetUrl || !u.hasAnimationClips || !u.humanMixer) return false;
    let bones = 0; f.model.traverse?.(n => { if (n.isSkinnedMesh) bones = Math.max(bones, n.skeleton?.bones?.length || 0); });
    return bones >= 40;
  }, 45000, 'import');
  console.log('IMPORTED ' + imported + ' in ' + (Date.now() - t0) + 'ms');
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true; window.__keys = [];
    window.addEventListener('keydown', e => window.__keys.push(e.key));
  });
  const weaponOk = await wait(() => {
    const f = window.fighters?.[0], hand = f?.model?.userData?.rightHand;
    const holder = hand?.getObjectByName?.('weapon-holder') || hand?.userData?.weaponHolder;
    return Boolean(holder && holder.children.some(c => String(c.name || '').startsWith('Equipped')));
  }, 20000, 'weapon');
  out.weapon = await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const f = window.fighters[0], u = f.model.userData;
    const hand = u.rightHand;
    const holder = hand?.getObjectByName?.('weapon-holder') || hand?.userData?.weaponHolder || null;
    const equipped = holder ? holder.children.find(c => String(c.name || '').startsWith('Equipped')) || null : null;
    let meshes = 0, tris = 0, grip = null, centerOff = null, size = null;
    hand?.updateWorldMatrix(true, false);
    const handPos = new THREE.Vector3(); hand?.getWorldPosition(handPos);
    if (equipped) {
      equipped.updateWorldMatrix(true, true);
      const gp = new THREE.Vector3(); equipped.getWorldPosition(gp);
      grip = +gp.distanceTo(handPos).toFixed(4);
      const box = new THREE.Box3().setFromObject(equipped);
      centerOff = +box.getCenter(new THREE.Vector3()).distanceTo(handPos).toFixed(4);
      const s = box.getSize(new THREE.Vector3());
      size = [+s.x.toFixed(3), +s.y.toFixed(3), +s.z.toFixed(3)];
      equipped.traverse(n => { if (n.isMesh) { meshes++; tris += (n.geometry?.index?.count || n.geometry?.attributes?.position?.count || 0) / 3; } });
    }
    return { hand: hand?.name || null, holder: holder?.name || null, holderParent: holder?.parent?.name || null,
      equipped: equipped?.name || null, equippedParent: equipped?.parent?.name || null,
      underHolder: Boolean(equipped && holder && equipped.parent === holder), meshes, tris: Math.round(tris),
      grip, centerOff, size, assetUrl: u.assetUrl };
  });
  console.log('WEAPON ' + JSON.stringify(out.weapon));
  await page.evaluate(() => {
    const [p, c] = window.fighters;
    p.hitstun = 0; p.velocity.set(0, 0, 0); p.position.y = 0; p.percent = 0;
    c.position.set(p.position.x + 1.3, p.position.y, p.position.z);
    c.percent = 0; c.hitstun = 0; c.velocity.set(0, 0, 0);
    p.facing = 1;
    window.smashCamera.spectate({ fighter: p, framing: 'full', yaw: 20, pitch: 8 });
  });
  await page.locator('canvas').first().click({ position: { x: 240, y: 180 }, force: true });
  out.focus = await page.evaluate(() => document.activeElement?.tagName || null);
  const trace = () => page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const f = window.fighters[0], u = f.model.userData, a = u.lastMoveAction;
    const hand = u.rightHand;
    const holder = hand?.getObjectByName?.('weapon-holder') || hand?.userData?.weaponHolder || null;
    const equipped = holder ? holder.children.find(c => String(c.name || '').startsWith('Equipped')) || null : null;
    let gripv = null;
    if (equipped && hand) {
      equipped.updateWorldMatrix(true, false); hand.updateWorldMatrix(true, false);
      const h = new THREE.Vector3(), g = new THREE.Vector3();
      hand.getWorldPosition(h); equipped.getWorldPosition(g);
      gripv = +h.distanceTo(g).toFixed(4);
    }
    const c = window.fighters[1];
    const dur = a ? a.getClip().duration : 0, t = a ? a.time : 0;
    const name = a ? a.getClip().name : '';
    const phase = !/jab|punch|attack|kick|slash/i.test(name) ? 'idle'
      : t < dur * 0.35 ? 'startup' : t < dur * 0.7 ? 'active' : 'recovery';
    return { clip: name, t: +t.toFixed(3), dur: +dur.toFixed(2), phase,
      w: a ? +a.getEffectiveWeight().toFixed(2) : null, mixerT: +u.humanMixer.time.toFixed(2),
      q: (f.attackQueue || []).length, kind: f.attackQueue?.[f.attackQueue.length - 1]?.kind || null,
      spd: +Math.hypot(f.velocity.x, f.velocity.z).toFixed(2), y: +f.position.y.toFixed(2),
      gap: +Math.hypot(f.position.x - c.position.x, f.position.z - c.position.z).toFixed(2),
      cpuPct: +c.percent.toFixed(2), cpuStun: +(c.hitstun || 0).toFixed(2),
      cpuV: +Math.hypot(c.velocity.x, c.velocity.z).toFixed(2), grip: gripv };
  });
  const adv = () => page.evaluate(() => window.__advance(1));
  const shoot = async (name, phase) => {
    await mute(false); await adv();
    await page.screenshot({ path: resolve(outDir, `shots/${name}-${phase}.jpg`), type: 'jpeg', quality: 80 });
    await mute(true);
  };
  const run = async (name, key, frames) => {
    const before = await page.evaluate(() => window.fighters[1].percent);
    await page.keyboard.down(key); await adv();
    const rows = [await trace()];
    await page.keyboard.up(key);
    for (let i = 1; i < frames; i++) { await adv(); rows.push(await trace()); }
    const after = await page.evaluate(() => window.fighters[1].percent);
    out[name] = rows; out.damage[name] = { before: +before.toFixed(2), after: +after.toFixed(2) };
    const g = rows.map(r => r.grip).filter(v => typeof v === 'number');
    const phases = rows.map(r => r.phase[0]).join('');
    await shoot(name, rows.find(r => r.phase === 'active') ? 'active' : 'frame' + rows[1]?.phase);
    console.log('TRACE ' + name + ' ' + JSON.stringify({ clips: [...new Set(rows.map(r => r.clip))], phases,
      gripMin: g.length ? Math.min(...g) : null, gripMax: g.length ? Math.max(...g) : null,
      gripAvg: g.length ? +(g.reduce((a, b) => a + b, 0) / g.length).toFixed(4) : null,
      stall: rows.filter(r => r.clip === 'idle' && r.phase === 'idle').length,
      dmg: out.damage[name], cpuStunMax: Math.max(...rows.map(r => r.cpuStun)),
      cpuVMax: Math.max(...rows.map(r => r.cpuV)), gap: rows[0].gap }));
  };
  await adv(); await adv();
  await run('attack', 'j', 22);
  for (let i = 0; i < 6; i++) await adv();
  await run('heavy', 'j', 26);
  for (let i = 0; i < 6; i++) await adv();
  await run('grab', 'u', 20);
  out.frameErrors = await page.evaluate(() => window.__frameErrors.slice(0, 3));
  await writeFile(resolve(outDir, 'trace.json'), JSON.stringify(out, null, 2));
  console.log('FOCUS ' + out.focus + ' weaponOk ' + weaponOk + ' frameErrors ' + JSON.stringify(out.frameErrors));
} catch (e) {
  console.log('ERROR ' + String(e && e.message || e).slice(0, 300));
} finally { await browser.close(); }
