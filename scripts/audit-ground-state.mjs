import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl',
  '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
const samples = [];
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashStep && window.fighters), null, { timeout: 120000, polling: 200 });
  await page.evaluate(() => { const s=document.querySelector('#p1Character'); const o=s&&[...s.options].find(o=>o.value==='Kaze'); if(o){s.value='Kaze';s.dispatchEvent(new Event('change',{bubbles:true}));} document.querySelector('#play')?.click(); });
  await page.waitForFunction(() => Boolean(window.fighters?.[0]?.model?.userData?.hasAnimationClips), null, { timeout: 60000, polling: 200 }).catch(() => {});
  await page.mouse.click(450, 350);
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; });
  await page.waitForTimeout(1200);
  for (let i = 0; i < 12; i++) {
    samples.push(await page.evaluate(() => {
      const f = window.fighters[0], u = f.model.userData;
      const last = u.lastMoveAction;
      let box = null;
      try { const THREE = window.__THREE; } catch {}
      return { y: +f.position.y.toFixed(3), vy: +(f.velocity?.y||0).toFixed(2),
        vx: +(f.velocity?.x||0).toFixed(2), g: !!f.isGrounded, stun: +(f.hitstun||0).toFixed(2),
        ko: !!f.ko, clip: last ? last.getClip().name : null, t: last ? +last.time.toFixed(2) : null,
        w: last ? +last.getEffectiveWeight().toFixed(2) : null, mixerT: +u.humanMixer.time.toFixed(2),
        holderY: +(u.importedModel ? u.importedModel.position.y : NaN).toFixed(3) };
    }));
    await page.waitForTimeout(120);
  }
  console.log('AUDIT:' + JSON.stringify({ samples, errors }));
} finally { await browser.close(); }
