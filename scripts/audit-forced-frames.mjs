// Headless rAF stalls after ~1.2 s in this build, so drive real frames with screenshots and
// sample the mixer after every composite. Without this the audit reads a frozen frame.
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl',
  '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
const out = {};
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashStep && window.fighters), null, { timeout: 120000, polling: 200 });
  await page.evaluate(() => { const s=document.querySelector('#p1Character'); const o=s&&[...s.options].find(o=>o.value==='Kaze'); if(o){s.value='Kaze';s.dispatchEvent(new Event('change',{bubbles:true}));} document.querySelector('#play')?.click(); });
  await page.waitForFunction(() => Boolean(window.fighters?.[0]?.model?.userData?.hasAnimationClips), null, { timeout: 60000, polling: 200 }).catch(() => {});
  await page.mouse.click(450, 350);
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; window.__browserSmashStep?.(0.5); });
  const pump = () => page.screenshot({ path: '/tmp/frame.png' });
  const read = () => page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData, a = u.lastMoveAction;
    return { spd: +Math.hypot(f.velocity?.x||0,f.velocity?.z||0).toFixed(1), y: +f.position.y.toFixed(2), g: !!f.isGrounded,
      clip: a ? a.getClip().name : null, at: a ? +a.time.toFixed(2) : null, w: a ? +a.getEffectiveWeight().toFixed(2) : null,
      run: a ? a.isRunning() : null, mixerT: +u.humanMixer.time.toFixed(2), cc: u.currentClip || null };
  });
  for (const [label, keys, tap] of [['idle', [], null], ['run', ['d','Shift'], null], ['attack', [], 'j'],
    ['grab', [], 'u'], ['hit', [], null]]) {
    for (const k of keys) await page.keyboard.down(k);
    if (tap) await page.keyboard.press(tap);
    if (label === 'hit') await page.evaluate(() => { window.fighters[0].hitstun = 0.4; });
    const seq = [];
    for (let i = 0; i < 7; i++) { await pump(); seq.push(await read()); }
    out[label] = { seq };
    await page.screenshot({ path: `artifacts/dev/phase28422/shots/${label}.png` });
    for (const k of keys.slice().reverse()) await page.keyboard.up(k);
    await page.evaluate(() => { window.fighters[0].hitstun = 0; });
    for (let i = 0; i < 3; i++) await pump();
  }
  out.errors = errors;
  console.log('AUDIT:' + JSON.stringify(out));
} finally { await browser.close(); }
