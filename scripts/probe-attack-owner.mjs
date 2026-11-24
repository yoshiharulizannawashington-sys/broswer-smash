// Who owns the pose during an attack, and does the sword follow the hand?
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
const rows = [];
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashStep && window.fighters), null, { timeout: 120000, polling: 200 });
  await page.evaluate(() => {
    const s = document.querySelector('#p1Character');
    const o = s && [...s.options].find(o => o.value === 'Kaze');
    if (o) { s.value = 'Kaze'; s.dispatchEvent(new Event('change', { bubbles: true })); }
    document.querySelector('#play')?.click();
  });
  await page.waitForFunction(() => Boolean(window.fighters?.[0]?.model?.userData?.hasAnimationClips), null, { timeout: 60000, polling: 200 }).catch(() => {});
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    const THREE = window.__browserSmashThree, f = window.fighters[0], u = f.model.userData;
    const hand = u.rightHand || u.leftHand;
    const holder = hand?.userData?.weaponHolder;
    const sword = holder?.children?.find(c => c.isMesh || c.isObject3D) || holder;
    window.__p = { THREE, f, hand, holder, sword };
    window.smashCamera.spectate({ fighter: f, framing: 'full', yaw: 35, pitch: 0 });
    window.__browserSmashStep?.(0.1);
  });
  const read = () => page.evaluate(() => {
    const { THREE, f, hand, sword } = window.__p;
    const u = f.model.userData;
    const c = u.animationController;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    if (sword) sword.getWorldPosition(a);
    if (hand) hand.getWorldPosition(b);
    return {
      controller: !!c, ctrlActive: c ? c.describe().active : null,
      humanMixer: !!u.humanMixer, clips: u.hasAnimationClips ? true : false,
      currentClip: u.currentClip || null,
      lastMove: u.lastMoveAction?.getClip?.()?.name || null,
      queue: (f.attackQueue || []).length,
      gap: sword && hand ? +a.distanceTo(b).toFixed(3) : null,
      swordName: sword?.name || null,
      cpuDistance: +Math.hypot(window.fighters[1].position.x - f.position.x, window.fighters[1].position.z - f.position.z).toFixed(2)
    };
  });
  await page.evaluate(() => { const c = window.fighters[1]; c.position.set(window.fighters[0].position.x + 0.8, c.position.y, window.fighters[0].position.z); window.__browserSmashStep?.(0.02); });
  rows.push({ phase: 'placed', ...(await read()) });
  await page.keyboard.press('j');
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.__browserSmashStep?.(1 / 30));
    rows.push({ phase: 'attack+' + i, ...(await read()) });
  }
  console.log('OWNER:' + JSON.stringify({ rows, errors }));
} finally { await browser.close(); }
