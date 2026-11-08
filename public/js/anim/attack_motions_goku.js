// Goku's attack motion vocabulary — a second authored set, not a recolour of Naruto's.
//
// Same schema as attack_motions_naruto.js: keyframes `{ t, joint: [x, y, z] }`, t in 0..1 of the
// move, deltas in radians added to the rest pose. The difference is the body mechanics:
//
//   Naruto works from a low, wide stance with big hip turns and open palms (brawler / ninja).
//   Goku works from a narrow, bouncing boxing stance: short straight punches off the lead hand,
//   deeper cross on the reverse, chambered kicks, and both hands meeting at the hip for ki.
//
// The shapes are deliberate, not cosmetic:
//   light1  lead jab: minimal hip, shoulder snaps, off hand stays glued to the cheek
//   light2  reverse cross: hip and chest fire, back heel turns, opposite shoulder drives
//   light3  roundhouse: pelvis yaws a half turn, the kick is the whole move, arms counterweight
//   light4  front teep: knee chambers high, shin snaps straight, torso leans away from the kick
//   light5  ki palm: both palms leave the hip together and drive forward as the stance drops
//   heavy   committed lunging straight: long draw behind the hip, deep front-leg lunge
//   heavyLauncher  rising knee into uppercut: knee leads, the same-side arm arcs overhead
//   heavySlam      two-hand axe handle: hands gathered overhead, then driven down past the waist
//   special        Kamehameha: cupped hands at the right hip, coil, both palms thrust, hold
//   ultimate       Spirit Bomb: both arms overhead gathering, then hurled forward with the body
//
// Amplitudes stay inside joint range: the largest single-joint values are the overhead gathers
// (-2.4 rad) and the roundhouse pelvis yaw (1.9 rad).

export const GOKU_MOTIONS = Object.freeze({
  light1: [
    { t: 0, torso: [0.04, 0.12, 0], rightArm: [-0.55, 0, -0.35], rightFore: [0, 0, 0.55], leftArm: [-0.45, 0, 0.40], leftFore: [0, 0, -0.30] },
    { t: 0.24, torso: [0.06, -0.16, 0.03], pelvis: [0, -0.08, 0], rightArm: [-1.34, 0, -0.06], rightFore: [0, 0, 0.10], leftArm: [-0.30, 0, 0.46], leftFore: [0, 0, -0.34], head: [-0.04, -0.10, 0] },
    { t: 0.42, torso: [0.04, -0.10, 0], rightArm: [-1.10, 0, -0.14], rightFore: [-0.10, 0, 0.14], leftArm: [-0.34, 0, 0.42], head: [-0.02, -0.06, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], head: [0, 0, 0] }
  ],
  light2: [
    { t: 0, torso: [0.06, -0.14, 0], pelvis: [0, -0.06, 0], leftArm: [-0.50, 0, 0.34], leftFore: [0, 0, -0.45], rightArm: [-0.40, 0, -0.40] },
    { t: 0.30, torso: [0.10, 0.48, -0.04], pelvis: [0, 0.34, 0], leftArm: [-1.58, 0, 0.04], leftFore: [0, 0, -0.06], rightArm: [-0.55, 0, -0.52], rightFore: [0, 0, 0.38], leftLeg: [-0.26, 0, 0.10], leftShin: [0.30, 0, 0], head: [-0.04, 0.22, 0] },
    { t: 0.50, torso: [0.06, 0.30, 0], leftArm: [-1.18, 0, 0.12], leftFore: [-0.16, 0, -0.10], rightArm: [-0.46, 0, -0.42], head: [0, 0.14, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  light3: [
    { t: 0, pelvis: [0, -0.16, 0], torso: [0, -0.10, 0], rightLeg: [0.20, 0, 0], leftLeg: [-0.16, 0, 0] },
    { t: 0.20, pelvis: [0, -0.70, 0.06], torso: [0.06, -0.30, 0.10], rightLeg: [-0.30, 0, -0.60], rightShin: [0.70, 0, 0], leftLeg: [-0.24, 0, 0.18], leftShin: [0.24, 0, 0], rightArm: [-0.30, 0, -0.60], leftArm: [-0.60, 0, 0.50] },
    { t: 0.33, pelvis: [0, 1.85, -0.08], torso: [0.08, 1.10, -0.14], rightLeg: [-1.15, 0, -0.28], rightShin: [0.12, 0, 0], leftLeg: [0.10, 0, 0.14], rightArm: [0.30, 0, -0.85], leftArm: [-0.70, 0, 0.75], head: [-0.06, 0.44, 0] },
    { t: 0.56, pelvis: [0, 1.35, 0], torso: [0.06, 0.80, 0], rightLeg: [-0.60, 0, -0.14], leftLeg: [0.04, 0, 0.10], rightArm: [0.10, 0, -0.50], leftArm: [-0.40, 0, 0.48], head: [-0.04, 0.26, 0] },
    { t: 1, pelvis: [0, 0, 0], torso: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightArm: [0, 0, 0], leftArm: [0, 0, 0], head: [0, 0, 0] }
  ],
  light4: [
    { t: 0, pelvis: [0.04, 0.06, 0], torso: [0.02, 0.08, 0], rightLeg: [0.12, 0, 0], leftLeg: [-0.14, 0, 0], rightArm: [-0.45, 0, -0.35], leftArm: [-0.40, 0, 0.34] },
    { t: 0.22, pelvis: [-0.24, 0.08, 0.02], torso: [-0.10, 0.06, 0], rightLeg: [-1.30, 0, -0.04], rightShin: [1.45, 0, 0], leftLeg: [0.08, 0, 0.10], leftShin: [0.30, 0, 0], rightArm: [-0.55, 0, -0.50], leftArm: [-0.60, 0, 0.50], head: [0.10, 0, 0] },
    { t: 0.38, pelvis: [-0.18, 0.06, 0], torso: [0.30, 0.04, 0], rightLeg: [-0.55, 0, -0.02], rightShin: [0.06, 0, 0], leftLeg: [-0.06, 0, 0.08], leftShin: [0.18, 0, 0], rightArm: [-0.30, 0, -0.42], leftArm: [-0.30, 0, 0.42], head: [-0.16, 0, 0] },
    { t: 1, pelvis: [0, 0, 0], torso: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightArm: [0, 0, 0], leftArm: [0, 0, 0], head: [0, 0, 0] }
  ],
  light5: [
    { t: 0, torso: [0.06, 0.26, 0], pelvis: [0, 0.14, 0], rightArm: [-0.30, 0, -0.60], rightFore: [0, 0, 0.90], leftArm: [-0.30, 0, 0.60], leftFore: [0, 0, -0.90] },
    { t: 0.20, torso: [0.14, -0.34, 0], pelvis: [0.04, -0.20, 0], rightArm: [-0.10, 0, -0.95], rightFore: [0, 0, 1.25], leftArm: [-0.10, 0, 0.95], leftFore: [0, 0, -1.25], leftLeg: [-0.28, 0, 0.12], leftShin: [0.36, 0, 0], head: [0.06, 0.18, 0] },
    { t: 0.36, torso: [-0.24, 0.18, 0], pelvis: [-0.08, 0.12, 0], rightArm: [-1.52, 0, -0.10], rightFore: [0, 0, 0.06], leftArm: [-1.45, 0, 0.14], leftFore: [0, 0, -0.06], leftLeg: [-0.44, 0, 0.14], leftShin: [0.40, 0, 0], rightLeg: [0.22, 0, -0.12], head: [-0.14, -0.06, 0] },
    { t: 0.58, torso: [-0.16, 0.10, 0], rightArm: [-1.22, 0, -0.18], leftArm: [-1.18, 0, 0.20], leftLeg: [-0.30, 0, 0.10], head: [-0.08, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], head: [0, 0, 0] }
  ],
  heavy: [
    { t: 0, torso: [0.10, 0.34, 0], pelvis: [0, 0.20, 0], rightArm: [0.35, 0, -0.45], rightFore: [0, 0, 0.45], leftArm: [-0.70, 0, 0.45] },
    { t: 0.18, torso: [0.16, 0.58, -0.05], pelvis: [0.04, 0.44, 0], rightArm: [0.55, 0, -0.55], rightFore: [0, 0, 0.65], leftArm: [-0.85, 0, 0.55], leftLeg: [-0.54, 0, 0.16], leftShin: [0.50, 0, 0], rightLeg: [0.26, 0, -0.16], rightShin: [0.30, 0, 0] },
    { t: 0.36, torso: [0.02, -0.58, 0.05], pelvis: [0.02, -0.44, 0], rightArm: [-1.86, 0, -0.04], rightFore: [0, 0, 0.02], leftArm: [0.10, 0, 0.52], leftLeg: [-0.80, 0, 0.22], leftShin: [0.62, 0, 0], rightLeg: [0.46, 0, -0.24], rightShin: [0.20, 0, 0], head: [-0.12, -0.28, 0] },
    { t: 0.60, torso: [0.06, -0.34, 0], pelvis: [0, -0.24, 0], rightArm: [-1.34, 0, -0.16], leftArm: [-0.10, 0, 0.44], leftLeg: [-0.50, 0, 0.16], leftShin: [0.38, 0, 0], rightLeg: [0.28, 0, -0.16], head: [-0.08, -0.14, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  heavyLauncher: [
    { t: 0, pelvis: [0.12, 0, 0], torso: [0.26, 0.08, 0], rightLeg: [0.16, 0, 0], rightArm: [-0.40, 0, -0.40], leftArm: [-0.40, 0, 0.40] },
    { t: 0.20, pelvis: [-0.30, 0.05, 0], torso: [0.10, 0.10, 0], rightLeg: [-1.55, 0, -0.05], rightShin: [1.30, 0, 0], leftLeg: [0.12, 0, 0.10], leftShin: [0.40, 0, 0], rightArm: [0.10, 0, -0.60], leftArm: [-0.55, 0, 0.50], head: [0.12, 0, 0] },
    { t: 0.38, pelvis: [-0.10, -0.10, 0], torso: [-0.32, -0.16, 0], rightLeg: [0.10, 0, -0.06], rightShin: [0.20, 0, 0], rightArm: [-2.35, 0, -0.10], rightFore: [0, 0, 0.06], leftArm: [-0.35, 0, 0.55], leftLeg: [-0.30, 0, 0.12], leftShin: [0.44, 0, 0], head: [-0.28, -0.06, 0] },
    { t: 0.58, torso: [-0.18, -0.06, 0], rightArm: [-1.85, 0, -0.22], rightFore: [0, 0, 0.12], head: [-0.16, 0, 0] },
    { t: 1, pelvis: [0, 0, 0], torso: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  heavySlam: [
    { t: 0, pelvis: [-0.22, 0, 0], torso: [-0.30, 0, 0], rightArm: [-2.35, 0, -0.20], leftArm: [-2.35, 0, 0.20], rightFore: [0, 0, 0.20], leftFore: [0, 0, -0.20] },
    { t: 0.20, pelvis: [-0.36, 0, 0], torso: [-0.46, 0, 0], rightArm: [-2.62, 0, -0.26], leftArm: [-2.62, 0, 0.26], head: [-0.24, 0, 0] },
    { t: 0.36, pelvis: [0.46, 0, 0], torso: [0.56, 0, 0], rightArm: [0.18, 0, -0.08], leftArm: [0.18, 0, 0.08], rightLeg: [-0.62, 0, -0.10], rightShin: [0.58, 0, 0], leftLeg: [-0.38, 0, 0.10], leftShin: [0.34, 0, 0], head: [0.32, 0, 0] },
    { t: 0.58, pelvis: [0.28, 0, 0], torso: [0.34, 0, 0], rightArm: [-0.06, 0, -0.12], leftArm: [-0.06, 0, 0.12], rightLeg: [-0.36, 0, -0.08], rightShin: [0.34, 0, 0], leftLeg: [-0.22, 0, 0.08], leftShin: [0.20, 0, 0], head: [0.16, 0, 0] },
    { t: 1, pelvis: [0, 0, 0], torso: [0, 0, 0], rightArm: [0, 0, 0], leftArm: [0, 0, 0], rightFore: [0, 0, 0], leftFore: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  special: [
    // Kamehameha. Hands cup at the right hip, the hips load, then both palms drive through the
    // target line while the torso turns into the shot - the classic two-handed thrust.
    { t: 0, torso: [0.05, 0.18, 0], pelvis: [0, 0.10, 0], rightArm: [-0.20, 0, -0.55], rightFore: [0, 0, 1.05], leftArm: [-0.20, 0, 0.55], leftFore: [0, 0, -1.05], head: [0.04, 0.10, 0] },
    { t: 0.18, torso: [0.14, -0.55, 0.05], pelvis: [0.04, -0.34, 0], rightArm: [-0.05, 0, -0.75], rightFore: [0, 0, 1.30], leftArm: [-0.10, 0, 0.90], leftFore: [0, 0, -1.20], leftLeg: [-0.34, 0, 0.16], leftShin: [0.46, 0, 0], rightLeg: [0.22, 0, -0.16], rightShin: [0.30, 0, 0], head: [0.06, 0.32, 0] },
    { t: 0.34, torso: [-0.22, 0.40, -0.04], pelvis: [-0.10, 0.26, 0], rightArm: [-1.55, 0, -0.12], rightFore: [0, 0, 0.06], leftArm: [-1.48, 0, 0.16], leftFore: [0, 0, -0.06], leftLeg: [-0.52, 0, 0.18], leftShin: [0.48, 0, 0], rightLeg: [0.30, 0, -0.20], rightShin: [0.18, 0, 0], head: [-0.12, -0.14, 0] },
    { t: 0.55, torso: [-0.26, 0.34, -0.03], rightArm: [-1.62, 0, -0.10], leftArm: [-1.56, 0, 0.12], leftLeg: [-0.44, 0, 0.14], head: [-0.10, -0.10, 0] },
    { t: 0.78, torso: [-0.06, 0.12, 0], rightArm: [-0.85, 0, -0.30], rightFore: [0, 0, 0.25], leftArm: [-0.80, 0, 0.32], head: [-0.02, -0.04, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  ultimate: [
    // Spirit Bomb: both hands gather overhead while the back arches, then the whole body throws the
    // sphere forward. Distinct from Naruto's spinning two-hand release.
    { t: 0, torso: [0.04, 0, 0], rightArm: [-0.25, 0, -0.30], leftArm: [-0.25, 0, 0.30] },
    { t: 0.18, torso: [-0.20, 0.10, 0], pelvis: [-0.12, 0, 0], rightArm: [-2.10, 0, -0.34], leftArm: [-2.10, 0, 0.34], rightFore: [0, 0, 0.45], leftFore: [0, 0, -0.45], leftLeg: [-0.40, 0, 0.18], leftShin: [0.52, 0, 0], rightLeg: [0.26, 0, -0.18], rightShin: [0.40, 0, 0], head: [-0.26, 0, 0] },
    { t: 0.32, torso: [-0.30, 0.02, 0], pelvis: [-0.18, 0, 0], rightArm: [-2.42, 0, -0.30], leftArm: [-2.42, 0, 0.30], rightFore: [0, 0, 0.55], leftFore: [0, 0, -0.55], head: [-0.34, 0, 0] },
    { t: 0.50, torso: [0.30, -0.14, 0], pelvis: [0.16, -0.10, 0], rightArm: [-1.30, 0, -0.16], leftArm: [-1.30, 0, 0.16], rightFore: [0, 0, 0.10], leftFore: [0, 0, -0.10], leftLeg: [-0.62, 0, 0.20], leftShin: [0.50, 0, 0], rightLeg: [0.40, 0, -0.22], rightShin: [0.22, 0, 0], head: [0.18, -0.04, 0] },
    { t: 0.68, torso: [0.22, -0.08, 0], rightArm: [-1.10, 0, -0.20], leftArm: [-1.10, 0, 0.20], leftLeg: [-0.46, 0, 0.14], leftShin: [0.36, 0, 0], head: [0.10, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ]
});
