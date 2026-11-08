// Knight-as-Kaze animation capture. Proves the mounted body + its baked mixer, holds each key
// across real frames (a press between frames is invisible at software-render frame rates), and
// records the live action, mixer clock and attack queue per frame.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const outDir = resolve(process.cwd(), 'artifacts/dev/phase28423/shots');
await mkdir(outDir, { recursive: true });
const errors = [];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl',
  '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 560, height: 420 } });
page.setDefaultTimeout(180000);
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashStep && window.fighters), null, { timeout: 150000, polling: 150 });
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
  await page.waitForTimeout(400);
  const identity = await page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData, m = u.humanMixer;
    let bones = 0; f.model.traverse?.(n => { if (n.isSkinnedMesh) bones = Math.max(bones, n.skeleton?.bones?.length || 0); });
    let inModel = false;
    for (let p = m?._root; p; p = p.parent) if (p === f.model) { inModel = true; break; }
    return { fighter: f.name, identity: f.identity, assetUrl: u.assetUrl || null, bones,
      actions: (m?._actions || []).length, mixerBelongs: inModel, controller: !!u.animationController };
  });
  const framing = await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    window.__keys = [];
    window.addEventListener('keydown', e => window.__keys.push(e.key));
    window.fighters[1].position.x += 7;
    const f = window.fighters[0]; f.hitstun = 0; f.velocity.y = 0;
    let used = null;
    for (const fr of ['wide', 'arena', 'full']) {
      try { window.smashCamera.spectate({ fighter: f, framing: fr, yaw: 35, pitch: 10 }); used = fr; break; } catch (e) { }
    }
    return { used, described: window.smashCamera.describeSpectate?.() || null };
  });
  await page.locator('canvas').first().click({ position: { x: 280, y: 210 }, force: true });
  const focus = await page.evaluate(() => document.activeElement?.tagName || null);
  const probe = () => page.evaluate(() => {
    const THREE = window.__browserSmashThree, cam = window.smashCamera?.camera;
    const f = window.fighters[0], u = f.model.userData, a = u.lastMoveAction;
    const active = f.attackQueue?.[f.attackQueue.length - 1] || null;
    let hFrac = 0, onScreen = false;
    if (THREE && cam) {
      const base = new THREE.Vector3(); f.model.getWorldPosition(base);
      const head = base.clone(); head.y += 1.7; const feet = base.clone();
      const pj = v => v.clone().project(cam);
      const h = pj(head), ft = pj(feet);
      onScreen = [h, ft].every(p => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1);
      hFrac = +Math.abs(h.y - ft.y).toFixed(3);
    }
    return { spd: +Math.hypot(f.velocity?.x||0, f.velocity?.z||0).toFixed(2), grounded: !!f.isGrounded,
      queue: (f.attackQueue || []).length, kind: active?.kind || null, cd: +(f.attackCooldown || 0).toFixed(2),
      clip: a ? a.getClip().name : null, t: a ? +a.time.toFixed(2) : null, running: a ? a.isRunning() : null,
      w: a ? +a.getEffectiveWeight().toFixed(2) : null, mixerT: +u.humanMixer.time.toFixed(2),
      keys: (window.__keys || []).slice(-4), onScreen, hFrac };
  });
  const pump = () => page.screenshot({ type: 'jpeg', quality: 40 });
  const shoot = async (state, frames) => {
    const seq = [];
    for (let i = 0; i < frames; i++) { await pump(); seq.push(await probe()); }
    await page.screenshot({ path: resolve(outDir, `knight-${state}.jpg`), type: 'jpeg', quality: 72 });
    await writeFile(resolve(outDir, `state-${state}.json`), JSON.stringify({ state, identity, framing, focus, seq, errors }, null, 2));
    console.log('STATE ' + state + ' ' + JSON.stringify(seq.map(s => [s.spd, s.grounded, s.queue, s.kind, s.clip, s.t, s.cd, s.mixerT, s.hFrac, s.onScreen])));
  };
  await pump(); await pump();
  await shoot('idle', 3);
  await page.keyboard.down('d'); await page.keyboard.down('Shift');
  for (let i = 0; i < 3; i++) await pump();
  await shoot('run', 4);
  await page.keyboard.up('Shift'); await page.keyboard.up('d');
  for (let i = 0; i < 2; i++) await pump();
  await page.keyboard.down('j');
  for (let i = 0; i < 2; i++) await pump();
  await shoot('attack', 4);
  await page.keyboard.up('j');
  for (let i = 0; i < 2; i++) await pump();
  await page.keyboard.down('u');
  for (let i = 0; i < 2; i++) await pump();
  await shoot('grab', 4);
  await page.keyboard.up('u');
  console.log('DONE');
} finally { await browser.close(); }
