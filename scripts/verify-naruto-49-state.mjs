// Complete live acceptance pass for the Naruto Sage rig.
//
// Every one of the 49 clips shipped in the mounted Sage GLB is played on the live body, sampled for
// track resolution, finite skinning and bone travel, and rendered into a 7 x 7 contact sheet. The
// defeat clip gets a second, close coat seam measurement on the same live SkinnedMesh.
//
// This complements `npm run test:rig-solo`: that harness proves the production clip lane without a
// browser; this one proves the same clips and the repaired coat weights on the body actually mounted
// by the game. It does not replace the key-driven combat tests.
//
//   npm run test:naruto-49-state
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/naruto-49-state';
await mkdir(out, { recursive: true });

const EXPECTED = [
  'idle', 'walk', 'run', 'jump', 'fall', 'land', 'jab', 'heavy_punch', 'front_kick', 'spinning_kick',
  'hit_light', 'hit_heavy', 'knockdown', 'block', 'victory', 'defeat', 'rasengan', 'shadow_clone',
  'transformation', 'Naruto_idle', 'Naruto_jump', 'Naruto_land', 'Naruto_hit_light', 'Naruto_hit_heavy',
  'Naruto_knockdown', 'Naruto_get_up', 'Naruto_victory', 'Naruto_defeat', 'authored_light1',
  'authored_light2', 'authored_light5', 'authored_heavy', 'authored_heavySlam', 'authored_light4',
  'authored_heavyLauncher', 'authored_light3', 'authored_rasenshuriken', 'authored_ultimate',
  'authored_shadowClone', 'authored_rasengan', 'authored_giantRasengan', 'authored_grab',
  'authored_throw', 'authored_form_formSage', 'authored_form_formNine', 'authored_form_formKurama',
  'authored_form_formSixPaths', 'authored_form_formBaryon', 'Naruto_kunai'
];

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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
const failedRequests = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 260)));
page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || '' }));

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashSelect?.chooseArena('valley');
  window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false,
  null, { timeout: 15000, polling: 100 }).catch(() => {});
await page.waitForFunction(() => window.__bbLoading?.describe?.().visible === false,
  null, { timeout: 15000, polling: 100 }).catch(() => {});
await page.waitForTimeout(700);

const mounted = await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  const f = window.fighters[0], foe = window.fighters[1];
  f.position.set(0, 0, 0); foe.position.set(9, 0, 0);
  f.velocity?.set?.(0, 0, 0); foe.velocity?.set?.(0, 0, 0);
  f.isGrounded = true; foe.isGrounded = true;
  f.hitstun = 0; f.guardBreak = 0; f.ko = false;
  f.model.updateMatrixWorld(true);

  const THREE = window.__browserSmashThree;
  const q = f.model.getWorldQuaternion(new THREE.Quaternion());
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0).normalize();
  const heading = Math.atan2(f.facingZ || 0, f.facing || 1);
  window.__frontYaw = (Math.atan2(forward.x, forward.z) - heading) * 180 / Math.PI;

  // The match HUD covers the body at torso distance; the canvas is the acceptance subject.
  document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = 'hidden'; });

  const u = f.model.userData || {};
  const byName = new Map();
  // Preserve the GLB clip order (animationActions is built while walking gltf.animations), then
  // union the live mixer in case a later slot alias added an action not in the map.
  const add = action => {
    const clip = action?.getClip?.();
    if (clip && !byName.has(clip.name)) byName.set(clip.name, clip);
  };
  for (const action of Object.values(u.animationActions || {})) add(action);
  for (const action of u.humanMixer?._actions || []) add(action);
  window.__accept = {
    fighter: f, model: f.model, byName,
    mixer: new THREE.AnimationMixer(f.model),
    bones: [],
    sheet: document.createElement('canvas')
  };
  f.model.traverse(node => { if (node.isBone) window.__accept.bones.push(node); });
  window.__accept.sheet.width = 1400;
  window.__accept.sheet.height = 7 * 218;
  window.__accept.sheetCtx = window.__accept.sheet.getContext('2d');

  window.smashCamera.spectate({ fighter: f, framing: 'full', yaw: window.__frontYaw + 24, pitch: 4, distance: 4.0, transition: 0 });
  window.__browserSmashSetPaused(true);

  const meshes = [];
  f.model.traverse(node => { if (node.isSkinnedMesh) meshes.push({ name: node.name, material: node.material?.name || null, vertices: node.geometry?.attributes?.position?.count || 0 }); });
  return {
    identity: f.identityKey || f.identity || null,
    asset: f.model.userData?.assetUrl || f.model.userData?.characterAssetUrl || null,
    bones: window.__accept.bones.length,
    meshes,
    clips: [...byName.keys()],
    actionCount: Object.keys(u.animationActions || {}).length,
    mixerActions: u.humanMixer?._actions?.length || 0,
    paused: window.__browserSmashControlMode?.().paused ?? null
  };
});

const setResult = { asset: mounted.asset, bones: mounted.bones, meshes: mounted.meshes, clipCount: mounted.clips.length, expected: EXPECTED.length, missing: EXPECTED.filter(name => !mounted.clips.includes(name)), extra: mounted.clips.filter(name => !EXPECTED.includes(name)) };
console.log('MOUNTED', JSON.stringify({ ...setResult, actionCount: mounted.actionCount, mixerActions: mounted.mixerActions, paused: mounted.paused }));

const results = await page.evaluate(async ({ expected }) => {
  const s = window.__accept, f = s.fighter, model = s.model, sheet = s.sheet, ctx = s.sheetCtx;
  const THREE = window.__browserSmashThree;
  const canvas = document.querySelector('canvas');
  const bonePositions = () => {
    const out = [];
    for (const bone of s.bones) {
      const e = bone.matrixWorld.elements;
      out.push([e[12], e[13], e[14]]);
    }
    return out;
  };
  const maxDistance = (a, b) => {
    let worst = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      worst = Math.max(worst, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]));
    }
    return worst;
  };
  const seamMesh = (() => {
    let found = null;
    model.traverse(node => {
      if (found || !node.isSkinnedMesh) return;
      if (node.name === 'Object_3' || node.material?.name === 'nr2_tex01.png') found = node;
    });
    return found;
  })();
  const seamRest = {};
  if (seamMesh) {
    const p = seamMesh.geometry.attributes.position;
    for (const edge of [[714, 715], [1642, 719], [723, 1638]]) {
      const a = new THREE.Vector3().fromBufferAttribute(p, edge[0]).applyMatrix4(seamMesh.matrixWorld);
      const b = new THREE.Vector3().fromBufferAttribute(p, edge[1]).applyMatrix4(seamMesh.matrixWorld);
      seamRest[edge.join('-')] = a.distanceTo(b);
    }
  }
  const seamRatios = () => {
    if (!seamMesh) return { error: 'coat mesh Object_3 / nr2_tex01 not found' };
    seamMesh.skeleton?.update?.();
    const p = seamMesh.geometry.attributes.position;
    const out = {};
    for (const edge of [[714, 715], [1642, 719], [723, 1638]]) {
      const key = edge.join('-');
      const a = new THREE.Vector3().fromBufferAttribute(p, edge[0]);
      const b = new THREE.Vector3().fromBufferAttribute(p, edge[1]);
      seamMesh.applyBoneTransform(edge[0], a);
      seamMesh.applyBoneTransform(edge[1], b);
      a.applyMatrix4(seamMesh.matrixWorld);
      b.applyMatrix4(seamMesh.matrixWorld);
      out[key] = +(a.distanceTo(b) / Math.max(1e-6, seamRest[key])).toFixed(4);
    }
    return out;
  };

  const rows = [];
  const full = {};
  let sheetIndex = 0;
  for (const name of expected) {
    const clip = s.byName.get(name);
    if (!clip) { rows.push({ clip: name, ok: false, error: 'clip missing from live body' }); continue; }
    s.mixer.stopAllAction();
    const action = s.mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveWeight(1);
    action.play();
    // Match `test:rig-solo`'s six defeat samples, including the 0.293 s frame where the coat seam
    // historically collapsed. Sampling different times would make the two gates incomparable.
    const times = [0, 0.22, 0.44, 0.66, 0.86, 0.98].map(p => Math.min(clip.duration, p * Math.max(0.01, clip.duration)));
    let first = null;
    let travel = 0;
    let finite = true;
    let pose = null;
    let seamMin = Infinity;
    let worstSeam = null;
    let best = times[Math.min(2, times.length - 1)];
    for (const t of times) {
      action.time = t;
      s.mixer.update(0.0001);
      model.updateMatrixWorld(true);
      const positions = bonePositions();
      if (positions.some(p => !p.every(Number.isFinite))) finite = false;
      if (!first) first = positions;
      else {
        const delta = maxDistance(first, positions);
        if (delta > travel) { travel = delta; best = t; }
      }
      if (name === 'Naruto_defeat' || name === 'defeat') {
        const ratios = seamRatios();
        for (const [edge, value] of Object.entries(ratios)) {
          if (!Number.isFinite(value) || value >= seamMin) continue;
          seamMin = value;
          worstSeam = { edge, ratio: value, at: +t.toFixed(3) };
        }
      }
    }
    action.time = best;
    s.mixer.update(0.0001);
    model.updateMatrixWorld(true);
    pose = bonePositions();
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    const image = canvas.toDataURL('image/png');
    const box = new THREE.Box3().setFromObject(model);
    const minY = Number.isFinite(box.min.y) ? +box.min.y.toFixed(4) : null;
    const unresolved = clip.tracks.filter(track => {
      const node = track.name.slice(0, Math.max(0, track.name.lastIndexOf('.')));
      return !model.getObjectByName(node);
    });
    const seam = (name === 'Naruto_defeat' || name === 'defeat') ? seamRatios() : null;
    if (name === 'Naruto_defeat' || name === 'defeat' || name === 'authored_ultimate' || name === 'authored_form_formSage') full[name] = image;

    const col = sheetIndex % 7, row = Math.floor(sheetIndex / 7);
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(col * 200, row * 218, 200, 218);
    if (image.length > 5000) {
      const img = new Image();
      img.src = image;
      await img.decode();
      ctx.drawImage(img, col * 200, row * 218, 200, 200);
    }
    ctx.fillStyle = '#d7e9ff';
    ctx.font = '11px monospace';
    ctx.fillText(`${String(sheetIndex + 1).padStart(2, '0')} ${name}`.slice(0, 27), col * 200 + 5, row * 218 + 214);
    sheetIndex++;

    const ok = clip.tracks.length > 0 && unresolved.length === 0 && finite && travel > 0.005;
    const problems = [];
    if (!clip.tracks.length) problems.push('no tracks');
    if (unresolved.length) problems.push(`${unresolved.length} unresolved tracks`);
    if (!finite) problems.push('non-finite pose');
    if (travel <= 0.005) problems.push(`no measured travel (${travel.toFixed(4)} m)`);
    if (name === 'Naruto_defeat' && seamMin < 0.15) problems.push(`coat seam compressed to ${seamMin.toFixed(3)}x`);
    rows.push({
      clip: name, ok: problems.length === 0, problems,
      duration: +clip.duration.toFixed(3), tracks: clip.tracks.length, unresolved: unresolved.length,
      bones: s.bones.length, travel: +travel.toFixed(4), minY,
      at: +best.toFixed(3), seamMin: Number.isFinite(seamMin) ? +seamMin.toFixed(4) : null, seam, worstSeam,
      sheetTile: sheetIndex
    });
    console.log('STATE', JSON.stringify(rows[rows.length - 1]));
  }
  s.mixer.stopAllAction();
  const sheetImage = sheet.toDataURL('image/png');
  return { rows, sheetImage, full, coat: seamRatios() };
}, { expected: EXPECTED });

await writeFile(resolve(out, 'report.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  mounted: setResult,
  rows: results.rows,
  sheet: 'sheet.png',
  captures: Object.keys(results.full),
  coatAtEnd: results.coat,
  errors,
  failedRequests
}, null, 2));
if (results.sheetImage?.length > 5000) {
  await writeFile(resolve(out, 'sheet.png'), Buffer.from(results.sheetImage.split(',')[1], 'base64'));
}
for (const [name, image] of Object.entries(results.full || {})) {
  if (image?.length > 5000) await writeFile(resolve(out, `state-${name.replace(/[^a-z0-9_-]+/gi, '_')}.png`), Buffer.from(image.split(',')[1], 'base64'));
}

// The defeat state needs a second, closer look: the full-body tile proves the clip is live, while
// this shot lets the repaired coat seam be judged at the point where it used to pinch.
const defeatCloseup = await page.evaluate(async () => {
  const s = window.__accept;
  const f = s.fighter;
  const clip = s.byName.get('Naruto_defeat');
  if (!clip) return null;
  s.mixer.stopAllAction();
  const action = s.mixer.clipAction(clip);
  action.reset(); action.setLoop(window.__browserSmashThree.LoopOnce, 1); action.clampWhenFinished = true; action.setEffectiveWeight(1); action.play();
  action.time = Math.min(clip.duration, clip.duration * 0.22);
  s.mixer.update(0.0001);
  f.model.updateMatrixWorld(true);
  // The held kunai/rasengan obscures the right-hand coat seam at torso distance. The coat is the
  // subject here; equipment visibility is measured separately by the combat and equipment tests.
  for (const key of ['equippedWeaponRight', 'equippedWeaponLeft', 'pickupBlade']) {
    if (f.model.userData[key]) f.model.userData[key].visible = false;
  }
  window.smashCamera.spectate({ fighter: f, framing: 'torso', yaw: window.__frontYaw + 100, pitch: -2, distance: 2.35, transition: 0 });
  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));
  return document.querySelector('canvas').toDataURL('image/png');
});
if (defeatCloseup?.length > 5000) {
  await writeFile(resolve(out, 'defeat-coat.png'), Buffer.from(defeatCloseup.split(',')[1], 'base64'));
}

const failed = results.rows.filter(row => !row.ok);
const seamFinding = results.rows.find(row => row.clip === 'Naruto_defeat');
console.log(`STATES ${results.rows.filter(row => row.ok).length}/${results.rows.length}`);
console.log('MISSING', JSON.stringify(setResult.missing), 'EXTRA', JSON.stringify(setResult.extra));
console.log('DEFEAT_SEAM', JSON.stringify({ minimum: seamFinding?.seamMin, worst: seamFinding?.worstSeam, liveEnd: seamFinding?.seam }));
console.log('ERRORS', JSON.stringify(errors.slice(0, 4)), 'FAILED_REQUESTS', JSON.stringify(failedRequests.slice(0, 4)));
await browser.close();
server.close();
if (failed.length || setResult.missing.length || setResult.extra.length || errors.length || failedRequests.length) {
  console.log('FAILED_STATES', JSON.stringify(failed.map(row => ({ clip: row.clip, problems: row.problems }))));
  process.exit(1);
}
console.log('Naruto Sage 49-state live acceptance passed.');
