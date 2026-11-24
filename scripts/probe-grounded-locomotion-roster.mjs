// Grounded-locomotion roster sweep.
//   bash scripts/run-browser-test.sh scripts/probe-grounded-locomotion-roster.mjs [--start=N] [--count=N] [--acceptance=off]
//
// Runs the real foot-plant layer over every selectable body and records, per rig:
//   - whether either foot acquires and holds contact during a live walk
//   - how much a held ankle still travels in world space (residual slide)
//   - settled-contact horizontal world travel (weight >= 0.85), reported beside the settled
//     unreachable-target residual so genuine foot slide is not confused with blend-in IK lag
//   - contact frames whose ankle is raised well above the rig's own idle contact band
//   - sole, toe and heel contact from the visible foot bone, with the sole plane calibrated to
//     that foot's lowest ankle height rather than the canonical foot slot
//   - planted yaw from the foot bone's world rotation, floor penetration, and camera-corrected
//     screen-space slip of the footprint points
//   - rigs that never acquire contact at all
//
// Every complete leg chain is enrolled now, so each measured body uses the same live layer as
// normal play. One browser page switches the player body through the normal character-select
// path, so each measurement reads the skeleton the game actually mounts rather than a fixture.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/grounded-locomotion');
await mkdir(outDir, { recursive: true });
const audit = JSON.parse(await readFile(resolve(root, 'artifacts/rig-audit.json'), 'utf8'));
// The rig audit also inventories DLC bodies. Only the launch roster is selectable through the
// normal fighter picker, so the live sweep must not report an unreachable entry as a failed rig.
const mainSource = await readFile(resolve(root, 'public/js/main.js'), 'utf8');
const launchMatch = mainSource.match(/const roster=(\[\[.*?\]\]);const dlcRoster=/s);
if (!launchMatch) throw new Error('could not read launch roster from public/js/main.js');
const launch = new Set(JSON.parse(launchMatch[1]).map(([name]) => name));
const allSubjects = audit.fighters
  .filter(row => launch.has(row.name))
  .map(row => ({ name: row.name, slug: row.slug, group: row.groupId, joints: row.joints }));

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, value = ''] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const start = Math.max(0, Number(args.start) || 0);
const count = Math.max(1, Number(args.count) || allSubjects.length);
// A targeted rerun can name the exact bodies it needs instead of walking the roster order.
// Example: --names="Hulk (Bruce Banner),Vegeta" --tag=hold-a
const only = args.names
  ? new Set(args.names.split(',').map(name => name.trim()).filter(Boolean))
  : null;
const subjects = only ? allSubjects.filter(subject => only.has(subject.name)) : allSubjects;
const batch = subjects.slice(start, start + count);
if (only && batch.length === 0) throw new Error('no probe subjects matched --names');
const tag = args.tag || `batch-${start}-${start + batch.length - 1}`;
const isGaitClip = clip => /(?:walk|run|sprint)/i.test(String(clip || ''));

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
    const file = resolve(root, relative);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end('forbidden'); return; }
    const bytes = await readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[extname(relative).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(bytes);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const rows = [];
const rowsBySlug = new Map();
const errors = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => errors.push(String(error?.stack || error)));
  page.on('console', message => {
    if (message.type() === 'error' && !/404 \(Not Found\)|Failed to load resource/.test(message.text())) {
      errors.push(message.text());
    }
  });
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({
        status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath)
      });
    } catch (error) {
      await route.fulfill({ status: 404, body: String(error?.message || error) });
    }
  });

  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 200 });
  await page.click('#menu [data-nav="versus"]');
  await page.waitForSelector('#selectScreen .bs-card', { state: 'visible' });
  await page.click('#selectScreen .bs-card[data-fighter="Kaze"]');
  await page.click('#selectScreen .bs-card[data-fighter="Goku"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.evaluate(() => {
    window.__browserSmashSelect.setMode('2p');
    window.__browserSmashTrainingDummy = true;
  });
  await page.click('#play');
  await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting',
    null, { timeout: 120_000, polling: 200 });
  if (args.acceptance === 'off') {
    // Re-measure every rig for a new acceptance table; normal play keeps the table gate on.
    // No optional call here: a missing bypass must fail the run instead of silently measuring
    // rows against the authored fallback.
    await page.evaluate(() => window.__browserSmashSetFootAcceptance(false));
  }
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(-7, p1.groundLevel || 0.18, -11);
    p2.position.set(8, p2.groundLevel || 0.18, -11);
    for (const f of [p1, p2]) {
      f.velocity.set(0, 0, 0);
      f.hitstun = 0;
      f.attackQueue.length = 0;
      f.guardBreak = 0;
      f.dodgeTimer = 0;
      f.isGrounded = true;
    }
  });

  // Foot-level evidence is measured from the mounted foot bone, not from the ankle report. The
  // foot bone supplies the orientation; the measured contact height supplies the sole plane. A
  // toe and heel point are placed on that plane along the foot's own forward axis, and the camera
  // projects all three points. Screen slip compares each point with the same world point at the
  // start of the plant, using the current camera, so camera tracking cancels out.
  await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    if (!THREE) throw new Error('foot probe: THREE global missing');
    const AXES = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
    ];
    const sides = [['left', 0], ['right', 1]];
    const frames = new WeakMap();
    const state = {
      left: { contact: false, quaternion: null, origin: null },
      right: { contact: false, quaternion: null, origin: null }
    };
    // Sole offsets are per mounted model: a re-selected rig must not inherit the previous body's
    // foot calibration from a global slot.
    const soleDrops = new WeakMap();
    const dropFor = (fighter, side) => {
      const drops = fighter?.model ? soleDrops.get(fighter.model) : null;
      return drops && Number.isFinite(drops[side]) ? drops[side] : null;
    };
    const footJoint = (fighter, key) => fighter?.model?.userData?.[key]
      || fighter?.animationController?.rig?.joints?.[key] || null;
    // The canonical foot slot prefers the first foot/ankle/toe bone in the hierarchy, which on
    // Goku and Link is a toe. Measure the visible foot from the actual Foot bone and keep the
    // optional Toe bone as the footprint's forward reference.
    const boneCache = new WeakMap();
    const footBones = fighter => {
      const model = fighter?.model;
      if (!model) return null;
      if (boneCache.has(model)) return boneCache.get(model);
      const found = { left: {}, right: {} };
      model.traverse(node => {
        const name = String(node.name || '');
        const lower = name.toLowerCase().replace(/[._:\-\s]/g, '');
        if (!lower || /ik|control|ctrl|effector|nub|socket|end|roll/.test(lower)) return;
        const side = lower.includes('left') ? 'left'
          : lower.includes('right') ? 'right'
          : /l(?:foot|ankle|toe)/.test(lower) ? 'left'
          : /r(?:foot|ankle|toe)/.test(lower) ? 'right'
          : /(?:foot|ankle|toe)l\d*$/.test(lower) ? 'left'
          : /(?:foot|ankle|toe)r\d*$/.test(lower) ? 'right' : null;
        if (!side) return;
        if (/toe/.test(lower)) {
          if (!found[side].toe) found[side].toe = node;
        } else if (/foot|ankle/.test(lower)) {
          if (!found[side].foot || (/foot/.test(lower) && !/foot/.test(String(found[side].foot.name || '').toLowerCase()))) {
            found[side].foot = node;
          }
        }
      });
      boneCache.set(model, found);
      return found;
    };
    const footFrame = (fighter, side, foot) => {
      const model = fighter.model;
      let cached = frames.get(model);
      if (!cached) {
        cached = {};
        frames.set(model, cached);
      }
      if (cached[side]) return cached[side];
      const facing = new THREE.Vector3(Number(fighter.facing) || 0, 0, Number(fighter.facingZ) || 1);
      if (facing.lengthSq() < 1e-6) facing.set(0, 0, 1);
      facing.normalize();
      const q = foot.getWorldQuaternion(new THREE.Quaternion());
      const worldAxes = AXES.map(axis => ({ axis, world: axis.clone().applyQuaternion(q) }));
      // Pick the bone axis closest to vertical as the sole normal. A foot bone's long axis can
      // point down the ankle (especially without a toe bone); treating that as forward tilts the
      // footprint by tens of degrees and invents toe/heel contacts that are not visible.
      let upLocal = null;
      let upWorld = null;
      for (const entry of worldAxes) {
        if (!upWorld || Math.abs(entry.world.y) > Math.abs(upWorld.y)) {
          upWorld = entry.world.clone();
          upLocal = entry.axis.clone();
        }
      }
      if (!upWorld || upWorld.lengthSq() < 1e-8) { upWorld = new THREE.Vector3(0, 1, 0); upLocal = new THREE.Vector3(0, 1, 0); }
      if (upWorld.y < 0) { upWorld.negate(); upLocal.negate(); }
      upWorld.normalize();
      // The forward axis is the in-plane bone axis pointing along the body's facing.
      let forwardLocal = null;
      let best = -Infinity;
      for (const entry of worldAxes) {
        const planar = entry.world.clone().addScaledVector(upWorld, -entry.world.dot(upWorld));
        const length = Math.hypot(planar.x, planar.z);
        if (length < 1e-4) continue;
        const score = (planar.x * facing.x + planar.z * facing.z) / length;
        if (score > best) {
          best = score;
          forwardLocal = entry.axis.clone();
        }
      }
      if (!forwardLocal) forwardLocal = new THREE.Vector3(0, 0, 1);
      forwardLocal.addScaledVector(upLocal, -forwardLocal.dot(upLocal));
      if (forwardLocal.lengthSq() < 1e-6) {
        forwardLocal.set(1, 0, 0).addScaledVector(upLocal, -upLocal.x);
      }
      if (forwardLocal.lengthSq() < 1e-6) forwardLocal.set(0, 0, 1);
      forwardLocal.normalize();
      cached[side] = { forwardLocal, upLocal };
      return cached[side];
    };
    const project = (point, camera, width, height) => {
      if (!camera) return null;
      const p = point.clone().project(camera);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.z < -1 || p.z > 1) return null;
      return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height };
    };
    const reset = () => {
      for (const [side] of sides) state[side] = { contact: false, quaternion: null, origin: null };
    };
    // Measure each visible foot's sole offset from its lowest ankle height during a short gait
    // window. The runtime contact height is calibrated from the canonical foot slot, which is a
    // toe bone on some rigs; this keeps the footprint anchored to the bone players actually see.
    // Cache each foot's sole frame at a controlled walking pose. Idle poses can hold a foot in a
    // flight/point orientation that is not the walking sole; the warm-up pose is consistent.
    const prime = () => {
      const fighter = window.fighters?.[0];
      const bones = footBones(fighter);
      if (!fighter || !bones) return false;
      for (const [side] of sides) {
        const foot = footJoint(fighter, side + 'Foot') || bones[side]?.foot;
        if (!foot) continue;
        foot.updateWorldMatrix(true, false);
        footFrame(fighter, side, foot);
      }
      return true;
    };
    // Measure the visible foot's sole offset at its lowest ankle height during a short gait window.
    // The runtime contact height is calibrated against the canonical foot slot, which can be a toe
    // or a flight-pose foot; this anchors the footprint to the bone players actually see walking.
    const calibrate = (seconds = 1.0) => {
      const fighter = window.fighters?.[0];
      const model = fighter?.model;
      const report = model?.userData?.locomotionReport || null;
      const bones = footBones(fighter);
      if (!fighter || !bones) return null;
      const minima = { left: Infinity, right: Infinity };
      const steps = Math.max(1, Math.round(seconds * 60));
      for (let i = 0; i < steps; i += 1) {
        window.__browserSmashStep(1 / 60);
        const rep = model.userData?.locomotionReport || report;
        for (const [side, index] of sides) {
          const foot = bones[side]?.foot;
          if (!foot) continue;
          foot.updateWorldMatrix(true, false);
          const ground = Number.isFinite(rep?.feet?.[index]?.ground)
            ? rep.feet[index].ground : (Number(fighter.position?.y) || 0);
          minima[side] = Math.min(minima[side], foot.getWorldPosition(new THREE.Vector3()).y - ground);
        }
      }
      let drops = null;
      for (const [side] of sides) {
        if (!Number.isFinite(minima[side])) continue;
        drops = drops || soleDrops.get(model) || {};
        drops[side] = Math.max(0.02, minima[side]);
      }
      if (drops) soleDrops.set(model, drops);
      return { ...(drops || {}) };
    };
    const read = () => {
      const fighter = window.fighters?.[0];
      const model = fighter?.model;
      const report = model?.userData?.locomotionReport || null;
      if (!fighter || !model || !report) return null;
      const walk = /walk|run|sprint/i.test(String(report.clip || ''));
      const calibration = report.calibration?.foot || null;
      const legLength = Number(report.legLength) || 0.86;
      const contactHeight = Number(walk ? calibration?.walkContactHeight : calibration?.contactHeight);
      const defaultDrop = Number.isFinite(contactHeight)
        ? contactHeight : Math.max(0.05, legLength * 0.14);
      const footLength = Math.max(0.18, legLength * 0.30);
      const toeDistance = footLength * 0.58;
      const heelDistance = footLength * 0.34;
      const contactBand = Math.max(0.025, legLength * 0.035);
      const camera = window.__browserSmashCamera || null;
      if (camera) camera.updateMatrixWorld();
      const width = window.innerWidth || 960;
      const height = window.innerHeight || 600;
      // Sample the floor under each footprint point, not just under the ankle. On a stair a
      // single foot can span two treads, and judging both points against the ankle's tread
      // reports a full riser of false penetration.
      const layout = window.__browserSmashLayout?.() || {};
      const localGround = (x, z, feetY) => {
        let value = layout.ground ?? 0;
        for (const block of layout.blocks || []) {
          if (block.top == null || block.top > feetY + 0.42) continue;
          if (block.r != null
            ? Math.hypot(x - block.x, z - block.z) <= block.r
            : x >= block.x0 && x <= block.x1 && z >= block.z0 && z <= block.z1) {
            value = Math.max(value, block.top);
          }
        }
        if (typeof layout.heightAt === 'function') {
          const terrain = layout.heightAt(x, z);
          if (Number.isFinite(terrain)) value = Math.max(value, terrain);
        }
        return value;
      };
      const bones = footBones(fighter) || { left: {}, right: {} };
      return sides.map(([side, index]) => {
        // The runtime's contact height is calibrated against the canonical foot slot. Use that
        // joint for the sole so the footprint and the layer agree on where the floor is; the
        // scan only supplies a separate toe direction when the slot is a real foot.
        const canonical = footJoint(fighter, side + 'Foot');
        const foot = canonical || bones[side].foot;
        if (!foot) return null;
        foot.updateWorldMatrix(true, false);
        const q = foot.getWorldQuaternion(new THREE.Quaternion());
        const ankle = foot.getWorldPosition(new THREE.Vector3());
        // A real toe bone gives the footprint a rig-authored forward direction. Without one,
        // fall back to the foot bone's local axis that best aligns with the body's facing.
        const toeBone = bones[side].toe && bones[side].toe !== foot ? bones[side].toe : null;
        let forward = null;
        if (toeBone) {
          toeBone.updateWorldMatrix(true, false);
          // Keep the toe bone's vertical component: it is the foot's pitch, and it is what makes
          // toe and heel contact differ from the sole instead of all three always agreeing.
          forward = toeBone.getWorldPosition(new THREE.Vector3()).sub(ankle);
        }
        if (!forward || forward.lengthSq() < 1e-6) {
          const frame = footFrame(fighter, side, foot);
          forward = frame.forwardLocal.clone().applyQuaternion(q);
        }
        if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
        forward.normalize();
        const horizontal = Math.hypot(forward.x, forward.z);
        const frame = footFrame(fighter, side, foot);
        const up = frame.upLocal.clone().applyQuaternion(q).normalize();
        // Keep the footprint on the foot's sole plane; the toe bone may only rotate its yaw.
        forward.addScaledVector(up, -forward.dot(up));
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
        forward.normalize();
        if (toeBone) {
          const toeDir = toeBone.getWorldPosition(new THREE.Vector3()).sub(ankle);
          toeDir.addScaledVector(up, -toeDir.dot(up));
          if (toeDir.lengthSq() > 1e-6) {
            toeDir.normalize();
            if (toeDir.dot(forward) < 0) toeDir.negate();
            forward.copy(toeDir);
          }
        }
        const measuredDrop = dropFor(fighter, side);
        const soleDrop = Number.isFinite(measuredDrop) ? measuredDrop : defaultDrop;
        const sole = ankle.clone().addScaledVector(up, -soleDrop);
        const toe = sole.clone().addScaledVector(forward, toeDistance);
        const heel = sole.clone().addScaledVector(forward, -heelDistance);
        const rep = report.feet?.[index] || null;
        const ankleGround = Number.isFinite(rep?.ground) ? rep.ground : (Number(fighter.position?.y) || 0);
        const heights = {
          sole: sole.y - localGround(sole.x, sole.z, ankle.y),
          toe: toe.y - localGround(toe.x, toe.z, ankle.y),
          heel: heel.y - localGround(heel.x, heel.z, ankle.y)
        };
        const soleContact = heights.sole <= contactBand;
        const toeContact = heights.toe <= contactBand;
        const heelContact = heights.heel <= contactBand;
        const contact = soleContact || toeContact || heelContact;
        const penetration = contact
          ? Math.max(0, -Math.min(heights.sole, heights.toe, heights.heel)) : 0;
        const yaw = horizontal > 0.15 ? Math.atan2(forward.x, forward.z) : null;
        const current = state[side];
        // Twist around world up is the planted foot's visible yaw even when the bone's own axis
        // is vertical, which is common on imported rigs and made an axis-derived yaw undefined.
        let yawDeltaDeg = null;
        if (contact && current.contact && current.quaternion) {
          const delta = q.clone().multiply(current.quaternion.clone().invert());
          // q and -q are the same rotation; align the delta to the shortest arc before reading
          // its twist, otherwise a sign flip reports a spurious ~180 degree planted yaw.
          if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
          const twist = new THREE.Quaternion(0, delta.y, 0, delta.w);
          if (twist.lengthSq() > 1e-8) {
            twist.normalize();
            yawDeltaDeg = Math.abs(2 * Math.atan2(twist.y, twist.w)) * 180 / Math.PI;
          }
        }
        current.contact = contact;
        current.quaternion = contact ? q.clone() : null;
        const screen = {
          sole: project(sole, camera, width, height),
          toe: project(toe, camera, width, height),
          heel: project(heel, camera, width, height)
        };
        let screenSlip = null;
        let screenSlipMean = null;
        if (contact) {
          if (!current.origin) {
            current.origin = { sole: sole.clone(), toe: toe.clone(), heel: heel.clone() };
          } else {
            const originScreen = {
              sole: project(current.origin.sole, camera, width, height),
              toe: project(current.origin.toe, camera, width, height),
              heel: project(current.origin.heel, camera, width, height)
            };
            const slips = ['sole', 'toe', 'heel']
              .filter(key => screen[key] && originScreen[key])
              .map(key => Math.hypot(screen[key].x - originScreen[key].x, screen[key].y - originScreen[key].y));
            if (slips.length) {
              screenSlip = Math.max(...slips);
              screenSlipMean = slips.reduce((sum, value) => sum + value, 0) / slips.length;
            }
          }
        } else {
          current.origin = null;
        }
        return {
          contact, soleContact, toeContact, heelContact, heights, penetration, yaw, yawDeltaDeg,
          weight: Number.isFinite(rep?.weight) ? rep.weight : 0,
          screen, screenSlip, screenSlipMean
        };
      });
    };
    window.__browserSmashFootProbe = { read, reset, prime, calibrate };
  });

  const sample = async (seconds, frameSeconds = 0.05) => page.evaluate(({ seconds, frameSeconds }) => {
    const frames = [];
    const steps = Math.max(1, Math.round(seconds / frameSeconds));
    for (let i = 0; i < steps; i += 1) {
      window.__browserSmashStep(frameSeconds);
      const f = window.fighters[0];
      const m = f.model;
      const report = m?.userData?.locomotionReport || null;
      const feet = ['leftFoot', 'rightFoot'].map((key, index) => {
        const bone = m?.userData?.[key] || f.animationController?.rig?.joints?.[key];
        if (!bone) return null;
        bone.updateWorldMatrix(true, false);
        const e = bone.matrixWorld.elements;
        const rep = report?.feet?.[index] || null;
        return {
          x: +e[12].toFixed(4), y: +e[13].toFixed(4), z: +e[14].toFixed(4),
          contact: Boolean(rep?.contact), height: rep?.height ?? null,
          target: rep?.target || null, residual: rep?.slide ?? null,
          targetReason: rep?.targetReason || null,
          reason: rep?.reason || null, weight: rep?.weight ?? null
        };
      });
      const input = f.lastInput || null;
      frames.push({
        clip: report?.clip || m?.userData?.currentClip || null,
        layer: report?.state || null,
        ground: +(f.position?.y || 0).toFixed(4),
        groundLevel: f.groundLevel ?? null,
        isGrounded: Boolean(f.isGrounded),
        legLength: report?.legLength ?? null,
        facing: { x: Number(f.facing) || 0, z: Number(f.facingZ) || 0 },
        move: input ? { x: input.x, z: input.z, moving: Boolean(input.moving) } : null,
        speed: +(Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0)).toFixed(3),
        report: report ? {
          clip: report.clip || null, state: report.state || null,
          start: report.start ?? null, stop: report.stop ?? null,
          pivot: report.pivot ?? null, landing: report.landing ?? null,
          startStepSide: report.startStepSide || null, stopFront: report.stopFront || null,
          landingReplantTimer: report.landingReplantTimer ?? null,
          pivotSide: report.pivotSide || null, pivotStepSide: report.pivotStepSide || null,
          turnRate: report.turnRate ?? null, groundRoot: report.groundRoot ?? null
        } : null,
        feet,
        footMetrics: window.__browserSmashFootProbe?.read() || null
      });
    }
    return frames;
  }, { seconds, frameSeconds });

  const selectBody = async name => {
    await page.evaluate(fighterName => {
      const select = document.querySelector('#p1Character');
      if (!select) throw new Error('p1Character select missing');
      select.value = fighterName;
      select.dispatchEvent(new Event('change'));
    }, name);
    await page.waitForFunction(fighterName => {
      const f = window.fighters?.[0];
      const u = f?.model?.userData || {};
      return f?.identity === fighterName
        && f.model?.userData?.characterAssetUrl
        && u.leftFoot && u.rightFoot && u.leftLeg && u.rightLeg && u.leftShin && u.rightShin;
    }, name, { timeout: 60_000, polling: 100 });
    // Let the mounted body replace the procedural placeholder and the first clip bind.
    await page.evaluate(() => window.__browserSmashStep(0.25));
    await page.waitForFunction(fighterName => {
      const f = window.fighters?.[0];
      return f?.identity === fighterName
        && f.model?.userData?.locomotionReport?.legLength > 0.1;
    }, name, { timeout: 20_000, polling: 100 });
  };

  const resetPose = async (opts = {}) => page.evaluate(({
    x = -7, z = -4, facing = 0, facingZ = -1, p2x = 8, p2z = -4
  } = {}) => {
    const [p1, p2] = window.fighters;
    const layout = window.__browserSmashLayout?.() || {};
    const groundAt = (gx, gz) => {
      let height = layout.ground ?? 0;
      for (const block of layout.blocks || []) {
        if (block.top == null || block.top > 100) continue;
        if (block.r != null
          ? Math.hypot(gx - block.x, gz - block.z) <= block.r
          : gx >= block.x0 && gx <= block.x1 && gz >= block.z0 && gz <= block.z1) {
          height = Math.max(height, block.top);
        }
      }
      if (typeof layout.heightAt === 'function') {
        const terrain = layout.heightAt(gx, gz);
        if (Number.isFinite(terrain)) height = Math.max(height, terrain);
      }
      return height;
    };
    const py = groundAt(x, z);
    const p2y = groundAt(p2x, p2z);
    p1.position.set(x, py, z);
    p1.groundLevel = py;
    p1.facing = facing; p1.facingZ = facingZ;
    p2.position.set(p2x, p2y, p2z);
    p2.groundLevel = p2y;
    p2.facing = -facing; p2.facingZ = -facingZ;
    for (const f of [p1, p2]) {
      f.velocity.set(0, 0, 0);
      f.hitstun = 0;
      f.attackQueue.length = 0;
      f.guardBreak = 0;
      f.dodgeTimer = 0;
      f.dashTimer = 0;
      f.landPulse = 0;
      f.jumps = 0;
      f.airDashUsed = false;
      f.flightMode = false;
      f.isGrounded = true;
    }
    return { x, y: py, z, p2x, p2z, p2y };
  }, opts);

  const releaseMovement = async () => {
    for (const key of ['w', 'a', 's', 'd', 'Space']) {
      await page.keyboard.up(key).catch(() => {});
    }
  };

  // A walk sample is only measurement evidence when the active layer reports a real gait clip.
  // Imported bodies can spend the first sampled window on their idle action while the body is
  // already translating, which previously produced rows like Link's `walkClip: "idle"` and made
  // the acceptance table reject the rig even though its later frames were walking. Reject that
  // sample, reset to a clean idle, and take another walk window instead of recording it.
  const gaitClipOf = frames => frames.find(frame =>
    frame.layer === 'active' && isGaitClip(frame.clip))?.clip || null;
  const captureWalk = async (maxAttempts = 4) => {
    const attempts = [];
    let frames = [];
    let warmup = 0.35;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await releaseMovement();
      await page.evaluate(() => window.__browserSmashFootProbe.reset());
      if (attempt > 1) {
        await resetPose();
        await page.evaluate(() => window.__browserSmashStep(0.45));
      }
      // Forward is the camera's forward axis. Tournament's default camera looks down -Z, so
      // `w` exercises a true forward walk; the separate strafe capture uses `d` while the body
      // keeps the camera-forward stance.
      await page.keyboard.down('w');
      await page.evaluate(seconds => window.__browserSmashStep(seconds), warmup);
      await page.evaluate(() => window.__browserSmashFootProbe.prime());
      await page.evaluate(() => window.__browserSmashFootProbe.calibrate(1.0));
      // Restart from the same reset pose and warm-up so measuring the sole range does not change
      // the speed, stance weight or arena position being judged.
      await page.keyboard.up('w');
      await resetPose();
      await page.evaluate(() => window.__browserSmashStep(0.25));
      await page.evaluate(() => window.__browserSmashFootProbe.reset());
      await page.keyboard.down('w');
      await page.evaluate(seconds => window.__browserSmashStep(seconds), warmup);
      frames = await sample(2.0, 1 / 60);
      await page.keyboard.up('w');
      await page.evaluate(() => window.__browserSmashStep(0.20));
      const gaitClip = gaitClipOf(frames);
      attempts.push(gaitClip || frames.find(frame => frame.layer === 'active' && frame.clip)?.clip || null);
      if (gaitClip) break;
      warmup = Math.min(0.85, 0.35 + attempt * 0.2);
    }
    return { frames, attempts };
  };

  // Each transition is driven with the real key the player uses, then sampled from the live
  // locomotion report and mounted foot bones. The scenarios share one reset pose so the only
  // change between them is the input or the ground under the feet.
  const captureStart = async () => {
    await releaseMovement();
    await resetPose();
    await page.evaluate(() => window.__browserSmashStep(0.35));
    await page.evaluate(() => window.__browserSmashFootProbe.reset());
    await page.keyboard.down('w');
    const frames = await sample(0.40, 1 / 60);
    await page.keyboard.up('w');
    await page.evaluate(() => window.__browserSmashStep(0.20));
    return frames;
  };

  const captureStop = async () => {
    await releaseMovement();
    await resetPose();
    await page.evaluate(() => window.__browserSmashStep(0.35));
    await page.keyboard.down('w');
    await page.evaluate(() => window.__browserSmashStep(0.55));
    await page.evaluate(() => window.__browserSmashFootProbe.reset());
    await page.keyboard.up('w');
    const frames = await sample(0.35, 1 / 60);
    await page.evaluate(() => window.__browserSmashStep(0.20));
    return frames;
  };

  const capturePivot = async () => {
    await releaseMovement();
    await resetPose();
    await page.evaluate(() => window.__browserSmashStep(0.35));
    await page.evaluate(() => window.__browserSmashFootProbe.reset());
    await page.evaluate(() => {
      const p = window.fighters[0];
      p.facing = 0; p.facingZ = 1;
      p.velocity.set(0, 0, 0);
    });
    const frames = await sample(0.45, 1 / 60);
    await page.evaluate(() => window.__browserSmashStep(0.20));
    return frames;
  };

  const captureLanding = async () => {
    await releaseMovement();
    await resetPose();
    await page.evaluate(() => window.__browserSmashStep(0.35));
    await page.evaluate(() => window.__browserSmashFootProbe.reset());
    await page.keyboard.press('Space');
    let frames = await sample(1.8, 1 / 60);
    let mode = 'jump';
    if (!frames.some(frame => Number(frame.report?.landingReplantTimer) > 0)) {
      // A rig whose jump never leaves the floor still has to exercise the landing path. Drop it
      // onto the same real ground with gravity and the normal collision solver.
      await resetPose();
      await page.evaluate(() => window.__browserSmashStep(0.20));
      await page.evaluate(() => window.__browserSmashFootProbe.reset());
      await page.evaluate(() => {
        const p = window.fighters[0];
        p.position.y += 2.0;
        p.velocity.y = 0;
        p.isGrounded = false;
      });
      frames = await sample(1.5, 1 / 60);
      mode = 'drop';
    }
    await page.evaluate(() => window.__browserSmashStep(0.20));
    return { frames, mode };
  };

  const captureStrafe = async () => {
    await releaseMovement();
    await resetPose();
    await page.evaluate(() => window.__browserSmashStep(0.35));
    await page.evaluate(() => window.__browserSmashFootProbe.reset());
    await page.keyboard.down('d');
    const frames = await sample(1.1, 1 / 60);
    await page.keyboard.up('d');
    await page.evaluate(() => window.__browserSmashStep(0.20));
    return frames;
  };

  const captureSlope = async () => {
    await releaseMovement();
    await resetPose({ x: -8, z: -10.5, facing: -1, facingZ: 0, p2x: 8, p2z: -10.5 });
    await page.evaluate(() => window.__browserSmashStep(0.35));
    await page.evaluate(() => window.__browserSmashFootProbe.reset());
    await page.keyboard.down('w');
    const frames = await sample(1.2, 1 / 60);
    await page.keyboard.up('w');
    await page.evaluate(() => window.__browserSmashStep(0.20));
    return frames;
  };

  for (const subject of batch) {
    process.stdout.write(`\n[${rows.length + 1}/${batch.length}] ${subject.name}`);
    const startedAt = Date.now();
    try {
      // Keep the match clock from ending a round partway through a long roster sweep. reset()
      // re-arms the timer and re-places both fighters while preserving the selected body/map.
      await page.evaluate(() => window.__browserSmashRound?.reset?.(false));
      await releaseMovement();
      // Some imported bodies leave the next swap at a stale animation action even though the
      // mixer clock advances. Passing through the known-good procedural fighter gives each rig
      // the same clean hand-off; the measured body is still selected and sampled normally.
      const resetBody = subject.name === 'Kaze' ? 'Infantry' : 'Kaze';
      await selectBody(resetBody);
      await resetPose();
      await page.evaluate(() => window.__browserSmashStep(0.15));
      await selectBody(subject.name);
      await resetPose();
      await page.evaluate(() => window.__browserSmashStep(0.45));
      const idle = await page.evaluate(() => {
        const f = window.fighters[0];
        const m = f.model;
        const report = m?.userData?.locomotionReport || null;
        return {
          clip: report?.clip || m?.userData?.currentClip || null,
          layer: report?.state || null, legLength: report?.legLength ?? null,
          feet: report?.feet || []
        };
      });

      // Two full gait cycles: a rig with a short contact phase must not be recorded as "never"
      // merely because one 1.35 s window landed on its swing phase. An idle-only sample is
      // rejected and retried so the acceptance row is always judged on a real gait clip.
      const walkCapture = await captureWalk(4);
      const walk = walkCapture.frames;

      // The raw pass is the calibration reference: it measures the clip's own foot lows without
      // the foot layer holding an ankle wherever it happened to be when contact was acquired.
      await page.evaluate(() => window.__browserSmashSetLocomotionPilot(false));
      await page.evaluate(() => window.__browserSmashFootProbe.reset());
      await resetPose();
      await page.evaluate(() => window.__browserSmashStep(0.20));
      await page.keyboard.down('w');
      await page.evaluate(() => window.__browserSmashStep(0.35));
      const rawWalk = await sample(2.0, 1 / 60);
      await page.keyboard.up('w');
      await page.evaluate(() => window.__browserSmashStep(0.20));
      await page.evaluate(() => window.__browserSmashSetLocomotionPilot(true));

      // Start, stop, pivot, landing and strafe are separate measurements of the same live layer.
      // Keeping their frames separate means a rig cannot pass on a good walk while its transition
      // or lateral foot placement is visibly broken.
      const start = await captureStart();
      const stop = await captureStop();
      const pivot = await capturePivot();
      const landing = await captureLanding();
      const strafe = await captureStrafe();

      const row = summarize(subject, idle, walk, rawWalk, Date.now() - startedAt);
      row.walkAttempts = walkCapture.attempts.length;
      row.walkAttemptClips = walkCapture.attempts;
      row.scenarios = {
        start: summarizeScenario('start', start),
        stop: summarizeScenario('stop', stop),
        pivot: summarizeScenario('pivot', pivot),
        landing: summarizeScenario('landing', landing.frames),
        strafe: summarizeScenario('strafe', strafe)
      };
      row.landingMode = landing.mode;
      row.scenarioErrors = [];
      rows.push(row);
      rowsBySlug.set(row.slug, row);
      console.log(' ' + JSON.stringify({
        identity: row.identity, group: row.group, joints: row.joints,
        leg: row.legLength, contact: row.contactFrames, never: row.neverPlants,
        raised: row.falsePlantedRaised, raisedWalk: row.falsePlantedRaisedWalk,
        raisedSettled: row.falsePlantedRaisedSettled, slide: row.residualSlideMean,
        max: row.residualSlideMax, settledTravel: row.settledWorldTravel,
        settledTravelMean: row.settledWorldTravelMean, settledSlide: row.settledResidualSlideMean,
        settledTarget: row.settledTargetResidualMean, floor: row.contactHeightMeasured,
        rawFloor: row.rawContactFloor, clip: row.walkClip,
        attempts: row.walkAttempts, attemptClips: row.walkAttemptClips,
        footContact: row.footContactFrames, sole: row.soleContactFrames,
        toe: row.toeContactFrames, heel: row.heelContactFrames,
        penetration: row.floorPenetrationMax, yaw: row.plantedYawMeanDeg,
        screenSlip: row.screenSlipMeanPx,
        scenarios: Object.fromEntries(Object.entries(row.scenarios).map(([name, value]) => [name, {
          frames: value.frames, foot: value.footContactFrames, support: value.supportFrames,
          start: value.startFrames, stop: value.stopFrames, pivot: value.pivotFrames,
          landing: value.landingFrames, strafe: value.strafeFrames,
          targets: value.targetFrameReasons, rise: value.groundRise
        }]))
      }));
      await writeFile(resolve(outDir, `${tag}.json`), JSON.stringify({
        generatedAt: new Date().toISOString(), batch, rows, errors
      }, null, 2) + '\n');
    } catch (error) {
      const state = await page.evaluate(() => {
        const f = window.fighters?.[0];
        const u = f?.model?.userData || {};
        return {
          identity: f?.identity || null,
          model: u.characterAssetUrl || null,
          controller: Boolean(f?.animationController?.ready),
          clip: u.currentClip || u.locomotionReport?.clip || null,
          report: u.locomotionReport || null,
          bones: ['leftLeg', 'leftShin', 'leftFoot', 'rightLeg', 'rightShin', 'rightFoot']
            .map(key => ({ key, present: Boolean(u[key] || f?.animationController?.rig?.joints?.[key]) })),
          calibration: u.rigCalibration || f?.animationController?.calibration || null
        };
      }).catch(detail => ({ detailError: String(detail?.message || detail) }));
      const failed = {
        identity: subject.name, slug: subject.slug, group: subject.group, joints: subject.joints,
        state,
        error: String(error?.stack || error?.message || error).split('\n').slice(0, 8).join('\n')
      };
      rows.push(failed);
      rowsBySlug.set(failed.slug, failed);
      console.log(' ERROR ' + JSON.stringify(failed));
      await writeFile(resolve(outDir, `${tag}.json`), JSON.stringify({
        generatedAt: new Date().toISOString(), batch, rows, errors
      }, null, 2) + '\n');
    }
  }

  // Slopes and stairs are a separate map pass so the flat transition measurements keep the
  // tournament's known floor. Asgard's palace court contains a real eight-tread stair (rise .4,
  // run 1.2) inside the playable bounds, climbing from the .5 m plaza to 3.7 m. The camera is
  // turned to face up the treads so `w` is forward for the body, not a backpedal.
  const switchArena = async key => {
    await releaseMovement();
    await page.evaluate(k => {
      const select = document.querySelector('#mapSelect');
      if (!select) throw new Error('mapSelect missing');
      select.value = k;
      select.dispatchEvent(new Event('change'));
    }, key);
    await page.waitForFunction(k => window.__browserSmashMatch?.().arena === k,
      key, { timeout: 60_000, polling: 100 });
    await page.evaluate(() => {
      window.__browserSmashSpawnFighters();
      window.smashCamera?.setStageYaw?.(Math.PI);
      window.smashCamera?.snap?.();
    });
    await page.evaluate(() => window.__browserSmashStep(0.45));
    await page.waitForFunction(k => (window.__browserSmashWorld?.location === k
      || window.__browserSmashAssets?.authoredArena?.key === k)
      && (window.__browserSmashLayout?.().blocks?.length || 0) > 0,
      key, { timeout: 60_000, polling: 100 });
  };

  // A real continuous slope on Skyloft's imported headland: the terrain heightfield rises
  // .7 m over the five metres west of (-8, -10.5). The camera is turned to face west so `w`
  // walks uphill rather than side-stepping along the slope contour.
  await switchArena('skyloft');
  for (let index = 0; index < batch.length; index += 1) {
    const subject = batch[index];
    const row = rowsBySlug.get(subject.slug);
    if (!row || row.error) continue;
    process.stdout.write(`\n[slope ${index + 1}/${batch.length}] ${subject.name}`);
    try {
      await page.evaluate(() => window.__browserSmashRound?.reset?.(false));
      await releaseMovement();
      const resetBody = subject.name === 'Kaze' ? 'Infantry' : 'Kaze';
      await selectBody(resetBody);
      await page.evaluate(() => window.__browserSmashStep(0.15));
      await selectBody(subject.name);
      await page.evaluate(() => {
        window.__browserSmashSelect?.chooseArena?.('skyloft');
        window.smashCamera?.setStageYaw?.(Math.PI / 2);
        window.smashCamera?.snap?.();
      });
      await resetPose({ x: -8, z: -10.5, facing: -1, facingZ: 0, p2x: 8, p2z: -10.5 });
      await page.evaluate(() => window.__browserSmashStep(0.45));
      await page.keyboard.down('w');
      await page.evaluate(() => window.__browserSmashStep(0.20));
      await page.evaluate(() => window.__browserSmashFootProbe.prime());
      await page.evaluate(() => window.__browserSmashFootProbe.calibrate(0.6));
      await page.keyboard.up('w');
      const frames = await captureSlope();
      row.scenarios.slope = summarizeScenario('slope', frames);
      console.log(' ' + JSON.stringify({ identity: row.identity, slope: {
        frames: row.scenarios.slope.frames, foot: row.scenarios.slope.footContactFrames,
        support: row.scenarios.slope.supportFrames, rise: row.scenarios.slope.groundRise,
        steps: row.scenarios.slope.groundStepFrames, penetration: row.scenarios.slope.floorPenetrationMax,
        yaw: row.scenarios.slope.plantedYawMeanDeg, slip: row.scenarios.slope.screenSlipMeanPx
      }}));
    } catch (error) {
      const message = String(error?.stack || error?.message || error).split('\n').slice(0, 6).join('\n');
      row.scenarioErrors = row.scenarioErrors || [];
      row.scenarioErrors.push(`slope: ${message}`);
      console.log(' SLOPE ERROR ' + message);
    }
    await writeFile(resolve(outDir, `${tag}.json`), JSON.stringify({
      generatedAt: new Date().toISOString(), batch, rows, errors
    }, null, 2) + '\n');
  }

  await switchArena('asgard_palace_court');
  for (let index = 0; index < batch.length; index += 1) {
    const subject = batch[index];
    const row = rowsBySlug.get(subject.slug);
    if (!row || row.error) continue;
    process.stdout.write(`\n[stairs ${index + 1}/${batch.length}] ${subject.name}`);
    try {
      await page.evaluate(() => window.__browserSmashRound?.reset?.(false));
      await releaseMovement();
      const resetBody = subject.name === 'Kaze' ? 'Infantry' : 'Kaze';
      await selectBody(resetBody);
      await page.evaluate(() => window.__browserSmashStep(0.15));
      await selectBody(subject.name);
      // The character-select screen re-syncs the hidden map select when p1 changes. Re-assert the
      // palace court after the body swap, and suppress its world exits for this measurement: the
      // palace and marketplace exits both sit within a stride of the stair foot and would
      // otherwise teleport the fighter before the treads are sampled.
      await page.evaluate(() => {
        window.__browserSmashSelect?.chooseArena?.('asgard_palace_court');
        if (window.__browserSmashWorld) window.__browserSmashWorld.exits = [];
        window.smashCamera?.setStageYaw?.(Math.PI);
        window.smashCamera?.snap?.();
      });
      await resetPose({ x: 0, z: -56.2, facing: 0, facingZ: 1, p2x: 10, p2z: -38 });
      await page.evaluate(() => window.__browserSmashStep(0.45));
      // Prime/calibrate the visible sole on this map's deck before climbing; the calibration is
      // cached per mounted model, so this is the stair pass's own reference.
      await page.keyboard.down('w');
      await page.evaluate(() => window.__browserSmashStep(0.25));
      await page.evaluate(() => window.__browserSmashFootProbe.prime());
      await page.evaluate(() => window.__browserSmashFootProbe.calibrate(0.6));
      await page.keyboard.up('w');
      await resetPose({ x: 0, z: -56.2, facing: 0, facingZ: 1, p2x: 10, p2z: -38 });
      await page.evaluate(() => window.__browserSmashStep(0.25));
      await page.evaluate(() => window.__browserSmashFootProbe.reset());
      await page.keyboard.down('w');
      const frames = await sample(1.0, 1 / 60);
      await page.keyboard.up('w');
      await page.evaluate(() => window.__browserSmashStep(0.20));
      row.scenarios.stairs = summarizeScenario('stairs', frames);
      console.log(' ' + JSON.stringify({ identity: row.identity, stairs: {
        frames: row.scenarios.stairs.frames, foot: row.scenarios.stairs.footContactFrames,
        support: row.scenarios.stairs.supportFrames, rise: row.scenarios.stairs.groundRise,
        steps: row.scenarios.stairs.groundStepFrames, penetration: row.scenarios.stairs.floorPenetrationMean
      }}));
    } catch (error) {
      const message = String(error?.stack || error?.message || error).split('\n').slice(0, 6).join('\n');
      row.scenarioErrors = row.scenarioErrors || [];
      row.scenarioErrors.push(`stairs: ${message}`);
      console.log(' STAIRS ERROR ' + message);
    }
    await writeFile(resolve(outDir, `${tag}.json`), JSON.stringify({
      generatedAt: new Date().toISOString(), batch, rows, errors
    }, null, 2) + '\n');
  }

  await writeFile(resolve(outDir, `${tag}.json`), JSON.stringify({
    generatedAt: new Date().toISOString(), batch, rows, errors
  }, null, 2) + '\n');
  console.log('SUMMARY ' + JSON.stringify({
    tag, measured: rows.filter(row => !row.error).length,
    failed: rows.filter(row => row.error).length,
    pageErrors: errors.length
  }));
} finally {
  await browser?.close();
  server.close();
}

function summarize(subject, idle, walk, rawWalk, elapsedMs) {
  const legLength = idle.legLength || walk.find(frame => frame.legLength)?.legLength || null;
  const idleFeet = idle.feet || [];
  const idleHeights = idleFeet.map(foot => foot.height).filter(Number.isFinite);
  const idleContactFloor = idleHeights.length ? Math.min(...idleHeights) : null;
  const rawHeights = rawWalk.flatMap(frame => (frame.feet || [])
    .filter(Boolean)
    .map(foot => +(foot.y - frame.ground).toFixed(4))
    .filter(height => Number.isFinite(height) && height > -0.15));
  rawHeights.sort((a, b) => a - b);
  const rawContactFloor = rawHeights.length
    ? +rawHeights[Math.min(rawHeights.length - 1, Math.floor(rawHeights.length * 0.10))].toFixed(4)
    : null;
  const contactFloor = idleContactFloor === null ? rawContactFloor : rawContactFloor === null
    ? idleContactFloor : Math.min(idleContactFloor, rawContactFloor);
  const tolerance = legLength ? Math.max(0.06, legLength * 0.08) : 0.08;
  // Keep the pre-calibration comparison honest: the baseline counted every reported contact,
  // including frames while the IK was still blending in, against the combined idle/walk floor.
  // The walk-floor reference is reported separately so the two definitions are never conflated.
  const raisedLimit = contactFloor === null ? null : contactFloor + tolerance;
  const walkRaisedLimit = rawContactFloor === null ? null : rawContactFloor + tolerance;
  const above = (entry, limit) => limit !== null && entry.foot.y - entry.ground > limit;
  const walkFrames = walk.filter(frame => frame.layer === 'active');
  const walkGaitClip = walkFrames.find(frame => isGaitClip(frame.clip))?.clip || null;
  const footLevel = summarizeFootLevel(walkFrames);
  const feet = [0, 1].map(index => {
    const active = walkFrames
      .map(frame => ({ ...frame, foot: frame.feet?.[index] }))
      .filter(entry => entry.foot);
    const contacts = active.filter(entry => entry.foot.contact);
    const heights = contacts.map(entry => +(entry.foot.y - entry.ground).toFixed(4)).filter(Number.isFinite);
    const residuals = contacts.map(entry => entry.foot.residual).filter(Number.isFinite);
    const targetResiduals = contacts.map(entry => {
      const foot = entry.foot;
      if (!foot.target) return null;
      return Math.hypot(foot.x - foot.target[0], foot.z - foot.target[2]);
    }).filter(Number.isFinite);
    // A settled contact is the part of a plant where the IK weight has finished blending. Foot
    // slide measured there is the ankle moving in world space against a plant the solver can
    // actually reach; the settled residual is what that same plant is still missing by. Keeping
    // both on the same frames separates real slide from the reach/blend-in lag in residualMean.
    const settled = contacts.filter(entry => entry.foot.weight >= 0.85);
    const settledResiduals = settled.map(entry => entry.foot.residual).filter(Number.isFinite);
    const settledTargetResiduals = settled.map(entry => {
      const foot = entry.foot;
      if (!foot.target) return null;
      return Math.hypot(foot.x - foot.target[0], foot.z - foot.target[2]);
    }).filter(Number.isFinite);
    let travel = 0;
    let settledTravel = 0;
    let settledSamples = 0;
    let previous = null;
    for (const entry of active) {
      if (previous) {
        const step = Math.hypot(entry.foot.x - previous.foot.x, entry.foot.z - previous.foot.z);
        if (entry.foot.contact && previous.foot.contact) travel += step;
        // One sample per settled frame. The step is measured from the previous sampled frame; a
        // settled frame only exists after several contact frames of IK blending, so that previous
        // frame belongs to the same plant. Requiring two adjacent settled frames instead would
        // drop nearly every rig: the current hold policy releases and reacquires before weight
        // holds for two samples, which is exactly the behaviour this metric has to expose.
        if (entry.foot.contact && entry.foot.weight >= 0.85) {
          settledTravel += step;
          settledSamples += 1;
        }
      }
      previous = entry;
    }
    return {
      contactFrames: contacts.length,
      contactRatio: active.length ? +(contacts.length / active.length).toFixed(3) : 0,
      contactHeightMean: heights.length ? +(heights.reduce((a, b) => a + b, 0) / heights.length).toFixed(4) : null,
      contactHeightMax: heights.length ? +Math.max(...heights).toFixed(4) : null,
      settledContactFrames: contacts.filter(entry => entry.foot.weight >= 0.85).length,
      // Baseline definition: all contact frames, no weight filter.
      raisedPlantedFrames: contacts.filter(entry => above(entry, raisedLimit)).length,
      raisedSettledFrames: contacts.filter(entry => entry.foot.weight >= 0.85 && above(entry, raisedLimit)).length,
      // The current walk-floor reference, all contacts, for a like-for-like read of the tune.
      raisedWalkPlantedFrames: contacts.filter(entry => above(entry, walkRaisedLimit)).length,
      releaseReasons: active.map(entry => entry.foot.reason).filter(Boolean).reduce((counts, reason) => {
        counts[reason] = (counts[reason] || 0) + 1;
        return counts;
      }, {}),
      residualMean: residuals.length ? +(residuals.reduce((a, b) => a + b, 0) / residuals.length).toFixed(4) : null,
      residualMax: residuals.length ? +Math.max(...residuals).toFixed(4) : null,
      targetResidualMean: targetResiduals.length ? +(targetResiduals.reduce((a, b) => a + b, 0) / targetResiduals.length).toFixed(4) : null,
      targetResidualMax: targetResiduals.length ? +Math.max(...targetResiduals).toFixed(4) : null,
      worldTravel: +travel.toFixed(4),
      settledWorldTravel: +settledTravel.toFixed(4),
      settledTravelSamples: settledSamples,
      settledWorldTravelMean: settledSamples ? +(settledTravel / settledSamples).toFixed(4) : null,
      settledResidualMean: settledResiduals.length ? +(settledResiduals.reduce((a, b) => a + b, 0) / settledResiduals.length).toFixed(4) : null,
      settledResidualMax: settledResiduals.length ? +Math.max(...settledResiduals).toFixed(4) : null,
      settledTargetResidualMean: settledTargetResiduals.length ? +(settledTargetResiduals.reduce((a, b) => a + b, 0) / settledTargetResiduals.length).toFixed(4) : null,
      settledTargetResidualMax: settledTargetResiduals.length ? +Math.max(...settledTargetResiduals).toFixed(4) : null
    };
  });
  const allContacts = feet.reduce((sum, foot) => sum + foot.contactFrames, 0);
  const raised = feet.reduce((sum, foot) => sum + foot.raisedPlantedFrames, 0);
  const raisedSettled = feet.reduce((sum, foot) => sum + foot.raisedSettledFrames, 0);
  const raisedWalk = feet.reduce((sum, foot) => sum + foot.raisedWalkPlantedFrames, 0);
  const residuals = feet.map(foot => foot.residualMean).filter(Number.isFinite);
  const maxResiduals = feet.map(foot => foot.residualMax).filter(Number.isFinite);
  const settledResiduals = feet.map(foot => foot.settledResidualMean).filter(Number.isFinite);
  const maxSettledResiduals = feet.map(foot => foot.settledResidualMax).filter(Number.isFinite);
  const settledTargetResiduals = feet.map(foot => foot.settledTargetResidualMean).filter(Number.isFinite);
  const maxSettledTargetResiduals = feet.map(foot => foot.settledTargetResidualMax).filter(Number.isFinite);
  const settledTravelSamples = feet.reduce((sum, foot) => sum + (foot.settledTravelSamples || 0), 0);
  const settledTravelTotal = +feet.reduce((sum, foot) => sum + foot.settledWorldTravel, 0).toFixed(4);
  return {
    identity: subject.name,
    slug: subject.slug,
    group: subject.group,
    joints: subject.joints,
    elapsedMs,
    legLength,
    idleClip: idle.clip,
    idleLayer: idle.layer,
    idleContactFloor,
    rawContactFloor,
    contactHeightMeasured: contactFloor,
    raisedLimit,
    walkRaisedLimit,
    idleFeet: idleFeet.map(foot => ({
      side: foot.side, contact: foot.contact, height: foot.height, reach: foot.reach
    })),
    // Prefer a real gait frame over the first active frame: the first active frame can still be
    // the outgoing idle action while the clip is blending into walk/run.
    walkClip: walkGaitClip || walkFrames[0]?.clip || walk[0]?.clip || null,
    rawWalkClip: rawWalk.find(frame => isGaitClip(frame.clip))?.clip
      || rawWalk.find(frame => frame.clip)?.clip || null,
    walkFrames: walkFrames.length,
    contactFrames: allContacts,
    contactFrameRatio: walkFrames.length ? +(allContacts / (walkFrames.length * 2)).toFixed(3) : 0,
    falsePlantedRaised: raised,
    falsePlantedRaisedSettled: raisedSettled,
    falsePlantedRaisedWalk: raisedWalk,
    residualSlideMean: residuals.length ? +(residuals.reduce((a, b) => a + b, 0) / residuals.length).toFixed(4) : null,
    residualSlideMax: maxResiduals.length ? +Math.max(...maxResiduals).toFixed(4) : null,
    settledContactFrames: feet.reduce((sum, foot) => sum + foot.settledContactFrames, 0),
    settledWorldTravel: settledTravelTotal,
    settledTravelSamples,
    settledWorldTravelMean: settledTravelSamples
      ? +(settledTravelTotal / settledTravelSamples).toFixed(4) : null,
    settledResidualSlideMean: settledResiduals.length ? +(settledResiduals.reduce((a, b) => a + b, 0) / settledResiduals.length).toFixed(4) : null,
    settledResidualSlideMax: maxSettledResiduals.length ? +Math.max(...maxSettledResiduals).toFixed(4) : null,
    settledTargetResidualMean: settledTargetResiduals.length ? +(settledTargetResiduals.reduce((a, b) => a + b, 0) / settledTargetResiduals.length).toFixed(4) : null,
    settledTargetResidualMax: maxSettledTargetResiduals.length ? +Math.max(...maxSettledTargetResiduals).toFixed(4) : null,
    neverPlants: allContacts === 0,
    ...footLevel,
    feet
  };
}

/** Aggregate one transition/stair window into gateable evidence. */
function summarizeScenario(name, frames) {
  const active = (frames || []).filter(frame => frame.layer === 'active');
  const footLevel = summarizeFootLevel(active);
  const reports = (frames || []).map(frame => frame.report).filter(Boolean);
  const value = (entry, key) => Number(entry?.[key]);
  const reportCount = (key, threshold) => reports.filter(report => {
    const number = value(report, key);
    return Number.isFinite(number) && number > threshold;
  }).length;
  const targetCounts = {};
  const targetFrameReasons = {};
  for (const frame of active) {
    const seen = new Set();
    for (const foot of frame.feet || []) {
      if (!foot?.targetReason) continue;
      targetCounts[foot.targetReason] = (targetCounts[foot.targetReason] || 0) + 1;
      seen.add(foot.targetReason);
    }
    for (const reason of seen) targetFrameReasons[reason] = (targetFrameReasons[reason] || 0) + 1;
  }
  const supportFrames = active.filter(frame => (frame.feet || []).some(foot => foot?.contact)).length;
  const doubleSupportFrames = active.filter(frame => (frame.feet || []).filter(foot => foot?.contact).length >= 2).length;
  const grounds = (frames || []).map(frame => Number(frame.ground)).filter(Number.isFinite);
  let groundStepFrames = 0;
  let groundDropFrames = 0;
  for (let i = 1; i < grounds.length; i += 1) {
    if (grounds[i] > grounds[i - 1] + 0.05) groundStepFrames += 1;
    if (grounds[i] < grounds[i - 1] - 0.05) groundDropFrames += 1;
  }
  const speeds = active.map(frame => Number(frame.speed)).filter(Number.isFinite);
  const dots = active
    .filter(frame => frame.move?.moving && frame.facing)
    .map(frame => frame.move.x * frame.facing.x + frame.move.z * frame.facing.z)
    .filter(Number.isFinite);
  const unique = list => [...new Set(list.filter(Boolean))];
  const max = (list, fallback = null) => list.length ? +Math.max(...list).toFixed(3) : fallback;
  let penetrationWorst = null;
  let penetrationWorstFrame = null;
  for (let index = 0; index < active.length; index += 1) {
    const frame = active[index];
    for (const [side, foot] of (frame.footMetrics || []).entries()) {
      if (!foot || !Number.isFinite(foot.penetration)) continue;
      if (!penetrationWorst || foot.penetration > penetrationWorst.penetration) {
        penetrationWorst = { penetration: +foot.penetration.toFixed(4), side: side === 0 ? 'left' : 'right', heights: foot.heights };
        penetrationWorstFrame = { index, ground: frame.ground, y: frame.groundLevel, speed: frame.speed };
      }
    }
  }
  return {
    scenario: name,
    frames: active.length,
    rawFrames: (frames || []).length,
    ...footLevel,
    supportFrames,
    supportRatio: active.length ? +(supportFrames / active.length).toFixed(3) : 0,
    doubleSupportFrames,
    airFrames: active.filter(frame => frame.isGrounded === false).length,
    speedMean: speeds.length ? +(speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(3) : null,
    speedMax: max(speeds),
    moveDotFacingMean: dots.length ? +(dots.reduce((a, b) => a + b, 0) / dots.length).toFixed(3) : null,
    strafeFrames: dots.filter(dot => Math.abs(dot) < 0.25).length,
    startFrames: reportCount('start', 0.1),
    stopFrames: reportCount('stop', 0.1),
    pivotFrames: reportCount('pivot', 0.1),
    landingFrames: reportCount('landing', 0.05),
    landingTimerMax: max(reports.map(report => Number(report.landingReplantTimer)).filter(Number.isFinite), 0),
    startSides: unique(reports.map(report => report.startStepSide)),
    stopFronts: unique(reports.map(report => report.stopFront)),
    pivotSides: unique(reports.map(report => report.pivotSide)),
    pivotStepSides: unique(reports.map(report => report.pivotStepSide)),
    targetCounts,
    targetFrameReasons,
    groundStart: grounds.length ? grounds[0] : null,
    groundEnd: grounds.length ? grounds[grounds.length - 1] : null,
    groundRise: grounds.length ? +(grounds[grounds.length - 1] - grounds[0]).toFixed(3) : null,
    groundStepFrames,
    groundDropFrames,
    penetrationWorst,
    penetrationWorstFrame
  };
}

/** Aggregate the foot-level evidence sampled from the foot bones and camera. */
function summarizeFootLevel(frames) {
  const entries = [];
  for (const frame of frames) {
    if (!Array.isArray(frame.footMetrics)) continue;
    for (const foot of frame.footMetrics) {
      if (foot) entries.push({ frame, foot });
    }
  }
  const contacts = entries.filter(entry => entry.foot.contact);
  const count = key => entries.filter(entry => entry.foot[key]).length;
  const finite = values => values.map(Number).filter(Number.isFinite);
  const mean = values => values.length
    ? +(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4) : null;
  const penetrations = finite(contacts.map(entry => entry.foot.penetration));
  const yawDeltas = finite(contacts.map(entry => entry.foot.yawDeltaDeg));
  const slipMeans = finite(contacts.map(entry => entry.foot.screenSlipMean));
  const slipMaxes = finite(contacts.map(entry => entry.foot.screenSlip));
  const evidence = frames.length * 2;
  return {
    footEvidenceFrames: entries.length,
    footEvidenceRatio: evidence ? +(entries.length / evidence).toFixed(3) : 0,
    footContactFrames: contacts.length,
    footContactRatio: entries.length ? +(contacts.length / entries.length).toFixed(3) : 0,
    soleContactFrames: count('soleContact'),
    toeContactFrames: count('toeContact'),
    heelContactFrames: count('heelContact'),
    floorPenetrationMax: penetrations.length ? +Math.max(...penetrations).toFixed(4) : null,
    floorPenetrationMean: mean(penetrations),
    plantedYawMeanDeg: mean(yawDeltas),
    plantedYawMaxDeg: yawDeltas.length ? +Math.max(...yawDeltas).toFixed(2) : null,
    plantedYawSamples: yawDeltas.length,
    screenSlipMeanPx: mean(slipMeans),
    screenSlipMaxPx: slipMaxes.length ? +Math.max(...slipMaxes).toFixed(2) : null,
    screenSlipSamples: slipMeans.length
  };
}
