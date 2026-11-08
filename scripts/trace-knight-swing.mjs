// Attack stills at the active frame + weapon parentage + a grab attempt at true melee range.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const outDir = resolve(process.cwd(), 'artifacts/dev/phase28424');
await mkdir(resolve(outDir, 'shots'), { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl',
  '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 520, height: 400 } });
page.setDefaultTimeout(60000);
await page.addInitScript(() => {
  let virtual = 0; const queue = []; window.__frameErrors = [];
  performance.now = () => virtual;
  window.requestAnimationFrame = cb => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  window.__advance = (n = 1, dt = 1000 / 60) => {
    for (let i = 0; i < n; i++) { virtual += dt; for (const cb of queue.splice(0, queue.length)) { try { cb(virtual); } catch (e) { window.__frameErrors.push(String((e && e.message) || e)); } } }
    return queue.length;
  };
});
const mute = on => page.evaluate(v => { const r = window.__browserSmashRenderer; if (!r) return 'none';
  if (v) { if (!r.__orig) r.__orig = r.render; r.render = () => {}; } else if (r.__orig) { r.render = r.__orig; delete r.__orig; } return v ? 'muted' : 'restored'; }, on);
const adv = n => page.evaluate(k => window.__advance(k), n);
const wait = async (fn, ms) => { const end = Date.now() + ms;
  while (Date.now() < end) { await mute(true); if (await page.evaluate(fn)) return true; await adv(1); await page.waitForTimeout(5); }
  return false; };
const out = {};
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await wait(() => Boolean(window.__browserSmashStep && window.fighters), 45000);
  await page.evaluate(() => { const s = document.querySelector('#p1Character');
    const o = s && [...s.options].find(i => i.value === 'Kaze');
    if (o) { s.value = 'Kaze'; s.dispatchEvent(new Event('change', { bubbles: true })); }
    document.querySelector('#play')?.click(); });
  await wait(() => { const u = window.fighters?.[0]?.model?.userData;
    if (!u?.assetUrl || !u.hasAnimationClips) return false;
    let b = 0; window.fighters[0].model.traverse?.(n => { if (n.isSkinnedMesh) b = Math.max(b, n.skeleton?.bones?.length || 0); });
    return b >= 40; }, 45000);
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; window.__keys = [];
    window.addEventListener('keydown', e => window.__keys.push(e.key)); });
  await wait(() => { const h = window.fighters?.[0]?.model?.userData?.rightHand;
    const w = h?.getObjectByName?.('weapon-holder') || h?.userData?.weaponHolder;
    return Boolean(w && w.children.some(c => String(c.name || '').startsWith('Equipped'))); }, 20000);
  // Weapon parentage, resolved by ancestry rather than by a single name field.
  out.weapon = await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const f = window.fighters[0], u = f.model.userData, hand = u.rightHand;
    const holder = hand?.getObjectByName?.('weapon-holder') || hand?.userData?.weaponHolder || null;
    const eq = holder?.children.find(c => String(c.name || '').startsWith('Equipped')) || null;
    const ancestorNames = o => { const a = []; for (let p = o; p && a.length < 8; p = p.parent) a.push(p.name || p.type); return a; };
    const handPos = new THREE.Vector3(), swordPos = new THREE.Vector3();
    hand.updateWorldMatrix(true, false); eq?.updateWorldMatrix(true, true);
    hand.getWorldPosition(handPos); eq?.getWorldPosition(swordPos);
    let holderUnderHand = false;
    for (let p = holder; p; p = p.parent) if (p === hand) { holderUnderHand = true; break; }
    return { hand: hand?.name, handParent: hand?.parent?.name, handChain: ancestorNames(hand).slice(0, 5),
      holder: holder?.name, holderParent: holder?.parent?.name, holderChain: ancestorNames(holder).slice(0, 5),
      holderUnderHand, equipped: eq?.name, equippedParent: eq?.parent?.name,
      grip: +handPos.distanceTo(swordPos).toFixed(4),
      handWorld: [+handPos.x.toFixed(3), +handPos.y.toFixed(3), +handPos.z.toFixed(3)] };
  });
  console.log('WEAPON ' + JSON.stringify(out.weapon));
  await page.evaluate(() => { const [p, c] = window.fighters;
    p.hitstun = 0; p.velocity.set(0, 0, 0); p.position.y = 0; p.percent = 0;
    c.position.set(p.position.x + 1.25, p.position.y, p.position.z);
    c.percent = 0; c.hitstun = 0; c.velocity.set(0, 0, 0); p.facing = 1;
    window.smashCamera.spectate({ fighter: p, framing: 'full', yaw: 20, pitch: 6 }); });
  await page.locator('canvas').first().click({ position: { x: 260, y: 200 }, force: true });
  const shot = async name => { await mute(false); await page.evaluate(() => window.__advance(0)); await page.screenshot({ path: resolve(outDir, `shots/${name}.jpg`), type: 'jpeg', quality: 82 }); await mute(true); };
  const read = () => page.evaluate(() => {
    const THREE = window.__browserSmashThree, f = window.fighters[0], u = f.model.userData, a = u.lastMoveAction;
    const hand = u.rightHand, holder = hand?.getObjectByName?.('weapon-holder') || hand?.userData?.weaponHolder;
    const eq = holder?.children.find(c => String(c.name || '').startsWith('Equipped')) || null;
    let grip = null;
    if (eq && hand) { hand.updateWorldMatrix(true, false); eq.updateWorldMatrix(true, false);
      const h = new THREE.Vector3(), g = new THREE.Vector3(); hand.getWorldPosition(h); eq.getWorldPosition(g);
      grip = +h.distanceTo(g).toFixed(4); }
    const c = window.fighters[1], dur = a ? a.getClip().duration : 0, t = a ? a.time : 0;
    const n = a ? a.getClip().name : '';
    return { clip: n, t: +t.toFixed(2), dur: +dur.toFixed(2),
      phase: !/jab|punch|attack|kick|slash/i.test(n) ? 'idle' : t < dur * .35 ? 'startup' : t < dur * .7 ? 'active' : 'recovery',
      grip, q: (f.attackQueue || []).length, grabTarget: !!f.grabTarget, held: !!f.grabbedBy,
      gap: +Math.hypot(f.position.x - c.position.x, f.position.z - c.position.z).toFixed(2),
      cpuPct: +c.percent.toFixed(1), cpuStun: +(c.hitstun || 0).toFixed(2) };
  });
  // Attack: advance to the first active frame, then shoot front and side.
  await page.keyboard.down('j'); await adv(1); await page.keyboard.up('j');
  let frames = [];
  for (let i = 0; i < 20; i++) { await adv(1); const r = await read(); frames.push(r); if (r.phase === 'active') break; }
  out.attack = frames;
  await shot('attack-active-front');
  await page.evaluate(() => window.smashCamera.spectate({ fighter: window.fighters[0], framing: 'full', yaw: 75, pitch: 6 }));
  await adv(1); await shot('attack-active-side');
  await page.evaluate(() => window.smashCamera.spectate({ fighter: window.fighters[0], framing: 'full', yaw: 20, pitch: 6 }));
  const g1 = frames.map(f => f.grip).filter(v => typeof v === 'number');
  console.log('SWING ' + JSON.stringify({ frames: frames.length, phases: frames.map(f => f.phase[0]).join(''),
    clips: [...new Set(frames.map(f => f.clip))], gripMin: Math.min(...g1), gripMax: Math.max(...g1) }));
  // Grab at true melee range on a fresh opponent.
  await page.evaluate(() => { const [p, c] = window.fighters;
    p.hitstun = 0; p.velocity.set(0, 0, 0); c.position.set(p.position.x + 1.05, p.position.y, p.position.z);
    c.hitstun = 0; c.velocity.set(0, 0, 0); c.percent = 0; p.facing = 1; });
  await adv(2);
  await page.keyboard.down('u'); await adv(1); await page.keyboard.up('u');
  const grabf = [];
  for (let i = 0; i < 16; i++) { await adv(1); grabf.push(await read()); }
  out.grab = grabf;
  await shot('grab-frame');
  console.log('GRAB ' + JSON.stringify({ clips: [...new Set(grabf.map(f => f.clip))], phases: grabf.map(f => f.phase[0]).join(''),
    grabTarget: grabf.some(f => f.grabTarget), held: grabf.some(f => f.held),
    cpuPct: grabf.map(f => f.cpuPct)[grabf.length - 1], gap: grabf.map(f => f.gap)[0],
    gripMin: Math.min(...grabf.map(f => f.grip).filter(v => typeof v === 'number')) }));
  await writeFile(resolve(outDir, 'swing.json'), JSON.stringify(out, null, 2));
} catch (e) { console.log('ERROR ' + String((e && e.message) || e).slice(0, 260)); }
finally { await browser.close(); }
