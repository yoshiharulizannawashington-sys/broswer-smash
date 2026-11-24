// Additive facial and weapon overlays on top of the body-mask lanes.
//
// The upper/lower masks own the canonical skeleton. A face is not made of those joints, and a
// weapon hangs off a hand rather than being a bone in the body clip, so neither can be expressed by
// widening a mask without stealing a lane from gameplay. These overlays run after the clip owner has
// written the body (and after the controller's personality nudge), then add local-space motion:
//
//   face   head/neck gaze + brow/mouth/eye geometry + optional jaw/morph targets
//   weapon the equipped prop's local grip transform (sway, brace, recoil)
//
// Everything is snapshot-based: the body clip remains the base pose, the weapon keeps its authored
// grip, and removing the overlay restores those exact local transforms. Morph weights and facial
// geometry are additive too, never replacements.
import * as THREE from 'three';
import { installGokuFaceRig } from './goku_face_rig.js';

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _vec = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;
const smoothstep01 = value => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

const FACE_MATERIAL = /fighter-(?:eye-white|iris|pupil|brow|mouth|blink|eyelid|lash)\b/i;
const FACE_NAME = /(?:^|[-_ ])(?:eye|iris|pupil|brow|mouth|lip|eyelid|blink|lash|lid)(?:$|[-_ \d])/i;
const FACE_EXCLUDE = /skin|nose|ear|hair|visor|helmet|skull|head/i;

// The face channel has three named reads on top of the attack effort curve. The resolver is
// deliberately stateless: every owner passes the same fighter fields, so the controller and the
// legacy mixer cannot disagree about whether a guard or a hit should be on the face.
const FACE_EXPRESSIONS = Object.freeze({
  neutral: Object.freeze({ browLift: 0, browTilt: 0, eyeClose: 0, mouthLine: 1, mouthOpen: 0, smile: 0, mouthDrop: 0, mouthWiden: 1, headPitch: 0, headYaw: 0, headRoll: 0 }),
  guard: Object.freeze({ browLift: -0.001, browTilt: -0.03, eyeClose: 0.24, mouthLine: 0.72, mouthOpen: 0, smile: 0, mouthDrop: 0.001, mouthWiden: 0.88, headPitch: -0.004, headYaw: 0.004, headRoll: 0 }),
  hit: Object.freeze({ browLift: 0.006, browTilt: 0.10, eyeClose: 0.78, mouthLine: 0, mouthOpen: 1, smile: 0, mouthDrop: 0.003, mouthWiden: 0.95, headPitch: -0.010, headYaw: 0, headRoll: 0.006 }),
  victory: Object.freeze({ browLift: 0.007, browTilt: 0.14, eyeClose: 0.86, mouthLine: 0, mouthOpen: 0, smile: 1, mouthDrop: -0.001, mouthWiden: 1.05, headPitch: 0.012, headYaw: 0, headRoll: 0.005 })
});

function resolveFaceExpression(fighter, guarding) {
  const hitstun = Math.max(0, Number(fighter?.hitstun) || 0);
  if (hitstun > 0) return { id: 'hit', weight: Math.min(1, hitstun / 0.38) };
  if ((Number(fighter?.victoryPose) || 0) > 0) return { id: 'victory', weight: 1 };
  if (guarding) return { id: 'guard', weight: 1 };
  return { id: 'neutral', weight: 0 };
}

function materialLabel(mesh) {
  const list = Array.isArray(mesh?.material) ? mesh.material : [mesh?.material];
  return list.map(material => material?.name || '').filter(Boolean).join(' ');
}

/** Classify a visual face piece, not a skinned eye or an arbitrary mesh under the head. */
function classifyFacePart(mesh) {
  if (!mesh?.isMesh || mesh.isSkinnedMesh) return null;
  // The baked rig ships its own morph targets. Its meshes are driven by weights, not by the
  // runtime local-transform path, so never collect them as live face pieces.
  if (mesh.userData?.gokuBakedFace) return null;
  const label = `${mesh.name || ''} ${materialLabel(mesh)}`;
  if (!FACE_MATERIAL.test(label) && !FACE_NAME.test(label)) return null;
  if (FACE_EXCLUDE.test(label)) return null;
  if (/eyelid|blink|lash|(?:^|[-_ ])lid(?:$|[-_ \d])/i.test(label)) return 'blink';
  if (/mouth|lip/i.test(label)) return 'mouth';
  if (/brow/i.test(label)) return 'brow';
  if (/pupil/i.test(label)) return 'pupil';
  if (/iris/i.test(label)) return 'iris';
  if (/eye/i.test(label)) return 'eye';
  return null;
}

function snapshot(node) {
  return {
    position: node.position.clone(),
    quaternion: node.quaternion.clone(),
    scale: node.scale.clone(),
    visible: node.visible
  };
}

function addLocalQuaternion(node, x, y, z) {
  if (!node || (!x && !y && !z)) return;
  _euler.set(x, y, z, 'XYZ');
  _quat.setFromEuler(_euler);
  node.quaternion.multiply(_quat).normalize();
}

function findHead(model, rig) {
  return model?.userData?.head || rig?.joints?.head || null;
}

function findNeck(model, rig) {
  return model?.userData?.neck || rig?.joints?.neck || null;
}

function collectFaceParts(head) {
  const parts = [];
  if (!head?.traverse) return parts;
  head.traverse(node => {
    if (node === head) return;
    const kind = classifyFacePart(node);
    if (!kind) return;
    parts.push({ node, kind, base: snapshot(node) });
  });
  return parts;
}

function collectFaceBones(head) {
  const bones = { jaw: null, brow: null };
  if (!head?.traverse) return bones;
  head.traverse(node => {
    if (node === head || !node?.isBone) return;
    const name = String(node.name || '');
    if (!bones.jaw && /jaw|chin/i.test(name)) bones.jaw = node;
    if (!bones.brow && /brow/i.test(name)) bones.brow = node;
  });
  return bones;
}

function collectMorphs(model) {
  const meshes = [];
  if (!model?.traverse) return meshes;
  model.traverse(mesh => {
    if (!mesh?.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    const base = mesh.morphTargetInfluences.slice();
    const entries = Object.entries(mesh.morphTargetDictionary)
      .map(([name, index]) => ({ name, index }))
      .filter(entry => Number.isInteger(entry.index));
    if (entries.length) meshes.push({ mesh, base, entries });
  });
  return meshes;
}

function collectWeapons(model) {
  const userData = model?.userData || {};
  return [
    ['right', userData.equippedWeaponRight],
    ['left', userData.equippedWeaponLeft],
    ['pickup', userData.pickupBlade]
  ].filter(([, object]) => object?.isObject3D);
}

function ensureWeaponRecords(state, model) {
  const current = collectWeapons(model);
  const seen = new Set(current.map(([, object]) => object));
  state.weapons = state.weapons.filter(record => seen.has(record.object));
  for (const [side, object] of current) {
    if (state.weapons.some(record => record.object === object)) continue;
    state.weapons.push({ object, side, base: snapshot(object), name: object.name || object.type || side });
  }
  return state.weapons;
}

/**
 * Bind the overlay state to a model once. This is deliberately idempotent: the same model is shared
 * by the controller and the legacy mixer while a body is swapped, and both callers need the same
 * snapshots, not two competing overlays.
 */
export function ensureAnimationOverlays(model, fighter, rig = null) {
  if (!model) return null;
  const existing = model.userData?.animationOverlays;
  if (existing?.model === model) {
    if (rig) existing.rig = rig;
    return existing;
  }
  const head = findHead(model, rig);
  const neck = findNeck(model, rig);
  // The licensed Goku head has eyes but no separately authored mouth, brow or lid geometry. Build
  // that additive layer on the mounted head before collecting the overlay parts. The installer is
  // idempotent and rejects bodies whose head is not the imported Goku skull.
  if (/goku/i.test(String(fighter?.identity || '')) && !model.userData?.gokuFaceRig) {
    try { installGokuFaceRig(model, fighter); } catch (error) {
      console.warn('Goku face rig unavailable:', error?.message || error);
    }
  }
  const faceBones = collectFaceBones(head);
  const bakedFace = Boolean(model.userData?.gokuFaceRig?.baked);
  const state = {
    model,
    fighter,
    rig,
    head,
    neck,
    headBase: head ? snapshot(head) : null,
    neckBase: neck ? snapshot(neck) : null,
    faceParts: bakedFace ? [] : collectFaceParts(head),
    morphs: collectMorphs(model),
    jaw: faceBones.jaw,
    browBone: faceBones.brow,
    jawBase: faceBones.jaw ? snapshot(faceBones.jaw) : null,
    browBase: faceBones.brow ? snapshot(faceBones.brow) : null,
    weapons: [],
    clock: 0,
    faceWeight: 0,
    weaponWeight: 0,
    guardBrace: 0,
    weaponPulse: 0,
    lastAttackKey: null,
    owner: 'unbound',
    active: null,
    lastBlink: 0,
    expression: 'neutral',
    expressionWeight: 0,
    report: null
  };
  if (model.userData) model.userData.animationOverlays = state;
  ensureWeaponRecords(state, model);
  return state;
}

function blinkPulse(clock) {
  // A short, deterministic blink every 3.9 s. The eyes are geometry on the sculpted bodies, so a
  // vertical squash is the additive equivalent of closing an eyelid; the packet is short enough not
  // to read as a squint.
  const phase = clock % 3.9;
  if (phase < 3.66 || phase > 3.82) return 0;
  return Math.sin(((phase - 3.66) / 0.16) * Math.PI);
}

function applyFace(state, fighter, dt, effort, guarding, speed) {
  const head = state.head;
  const neck = state.neck;
  if (!head && !neck && !state.faceParts.length && !state.morphs.length && !state.jaw) return;

  const blink = blinkPulse(state.clock);
  state.lastBlink = blink;
  const expressionState = resolveFaceExpression(fighter, guarding);
  state.expression = expressionState.id;
  state.expressionWeight = damp(state.expressionWeight, expressionState.weight, 14, dt);
  const expressionMix = state.expressionWeight;
  const pose = FACE_EXPRESSIONS[expressionState.id] || FACE_EXPRESSIONS.neutral;
  const look = Math.sin(state.clock * 0.63) * 0.017
    + (guarding ? 0.012 : 0)
    + (fighter?.attackQueue?.length ? -0.006 : 0)
    + pose.headYaw * expressionMix;
  const pitch = Math.sin(state.clock * 0.41 + 0.8) * 0.011
    + (fighter?.attackQueue?.length ? 0.018 : 0)
    + (fighter?.hitstun > 0 ? -0.018 : 0)
    + pose.headPitch * expressionMix;
  const roll = Math.sin(state.clock * 0.29 + 1.2) * 0.006 + pose.headRoll * expressionMix;
  addLocalQuaternion(head, pitch * 0.7, look, roll * 0.6);
  addLocalQuaternion(neck, pitch * 0.3, look * 0.42, roll * 0.25);

  const expression = clamp(effort + state.weaponPulse * 0.22, 0, 1.25);
  // Blink and the named expression share the eyelid channel. A hit or a victory can close the
  // eyes without waiting for the idle blink phase, while a guard only narrows them.
  const eyeClosure = Math.max(blink, pose.eyeClose * expressionMix);
  // Baked lids descend from the upper eye line. Guard's 24% eyeClose is a narrowing, not enough
  // to form a closed lid, so hold the morphs shut until the blink curve has visibly begun; this
  // also removes the tiny floating lid patch a linear 0.24 weight produced at close-up.
  const bakedBlink = smoothstep01((eyeClosure - 0.34) / 0.66);
  for (const part of state.faceParts) {
    const node = part.node;
    const base = part.base;
    node.position.copy(base.position);
    node.quaternion.copy(base.quaternion);
    node.scale.copy(base.scale);
    node.visible = base.visible;
    const side = Math.sign(base.position.x) || 1;
    if (part.kind === 'brow') {
      node.rotation.z += side * (-0.20 * expression + pose.browTilt * expressionMix);
      node.position.y += pose.browLift * expressionMix - 0.003 * expression;
    } else if (part.kind === 'mouth') {
      const role = node.userData?.expressionRole || 'line';
      if (role === 'open') {
        const open = pose.mouthOpen * expressionMix;
        node.visible = base.visible || open > 0.02;
        node.scale.set(
          base.scale.x * pose.mouthWiden * (0.9 + 0.2 * expression),
          base.scale.y * (1 + 3.0 * open),
          base.scale.z
        );
        node.position.y += pose.mouthDrop * expressionMix - 0.002 * expression;
      } else if (role === 'smile') {
        node.visible = base.visible || pose.smile * expressionMix > 0.02;
        node.scale.set(base.scale.x * pose.mouthWiden, base.scale.y, base.scale.z);
        node.position.y += pose.mouthDrop * expressionMix;
      } else {
        node.visible = base.visible && pose.mouthLine > 0.02;
        node.scale.x *= pose.mouthWiden;
        node.scale.y *= Math.max(0.2, pose.mouthLine) * (1 + 0.58 * expression);
        node.position.y += pose.mouthDrop * expressionMix - 0.0035 * expression;
      }
    } else if (part.kind === 'blink') {
      // The lid is nearly invisible at rest (a thin line under the brow), then expands downward
      // over the eye. This keeps the authored eye geometry intact and makes the blink readable
      // without painting a second eye or replacing the body material.
      node.scale.y *= 0.08 + 0.92 * eyeClosure;
      node.position.y = base.position.y - 0.012 * eyeClosure;
    } else {
      // Eye white, iris and pupil are siblings, so closing all three leaves the face readable
      // instead of closing only a pupil or only its sclera.
      node.scale.y *= Math.max(0.08, 1 - 0.20 * expression - 0.82 * eyeClosure);
      node.position.y -= 0.0015 * eyeClosure;
    }
  }

  for (const entry of state.morphs) {
    for (const target of entry.entries) {
      const name = target.name.toLowerCase();
      let add = 0;
      if (/mouth|jaw|open/.test(name)) add = 0.62 * expression + 0.38 * pose.mouthOpen * expressionMix;
      else if (/brow|angry|frown/.test(name)) add = 0.44 * expression + 0.18 * pose.browLift * expressionMix;
      else if (/smile|happy/.test(name)) add = 0.80 * pose.smile * expressionMix;
      else if (/blink|eye.?close|squint/.test(name)) add = Math.max(0.92 * blink, 0.60 * pose.eyeClose * expressionMix);
      if (!add) continue;
      entry.mesh.morphTargetInfluences[target.index] =
        clamp((entry.base[target.index] || 0) + add, 0, 1);
    }
  }

  // Baked Goku targets are exact named shapes. Blink is shared by every expression; the three
  // expression shapes are mutually exclusive, so a state change cannot leave a stale smile or
  // hit mouth open under the next pose.
  for (const entry of state.morphs) {
    for (const target of entry.entries) {
      const named = /^(?:goku[_-]?face[_-]?)?(guard|hit|victory|blink)$/i.exec(String(target.name || '').trim());
      if (!named) continue;
      const id = named[1].toLowerCase();
      let value = 0;
      if (id === 'blink') value = bakedBlink;
      else if (id === state.expression) value = expressionMix;
      entry.mesh.morphTargetInfluences[target.index] =
        clamp((entry.base[target.index] || 0) + value, 0, 1);
    }
  }

  if (state.jaw) {
    state.jaw.quaternion.copy(state.jawBase.quaternion);
    addLocalQuaternion(state.jaw,
      0.035 + 0.065 * expression + 0.045 * pose.mouthOpen * expressionMix + 0.025 * blink, 0, 0);
  }
  if (state.browBone) {
    state.browBone.quaternion.copy(state.browBase.quaternion);
    addLocalQuaternion(state.browBone, 0, 0, -0.04 * expression + 0.03 * pose.browLift * expressionMix);
  }

  // Speed is a useful facial tell: a sprinting fighter narrows the eyes and leans the head into the
  // run, while a stationary guard keeps a steadier gaze. This is still an additive offset.
  if (head && speed > 8) addLocalQuaternion(head, 0.012, 0, -0.01);
  if (neck && speed > 8) addLocalQuaternion(neck, 0.006, 0, 0);
}

function faceMorphWeights(state) {
  const weights = {};
  for (const entry of state.morphs) {
    for (const target of entry.entries) {
      const value = entry.mesh.morphTargetInfluences[target.index] || 0;
      const key = target.name || `target-${target.index}`;
      weights[key] = +(Math.max(weights[key] || 0, value)).toFixed(3);
    }
  }
  return weights;
}

function applyWeapons(state, fighter, dt, guarding, speed) {
  const records = ensureWeaponRecords(state, state.model);
  if (!records.length) return;
  const weaponKind = String(state.model?.userData?.weaponKind || '');
  const ranged = /blaster|rifle|shotgun|pistol|plasma/i.test(weaponKind);
  const loco = clamp(speed / 7, 0, 1.4);
  let index = 0;
  for (const record of records) {
    const object = record.object;
    const base = record.base;
    const side = record.side === 'left' ? -1 : 1;
    index += 1;
    // A stowed prop is not drawn; leave its untouched grip snapshot alone so restoring it does not
    // snap to an overlay pose that was captured while it was invisible.
    if (!object.visible || (object.userData?.equipmentFade ?? 1) <= 0.01) continue;
    object.position.copy(base.position);
    object.quaternion.copy(base.quaternion);
    const phase = state.clock * (1.7 + speed * 0.11) + index * 1.37;
    const weight = state.weaponWeight;
    const sway = Math.sin(phase) * 0.006 * (0.35 + loco) * weight;
    const breath = Math.sin(state.clock * 0.83 + index) * 0.003 * weight;
    const brace = state.guardBrace * 0.035 * weight;
    const recoil = state.weaponPulse * (ranged ? 0.045 : 0.030) * weight;
    object.rotation.x += recoil * 1.6 + sway * 0.35 - breath;
    object.rotation.y += side * (sway * 0.5 + brace * 0.35);
    object.rotation.z += side * (sway * 0.9 + brace) + recoil * 0.45;
    _vec.set(side * sway * 0.18, breath * 0.25, recoil * 0.7 + sway * 0.15);
    object.position.add(_vec);
  }
}

/**
 * Advance both additive overlays. Called once per animation owner, after the mask/personality pass.
 * The returned report is also attached to `model.userData.animationOverlays.report` and exposed via
 * `describeAnimationOverlays()`.
 */
export function updateAnimationOverlays(model, fighter, dt = 1 / 60, options = {}) {
  const state = ensureAnimationOverlays(model, fighter, options.rig || null);
  if (!state) return null;
  state.clock += Number.isFinite(dt) ? dt : 0;
  state.owner = options.owner || state.owner || 'unbound';
  state.active = options.active || null;
  const f = fighter || state.fighter || {};
  const speed = Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0);
  const guarding = Boolean(f.guardHeld && (f.guardBreak || 0) <= 0);
  const attacking = Boolean(f.attackQueue?.length);
  const hit = (f.hitstun || 0) > 0;
  const attack = f.attackQueue?.[f.attackQueue.length - 1] || null;
  const attackKey = attack
    ? `${attack.id || attack.kind || 'attack'}|${f.comboStep || 0}|${attack.start ?? ''}`
    : null;
  if (attackKey && attackKey !== state.lastAttackKey) state.weaponPulse = 1;
  if (!attackKey) state.weaponPulse = Math.max(0, state.weaponPulse - dt * 4.4);
  else state.weaponPulse = Math.max(0, state.weaponPulse - dt * 3.0);
  state.lastAttackKey = attackKey;
  state.faceWeight = damp(state.faceWeight, 1, 12, dt);
  state.weaponWeight = damp(state.weaponWeight, 1, 14, dt);
  state.guardBrace = damp(state.guardBrace, guarding ? 1 : 0, 16, dt);
  const effort = clamp(
    (attacking ? 0.72 : 0) + (guarding ? 0.36 : 0) + (hit ? 0.9 : 0)
      + (speed > 1.2 ? 0.10 : 0) + 0.08,
    0, 1.25);

  applyFace(state, f, dt, effort * state.faceWeight, guarding, speed);
  applyWeapons(state, f, dt, guarding, speed);
  const faceRig = state.model?.userData?.gokuFaceRig;
  const faceParts = faceRig?.baked && Array.isArray(faceRig.parts)
    ? faceRig.parts
    : state.faceParts.map(part => part.kind);
  state.report = {
    owner: state.owner,
    active: state.active,
    face: {
      head: state.head?.name || null,
      neck: state.neck?.name || null,
      jaw: state.jaw?.name || null,
      browBone: state.browBone?.name || null,
      parts: faceParts,
      morphs: state.morphs.reduce((count, entry) => count + entry.entries.length, 0),
      morphWeights: faceMorphWeights(state),
      weight: +state.faceWeight.toFixed(3),
      effort: +effort.toFixed(3),
      blink: +state.lastBlink.toFixed(3),
      expression: state.expression,
      expressionWeight: +state.expressionWeight.toFixed(3),
      baked: Boolean(faceRig?.baked),
      authoredRig: Boolean(faceRig)
    },
    weapon: {
      count: state.weapons.length,
      names: state.weapons.map(record => record.name),
      kind: state.model?.userData?.weaponKind || null,
      weight: +state.weaponWeight.toFixed(3),
      brace: +state.guardBrace.toFixed(3),
      recoil: +state.weaponPulse.toFixed(3)
    }
  };
  if (model.userData) model.userData.animationOverlayReport = state.report;
  return state;
}

/** Plain JSON-safe diagnostics, including the live source contract for the overlay. */
export function describeAnimationOverlays(model) {
  const state = model?.userData?.animationOverlays;
  if (!state) return null;
  return state.report || {
    owner: state.owner,
    active: state.active,
    face: {
      head: state.head?.name || null,
      neck: state.neck?.name || null,
      jaw: state.jaw?.name || null,
      browBone: state.browBone?.name || null,
      parts: state.model?.userData?.gokuFaceRig?.baked
        ? state.model.userData.gokuFaceRig.parts
        : state.faceParts.map(part => part.kind),
      morphs: state.morphs.reduce((count, entry) => count + entry.entries.length, 0),
      morphWeights: faceMorphWeights(state),
      weight: 0, effort: 0, blink: 0,
      expression: state.expression || 'neutral',
      expressionWeight: +state.expressionWeight.toFixed(3),
      baked: Boolean(state.model?.userData?.gokuFaceRig?.baked),
      authoredRig: Boolean(state.model?.userData?.gokuFaceRig)
    },
    weapon: { count: state.weapons.length, names: state.weapons.map(record => record.name), kind: null, weight: 0, brace: 0, recoil: 0 }
  };
}

/** Restore every local transform the overlay owns. The next update rebuilds the cache. */
export function resetAnimationOverlays(model) {
  const state = model?.userData?.animationOverlays;
  if (!state) return false;
  if (state.head && state.headBase) {
    state.head.position.copy(state.headBase.position);
    state.head.quaternion.copy(state.headBase.quaternion);
    state.head.scale.copy(state.headBase.scale);
  }
  if (state.neck && state.neckBase) {
    state.neck.position.copy(state.neckBase.position);
    state.neck.quaternion.copy(state.neckBase.quaternion);
    state.neck.scale.copy(state.neckBase.scale);
  }
  for (const part of state.faceParts) {
    part.node.position.copy(part.base.position);
    part.node.quaternion.copy(part.base.quaternion);
    part.node.scale.copy(part.base.scale);
    part.node.visible = part.base.visible;
  }
  for (const entry of state.morphs) {
    for (let index = 0; index < entry.base.length; index++) {
      entry.mesh.morphTargetInfluences[index] = entry.base[index];
    }
  }
  if (state.jaw && state.jawBase) {
    state.jaw.position.copy(state.jawBase.position);
    state.jaw.quaternion.copy(state.jawBase.quaternion);
    state.jaw.scale.copy(state.jawBase.scale);
  }
  if (state.browBone && state.browBase) {
    state.browBone.position.copy(state.browBase.position);
    state.browBone.quaternion.copy(state.browBase.quaternion);
    state.browBone.scale.copy(state.browBase.scale);
  }
  for (const record of state.weapons) {
    record.object.position.copy(record.base.position);
    record.object.quaternion.copy(record.base.quaternion);
    record.object.scale.copy(record.base.scale);
  }
  delete model.userData.animationOverlays;
  delete model.userData.animationOverlayReport;
  return true;
}
