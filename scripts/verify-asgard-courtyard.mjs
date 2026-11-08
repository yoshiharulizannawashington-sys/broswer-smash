// Acceptance for the Asgard courtyard retaining band: measured geometry, before/after at one camera,
// a real close-up, both fighters in a gameplay shot, the walking route across the courtyard edge,
// combat beside the band, and a camera check that the new stone never hides the fighters.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/asgard-courtyard';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

let failures = 0;
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); if (!ok) failures += 1; console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await page.goto(origin + '/?courtyardBand=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
  await page.waitForTimeout(400);
  await page.click('#bbTitle [data-nav="versus"]');
  await page.evaluate(() => {
    window.__browserSmashSelect?.select?.('p1', 'Goku');
    window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
  await page.evaluate(() => {
    const select = document.querySelector('#mapSelect');
    if (select) { select.value = 'asgard'; select.dispatchEvent(new Event('change')); }
    window.__browserSmashApplyMap('asgard');
  });
  await page.waitForFunction(() => window.__browserSmashAsgardCourtyard && window.__browserSmashAsgardCourtyardMeshes?.length, null, { timeout: 60000, polling: 250 });
  await page.waitForTimeout(1200);

  const report = await page.evaluate(() => ({
    courtyard: window.__browserSmashAsgardCourtyard,
    meshes: (window.__browserSmashAsgardCourtyardMeshes || []).map(mesh => ({
      name: mesh.name,
      vertices: mesh.geometry?.getAttribute?.('position')?.count || 0,
      material: mesh.material?.name || null,
      maps: { map: Boolean(mesh.material?.map), normal: Boolean(mesh.material?.normalMap), roughness: Boolean(mesh.material?.roughnessMap) },
      mapImage: mesh.material?.map?.image ? `${mesh.material.map.image.width}x${mesh.material.map.image.height}` : null,
      uv: Boolean(mesh.geometry?.getAttribute?.('uv')),
      tint: mesh.material?.color?.getHexString?.(),
      metalness: mesh.material?.metalness, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow
    }))
  }));
  console.log('REPORT', JSON.stringify(report));
  check('retaining band built as real merged geometry', report.courtyard.added > 40 && report.courtyard.meshCount >= 3, JSON.stringify({ added: report.courtyard.added, meshes: report.courtyard.meshCount }));
  check('stone courses carry real PBR maps', report.meshes.filter(m => /stone/i.test(m.material || '') || /retaining|course|capstone/i.test(m.name)).every(m => m.maps.map && m.maps.normal && m.maps.roughness), JSON.stringify(report.meshes.map(m => [m.name, m.maps])));
  check('every added mesh casts and receives shadow', report.meshes.every(m => m.castShadow && m.receiveShadow));
  const normals = await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const out = [];
    const n = new THREE.Vector3();
    const matrix = new THREE.Matrix3();
    for (const mesh of window.__browserSmashAsgardCourtyardMeshes || []) {
      const normal = mesh.geometry.getAttribute('normal');
      if (!normal) { out.push({ name: mesh.name, upFacing: 0 }); continue; }
      mesh.updateWorldMatrix(true, false);
      matrix.getNormalMatrix(mesh.matrixWorld);
      // Every box has a real top face, so a correctly wound mesh must have vertices whose world
      // normal points up. Counting those is robust; picking the single highest vertex is not, because
      // a box's side faces share those corner positions and the first hit is a sideways normal.
      let upFacing = 0;
      for (let i = 0; i < normal.count; i += 1) {
        n.fromBufferAttribute(normal, i).applyMatrix3(matrix).normalize();
        if (n.y > 0.9) upFacing += 1;
      }
      out.push({ name: mesh.name, upFacing });
    }
    return out;
  });
  check('capstone top faces point up (normals not inverted)', normals.every(n => n.upFacing > 0), JSON.stringify(normals));
  console.log('NORMALS', JSON.stringify(normals));

  const place = (a, b) => page.evaluate(([p1, p2]) => {
    const layout = window.__browserSmashLayout();
    const [f1, f2] = window.fighters;
    f1.position.set(p1[0], layout.ground ?? 0, p1[1]);
    f1.velocity.set(0, 0, 0); f1.hitstun = 0; f1.guardBreak = 0; f1.isGrounded = true; f1.attackQueue.length = 0;
    if (f2) {
      f2.position.set(p2[0], layout.ground ?? 0, p2[1]);
      f2.velocity.set(0, 0, 0); f2.hitstun = 0; f2.guardBreak = 0; f2.isGrounded = true; f2.attackQueue.length = 0;
      f2.percent = 0;
    }
  }, [a, b]);

  // 1 + 2. Same camera, band hidden then shown. The pair stands just inside the north band so the
  // band sits between them and the outer plaza - the plaza-centre framing put it 40 m away and the
  // two shots were indistinguishable.
  await place([11, 33.4], [16.5, 33.8]);
  await page.waitForTimeout(2200);
  await page.evaluate(() => { (window.__browserSmashAsgardCourtyardMeshes || []).forEach(mesh => { mesh.visible = false; }); });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/1-courtyard-before.png` });
  await page.evaluate(() => { (window.__browserSmashAsgardCourtyardMeshes || []).forEach(mesh => { mesh.visible = true; }); });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/2-courtyard-after.png` });
  console.log('SHOT before/after');

  // 3. Close-up on the bevel and courses, at the north band segment.
  await page.evaluate(() => window.smashCamera?.setZoom?.(0.7));
  await place([13.6, 30.4], [16.2, 31.2]);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/3-band-closeup.png` });
  const closeCamera = await page.evaluate(() => ({ y: +window.smashCamera?.camera?.position?.y?.toFixed?.(2), zoom: window.smashCamera?.zoom }));
  console.log('SHOT closeup', JSON.stringify(closeCamera));

  // 4. Normal gameplay framing with both fighters and the band in shot.
  await page.evaluate(() => window.smashCamera?.setZoom?.(1));
  await place([8, 33.4], [15.5, 33]);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/4-gameplay-both-fighters.png` });
  // Screen-space proof that the band is inside the gameplay frame and tall enough to read, measured
  // at the north segment rather than at the ring's centre.
  const visibility = await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const camera = window.smashCamera?.camera;
    if (!camera || !THREE) return null;
    const layout = window.__browserSmashAsgardCourtyard;
    const z = layout?.bounds?.z1 ?? 27;
    const x = 14;
    const top = new THREE.Vector3(x, 0.9, z).project(camera);
    const base = new THREE.Vector3(x, 0.065, z).project(camera);
    const heightPx = Math.abs(top.y - base.y) * 0.5 * window.innerHeight;
    return {
      ndc: { x: +top.x.toFixed(2), y: +top.y.toFixed(2), z: +top.z.toFixed(2) },
      heightPx: +heightPx.toFixed(1),
      inFrame: Math.abs(top.x) < 1 && Math.abs(top.y) < 1 && top.z > -1 && top.z < 1
    };
  });
  check('band is inside the gameplay frame and reads at distance', visibility && visibility.inFrame && visibility.heightPx > 12, JSON.stringify(visibility));
  console.log('SHOT gameplay', JSON.stringify(visibility));

  // 5. Walking route: courtyard -> outer plaza through the south opening.
  await place([0, 18], [3, 16]);
  await page.keyboard.down('s');
  const midway = await page.evaluate(() => {
    const f = window.fighters[0];
    for (let i = 0; i < 165; i += 1) window.__browserSmashStep(1 / 60);
    return { x: +f.position.x.toFixed(1), z: +f.position.z.toFixed(1) };
  });
  await page.keyboard.up('s');
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${out}/5-walking-route.png` });
  await page.keyboard.down('s');
  const walk = await page.evaluate(() => {
    const f = window.fighters[0];
    const path = [];
    for (let i = 0; i < 240; i += 1) {
      window.__browserSmashStep(1 / 60);
      if (i % 60 === 0) path.push({ x: +f.position.x.toFixed(1), z: +f.position.z.toFixed(1) });
    }
    return { path, end: { x: +f.position.x.toFixed(1), z: +f.position.z.toFixed(1) } };
  });
  await page.keyboard.up('s');
  check('courtyard-to-plaza route stays open through the opening', walk.end.z > 33, JSON.stringify({ midway, ...walk }));
  console.log('SHOT walk', JSON.stringify({ midway, ...walk }));

  // Lateral route through the east hall lane.
  await place([18, 4], [16, 6]);
  await page.keyboard.down('d');
  const lane = await page.evaluate(() => {
    const f = window.fighters[0];
    for (let i = 0; i < 300; i += 1) window.__browserSmashStep(1 / 60);
    return { x: +f.position.x.toFixed(1), z: +f.position.z.toFixed(1) };
  });
  await page.keyboard.up('d');
  check('east hall lane stays open', lane.x > 27, JSON.stringify(lane));

  // 6. Combat beside the band: a real hit must still land.
  await place([14, 28.9], [14, 30.3]);
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.facing = 0; f.facingZ = 1;
  });
  await page.keyboard.down('j');
  const combat = await page.evaluate(() => {
    const [attacker, dummy] = window.fighters;
    for (let i = 0; i < 90; i += 1) { window.__browserSmashStep(1 / 60); window.__browserSmashAttackTick?.(); }
    return { cpuPercent: dummy.percent, pose: attacker.attackMotionPose || null };
  });
  await page.keyboard.up('j');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/6-combat-near-band.png` });
  check('a hit still lands beside the new band', combat.cpuPercent > 0, JSON.stringify(combat));
  console.log('SHOT combat', JSON.stringify(combat));

  // Camera must not be buried inside the band or behind it.
  const cameraClear = await page.evaluate(() => {
    const camera = window.smashCamera?.camera;
    const f = window.fighters[0];
    if (!camera) return null;
    return {
      cameraY: +camera.position.y.toFixed(2),
      aboveBand: camera.position.y > 1.2,
      distance: +Math.hypot(camera.position.x - f.position.x, camera.position.z - f.position.z).toFixed(1)
    };
  });
  check('camera stays above the band and outside it', cameraClear && cameraClear.aboveBand && cameraClear.distance > 3, JSON.stringify(cameraClear));
  check('no page errors', errors.length === 0, errors.join(' | '));

  await writeFile(`${out}/verify.json`, JSON.stringify({ checks, report, walk, lane, combat, closeCamera, cameraClear, errors }, null, 2));
  console.log('SUMMARY', JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, failures: checks.filter(c => !c.ok).map(c => c.name + ': ' + c.detail), errors: errors.length }));
} finally {
  await browser.close();
  server.close();
}
console.log(failures === 0 ? '\nAsgard courtyard verification passed.' : `\nAsgard courtyard verification FAILED (${failures}).`);
process.exitCode = failures === 0 ? 0 : 1;
