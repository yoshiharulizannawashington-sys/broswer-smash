// Sculpted fighters: original, hand-authored 3D character bodies built in code.
//
// Why this exists
// ---------------
// The repository's shipped character prefabs (`public/assets/character_models.glb`) are
// primitive assemblies - cylinders for limbs, spheres for hands and heads - and the three
// rigged-character asset entries (Goku, Iron Man, Iron Spider) are empty because their source
// files were never supplied and Blender is not installed in this environment.
//
// Rather than ship a "high quality" claim on top of cylinder bodies, this module authors the
// geometry directly: lofted cross-sections for anatomy (real chest/waist/calf silhouettes),
// rounded armour plates for the armoured characters, individually modelled fingers, a shaped
// skull with eyes/brows/nose/mouth, and per-spike hair. Everything here is original work by
// this project - no third-party model, texture or scan is involved, so there is no licence to
// record beyond the repository's own.
//
// The skeletons match the existing procedural rig contract exactly (pelvis at y=1.02, torso at
// +0.28, arms/legs hanging along -Y), so `fighter3D.updateProceduralPose`, `rig_map.resolveRig`
// and the 39-clip animation controller drive these bodies unchanged.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { attachSpiderLegs } from '../anim/spider_legs.js';

const TAU = Math.PI * 2;

// --------------------------------------------------------------------------- geometry helpers

/**
 * Loft a closed surface through elliptical cross-sections.
 *
 * sections: [{ y, rx, rz?, cx?, cz?, front?, back? }]
 *   front/back scale the +Z / -Z half of the ring, which is what gives a chest a sternum
 *   curve and a calf its bulge without a sculpting tool.
 */
export function loftGeometry(sections, { radial = 22, capTop = true, capBottom = true, from = 0, to = TAU } = {}) {
  const positions = [];
  const indices = [];
  const span = to - from;
  // A full ring closes on itself; a partial sweep (`from`/`to`) is an open shell, which is how
  // a gi jacket is built: fabric over the back and flanks, nothing across the bare chest.
  const closed = span >= TAU - 1e-6;
  const columns = closed ? radial : radial + 1;
  for (const section of sections) {
    const rz = section.rz ?? section.rx;
    for (let i = 0; i < columns; i++) {
      const angle = from + (i / (closed ? radial : columns - 1)) * span;
      let z = Math.sin(angle) * rz;
      if (z > 0 && section.front != null) z *= section.front;
      if (z < 0 && section.back != null) z *= section.back;
      positions.push((section.cx || 0) + Math.cos(angle) * section.rx, section.y, (section.cz || 0) + z);
    }
  }
  const rings = sections.length;
  for (let r = 0; r < rings - 1; r++) {
    for (let i = 0; i < (closed ? radial : columns - 1); i++) {
      const a = r * columns + i;
      const b = r * columns + ((i + 1) % columns);
      const c = (r + 1) * columns + i;
      const d = (r + 1) * columns + ((i + 1) % columns);
      indices.push(a, c, b, b, c, d);
    }
  }
  const cap = (ringIndex, flip) => {
    const section = sections[ringIndex];
    const center = positions.length / 3;
    positions.push(section.cx || 0, section.y, section.cz || 0);
    for (let i = 0; i < (closed ? radial : columns - 1); i++) {
      const a = ringIndex * columns + i;
      const b = ringIndex * columns + ((i + 1) % columns);
      if (flip) indices.push(center, a, b);
      else indices.push(center, b, a);
    }
  };
  if (capBottom && closed) cap(0, true);
  if (capTop && closed) cap(rings - 1, false);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function material(spec) {
  const material = new THREE.MeshStandardMaterial({
    name: spec.name || 'fighter-material',
    color: spec.color ?? 0xffffff,
    metalness: spec.metalness ?? 0.1,
    roughness: spec.roughness ?? 0.6,
    emissive: spec.emissive ?? 0x000000,
    emissiveIntensity: spec.emissiveIntensity ?? 1,
    envMapIntensity: spec.envMapIntensity ?? 1,
    side: spec.side ?? THREE.FrontSide,
    transparent: Boolean(spec.transparent),
    opacity: spec.opacity ?? 1
  });
  if (spec.flatShading) material.flatShading = true;
  return material;
}

function addMesh(parent, geometry, mat, position = [0, 0, 0], rotation = null, name = null) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function sphere(parent, radius, mat, position, scale = null, segments = 18) {
  const mesh = addMesh(parent, new THREE.SphereGeometry(radius, segments, Math.max(8, segments - 6)), mat, position);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  return mesh;
}

function capsule(parent, radius, length, mat, position, rotation = null) {
  return addMesh(parent, new THREE.CapsuleGeometry(radius, length, 6, 14), mat, position, rotation);
}

function plate(parent, size, radius, mat, position, rotation = null) {
  const [w, h, d] = size;
  const geometry = new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, Math.min(w, h, d) * 0.45));
  return addMesh(parent, geometry, mat, position, rotation);
}

function ring(parent, radius, tube, mat, position, rotation = null, segments = 28) {
  return addMesh(parent, new THREE.TorusGeometry(radius, tube, 8, segments), mat, position, rotation);
}

function joint(parent, position) {
  const group = new THREE.Group();
  group.position.set(position[0], position[1], position[2]);
  parent.add(group);
  return group;
}

// --------------------------------------------------------------------------- hands and feet

/**
 * A hand with a palm, four two-phalanx fingers and an opposed thumb. `armored` swaps the
 * soft glove for separate plates and adds a repulsor disc to the palm.
 */
function buildHand({ skin, glove, armor, glow, armored = false, size = 1 }) {
  const hand = new THREE.Group();
  hand.name = armored ? 'gauntlet' : 'hand';
  const s = size;
  const palmMat = armored ? armor : (glove || skin);
  plate(hand, [0.082 * s, 0.058 * s, 0.098 * s], 0.020 * s, palmMat, [0, 0, 0]);
  if (armored) {
    // Knuckle guard and a small wrist collar read as armour at distance.
    plate(hand, [0.088 * s, 0.032 * s, 0.05 * s], 0.014 * s, armor, [0, 0.025 * s, 0.032 * s], [0.25, 0, 0]);
    ring(hand, 0.042 * s, 0.011 * s, armor, [0, 0.042 * s, 0], [Math.PI / 2, 0, 0], 16);
    const repulsor = addMesh(hand, new THREE.CylinderGeometry(0.021 * s, 0.021 * s, 0.009 * s, 14), glow, [0, -0.022 * s, 0.042 * s], [Math.PI / 2, 0, 0]);
    repulsor.name = 'repulsor-palm';
  }
  const fingerMat = armored ? armor : skin;
  for (let i = 0; i < 4; i++) {
    const x = (-0.029 + i * 0.0193) * s;
    const spread = (i - 1.5) * 0.04;
    const proximal = capsule(hand, 0.0088 * s, 0.028 * s, fingerMat, [x, -0.039 * s, 0.033 * s], [Math.PI / 2.15, spread, 0]);
    proximal.name = `finger-${i}-1`;
    const distal = capsule(hand, 0.0074 * s, 0.021 * s, fingerMat, [x + spread * 0.02, -0.058 * s, 0.045 * s], [Math.PI / 1.75, spread, 0]);
    distal.name = `finger-${i}-2`;
  }
  const thumb = capsule(hand, 0.0098 * s, 0.033 * s, fingerMat, [-0.040 * s, -0.014 * s, 0.022 * s], [0.5, 0, 0.85]);
  thumb.name = 'thumb';
  return hand;
}

/** Boot: lofted shin cuff, angled foot box, toe cap and outsole. */
function buildFoot({ boot, sole, trim, armored = false }) {
  const foot = new THREE.Group();
  foot.name = 'boot';
  // Cuff wraps the ankle; the foot itself points forward along +Z (character facing).
  // The ankle joint sits at y=0.10 in world space, so the sole bottom has to be -0.10 here.
  addMesh(foot, loftGeometry([
    { y: 0.05, rx: 0.062, rz: 0.070 },
    { y: 0.00, rx: 0.058, rz: 0.066 },
    { y: -0.05, rx: 0.052, rz: 0.060 }
  ], { radial: 14 }), boot, [0, 0, 0]);
  plate(foot, [0.105, 0.075, 0.20], 0.026, boot, [0, -0.055, 0.045]);
  plate(foot, [0.10, 0.038, 0.06], 0.02, trim, [0, -0.045, 0.145], [-0.12, 0, 0]);
  plate(foot, [0.11, 0.018, 0.21], 0.009, sole, [0, -0.095, 0.042]);
  if (armored) {
    plate(foot, [0.095, 0.04, 0.08], 0.016, armorPlateMat(trim), [0, 0.005, -0.015]);
  }
  return foot;
}

// A tiny indirection so the foot helper can style an extra plate without another parameter.
function armorPlateMat(mat) { return mat; }

// --------------------------------------------------------------------------- head

/**
 * Skull + face. The head is a lofted cranium with a tapered jaw, then eyes with irises, brows,
 * a nose wedge, a mouth line and ears. `style` switches the eye/face treatment between a bare
 * face (Goku) and a visor-less masked head (Iron Spider).
 */
function buildHead({
  skin, hair, eyeWhite, iris, brow, mouth, pupil = null,
  style = 'anime', width = 1, height = 1
}) {
  const head = new THREE.Group();
  head.name = 'head';
  const w = width;
  const h = height;
  // Cranium: narrow at the jaw, widest across the temples, rounded crown, flattened face.
  addMesh(head, loftGeometry([
    { y: -0.115 * h, rx: 0.052 * w, rz: 0.058 * w, front: 1.05 },
    { y: -0.075 * h, rx: 0.078 * w, rz: 0.082 * w, front: 1.05 },
    { y: -0.02 * h, rx: 0.098 * w, rz: 0.098 * w, front: 1.02, back: 1.06 },
    { y: 0.05 * h, rx: 0.108 * w, rz: 0.104 * w, front: 0.98, back: 1.08 },
    { y: 0.11 * h, rx: 0.098 * w, rz: 0.096 * w, back: 1.06 },
    { y: 0.155 * h, rx: 0.062 * w, rz: 0.062 * w }
  ], { radial: 22 }), skin, [0, 0, 0]);

  if (style === 'anime' || style === 'masked') {
    // Eyes sit slightly proud of the face so they catch a rim light.
    for (const side of [-1, 1]) {
      const eye = sphere(head, 0.021 * w, eyeWhite, [side * 0.040 * w, 0.005 * h, 0.078 * w], [1.25, 0.92, 0.55], 14);
      eye.name = `eye-${side < 0 ? 'l' : 'r'}`;
      const irisMesh = addMesh(head, new THREE.CircleGeometry(0.0115 * w, 14), iris, [side * 0.040 * w, 0.004 * h, 0.092 * w]);
      irisMesh.name = `iris-${side < 0 ? 'l' : 'r'}`;
      if (pupil) addMesh(head, new THREE.CircleGeometry(0.005 * w, 10), pupil, [side * 0.040 * w, 0.004 * h, 0.0925 * w]);
      // Brow: a short angled bar that carries most of the expression at gameplay distance.
      plate(head, [0.042 * w, 0.008 * h, 0.012 * w], 0.003, brow,
        [side * 0.041 * w, 0.035 * h, 0.086 * w], [0, 0, side * -0.22]);
    }
    // Nose and mouth are geometry, not texture: a wedge and a thin recessed bar.
    const nose = addMesh(head, new THREE.ConeGeometry(0.014 * w, 0.03 * h, 6), skin, [0, -0.012 * h, 0.092 * w], [Math.PI / 2.1, 0, 0]);
    nose.name = 'nose';
    addMesh(head, new THREE.BoxGeometry(0.032 * w, 0.006 * h, 0.008), mouth, [0, -0.062 * h, 0.086 * w]);
    for (const side of [-1, 1]) {
      const ear = sphere(head, 0.019 * w, skin, [side * 0.100 * w, -0.012 * h, -0.006 * w], [0.55, 1, 0.85], 12);
      ear.name = `ear-${side < 0 ? 'l' : 'r'}`;
    }
  }
  return head;
}

/**
 * Hair as individually shaped spikes. Each spike is a tapered cone bent by rotating it away
 * from the crown, with a per-spike length and lean, so the silhouette is a set of distinct
 * locks rather than a smooth dome.
 */
function buildHairSpikes({ mat, parent, position = [0, 0.10, 0], count = 11, length = 0.20, spread = 0.11, lift = 0.14, ringRadius = 0.075, lean = 0.35, seed = 1, names = 'hair', cap = null }) {
  const group = new THREE.Group();
  group.name = names;
  group.position.set(position[0], position[1], position[2]);
  // A hair cap closes the scalp between the locks. Without it the spikes read as a crown
  // sitting on a bare egg, which is what a cone-only hairstyle looks like at any distance.
  if (cap) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(cap.radius, 22, 14, 0, TAU, 0, cap.thetaLength ?? 1.25), mat);
    dome.name = `${names}-cap`;
    dome.position.set(0, cap.y ?? 0.03, cap.cz ?? 0);
    dome.scale.set(1, cap.squash ?? 1, cap.depth ?? 1);
    dome.castShadow = true;
    group.add(dome);
  }
  let state = seed * 9301;
  const rand = () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * TAU + rand() * 0.35;
    const radius = ringRadius * (0.55 + rand() * 0.65);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * 0.85;
    const lengthScale = length * (0.7 + rand() * 0.6);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.040 + rand() * 0.014, lengthScale, 7), mat);
    spike.position.set(x, lift * (0.35 + rand() * 0.5), z);
    // Lean outward from the crown, and sweep every lock backwards the way a wind-blown
    // anime hairstyle does, so the silhouette reads as hair and not a sea urchin.
    spike.rotation.z = -Math.cos(angle) * lean * (0.6 + rand() * 0.7);
    spike.rotation.x = Math.sin(angle) * lean * (0.5 + rand() * 0.7) + 0.22;
    if (z < -0.02) spike.rotation.x -= 0.30;
    spike.castShadow = true;
    spike.name = `${names}-spike-${i}`;
    group.add(spike);
  }
  // Fringe: three short locks over the forehead.
  for (let i = 0; i < 3; i++) {
    const fringe = new THREE.Mesh(new THREE.ConeGeometry(0.036, length * 0.55, 7), mat);
    fringe.position.set((i - 1) * 0.052, lift * 0.15, spread * 0.72);
    fringe.rotation.x = 1.15 + i * 0.06;
    fringe.rotation.z = (i - 1) * 0.2;
    fringe.castShadow = true;
    group.add(fringe);
  }
  parent.add(group);
  return group;
}

// --------------------------------------------------------------------------- shared body build

/** Material set for a fighter, cloned per instance so a form can never mutate another body. */
function palettes() {
  return {
    skin: material({ name: 'fighter-skin', color: 0xe8b48c, metalness: 0.0, roughness: 0.58, envMapIntensity: 0.65 }),
    skinShade: material({ name: 'fighter-skin-shade', color: 0xcf9670, roughness: 0.62 }),
    eyeWhite: material({ name: 'fighter-eye-white', color: 0xf6f8fb, roughness: 0.32 }),
    iris: material({ name: 'fighter-iris', color: 0x2b3a4a, roughness: 0.28, metalness: 0.1 }),
    pupil: material({ name: 'fighter-pupil', color: 0x0a0d12, roughness: 0.3 }),
    brow: material({ name: 'fighter-brow', color: 0x1b1c22, roughness: 0.7 }),
    mouth: material({ name: 'fighter-mouth', color: 0x7b3f3a, roughness: 0.6 })
  };
}

function finishBody(root, { slug, height, extra = {} }) {
  root.name = `sculpted:${slug}`;
  root.userData = {
    ...root.userData,
    rigKind: 'procedural',
    sculptedBody: slug,
    sculptedHeight: height,
    characterScale: extra.characterScale || 1,
    visualScale: extra.visualScale || extra.characterScale || 1,
    ...extra
  };
  root.traverse(node => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return root;
}

/**
 * Shared torso/limb skeleton. Offsets match the procedural rig contract exactly, so every
 * existing pose writer and clip applies without a special case.
 */
function buildSkeleton(root) {
  const pelvis = joint(root, [0, 1.02, 0]);
  // Two-stage spine: the chest pivots mid-spine instead of at the pelvis, so an arch, a fold on
  // landing and a slump are poses rather than a whole-body tilt.
  const spine = joint(pelvis, [0, 0.14, 0]);
  const torso = joint(spine, [0, 0.14, 0]);
  const neck = joint(torso, [0, 0.25, 0]);
  const head = joint(neck, [0, 0.06, 0]);
  const arms = {};
  const clavicles = {};
  const legs = {};
  // World heights with pelvis 1.02 / torso 1.30: shoulder 1.50, elbow 1.22, wrist 0.96,
  // hip 0.92, knee 0.50, ankle 0.10, crown ~1.84. That is a 7.5-head martial artist.
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right';
    // Clavicle carries the arm, so the shoulder can roll without moving the chest. World offsets
    // are preserved (0.06 + 0.125 = 0.185, 0.19 + 0.01 = 0.20), so every existing pose is unchanged.
    const clavicle = joint(torso, [side * 0.06, 0.19, 0]);
    const shoulder = joint(clavicle, [side * 0.125, 0.01, 0]);
    clavicles[key] = clavicle;
    const fore = joint(shoulder, [0, -0.28, 0]);
    const hand = joint(fore, [0, -0.26, 0]);
    arms[key] = { shoulder, fore, hand };
    const leg = joint(pelvis, [side * 0.105, -0.10, 0]);
    const shin = joint(leg, [0, -0.42, 0]);
    const foot = joint(shin, [0, -0.40, 0]);
    legs[key] = { leg, shin, foot };
  }
  return { pelvis, spine, torso, clavicles, neck, head, arms, legs };
}

/** Torso volume shared by all three bodies, with the parameter that changes per fighter. */
function buildTorsoVolume(torso, { skinMat, clothMat, width = 1, depth = 1, waist = 1, bulk = 1 }) {
  // Chest and abdomen: wide at the deltoids, a real waist, then hips flaring into the pelvis.
  addMesh(torso, loftGeometry([
    { y: -0.26, rx: 0.128 * width * waist, rz: 0.098 * depth, back: 1.02 },
    { y: -0.18, rx: 0.140 * width * waist, rz: 0.100 * depth, front: 1.03 },
    { y: -0.08, rx: 0.152 * width, rz: 0.104 * depth, front: 1.05 },
    { y: 0.02, rx: 0.170 * width * bulk, rz: 0.112 * depth, front: 1.08 },
    { y: 0.12, rx: 0.182 * width * bulk, rz: 0.116 * depth, front: 1.10, back: 0.98 },
    { y: 0.19, rx: 0.176 * width * bulk, rz: 0.108 * depth, front: 1.04 },
    { y: 0.24, rx: 0.140 * width, rz: 0.086 * depth }
  ], { radial: 22 }), clothMat, [0, 0, 0]);
  // Pectorals and abdominal blocks give the front plane readable anatomy in silhouette.
  for (const side of [-1, 1]) {
    sphere(torso, 0.062 * width * bulk, skinMat, [side * 0.062 * width, 0.115, 0.070 * depth], [1.2, 0.72, 0.55], 14);
    for (let row = 0; row < 3; row++) {
      sphere(torso, 0.032 * width, skinMat, [side * 0.033 * width, -0.02 - row * 0.058, 0.075 * depth], [1.1, 0.8, 0.45], 10);
    }
  }
  // Trapezius wedge from the neck into the shoulders.
  plate(torso, [0.26 * width, 0.06, 0.11 * depth], 0.03, clothMat, [0, 0.205, -0.005], [0.18, 0, 0]);
}

/** Arm: deltoid, upper arm with a bicep, elbow joint, forearm tapering to the wrist. */
function buildArm(shoulder, fore, handGroup, { skinMat, clothMat, sleeveMat, side, buildHandFor, armored = false, armorMat = null, trimMat = null }) {
  sphere(shoulder, 0.062, armored ? armorMat : clothMat, [0, 0.005, 0], armored ? [1.16, 1.02, 1.06] : [1.28, 1.06, 1.10], 14);
  if (armored) {
    plate(shoulder, [0.135, 0.085, 0.14], 0.04, armorMat, [side * 0.018, 0.04, 0], [0, 0, side * -0.18]);
    plate(shoulder, [0.105, 0.03, 0.12], 0.018, trimMat, [side * 0.014, -0.006, 0], [0, 0, side * -0.12]);
  }
  addMesh(shoulder, loftGeometry([
    { y: 0.03, rx: 0.050, rz: 0.052 },
    { y: -0.06, rx: 0.053, rz: 0.053, front: 1.06 },
    { y: -0.16, rx: 0.046, rz: 0.046 },
    { y: -0.24, rx: 0.038, rz: 0.038 },
    { y: -0.28, rx: 0.035, rz: 0.035 }
  ], { radial: 16 }), armored ? armorMat : (sleeveMat || clothMat), [0, 0, 0]);
  // Elbow guard keeps the joint covered when the arm folds.
  sphere(fore, 0.041, armored ? trimMat : skinMat, [0, 0, 0], [1, 0.95, 1], 12);
  addMesh(fore, loftGeometry([
    { y: 0.0, rx: 0.039, rz: 0.039 },
    { y: -0.07, rx: 0.045, rz: 0.043, front: 1.08 },
    { y: -0.16, rx: 0.035, rz: 0.034 },
    { y: -0.26, rx: 0.027, rz: 0.027 }
  ], { radial: 16 }), armored ? armorMat : skinMat, [0, 0, 0]);
  if (armored) {
    plate(fore, [0.088, 0.13, 0.088], 0.028, trimMat, [0, -0.12, 0.01], [-0.04, 0, 0]);
  }
  // Wristband / bracer cap sits above the hand so the wrist never shows a gap.
  ring(fore, 0.035, 0.012, armored ? trimMat : (sleeveMat || clothMat), [0, -0.24, 0], [Math.PI / 2, 0, 0], 18);
  const hand = buildHandFor(handGroup);
  hand.position.y = -0.03;
  handGroup.add(hand);
  return hand;
}

/** Leg: thigh with a quad sweep, knee joint, calf with a bulge, boot. */
function buildLeg(leg, shin, foot, { skinMat, clothMat, bootMat, soleMat, trimMat, armored = false, armorMat = null, shinMat = null }) {
  addMesh(leg, loftGeometry([
    { y: 0.02, rx: 0.082, rz: 0.090 },
    { y: -0.08, rx: 0.079, rz: 0.086, front: 1.06 },
    { y: -0.20, rx: 0.069, rz: 0.076 },
    { y: -0.34, rx: 0.055, rz: 0.060 },
    { y: -0.42, rx: 0.049, rz: 0.053 }
  ], { radial: 16 }), armored ? armorMat : clothMat, [0, 0, 0]);
  if (armored) plate(leg, [0.115, 0.17, 0.11], 0.032, armorMat, [0, -0.14, 0.03], [0.03, 0, 0]);
  // Knee cap.
  sphere(shin, 0.047, armored ? trimMat : (clothMat), [0, 0.01, 0.010], [1, 0.9, 0.85], 12);
  addMesh(shin, loftGeometry([
    { y: 0.0, rx: 0.049, rz: 0.053 },
    { y: -0.09, rx: 0.053, rz: 0.060, back: 1.16 },
    { y: -0.20, rx: 0.042, rz: 0.048 },
    { y: -0.32, rx: 0.033, rz: 0.037 },
    { y: -0.40, rx: 0.030, rz: 0.033 }
  ], { radial: 16 }), armored ? armorMat : (shinMat || skinMat), [0, 0, 0]);
  if (armored) plate(shin, [0.095, 0.19, 0.085], 0.03, trimMat, [0, -0.15, 0.025], [0.02, 0, 0]);
  const boot = buildFoot({ boot: bootMat, sole: soleMat, trim: trimMat, armored });
  boot.position.set(0, 0.0, 0.0);
  foot.add(boot);
  return boot;
}

// --------------------------------------------------------------------------- GOKU

export function buildGoku({ identity = 'Goku' } = {}) {
  const root = new THREE.Group();
  const base = palettes();
  // The jacket is an open shell, so it has to render both faces.
  const gi = material({ name: 'goku-gi', color: 0xe4691f, roughness: 0.87, metalness: 0.0, side: THREE.DoubleSide });
  const giDark = material({ name: 'goku-gi-shade', color: 0xc2541a, roughness: 0.9 });
  const undershirt = material({ name: 'goku-undershirt', color: 0x23508f, roughness: 0.82 });
  const sash = material({ name: 'goku-sash', color: 0x1b3a66, roughness: 0.78 });
  const hairMat = material({ name: 'fighter-hair', color: 0x15161b, roughness: 0.46, metalness: 0.06, envMapIntensity: 0.4 });
  const bootMat = material({ name: 'goku-boot', color: 0x2a2f3b, roughness: 0.55, metalness: 0.18 });
  const soleMat = material({ name: 'goku-sole', color: 0x14171e, roughness: 0.8 });
  const accentMat = material({ name: 'fighter-accent', color: 0xffc451, emissive: 0xff9c2e, emissiveIntensity: 0.6, roughness: 0.35 });
  const wrapMat = material({ name: 'goku-wrist', color: 0x2c4f86, roughness: 0.85 });

  const sk = buildSkeleton(root);
  // ---- torso: bare chest visible through the open gi, blue undershirt, orange gi shell
  buildTorsoVolume(sk.torso, { skinMat: base.skin, clothMat: undershirt, width: 1.0, bulk: 1.02, depth: 1.0 });
  // Gi jacket: a partial loft that wraps the back and flanks and stops either side of the
  // sternum, so the blue undershirt, chest and abs stay visible through the V opening.
  addMesh(sk.torso, loftGeometry([
    { y: -0.24, rx: 0.158, rz: 0.112, front: 1.0 },
    { y: -0.12, rx: 0.168, rz: 0.116, front: 1.02 },
    { y: 0.00, rx: 0.184, rz: 0.124, front: 1.05 },
    { y: 0.12, rx: 0.190, rz: 0.122, front: 1.02 },
    { y: 0.21, rx: 0.146, rz: 0.098 }
  ], { radial: 22, from: 0.42, to: TAU - 0.42 }), gi, [0, 0, 0]);
  // The lapels: two angled bands running from the shoulders down to the sash, crossing at
  // the sternum the way a wrapped gi does.
  plate(sk.torso, [0.062, 0.40, 0.030], 0.011, giDark, [-0.058, 0.055, 0.094], [0.06, 0.24, 0.30]);
  plate(sk.torso, [0.056, 0.38, 0.028], 0.010, gi, [0.062, 0.045, 0.100], [0.05, -0.22, -0.26]);
  // Blue undershirt panel behind the lapels, so the opening shows fabric and not a hole.
  addMesh(sk.torso, loftGeometry([
    { y: -0.20, rx: 0.104, rz: 0.100 },
    { y: 0.02, rx: 0.124, rz: 0.112 },
    { y: 0.19, rx: 0.116, rz: 0.096 }
  ], { radial: 14, from: -0.62, to: 0.62 }), undershirt, [0, 0, 0]);
  // Collar and the blue undershirt showing at the neck.
  ring(sk.torso, 0.072, 0.022, giDark, [0, 0.225, 0], [Math.PI / 2.2, 0, 0], 22);
  addMesh(sk.neck, loftGeometry([
    { y: -0.04, rx: 0.052, rz: 0.052 },
    { y: 0.03, rx: 0.048, rz: 0.048 },
    { y: 0.07, rx: 0.045, rz: 0.045 }
  ], { radial: 14 }), undershirt, [0, 0, 0]);
  // Sash, knot and hanging ends.
  addMesh(sk.pelvis, loftGeometry([
    { y: 0.05, rx: 0.142, rz: 0.106 },
    { y: -0.02, rx: 0.148, rz: 0.110 },
    { y: -0.06, rx: 0.140, rz: 0.104 }
  ], { radial: 20, capTop: false, capBottom: false }), sash, [0, 0, 0]);
  plate(sk.pelvis, [0.085, 0.06, 0.05], 0.018, sash, [0.015, -0.005, 0.104], [0.1, 0, 0.2]);
  plate(sk.pelvis, [0.045, 0.22, 0.018], 0.009, sash, [-0.015, -0.15, 0.102], [0.06, 0.05, 0.05]);
  // Gi skirt panels over the hips.
  plate(sk.pelvis, [0.105, 0.19, 0.024], 0.01, gi, [-0.07, -0.13, 0.088], [0.05, 0.1, 0.06]);
  plate(sk.pelvis, [0.098, 0.18, 0.024], 0.01, gi, [0.075, -0.12, 0.08], [0.05, -0.1, -0.05]);
  plate(sk.pelvis, [0.165, 0.21, 0.022], 0.01, gi, [0, -0.14, -0.098], [-0.06, 0, 0]);

  // ---- head
  const head = buildHead({
    skin: base.skin, hair: hairMat, eyeWhite: base.eyeWhite, iris: base.iris,
    pupil: base.pupil, brow: base.brow, mouth: base.mouth, style: 'anime', width: 1.24, height: 1.16
  });
  sk.head.add(head);
  addMesh(sk.neck, loftGeometry([
    { y: 0.0, rx: 0.041, rz: 0.041 },
    { y: 0.07, rx: 0.039, rz: 0.039 }
  ], { radial: 12 }), base.skin, [0, 0, 0]);
  const baseHair = buildHairSpikes({
    mat: hairMat, parent: head, position: [0, 0.135, -0.005],
    count: 13, length: 0.155, spread: 0.13, lift: 0.085, ringRadius: 0.098, lean: 0.50, seed: 3, names: 'goku-hair-base',
    cap: { radius: 0.132, thetaLength: 1.30, y: 0.006, squash: 0.98, depth: 1.02 }
  });
  // Super Saiyan hair: a second, taller and denser spike set built as its own geometry. Hidden
  // until the form swaps to it, then the base set is hidden - a real mesh swap, not a tint.
  const ascendedHair = buildHairSpikes({
    mat: hairMat, parent: head, position: [0, 0.145, -0.01],
    count: 17, length: 0.235, spread: 0.115, lift: 0.135, ringRadius: 0.104, lean: 0.62, seed: 11, names: 'goku-hair-ascended',
    cap: { radius: 0.136, thetaLength: 1.32, y: 0.008, squash: 0.98, depth: 1.02 }
  });
  ascendedHair.visible = false;
  head.userData.hairSets = { base: baseHair, ascended: ascendedHair };

  // ---- arms
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right';
    const arm = sk.arms[key];
    buildArm(arm.shoulder, arm.fore, arm.hand, {
      skinMat: base.skin, clothMat: base.skin, sleeveMat: base.skin, side,
      buildHandFor: parent => buildHand({ skin: base.skin, glove: wrapMat, size: 1.0 })
    });
    // Blue wristbands over bare forearms (the classic look), and a gi sleeve cuff at the
    // shoulder seam so the sleeveless jacket still reads as clothing.
    ring(arm.fore, 0.038, 0.018, wrapMat, [0, -0.21, 0], [Math.PI / 2, 0, 0], 18);
    ring(arm.shoulder, 0.056, 0.017, giDark, [0, -0.055, 0], [Math.PI / 2, 0, 0], 18);
  }
  // ---- legs
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right';
    const leg = sk.legs[key];
    buildLeg(leg.leg, leg.shin, leg.foot, {
      skinMat: base.skin, clothMat: gi, shinMat: gi, bootMat, soleMat, trimMat: accentMat
    });
    // Gi trouser cuff tucked into the boot.
    ring(leg.shin, 0.047, 0.015, giDark, [0, -0.26, 0], [Math.PI / 2, 0, 0], 16);
  }

  const body = finishBody(root, {
    slug: 'goku',
    height: 2.02,
    extra: {
      identity,
      archetype: 'warrior',
      torso: sk.torso,
      pelvis: sk.pelvis,
      head: sk.head,
      neck: sk.neck,
      spine: sk.spine,
      leftClavicle: sk.clavicles.left, rightClavicle: sk.clavicles.right,
      leftArm: sk.arms.left.shoulder, leftFore: sk.arms.left.fore,
      rightArm: sk.arms.right.shoulder, rightFore: sk.arms.right.fore,
      leftLeg: sk.legs.left.leg, leftShin: sk.legs.left.shin,
      rightLeg: sk.legs.right.leg, rightShin: sk.legs.right.shin,
      leftHand: sk.arms.left.hand, rightHand: sk.arms.right.hand,
      leftFoot: sk.legs.left.foot, rightFoot: sk.legs.right.foot,
      hairSets: head.userData.hairSets,
      formVariants: { kaioken: ascendedHair },
      formSurfaces: { hair: hairMat, accent: accentMat }
    }
  });
  return body;
}

// --------------------------------------------------------------------------- IRON MAN

export function buildIronMan({ identity = 'Iron Man (Tony Stark)' } = {}) {
  const root = new THREE.Group();
  const base = palettes();
  const redArmor = material({ name: 'im-red-armor', color: 0x9e1b22, metalness: 0.62, roughness: 0.30, envMapIntensity: 1.25 });
  const redDark = material({ name: 'im-red-dark', color: 0x6d1218, metalness: 0.6, roughness: 0.38, envMapIntensity: 1.1 });
  const goldArmor = material({ name: 'im-gold-armor', color: 0xd9a63a, metalness: 0.95, roughness: 0.18, envMapIntensity: 1.5 });
  const steel = material({ name: 'im-steel', color: 0x3b414b, metalness: 0.85, roughness: 0.34, envMapIntensity: 1.2 });
  const underSuit = material({ name: 'im-undersuit', color: 0x22262e, metalness: 0.25, roughness: 0.68 });
  const glow = material({ name: 'fighter-accent', color: 0x9df4ff, emissive: 0x4fd8ff, emissiveIntensity: 2.6, metalness: 0.2, roughness: 0.25 });
  const reactorMat = material({ name: 'arc-reactor', color: 0xdcfeff, emissive: 0x86f2ff, emissiveIntensity: 2.2, metalness: 0.1, roughness: 0.18 });

  const sk = buildSkeleton(root);
  buildTorsoVolume(sk.torso, { skinMat: underSuit, clothMat: underSuit, width: 1.04, bulk: 1.10, depth: 1.02 });

  // Chest and abdominal armour: separate plates with visible gaps, not one painted shell.
  plate(sk.torso, [0.30, 0.22, 0.15], 0.05, redArmor, [0, 0.34, 0.055], [0.04, 0, 0]);
  plate(sk.torso, [0.255, 0.075, 0.135], 0.028, redDark, [0, 0.235, 0.062], [0.02, 0, 0]);
  for (let row = 0; row < 3; row++) {
    const w = 0.205 - row * 0.021;
    plate(sk.torso, [w, 0.055, 0.115], 0.02, goldArmor, [0, 0.165 - row * 0.062, 0.062 - row * 0.004], [0.02, 0, 0]);
  }
  // Back plates and thruster nozzles.
  plate(sk.torso, [0.28, 0.26, 0.10], 0.045, redArmor, [0, 0.31, -0.075], [-0.05, 0, 0]);
  for (const side of [-1, 1]) {
    const nozzle = addMesh(sk.torso, new THREE.CylinderGeometry(0.038, 0.05, 0.075, 14), steel, [side * 0.10, 0.26, -0.115], [Math.PI / 2, 0, 0]);
    nozzle.name = 'thruster';
    addMesh(sk.torso, new THREE.CircleGeometry(0.032, 16), glow, [side * 0.10, 0.26, -0.152], [0, Math.PI, 0]);
  }
  // Waist: overlapping side skirts on a jointed hip.
  for (const side of [-1, 1]) {
    plate(sk.pelvis, [0.115, 0.20, 0.115], 0.03, redArmor, [side * 0.12, -0.05, 0.03], [0, 0, side * -0.12]);
    plate(sk.pelvis, [0.09, 0.075, 0.10], 0.022, goldArmor, [side * 0.115, -0.16, 0.045]);
  }
  plate(sk.pelvis, [0.20, 0.13, 0.12], 0.03, redDark, [0, 0.02, 0.075]);

  // Helmet: skull dome, gold faceplate, jaw guard, eye slits, crest.
  const helmet = new THREE.Group();
  helmet.name = 'helmet';
  sk.head.add(helmet);
  addMesh(helmet, loftGeometry([
    { y: -0.135, rx: 0.062, rz: 0.070, front: 1.02 },
    { y: -0.085, rx: 0.088, rz: 0.098, front: 1.02, back: 1.06 },
    { y: -0.02, rx: 0.104, rz: 0.112, front: 0.98, back: 1.08 },
    { y: 0.055, rx: 0.106, rz: 0.110, back: 1.08 },
    { y: 0.115, rx: 0.092, rz: 0.094 },
    { y: 0.150, rx: 0.058, rz: 0.060 }
  ], { radial: 26 }), redArmor, [0, 0, 0]);
  // Faceplate: the gold mask covering the brow to the chin.
  const faceplate = addMesh(helmet, loftGeometry([
    { y: -0.10, rx: 0.052, rz: 0.062, front: 1.2 },
    { y: -0.055, rx: 0.070, rz: 0.072, front: 1.16 },
    { y: 0.005, rx: 0.078, rz: 0.074, front: 1.1 },
    { y: 0.048, rx: 0.070, rz: 0.066, front: 1.02 }
  ], { radial: 20, capTop: false, capBottom: false }), goldArmor, [0, -0.012, 0.046]);
  faceplate.name = 'faceplate';
  // Eye slits and the mouth vent.
  for (const side of [-1, 1]) {
    plate(helmet, [0.038, 0.014, 0.012], 0.005, glow, [side * 0.035, 0.018, 0.112], [0, side * 0.18, side * -0.12]);
  }
  plate(helmet, [0.052, 0.014, 0.01], 0.004, steel, [0, -0.058, 0.108]);
  // Crest and side pods keep the silhouette unmistakably Stark.
  plate(helmet, [0.028, 0.085, 0.10], 0.012, goldArmor, [0, 0.10, 0.03], [-0.1, 0, 0]);
  for (const side of [-1, 1]) {
    plate(helmet, [0.032, 0.05, 0.075], 0.012, steel, [side * 0.098, -0.01, -0.005]);
    plate(helmet, [0.024, 0.024, 0.024], 0.008, glow, [side * 0.108, 0.0, 0.012]);
  }
  // Arc reactor: a real housing with a ring and a lens.
  const reactor = new THREE.Group();
  reactor.name = 'arc-reactor-housing';
  sk.torso.add(reactor);
  reactor.position.set(0, 0.335, 0.132);
  addMesh(reactor, new THREE.CylinderGeometry(0.062, 0.066, 0.022, 24), steel, [0, 0, 0], [Math.PI / 2, 0, 0]);
  addMesh(reactor, new THREE.CylinderGeometry(0.044, 0.044, 0.026, 24), reactorMat, [0, 0, 0.004], [Math.PI / 2, 0, 0]).name = 'arc-reactor';
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * TAU;
    plate(reactor, [0.014, 0.014, 0.012], 0.004, goldArmor, [Math.cos(angle) * 0.053, Math.sin(angle) * 0.053, 0.002]);
  }

  // Arms: full armour with pauldron, bicep band, forearm bracer and gauntlet.
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right';
    const arm = sk.arms[key];
    buildArm(arm.shoulder, arm.fore, arm.hand, {
      skinMat: underSuit, clothMat: underSuit, sleeveMat: redArmor, side,
      armored: true, armorMat: redArmor, trimMat: goldArmor,
      buildHandFor: parent => buildHand({ skin: underSuit, armor: redArmor, glow, armored: true, size: 1.05 })
    });
    plate(arm.shoulder, [0.115, 0.075, 0.115], 0.03, goldArmor, [0, -0.24, 0.012], [0.02, 0, 0]);
    ring(arm.fore, 0.056, 0.014, steel, [0, -0.10, 0], [Math.PI / 2, 0, 0], 18);
    plate(arm.fore, [0.10, 0.09, 0.10], 0.028, goldArmor, [0, -0.28, 0.008]);
  }

  // Legs: thigh plate, knee cap, shin plate, boot shell.
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right';
    const leg = sk.legs[key];
    buildLeg(leg.leg, leg.shin, leg.foot, {
      skinMat: underSuit, clothMat: underSuit, bootMat: redArmor, soleMat: steel, trimMat: goldArmor,
      armored: true, armorMat: redArmor
    });
    plate(leg.shin, [0.10, 0.07, 0.10], 0.026, goldArmor, [0, 0.0, 0.045], [0.1, 0, 0]);
    plate(leg.foot, [0.115, 0.05, 0.10], 0.02, goldArmor, [0, 0.03, 0.06]);
    // Repulsor in the boot sole for the flight kick.
    addMesh(leg.foot, new THREE.CircleGeometry(0.036, 16), glow, [0, -0.128, 0.05], [-Math.PI / 2, 0, 0]);
  }

  return finishBody(root, {
    slug: 'iron_man_tony_stark',
    height: 2.06,
    extra: {
      identity,
      archetype: 'cyborg',
      torso: sk.torso,
      pelvis: sk.pelvis,
      head: sk.head,
      neck: sk.neck,
      spine: sk.spine,
      leftClavicle: sk.clavicles.left, rightClavicle: sk.clavicles.right,
      leftArm: sk.arms.left.shoulder, leftFore: sk.arms.left.fore,
      rightArm: sk.arms.right.shoulder, rightFore: sk.arms.right.fore,
      leftLeg: sk.legs.left.leg, leftShin: sk.legs.left.shin,
      rightLeg: sk.legs.right.leg, rightShin: sk.legs.right.shin,
      leftHand: sk.arms.left.hand, rightHand: sk.arms.right.hand,
      leftFoot: sk.legs.left.foot, rightFoot: sk.legs.right.foot,
      reactor,
      formSurfaces: { reactor: reactorMat, accent: glow }
    }
  });
}

// --------------------------------------------------------------------------- IRON SPIDER

export function buildIronSpider({ identity = 'Iron Spider' } = {}) {
  const root = new THREE.Group();
  const base = palettes();
  const suitRed = material({ name: 'is-suit-red', color: 0xa8161d, metalness: 0.30, roughness: 0.42, envMapIntensity: 1.1 });
  const suitDark = material({ name: 'is-suit-dark', color: 0x5c0d12, metalness: 0.35, roughness: 0.46 });
  const gold = material({ name: 'is-gold', color: 0xe0ae3c, metalness: 0.92, roughness: 0.20, envMapIntensity: 1.4 });
  const lens = material({ name: 'is-lens', color: 0xf7f4e6, emissive: 0xfff0bd, emissiveIntensity: 0.85, metalness: 0.25, roughness: 0.22 });
  const glow = material({ name: 'fighter-accent', color: 0xffd76a, emissive: 0xffb63c, emissiveIntensity: 1.8, metalness: 0.3, roughness: 0.28 });
  const webSeam = material({ name: 'is-seam', color: 0x1a1013, metalness: 0.2, roughness: 0.6 });

  const sk = buildSkeleton(root);
  buildTorsoVolume(sk.torso, { skinMat: suitRed, clothMat: suitRed, width: 0.99, bulk: 1.04, depth: 1.0 });

  // Suit panels: gold sternum strip, chest plates and raised seam lines.
  plate(sk.torso, [0.075, 0.30, 0.055], 0.02, gold, [0, 0.30, 0.105], [0.02, 0, 0]);
  for (const side of [-1, 1]) {
    plate(sk.torso, [0.10, 0.20, 0.05], 0.02, suitDark, [side * 0.09, 0.31, 0.10], [0.03, side * 0.08, side * 0.06]);
    plate(sk.torso, [0.075, 0.14, 0.045], 0.018, suitRed, [side * 0.10, 0.13, 0.098], [0.02, 0, side * -0.05]);
    // Shoulder seams angle down from the collar.
    plate(sk.torso, [0.015, 0.24, 0.02], 0.006, webSeam, [side * 0.115, 0.36, 0.085], [0, side * 0.3, side * 0.35]);
  }
  // Spider emblem: body plus eight legs, raised off the chest so it catches light.
  const emblem = new THREE.Group();
  emblem.name = 'spider-emblem';
  sk.torso.add(emblem);
  emblem.position.set(0, 0.33, 0.118);
  sphere(emblem, 0.028, gold, [0, 0.01, 0], [0.85, 1.35, 0.5], 12);
  sphere(emblem, 0.017, gold, [0, -0.028, 0], [0.8, 0.9, 0.5], 10);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const angle = -0.5 + i * 0.42;
      const leg = plate(emblem, [0.012, 0.085 - i * 0.008, 0.012], 0.004, gold,
        [side * (0.032 + i * 0.008), 0.012 - i * 0.018, 0], [0, 0, side * (0.7 + angle)]);
      leg.name = `emblem-leg-${side}-${i}`;
    }
  }
  // Waist plates and belt line.
  addMesh(sk.pelvis, loftGeometry([
    { y: 0.04, rx: 0.160, rz: 0.118 },
    { y: -0.02, rx: 0.166, rz: 0.122 },
    { y: -0.07, rx: 0.158, rz: 0.116 }
  ], { radial: 22, capTop: false, capBottom: false }), gold, [0, 0.01, 0]);

  // Masked head: lenses instead of eyes, gold brow trim, suit seams.
  const masked = new THREE.Group();
  masked.name = 'mask';
  sk.head.add(masked);
  buildHeadInto(masked, { skin: suitRed, eyeWhite: lens, iris: lens, brow: gold, mouth: suitDark, style: 'masked', width: 1.0, height: 1.0 });
  for (const side of [-1, 1]) {
    // Angular lens rims read at gameplay distance.
    plate(masked, [0.058, 0.030, 0.014], 0.01, webSeam, [side * 0.040, 0.006, 0.084], [0, side * 0.2, side * -0.18]);
    plate(masked, [0.048, 0.020, 0.012], 0.006, lens, [side * 0.040, 0.006, 0.090], [0, side * 0.2, side * -0.18]);
    plate(masked, [0.012, 0.10, 0.012], 0.004, suitDark, [side * 0.055, -0.02, 0.075], [0, 0, side * 0.25]);
  }
  plate(masked, [0.05, 0.012, 0.012], 0.004, gold, [0, 0.086, 0.088], [0.2, 0, 0]);

  // Arms and legs in the suit, with gold cuffs.
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right';
    const arm = sk.arms[key];
    buildArm(arm.shoulder, arm.fore, arm.hand, {
      skinMat: suitRed, clothMat: suitRed, sleeveMat: suitRed, side,
      buildHandFor: parent => buildHand({ skin: suitRed, glove: suitDark, size: 1.0 })
    });
    ring(arm.fore, 0.048, 0.014, gold, [0, -0.30, 0], [Math.PI / 2, 0, 0], 18);
    // Web shooters on the wrists.
    plate(arm.fore, [0.045, 0.05, 0.05], 0.012, gold, [0, -0.24, 0.038]);
  }
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right';
    const leg = sk.legs[key];
    buildLeg(leg.leg, leg.shin, leg.foot, {
      skinMat: suitRed, clothMat: suitRed, bootMat: suitRed, soleMat: suitDark, trimMat: gold
    });
    ring(leg.shin, 0.055, 0.014, gold, [0, -0.30, 0], [Math.PI / 2, 0, 0], 18);
  }

  // The four mechanical appendages are part of the authored body, mounted on the same rig the
  // prefab path uses, so the leg attack poses and tip positions drive real articulated limbs.
  attachSpiderLegs(root);

  return finishBody(root, {
    slug: 'iron_spider',
    height: 2.03,
    extra: {
      identity,
      archetype: 'cyborg',
      torso: sk.torso,
      pelvis: sk.pelvis,
      head: sk.head,
      neck: sk.neck,
      spine: sk.spine,
      leftClavicle: sk.clavicles.left, rightClavicle: sk.clavicles.right,
      leftArm: sk.arms.left.shoulder, leftFore: sk.arms.left.fore,
      rightArm: sk.arms.right.shoulder, rightFore: sk.arms.right.fore,
      leftLeg: sk.legs.left.leg, leftShin: sk.legs.left.shin,
      rightLeg: sk.legs.right.leg, rightShin: sk.legs.right.shin,
      leftHand: sk.arms.left.hand, rightHand: sk.arms.right.hand,
      leftFoot: sk.legs.left.foot, rightFoot: sk.legs.right.foot,
      formSurfaces: { appendage: glow, accent: glow }
    }
  });
}

/** buildHead() writes into its own group; this lets a caller supply the parent (masked heads). */
function buildHeadInto(parent, options) {
  const head = buildHead(options);
  // Re-anchor: buildHead positions features around y=0, which is already the head joint.
  parent.add(head);
  return head;
}

// --------------------------------------------------------------------------- registry

export const SCULPTED_FIGHTERS = Object.freeze({
  goku: buildGoku,
  iron_man_tony_stark: buildIronMan,
  iron_spider: buildIronSpider
});

/** True when this identity has an authored body instead of a prefab/primitive assembly. */
export function hasSculptedFighter(slug) {
  return Object.prototype.hasOwnProperty.call(SCULPTED_FIGHTERS, String(slug || ''));
}

/** Build the authored body for a slug, or null when there is none. */
export function createSculptedFighter(slug, options = {}) {
  const factory = SCULPTED_FIGHTERS[String(slug || '')];
  if (!factory) return null;
  return factory(options);
}

/** Metrics for the asset report and tests. */
export function describeSculptedFighter(root) {
  if (!root?.traverse) return null;
  let meshes = 0;
  let triangles = 0;
  const materials = new Set();
  root.traverse(node => {
    if (!node.isMesh) return;
    meshes++;
    const geometry = node.geometry;
    if (geometry?.index) triangles += geometry.index.count / 3;
    else if (geometry?.attributes?.position) triangles += geometry.attributes.position.count / 3;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of list) if (mat) materials.add(mat.name || mat.uuid);
  });
  return {
    slug: root.userData.sculptedBody || null,
    meshes,
    triangles: Math.round(triangles),
    materials: materials.size,
    joints: ['pelvis', 'torso', 'head', 'leftArm', 'rightArm', 'leftFore', 'rightFore', 'leftLeg', 'rightLeg', 'leftShin', 'rightShin']
      .filter(name => Boolean(root.userData?.[name])).length,
    fingers: (() => {
      let count = 0;
      root.traverse(node => { if (/^finger-|^thumb/.test(node.name || '')) count++; });
      return count;
    })(),
    hairSets: root.userData?.hairSets
      ? Object.entries(root.userData.hairSets).map(([key, group]) => ({ key, visible: Boolean(group?.visible), spikes: group?.children?.length || 0 }))
      : []
  };
}
