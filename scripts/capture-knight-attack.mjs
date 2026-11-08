// Attack/grab input delivery: a held key is sampled by the game's own input.update() inside
// __browserSmashStep, so logic can be proven cheaply; real frames then prove the pose.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const outDir = resolve(process.cwd(), 'artifacts/dev/phase28423/shots');
await mkdir(outDir, { recursive: true });
const errors = [];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl',
  '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 420, height: 320 } });
page.setDefaultTimeout(150000);
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashStep && window.fighters), null, { timeout: 140000, polling: 150 });
  await page.evaluate(() => {
    const s = document.querySelector('#p1Character');
    const o = s && [...s.options].find(i => i.value === 'Kaze');
    if (o) { s.value = 'Kaze'; s.dispatchEvent(new Event('change', { bubbles: true })); }
    document.querySelector('#play')?.click();
  });
  await page.waitForFunction(() => {
    const f = window.fighters?.[0]; const u = f?.model?.userData;
    if (!u?.assetUrl || !u.hasAnimationClips || !u.humanMixer) return false;
    let bones = 0; f.model.traverse?.(n => { if (n.isSkinnedMesh) bones = Math.max(bones, n.skeleton?.bones?.length || 0); });
    return bones >= 40;
  }, null, { timeout: 60000, polling: 120 }).catch(() => {});
  const identity = await page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData, m = u.humanMixer;
    let bones = 0; f.model.traverse?.(n => { if (n.isSkinnedMesh) bones = Math.max(bones, n.skeleton?.bones?.length || 0); });
    let inModel = false;
    for (let p = m?._root; p; p = p.parent) if (p === f.model) { inModel = true; break; }
    return { assetUrl: u.assetUrl || null, bones, actions: (m?._actions || []).length, mixerBelongs: inModel, controller: !!u.animationController };
  });
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    window.__keys = [];
    window.addEventListener('keydown', e => window.__keys.push(e.key));
    const f = window.fighters[0], c = window.fighters[1];
    f.hitstun = 0; f.velocity.y = 0; f.position.y = 0;
    c.position.set(f.position.x + 1.4, f.position.y, f.position.z);
    window.smashCamera.spectate({ fighter: f, framing: 'full', yaw: 60, pitch: 12 });
  });
  await page.locator('canvas').first().click({ position: { x: 210, y: 160 }, force: true });
  const pump = () => page.screenshot({ type: 'jpeg', quality: 40 });
  const probe = () => page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData, a = u.lastMoveAction;
    const act = f.attackQueue?.[f.attackQueue.length - 1] || null;
    return { q: (f.attackQueue || []).length, kind: act?.kind || null, clip: a ? a.getClip().name : null,
      t: a ? +a.time.toFixed(2) : null, w: a ? +a.getEffectiveWeight().toFixed(2) : null,
      mixerT: +u.humanMixer.time.toFixed(2), g: !!f.isGrounded, spd: +Math.hypot(f.velocity?.x||0, f.velocity?.z||0).toFixed(2),
      cpuPct: +window.fighters[1].percent.toFixed(1), keys: (window.__keys || []).slice(-3), grab: !!f.grabTarget, held: !!f.grabbedBy };
  });
  const state = async (name, key, pre) => {
    if (pre) await pre();
    await page.keyboard.down(key);
    await page.evaluate(() => window.__browserSmashStep?.(0.1));
    const seq = [];
    for (let i = 0; i < 4; i++) { await pump(); seq.push(await probe()); }
    await page.screenshot({ path: resolve(outDir, `knight-${name}.jpg`), type: 'jpeg', quality: 72 });
    await page.keyboard.up(key);
    await writeFile(resolve(outDir, `state-${name}.json`), JSON.stringify({ name, identity, seq, errors }, null, 2));
    console.log('STATE ' + name + ' ' + JSON.stringify(seq.map(s => [s.q, s.kind, s.clip, s.t, s.w, s.mixerT, s.g, s.cpuPct, s.grab, s.held])));
  };
  await state('attack', 'j');
  await page.evaluate(() => { const f = window.fighters[0], c = window.fighters[1]; f.velocity.set(0,0,0); c.position.set(f.position.x + 1.1, f.position.y, f.position.z); f.hitstun = 0; });
  await state('grab', 'u');
  console.log('DONE');
} finally { await browser.close(); }
