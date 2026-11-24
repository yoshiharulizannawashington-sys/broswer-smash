// Browser-side authoring for the baked Goku face rig.
//
// This module is intentionally separate from goku_face_rig.js: the runtime layer builds live meshes
// on the mounted head, while this builder writes neutral geometry plus morph targets into the GLB.
// It takes the loaded Three module as an argument so it can run in the browser bake page without
// importing a second copy of three.
//
// The output is a Goku_BakedFaceRig group under the real Head bone. Each mesh carries a small set
// of named morph targets; animation_overlays.js resolves expressions into those weights.

const SKIN = 0xe3c2af;
const BROW = 0x2a1712;
const MOUTH = 0x4a201d;

function findHead(model) {
  let head = null;
  model.traverse(node => {
    if (!head && node?.isBone && String(node.name || '').toLowerCase() === 'head') head = node;
  });
  return head;
}

function findEye(head, side) {
  let found = null;
  head.traverse(node => {
    if (found || !node?.isBone) return;
    const name = String(node.name || '');
    const match = side === 'L'
      ? /eye[^a-z]*l(?:$|[^a-z])/i.test(name)
      : /eye[^a-z]*r(?:$|[^a-z])/i.test(name);
    if (match && !/end/i.test(name)) found = node;
  });
  return found;
}

function material(THREE, name, color, roughness = 0.6) {
  return new THREE.MeshStandardMaterial({
    name,
    color,
    roughness,
    metalness: 0,
    side: THREE.DoubleSide
  });
}

function placed(THREE, geometry, position, rotation = new THREE.Euler(), scale = new THREE.Vector3(1, 1, 1)) {
  const copy = geometry.clone();
  const matrix = new THREE.Matrix4().compose(
    position.clone(),
    new THREE.Quaternion().setFromEuler(rotation),
    scale.clone()
  );
  copy.applyMatrix4(matrix);
  return copy;
}

function almondGeometry(THREE, width, height, bulge = 0.0025, segments = 24) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.bezierCurveTo(-width * 0.24, height * 0.52, width * 0.24, height * 0.52, width / 2, 0);
  shape.bezierCurveTo(width * 0.22, -height * 0.34, -width * 0.22, -height * 0.34, -width / 2, 0);
  const geometry = new THREE.ShapeGeometry(shape, segments);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index) / (width / 2);
    const y = position.getY(index) / (height / 2);
    const dome = Math.max(0, 1 - x * x) * Math.max(0, 1 - y * y * 0.65);
    position.setZ(index, bulge * dome);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function lashRibbonGeometry(THREE, width, arch, thickness, segments = 18) {
  const positions = [];
  const indices = [];
  for (let index = 0; index <= segments; index++) {
    const t = index / segments;
    const x = (t - 0.5) * width;
    const y = Math.sin(Math.PI * t) * arch;
    const half = 0.00035 + thickness * Math.pow(Math.sin(Math.PI * t), 0.7);
    positions.push(x, y + half, 0, x, y - half, 0);
  }
  for (let index = 0; index < segments; index++) {
    const a = index * 2;
    indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function collapsed(THREE, geometry, point, factor = 0.0001) {
  const copy = geometry.clone();
  const position = copy.attributes.position;
  for (let index = 0; index < position.count; index++) {
    position.setXYZ(
      index,
      point.x + (position.getX(index) - point.x) * factor,
      point.y + (position.getY(index) - point.y) * factor,
      point.z + (position.getZ(index) - point.z) * factor
    );
  }
  position.needsUpdate = true;
  return copy;
}

function morph(THREE, base, target) {
  const basePosition = base.attributes.position;
  const targetPosition = target.attributes.position;
  if (basePosition.count !== targetPosition.count) {
    throw new Error(`morph topology mismatch: ${basePosition.count} vs ${targetPosition.count}`);
  }
  const delta = new Float32Array(basePosition.count * 3);
  for (let index = 0; index < basePosition.count; index++) {
    delta[index * 3] = targetPosition.getX(index) - basePosition.getX(index);
    delta[index * 3 + 1] = targetPosition.getY(index) - basePosition.getY(index);
    delta[index * 3 + 2] = targetPosition.getZ(index) - basePosition.getZ(index);
  }
  return new THREE.Float32BufferAttribute(delta, 3);
}

function addPart(THREE, root, {
  name,
  material: partMaterial,
  base,
  targets,
  kind,
  role
}) {
  const mesh = new THREE.Mesh(base, partMaterial);
  mesh.name = name;
  mesh.userData.gokuBakedFace = true;
  mesh.userData.facePart = kind;
  mesh.userData.expressionRole = role;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;

  const names = Object.keys(targets);
  base.morphAttributes.position = [];
  base.morphTargetsRelative = true;
  for (const targetName of names) {
    base.morphAttributes.position.push(morph(THREE, base, targets[targetName]));
  }
  mesh.morphTargetInfluences = names.map(() => 0);
  mesh.morphTargetDictionary = Object.fromEntries(names.map((targetName, index) => [targetName, index]));
  root.add(mesh);
  return mesh;
}

/**
 * Add the baked face geometry and expression morph targets to a loaded Goku scene.
 * Returns a compact report; throws when the expected skeleton or eye bones are absent.
 */
export function bakeGokuFace(THREE, model) {
  if (!model?.isObject3D) throw new Error('bakeGokuFace needs a loaded scene');
  model.updateMatrixWorld(true);
  const head = findHead(model);
  if (!head) throw new Error('Head bone not found');
  const leftEye = findEye(head, 'L');
  const rightEye = findEye(head, 'R');
  if (!leftEye || !rightEye) throw new Error('eye bones not found');

  const localEye = eye => {
    const point = new THREE.Vector3();
    eye.getWorldPosition(point);
    return head.worldToLocal(point);
  };
  const eyeL = localEye(leftEye);
  const eyeR = localEye(rightEye);
  const center = eyeL.clone().add(eyeR).multiplyScalar(0.5);
  const eyeSpan = Math.abs(eyeL.x - eyeR.x) || 0.086;
  const eyeZ = (eyeL.z + eyeR.z) * 0.5;
  const browX = eyeSpan * 0.5;
  const browY = 0.020;
  const browZ = 0.008;
  const mouthZ = 0.012;

  const old = model.getObjectByName('Goku_BakedFaceRig');
  if (old) old.removeFromParent();

  const root = new THREE.Group();
  root.name = 'Goku_BakedFaceRig';
  root.userData.gokuBakedFaceRig = true;
  root.userData.kind = 'goku-baked-morphs';
  // The runtime layer measures the same eye midpoint and seats the face at eyeZ + 0.055. The
  // baked part positions below are relative to that root, so this offset must be in the GLB too.
  root.position.set(center.x, center.y, eyeZ + 0.055);
  head.add(root);

  const browMaterial = material(THREE, 'goku-baked-brow', BROW, 0.52);
  const mouthMaterial = material(THREE, 'goku-baked-mouth', MOUTH, 0.70);
  const lidMaterial = material(THREE, 'goku-baked-blend', SKIN, 0.58);
  const lashMaterial = material(THREE, 'goku-baked-lash', BROW, 0.50);

  const parts = [];
  const browGeometry = new THREE.CapsuleGeometry(0.0030, eyeSpan * 0.34, 4, 8);
  const browPosition = side => new THREE.Vector3(side * browX, browY, browZ);
  const browRotation = side => new THREE.Euler(0, 0, Math.PI / 2 + side * 0.16);
  for (const side of [-1, 1]) {
    const label = side < 0 ? 'R' : 'L';
    const base = placed(THREE, browGeometry, browPosition(side), browRotation(side));
    const targets = {};
    // Match the runtime expression offsets at full weight. Guard is deliberately stern; hit lifts
    // the brows; victory adds a small open, confident lift.
    for (const [name, effort, tilt, lift] of [
      ['Guard', 0.44, -0.03, -0.001],
      ['Hit', 0.98, 0.10, 0.006],
      ['Victory', 0.08, 0.14, 0.007]
    ]) {
      const rotation = browRotation(side);
      rotation.z += side * (-0.20 * effort + tilt);
      const position = browPosition(side);
      position.y += lift - 0.003 * effort;
      targets[name] = placed(THREE, browGeometry, position, rotation);
    }
    addPart(THREE, root, {
      name: `Goku_BakedBrow.${label}`,
      material: browMaterial,
      base,
      targets,
      kind: 'brow',
      role: 'brow'
    });
    parts.push('brow');
  }

  const mouthLineGeometry = new THREE.CapsuleGeometry(0.0026, eyeSpan * 0.48, 4, 8);
  const mouthLineBase = placed(
    THREE, mouthLineGeometry,
    new THREE.Vector3(0, -0.038, mouthZ),
    new THREE.Euler(0, 0, Math.PI / 2)
  );
  const mouthLineInside = new THREE.Vector3(0, -0.052, -0.020);
  const mouthLineGuard = placed(
    THREE, mouthLineGeometry,
    new THREE.Vector3(0, -0.03854, mouthZ),
    new THREE.Euler(0, 0, Math.PI / 2),
    new THREE.Vector3(1, 0.90, 1)
  );
  addPart(THREE, root, {
    name: 'Goku_BakedMouthLine',
    material: mouthMaterial,
    base: mouthLineBase,
    targets: {
      Guard: mouthLineGuard,
      Hit: collapsed(THREE, mouthLineBase, mouthLineInside),
      Victory: collapsed(THREE, mouthLineBase, mouthLineInside)
    },
    kind: 'mouth',
    role: 'line'
  });
  parts.push('mouth');

  const openGeometry = new THREE.SphereGeometry(1, 12, 8);
  const openTarget = placed(
    THREE, openGeometry,
    new THREE.Vector3(0, -0.039, mouthZ),
    new THREE.Euler(),
    new THREE.Vector3(eyeSpan * 0.20, 0.016, 0.004)
  );
  addPart(THREE, root, {
    name: 'Goku_BakedMouthOpen',
    material: mouthMaterial,
    base: collapsed(THREE, openTarget, new THREE.Vector3(0, -0.055, -0.020)),
    targets: { Hit: openTarget },
    kind: 'mouth',
    role: 'open'
  });
  parts.push('mouth');

  const smileCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-eyeSpan * 0.19, 0, 0),
    new THREE.Vector3(0, -eyeSpan * 0.11, 0),
    new THREE.Vector3(eyeSpan * 0.19, 0, 0)
  );
  const smileGeometry = new THREE.TubeGeometry(smileCurve, 8, 0.0018, 4, false);
  const smileTarget = placed(
    THREE, smileGeometry,
    new THREE.Vector3(0, -0.037, 0.014),
    new THREE.Euler(),
    new THREE.Vector3(1.05, 1, 1)
  );
  addPart(THREE, root, {
    name: 'Goku_BakedMouthSmile',
    material: mouthMaterial,
    base: collapsed(THREE, smileTarget, new THREE.Vector3(0, -0.055, -0.020)),
    targets: { Victory: smileTarget },
    kind: 'mouth',
    role: 'smile'
  });
  parts.push('mouth');

  // A closed eye is an almond, not a scaled sphere. The lid target is an almond-shaped patch
  // with a slight dome; the lash is a separate curved tube riding its upper edge, in front of the
  // lid. Both start collapsed inside the head and morph in only on the Blink weight.
  const lidWidth = eyeSpan * 0.48;
  const lidHeight = 0.040;
  const lidGeometry = almondGeometry(THREE, lidWidth, lidHeight, 0.0025);
  const lashGeometry = lashRibbonGeometry(THREE, lidWidth * 0.94, 0.0105, 0.0015);
  for (const side of [-1, 1]) {
    const eye = side < 0 ? eyeL : eyeR;
    const label = side < 0 ? 'R' : 'L';
    const eyeX = eye.x - center.x;
    const inside = new THREE.Vector3(eyeX, 0.012, -0.001);

    const lidTarget = placed(
      THREE, lidGeometry,
      new THREE.Vector3(eyeX, -0.003, 0.004),
      new THREE.Euler()
    );
    addPart(THREE, root, {
      name: `Goku_BakedEyelid.${label}`,
      material: lidMaterial,
      base: collapsed(THREE, lidTarget, inside),
      targets: { Blink: lidTarget },
      kind: 'blink',
      role: 'lid'
    });
    parts.push('blink');

    const lashTarget = placed(
      THREE, lashGeometry,
      new THREE.Vector3(eyeX, -0.0015, 0.0095),
      new THREE.Euler()
    );
    addPart(THREE, root, {
      name: `Goku_BakedLash.${label}`,
      material: lashMaterial,
      base: collapsed(THREE, lashTarget, inside),
      targets: { Blink: lashTarget },
      kind: 'blink',
      role: 'lash'
    });
    parts.push('blink');
  }

  root.userData.parts = parts;
  root.userData.morphs = ['Guard', 'Hit', 'Victory', 'Blink'];
  root.userData.eyeSpan = +eyeSpan.toFixed(4);
  root.userData.eyeCenter = center.toArray().map(value => +value.toFixed(4));
  return {
    head: head.name,
    eyes: [leftEye.name, rightEye.name],
    eyeSpan: +eyeSpan.toFixed(4),
    eyeCenter: root.userData.eyeCenter,
    parts,
    morphs: root.userData.morphs,
    meshes: root.children.map(mesh => mesh.name)
  };
}
