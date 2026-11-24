import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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
    window.__wrapped = true;
  });
  const read = () => page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData;
    const st = a => a ? { clip: a.getClip().name, run: a.isRunning(), en: a.enabled, w: +a.getEffectiveWeight().toFixed(2), t: +a.time.toFixed(2), paused: !!a.paused, loop: a.loop } : null;
    const calls = window.__calls.slice(); window.__calls = [];
    return {
      wrapped: !!window.__wrapped, speed: +Math.hypot(f.velocity?.x||0, f.velocity?.z||0).toFixed(2),
      t: +Number(f.t||0).toFixed(2), hitstun: +(f.hitstun||0).toFixed(2), queue: (f.attackQueue||[]).length,
      mixerTime: +u.humanMixer.time.toFixed(2), calls: calls.length, dtSum: +calls.reduce((a,b)=>a+b,0).toFixed(3),
      dtLast: calls.length ? calls[calls.length-1] : null,
      lastMove: st(u.lastMoveAction), run: st(u.runAction), walk: st(u.walkAction), sprint: st(u.sprintAction),
      punch: st(u.punchAction), hit: st(u.hitAction), idle: st(u.idleAction), currentClip: u.currentClip||null
    };
  });
  for (const [label, keys] of [['idle', []], ['walk', ['d']], ['run', ['d','Shift']], ['attack', ['j']], ['grab', ['u']]]) {
    await page.evaluate(() => { window.fighters[0].hitstun = 0; window.__calls = []; });
    for (const k of keys) await page.keyboard.down(k);
    for (let i=0;i<10;i++) await page.evaluate(() => window.__browserSmashStep?.(0.04));
    rows.push({ state: label, ...(await read()) });
    for (const k of keys.slice().reverse()) await page.keyboard.up(k);
    await page.evaluate(() => window.__browserSmashStep?.(0.3));
  }
  console.log('AUDIT:' + JSON.stringify({ rows, errors }));
} finally { await browser.close(); }
