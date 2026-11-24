// Production asset validation for the two renamed fighters.
//
// The exported GLB is a single skinned mesh with one material group per surface, so the hat and the
// face are vertex *ranges*, not separate objects. Sampling by material group is what makes the
// numbers below meaningful: the earlier version sampled the whole body and reported the hat's lowest
// point at y = 0, which was his boots.
//
//   1. export integrity: both GLBs load over HTTP into a live match with skinned meshes intact,
//   2. skinning: Voldemort's carved face moves when the head bone turns (baked, not a static pose),
//   3. clearance: Jack's tricorn versus his shoulders at extreme head yaw,
//   4. no duplicate geometry: count hat-material groups and report what the runtime added.
//
//   bash scripts/run-browser-test.sh scripts/verify-identity-assets.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/identity-assets';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const report = [];
for (const [label, slug] of [['Captain Jack Sparrow', 'jack'], ['Lord Voldemort', 'voldemort']]) {
  const page = await browser.newPage({ viewport: { width: 620, height: 720 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  const glb = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('response', r => { if (/\/roster\/.*\.glb/.test(r.url())) glb.push(`${r.url().split('/').pop()} ${r.status()}`); });
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(name => {
    window.__browserSmashSelect?.select('p1', name);
    window.__browserSmashSelect?.select('p2', 'Superman');
    window.__browserSmashSelect?.chooseArena('asgard');
  }, label);
  await page.evaluate(() => document.querySelector('#play').click());
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForTimeout(4200);

  const result = await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const fighter = window.fighters[0];
    fighter.position.set(0, 0, 0);
    window.fighters[1].position.set(3.4, 0, 0);
    window.__browserSmashFreezeAI = true;
    fighter.mixer?.stopAllAction?.();

    // The loaded body is split into many skinned parts, so material groups have to be collected
    // across all of them rather than from one "body" mesh.
    const skinned = [];
    let triangles = 0;
    const materials = [];
    fighter.model.traverse(n => {
      if (!n.isMesh) return;
      const geo = n.geometry;
      triangles += Math.round((geo.index ? geo.index.count : geo.attributes.position.count) / 3);
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) materials.push(m?.name || '');
      if (n.isSkinnedMesh) skinned.push(n);
    });
    if (!skinned.length) return { ok: false, reason: 'no skinned meshes' };

    const indicesByMaterial = (matcher) => {
      const found = [];
      for (const mesh of skinned) {
        const geo = mesh.geometry;
        const index = geo.index;
        const groups = (geo.groups && geo.groups.length)
          ? geo.groups
          : [{ start: 0, count: index ? index.count : geo.attributes.position.count, materialIndex: 0 }];
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const group of groups) {
          const name = mats[group.materialIndex]?.name || '';
          if (!matcher.test(name)) continue;
          if (index) for (let i = group.start; i < group.start + group.count; i += 1) found.push({ mesh, index: index.getX(i) });
          else for (let i = group.start; i < group.start + group.count; i += 1) found.push({ mesh, index: i });
        }
      }
      return found;
    };

    let head = null;
    fighter.model.traverse(n => { if (!head && n.isBone && /^head$/i.test(n.name || '')) head = n; });
    const worldVertex = ({ mesh, index }) => {
      const v = new THREE.Vector3();
      if (typeof mesh.applyBoneTransform === 'function') mesh.applyBoneTransform(index, v);
      else if (typeof mesh.boneTransform === 'function') mesh.boneTransform(index, v);
      else v.fromBufferAttribute(mesh.geometry.attributes.position, index);
      return v.applyMatrix4(mesh.matrixWorld);
    };
    const restYaw = head?.rotation.y ?? 0;
    const pose = turn => {
      if (head) head.rotation.y = restYaw + turn * Math.PI / 180;
      fighter.model.updateMatrixWorld(true);
      for (const mesh of skinned) mesh.skeleton.update();
    };

    const hat = indicesByMaterial(/hat/i);
    const skin = indicesByMaterial(/^fighter-skin(-shade)?$/i);

    // 2. Skinning: does the carved face move with the head bone?
    const faceSample = skin.filter(({ mesh, index }) => {
      const y = mesh.geometry.attributes.position.getY(index);
      return y > 1.5 && y < 1.85;
    }).filter((_, k) => k % 9 === 0);
    pose(0);
    const baseline = faceSample.map(worldVertex);
    const faceMotion = {};
    for (const turn of [30, 60]) {
      pose(turn);
      let maxMove = 0;
      faceSample.forEach((entry, k) => { maxMove = Math.max(maxMove, baseline[k].distanceTo(worldVertex(entry))); });
      faceMotion[turn] = +maxMove.toFixed(4);
      pose(0);
    }

    // 3. Clearance: tricorn vertices against the shoulder band.
    const torso = skin.filter(({ mesh, index }) => {
      const y = mesh.geometry.attributes.position.getY(index);
      return y > 1.15 && y < 1.5;
    }).filter((_, k) => k % 3 === 0);
    const clearance = {};
    if (hat.length) {
      for (const turn of [0, 45, 90, 135]) {
        pose(turn);
        const torsoWorld = torso.map(worldVertex);
        let min = Infinity;
        let lowest = Infinity;
        for (const entry of hat) {
          const v = worldVertex(entry);
          lowest = Math.min(lowest, v.y);
          for (const t of torsoWorld) {
            const d = v.distanceTo(t);
            if (d < min) min = d;
          }
        }
        clearance[turn] = { minDistanceToTorso: +min.toFixed(4), hatLowestY: +lowest.toFixed(3) };
      }
      pose(0);
    }

    return {
      ok: true,
      triangles,
      skinnedParts: skinned.length,
      materials: [...new Set(materials)].filter(n => /hat|skin|hair|band|robe|coat|eye/i.test(n)),
      hatVertices: hat.length,
      skinVertices: skin.length,
      faceSampled: faceSample.length,
      headBone: head?.name ?? null,
      faceMotion,
      clearance
    };
  });
  await page.screenshot({ path: `${out}/${slug}-loaded.png` });
  report.push({ label, glbRequests: [...new Set(glb)], errors: errors.slice(0, 3), ...result });
  await page.close();
}
console.log('IDENTITY_ASSETS ' + JSON.stringify(report, null, 1));
await browser.close();
server.close();
