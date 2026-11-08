// Title-only beauty camera.
//
// Every shot is authored from geometry measured in the live scene (see
// artifacts/title-beauty/landmarks.json), not from the fightable layout bounds: on Asgard the palace
// stands at z -147 while the courtyard bounds stop at z -40, so a shot derived from the arena layout
// would film an empty bridge. Each map therefore gets its own position, landmark, lens and framing
// height, and only the five large authored maps get a shot at all - procedural arenas keep the duel
// framing exactly as it was.
//
// The look target is computed, not hand-typed: `anchor` is the landmark and `ndcY` is the height in
// frame it should occupy. The title panel covers the middle of the screen, so a landmark centred in
// frame is a landmark nobody sees; aiming below it lifts it into the band above the panel while the
// foreground settles into the band below. That keeps the composition honest to the live camera
// instead of baking a target that only looked right at one window size.
//
// This camera runs only while the title/menu is on screen. A match never sees it and the duel camera
// is left untouched, so gameplay framing, follow behaviour, controls and arena bounds do not change.
import * as THREE from 'three';

export const TITLE_SHOTS = Object.freeze({
  // North up the rainbow bridge to the palace: citadel, upper wards, the keep and its gold dome.
  asgard: Object.freeze({
    position: [0, 40, -34],
    anchor: [0, 44, -147],
    fov: 42,
    ndcY: 0.76,
    why: 'the Royal keep and gold dome above the Bifrost bridge'
  }),
  // Down the Great Hall from the entrance end, lifting the far wall and gothic arches into the band.
  hogwarts: Object.freeze({
    position: [0, 5, 8],
    anchor: [0, 16, -70],
    fov: 50,
    ndcY: 0.76,
    why: 'the Great Hall side walls, arches and enchanted ceiling'
  }),
  // Inside the throne chamber, facing the circular viewport.
  deathstar: Object.freeze({
    position: [39, 4.5, -16],
    anchor: [39, 8.5, -50.6],
    fov: 50,
    ndcY: 0.76,
    why: 'the throne chamber and its circular viewport'
  }),
  // The island mountains behind the ring, which is what makes this map a place rather than a deck.
  tournament: Object.freeze({
    position: [0, 8, 26],
    anchor: [0, 30, -117],
    fov: 46,
    ndcY: 0.74,
    why: 'Papaya Island peaks above the tournament ring'
  }),
  // Along the flight deck to the Manhattan skyline.
  starktower: Object.freeze({
    position: [0, 5, 30],
    anchor: [0, 44, -112],
    fov: 44,
    ndcY: 0.76,
    why: 'the Manhattan towers beyond the 150 x 108 m flight deck'
  })
});

let state = null;
const UP = new THREE.Vector3(0, 1, 0);

/** The authored shot for a map key, or null when that map has no title composition. */
export function titleShotFor(key) {
  return TITLE_SHOTS[key] || null;
}

/**
 * Look direction that puts `anchor` at the requested height in frame.
 *
 * With the camera looking `theta` below the landmark, the landmark sits at
 * tan(theta) / tan(fov/2) in NDC, so theta follows from the requested ndcY. The rotation is about the
 * horizontal axis perpendicular to the sightline, which keeps the shot level rather than rolling it.
 */
export function lookDirectionFor(position, anchor, fov, ndcY) {
  const toAnchor = new THREE.Vector3(anchor[0], anchor[1], anchor[2])
    .sub(new THREE.Vector3(position[0], position[1], position[2]));
  const theta = Math.atan(THREE.MathUtils.clamp(ndcY, -0.9, 0.9) * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  const axis = new THREE.Vector3().crossVectors(toAnchor, UP);
  if (axis.lengthSq() < 1e-8) return toAnchor.clone().normalize();
  axis.normalize();
  return toAnchor.clone().normalize().applyAxisAngle(axis, -theta);
}

/**
 * Place the camera on the map's beauty shot. Returns the applied state, including the computed look
 * point, so a probe can assert the exact lens that was used. Null means this map has no composition.
 */
export function applyTitleCamera(camera, key) {
  const shot = TITLE_SHOTS[key];
  if (!camera || !shot) { state = null; return null; }
  const position = new THREE.Vector3(shot.position[0], shot.position[1], shot.position[2]);
  const forward = lookDirectionFor(shot.position, shot.anchor, shot.fov, shot.ndcY);
  camera.position.copy(position);
  camera.lookAt(position.clone().add(forward));
  if (Math.abs(camera.fov - shot.fov) > 0.01) {
    camera.fov = shot.fov;
    camera.updateProjectionMatrix();
  }
  const look = position.clone().addScaledVector(forward, 40);
  state = {
    active: true,
    key,
    mode: 'title',
    shot,
    lookAt: [+look.x.toFixed(2), +look.y.toFixed(2), +look.z.toFixed(2)],
    camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z, fov: camera.fov }
  };
  return state;
}

/** Current title-camera state, or an inactive record so callers never read stale values. */
export function titleCameraState() {
  return state ? { ...state } : { active: false, mode: 'title' };
}

export function clearTitleCamera() {
  state = null;
}
