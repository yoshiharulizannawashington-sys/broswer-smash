// Audit the imported body's real mixer: which actions exist, which are running, at what weight.
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
  await page.mouse.click(450, 350);
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; window.__browserSmashStep?.(0.4); });

  const read = () => page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData, m = u.humanMixer;
    const actions = (m?._actions || []).map(a => ({
      clip: a.getClip().name, weight: +a.getEffectiveWeight().toFixed(2),
      running: a.isRunning(), enabled: a.enabled, time: +a.time.toFixed(2), paused: !!a.paused
    })).filter(a => a.weight > 0.01 || a.running).sort((x, y) => y.weight - x.weight).slice(0, 5);
    return {
      speed: +Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0).toFixed(2),
      currentClip: u.currentClip || null,
      mixerTime: m ? +m.time.toFixed(2) : null, timeScale: m ? m.timeScale : null,
      clipCount: (m?._actions || []).length,
      actions,
      wired: { idle: !!u.idleAction, walk: !!u.walkAction, run: !!u.runAction, sprint: !!u.sprintAction,
        jump: !!u.jumpAction, punch: !!u.punchAction, throw: !!u.throwAction, hit: !!u.hitAction,
        dodge: !!u.dodgeAction, block: !!u.blockAction }
    };
  });

  for (const [label, keys] of [['idle', []], ['walk', ['d']], ['run', ['d', 'Shift']], ['jump', [' ']],
    ['attack', ['j']], ['grab', ['u']], ['hit', null]]) {
    if (label === 'hit') {
      await page.evaluate(() => { window.fighters[0].hitstun = 0.4; window.__browserSmashStep?.(0.05); });
    } else {
      for (const k of keys) await page.keyboard.down(k);
      for (let i = 0; i < 6; i++) await page.evaluate(() => window.__browserSmashStep?.(0.04));
    }
    rows.push({ state: label, input: keys ? (keys.join('+') || 'none') : 'hitstun set', ...(await read()) });
    for (const k of (keys || []).slice().reverse()) await page.keyboard.up(k);
    await page.evaluate(() => window.__browserSmashStep?.(0.35));
  }
  console.log('AUDIT:' + JSON.stringify({ rows, errors }));
} finally { await browser.close(); }
