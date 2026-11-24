// Thor's one-handed / two-handed carry policy, audited against the live clips.
//
//   bash scripts/run-browser-test.sh scripts/audit-thor-carry-policy.mjs
//
// The policy lives in public/js/anim/thor_carry_policy.js and is deliberately independent of the
// runtime. For every state and authored strike, this audit poses the live clip, then applies the
// same carry overlay the game applies, and measures:
//   * the right hand against the named haft geometry (sanity; should always be on the grip)
//   * the left hand against the haft, and its axial position relative to the right hand
//   * whether the left hand is actually on the secondary grip, not merely touching the hammer head
//   * re-grip time from a settled idle into each two-handed state
//   * whether a two-handed state still has the offhand on the haft at the end of its release window
// It reports the raw clip and the rendered (clip + overlay) pose separately, so a failure says
// whether the clip or the carry layer owns it.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { THOR_CARRY_POLICY } from '../public/js/anim/thor_carry_policy.js';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/thor-carry-policy');
await mkdir(outDir, { recursive: true });

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
    const bytes = await readFile(resolve(root, relative));
    res.writeHead(200, { 'Content-Type': mime[extname(relative).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const report = {
  subject: 'Thor', generatedAt: new Date().toISOString(),
  policy: THOR_CARRY_POLICY, thresholds: THOR_CARRY_POLICY.contact,
  inventory: null, states: [], attacks: [], block: null,
  failures: [], pageErrors: [], consoleErrors: [], status: 'complete'
};
const fail = (entry, type, detail) => {
  const failure = { id: entry.id, kind: entry.kind, type, ...detail };
  entry.failures = entry.failures || [];
  entry.failures.push(failure);
  report.failures.push(failure);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => report.pageErrors.push(String(error?.stack || error)));
  page.on('console', message => {
    if (message.type() === 'error' && !/404 \(Not Found\)/.test(message.text())) {
      report.consoleErrors.push(message.text());
    }
  });
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
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
  await page.click('#selectScreen .bs-card[data-fighter="Thor"]');
  await page.click('#selectScreen .bs-card[data-fighter="Kaze"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.evaluate(() => {
    window.__browserSmashSelect.setMode('2p');
    window.__browserSmashTrainingDummy = true;
  });
  await page.click('#play');
  await page.waitForFunction(() => {
    const f = window.fighters?.[0];
    const u = f?.model?.userData || {};
    return window.__browserSmashMatch().status === 'fighting'
      && /thor_rigged\.glb|\/thor\/thor\.glb|\/roster\/thor\.glb/.test(String(u.characterAssetUrl || ''))
      && u.equippedWeaponRight?.userData?.kind === 'stormbreaker'
      && u.rightHand && u.leftHand && u.head && u.torso;
  }, null, { timeout: 180_000, polling: 250 });

  const setup = await page.evaluate(async () => {
    const { buildAttack } = await import('/js/combat/move_data.js');
    const f = window.fighters[0];
    window.__browserSmashSetPaused(true);
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel || 0, 0);
    p2.position.set(4.2, p2.groundLevel || 0, 0);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    const u = f.model.userData;
    const actions = { ...(u.animationActions || {}), ...(u.authoredAbilityActions || {}) };
    const timing = {};
    for (const [key, moveId, comboStep] of [
      ['light1', 'light1', 1], ['light2', 'light2', 2], ['light3', 'light3', 3],
      ['light4', 'light4', 4], ['finisher', 'finisher', 5], ['heavy', 'heavy', 1],
      ['heavyLauncher', 'heavyLauncher', 1], ['heavySlam', 'heavySlam', 1]
    ]) {
      const a = buildAttack({ moveId, fighter: f, comboStep });
      timing[key] = { id: a.id, start: +a.start.toFixed(6), end: +a.end.toFixed(6),
        total: +a.total.toFixed(6), startupFrac: +(a.start / a.total).toFixed(6),
        activeEndFrac: +(a.end / a.total).toFixed(6) };
    }
    return {
      asset: u.characterAssetUrl,
      animationController: Boolean(u.animationController),
      humanMixer: Boolean(u.humanMixer),
      actionKeys: Object.keys(actions).sort(),
      authoredKeys: Object.keys(u.authoredAbilityActions || {}).sort(),
      special: u.authoredSpecialClipId || null,
      authoredBind: u.authoredBindDiag || null,
      timing,
      clips: Object.entries(actions).map(([key, action]) => ({
        key, name: action?.getClip?.()?.name, duration: action?.getClip?.()?.duration,
        tracks: action?.getClip?.()?.tracks?.length, origin: action?.getClip?.()?.userData?.origin || null
      })).sort((a, b) => a.key.localeCompare(b.key))
    };
  });
  report.inventory = setup;

  await page.evaluate(async () => {
    const f = window.fighters[0];
    const u = f.model.userData;
    const actions = { ...(u.animationActions || {}), ...(u.authoredAbilityActions || {}) };
    const mixer = u.humanMixer;
    const weapon = u.equippedWeaponRight;
    const V = weapon.position.constructor;
    const { syncEquippedWeapons } = await import('/js/models.js');
    const carry = await import('/js/anim/weapon_carry.js');
    const haftNodes = [];
    weapon.traverse(node => {
      if (node.geometry?.attributes?.position && /haft|handle|grip|shaft/i.test(node.name || '')) {
        haftNodes.push(node);
      }
    });
    const allNodes = [];
    if (!haftNodes.length) {
      weapon.traverse(node => {
        if (node.geometry?.attributes?.position) allNodes.push(node);
      });
    }
    const nodes = haftNodes.length ? haftNodes : allNodes;

    function setAction(key, t) {
      const action = actions[key];
      if (!action?.getClip) return null;
      const clip = action.getClip();
      mixer.stopAllAction();
      action.reset();
      action.setLoop(2200, 1); // THREE.LoopOnce
      action.clampWhenFinished = true;
      action.setEffectiveWeight(1);
      action.play();
      action.time = Math.max(0, Math.min(0.9999, t)) * clip.duration;
      action.paused = false;
      mixer.update(0);
      action.paused = true;
      return { name: clip.name, duration: clip.duration, tracks: clip.tracks.length,
        origin: clip.userData?.origin || null };
    }

    function modeFor(state, casting) {
      if (casting === 'ultimate') return 'ultimate';
      if (state === 'block' || String(state).startsWith('attack-')) return 'two-handed';
      if (state === 'walk' || state === 'run' || state === 'dash') return 'carry';
      return 'idle';
    }

    function setRuntime(state, casting, weight, overlay, preserveWeight = false) {
      f.state = state;
      f.casting = casting || null;
      f.weaponStowed = false;
      f.guardHeld = false;
      f.hitstun = 0;
      f.dodgeTimer = 0;
      f.attackQueue.length = 0;
      if (!preserveWeight) u.weaponCarryWeight = weight;
      if (overlay) {
        carry.applyWeaponCarryPoses(f, 1 / 60);
      } else {
        u.weaponCarry = { ...(u.weaponCarry || {}), mode: modeFor(state, casting), weight, stowed: false };
      }
    }

    function measure() {
      syncEquippedWeapons(f.model);
      weapon.updateWorldMatrix(true, true);
      for (const node of nodes) node.updateWorldMatrix(true, false);
      const points = [];
      for (const node of nodes) {
        const attr = node.geometry.attributes.position;
        const stride = Math.max(1, Math.floor(attr.count / 500));
        for (let i = 0; i < attr.count; i += stride) {
          const v = new V().fromBufferAttribute(attr, i);
          node.localToWorld(v);
          points.push(v);
        }
      }
      const e = weapon.matrixWorld.elements;
      const origin = new V(e[12], e[13], e[14]);
      const haftAxis = new V(e[4], e[5], e[6]).normalize();
      const proj = points.map(p => new V(p.x - origin.x, p.y - origin.y, p.z - origin.z).dot(haftAxis));
      const min = Math.min(...proj), max = Math.max(...proj), length = max - min;
      const nearest = point => Math.min(...points.map(p => point.distanceTo(p)));
      const right = u.rightHand.getWorldPosition(new V());
      const left = u.leftHand.getWorldPosition(new V());
      const rightGap = nearest(right), leftGap = nearest(left);
      const slide = (point, gap) => {
        if (length < 1e-5) return null;
        const d = new V(point.x - origin.x, point.y - origin.y, point.z - origin.z);
        return +((d.dot(haftAxis) - min) / length).toFixed(3);
      };
      const rightSlide = slide(right, rightGap);
      const leftSlide = slide(left, leftGap);
      const relativeSlide = rightSlide !== null && leftSlide !== null
        ? +(leftSlide - rightSlide).toFixed(3) : null;
      const gripPosition = relativeSlide !== null
        && relativeSlide <= -0.035 && relativeSlide >= -0.32;
      const leftContact = leftGap <= 0.10 && gripPosition;
      return {
        right: { gap: +rightGap.toFixed(3), slide: rightSlide, onHaft: rightGap <= 0.10 },
        left: { gap: +leftGap.toFixed(3), slide: leftSlide, relativeSlide,
          onHaft: leftGap <= 0.10, gripPosition, contact: leftContact,
          free: !leftContact && leftGap >= 0.12 },
        haft: { nodes: nodes.length, named: haftNodes.length, points: points.length,
          length: +length.toFixed(3), min: +min.toFixed(3), max: +max.toFixed(3) },
        carry: u.weaponCarry ? { mode: u.weaponCarry.mode, weight: u.weaponCarry.weight,
          state: u.weaponCarry.state, stowed: u.weaponCarry.stowed } : null
      };
    }

    window.__thorAudit = {
      sample({ clip, t = 0.5, state = 'idle', casting = null, weight = 0, overlay = true }) {
        const action = setAction(clip, t);
        if (!action) return { error: `missing action ${clip}` };
        setRuntime(state, casting, weight, false);
        syncEquippedWeapons(f.model);
        carry.applyWeaponStowPose(f);
        const raw = measure();
        if (overlay) {
          u.weaponCarryWeight = weight;
          carry.applyWeaponCarryPoses(f, 1 / 60);
          syncEquippedWeapons(f.model);
          carry.applyWeaponStowPose(f);
        } else {
          u.weaponCarry = { ...(u.weaponCarry || {}), mode: modeFor(state, casting), weight, stowed: false };
          carry.applyWeaponStowPose(f);
        }
        const live = measure();
        return { clip: action, t, state, casting, weight, overlay, raw, live };
      },

      ramp({ clip, fromT = 0, toT = 0, state = 'idle', casting = null,
        duration = 0.3, startWeight = 0 }) {
        const action = actions[clip];
        if (!action?.getClip) return { error: `missing action ${clip}` };
        u.weaponCarryWeight = startWeight;
        const samples = [];
        let firstGrip = null;
        const steps = Math.ceil(duration * 60);
        for (let step = 0; step <= steps; step += 1) {
          const elapsed = step / 60;
          const t = fromT + (toT - fromT) * Math.min(1, elapsed / Math.max(1e-6, duration));
          const actionInfo = setAction(clip, t);
          if (!actionInfo) return { error: `missing action ${clip}` };
          setRuntime(state, casting, startWeight, false, true);
          carry.applyWeaponCarryPoses(f, 1 / 60);
          syncEquippedWeapons(f.model);
          carry.applyWeaponStowPose(f);
          const live = measure();
          if (live.left.contact && firstGrip === null) firstGrip = +elapsed.toFixed(3);
          samples.push({ elapsed: +elapsed.toFixed(3), t: +t.toFixed(3),
            leftGap: live.left.gap, leftContact: live.left.contact,
            carryWeight: live.carry?.weight ?? null });
        }
        return { firstGrip, samples };
      }
    };
  });

  const sample = params => page.evaluate(p => window.__thorAudit.sample(p), params);
  const ramp = params => page.evaluate(p => window.__thorAudit.ramp(p), params);

  const oneHandAttackSamples = timing => {
    const s = timing.startupFrac;
    const e = timing.activeEndFrac;
    return [
      { phase: 'startup', t: s * 0.65, state: 'attack-startup' },
      { phase: 'active', t: (s + e) / 2, state: 'attack-active' },
      { phase: 'release', t: e + (1 - e) * 0.75, state: 'attack-recovery' }
    ];
  };

  for (const [state, row] of Object.entries(THOR_CARRY_POLICY.states)) {
    if (row.mode === 'per-attack') continue;
    const clips = row.clipVariants || [row.clip];
    for (const clip of clips) {
      const entry = { kind: 'state', id: clips.length > 1 ? `${state}:${clip}` : state,
        state, clip, mode: row.mode, offhand: row.offhand, samples: [] };
      const weight = row.mode === 'two-handed' || ['walk', 'run', 'dash'].includes(state) ? 1 : 0;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const measured = await sample({ clip, t, state, weight, overlay: true });
        entry.samples.push({ t, ...measured });
        if (measured.error) { fail(entry, 'missing-clip', { clip, error: measured.error }); break; }
      }
      if (!entry.samples.some(s => s.error)) {
        const liveGrips = entry.samples.filter(s => s.live.left.contact);
        const rawGrips = entry.samples.filter(s => s.raw.left.contact);
        entry.liveGripSamples = liveGrips.map(s => s.t);
        entry.rawGripSamples = rawGrips.map(s => s.t);
        if (row.mode === 'one-handed') {
          if (liveGrips.length) fail(entry, 'one-handed-live-grip', {
            phases: liveGrips.map(s => s.t), gap: liveGrips.map(s => s.live.left.gap),
            note: 'The carry overlay put the offhand on the haft in a one-handed state.'
          });
          if (rawGrips.length) fail(entry, 'one-handed-clip-grip', {
            phases: rawGrips.map(s => s.t), gap: rawGrips.map(s => s.raw.left.gap),
            note: 'The authored clip itself puts the offhand on the secondary grip.'
          });
        } else if (row.mode === 'two-handed') {
          const misses = entry.samples.filter(s => !s.live.left.contact);
          if (misses.length) fail(entry, 'two-handed-contact', {
            phases: misses.map(s => s.t), gap: misses.map(s => s.live.left.gap),
            relativeSlide: misses.map(s => s.live.left.relativeSlide)
          });
        }
        entry.rightHandFailures = entry.samples.filter(s => !s.live.right.onHaft)
          .map(s => ({ t: s.t, gap: s.live.right.gap }));
      }
      report.states.push(entry);
      console.log('STATE ' + entry.id + ' ' + JSON.stringify({
        mode: row.mode, clip,
        liveGrip: entry.liveGripSamples, rawGrip: entry.rawGripSamples,
        failures: entry.failures?.map(f => f.type) || []
      }));
    }
  }

  // Guard is the one state whose whole silhouette depends on the offhand: settle it, then measure
  // how long the overlay takes to close from a real idle entry.
  {
    const entry = { kind: 'block', id: 'block-entry', state: 'block', clip: 'block', mode: 'two-handed' };
    const settled = await sample({ clip: 'block', t: 0.25, state: 'block', weight: 1, overlay: true });
    const entryRamp = await ramp({ clip: 'block', fromT: 0.25, toT: 0.25, state: 'block', duration: 0.3 });
    entry.settled = settled;
    entry.regrip = entryRamp;
    entry.regripDeadline = THOR_CARRY_POLICY.states.block.regrip.by;
    // Release is what happens on the first frame the guard is no longer held. The block clip is
    // still the authored pose, so this measures whether the offhand leaves the haft with the state.
    const released = await sample({ clip: 'block', t: 0.25, state: 'idle', weight: 0, overlay: true });
    entry.releaseAfterExit = released.live;
    entry.releaseDeadline = THOR_CARRY_POLICY.states.block.release.by;
    if (entryRamp.error) fail(entry, 'block-ramp', { error: entryRamp.error });
    else if (entryRamp.firstGrip === null) fail(entry, 'block-regrip', { firstGrip: null,
      deadline: entry.regripDeadline });
    else if (entryRamp.firstGrip > entry.regripDeadline) fail(entry, 'block-regrip', {
      firstGrip: entryRamp.firstGrip, deadline: entry.regripDeadline });
    if (released.live.left.onHaft) fail(entry, 'block-release', {
      gap: released.live.left.gap, deadline: entry.releaseDeadline });
    report.block = entry;
    console.log('STATE block-entry ' + JSON.stringify({
      firstGrip: entryRamp.firstGrip, deadline: entry.regripDeadline,
      settledGap: settled.live?.left.gap, failures: entry.failures?.map(f => f.type) || []
    }));
  }

  for (const [slot, row] of Object.entries(THOR_CARRY_POLICY.attackSlots)) {
    const entry = { kind: 'attack', id: slot, slot, clip: row.clip, mode: row.mode,
      label: row.label || null, offhand: row.offhand, samples: [] };
    const timing = setup.timing[row.move] || null;
    entry.timing = timing;

    if (row.timeline === 'clip') {
      const points = slot === 'ultimate'
        ? [0.16, 0.20, 0.36, 0.40, 0.44, 0.56, 0.84]
        : slot === 'special'
          ? [0.26, 0.30, 0.36, 0.40, 0.44, 0.58, 0.82]
          : [0.10, 0.50, 0.90];
      for (const t of points) {
        const measured = await sample({ clip: row.clip, t, state: 'idle',
          casting: slot === 'ultimate' ? 'ultimate' : null, weight: 0, overlay: false });
        entry.samples.push({ t, ...measured });
        if (measured.error) { fail(entry, 'missing-clip', { clip: row.clip, error: measured.error }); break; }
      }
      if (!entry.samples.some(s => s.error)) {
        const at = t => entry.samples.find(s => Math.abs(s.t - t) < 1e-6)?.live.left;
        if (slot === 'special') {
          const regrip = at(0.36), hold = at(0.40), release = at(0.58);
          if (!regrip?.contact) fail(entry, regrip?.onHaft ? 'two-handed-grip-position' : 'two-handed-regrip', {
            phase: 0.36, gap: regrip?.gap, relativeSlide: regrip?.relativeSlide, deadline: 0.36 });
          if (!hold?.contact) fail(entry, hold?.onHaft ? 'two-handed-grip-position' : 'two-handed-contact', {
            phase: 0.40, gap: hold?.gap, relativeSlide: hold?.relativeSlide });
          if (release?.onHaft) fail(entry, 'two-handed-release', {
            phase: 0.58, gap: release.gap, note: 'Offhand still on the haft at the end of the release window.' });
        } else if (slot === 'ultimate') {
          const charge = at(0.20), chargeLate = at(0.36), release = at(0.56);
          if (!charge?.contact) fail(entry, charge?.onHaft ? 'two-handed-grip-position' : 'two-handed-regrip', {
            phase: 0.20, gap: charge?.gap, relativeSlide: charge?.relativeSlide, deadline: 0.20 });
          if (!chargeLate?.contact) fail(entry, chargeLate?.onHaft ? 'two-handed-grip-position' : 'two-handed-contact', {
            phase: 0.36, gap: chargeLate?.gap, relativeSlide: chargeLate?.relativeSlide });
          if (release?.onHaft) fail(entry, 'two-handed-release', {
            phase: 0.56, gap: release.gap, note: 'Offhand still on the haft after the storm release.' });
        } else if (entry.samples.some(s => s.live.left.contact)) {
          fail(entry, 'one-handed-live-grip', { phases: entry.samples.filter(s => s.live.left.contact).map(s => s.t) });
        }
      }
    } else if (row.mode === 'two-handed' && timing) {
      const s = timing.startupFrac, e = timing.activeEndFrac;
      const points = [
        { phase: 'startup', t: s * 0.75, state: 'attack-startup' },
        { phase: 'startup-end', t: s, state: 'attack-active' },
        { phase: 'active', t: (s + e) / 2, state: 'attack-active' },
        { phase: 'release-end', t: e + (1 - e) * 0.75, state: 'attack-recovery' }
      ];
      for (const p of points) {
        const measured = await sample({ clip: row.clip, t: p.t, state: p.state, weight: 1, overlay: true });
        entry.samples.push({ ...p, ...measured });
      }
      const at = phase => entry.samples.find(s => s.phase === phase)?.live.left;
      if (!at('startup-end')?.contact) fail(entry, at('startup-end')?.onHaft
        ? 'two-handed-grip-position' : 'two-handed-regrip', {
        phase: 'startup-end', gap: at('startup-end')?.gap,
        relativeSlide: at('startup-end')?.relativeSlide, deadline: s
      });
      if (!at('active')?.contact) fail(entry, at('active')?.onHaft
        ? 'two-handed-grip-position' : 'two-handed-contact', {
        phase: 'active', gap: at('active')?.gap, relativeSlide: at('active')?.relativeSlide });
      if (at('release-end')?.onHaft) fail(entry, 'two-handed-release', {
        phase: 'release-end', gap: at('release-end').gap,
        note: 'Offhand still on the haft at the end of the release window.' });
      entry.regripRamp = await ramp({ clip: row.clip, fromT: 0, toT: s,
        state: 'attack-startup', duration: timing.start });
      entry.regripRamp.deadline = timing.start;
      if (entry.regripRamp.error) fail(entry, 'regrip-ramp', { error: entry.regripRamp.error });
      else if (entry.regripRamp.firstGrip === null) fail(entry, 'two-handed-regrip', {
        firstGrip: null, deadline: timing.start });
      else if (entry.regripRamp.firstGrip > timing.start) fail(entry, 'two-handed-regrip', {
        firstGrip: entry.regripRamp.firstGrip, deadline: timing.start });
    } else {
      const points = timing
        ? oneHandAttackSamples(timing)
        : [{ phase: 'startup', t: 0.15, state: 'attack-startup' },
          { phase: 'active', t: 0.50, state: 'attack-active' },
          { phase: 'release', t: 0.85, state: 'attack-recovery' }];
      for (const p of points) {
        const measured = await sample({ clip: row.clip, t: p.t, state: p.state, weight: 1, overlay: true });
        entry.samples.push({ ...p, ...measured });
      }
      const grips = entry.samples.filter(s => s.live.left.contact);
      entry.liveGripSamples = grips.map(s => ({ phase: s.phase, t: s.t, gap: s.live.left.gap }));
      entry.liveModes = entry.samples.map(s => s.live.carry?.mode || null);
      const twoHandedModes = entry.samples.filter(s => s.live.carry?.mode === 'two-handed');
      if (grips.length) fail(entry, 'one-handed-live-grip', {
        phases: grips.map(s => s.phase),
        note: 'The carry overlay forces a two-hand grip on a one-hand move.'
      });
      if (twoHandedModes.length) fail(entry, 'unexpected-two-handed-mode', {
        phases: twoHandedModes.map(s => s.phase), liveModes: entry.liveModes,
        note: 'The carry layer selects a two-handed technique for a one-handed move.'
      });
    }

    report.attacks.push(entry);
    console.log('ATTACK ' + slot + ' ' + JSON.stringify({
      mode: row.mode, clip: row.clip,
      grips: entry.liveGripSamples || entry.samples.filter(s => s.live?.left.contact).map(s => s.phase || s.t),
      firstGrip: entry.regripRamp?.firstGrip, deadline: entry.regripRamp?.deadline,
      failures: entry.failures?.map(f => f.type) || []
    }));
  }

  for (const entry of [...report.states, ...report.attacks, report.block].filter(Boolean)) {
    if (entry.rightHandFailures?.length) fail(entry, 'right-hand-contact', { samples: entry.rightHandFailures });
  }

  report.status = report.failures.length || report.pageErrors.length || report.consoleErrors.length
    ? 'failed' : 'complete';
  console.log('SUMMARY ' + JSON.stringify({
    status: report.status,
    states: report.states.length,
    attacks: report.attacks.length,
    failures: report.failures.length,
    failuresByType: report.failures.reduce((out, f) => {
      out[f.type] = (out[f.type] || 0) + 1; return out;
    }, {})
  }, null, 2));
} catch (error) {
  report.status = 'failed';
  report.error = String(error?.stack || error);
  console.error(report.error);
} finally {
  await browser.close();
  server.close();
  await writeFile(resolve(outDir, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(outDir, 'policy.json'), JSON.stringify(THOR_CARRY_POLICY, null, 2) + '\n');
}
if (report.status !== 'complete') process.exitCode = 1;
