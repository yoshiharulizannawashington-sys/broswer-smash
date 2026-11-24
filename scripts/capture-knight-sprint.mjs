import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const outDir = resolve(process.cwd(), 'artifacts/dev/phase28428/shots');
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
    window.fighters[1].position.x += 8; });
  await page.keyboard.down('d'); await page.keyboard.down('Shift');
  const read = () => page.evaluate(() => { const f = window.fighters[0], u = f.model.userData, a = u.lastMoveAction;
    return { clip: a ? a.getClip().name : null, t: a ? +a.time.toFixed(2) : null, dur: a ? +a.getClip().duration.toFixed(2) : null,
      gnd: !!f.isGrounded, spd: +Math.hypot(f.velocity.x, f.velocity.z).toFixed(1), y: +f.position.y.toFixed(2) }; });
  let state = await read();
  for (let i = 0; i < 40 && state.clip !== 'sprint'; i++) { await adv(1); state = await read(); }
  console.log('SPRINT_START ' + JSON.stringify(state));
  const shootAt = async (targetT, name) => {
    let s = await read();
    for (let i = 0; i < 30 && Math.abs((s.t ?? 0) - targetT) > 0.06; i++) { await adv(1); s = await read(); }
    await mute(false);
    const framing = await page.evaluate(() => {
      const THREE = window.__browserSmashThree, r = window.__browserSmashRenderer, cam = window.smashCamera.camera, m = window.fighters[0].model;
      m.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(m);
      const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      let d = Math.max(sz.x, sz.y, sz.z) * 1.7, maxAbs = 9;
      for (let i = 0; i < 10; i++) {
        cam.position.set(c.x + d * 0.5, c.y + sz.y * 0.08, c.z + d * 0.87);
        cam.lookAt(c.x, c.y, c.z); cam.updateMatrixWorld(true);
        maxAbs = 0;
        for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
          const v = new THREE.Vector3(box.min.x + dx * sz.x, box.min.y + dy * sz.y, box.min.z + dz * sz.z).project(cam);
          maxAbs = Math.max(maxAbs, Math.abs(v.x), Math.abs(v.y));
        }
        if (maxAbs <= 0.84) break;
        d *= 1.22;
      }
      r.render(window.__browserSmashScene, cam);
      return { d: +d.toFixed(2), maxAbs: +maxAbs.toFixed(3), size: [+sz.x.toFixed(2), +sz.y.toFixed(2), +sz.z.toFixed(2)] };
    });
    await page.screenshot({ path: resolve(outDir, name + '.jpg'), type: 'jpeg', quality: 86 });
    await mute(true);
    const rec = { name, ...s, framing };
    out.shots.push(rec);
    console.log('SHOT ' + name + ' ' + JSON.stringify(rec));
  };
  await shootAt(0.12, 'knight-sprint-a');
  await shootAt(0.32, 'knight-sprint-b');
  await shootAt(0.5, 'knight-sprint-c');
  await writeFile(resolve(outDir, 'sprint.json'), JSON.stringify(out, null, 2));
  console.log('DONE');
} catch (e) { console.log('ERROR ' + String((e && e.message) || e).slice(0, 200)); }
finally { await browser.close(); }
