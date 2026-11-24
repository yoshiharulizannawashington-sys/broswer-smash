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
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; window.fighters[0].hitstun = 0; window.fighters[1].hitstun = 0; });

  const read = () => page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData || {}, c = u.animationController||f.animationController||null;
    const table = m => (m?._actions||[]).map(a => ({ clip: a.getClip().name, w: +a.getEffectiveWeight().toFixed(2),
      run: a.isRunning(), en: a.enabled, t: +a.time.toFixed(2) })).filter(a => a.run || a.w > 0.01)
      .sort((x, y) => y.w - x.w).slice(0, 4);
    const strs = {};
    if (c) for (const k of Object.keys(c)) if (typeof c[k] === 'string' || typeof c[k] === 'boolean') strs[k] = c[k];
    return {
      speed: +Math.hypot(f.velocity?.x||0, f.velocity?.z||0).toFixed(2),
      hasCtl: !!c, ctlOnModel: !!u.animationController,
      ctlEnabled: c ? c.enabled : null, ctlClips: c?.clips ? c.clips.size : null, ctlRig: c ? !!c.rig : null,
      ctlMixerTime: c?.mixer ? +c.mixer.time.toFixed(2) : null,
      ctlActions: table(c?.mixer), ctlActionTime: c ? +Number(c._action?.time||0).toFixed(2) : null,
      ctlClipName: c?._action?.getClip?.().name || null,
      bakedMixerTime: u.humanMixer ? +u.humanMixer.time.toFixed(2) : null,
      bakedActions: table(u.humanMixer), currentClip: u.currentClip || null, strs
    };
  });

  for (const [label, keys, extra] of [['idle', [], null], ['walk', ['d'], null], ['run', ['d', 'Shift'], null],
    ['jump', [' '], null], ['attack', ['j'], null], ['grab', ['u'], null]]) {
    for (const k of keys) await page.keyboard.down(k);
    for (let i = 0; i < 8; i++) await page.evaluate(() => window.__browserSmashStep?.(0.04));
    rows.push({ state: label, ...(await read()) });
    for (const k of keys.slice().reverse()) await page.keyboard.up(k);
    await page.evaluate(() => { window.fighters[0].hitstun = 0; window.__browserSmashStep?.(0.4); });
  }
  console.log('AUDIT:' + JSON.stringify({ rows, errors }));
} finally { await browser.close(); }
