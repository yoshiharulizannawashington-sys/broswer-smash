// Real animation frames only: no simulation stepping, so the render loop drives the mixer.
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl',
  '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
const rows = [];
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashStep && window.fighters), null, { timeout: 120000, polling: 200 });
  await page.evaluate(() => { const s=document.querySelector('#p1Character'); const o=s&&[...s.options].find(o=>o.value==='Kaze'); if(o){s.value='Kaze';s.dispatchEvent(new Event('change',{bubbles:true}));} document.querySelector('#play')?.click(); });
  await page.waitForFunction(() => Boolean(window.fighters?.[0]?.model?.userData?.hasAnimationClips), null, { timeout: 60000, polling: 200 }).catch(() => {});
  await page.mouse.click(450, 350);
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    const m = window.fighters[0].model.userData.humanMixer;
    window.__calls = [];
    const orig = m.update.bind(m);
    m.update = dt => { window.__calls.push(+dt.toFixed(4)); return orig(dt); };
  });
  const read = () => page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData;
    const st = a => a ? { clip: a.getClip().name, run: a.isRunning(), w: +a.getEffectiveWeight().toFixed(2), t: +a.time.toFixed(2) } : null;
    const calls = window.__calls.slice(); window.__calls = [];
    return { speed: +Math.hypot(f.velocity?.x||0,f.velocity?.z||0).toFixed(2), grounded: !!f.isGrounded,
      stun: +(f.hitstun||0).toFixed(2), q: (f.attackQueue||[]).length, mixerT: +u.humanMixer.time.toFixed(2),
      frames: calls.length, dtSum: +calls.reduce((a,b)=>a+b,0).toFixed(2),
      lastMove: st(u.lastMoveAction), run: st(u.runAction), sprint: st(u.sprintAction), walk: st(u.walkAction),
      punch: st(u.punchAction), grab: st(u.grabAction), throwA: st(u.throwAction), hit: st(u.hitAction), land: st(u.landAction) };
  });
  for (const [label, keys, tap] of [['idle', [], null], ['walk', ['d'], null], ['run', ['d','Shift'], null],
    ['jump', [], ' '], ['attack', [], 'j'], ['grab', [], 'u']]) {
    for (const k of keys) await page.keyboard.down(k);
    if (tap) await page.keyboard.press(tap);
    await page.waitForTimeout(650);
    rows.push({ state: label, ...(await read()) });
    for (const k of keys.slice().reverse()) await page.keyboard.up(k);
    await page.waitForTimeout(350);
  }
  console.log('AUDIT:' + JSON.stringify({ rows, errors }));
} finally { await browser.close(); }
