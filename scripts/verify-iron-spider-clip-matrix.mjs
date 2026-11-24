// Iron Spider full visual clip matrix.
//
// Reads the live 57-clip action map from the mounted source-backed Iron Spider body, computes each
// clip's deformation from its own tracks, plays it on the real 107-bone skeleton at its peak pose,
// and captures one frame per clip. The report records PASS/FAIL and the measured body and native-arm
// motion; zero-motion source clips are failures, not silently skipped.
//
//   bash scripts/run-browser-test.sh scripts/verify-iron-spider-clip-matrix.mjs
//   IRON_CLIP_LIMIT=4 bash scripts/run-browser-test.sh scripts/verify-iron-spider-clip-matrix.mjs
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/iron-spider/clip-matrix');
const clipsDir = resolve(out, 'clips');
await mkdir(clipsDir, { recursive: true });
const runtimeGlb = resolve(root, 'public/models/characters/iron_spider/iron_spider_source_animated.glb');
const runtimeBuffer = await readFile(runtimeGlb);
const runtimeSha = createHash('sha256').update(runtimeBuffer).digest('hex');
const runtimeJsonLength = runtimeBuffer.readUInt32LE(12);
const runtimeJson = JSON.parse(runtimeBuffer.subarray(20, 20 + runtimeJsonLength).toString('utf8'));
const runtimeClipNames = (runtimeJson.animations || []).map(animation => animation.name).filter(Boolean);
const limit = Math.max(0, Number(process.env.IRON_CLIP_LIMIT) || 0);
const offset = Math.max(0, Number(process.env.IRON_CLIP_OFFSET) || 0);
const indices = String(process.env.IRON_CLIP_INDICES || '').split(',').map(value => value.trim()).filter(Boolean).map(Number).filter(Number.isInteger);
const only = String(process.env.IRON_CLIP_ONLY || '').split(',').map(value => value.trim()).filter(Boolean);

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};
const errors = [];
const failedRequests = [];

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 720 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => errors.push(String(error.stack || error).slice(0, 300)));
  page.on('response', response => {
    if (response.status() >= 400) failedRequests.push(response.status() + ' ' + response.url().slice(-140));
  });
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
    } catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2,
  null, { timeout: 120_000, polling: 200 });

  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    const select = window.__browserSmashSelect;
    select.setMode('1p');
    select.select('p1', 'Iron Spider');
    select.select('p2', 'Goku');
    select.chooseArena('tournament');
    window.__browserSmashGame.startMatch();
    window.__browserSmashStep(0.2);
  });
  await page.waitForFunction(() => {
    const [p1, p2] = window.fighters || [];
    const u = p1?.model?.userData;
    return p1?.identity === 'Iron Spider' && p1.characterModelLoaded === true
      && p2?.identity === 'Goku' && window.__browserSmashControlMode?.().started === true
      && Boolean(u?.nativeSpiderLegs) && Object.keys(u?.animationActions || {}).length === 57;
  }, null, { timeout: 120_000, polling: 250 });
  await page.waitForFunction(() => {
    const loading = window.__bbLoading?.describe?.();
    return loading && loading.visible === false;
  }, null, { timeout: 30_000, polling: 100 }).catch(() => {});
  await page.evaluate(() => window.__browserSmashStep(0.8));
  await page.evaluate(() => window.__browserSmashSetPaused(true));
  await page.addStyleTag({ content: '#bbHudLayer, #bbHudLayer *, #combatCallout, #hud, #energyHUD, #comboNotice, #roundScore, #cameraSettings, #executeHint { display: none !important; }' });

  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel ?? 0, -12);
    p1.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0;
    p1.model.visible = true;
    p2.position.set(14, p2.groundLevel ?? 0, -12);
    p2.velocity.set(0, 0, 0);
    p2.model.visible = false;
    window.smashCamera.spectate({
      fighter: p1,
      framing: 'full',
      yaw: 32,
      pitch: 6,
      distance: 4.2,
      transition: 0
    });
  });
  await page.waitForTimeout(350);

  const inventory = await page.evaluate(expectedNames => {
    const u = window.fighters[0].model.userData;
    // `animationActions` is a mixed map: clip-name keys plus legacy slot aliases. Seven aliases
    // overwrite the supplemental clips of the same name, so use the mixer's action cache as the
    // source of truth and filter it to the GLB's exact 57 names.
    const publicMap = u.animationActions || {};
    const actionPool = [...new Set([...Object.values(publicMap), ...(u.humanMixer?._actions || [])])];
    const byName = new Map();
    for (const action of actionPool) {
      const clip = action?.getClip?.();
      if (clip && expectedNames.includes(clip.name)) byName.set(clip.name, action);
    }
    const clips = [];
    for (const name of expectedNames) {
      const action = byName.get(name);
      const clip = action?.getClip?.();
      if (!clip) continue;
      const quatTracks = clip.tracks.filter(track =>
        track.name.endsWith('.quaternion') && track.values.length >= 4);
      const times = quatTracks[0]?.times || [];
      const keyCount = Math.max(1, ...quatTracks.map(track => track.times.length));
      const angle = (values, a, b) => {
        const i = Math.min(a, Math.floor(values.length / 4) - 1) * 4;
        const j = Math.min(b, Math.floor(values.length / 4) - 1) * 4;
        const dot = Math.abs(values[i] * values[j] + values[i + 1] * values[j + 1]
          + values[i + 2] * values[j + 2] + values[i + 3] * values[j + 3]);
        return 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
      };
      let peakIndex = 0;
      let peakScore = -1;
      for (let k = 0; k < keyCount; k += 1) {
        let score = 0;
        for (const track of quatTracks) {
          const index = Math.min(k, track.times.length - 1);
          if (index > 0) score += angle(track.values, 0, index);
        }
        if (score > peakScore) { peakScore = score; peakIndex = k; }
      }
      let maxAngle = 0;
      let movingBones = 0;
      let spiderBonesMoved = 0;
      for (const track of quatTracks) {
        let trackMax = 0;
        for (let k = 1; k < track.times.length; k += 1) {
          trackMax = Math.max(trackMax, angle(track.values, 0, track.times.length - 1));
        }
        // The per-track maximum above compares the first and last key only; also inspect the
        // intermediate keys because a clip can return to its start pose at the end.
        for (let k = 1; k < track.times.length; k += 1) {
          trackMax = Math.max(trackMax, angle(track.values, 0, k));
        }
        maxAngle = Math.max(maxAngle, trackMax);
        if (trackMax > 1) {
          movingBones += 1;
          const bone = track.name.slice(0, track.name.lastIndexOf('.'));
          if (/spider/i.test(bone)) spiderBonesMoved += 1;
        }
      }
      const short = clip.name.includes('@') ? clip.name.slice(clip.name.lastIndexOf('@') + 1) : clip.name;
      clips.push({
        name: clip.name,
        short,
        source: clip.name.includes('@') ? 'source' : 'supplemental',
        duration: +Number(clip.duration || 0).toFixed(3),
        tracks: clip.tracks.length,
        movingBones,
        spiderBonesMoved,
        maxAngleDeg: +maxAngle.toFixed(2),
        peakTime: +(times[Math.min(peakIndex, Math.max(0, times.length - 1))] ?? 0).toFixed(3)
      });
    }
    return {
      total: clips.length,
      source: clips.filter(clip => clip.source === 'source').length,
      supplemental: clips.filter(clip => clip.source === 'supplemental').length,
      clips,
      publicMap: {
        keys: Object.keys(publicMap).length,
        uniqueClips: new Set(Object.values(publicMap).map(action => action?.getClip?.().name).filter(Boolean)).size
      },
      mixerActions: new Set((u.humanMixer?._actions || []).map(action => action?.getClip?.().name).filter(Boolean)).size,
      arm: {
        mesh: u.nativeSpiderLegs?.mesh || null,
        bones: u.nativeSpiderLegs?.bones || 0
      }
    };
  }, runtimeClipNames);

  check('the live mixer exposes exactly 57 unique GLB clips', inventory.total === 57,
    `${inventory.total} clips`);
  console.log(`ACTION MAP keys=${inventory.publicMap.keys} unique=${inventory.publicMap.uniqueClips} · mixer unique=${inventory.mixerActions}`);
  check('the supplied 32 source clips and 25 supplemental clips are both present',
    inventory.source === 32 && inventory.supplemental === 25,
    `${inventory.source} source + ${inventory.supplemental} supplemental`);
  check('the native Object_122 arm is mounted before the matrix', Boolean(inventory.arm.mesh),
    JSON.stringify(inventory.arm));
  check('the source-backed runtime GLB is the asset under test',
    /iron_spider_source_animated\.glb$/.test(await page.evaluate(() =>
      window.__browserSmashAssets?.characterModels?.iron_spider?.url || '')),
    'runtime GLB');

  const indexed = inventory.clips.map((clip, index) => ({ clip, index: index + 1 }));
  const selected = indices.length
    ? indexed.filter(entry => indices.includes(entry.index))
    : only.length
      ? indexed.filter(entry => only.includes(entry.clip.short) || only.includes(entry.clip.name))
      : indexed.slice(offset, limit ? offset + limit : undefined);
  const records = [];
  for (const { clip, index: displayIndex } of selected) {
    const record = await page.evaluate(({ name, peakTime, maxAngleDeg }) => {
      const THREE = window.__browserSmashThree;
      const fighter = window.fighters[0];
      const model = fighter.model;
      const u = model.userData;
      const mixer = u.humanMixer;
      const arm = model.getObjectByName?.('Object_122') || null;
      // Object_120 is the 107-bone body. Measuring Object_122 alone was the flaw in the first
      // draft: it is the 21-bone appendage, so the body was never reset, measured or framed.
      const bodyMesh = model.getObjectByName?.('Object_120') || (() => {
        let candidate = null;
        model.traverse(object => {
          if (object.isSkinnedMesh && object.skeleton?.bones?.length >= 100) candidate = object;
        });
        return candidate;
      })();
      const bodySkeleton = bodyMesh?.skeleton || null;
      const armSkeleton = arm?.skeleton || null;
      if (!mixer || !bodyMesh || !bodySkeleton || !armSkeleton) {
        return { error: 'missing mixer, body skeleton or native skeleton' };
      }
      const actionPool = [...new Set([...Object.values(u.animationActions || {}), ...(u.humanMixer?._actions || [])])];
      const sourceAction = actionPool.find(item => item?.getClip?.().name === name);
      if (!sourceAction) return { error: 'action not found' };
      const sourceClip = sourceAction.getClip();
      const duration = Number(sourceClip.duration) || 0;
      const neutralSource = actionPool.find(item => {
        const candidate = item?.getClip?.();
        return candidate && /@idle$/.test(candidate.name) && candidate.tracks.length >= 100;
      });
      const neutralAction = neutralSource ? mixer.clipAction(neutralSource.getClip()) : null;
      // Helper/weapon bones carry 0.0001 scale keys in several source clips (atk-02 is one). Those
      // scale keys collapse the skinned character to a dot, so the visual matrix uses a clip with
      // the scale channels removed. Rotation and translation - the actual body performance - stay.
      const partialClip = sourceClip.tracks.length < 100;
      const pelvisTrack = sourceClip.tracks.find(track => /Pelvis_03/i.test(track.name) && /quaternion$/i.test(track.name));
      const visualTracks = sourceClip.tracks.filter(track => {
        if (/\.scale$/.test(track.name)) return false;
        // Partial roster clips carry a pelvis rotation authored in the lying export frame. With
        // the upright idle seed that single track re-lays the whole body; keep the limb rotations
        // and translations, but let the neutral pelvis own the root orientation.
        if (partialClip && pelvisTrack && track === pelvisTrack) return false;
        return true;
      });
      const pelvisRotationFiltered = Boolean(partialClip && pelvisTrack);
      const visualClip = new THREE.AnimationClip(sourceClip.name, sourceClip.duration, visualTracks);
      const action = mixer.clipAction(visualClip);

      // Start from the GLB bind pose so the 25 supplemental clips, which only carry 19 tracks,
      // are not judged against a leftover source pose. Then apply the clip at time zero to get the
      // clip's own base before sampling its peak.
      mixer.stopAllAction();
      bodySkeleton.pose();
      armSkeleton.pose();
      // The 25 supplemental clips (and the two zero-track source clips) only carry 19 partial
      // tracks. The GLB bind pose is lying down; the 32 full source clips animate the root upright.
      // Seed partial clips from the upright source idle so their unowned root stays standing.
      const useNeutralBase = sourceClip.tracks.length < 100 || duration === 0 || maxAngleDeg < 1;
      if (useNeutralBase && neutralAction) {
        neutralAction.reset();
        neutralAction.setLoop(THREE.LoopOnce, 1);
        neutralAction.clampWhenFinished = true;
        neutralAction.enabled = true;
        neutralAction.setEffectiveWeight(1);
        neutralAction.setEffectiveTimeScale(1);
        neutralAction.play();
        neutralAction.paused = false;
        neutralAction.time = 0;
        mixer.update(0);
        neutralAction.paused = true;
        const neutralBody = bodySkeleton.bones.map(bone => ({
          position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone()
        }));
        const neutralArm = armSkeleton.bones.map(bone => ({
          position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone()
        }));
        neutralAction.stop();
        for (let i = 0; i < bodySkeleton.bones.length; i += 1) {
          const bone = bodySkeleton.bones[i], pose = neutralBody[i];
          bone.position.copy(pose.position); bone.quaternion.copy(pose.quaternion); bone.scale.copy(pose.scale);
        }
        for (let i = 0; i < armSkeleton.bones.length; i += 1) {
          const bone = armSkeleton.bones[i], pose = neutralArm[i];
          bone.position.copy(pose.position); bone.quaternion.copy(pose.quaternion); bone.scale.copy(pose.scale);
        }
        bodySkeleton.update();
        armSkeleton.update();
      }
      const staticClip = maxAngleDeg < 1;
      if (!staticClip) {
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.enabled = true;
        action.setEffectiveWeight(1);
        action.setEffectiveTimeScale(1);
        action.play();
        action.paused = false;
        action.time = 0;
      } else {
        // A zero-motion clip's constant tracks can still carry the malformed lying root pose.
        // Do not let them overwrite the upright neutral seed; the report has no-live-motion.
        action.enabled = false;
      }
      mixer.update(0);
      model.updateMatrixWorld(true);
      const bodyBase = bodySkeleton.bones.map(bone => bone.quaternion.toArray());
      const armBase = armSkeleton.bones.map(bone => bone.quaternion.toArray());
      // A neutral seed is a presentation baseline, not part of the clip's own track evidence.
      // Record it so a reader can tell why a 19-track supplement is not judged against a lying bind.
      const baseMode = useNeutralBase ? 'source-idle' : 'bind';
      action.time = Math.min(peakTime, Number(action.getClip().duration) || peakTime);
      action.paused = true;
      mixer.update(0);
      bodySkeleton.update();
      armSkeleton.update();
      bodyMesh.updateMatrixWorld(true);
      arm.updateMatrixWorld(true);

      const measureLive = (bones, base) => {
        let angleMax = 0;
        let moving = 0;
        for (let i = 0; i < bones.length; i += 1) {
          const q = bones[i].quaternion;
          const b = base[i];
          const dot = Math.abs(q.x * b[0] + q.y * b[1] + q.z * b[2] + q.w * b[3]);
          const angle = 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
          angleMax = Math.max(angleMax, angle);
          if (angle > 0.5) moving += 1;
        }
        return { angleMax, moving };
      };
      const bodyLive = measureLive(bodySkeleton.bones, bodyBase);
      const armLive = measureLive(armSkeleton.bones, armBase);
      const measureBodyBox = () => {
        bodyMesh.computeBoundingBox();
        arm.computeBoundingBox();
        const bodyOnly = bodyMesh.boundingBox?.clone?.().applyMatrix4(bodyMesh.matrixWorld) || new THREE.Box3();
        const limb = arm.boundingBox?.clone?.().applyMatrix4(arm.matrixWorld) || new THREE.Box3();
        const combined = bodyOnly.clone();
        if (!limb.isEmpty()) combined.union(limb);
        return { bodyOnly, limb, combined };
      };
      const setPoseTime = time => {
        // Static clips deliberately have no active action: seeking them would re-enable their
        // constant malformed root tracks and undo the upright neutral pose.
        if (staticClip) return measureBodyBox();
        // A paused action can keep returning its old time to the mixer. Unpause for the seek,
        // apply a zero-delta update, then freeze the resulting pose for the capture.
        action.paused = false;
        action.time = Math.min(Math.max(0, time), duration || 0);
        action.enabled = true;
        mixer.update(0);
        action.paused = true;
        bodySkeleton.update();
        armSkeleton.update();
        bodyMesh.updateMatrixWorld(true);
        arm.updateMatrixWorld(true);
        return measureBodyBox();
      };
      // The authored peak is not always a usable illustration: atk-02 reaches a scale/translation
      // key that collapses the skinned body to a few centimetres. Keep the peak for the motion
      // measurement, but choose a representative visible frame for the screenshot.
      const peakBox = setPoseTime(Math.min(peakTime, duration));
      const peakOnlySize = peakBox.bodyOnly.getSize(new THREE.Vector3());
      const peakBodySize = peakOnlySize.toArray().map(value => +value.toFixed(3));
      const peakBodyVolume = peakOnlySize.x * peakOnlySize.y * peakOnlySize.z;
      const peakTimeClamped = +Math.min(peakTime, duration).toFixed(3);
      const peakSample = { time: peakTimeClamped, volume: +peakBodyVolume.toFixed(6) };
      let samples = [peakSample];
      let chosen = peakSample;
      let finalBox = peakBox;
      // The peak is the normal case. Sampling alternate times is a fallback only for a clip whose
      // peak collapses or hides the body; doing it for every clip made the full run too slow for
      // the browser harness's five-minute command window.
      if (peakBodyVolume < 0.01 && duration > 0) {
        const times = [0, duration * 0.25, duration * 0.5, duration * 0.75, duration * 0.95];
        samples = times.map(time => {
          const sampleBox = setPoseTime(time);
          const sampleSize = sampleBox.bodyOnly.getSize(new THREE.Vector3());
          return { time: +time.toFixed(3), volume: sampleSize.x * sampleSize.y * sampleSize.z, box: sampleBox };
        });
        chosen = samples.reduce((best, sample) => sample.volume > best.volume ? sample : best, samples[0]);
        finalBox = chosen.box || setPoseTime(chosen.time);
      }
      const chosenTime = chosen.time;
      const bodyOnlyBox = finalBox.bodyOnly;
      const armBox = finalBox.limb;
      const box = finalBox.combined;
      const bodySize = box.getSize(new THREE.Vector3()).toArray().map(value => +value.toFixed(3));
      const bodyCenter = box.getCenter(new THREE.Vector3());
      const bodyOnlySize = bodyOnlyBox.getSize(new THREE.Vector3()).toArray().map(value => +value.toFixed(3));
      const armSize = armBox.getSize(new THREE.Vector3()).toArray().map(value => +value.toFixed(3));
      const camera = window.smashCamera.camera;
      const fov = 46;
      camera.fov = fov;
      // Fit the full bounding sphere, not just the centre distance: a large/deep pose had corners
      // outside the frame even though its centre was inside.
      const radius = Math.max(0.2, Math.hypot(bodySize[0], bodySize[1], bodySize[2]) / 2);
      const distance = Math.max(4.2, radius / Math.sin(THREE.MathUtils.degToRad(fov / 2)) * 1.2);
      const modelYaw = Number.isFinite(Math.atan2(model.matrixWorld.elements[8], model.matrixWorld.elements[10]))
        ? Math.atan2(model.matrixWorld.elements[8], model.matrixWorld.elements[10]) : 0;
      const yaw = modelYaw + THREE.MathUtils.degToRad(32);
      const pitch = THREE.MathUtils.degToRad(6);
      const horizontal = Math.cos(pitch) * distance;
      camera.position.set(
        bodyCenter.x + Math.sin(yaw) * horizontal,
        Math.max(0.6, bodyCenter.y + Math.sin(pitch) * distance + bodySize[1] * 0.05),
        bodyCenter.z + Math.cos(yaw) * horizontal
      );
      camera.lookAt(bodyCenter);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      const centerRay = new THREE.Raycaster();
      centerRay.setFromCamera(new THREE.Vector2(0, 0), camera);
      let sceneRoot = model;
      while (sceneRoot.parent) sceneRoot = sceneRoot.parent;
      const centerHits = centerRay.intersectObject(sceneRoot, true)
        .filter(hit => hit.object.visible)
        .slice(0, 6)
        .map(hit => ({
          name: hit.object.name || '',
          type: hit.object.type,
          parent: hit.object.parent?.name || '',
          distance: +hit.distance.toFixed(2),
          inModel: (() => { let node = hit.object; while (node) { if (node === model) return true; node = node.parent; } return false; })()
        }));
      const meshSummary = [];
      model.traverse(object => {
        if (!object.isMesh) return;
        const meshBox = new THREE.Box3().setFromObject(object);
        if (meshBox.isEmpty()) return;
        const meshSize = meshBox.getSize(new THREE.Vector3());
        if (Math.max(meshSize.x, meshSize.y, meshSize.z) < 0.25) return;
        meshSummary.push({
          name: object.name || '', type: object.type, skinned: Boolean(object.isSkinnedMesh),
          visible: object.visible,
          material: (Array.isArray(object.material) ? object.material : [object.material])
            .map(material => material?.name || material?.color?.getHexString?.() || '').join(','),
          size: meshSize.toArray().map(value => +value.toFixed(2)),
          center: meshBox.getCenter(new THREE.Vector3()).toArray().map(value => +value.toFixed(2))
        });
      });
      let maxAbsNdc = 0;
      let bodyNdc = null;
      if (!box.isEmpty()) {
        bodyNdc = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              const point = new THREE.Vector3(x, y, z).project(camera);
              bodyNdc.minX = Math.min(bodyNdc.minX, point.x);
              bodyNdc.maxX = Math.max(bodyNdc.maxX, point.x);
              bodyNdc.minY = Math.min(bodyNdc.minY, point.y);
              bodyNdc.maxY = Math.max(bodyNdc.maxY, point.y);
              maxAbsNdc = Math.max(maxAbsNdc, Math.abs(point.x), Math.abs(point.y));
            }
          }
        }
        bodyNdc = Object.fromEntries(Object.entries(bodyNdc).map(([key, value]) => [key, +value.toFixed(3)]));
      }
      u.currentClip = name;
      return {
        actionFound: true,
        liveAngleDeg: +bodyLive.angleMax.toFixed(2),
        liveMovingBones: bodyLive.moving,
        arm: {
          present: Boolean(arm), visible: Boolean(arm.visible), parent: arm.parent?.name || null,
          size: armSize, bones: armSkeleton.bones.length,
          liveAngleDeg: +armLive.angleMax.toFixed(2), liveMovingBones: armLive.moving
        },
        body: { mesh: bodyMesh.name, bones: bodySkeleton.bones.length, onlySize: bodyOnlySize },
        bodySize,
        peakBodySize,
        peakBodyVolume: +peakBodyVolume.toFixed(6),
        captureTime: chosenTime,
        captureVolume: +chosen.volume.toFixed(6),
        scaleTracksFiltered: sourceClip.tracks.length - visualTracks.length,
        sourceTrackCount: sourceClip.tracks.length,
        pelvisRotationFiltered,
        staticClip,
        baseMode,
        samples: samples.map(sample => ({ time: sample.time, volume: +sample.volume.toFixed(6) })),
        bodyCenter: bodyCenter.toArray().map(value => +value.toFixed(3)),
        framing: { maxAbsNdc: +maxAbsNdc.toFixed(3), bodyNdc },
        centerHits,
        meshSummary,
        camera: { x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2) },
        mixerTime: +mixer.time.toFixed(3)
      };
    }, { name: clip.name, peakTime: clip.peakTime, maxAngleDeg: clip.maxAngleDeg });

    const file = `${String(displayIndex).padStart(2, '0')}-${clip.short.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}.png`;
    const absolute = resolve(clipsDir, file);
    await page.waitForTimeout(80);
    const image = await page.screenshot({ path: absolute });
    const reasons = [];
    if (!record?.actionFound) reasons.push(record?.error || 'action-missing');
    if (clip.duration <= 0) reasons.push('zero-duration');
    if (clip.maxAngleDeg < 1) reasons.push('no-track-deformation');
    if (!record?.actionFound || record.liveAngleDeg < 0.5) reasons.push('no-live-pose-change');
    if (!record?.arm?.present) reasons.push('native-arm-missing');
    if (!record?.framing || !record.framing.bodyNdc || record.framing.maxAbsNdc > 0.98) reasons.push('off-camera');
    if (!record?.captureVolume || record.captureVolume < 0.01) reasons.push('body-too-small');
    if (image.length < 5_000) reasons.push('capture-too-small');
    const status = reasons.length ? 'FAIL' : 'PASS';
    const row = {
      index: displayIndex,
      ...clip,
      peakTime: clip.peakTime,
      actionFound: record?.actionFound ?? false,
      liveAngleDeg: record?.liveAngleDeg ?? null,
      liveMovingBones: record?.liveMovingBones ?? null,
      arm: record?.arm ?? null,
      bodySize: record?.bodySize ?? null,
      peakBodySize: record?.peakBodySize ?? null,
      peakBodyVolume: record?.peakBodyVolume ?? null,
      captureTime: record?.captureTime ?? null,
      captureVolume: record?.captureVolume ?? null,
      scaleTracksFiltered: record?.scaleTracksFiltered ?? null,
      sourceTrackCount: record?.sourceTrackCount ?? null,
      pelvisRotationFiltered: record?.pelvisRotationFiltered ?? null,
      staticClip: record?.staticClip ?? null,
      baseMode: record?.baseMode ?? null,
      samples: record?.samples ?? null,
      bodyCenter: record?.bodyCenter ?? null,
      framing: record?.framing ?? null,
      centerHits: record?.centerHits ?? null,
      meshSummary: record?.meshSummary ?? null,
      camera: record?.camera ?? null,
      capture: `artifacts/iron-spider/clip-matrix/clips/${file}`,
      captureBytes: image.length,
      status,
      reasons
    };
    records.push(row);
    console.log(`${status} ${String(displayIndex).padStart(2, '0')}/57 ${clip.short.padEnd(18)} ` +
      `duration=${clip.duration.toFixed(2)}s peak=${clip.peakTime.toFixed(2)}s ` +
      `track=${clip.maxAngleDeg.toFixed(1)}° live=${row.liveAngleDeg ?? '?'}° ` +
      `bones=${clip.movingBones} arm=${clip.spiderBonesMoved} capture=${row.captureTime?.toFixed(2)}s`);
  }

  check('every selected clip has a capture', records.every(record => record.captureBytes > 0),
    `${records.length} captures`);
  check('every selected clip has a real action and a live pose measurement',
    records.every(record => record.actionFound !== false && record.liveAngleDeg !== null),
    records.filter(record => record.liveAngleDeg === null).map(record => record.short).join(', ') || 'all measured');
  check('the native arm is attached and visible in every captured clip',
    records.every(record => record.arm?.present && record.arm.visible),
    records.filter(record => !record.arm?.present || !record.arm.visible).map(record => record.short).join(', ') || 'all visible');
  check('no browser runtime errors during the matrix', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('no failed asset requests during the matrix', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

  const summary = {
    total: records.length,
    pass: records.filter(record => record.status === 'PASS').length,
    fail: records.filter(record => record.status === 'FAIL').length,
    source: records.filter(record => record.source === 'source').length,
    supplemental: records.filter(record => record.source === 'supplemental').length,
    armAnimatedClips: records.filter(record => record.spiderBonesMoved > 0).length,
    zeroMotion: records.filter(record => record.maxAngleDeg < 1).map(record => record.short)
  };
  console.log(`\nSUMMARY total=${summary.total} pass=${summary.pass} fail=${summary.fail} ` +
    `source=${summary.source} supplemental=${summary.supplemental} armAnimated=${summary.armAnimatedClips}`);

  // Compose the matrix sheet from the actual captures. Every tile carries its own PASS/FAIL and
  // measured motion, so the sheet is a review artifact rather than an unexplained contact sheet.
  const tiles = [];
  for (const record of records) {
    const image = await readFile(resolve(root, record.capture));
    tiles.push({
      ...record,
      src: 'data:image/png;base64,' + image.toString('base64')
    });
  }
  const sheetPage = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const escape = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const cards = tiles.map(tile => `
    <figure class="${tile.status.toLowerCase()}">
      <img src="${tile.src}" alt="${escape(tile.short)}">
      <figcaption>
        <b>${tile.status}</b> <span>${escape(tile.short)}</span>
        <em>${tile.maxAngleDeg.toFixed(1)}° track · ${tile.liveAngleDeg ?? '?'}° live · ${tile.spiderBonesMoved} arm</em>
        <small>${tile.captureBytes.toLocaleString()} bytes · ${tile.reasons.join(', ') || 'captured'}</small>
      </figcaption>
    </figure>`).join('');
  await sheetPage.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #07111a; color: #e7f0f6; font-family: Inter, Arial, sans-serif; }
    header { padding: 26px 30px 16px; border-bottom: 1px solid #1c3445; }
    h1 { margin: 0; font-size: 27px; letter-spacing: .04em; }
    header p { margin: 7px 0 0; color: #80a6bc; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; }
    main { display: grid; grid-template-columns: repeat(8, 1fr); gap: 12px; padding: 16px 20px 24px; }
    figure { margin: 0; background: #0b1a25; border: 1px solid #274556; border-radius: 4px; overflow: hidden; }
    figure.pass { border-color: #2f8f6a; }
    figure.fail { border-color: #b24d4d; }
    img { display: block; width: 100%; height: auto; aspect-ratio: 8 / 9; object-fit: contain; background: #0d1c27; }
    figcaption { padding: 6px 7px 7px; display: flex; flex-direction: column; gap: 2px; min-height: 62px; }
    figcaption b { font-size: 11px; letter-spacing: .08em; color: #7fe0b4; }
    figure.fail figcaption b { color: #ff8d8d; }
    figcaption span { font: 700 11px/1.2 ui-monospace, monospace; color: #d9e7ef; word-break: break-word; }
    figcaption em, figcaption small { font: 9px/1.25 ui-monospace, monospace; color: #7fa4bb; font-style: normal; }
    footer { padding: 0 30px 24px; color: #66849a; font-size: 11px; }
  </style></head><body>
    <header><h1>IRON SPIDER · 57-CLIP VISUAL MATRIX</h1>
    <p>${summary.pass}/${summary.total} pass · ${summary.fail} fail · ${summary.source} source + ${summary.supplemental} supplemental · native Object_122 · peak-pose captures</p></header>
    <main>${cards}</main>
    <footer>Live 107-bone Iron Spider body · Tournament arena · simulation paused per clip · headless Chromium / SwiftShader composition evidence, not hardware or performance verification.</footer>
  </body></html>`);
  await sheetPage.waitForTimeout(500);
  const sheetFile = resolve(out, 'clip-matrix-sheet.png');
  await sheetPage.screenshot({ path: sheetFile, fullPage: true });

  const report = {
    generatedAt: new Date().toISOString(),
    runtime: { glb: 'public/models/characters/iron_spider/iron_spider_source_animated.glb', sha256: runtimeSha },
    renderer: 'headless Chromium / SwiftShader',
    viewport: { width: 640, height: 720 },
    batch: { offset, limit, indices, selected: records.length },
    inventory,
    summary,
    clips: records,
    sheet: 'artifacts/iron-spider/clip-matrix/clip-matrix-sheet.png',
    checks,
    pageErrors: errors,
    failedRequests
  };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  const failedChecks = checks.filter(entry => !entry.ok);
  console.log(`\n${checks.length - failedChecks.length}/${checks.length} matrix harness checks passed`);
  console.log(`SHEET ${sheetFile}`);
  console.log(`REPORT ${resolve(out, 'report.json')}`);
  if (failedChecks.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
