// Measure what the mounted body actually contains near the head, then shoot clean isolated views.
//
// The earlier hat work failed because the head subtree in `userData` is a bone ("Neck") with no
// geometry; the hat is baked into the character asset. This scans every mesh on the model, reports
// the ones near the head (world box, material colour, skinned or not), records the model's facing
// offset, and captures head views at four yaws plus gameplay distance so the true front is observed
// rather than assumed. The second fighter is removed from the scene, not merely hidden behind HUD.
//
//   bash scripts/run-browser-test.sh scripts/measure-meshes.mjs --identity="Captain Jack Sparrow" --label=jack --shoot
//   bash scripts/run-browser-test.sh scripts/measure-meshes.mjs --identity="Lord Voldemort" --label=voldemort --shoot
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const arg = (name, fallback) => (process.argv.find(a => a.startsWith(`--${name}=`)) || `--${name}=${fallback}`).split('=').slice(1).join('=');
const identity = arg('identity', 'Captain Jack Sparrow');
const label = arg('label', 'jack');
const shoot = process.argv.includes('--shoot');
const tag = arg('tag', 'shot');
const arena = arg('arena', 'valley');
const gameplayOnly = process.argv.includes('--gameplay');
// "materialName:#rrggbb" - a reversible visibility test that does not destroy any geometry.
const tint = arg('tint', '');
const out = 'artifacts/diagnostics';
const shotsDir = 'artifacts/compare/refine9';
await mkdir(out, { recursive: true });
await mkdir(shotsDir, { recursive: true });

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 300)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(({ identity, arena }) => {
    window.__browserSmashFreezeAI = true;
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.chooseArena(arena);
    window.__browserSmashSelect?.select('p1', identity);
    window.__browserSmashSelect?.select('p2', 'Thor');
    document.querySelector('#play').click();
  }, { identity, arena });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.evaluate(() => {
    const f = window.fighters[0];
    // Open ground away from the gateway props so nothing crosses the face.
    f.position.set(0, .6, 8); f.facing = 1; f.facingZ = 0;
    // Remove the opponent from the scene graph entirely, not just its visibility: an invisible
    // model still contributes to shadows, reflections and any capture that re-enables children.
    const other = window.fighters[1];
    other.model?.removeFromParent?.();
    other.hudHidden = true;
  });
  // Wait for the skinned body rather than measuring the procedural fallback.
  await page.waitForFunction(() => {
    let skinned = false;
    window.fighters?.[0]?.model?.traverse?.(n => { if (n.isSkinnedMesh) skinned = true; });
    return skinned;
  }, null, { timeout: 90000, polling: 250 }).catch(() => null);
  await page.waitForTimeout(600);

  const data = await page.evaluate(({ identity }) => {
    const f = window.fighters[0];
    f.model.updateMatrixWorld(true);
    const round = n => +Number(n).toFixed(4);
    const headBone = f.model.userData.head;
    const headWorld = headBone.position.clone();
    headBone.getWorldPosition(headWorld);
    const Vector3 = headWorld.constructor;

    const meshes = [];
    f.model.traverse(o => {
      if (!o.isMesh) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        const v = new Vector3(x, y, z).applyMatrix4(o.matrixWorld);
        for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v.getComponent(i)); max[i] = Math.max(max[i], v.getComponent(i)); }
      }
      const centre = min.map((v, i) => (v + max[i]) / 2);
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const colour = mat?.color ? '#' + mat.color.getHexString() : null;
      meshes.push({
        name: o.name || '(unnamed mesh)',
        skinned: Boolean(o.isSkinnedMesh),
        vertices: o.geometry.attributes?.position?.count || 0,
        material: colour,
        materialName: mat?.name || null,
        geometryType: o.geometry?.type || null,
        metalness: mat?.metalness ?? null,
        roughness: mat?.roughness ?? null,
        parent: o.parent?.name || o.parent?.type || null,
        worldBox: { min: min.map(round), max: max.map(round), size: max.map((v, i) => round(v - min[i])), centre: centre.map(round) },
        distanceFromHead: round(Math.hypot(centre[0] - headWorld.x, centre[1] - headWorld.y, centre[2] - headWorld.z))
      });
    });

    // Header meshes: within 0.55 m of the head bone, largest first.
    const nearHead = meshes.filter(m => m.distanceFromHead < 0.55)
      .sort((a, b) => (b.worldBox.size[0] * b.worldBox.size[1]) - (a.worldBox.size[0] * a.worldBox.size[1]));
    // Anything gold/tan anywhere on the body, which is how a misplaced band would be found.
    const goldish = meshes.filter(m => {
      const c = m.material;
      if (!c) return false;
      const r = parseInt(c.slice(1, 3), 16) / 255, g = parseInt(c.slice(3, 5), 16) / 255, bl = parseInt(c.slice(5, 7), 16) / 255;
      return r > 0.55 && g > 0.45 && bl < 0.55 && r > bl + 0.15;
    });

    return {
      identity,
      headBone: { name: headBone?.name || null, world: headWorld.toArray().map(round), localY: round(headBone?.position?.y ?? 0), children: (headBone?.children || []).map(c => c.name) },
      facing: { facing: round(f.facing), facingZ: round(f.facingZ), modelFacingOffset: f.model.userData.modelFacingOffset ?? null, rotationY: round(f.model.rotation.y) },
      controller: Boolean(f.model.userData.animationController), mixer: Boolean(f.model.userData.humanMixer),
      meshCount: meshes.length,
      skinnedCount: meshes.filter(m => m.skinned).length,
      nearHead,
      goldish
    };
  }, { identity });

  const identityDetails = await page.evaluate(() => window.__browserSmashAssets?.identityDetails || null);
  console.log('IDENTITY_DETAILS', JSON.stringify(identityDetails));
  console.log('HEAD', JSON.stringify(data.headBone));
  console.log('FACING', JSON.stringify(data.facing));
  console.log('RIG', JSON.stringify({ controller: data.controller, mixer: data.mixer }));
  console.log(`MESHES ${data.meshCount} (skinned ${data.skinnedCount})`);
  console.log('\nMESHES WITHIN 0.55 m OF THE HEAD BONE');
  for (const m of data.nearHead) {
    console.log(`  ${m.name.padEnd(24)} ${String(m.material || '').padEnd(9)} ${String(m.materialName || '').padEnd(18)} skinned=${String(m.skinned).padEnd(5)} v=${String(m.vertices).padEnd(6)} size=${JSON.stringify(m.worldBox.size)} centre=${JSON.stringify(m.worldBox.centre)} d=${m.distanceFromHead}`);
  }
  console.log(`\nGOLD/TAN MESHES (${data.goldish.length})`);
  for (const m of data.goldish) {
    console.log(`  ${m.name.padEnd(24)} ${String(m.material || '').padEnd(9)} ${String(m.materialName || '').padEnd(18)} size=${JSON.stringify(m.worldBox.size)} centre=${JSON.stringify(m.worldBox.centre)} d=${m.distanceFromHead}`);
  }

  if (gameplayOnly) {
    await page.evaluate(() => window.smashCamera?.endSpectate?.());
    await page.waitForTimeout(700);
    const file = `${shotsDir}/${label}-gameplay-${tag}.png`;
    await page.screenshot({ path: file });
    console.log('SHOT', file);
    data.shots = [file];
  }

  // Reversible evidence: retint only the named material, shoot, then restore the original colour and
  // confirm the model is untouched. Nothing is hidden, disposed or rebuilt.
  if (tint) {
    const [target, hex] = tint.split(':');
    const tintShots = [];
    const saved = await page.evaluate(({ target, hex }) => {
      const out = [];
      window.fighters[0].model.traverse(o => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (mat?.name !== target) continue;
          out.push({ mesh: o.name, before: '#' + mat.color.getHexString() });
          mat.color.set(hex);
          mat.needsUpdate = true;
        }
      });
      return out;
    }, { target, hex });
    console.log('TINTED', JSON.stringify(saved));
    for (const [yaw, name] of [[0, 'yaw0'], [45, 'three-quarter'], [-68, 'side']]) {
      await page.evaluate(y => window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'head', yaw: y, pitch: 4, distance: 2.1 }), yaw);
      await page.waitForTimeout(400);
      const file = `${shotsDir}/${label}-tinted-${name}.png`;
      await page.screenshot({ path: file });
      tintShots.push(file);
      console.log('SHOT', file);
    }
    const restored = await page.evaluate(({ target, saved }) => {
      window.fighters[0].model.traverse(o => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (mat?.name !== target) continue;
          mat.color.set(saved[0]?.before || '#ffffff');
          mat.needsUpdate = true;
        }
      });
      window.smashCamera?.endSpectate?.();
      return window.fighters[0].model.userData.head?.name || null;
    }, { target, saved });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shotsDir}/${label}-restored.png` });
    console.log('RESTORED head=' + restored, JSON.stringify(saved));
    data.tint = { target, hex, saved, tintShots, restoredHead: restored };
  }

  if (shoot) {
    const shots = [];
    // distance overrides the framing preset, so a head shot does not depend on preset names.
    const view = async (yaw, file) => {
      await page.evaluate(y => window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'head', yaw: y, pitch: 4, distance: 2.1 }), yaw);
      await page.waitForTimeout(450);
      await page.screenshot({ path: file });
      shots.push(file);
      console.log('SHOT', file);
    };
    await view(0, `${shotsDir}/${label}-yaw0.png`);
    await view(90, `${shotsDir}/${label}-yaw90.png`);
    await view(180, `${shotsDir}/${label}-yaw180.png`);
    await view(-90, `${shotsDir}/${label}-yaw-90.png`);
    await page.evaluate(() => window.smashCamera?.endSpectate?.());
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${shotsDir}/${label}-gameplay-${tag}.png` });
    console.log('SHOT', `${shotsDir}/${label}-gameplay-${tag}.png`);
    data.shots = shots;
  }

  await writeFile(`${out}/${label}-meshes.json`, JSON.stringify({ ...data, errors, generatedAt: new Date().toISOString() }, null, 2));
  console.log('ERRORS', errors.slice(0, 2).join(' | ') || 'none');
  console.log('wrote', `${out}/${label}-meshes.json`);
} finally {
  await browser?.close();
  server.close();
}
