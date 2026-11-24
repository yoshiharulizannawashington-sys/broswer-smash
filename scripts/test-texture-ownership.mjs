// Texture ownership contract: a texture lives exactly as long as a model mounts it.
//
//   node scripts/test-texture-ownership.mjs
//
// The module is dependency-free on purpose, so this runs without WebGL: the fixtures are the same
// shapes Three.js exposes (a root with traverse, mesh nodes with material, maps with isTexture and
// dispose), and the assertions are about what survives a swap.
import assert from 'node:assert/strict';
import {
  claimModelTextures, releaseModelTextures, markSharedTexture, textureOwnershipReport
} from '../public/js/render/texture_ownership.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

function texture(name) {
  return {
    name, isTexture: true, disposed: 0,
    dispose() { this.disposed++; }
  };
}
function model(textures) {
  const meshes = textures.map(shared => ({ isMesh: true, material: { map: shared } }));
  return { meshes, traverse(fn) { for (const mesh of this.meshes) fn(mesh); } };
}

const detailPattern = texture('weave');
markSharedTexture(detailPattern);

// 1. claiming registers ownership of every map on the model
const mapA = texture('body-a');
const bodyA = model([mapA, detailPattern]);
check('claiming a model counts its textures', claimModelTextures(bodyA) === 2);

// 2. a texture two live models mount survives one of them being released
const mapB = texture('body-b');
const sharedSuit = texture('suit');
const bodyB = model([mapB, sharedSuit]);
const bodyC = model([sharedSuit]);
claimModelTextures(bodyB);
claimModelTextures(bodyC);
releaseModelTextures(bodyB, { keep: [bodyC] });
check('a map still mounted by another body is not disposed', sharedSuit.disposed === 0);
check('a map owned only by the released body is disposed', mapB.disposed === 1);

// 3. release is idempotent and never disposes a shared pattern
releaseModelTextures(bodyA);
check('an exclusively owned body map is disposed on release', mapA.disposed === 1);
check('the generated detail pattern outlives every model', detailPattern.disposed === 0);
releaseModelTextures(bodyA);
check('releasing the same model twice is harmless', mapA.disposed === 1);

// 4. a keep list protects a texture even when ownership bookkeeping was never claimed
const untracked = texture('prefab-shared');
const prefabOld = model([untracked]);
const prefabLive = model([untracked]);
releaseModelTextures(prefabOld, { keep: [prefabLive] });
check('an unclaimed map used by a surviving body is protected by keep', untracked.disposed === 0);

// 5. an unclaimed map with no surviving user is freed with its body
const orphan = texture('prefab-only');
releaseModelTextures(model([orphan]), { keep: [prefabLive] });
check('an unclaimed map with no surviving owner is disposed', orphan.disposed === 1);

// 6. the report reflects real disposal work
const report = textureOwnershipReport();
check('the report counts claims, releases and disposals',
  report.claimed >= 5 && report.released >= 3 && report.disposed >= 3 && report.disposeCalls >= 3,
  JSON.stringify(report));

// 7. A skinned body also owns three's bone matrix texture (Skeleton.computeBoneTexture), which lives
// on the skeleton rather than in any material. Swapping bodies used to strand exactly one of these
// per selection - the real texture leak - so it must be released and unlinked from the skeleton.
const boneTexture = texture('bone-matrix');
const skeleton = { boneTexture };
const skinned = {
  nodes: [{ isMesh: true, isSkinnedMesh: true, material: {}, skeleton }],
  traverse(fn) { for (const node of this.nodes) fn(node); }
};
claimModelTextures(skinned);
const boneResult = releaseModelTextures(skinned);
check('a released skinned body disposes its bone texture', boneTexture.disposed === 1);
check('the released skeleton no longer points at a freed texture', skeleton.boneTexture === null);
check('the release result reports the bone texture it freed', boneResult.boneTextures === 1, JSON.stringify(boneResult));

// 8. A skeleton still used by a surviving body keeps its bone texture and its reference.
const keptBone = texture('bone-shared');
const keptSkeleton = { boneTexture: keptBone };
const sharedRig = {
  nodes: [{ isMesh: true, isSkinnedMesh: true, material: {}, skeleton: keptSkeleton }],
  traverse(fn) { for (const node of this.nodes) fn(node); }
};
const oldRig = {
  nodes: [{ isMesh: true, isSkinnedMesh: true, material: {}, skeleton: keptSkeleton }],
  traverse(fn) { for (const node of this.nodes) fn(node); }
};
releaseModelTextures(oldRig, { keep: [sharedRig] });
check('a bone texture used by a surviving body is not disposed', keptBone.disposed === 0);
check('a surviving skeleton keeps pointing at its live bone texture', keptSkeleton.boneTexture === keptBone);

// 9. The report accounts for bone-texture disposals.
check('the report counts released bone textures', textureOwnershipReport().boneTextures === 1,
  JSON.stringify(textureOwnershipReport()));

console.log(`\ntexture ownership: ${checks} checks passed`);
