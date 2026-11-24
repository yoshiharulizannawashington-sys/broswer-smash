// Recapture idle only: six probes including the feet, camera lifted above the bbox centre,
// and clear-ground placement that requires the FEET sample to be unblocked, not just the torso.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const outDir = resolve(process.cwd(), 'artifacts/dev/phase28432/shots');
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
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await wait(() => Boolean(window.__browserSmashStep && window.fighters), 45000);
  await page.evaluate(() => { const s = document.querySelector('#p1Character'); const o = s && [...s.options].find(i => i.value === 'Kaze');
    if (o) { s.value = 'Kaze'; s.dispatchEvent(new Event('change', { bubbles: true })); } document.querySelector('#play')?.click(); });
  await wait(() => { const u = window.fighters?.[0]?.model?.userData; if (!u?.assetUrl || !u.hasAnimationClips) return false;
    let b = 0; window.fighters[0].model.traverse?.(n => { if (n.isSkinnedMesh) b = Math.max(b, n.skeleton?.bones?.length || 0); }); return b >= 40; }, 45000);
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true; document.body.setAttribute('tabindex', '-1'); document.body.focus();
    window.fighters[1].position.x += 9;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.position === 'fixed' || cs.position === 'absolute') && el.offsetWidth > 160 && el.offsetHeight > 90 && el.tagName !== 'CANVAS') el.style.display = 'none';
    }
  });
  await adv(8);
  const probe = () => page.evaluate(() => {
    const THREE = window.__browserSmashThree, m = window.fighters[0].model, cam = window.smashCamera.camera;
    m.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(m), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const ray = new THREE.Raycaster();
    const isFighter = o => { for (let p = o; p; p = p.parent) if (p === m) return true; return false; };
    const probes = {
      centre: c.clone(),
      head: c.clone().setY(box.max.y - sz.y * 0.12),
      chest: c.clone().setY(box.min.y + sz.y * 0.62),
      pelvis: c.clone().setY(box.min.y + sz.y * 0.32),
      shin: c.clone().setY(box.min.y + sz.y * 0.12),
      foot: c.clone().setY(box.min.y + sz.y * 0.04),
      side: c.clone().setX(c.x + sz.x * 0.3).setY(box.min.y + sz.y * 0.32),
    };
    const fit = az => {
      let d = Math.max(sz.x, sz.y, sz.z) * 2.0, maxAbs = 9;
      for (let i = 0; i < 16; i++) {
        cam.position.set(c.x + Math.sin(az) * d, c.y + sz.y * 0.30, c.z + Math.cos(az) * d);
        cam.lookAt(c.x, c.y, c.z); cam.updateMatrixWorld(true);
        maxAbs = 0;
        for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
          const v = new THREE.Vector3(box.min.x + dx * sz.x, box.min.y + dy * sz.y, box.min.z + dz * sz.z).project(cam);
          maxAbs = Math.max(maxAbs, Math.abs(v.x), Math.abs(v.y));
        }
        if (maxAbs <= 0.55) break;
        d *= maxAbs > 0.55 ? 1.12 : 0.90;
      }
      const blocked = {};
      for (const [k, p] of Object.entries(probes)) {
        ray.set(cam.position.clone(), p.clone().sub(cam.position).normalize());
        ray.far = cam.position.distanceTo(p) - 0.05;
        const hits = ray.intersectObject(window.__browserSmashScene, true)
          .filter(h => h.object.isMesh && h.object.visible && !isFighter(h.object) && !h.object.material?.transparent
          && !/floor|ground|plinth|stage|valley/i.test(h.object.name || ''));
        if (hits.length) blocked[k] = hits[0].object.name || hits[0].object.type;
      }
      return { maxAbs: +maxAbs.toFixed(3), blocked };
    };
    let best = null;
    for (const az of [0, Math.PI/2, Math.PI, -Math.PI/2, Math.PI/4, -Math.PI/4, 3*Math.PI/4, -3*Math.PI/4]) {
      const r = fit(az), n = Object.keys(r.blocked).length;
      if (!best || n < best.n) best = { az: Math.round(az*180/Math.PI), n, ...r };
      if (n === 0) { best = { az: Math.round(az*180/Math.PI), n, ...r }; break; }
    }
    fit(best.az * Math.PI / 180);
    window.__browserSmashRenderer.render(window.__browserSmashScene, cam);
    return { ...best, h: +sz.y.toFixed(2) };
  });
  let pick = null;
  for (const [ox, oz] of [[-7,0],[-7,4],[-7,-4],[-4,0],[0,0],[4,0],[0,4],[0,-4],[7,0],[-10,4],[-10,-4],[10,4]]) {
    await page.evaluate(([dx, dz]) => { const p = window.fighters[0]; p.velocity.set(0,0,0); p.position.x = dx; p.position.z = dz; p.position.y = 0; }, [ox, oz]);
    await adv(3);
    const r = await probe();
    console.log('TRY ' + ox + ',' + oz + ' ' + JSON.stringify(r));
    if (r.n === 0) { pick = { ox, oz, ...r }; break; }
  }
  if (!pick) throw new Error('no clear ground found');
  await adv(6);
  await mute(false);
  const v = await probe();
  await page.screenshot({ path: resolve(outDir, 'idle.jpg'), type: 'jpeg', quality: 88 });
  await mute(true);
  const st = await page.evaluate(() => { const f = window.fighters[0], u = f.model.userData, a = u.lastMoveAction;
    return { clip: a?.getClip().name, t: +a?.time.toFixed(2), pos: [+f.position.x.toFixed(1), +f.position.z.toFixed(1)] }; });
  console.log('IDLE ' + JSON.stringify({ ...pick, st, view: v }));
} catch (e) { console.log('ERROR ' + String((e && e.message) || e).slice(0, 200)); }
finally { await browser.close(); }
