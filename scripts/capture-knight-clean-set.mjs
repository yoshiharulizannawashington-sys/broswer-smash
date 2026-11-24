// Clean set v3: fighter relocated to verified clear ground, five-probe occlusion, mid-clip locomotion.
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
const out = { shots: [], ground: null };
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await wait(() => Boolean(window.__browserSmashStep && window.fighters), 45000);
  await page.evaluate(() => { const s = document.querySelector('#p1Character'); const o = s && [...s.options].find(i => i.value === 'Kaze');
    if (o) { s.value = 'Kaze'; s.dispatchEvent(new Event('change', { bubbles: true })); } document.querySelector('#play')?.click(); });
  await wait(() => { const u = window.fighters?.[0]?.model?.userData; if (!u?.assetUrl || !u.hasAnimationClips) return false;
    let b = 0; window.fighters[0].model.traverse?.(n => { if (n.isSkinnedMesh) b = Math.max(b, n.skeleton?.bones?.length || 0); }); return b >= 40; }, 45000);
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true; document.body.setAttribute('tabindex', '-1'); document.body.focus();
    window.fighters[1].position.x += 7;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.position === 'fixed' || cs.position === 'absolute') && el.offsetWidth > 160 && el.offsetHeight > 90 && el.tagName !== 'CANVAS') el.style.display = 'none';
    }
  });
  const place = dx => page.evaluate(d => { const [p, c] = window.fighters;
    p.hitstun = 0; p.velocity.set(0,0,0); p.position.y = 0;
    c.hitstun = 0; c.velocity.set(0,0,0); c.position.set(p.position.x + d, 0, p.position.z); p.facing = 1; }, dx);
  const read = () => page.evaluate(() => { const f = window.fighters[0], u = f.model.userData, a = u.lastMoveAction;
    return { clip: a ? a.getClip().name : null, t: a ? +a.time.toFixed(2) : null, dur: a ? +a.getClip().duration.toFixed(2) : null,
      gnd: !!f.isGrounded, spd: +Math.hypot(f.velocity.x, f.velocity.z).toFixed(1), stun: +(f.hitstun || 0).toFixed(2),
      grab: !!f.grabTarget, cpuPct: +window.fighters[1].percent.toFixed(1), pos: [+f.position.x.toFixed(1), +f.position.z.toFixed(1)] }; });
  const occlusion = () => page.evaluate(() => {
    const THREE = window.__browserSmashThree, m = window.fighters[0].model, cam = window.smashCamera.camera;
    m.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const ray = new THREE.Raycaster();
    const isFighter = o => { for (let p = o; p; p = p.parent) if (p === m) return true; return false; };
    const probes = [c.clone(), c.clone().setY(box.max.y - sz.y * 0.15), c.clone().setY(box.min.y + sz.y * 0.2),
      c.clone().setX(c.x + sz.x * 0.3), c.clone().setX(c.x - sz.x * 0.3)];
    const at = az => {
      let d = Math.max(sz.x, sz.y, sz.z) * 1.9;
      for (let i = 0; i < 14; i++) {
        cam.position.set(c.x + Math.sin(az) * d, c.y + sz.y * 0.10, c.z + Math.cos(az) * d);
        cam.lookAt(c.x, c.y, c.z); cam.updateMatrixWorld(true);
        let maxAbs = 0;
        for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
          const v = new THREE.Vector3(box.min.x + dx * sz.x, box.min.y + dy * sz.y, box.min.z + dz * sz.z).project(cam);
          maxAbs = Math.max(maxAbs, Math.abs(v.x), Math.abs(v.y));
        }
        if (maxAbs <= 0.55) break;
        d *= maxAbs > 0.55 ? 1.13 : 0.90;
      }
      let blocked = 0;
      for (const p of probes) {
        ray.set(cam.position.clone(), p.clone().sub(cam.position).normalize());
        ray.far = cam.position.distanceTo(p) - 0.05;
        const hits = ray.intersectObject(window.__browserSmashScene, true)
          .filter(h => h.object.isMesh && h.object.visible && !isFighter(h.object) && !h.object.material?.transparent);
        if (hits.length) blocked++;
      }
      return blocked;
    };
    return [0, Math.PI/2, Math.PI, -Math.PI/2].map(az => ({ az: Math.round(az*180/Math.PI), blocked: at(az) }));
  });
  // Clear-ground placement: try offsets until every probe is clear from at least one azimuth.
  let ground = null;
  for (const [ox, oz] of [[0,0],[4,0],[-4,0],[0,4],[0,-4],[7,0],[-7,0],[0,7],[0,-7],[10,4],[-10,-4]]) {
    await page.evaluate(([dx, dz]) => { const p = window.fighters[0]; p.velocity.set(0,0,0); p.position.x = dx; p.position.z = dz; p.position.y = 0; }, [ox, oz]);
    await adv(3);
    const occ = await occlusion();
    if (occ.some(o => o.blocked === 0)) { ground = { ox, oz, occ }; break; }
  }
  out.ground = ground;
  console.log('GROUND ' + JSON.stringify(ground));
  const view = () => page.evaluate(occ => {
    const THREE = window.__browserSmashThree, cam = window.smashCamera.camera, m = window.fighters[0].model;
    m.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    let chosen = occ[0];
    for (const o of occ) if (o.blocked === 0) { chosen = o; break; }
    const az = chosen.az * Math.PI / 180;
    let d = Math.max(sz.x, sz.y, sz.z) * 1.9, maxAbs = 9;
    for (let i = 0; i < 14; i++) {
      cam.position.set(c.x + Math.sin(az) * d, c.y + sz.y * 0.10, c.z + Math.cos(az) * d);
      cam.lookAt(c.x, c.y, c.z); cam.updateMatrixWorld(true);
      maxAbs = 0;
      for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) {
        const v = new THREE.Vector3(box.min.x + dx * sz.x, box.min.y + dy * sz.y, box.min.z + dz * sz.z).project(cam);
        maxAbs = Math.max(maxAbs, Math.abs(v.x), Math.abs(v.y));
      }
      if (maxAbs <= 0.55) break;
      d *= maxAbs > 0.55 ? 1.13 : 0.90;
    }
    window.__browserSmashRenderer.render(window.__browserSmashScene, cam);
    return { az: chosen.az, blocked: chosen.blocked, maxAbs: +maxAbs.toFixed(3), h: +sz.y.toFixed(2) };
  }, ground.occ);
  const shoot = async name => {
    await mute(false);
    const v = await view();
    await page.screenshot({ path: resolve(outDir, name + '.jpg'), type: 'jpeg', quality: 86 });
    await mute(true);
    const rec = { name, ...(await read()), view: v };
    out.shots.push(rec);
    console.log('SHOT ' + JSON.stringify(rec));
  };
  const press = async k => { await page.keyboard.down(k); await adv(1); await page.keyboard.up(k); };
  const toTime = async (target, max = 40) => { for (let i = 0; i < max; i++) { const r = await read(); if (r.clip && Math.abs((r.t ?? 0) - target) <= 0.04) return r; await adv(1); } return read(); };
  await adv(6); await shoot('idle');
  await page.keyboard.down('d'); for (let i = 0; i < 12; i++) await adv(1);
  await toTime(0.5); await shoot('walk');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 40 && (await read()).clip !== 'sprint'; i++) await adv(1);
  await toTime(0.12); await shoot('sprint-a');
  await toTime(0.27); await shoot('sprint-b');
  await toTime(0.42); await shoot('sprint-c');
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
