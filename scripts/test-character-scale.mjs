// Character height, proportion and relative-scale gate.
//
// The old pipeline normalised every imported body to 2.05 m. This test locks in the replacement:
// every roster identity has its own target height, the authored proportions are preserved by
// uniform scaling, and combat reach/hit volumes/projectile fallbacks follow the body scale.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  CHARACTER_SCALE_PROFILES,
  AUTHORING_BASELINE_HEIGHT,
  heightProfileFor,
  heightScaleFor,
  measureCharacterHeight,
  applyHeightProfile,
  identitySlug
} from '../public/js/character_scale.js';
import { computePlacement, TARGET_FIGHTER_HEIGHT } from '../public/js/fighter_model_placement.js';
import { buildAttack, MOVES } from '../public/js/combat/move_data.js';
import { resolveProjectileOrigin } from '../public/js/combat/projectile_origin.js';

let checks = 0;
let failures = 0;
function check(name, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`ok   ${name}${detail ? ' — ' + detail : ''}`);
    return;
  }
  failures++;
  console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
}

const source = readFileSync('public/js/main.js', 'utf8');
const rosterMatch = source.match(/const allRoster=(\[.*?\]);const roster=/s);
check('the full allRoster table is readable', Boolean(rosterMatch));
const allRoster = rosterMatch ? JSON.parse(rosterMatch[1]) : [];
check('the catalogue still contains 60 identities', allRoster.length === 60, `${allRoster.length}`);
check('every identity has an explicit profile', allRoster.every(([name]) => Boolean(CHARACTER_SCALE_PROFILES[identitySlug(name)])),
  allRoster.filter(([name]) => !CHARACTER_SCALE_PROFILES[identitySlug(name)]).map(([name]) => name).join(', ') || 'all covered');

const targets = allRoster.map(([name]) => heightProfileFor(name).targetHeight);
check('the roster is not normalised to one height', new Set(targets).size > 8, `${new Set(targets).size} distinct target heights`);
check('the target-height range is visibly wide', Math.max(...targets) - Math.min(...targets) >= 1.1,
  `${Math.min(...targets).toFixed(2)}–${Math.max(...targets).toFixed(2)} m`);

const hulk = heightProfileFor('Hulk (Bruce Banner)');
const superman = heightProfileFor('Superman');
const mario = heightProfileFor('Mario');
const luigi = heightProfileFor('Luigi');
const edna = heightProfileFor('Edna Mode');
const professor = heightProfileFor('Professor X (Charles Xavier)');
const masterChief = heightProfileFor('Master Chief');
const spider = heightProfileFor('Spider-Man');
const satima = heightProfileFor('Saitama');

check('Hulk is substantially larger than Superman', hulk.targetHeight > superman.targetHeight + 0.4,
  `${hulk.targetHeight} vs ${superman.targetHeight}`);
check('Superman is larger than Mario', superman.targetHeight > mario.targetHeight,
  `${superman.targetHeight} vs ${mario.targetHeight}`);
check('Luigi is taller than Mario but still short', luigi.targetHeight > mario.targetHeight && luigi.targetHeight < 1.8,
  `${mario.targetHeight} / ${luigi.targetHeight}`);
check('Mario uses his researched 1.55 m stature', Math.abs(mario.targetHeight - 1.55) < 1e-9, `${mario.targetHeight} m`);
check('Aang uses his 1.50 m twelve-year-old stature', Math.abs(heightProfileFor('Aang').targetHeight - 1.5) < 1e-9,
  `${heightProfileFor('Aang').targetHeight} m`);
check('every profile records a reference source', Object.values(CHARACTER_SCALE_PROFILES).every(p => typeof p.source === 'string' && p.source.length > 10),
  Object.values(CHARACTER_SCALE_PROFILES).filter(p => !p.source || p.source.length <= 10).length + ' without source');
check('every profile records a reference height', Object.values(CHARACTER_SCALE_PROFILES).every(p => Number(p.referenceHeight) > 0));
check('every profile carries collision, hitbox, weapon and camera dimensions', Object.values(CHARACTER_SCALE_PROFILES).every(p =>
  Number(p.hurtboxRadius) > 0 && Number(p.hurtboxHeight) > 0 && Number(p.hitboxScale) > 0
  && Number(p.weaponScale) > 0 && Number(p.cameraHeight) > 0 && Number(p.cameraDistanceScale) > 0
  && p.groundY === 0 && p.rootY === 0 && p.proportions.uniformOnly === true));
check('no two identities share a forced universal height', new Set(Object.values(CHARACTER_SCALE_PROFILES).map(p => p.targetHeight)).size > 8,
  `${new Set(Object.values(CHARACTER_SCALE_PROFILES).map(p => p.targetHeight)).size} heights`);
check('Edna remains distinctly short', edna.targetHeight < mario.targetHeight && edna.targetHeight <= 1.35,
  `${edna.targetHeight} m`);
check('Professor X is seated rather than standing tall', professor.seated && professor.targetHeight < 1.5,
  `${professor.targetHeight} m, seated=${professor.seated}`);
check('Master Chief is large but not Hulk-sized', masterChief.targetHeight > spider.targetHeight && masterChief.targetHeight < hulk.targetHeight,
  `${masterChief.targetHeight} m`);
check('Saitama retains a normal human height', Math.abs(satima.targetHeight - 1.75) < 0.01, `${satima.targetHeight} m`);
check('the old 2.05 m constant is not the universal target', new Set(targets).size !== 1 && !targets.every(value => Math.abs(value - TARGET_FIGHTER_HEIGHT) < 1e-9));

// The authored body is always scaled uniformly: no independent axis stretch.
const authoredBody = new THREE.Group();
const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.7, 0.4), new THREE.MeshStandardMaterial());
bodyMesh.position.y = 0.85;
authoredBody.add(bodyMesh);
authoredBody.updateMatrixWorld(true);
check('authored body measures 1.70 m', Math.abs(measureCharacterHeight(authoredBody) - 1.7) < 1e-6);

const marioFighter = { identity: 'Mario', model: authoredBody };
const applied = applyHeightProfile(marioFighter, { stageScale: 1.2 });
check('Mario receives his own target height', marioFighter.height === mario.targetHeight,
  `${marioFighter.height} m`);
check('Mario is uniformly scaled, never stretched', Math.abs(authoredBody.scale.x - authoredBody.scale.y) < 1e-9 && Math.abs(authoredBody.scale.y - authoredBody.scale.z) < 1e-9,
  authoredBody.scale.toArray().map(value => value.toFixed(3)).join(', '));
check('the uniform scale is target / authored', Math.abs(authoredBody.scale.y - (mario.targetHeight / 1.7) * 1.2) < 1e-6,
  `${authoredBody.scale.y.toFixed(3)} from ${authoredBody.userData.authoredHeight} m`);
check('the stage multiplier is recorded separately', authoredBody.userData.stageScale === 1.2 && authoredBody.userData.appliedScale > 0);
check('the profile supplies Mario’s collision radius', marioFighter.hurtboxRadius === mario.bodyRadius,
  `${marioFighter.hurtboxRadius} m`);
check('the diagnostic record carries the target and scale', applied.targetHeight === mario.targetHeight
  && authoredBody.userData.targetHeight === mario.targetHeight
  && authoredBody.userData.authoredHeight > 1.6);

// Imported bodies are normalised at the root, then only the arena multiplier is applied to the
// holder. A second character scale here was the source of the old 2.05 m overwrite.
const importedRoot = new THREE.Group();
const importedMesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 0.4), new THREE.MeshStandardMaterial());
importedMesh.position.y = -1.1;
importedRoot.add(importedMesh);
importedRoot.userData.importedModel = importedRoot;
importedRoot.userData.placement = { sourceHeight: 1.8, scale: 0.9, targetHeight: 1.62, groundOffset: 0.99, yawOffset: 0 };
const importedFighter = { identity: 'Levi Ackerman', model: importedRoot };
applyHeightProfile(importedFighter, { stageScale: 0.8 });
check('an imported body keeps its normalised root scale', importedRoot.scale.x === 0.8 && importedRoot.scale.y === 0.8 && importedRoot.scale.z === 0.8,
  importedRoot.scale.toArray().map(value => value.toFixed(2)).join(', '));
check('an imported body uses its profile target, not 2.05', importedFighter.height === 1.6,
  `${importedFighter.height} m`);
check('the imported placement scale is preserved for diagnostics', importedRoot.userData.appliedScale === 0.9
  && importedRoot.userData.authoredHeight === 1.8);

// The placement helper itself must target the requested height, not an implicit global.
const bounds = new THREE.Box3(new THREE.Vector3(-0.4, 0, -0.2), new THREE.Vector3(0.4, 2.0, 0.2));
const placement = computePlacement(bounds, { targetHeight: 1.3 });
check('mount placement uses the requested target height', Math.abs(placement.scale - 0.65) < 1e-9 && placement.targetHeight === 1.3,
  `scale ${placement.scale.toFixed(2)} for target ${placement.targetHeight}`);
const feet = -bounds.min.y * placement.scale;
check('mount placement lands authored feet on the floor', Math.abs(feet) < 1e-9, `${feet}`);

// Smaller bodies must have shorter attacks and smaller hit volumes. Radius is scaled inside
// Fighter3D.spawnHitbox; reach is scaled while the attack is built.
const tallFighter = { identityKey: 'hulk_bruce_banner', archetype: 'warrior', heightScale: heightScaleFor('Hulk') };
const shortFighter = { identityKey: 'edna_mode', archetype: 'warrior', heightScale: heightScaleFor('Edna Mode') };
const tallAttack = buildAttack({ moveId: 'light1', fighter: tallFighter });
const shortAttack = buildAttack({ moveId: 'light1', fighter: shortFighter });
check('same move reaches farther for the larger body', tallAttack.reach > shortAttack.reach,
  `${tallAttack.reach.toFixed(2)} vs ${shortAttack.reach.toFixed(2)}`);
check('the attack records the body scale used', tallAttack.bodyScale > 1 && shortAttack.bodyScale < 1,
  `${tallAttack.bodyScale.toFixed(2)} / ${shortAttack.bodyScale.toFixed(2)}`);
check('the base move radius stays authored in move data', tallAttack.radius === MOVES.light1.radius,
  `${tallAttack.radius}`);

const fallback = resolveProjectileOrigin({ owner: { position: { x: 0, y: 0, z: 0 }, heightScale: 0.7 }, direction: { x: 1, z: 0 } });
check('a fallback projectile originates from the short body', fallback.usedFallback && Math.abs(fallback.point.y - 1.05) < 1e-6,
  `y ${fallback.point.y.toFixed(2)}`);
check('the fallback origin also moves forward with the body', Math.abs(fallback.point.x - 0.735) < 1e-6,
  `x ${fallback.point.x.toFixed(3)}`);

const baselineUnchanged = AUTHORING_BASELINE_HEIGHT === 2.05;
check('2.05 m is retained only as the authoring baseline', baselineUnchanged,
  `${AUTHORING_BASELINE_HEIGHT} m`);

console.log(`\n${checks - failures}/${checks} character-scale checks passed`);
if (failures) {
  console.error(`${failures} character-scale check(s) failed`);
  process.exit(1);
}
