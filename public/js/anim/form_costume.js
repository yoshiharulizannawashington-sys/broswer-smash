// Form costumes: real geometry bound to the fighter's own skeleton, built at runtime and removed
// on exit.
//
// A form that only retints hair and draws a ring is a stat buff, not a transformation. Each form
// here adds its own silhouette - a Sage coat and mantle, a fitted Nine-Tails chakra shell with
// tails, a Kurama Link coat with horns and four tails, a Six Paths cloak with orbiting
// Truth-Seeking Orbs, a fitted Baryon mantle - and every piece is bound to the bone that actually
// moves it: the chest drives coats, mantles, collars, back panels and chakra rings, the clavicles
// drive the shoulder pieces, the pelvis drives the tails, and the head drives the markings and the
// Kurama horns.
//
// Binding works by placing an anchor group under the bone whose local matrix is
// `inverse(boneWorld) * modelWorld` at the moment the form starts. That makes the anchor's world
// transform identical to the model's at bind time, so part coordinates stay authored in model
// space (the same numbers the old rigid version used), and afterwards the anchor carries exactly
// the bone's motion. No second skeleton is created and the GLB and its clips are untouched.
import * as THREE from 'three';

const TAU = Math.PI * 2;

// Anchor ids the builder understands. `body` is the chest/spine, `hips` the pelvis, `head` the
// head, and the two shoulder ids prefer a clavicle and fall back to the upper arm.
const ANCHOR_IDS = Object.freeze(['body', 'hips', 'head', 'shoulderL', 'shoulderR']);

const SPECS = Object.freeze({
  // Sage Mode: a long open-front orange coat, a cream mantle over the shoulders and the scroll
  // panel on the back. The previous version put that panel at +Z, i.e. across the chest.
  'sage-mode': {
    parts: [
      { type: 'coat', anchor: 'body', color: 0xc85a1c, top: .30, bottom: .36, height: .92, y: 1.00, gap: 1.05, roughness: .74 },
      { type: 'mantle', anchor: 'body', color: 0xd9c49a, top: .27, bottom: .345, height: .15, y: 1.47, gap: 1.6, roughness: .58 },
      { type: 'collar', anchor: 'body', color: 0xf7efdc, radius: .155, tube: .036, y: 1.55 },
      { type: 'pads', anchor: 'body', color: 0xd9c49a, size: [.15, .09, .22], x: .245, y: 1.43, tilt: .20 },
      { type: 'panel', anchor: 'body', color: 0x8f3a12, size: [.30, .56, .05], y: 1.06, z: -.235, tilt: .07 },
      { type: 'marking', anchor: 'head', color: 0xb23a1e, size: [.066, .022, .012], xOffset: .086, y: 1.665, z: .172, tilt: .22 }
    ]
  },
  // Nine-Tails Chakra Mode: the bulky translucent shroud is gone. A fitted golden shell hugs the
  // torso, thin chakra rings break up its surface, and the markings are large enough to read from
  // the gameplay camera. Three tails hang from the pelvis instead of floating behind the body.
  'nine-tails-chakra': {
    parts: [
      { type: 'shell', anchor: 'body', color: 0xffbf46, emissive: 0xff9a00, emissiveIntensity: .42, top: .24, bottom: .268, height: .70, y: 1.03, opacity: .94, roughness: .42 },
      { type: 'mantle', anchor: 'body', color: 0xffb432, emissive: 0xff8a00, emissiveIntensity: .35, top: .26, bottom: .33, height: .13, y: 1.47, gap: 1.2, roughness: .5 },
      { type: 'pads', anchor: 'body', color: 0xffe19a, emissive: 0xffc247, size: [.19, .10, .28], x: .27, y: 1.46, tilt: .18 },
      { type: 'ring', anchor: 'body', color: 0xfff0b8, emissive: 0xffc247, radius: .265, tube: .016, y: .90 },
      { type: 'ring', anchor: 'body', color: 0xfff0b8, emissive: 0xffc247, radius: .285, tube: .014, y: 1.22 },
      { type: 'marking', anchor: 'head', color: 0x7a3d05, size: [.074, .024, .013], xOffset: .088, y: 1.662, z: .172, tilt: .24 },
      { type: 'marking', anchor: 'head', color: 0x7a3d05, size: [.086, .013, .011], xOffset: .098, y: 1.612, z: .166, tilt: .10 },
      { type: 'marking', anchor: 'head', color: 0x7a3d05, size: [.082, .012, .011], xOffset: .104, y: 1.586, z: .162, tilt: .06 },
      { type: 'tails', anchor: 'hips', count: 3, color: 0xffc247, emissive: 0xffa000, radius: .058, length: .62, y: 1.02, spread: .14, z: -.22 }
    ]
  },
  // Kurama Link Mode: taller and wider than Nine-Tails - a flared gold coat, a heavy mantle, two
  // swept horns and four long tails, so the two chakra modes cannot be confused at a glance.
  'kurama-link': {
    parts: [
      { type: 'coat', anchor: 'body', color: 0xffc247, emissive: 0x7a4400, emissiveIntensity: .35, top: .31, bottom: .42, height: 1.02, y: .95, gap: 1.25, roughness: .55 },
      { type: 'mantle', anchor: 'body', color: 0xffcf5e, emissive: 0xffb432, emissiveIntensity: .35, top: .27, bottom: .35, height: .15, y: 1.48, gap: 1.3, roughness: .48 },
      { type: 'collar', anchor: 'body', color: 0xfff3c4, emissive: 0xffcf5e, radius: .17, tube: .034, y: 1.56 },
      { type: 'pads', anchor: 'body', color: 0xffeec0, emissive: 0xffcf5e, size: [.21, .12, .31], x: .29, y: 1.47, tilt: .24 },
      { type: 'crest', anchor: 'head', color: 0xffd76c, emissive: 0xffb432, radius: .052, height: .36, xOffset: .135, y: 1.79, z: -.03, tilt: .55 },
      { type: 'marking', anchor: 'head', color: 0x8a4a06, size: [.070, .022, .012], xOffset: .088, y: 1.663, z: .172, tilt: .24 },
      { type: 'tails', anchor: 'hips', count: 4, color: 0xffd76c, emissive: 0xffb432, radius: .062, length: .72, y: 1.03, spread: .16, z: -.23 }
    ]
  },
  // Six Paths Sage Mode: the dark cloak and the six Truth-Seeking Orbs were the strongest read of
  // the previous phase, so both stay - the cloak now rides the chest and the orbs orbit it.
  'six-paths-sage': {
    parts: [
      { type: 'coat', anchor: 'body', color: 0x1c2230, top: .31, bottom: .37, height: .98, y: .98, gap: 1.0, roughness: .7 },
      { type: 'mantle', anchor: 'body', color: 0xd6e9f5, emissive: 0x9fe8ff, emissiveIntensity: .3, top: .28, bottom: .36, height: .18, y: 1.47, gap: 1.2, roughness: .5 },
      { type: 'collar', anchor: 'body', color: 0xdff6ff, emissive: 0x9fe8ff, radius: .16, tube: .032, y: 1.55 },
      { type: 'pads', anchor: 'body', color: 0xf2fbff, emissive: 0x9fe8ff, size: [.20, .11, .30], x: .28, y: 1.47, tilt: .20 },
      { type: 'panel', anchor: 'body', color: 0x2a3346, size: [.34, .64, .05], y: 1.05, z: -.245, tilt: .06 },
      { type: 'orbs', anchor: 'body', count: 6, radius: .62, y: 1.52, size: .085, color: 0x0b0d12, glow: 0x9fe8ff },
      { type: 'marking', anchor: 'head', color: 0x9fe8ff, emissive: 0x9fe8ff, size: [.070, .023, .012], xOffset: .088, y: 1.664, z: .172, tilt: .22 }
    ]
  },
  // Baryon Mode: the stiff cone is replaced by a fitted crimson vest, a short mantle, a chest sash
  // and two tails. The red identity is kept, but the body shape underneath is visible.
  'baryon-mode': {
    parts: [
      { type: 'shell', anchor: 'body', color: 0x8c1f1f, emissive: 0x4a0808, emissiveIntensity: .7, top: .24, bottom: .265, height: .66, y: 1.04, opacity: .96, roughness: .5 },
      { type: 'mantle', anchor: 'body', color: 0xff5555, emissive: 0xff3b3b, emissiveIntensity: .4, top: .26, bottom: .33, height: .14, y: 1.47, gap: 1.3, roughness: .45 },
      { type: 'pads', anchor: 'body', color: 0xff8a8a, emissive: 0xff4b4b, size: [.18, .10, .27], x: .265, y: 1.45, tilt: .18 },
      { type: 'collar', anchor: 'body', color: 0xff9b9b, emissive: 0xff3b3b, radius: .155, tube: .030, y: 1.55 },
      { type: 'sash', anchor: 'body', color: 0xff3b3b, emissive: 0xff2a2a, size: [.52, .085, .04], y: 1.15, z: .215, roll: .62 },
      { type: 'marking', anchor: 'head', color: 0xff3b3b, emissive: 0xff3b3b, size: [.072, .024, .013], xOffset: .088, y: 1.663, z: .172, tilt: .24 },
      { type: 'tails', anchor: 'hips', count: 2, color: 0xff6a6a, emissive: 0xff3b3b, radius: .055, length: .66, y: 1.03, spread: .12, z: -.22 }
    ]
  }
});

export const COSTUME_FORMS = Object.freeze(Object.keys(SPECS));

function materialFor(part, options = {}) {
  const usesEmissive = part.emissive != null;
  return new THREE.MeshStandardMaterial({
    color: part.color,
    emissive: part.emissive ?? 0x000000,
    emissiveIntensity: usesEmissive ? (part.emissiveIntensity ?? 1.1) : 0,
    roughness: part.roughness ?? .62,
    metalness: part.metalness ?? .08,
    transparent: (part.opacity ?? 1) < 1,
    opacity: part.opacity ?? 1,
    side: options.side ?? THREE.FrontSide
  });
}

/** Resolve the bone that should drive an anchor id, preferring the rig's own canonical handles. */
function resolveAnchorBone(model, anchor) {
  const user = model.userData || {};
  const isNode = node => Boolean(node && node.isObject3D);
  const candidates = {
    body: [user.torso, user.spine, user.chest],
    hips: [user.pelvis, user.hips, user.root],
    head: [],
    shoulderL: [user.leftClavicle, user.leftArm, user.leftFore],
    shoulderR: [user.rightClavicle, user.rightArm, user.rightFore]
  }[anchor] || [];
  for (const bone of candidates) if (isNode(bone)) return bone;
  // Fall back to the skeleton itself: imported bodies expose bones by name rather than by the
  // prefab's userData handles.
  const bones = [];
  model.traverse(node => { if (node.isBone) bones.push(node); });
  const named = pattern => bones.find(bone => pattern.test(String(bone.name || '')));
  const side = anchor.endsWith('L') ? /left|_l$|\.l$|^l_/i : /right|_r$|\.r$|^r_/i;
  if (anchor.startsWith('shoulder')) {
    return bones.find(bone => side.test(bone.name) && /clavicle|shoulder/i.test(bone.name))
      || bones.find(bone => side.test(bone.name) && /upperarm|arm/i.test(bone.name))
      || null;
  }
  if (anchor === 'body') return named(/spine|chest|torso/i);
  if (anchor === 'hips') return named(/hips|pelvis/i);
  if (anchor === 'head') return named(/head/i) || (isNode(user.head) ? user.head : (isNode(user.neck) ? user.neck : null));
  return null;
}

/**
 * Put an empty anchor under `bone` whose world transform equals the model's transform right now.
 * Parts authored in model space can then be parented to the anchor and inherit bone motion.
 */
function bindAnchor(model, bone, anchorId) {
  if (!bone) return null;
  const anchor = new THREE.Group();
  anchor.name = `costume-anchor:${anchorId}`;
  model.updateWorldMatrix(true, true);
  const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(model.matrixWorld);
  anchor.matrixAutoUpdate = false;
  anchor.matrix.copy(local);
  anchor.userData.costumeAnchor = anchorId;
  bone.add(anchor);
  anchor.updateWorldMatrix(true, true);
  return anchor;
}

function addMesh(parts, anchor, part, geometry, options = {}) {
  const mesh = new THREE.Mesh(geometry, materialFor(part, options));
  mesh.name = `costume:${part.type}:${part.anchor}`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  anchor.add(mesh);
  parts.push(mesh);
  return mesh;
}

function buildParts(anchor, part, parts) {
  switch (part.type) {
    case 'coat': {
      // Open at the front (+Z) so the body still reads through the coat instead of a barrel.
      const gap = Math.min(part.gap ?? 1, Math.PI * 1.9);
      const mesh = addMesh(parts, anchor, part,
        new THREE.CylinderGeometry(part.top, part.bottom, part.height, 22, 1, true, gap / 2, TAU - gap));
      mesh.position.y = part.y;
      if (part.tilt) mesh.rotation.x = part.tilt;
      return;
    }
    case 'shell': {
      const mesh = addMesh(parts, anchor, part,
        new THREE.CylinderGeometry(part.top, part.bottom, part.height, 22, 1, true));
      mesh.position.y = part.y;
      return;
    }
    case 'mantle': {
      const gap = Math.min(part.gap ?? 0, Math.PI * 1.9);
      const mesh = addMesh(parts, anchor, part,
        new THREE.CylinderGeometry(part.top, part.bottom, part.height, 20, 1, true, gap / 2, TAU - gap));
      mesh.position.y = part.y;
      return;
    }
    case 'collar': {
      const mesh = addMesh(parts, anchor, part, new THREE.TorusGeometry(part.radius, part.tube, 8, 24));
      mesh.position.y = part.y;
      mesh.rotation.x = Math.PI / 2;
      return;
    }
    case 'pads': {
      for (const side of [-1, 1]) {
        const mesh = addMesh(parts, anchor, part, new THREE.BoxGeometry(...part.size));
        mesh.position.set(side * part.x, part.y, part.z || 0);
        mesh.rotation.z = side * -(part.tilt || 0);
      }
      return;
    }
    case 'panel': {
      const mesh = addMesh(parts, anchor, part, new THREE.BoxGeometry(...part.size));
      mesh.position.set(0, part.y, part.z);
      mesh.rotation.x = part.tilt || 0;
      return;
    }
    case 'ring': {
      const mesh = addMesh(parts, anchor, part, new THREE.TorusGeometry(part.radius, part.tube, 6, 28));
      mesh.position.y = part.y;
      mesh.rotation.x = Math.PI / 2;
      return;
    }
    case 'sash': {
      const mesh = addMesh(parts, anchor, part, new THREE.BoxGeometry(...part.size));
      mesh.position.set(0, part.y, part.z);
      mesh.rotation.z = part.roll || 0;
      return;
    }
    case 'crest': {
      for (const side of [-1, 1]) {
        const mesh = addMesh(parts, anchor, part, new THREE.ConeGeometry(part.radius, part.height, 6));
        mesh.position.set(side * part.xOffset, part.y, part.z || 0);
        mesh.rotation.set(-.25, 0, side * -(part.tilt || 0));
      }
      return;
    }
    case 'marking': {
      for (const side of [-1, 1]) {
        const mesh = addMesh(parts, anchor, part, new THREE.BoxGeometry(...part.size));
        mesh.position.set(side * part.xOffset, part.y, part.z);
        mesh.rotation.z = side * -(part.tilt || 0);
      }
      return;
    }
    default:
  }
}

function buildTails(anchor, part, parts, tails) {
  for (let index = 0; index < part.count; index++) {
    const tail = addMesh(parts, anchor, part, new THREE.ConeGeometry(part.radius, part.length, 9));
    const offset = (index - (part.count - 1) / 2);
    const angle = offset * .42;
    // Hanging behind the hips: the cone points down and back (-Z) rather than forward.
    tail.position.set(Math.sin(angle) * part.spread * 1.6, part.y, (part.z || -.25) - Math.abs(offset) * .04);
    tail.rotation.set(Math.PI + .24 + Math.abs(offset) * .05, angle * .4, Math.sin(angle) * .22);
    tails.push({ mesh: tail, base: tail.rotation.clone(), phase: index * 1.15 });
  }
}

function buildOrbs(anchor, part, parts, orbs) {
  for (let index = 0; index < part.count; index++) {
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(part.size, 12, 10),
      new THREE.MeshStandardMaterial({ color: part.color, emissive: part.glow, emissiveIntensity: .9, roughness: .32, metalness: .5 })
    );
    orb.name = `costume:orb:${part.anchor}`;
    const angle = (index / part.count) * TAU;
    orb.position.set(Math.cos(angle) * part.radius, part.y, Math.sin(angle) * part.radius);
    anchor.add(orb);
    parts.push(orb);
    orbs.push({ mesh: orb, angle, radius: part.radius, y: part.y });
  }
}

export function applyFormCostume(fighter, form) {
  if (!fighter?.model || !form?.id) return { applied: false };
  clearFormCostume(fighter);
  const spec = SPECS[form.id];
  if (!spec) return { applied: false, reason: 'no-costume' };
  const model = fighter.model;
  // One anchor per body region, bound once, shared by every part that rides that bone.
  const anchors = {};
  const anchorNames = {};
  for (const id of ANCHOR_IDS) {
    const bone = resolveAnchorBone(model, id);
    const anchor = bindAnchor(model, bone, id);
    if (!anchor) continue;
    anchors[id] = anchor;
    anchorNames[id] = String(bone.name || bone.type || 'bone');
  }
  // Rigs with no usable skeleton still get the old model-parented fallback instead of no costume.
  let fallback = null;
  const anchorFor = id => {
    if (anchors[id]) return anchors[id];
    if (!fallback) {
      fallback = new THREE.Group();
      fallback.name = `form-costume-${form.id}`;
      model.add(fallback);
    }
    return fallback;
  };

  const parts = [];
  const tails = [];
  const orbs = [];
  for (const part of spec.parts) {
    const anchor = anchorFor(part.anchor.startsWith('shoulder')
      ? (part.anchor === 'shoulder' ? 'shoulderR' : part.anchor)
      : part.anchor);
    if (part.type === 'tails') buildTails(anchor, part, parts, tails);
    else if (part.type === 'orbs') buildOrbs(anchor, part, parts, orbs);
    else buildParts(anchor, part, parts);
  }

  fighter.formCostume = {
    id: form.id,
    group: anchorFor('body'),
    anchors: [...new Set([...Object.values(anchors), ...(fallback ? [fallback] : [])])],
    parts,
    tails,
    orbs,
    orbit: 0,
    spec,
    bound: Boolean(anchors.body || anchors.hips),
    anchorNames
  };
  return {
    applied: true,
    parts: parts.length,
    id: form.id,
    bound: fighter.formCostume.bound,
    anchors: anchorNames
  };
}

export function updateFormCostume(fighter, dt) {
  const costume = fighter?.formCostume;
  if (!costume) return;
  const step = Math.min(.05, Number(dt) || 0);
  costume.orbit += step;
  costume.orbs?.forEach(orb => {
    const angle = orb.angle + costume.orbit * 1.4;
    orb.mesh.position.set(
      Math.cos(angle) * orb.radius,
      orb.y + Math.sin(costume.orbit * 2 + orb.angle) * .06,
      Math.sin(angle) * orb.radius
    );
    orb.mesh.rotation.y += step * 3;
  });
  costume.tails?.forEach(tail => {
    tail.mesh.rotation.z = tail.base.z + Math.sin(costume.orbit * 2.4 + tail.phase) * .16;
    tail.mesh.rotation.x = tail.base.x + Math.cos(costume.orbit * 1.9 + tail.phase) * .10;
  });
}

export function clearFormCostume(fighter) {
  const costume = fighter?.formCostume;
  if (!costume) return false;
  for (const part of costume.parts || []) {
    part.geometry?.dispose?.();
    if (Array.isArray(part.material)) part.material.forEach(material => material.dispose?.());
    else part.material?.dispose?.();
    part.parent?.remove(part);
  }
  for (const anchor of costume.anchors || []) anchor.parent?.remove(anchor);
  const group = costume.group;
  if (group && group.name?.startsWith('form-costume-')) group.parent?.remove(group);
  fighter.formCostume = null;
  return true;
}

export function formCostumeReport(fighter) {
  const costume = fighter?.formCostume;
  if (!costume) return { active: false, parts: 0 };
  return {
    active: true,
    id: costume.id,
    parts: costume.parts.length,
    tails: costume.tails.length,
    orbs: costume.orbs.length,
    bound: Boolean(costume.bound),
    anchors: { ...costume.anchorNames },
    orbit: +costume.orbit.toFixed(2)
  };
}
