import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const outDir = resolve(process.cwd(), 'artifacts/dev/phase28429/shots');
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl',
  '--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 760, height: 640 } });
page.setDefaultTimeout(60000);
await page.addInitScript(() => {
  let v = 0; const q = [];
  performance.now = () => v;
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__advance = (n = 1, dt = 1000 / 60) => { for (let i = 0; i < n; i++) { v += dt; for (const cb of q.splice(0, q.length)) cb(v); } return q.length; };
});
const mute = on => page.evaluate(v => { const r = window.__browserSmashRenderer; if (!r) return;
  if (v) { if (!r.__o) r.__o = r.render; r.render = () => {}; } else if (r.__o) { r.render = r.__o; delete r.__o; } }, on);
const adv = n => page.evaluate(k => window.__advance(k), n);
const wait = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { await mute(true); if (await page.evaluate(fn)) return true; await adv(1); await page.waitForTimeout(5); } return false; };
const out = { shots: [] };
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await wait(() => Boolean(window.__browserSmashStep && window.fighters), 45000);
  await page.evaluate(() => { const s = document.querySelector('#p1Character'); const o = s && [...s.options].find(i => i.value === 'Kaze');
    if (o) { s.value = 'Kaze'; s.dispatchEvent(new Event('change', { bubbles: true })); } document.querySelector('#play')?.click(); });
  await wait(() => { const u = window.fighters?.[0]?.model?.userData; if (!u?.assetUrl || !u.hasAnimationClips) return false;
    let b = 0; window.fighters[0].model.traverse?.(n => { if (n.isSkinnedMesh) b = Math.max(b, n.skeleton?.bones?.length || 0); }); return b >= 40; }, 45000);
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; document.body.setAttribute('tabindex', '-1'); document.body.focus();
    window.fighters[1].position.x += 7; });
  const place = dx => page.evaluate(d => { const [p, c] = window.fighters;
    p.hitstun = 0; p.velocity.set(0,0,0); p.position.y = 0;
    c.hitstun = 0; c.velocity.set(0,0,0); c.position.set(p.position.x + d, 0, p.position.z); p.facing = 1; }, dx);
  const read = () => page.evaluate(() => { const f = window.fighters[0], u = f.model.userData, a = u.lastMoveAction;
    return { clip: a ? a.getClip().name : null, t: a ? +a.time.toFixed(2) : null, dur: a ? +a.getClip().duration.toFixed(2) : null,
      gnd: !!f.isGrounded, spd: +Math.hypot(f.velocity.x, f.velocity.z).toFixed(1), stun: +(f.hitstun || 0).toFixed(2),
      grab: !!f.grabTarget, cpuPct: +window.fighters[1].percent.toFixed(1) }; });
  const shoot = async (name) => {
    await mute(false);
    const framing = await page.evaluate(() => {
      const THREE = window.__browserSmashThree, r = window.__browserSmashRenderer, cam = window.smashCamera.camera, m = window.fighters[0].model;
      m.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(m);
      const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      let d = Math.max(sz.x, sz.y, sz.z) * 1.9, maxAbs = 9;
      for (let i = 0; i < 12; i++) {
        cam.position.set(c.x + d * 0.42, c.y + sz.y * 0.10, c.z + d * 0.90);
        cam.lookAt(c.x, c.y, c.z); cam.updateMatrixWorld(true);
        maxAbs = 0;
        for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
          const v = new THREE.Vector3(box.min.x + dx * sz.x, box.min.y + dy * sz.y, box.min.z + dz * sz.z).project(cam);
          maxAbs = Math.max(maxAbs, Math.abs(v.x), Math.abs(v.y));
        }
        if (maxAbs <= 0.62) break;
        d *= maxAbs > 0.62 ? 1.14 : 0.90;
      }
      r.render(window.__browserSmashScene, cam);
      return { d: +d.toFixed(2), maxAbs: +maxAbs.toFixed(3), h: +sz.y.toFixed(2) };
    });
    await page.screenshot({ path: resolve(outDir, name + '.jpg'), type: 'jpeg', quality: 86 });
    await mute(true);
    const rec = { name, ...(await read()), framing };
    out.shots.push(rec);
    console.log('SHOT ' + JSON.stringify(rec));
  };
  const press = async k => { await page.keyboard.down(k); await adv(1); await page.keyboard.up(k); };
  await adv(6); await shoot('idle');
  await page.keyboard.down('d'); for (let i = 0; i < 10; i++) await adv(1); await shoot('walk');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 40 && (await read()).clip !== 'sprint'; i++) await adv(1);
  await adv(4); await shoot('sprint');
  await page.keyboard.up('Shift'); await page.keyboard.up('d');
  for (let i = 0; i < 10; i++) await adv(1);
  await press(' '); await adv(7); await shoot('jump');
  for (let i = 0; i < 30; i++) await adv(1);
  await place(1.15); await adv(3);
  await press('j');
  for (let i = 0; i < 12 && (await read()).t < 0.09; i++) await adv(1);
  await shoot('jab');
  for (let i = 0; i < 20; i++) await adv(1);
  await page.evaluate(() => { const [p, c] = window.fighters; p.hitstun = 0; c.position.set(p.position.x + 0.95, 0, p.position.z); c.percent = 0; window.__browserSmashFreezeAI = false; });
  for (let i = 0; i < 120; i++) { await adv(1); if ((await read()).stun > 0) break; }
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; });
  await adv(2); await shoot('hit-reaction');
  for (let i = 0; i < 30; i++) await adv(1);
  await place(1.0); await adv(3);
  await press('u');
  for (let i = 0; i < 20 && !(await read()).grab; i++) await adv(1);
  await adv(3); await shoot('grab-hold');
  for (let i = 0; i < 30 && (await read()).grab; i++) await adv(1);
  await adv(2); await shoot('throw');
  await writeFile(resolve(outDir, 'quality.json'), JSON.stringify(out, null, 2));
  console.log('DONE shots=' + out.shots.length);
} catch (e) { console.log('ERROR ' + String((e && e.message) || e).slice(0, 200)); }
finally { await browser.close(); }
