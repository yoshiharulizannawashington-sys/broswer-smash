// Facial controls for the imported Goku body.
//
// The production GLB is baked with a Goku_BakedFaceRig morph-target group; this installer detects
// that marker and records it without adding a second layer. The runtime mesh builder below remains
// as the fallback for an unbaked source GLB: the licensed body ships only one eye/brow patch, so
// without the bake the additive overlay could move the head but had no mouth, brow or lid geometry.
// Each fallback piece is deliberately small and additive; the body's eye geometry is untouched.
import * as THREE from 'three';

const SKIN = 0xf0dfd2;
const BROW = 0x2a1712;
const MOUTH = 0x4a201d;

function faceMaterial(name, color, roughness = 0.6, extra = {}) {
  return new THREE.MeshStandardMaterial({
    name,
    color,
    roughness,
    metalness: 0,
    side: THREE.DoubleSide,
    ...extra
  });
}

function mesh(geometry, material, name, position, rotation = null) {
  const part = new THREE.Mesh(geometry, material);
  part.name = name;
  part.position.copy(position);
  if (rotation) part.rotation.set(rotation.x, rotation.y, rotation.z);
  part.castShadow = false;
  part.receiveShadow = false;
  return part;
}

function eyeBone(head, side) {
  let found = null;
  head.traverse(node => {
    if (found || !node?.isBone) return;
    const name = String(node.name || '');
    if (/end/i.test(name)) return;
    const match = side === 'L'
      ? /eye[^a-z]*l(?:$|[^a-z])/i.test(name)
      : /eye[^a-z]*r(?:$|[^a-z])/i.test(name);
    if (match) found = node;
  });
  return found;
}

/** The baked GLB writes this marker group under the Head bone. */
function bakedFaceRig(model) {
  let found = null;
  model?.traverse?.(node => {
    if (!found && node?.userData?.gokuBakedFaceRig) found = node;
  });
  return found;
}

/**
 * Resolve the face controls for a mounted Goku body once.
 *
 * A baked GLB is reported as-is. Otherwise the runtime fallback adds meshes to the imported head;
 * it returns null when this is not that head or the eye sockets cannot be found, and the caller
 * leaves the normal overlay path untouched.
 */
export function installGokuFaceRig(model, fighter = null) {
  if (!model?.userData || model.userData.gokuFaceRig) return model?.userData?.gokuFaceRig || null;
  const baked = bakedFaceRig(model);
  if (baked) {
    const parts = Array.isArray(baked.userData.parts)
      ? baked.userData.parts.slice()
      : ['brow', 'brow', 'mouth', 'mouth', 'mouth', 'blink', 'blink', 'blink', 'blink'];
    const morphs = Array.isArray(baked.userData.morphs) ? baked.userData.morphs.slice() : [];
    const report = {
      kind: 'goku-baked',
      identity: fighter?.identity || 'Goku',
      head: model.userData.head?.name || 'Head',
      root: baked.name,
      parts,
      morphs,
      baked: true,
      authored: true
    };
    model.userData.gokuFaceRig = report;
    return report;
  }
  const head = model.userData.head;
  if (!head?.isObject3D || String(head.name || '').toLowerCase() !== 'head') return null;
  const leftEye = eyeBone(head, 'L');
  const rightEye = eyeBone(head, 'R');
  if (!leftEye || !rightEye) return null;

  model.updateMatrixWorld(true);
  head.updateMatrixWorld(true);
  const localEye = eye => {
    const point = new THREE.Vector3();
    eye.getWorldPosition(point);
    return head.worldToLocal(point);
  };
  const eyeL = localEye(leftEye);
  const eyeR = localEye(rightEye);
  const center = eyeL.clone().add(eyeR).multiplyScalar(0.5);
  // The imported head's local axes are the body axes: +X is screen right, +Y is up, +Z is the
  // face normal. The eye bones are slightly asymmetric inside the sockets, so only their span and
  // midpoint are used for placement; the face plane itself stays axis-aligned.
  const eyeSpan = Math.abs(eyeL.x - eyeR.x) || 0.086;
  const eyeZ = (eyeL.z + eyeR.z) * 0.5;

  const root = new THREE.Group();
  root.name = 'Goku_FaceRig';
  root.userData.kind = 'goku-authored';
  // The eye/brow patch occupies head-local z 0.095-0.119; the skin surface reaches 0.152 at the
  // nose. Keep the authored pieces just in front of the eyes and seat the mouth on the lower face.
  root.position.set(center.x, center.y, eyeZ + 0.055);
  head.add(root);

  const browMaterial = faceMaterial('fighter-brow', BROW, 0.52);
  const mouthMaterial = faceMaterial('fighter-mouth', MOUTH, 0.70, {
    depthTest: false,
    depthWrite: false
  });
  const lidMaterial = faceMaterial('fighter-blink', SKIN, 0.58);
  const lashMaterial = faceMaterial('fighter-lash', BROW, 0.50, {
    depthTest: false,
    depthWrite: false
  });
  const browGeometry = new THREE.CapsuleGeometry(0.0030, eyeSpan * 0.34, 4, 8);
  const mouthGeometry = new THREE.CapsuleGeometry(0.0026, eyeSpan * 0.48, 4, 8);
  const lashGeometry = new THREE.BoxGeometry(eyeSpan * 0.34, 0.0032, 0.0015);
  const lidGeometry = new THREE.SphereGeometry(1, 16, 8);

  const browX = eyeSpan * 0.5;
  const browY = 0.020;
  const browZ = 0.008;
  for (const side of [-1, 1]) {
    const brow = mesh(browGeometry, browMaterial, `Goku_Brow.${side < 0 ? 'R' : 'L'}`,
      new THREE.Vector3(side * browX, browY, browZ),
      new THREE.Euler(0, 0, Math.PI / 2 + side * 0.16));
    brow.userData.facePart = 'brow';
    root.add(brow);
  }

  const mouth = mesh(mouthGeometry, mouthMaterial, 'Goku_Mouth',
    new THREE.Vector3(0, -0.038, 0.012),
    new THREE.Euler(0, 0, Math.PI / 2));
  mouth.userData.facePart = 'mouth';
  mouth.userData.expressionRole = 'line';
  mouth.renderOrder = 2;
  root.add(mouth);

  // Expression-only mouth shapes. They are hidden in the neutral pose and the overlay brings one
  // in for hit/victory, so the same authored brow/lid controls can sell three different reads.
  const openMouth = mesh(new THREE.SphereGeometry(1, 12, 8), mouthMaterial, 'Goku_MouthOpen',
    new THREE.Vector3(0, -0.040, 0.012));
  openMouth.userData.facePart = 'mouth';
  openMouth.userData.expressionRole = 'open';
  openMouth.scale.set(eyeSpan * 0.20, 0.004, 0.004);
  openMouth.visible = false;
  openMouth.renderOrder = 2;
  root.add(openMouth);

  // A quadratic curve gives the smile a real upward bow instead of rotating the straight mouth
  // line, which read as a frown from the game camera.
  const smileCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-eyeSpan * 0.19, 0, 0),
    new THREE.Vector3(0, -eyeSpan * 0.11, 0),
    new THREE.Vector3(eyeSpan * 0.19, 0, 0)
  );
  const smile = mesh(new THREE.TubeGeometry(smileCurve, 8, 0.0018, 4, false),
    mouthMaterial, 'Goku_MouthSmile', new THREE.Vector3(0, -0.036, 0.014));
  smile.userData.facePart = 'mouth';
  smile.userData.expressionRole = 'smile';
  smile.visible = false;
  smile.renderOrder = 2;
  root.add(smile);

  for (const side of [-1, 1]) {
    const eye = side < 0 ? eyeL : eyeR;
    const lid = mesh(lidGeometry, lidMaterial, `Goku_Eyelid.${side < 0 ? 'R' : 'L'}`,
      new THREE.Vector3(eye.x - center.x, 0.010, 0.002));
    lid.scale.set(eyeSpan * 0.26, 0.012, 0.004);
    lid.userData.facePart = 'blink';
    root.add(lid);
    // A separate lash line rides the same blink pulse but sits in front of the skin lid, so a
    // closed eye reads as a lid rather than a featureless oval. It is almost zero-height at rest.
    const lash = mesh(lashGeometry, lashMaterial, `Goku_Lash.${side < 0 ? 'R' : 'L'}`,
      new THREE.Vector3(eye.x - center.x, 0.006, 0.010));
    lash.userData.facePart = 'blink';
    lash.renderOrder = 3;
    root.add(lash);
  }

  const report = {
    kind: 'goku-authored',
    identity: fighter?.identity || 'Goku',
    head: head.name,
    eyes: [leftEye.name, rightEye.name],
    eyeSpan: +eyeSpan.toFixed(4),
    eyeCenter: center.toArray().map(value => +value.toFixed(4)),
    parts: ['brow', 'brow', 'mouth', 'mouth', 'mouth', 'blink', 'blink', 'blink', 'blink'],
    authored: true
  };
  model.userData.gokuFaceRig = report;
  return report;
}
