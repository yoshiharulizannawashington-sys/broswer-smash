// Naruto's attack motion vocabulary — the pilot for per-fighter attack animation.
//
// The shared MOTIONS in attack_animator.js are humanoid-average: one straight punch, one reverse
// punch, one spinning kick, and the heavies all reuse a generic wind-up. Every fighter therefore
// swings the same limbs, which is why a moveset with five named lights still read as one attack
// repeated. This file is Naruto's own set: same joint channels, genuinely different motion.
//
// Each entry is a list of keyframes `{ t, joint: [x, y, z] }`, t in 0..1 of the move, deltas in
// radians added to the rest pose. Joints not named on a keyframe keep their previous value, and the
// last keyframe returns every joint it touched to zero so the pose cannot snap when the move ends.
//
// The shapes are deliberate, not cosmetic variants of one another:
//   light1  straight lead hand: hip fires first, shoulder follows, off hand stays up
//   light2  reverse cross: deeper hip rotation, opposite hand, chest opens
//   light3  spinning low kick: pelvis yaws a half turn, sweep comes from the leg, arms trail
//   light4  rising knee: shin folds tight, no arm extension at all, torso stays upright
//   light5  chakra palm thrust: both palms drive, weight drops into a lunge, head snaps forward
//   heavy   committed forward smash: long wind-up behind the hip, full shoulder turn
//   heavyLauncher  rising uppercut: arm arcs from below the waist to overhead, body lifts
//   heavySlam      overhead two-fist drive: arms start above the head and end below the waist
//   special        Rasengan: gather at the hip, step in, palm thrust, hold, recover
//   ultimate       Rasenshuriken: wide two-hand overhead gather, spin through the release

export const NARUTO_MOTIONS = Object.freeze({
  light1: [
    { t: 0, torso: [0.02, 0.30, 0], rightArm: [0.05, 0, -0.10], leftArm: [-0.20, 0, 0.30] },
    { t: 0.28, torso: [0.10, -0.34, 0.04], pelvis: [0, -0.18, 0], rightArm: [-1.42, 0, -0.06], rightFore: [0, 0, 0.04], leftArm: [-0.35, 0, 0.44], leftFore: [0, 0, -0.10], head: [-0.04, -0.18, 0] },
    { t: 0.52, torso: [0.07, -0.22, 0], pelvis: [0, -0.10, 0], rightArm: [-1.05, 0, -0.16], rightFore: [-0.16, 0, 0.06], leftArm: [-0.28, 0, 0.36], head: [-0.02, -0.10, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], head: [0, 0, 0] }
  ],
  light2: [
    { t: 0, torso: [0.04, -0.28, 0], leftArm: [0.10, 0, 0.16], rightArm: [-0.30, 0, -0.30] },
    { t: 0.30, torso: [0.12, 0.44, -0.05], pelvis: [0, 0.30, 0], leftArm: [-1.55, 0, 0.05], leftFore: [0, 0, -0.06], rightArm: [-0.70, 0, -0.46], rightFore: [0, 0, 0.10], head: [-0.05, 0.24, 0] },
    { t: 0.54, torso: [0.08, 0.26, 0], pelvis: [0, 0.16, 0], leftArm: [-1.10, 0, 0.12], leftFore: [-0.20, 0, -0.04], rightArm: [-0.52, 0, -0.34], head: [0, 0.14, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], head: [0, 0, 0] }
  ],
  light3: [
    { t: 0, torso: [0, -0.10, 0], pelvis: [0, -0.30, 0], rightLeg: [0.30, 0, 0], leftLeg: [-0.20, 0, 0] },
    { t: 0.22, torso: [0.06, -0.40, 0.12], pelvis: [0, -0.90, 0.10], rightLeg: [0.45, 0, -0.60], rightShin: [0.55, 0, 0], leftLeg: [-0.30, 0, 0.22], leftShin: [0.30, 0, 0], rightArm: [0.20, 0, -0.40], leftArm: [-0.30, 0, 0.30] },
    { t: 0.34, torso: [0.10, 1.30, -0.18], pelvis: [0, 2.05, -0.10], rightLeg: [-0.95, 0, -0.30], rightShin: [0.10, 0, 0], leftLeg: [-0.05, 0, 0.16], leftShin: [0.20, 0, 0], rightArm: [0.55, 0, -0.90], leftArm: [-0.55, 0, 0.80], head: [-0.06, 0.50, 0] },
    { t: 0.58, torso: [0.08, 1.55, 0], pelvis: [0, 1.75, 0], rightLeg: [-0.55, 0, -0.18], leftLeg: [-0.20, 0, 0.14], rightArm: [0.30, 0, -0.60], leftArm: [-0.30, 0, 0.50], head: [-0.04, 0.30, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightArm: [0, 0, 0], leftArm: [0, 0, 0], head: [0, 0, 0] }
  ],
  light4: [
    { t: 0, pelvis: [0.06, 0.10, 0], torso: [0.04, 0.12, 0], rightLeg: [0.16, 0, 0], leftLeg: [-0.18, 0, 0] },
    { t: 0.26, pelvis: [-0.26, 0.16, 0.05], torso: [0.02, 0.10, 0], rightLeg: [-1.62, 0, -0.06], rightShin: [1.15, 0, 0], leftLeg: [0.10, 0, 0.12], leftShin: [0.35, 0, 0], leftArm: [-0.60, 0, 0.50], rightArm: [-0.55, 0, -0.55], head: [0.06, 0, 0] },
    { t: 0.44, pelvis: [-0.34, 0.12, 0], torso: [-0.06, 0.06, 0], rightLeg: [-1.30, 0, -0.10], rightShin: [1.35, 0, 0], leftLeg: [0.04, 0, 0.10], leftShin: [0.28, 0, 0], leftArm: [-0.50, 0, 0.44], rightArm: [-0.45, 0, -0.48], head: [0.08, 0, 0] },
    { t: 1, pelvis: [0, 0, 0], torso: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], leftArm: [0, 0, 0], rightArm: [0, 0, 0], head: [0, 0, 0] }
  ],
  light5: [
    { t: 0, torso: [0.10, 0.40, 0], pelvis: [0, 0.20, 0], rightArm: [0.30, 0, -0.45], leftArm: [0.30, 0, 0.45] },
    { t: 0.24, torso: [0.24, 0.52, 0], pelvis: [0.10, 0.26, 0], rightArm: [0.10, 0, -0.70], rightFore: [0, 0, 0.30], leftArm: [0.10, 0, 0.70], leftFore: [0, 0, -0.30], head: [0.10, 0.20, 0] },
    { t: 0.40, torso: [-0.34, -0.10, 0], pelvis: [-0.12, -0.06, 0], rightArm: [-1.62, 0, -0.12], rightFore: [0, 0, 0.06], leftArm: [-1.50, 0, 0.18], leftFore: [0, 0, -0.06], leftLeg: [-0.34, 0, 0.14], leftShin: [0.42, 0, 0], rightLeg: [0.18, 0, -0.12], head: [-0.16, -0.04, 0] },
    { t: 0.62, torso: [-0.24, -0.06, 0], pelvis: [-0.08, -0.02, 0], rightArm: [-1.30, 0, -0.20], leftArm: [-1.20, 0, 0.24], leftLeg: [-0.22, 0, 0.12], leftShin: [0.28, 0, 0], head: [-0.10, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], head: [0, 0, 0] }
  ],
  heavy: [
    { t: 0, torso: [0.12, 0.30, 0], pelvis: [0, 0.16, 0], rightArm: [0.55, 0, -0.30], rightFore: [0, 0, 0.30] },
    { t: 0.20, torso: [0.16, 0.62, -0.06], pelvis: [0.04, 0.42, 0], rightArm: [0.80, 0, -0.40], rightFore: [0, 0, 0.55], leftArm: [-0.70, 0, 0.50], leftLeg: [-0.30, 0, 0.14], rightLeg: [0.22, 0, -0.14] },
    { t: 0.38, torso: [0.02, -0.52, 0.04], pelvis: [0.02, -0.38, 0], rightArm: [-1.68, 0, -0.05], rightFore: [0, 0, 0.02], leftArm: [0.30, 0, 0.44], leftLeg: [-0.40, 0, 0.16], leftShin: [0.34, 0, 0], rightLeg: [0.30, 0, -0.16], rightShin: [0.26, 0, 0], head: [-0.10, -0.26, 0] },
    { t: 0.62, torso: [0.06, -0.30, 0], pelvis: [0.02, -0.20, 0], rightArm: [-1.20, 0, -0.16], leftArm: [-0.10, 0, 0.40], leftLeg: [-0.24, 0, 0.12], leftShin: [0.20, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  heavyLauncher: [
    { t: 0, pelvis: [0.14, 0, 0], torso: [0.30, 0.10, 0], rightArm: [0.70, 0, -0.35], rightFore: [0, 0, 0.40] },
    { t: 0.24, pelvis: [0.34, 0, 0], torso: [0.46, 0.06, 0], rightArm: [0.95, 0, -0.40], rightFore: [0, 0, 0.70], leftArm: [0.20, 0, 0.50], leftLeg: [-0.40, 0, 0.14], leftShin: [0.70, 0, 0], rightLeg: [-0.30, 0, -0.14], rightShin: [0.60, 0, 0], head: [0.14, 0, 0] },
    { t: 0.40, pelvis: [-0.28, 0, 0], torso: [-0.34, -0.10, 0], rightArm: [-2.55, 0, -0.12], rightFore: [0, 0, 0.04], leftArm: [-0.35, 0, 0.55], leftLeg: [-0.10, 0, 0.12], leftShin: [0.10, 0, 0], rightLeg: [0.14, 0, -0.12], rightShin: [0.12, 0, 0], head: [-0.30, -0.06, 0] },
    { t: 0.58, pelvis: [-0.18, 0, 0], torso: [-0.20, -0.04, 0], rightArm: [-2.10, 0, -0.20], rightFore: [0, 0, 0.10], leftArm: [-0.20, 0, 0.40], head: [-0.18, 0, 0] },
    { t: 1, pelvis: [0, 0, 0], torso: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  heavySlam: [
    { t: 0, pelvis: [-0.20, 0, 0], torso: [-0.26, 0, 0], rightArm: [-2.45, 0, -0.22], leftArm: [-2.45, 0, 0.22], rightFore: [0, 0, 0.16], leftFore: [0, 0, -0.16], head: [-0.16, 0, 0] },
    { t: 0.22, pelvis: [-0.34, 0, 0], torso: [-0.40, 0, 0], rightArm: [-2.80, 0, -0.30], leftArm: [-2.80, 0, 0.30], head: [-0.24, 0, 0] },
    { t: 0.38, pelvis: [0.42, 0, 0], torso: [0.52, 0, 0], rightArm: [0.10, 0, -0.10], leftArm: [0.10, 0, 0.10], rightFore: [0, 0, 0.05], leftFore: [0, 0, -0.05], rightLeg: [-0.50, 0, -0.10], rightShin: [0.55, 0, 0], leftLeg: [-0.30, 0, 0.10], leftShin: [0.30, 0, 0], head: [0.30, 0, 0] },
    { t: 0.60, pelvis: [0.28, 0, 0], torso: [0.34, 0, 0], rightArm: [-0.10, 0, -0.12], leftArm: [-0.10, 0, 0.12], rightLeg: [-0.30, 0, -0.08], rightShin: [0.32, 0, 0], leftLeg: [-0.18, 0, 0.08], leftShin: [0.18, 0, 0], head: [0.16, 0, 0] },
    { t: 1, pelvis: [0, 0, 0], torso: [0, 0, 0], rightArm: [0, 0, 0], leftArm: [0, 0, 0], rightFore: [0, 0, 0], leftFore: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  special: [
    { t: 0, torso: [0.06, -0.20, 0], rightArm: [-0.50, 0, -0.30], leftArm: [-0.40, 0, 0.30] },
    { t: 0.24, torso: [0.22, 0.48, 0], pelvis: [0.10, 0.30, 0], rightArm: [0.05, 0, -0.55], rightFore: [0, 0, 1.05], leftArm: [-0.30, 0, 0.62], leftFore: [0, 0, -0.95], leftLeg: [-0.40, 0, 0.16], leftShin: [0.60, 0, 0], rightLeg: [0.24, 0, -0.16], rightShin: [0.44, 0, 0], head: [0.10, 0.28, 0] },
    { t: 0.36, torso: [0.24, 0.52, 0], pelvis: [0.12, 0.32, 0], rightArm: [0.10, 0, -0.58], rightFore: [0, 0, 1.12], leftFore: [0, 0, -1.02], head: [0.12, 0.30, 0] },
    { t: 0.50, torso: [-0.30, -0.28, 0], pelvis: [-0.08, -0.16, 0], rightArm: [-1.52, 0, -0.10], rightFore: [0, 0, 0.10], leftArm: [-0.70, 0, 0.44], leftFore: [0, 0, -0.20], leftLeg: [-0.48, 0, 0.18], leftShin: [0.46, 0, 0], rightLeg: [0.30, 0, -0.18], rightShin: [0.30, 0, 0], head: [-0.18, -0.12, 0] },
    { t: 0.70, torso: [-0.22, -0.20, 0], rightArm: [-1.48, 0, -0.12], rightFore: [0, 0, 0.08], leftArm: [-0.60, 0, 0.40], leftLeg: [-0.34, 0, 0.14], leftShin: [0.32, 0, 0], head: [-0.12, -0.08, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  // Shadow Clone Jutsu: the cross-finger seal in front of the face, then both arms sweep out as the
  // clones appear. The seal is the whole read, so it holds for two keys instead of passing through.
  shadowClone: [
    // Shadow Clone. The seal has to read as a deliberate technique, so the hands cross to a
    // two-handed sign, hold it for a beat, and then the release throws both arms out and drops the
    // stance. Gameplay spawn timing is untouched: this is motion only.
    { t: 0, torso: [0.04, 0, 0], rightArm: [-0.28, 0, -0.22], leftArm: [-0.28, 0, 0.22], head: [0.04, 0, 0] },
    // Hands meet at the chest: the seal.
    { t: 0.12, torso: [-0.06, 0, 0], rightArm: [-1.28, 0, -1.18], leftArm: [-1.28, 0, 1.18], rightFore: [0, 0, 1.30], leftFore: [0, 0, -1.30], head: [-0.06, 0, 0] },
    // Seal held, weight settling back.
    { t: 0.30, torso: [-0.12, 0, 0], pelvis: [-0.05, 0, 0], rightArm: [-1.34, 0, -1.24], leftArm: [-1.34, 0, 1.24], rightFore: [0, 0, 1.38], leftFore: [0, 0, -1.38], leftLeg: [-0.12, 0, 0.06], rightLeg: [0.10, 0, -0.06], head: [-0.08, 0, 0] },
    // Release: both arms sweep out and down, stance widens.
    { t: 0.48, torso: [0.26, 0, 0], pelvis: [0.10, 0, 0], rightArm: [-0.42, 0, -1.55], leftArm: [-0.42, 0, 1.55], rightFore: [0, 0, 0.14], leftFore: [0, 0, -0.14], leftLeg: [-0.38, 0, 0.18], leftShin: [0.40, 0, 0], rightLeg: [0.26, 0, -0.18], rightShin: [0.30, 0, 0], head: [0.20, 0, 0] },
    // Settle with the arms still open, reading as "clones are out".
    { t: 0.66, torso: [0.16, 0, 0], rightArm: [-0.50, 0, -1.20], leftArm: [-0.50, 0, 1.20], leftLeg: [-0.26, 0, 0.12], rightLeg: [0.18, 0, -0.12], head: [0.12, 0, 0] },
    { t: 0.84, torso: [0.06, 0, 0], rightArm: [-0.28, 0, -0.60], leftArm: [-0.28, 0, 0.60], head: [0.04, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], leftArm: [0, 0, 0], rightFore: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  // Rasengan: the sphere is held in the right palm at the hip, the body coils, then the whole frame
  // turns into the shove. The peak is the palm at full extension, which is the frame that has to
  // read at gameplay distance.
  rasengan: [
    // Committed Rasengan. The previous version coiled for the first third of a one-second clip and
    // produced a 0.52 arm delta - a gather, not a strike. This one spends its opening on a hard
    // wind-up, then drives the palm through with the body behind it and overshoots before settling.
    // Amplitudes stay inside joint range: largest is the driving shoulder at -2.05 rad (117 deg).
    { t: 0, torso: [0.05, -0.14, 0], pelvis: [0, -0.08, 0], rightArm: [-0.30, 0, -0.55], rightFore: [0, 0, 0.85], leftArm: [-0.45, 0, 0.40], head: [0.04, 0.12, 0] },
    // Wind-up: shoulders turn away from the target, the energy hand draws back past the hip.
    { t: 0.14, torso: [0.16, -0.58, 0.05], pelvis: [0.02, -0.34, 0], rightArm: [-0.18, 0, -1.15], rightFore: [0, 0, 1.45], leftArm: [-0.70, 0, 0.62], leftFore: [0, 0, -0.55], leftLeg: [-0.34, 0, 0.16], leftShin: [0.44, 0, 0], rightLeg: [0.22, 0, -0.16], rightShin: [0.34, 0, 0], head: [0.06, 0.34, 0] },
    // Coil held for one beat, weight loaded onto the back leg.
    { t: 0.30, torso: [0.20, -0.66, 0.06], pelvis: [0.04, -0.40, 0], rightArm: [-0.12, 0, -1.22], rightFore: [0, 0, 1.52], leftArm: [-0.78, 0, 0.70], leftFore: [0, 0, -0.60], leftLeg: [-0.40, 0, 0.18], leftShin: [0.52, 0, 0], rightLeg: [0.26, 0, -0.18], rightShin: [0.40, 0, 0], head: [0.08, 0.38, 0] },
    // Drive: hips fire first, then the shoulder, palm thrusts through the target line.
    { t: 0.50, torso: [-0.26, 0.62, -0.05], pelvis: [-0.10, 0.42, 0], rightArm: [-2.05, 0, -0.12], rightFore: [0, 0, 0.04], leftArm: [-0.30, 0, 0.22], leftFore: [0, 0, -0.06], leftLeg: [-0.60, 0, 0.20], leftShin: [0.56, 0, 0], rightLeg: [0.34, 0, -0.20], rightShin: [0.20, 0, 0], head: [-0.20, -0.20, 0] },
    // Follow-through with weight in the strike; the arm overshoots slightly past the line.
    { t: 0.64, torso: [-0.22, 0.52, -0.04], pelvis: [-0.06, 0.34, 0], rightArm: [-1.86, 0, -0.20], rightFore: [0, 0, 0.10], leftArm: [-0.40, 0, 0.28], leftLeg: [-0.50, 0, 0.16], leftShin: [0.44, 0, 0], head: [-0.14, -0.12, 0] },
    // Recovery: the body unwinds before the clip hands control back to locomotion.
    { t: 0.84, torso: [0.04, 0.16, 0], pelvis: [0, 0.10, 0], rightArm: [-0.80, 0, -0.30], rightFore: [0, 0, 0.20], leftArm: [-0.34, 0, 0.24], head: [0.02, -0.04, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  // Massive Clone Rasengan Barrage: one continuous sequence rather than a single gesture. Its keys
  // are laid out against the ultimate's own startup/active/recovery (0.56 / 1.35 / 0.62 s), so the
  // seal reads during the startup, the clones form as the active window opens, the palm drives land
  // on the barrage beats and the last pose settles in recovery. The clip is stretched to the record
  // duration by the binder, so the beats are timing-locked to the damage events, not guessed.
  ultimate: [
    // Activation: weight drops, both fists pulled to the chest.
    { t: 0, torso: [0.06, 0, 0], pelvis: [-0.04, 0, 0], rightArm: [-0.90, 0, -0.35], leftArm: [-0.90, 0, 0.35], rightFore: [0, 0, 0.80], leftFore: [0, 0, -0.80], head: [0.06, 0, 0] },
    // The clone seal: both hands meet, elbows high, head down. This is the signature read.
    { t: 0.10, torso: [-0.12, 0, 0], pelvis: [-0.08, 0, 0], rightArm: [-1.28, 0, -1.02], leftArm: [-1.28, 0, 1.02], rightFore: [0, 0, 1.42], leftFore: [0, 0, -1.42], leftLeg: [-0.16, 0, 0.08], rightLeg: [0.12, 0, -0.08], head: [-0.20, 0, 0] },
    { t: 0.22, torso: [-0.16, 0, 0], pelvis: [-0.12, 0, 0], rightArm: [-1.34, 0, -1.08], leftArm: [-1.34, 0, 1.08], rightFore: [0, 0, 1.50], leftFore: [0, 0, -1.50], head: [-0.24, 0, 0] },
    // Burst: the seal breaks and both arms sweep wide as the clones arrive beside him.
    { t: 0.32, torso: [0.26, 0, 0], pelvis: [0.10, 0, 0], rightArm: [-0.55, 0, -1.62], leftArm: [-0.55, 0, 1.62], rightFore: [0, 0, 0.16], leftFore: [0, 0, -0.16], leftLeg: [-0.40, 0, 0.20], leftShin: [0.36, 0, 0], rightLeg: [0.28, 0, -0.20], rightShin: [0.30, 0, 0], head: [0.20, 0, 0] },
    // Formation held: arms wide, chest open, the line of clones reads behind him.
    { t: 0.42, torso: [0.18, 0, 0], rightArm: [-0.95, 0, -1.45], leftArm: [-0.95, 0, 1.45], rightFore: [0, 0, 0.24], leftFore: [0, 0, -0.24], head: [0.10, 0, 0] },
    // Rasengan gather: the right palm drops back, the body coils opposite the target.
    { t: 0.54, torso: [0.18, -0.60, 0.04], pelvis: [0.04, -0.34, 0], rightArm: [-0.14, 0, -1.18], rightFore: [0, 0, 1.50], leftArm: [-0.70, 0, 0.64], leftFore: [0, 0, -0.55], leftLeg: [-0.36, 0, 0.18], leftShin: [0.48, 0, 0], rightLeg: [0.24, 0, -0.18], rightShin: [0.38, 0, 0], head: [0.08, 0.36, 0] },
    // First drive: hips, then shoulder, palm through the target line.
    { t: 0.64, torso: [-0.24, 0.60, -0.05], pelvis: [-0.08, 0.40, 0], rightArm: [-2.05, 0, -0.12], rightFore: [0, 0, 0.04], leftArm: [-0.30, 0, 0.24], leftLeg: [-0.58, 0, 0.20], leftShin: [0.54, 0, 0], rightLeg: [0.32, 0, -0.20], rightShin: [0.20, 0, 0], head: [-0.20, -0.18, 0] },
    // Second drive: the off hand takes over while the front hand recovers.
    { t: 0.74, torso: [-0.22, -0.48, 0.04], pelvis: [-0.06, -0.30, 0], rightArm: [-0.70, 0, -0.30], rightFore: [0, 0, 0.40], leftArm: [-1.95, 0, 0.14], leftFore: [0, 0, -0.06], leftLeg: [-0.34, 0, 0.14], rightLeg: [0.44, 0, -0.16], rightShin: [0.26, 0, 0], head: [-0.16, 0.18, 0] },
    // Finisher: both palms together, full extension, weight through the front leg.
    { t: 0.84, torso: [-0.30, 0.06, 0], pelvis: [-0.10, 0.04, 0], rightArm: [-1.92, 0, -0.10], leftArm: [-1.86, 0, 0.12], rightFore: [0, 0, 0.04], leftFore: [0, 0, -0.04], leftLeg: [-0.54, 0, 0.18], leftShin: [0.38, 0, 0], rightLeg: [0.40, 0, -0.18], rightShin: [0.18, 0, 0], head: [-0.24, 0, 0] },
    // Recovery: the guard returns as control comes back.
    { t: 0.93, torso: [0.04, 0, 0], rightArm: [-0.70, 0, -0.36], leftArm: [-0.66, 0, 0.34], rightFore: [0, 0, 0.45], leftFore: [0, 0, -0.42], leftLeg: [-0.20, 0, 0.08], rightLeg: [0.14, 0, -0.08], head: [0, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  // ---- signature variants -------------------------------------------------------------
  // Rasenshuriken is a throw, not a punch. The shape spends its first half gathering chakra between
  // both palms above the shoulder and its second half releasing it across the body, so it cannot be
  // confused with the Rasengan thrust at gameplay distance even in silhouette.
  rasenshuriken: [
    { t: 0, torso: [0.03, 0.10, 0], rightArm: [-0.30, 0, -0.35], leftArm: [-0.30, 0, 0.35], head: [0.03, 0, 0] },
    // Both palms meet at the chest: the windmill starts as a seal.
    { t: 0.14, torso: [-0.04, 0, 0], rightArm: [-1.30, 0, -0.95], leftArm: [-1.30, 0, 0.95], rightFore: [0, 0, 1.10], leftFore: [0, 0, -1.10], head: [-0.06, 0, 0] },
    // Gather: hands rise overhead, the chest opens, the back leg loads.
    { t: 0.30, torso: [-0.30, 0, 0], pelvis: [-0.14, 0, 0], rightArm: [-2.55, 0, -0.42], leftArm: [-2.55, 0, 0.42], rightFore: [0, 0, 0.30], leftFore: [0, 0, -0.30], leftLeg: [-0.34, 0, 0.14], leftShin: [0.46, 0, 0], rightLeg: [0.22, 0, -0.14], rightShin: [0.30, 0, 0], head: [-0.30, 0, 0] },
    // Held. The spin reads in the effects layer; the body holds the loaded pose so the throw has a beat.
    { t: 0.44, torso: [-0.34, 0, 0], pelvis: [-0.16, 0, 0], rightArm: [-2.62, 0, -0.46], leftArm: [-2.62, 0, 0.46], rightFore: [0, 0, 0.26], leftFore: [0, 0, -0.26], head: [-0.32, 0, 0] },
    // Release: hips turn first, then the throwing arm whips across the target line.
    { t: 0.60, torso: [0.16, 0.62, -0.05], pelvis: [0.06, 0.44, 0], rightArm: [-1.75, 0, -1.05], leftArm: [-0.55, 0, 0.55], rightFore: [0, 0, 0.10], leftFore: [0, 0, -0.18], leftLeg: [-0.46, 0, 0.18], leftShin: [0.40, 0, 0], rightLeg: [0.34, 0, -0.18], rightShin: [0.22, 0, 0], head: [-0.10, 0.30, 0] },
    { t: 0.74, torso: [0.10, 0.40, 0], pelvis: [0.02, 0.24, 0], rightArm: [-1.10, 0, -0.62], leftArm: [-0.42, 0, 0.40], leftLeg: [-0.30, 0, 0.12], leftShin: [0.26, 0, 0], head: [-0.04, 0.16, 0] },
    { t: 0.88, torso: [0.02, 0.12, 0], rightArm: [-0.40, 0, -0.30], leftArm: [-0.24, 0, 0.26], head: [0, 0.04, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  // Giant Rasengan: the sphere is too large for one hand, so both palms carry it overhead and drive
  // it down. That overhead two-handed arc is the difference from the one-handed Rasengan shove.
  giantRasengan: [
    { t: 0, torso: [0.04, -0.08, 0], rightArm: [-0.40, 0, -0.45], leftArm: [-0.40, 0, 0.45], rightFore: [0, 0, 0.60], leftFore: [0, 0, -0.60] },
    // Both hands gather at the chest, knees bending under the weight.
    { t: 0.16, torso: [-0.10, 0, 0], pelvis: [-0.06, 0, 0], rightArm: [-1.20, 0, -0.55], leftArm: [-1.20, 0, 0.55], rightFore: [0, 0, 1.00], leftFore: [0, 0, -1.00], leftLeg: [-0.20, 0, 0.10], leftShin: [0.30, 0, 0], rightLeg: [0.16, 0, -0.10], rightShin: [0.26, 0, 0], head: [-0.08, 0, 0] },
    // Overhead: the sphere is lifted above the head, chest arched back.
    { t: 0.32, torso: [-0.42, 0, 0], pelvis: [-0.20, 0, 0], rightArm: [-2.70, 0, -0.30], leftArm: [-2.70, 0, 0.30], rightFore: [0, 0, 0.22], leftFore: [0, 0, -0.22], leftLeg: [-0.38, 0, 0.16], leftShin: [0.54, 0, 0], rightLeg: [0.26, 0, -0.16], rightShin: [0.40, 0, 0], head: [-0.34, 0, 0] },
    { t: 0.44, torso: [-0.46, 0, 0], pelvis: [-0.22, 0, 0], rightArm: [-2.78, 0, -0.34], leftArm: [-2.78, 0, 0.34], head: [-0.36, 0, 0] },
    // Drive: the whole frame drops into the slam, hands finish low and forward.
    { t: 0.60, torso: [0.48, 0, 0], pelvis: [0.30, 0, 0], rightArm: [0.20, 0, -0.16], leftArm: [0.20, 0, 0.16], rightFore: [0, 0, 0.10], leftFore: [0, 0, -0.10], leftLeg: [-0.52, 0, 0.20], leftShin: [0.58, 0, 0], rightLeg: [-0.30, 0, -0.20], rightShin: [0.46, 0, 0], head: [0.32, 0, 0] },
    { t: 0.74, torso: [0.34, 0, 0], pelvis: [0.18, 0, 0], rightArm: [-0.10, 0, -0.20], leftArm: [-0.10, 0, 0.20], leftLeg: [-0.34, 0, 0.14], leftShin: [0.36, 0, 0], rightLeg: [-0.18, 0, -0.14], rightShin: [0.28, 0, 0], head: [0.18, 0, 0] },
    { t: 0.88, torso: [0.10, 0, 0], rightArm: [-0.30, 0, -0.24], leftArm: [-0.30, 0, 0.24], head: [0.04, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  // Grab: a two-handed reach, then a pull to the chest. Deliberately not a punch: both arms extend
  // with open shoulders and no hip rotation, so the reach reads at a glance.
  grab: [
    { t: 0, torso: [0.06, 0.10, 0], rightArm: [-0.40, 0, -0.30], leftArm: [-0.40, 0, 0.30], head: [0.04, 0, 0] },
    { t: 0.22, torso: [0.20, 0.04, 0], pelvis: [0.06, 0, 0], rightArm: [-1.62, 0, -0.14], leftArm: [-1.52, 0, 0.14], rightFore: [0, 0, 0.06], leftFore: [0, 0, -0.06], leftLeg: [-0.26, 0, 0.12], leftShin: [0.28, 0, 0], rightLeg: [0.18, 0, -0.12], head: [0.10, 0, 0] },
    // Snap closed and pull: elbows fold, weight shifts back onto the rear leg.
    { t: 0.40, torso: [-0.10, 0.02, 0], pelvis: [-0.08, 0, 0], rightArm: [-1.05, 0, -0.36], leftArm: [-1.00, 0, 0.36], rightFore: [0, 0, 0.95], leftFore: [0, 0, -0.95], leftLeg: [-0.16, 0, 0.08], leftShin: [0.22, 0, 0], rightLeg: [0.28, 0, -0.08], rightShin: [0.20, 0, 0], head: [-0.06, 0, 0] },
    { t: 0.58, torso: [-0.08, 0.02, 0], pelvis: [-0.06, 0, 0], rightArm: [-1.12, 0, -0.32], leftArm: [-1.06, 0, 0.32], rightFore: [0, 0, 0.88], leftFore: [0, 0, -0.88], head: [-0.04, 0, 0] },
    { t: 0.78, torso: [0, 0, 0], rightArm: [-0.50, 0, -0.28], leftArm: [-0.48, 0, 0.28], rightFore: [0, 0, 0.30], leftFore: [0, 0, -0.30], head: [0, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  // Throw: the release that follows the grab. Coil, then a full-body turning throw with a step.
  throw: [
    { t: 0, torso: [-0.10, 0.04, 0], rightArm: [-1.10, 0, -0.30], leftArm: [-1.05, 0, 0.30], rightFore: [0, 0, 0.90], leftFore: [0, 0, -0.90] },
    { t: 0.18, torso: [-0.20, -0.55, 0], pelvis: [-0.08, -0.30, 0], rightArm: [-0.95, 0, -0.60], leftArm: [-1.20, 0, 0.55], rightFore: [0, 0, 1.05], leftFore: [0, 0, -0.70], leftLeg: [-0.24, 0, 0.12], rightLeg: [0.22, 0, -0.12], head: [-0.06, -0.26, 0] },
    // Release across the body, hips leading.
    { t: 0.36, torso: [0.34, 0.78, -0.04], pelvis: [0.14, 0.52, 0], rightArm: [-1.90, 0, -0.05], leftArm: [-0.45, 0, 0.30], rightFore: [0, 0, 0.04], leftFore: [0, 0, -0.10], leftLeg: [-0.46, 0, 0.18], leftShin: [0.44, 0, 0], rightLeg: [0.30, 0, -0.18], rightShin: [0.24, 0, 0], head: [0.14, 0.34, 0] },
    { t: 0.54, torso: [0.26, 0.56, 0], pelvis: [0.08, 0.34, 0], rightArm: [-1.30, 0, -0.20], leftArm: [-0.38, 0, 0.28], leftLeg: [-0.32, 0, 0.14], leftShin: [0.30, 0, 0], head: [0.08, 0.20, 0] },
    { t: 0.74, torso: [0.10, 0.20, 0], rightArm: [-0.62, 0, -0.26], leftArm: [-0.30, 0, 0.26], head: [0.02, 0.06, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  // ---- transformation sequences -------------------------------------------------------
  // Each form gets its own activation arc rather than sharing a generic power-up: a seal, a body
  // change, a burst and a final pose. The gameplay window is FORM.activationLock, so the burst sits
  // just after the half-way point of every clip and the final pose lands as control returns.
  formSage: [
    { t: 0, torso: [0.04, 0, 0], rightArm: [-0.35, 0, -0.30], leftArm: [-0.35, 0, 0.30] },
    // Hands meet in front of the chest; the stance narrows and the head bows.
    { t: 0.22, torso: [-0.10, 0, 0], pelvis: [-0.04, 0, 0], rightArm: [-1.25, 0, -0.90], leftArm: [-1.25, 0, 0.90], rightFore: [0, 0, 1.15], leftFore: [0, 0, -1.15], head: [-0.16, 0, 0] },
    { t: 0.40, torso: [-0.14, 0, 0], pelvis: [-0.10, 0, 0], rightArm: [-1.30, 0, -0.95], leftArm: [-1.30, 0, 0.95], rightFore: [0, 0, 1.22], leftFore: [0, 0, -1.22], leftLeg: [-0.14, 0, 0.06], leftShin: [0.22, 0, 0], rightLeg: [0.12, 0, -0.06], rightShin: [0.18, 0, 0], head: [-0.20, 0, 0] },
    // Burst: the seal breaks, the arms open low and the chest lifts.
    { t: 0.54, torso: [0.22, 0, 0], pelvis: [0.08, 0, 0], rightArm: [-0.30, 0, -1.15], leftArm: [-0.30, 0, 1.15], rightFore: [0, 0, 0.16], leftFore: [0, 0, -0.16], leftLeg: [-0.30, 0, 0.16], leftShin: [0.26, 0, 0], rightLeg: [0.22, 0, -0.16], rightShin: [0.20, 0, 0], head: [0.18, 0, 0] },
    // Final pose: palms open, weight settled, head level. Held while control returns.
    { t: 0.72, torso: [0.06, 0, 0], rightArm: [-0.55, 0, -0.72], leftArm: [-0.55, 0, 0.72], rightFore: [0, 0, 0.28], leftFore: [0, 0, -0.28], leftLeg: [-0.18, 0, 0.10], rightLeg: [0.14, 0, -0.10], head: [0.04, 0, 0] },
    { t: 0.88, torso: [0.02, 0, 0], rightArm: [-0.30, 0, -0.50], leftArm: [-0.30, 0, 0.50], head: [0.02, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  formNine: [
    { t: 0, torso: [0.10, 0, 0], pelvis: [-0.06, 0, 0], rightArm: [-0.60, 0, -0.40], leftArm: [-0.60, 0, 0.40], rightFore: [0, 0, 0.55], leftFore: [0, 0, -0.55], head: [0.14, 0, 0] },
    // Crouch: fists drawn to the chest, shoulders hunched, head down.
    { t: 0.22, torso: [0.30, 0, 0], pelvis: [-0.24, 0, 0], rightArm: [-1.05, 0, -0.55], leftArm: [-1.05, 0, 0.55], rightFore: [0, 0, 1.30], leftFore: [0, 0, -1.30], leftLeg: [-0.34, 0, 0.14], leftShin: [0.60, 0, 0], rightLeg: [0.26, 0, -0.14], rightShin: [0.52, 0, 0], head: [0.28, 0, 0] },
    { t: 0.40, torso: [0.34, 0, 0], pelvis: [-0.28, 0, 0], rightArm: [-1.12, 0, -0.60], leftArm: [-1.12, 0, 0.60], rightFore: [0, 0, 1.38], leftFore: [0, 0, -1.38], leftLeg: [-0.38, 0, 0.16], leftShin: [0.66, 0, 0], rightLeg: [0.30, 0, -0.16], rightShin: [0.58, 0, 0], head: [0.32, 0, 0] },
    // Burst: the cloak erupts, both arms snap wide, head thrown back.
    { t: 0.54, torso: [-0.36, 0, 0], pelvis: [0.06, 0, 0], rightArm: [-1.35, 0, -1.55], leftArm: [-1.35, 0, 1.55], rightFore: [0, 0, 0.20], leftFore: [0, 0, -0.20], leftLeg: [-0.46, 0, 0.22], leftShin: [0.40, 0, 0], rightLeg: [0.34, 0, -0.22], rightShin: [0.34, 0, 0], head: [-0.34, 0, 0] },
    // Clawed guard: arms forward, fingers curled, wide stance.
    { t: 0.72, torso: [0.16, 0, 0], pelvis: [0.04, 0, 0], rightArm: [-1.55, 0, -0.62], leftArm: [-1.55, 0, 0.62], rightFore: [0, 0, 0.45], leftFore: [0, 0, -0.45], leftLeg: [-0.30, 0, 0.16], leftShin: [0.26, 0, 0], rightLeg: [0.24, 0, -0.16], rightShin: [0.22, 0, 0], head: [0.08, 0, 0] },
    { t: 0.88, torso: [0.06, 0, 0], rightArm: [-0.85, 0, -0.50], leftArm: [-0.85, 0, 0.50], rightFore: [0, 0, 0.26], leftFore: [0, 0, -0.26], head: [0.02, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  formKurama: [
    { t: 0, torso: [0.08, 0, 0], rightArm: [-0.55, 0, -0.35], leftArm: [-0.55, 0, 0.35], rightFore: [0, 0, 0.60], leftFore: [0, 0, -0.60], head: [0.08, 0, 0] },
    // Fists planted at the hips, weight sunk: the avatar link arrives from the ground up.
    { t: 0.22, torso: [0.18, 0, 0], pelvis: [-0.18, 0, 0], rightArm: [0.18, 0, -0.55], leftArm: [0.18, 0, 0.55], rightFore: [0, 0, 1.20], leftFore: [0, 0, -1.20], leftLeg: [-0.28, 0, 0.12], leftShin: [0.48, 0, 0], rightLeg: [0.22, 0, -0.12], rightShin: [0.42, 0, 0], head: [0.16, 0, 0] },
    { t: 0.40, torso: [0.22, 0, 0], pelvis: [-0.22, 0, 0], rightArm: [0.22, 0, -0.60], leftArm: [0.22, 0, 0.60], rightFore: [0, 0, 1.26], leftFore: [0, 0, -1.26], leftLeg: [-0.32, 0, 0.14], leftShin: [0.54, 0, 0], rightLeg: [0.26, 0, -0.14], rightShin: [0.48, 0, 0], head: [0.18, 0, 0] },
    // Burst: chest thrown open, both arms sweep out and up.
    { t: 0.56, torso: [-0.28, 0, 0], pelvis: [0.10, 0, 0], rightArm: [-1.10, 0, -1.45], leftArm: [-1.10, 0, 1.45], rightFore: [0, 0, 0.14], leftFore: [0, 0, -0.14], leftLeg: [-0.42, 0, 0.20], leftShin: [0.34, 0, 0], rightLeg: [0.30, 0, -0.20], rightShin: [0.30, 0, 0], head: [-0.24, 0, 0] },
    // Heavy guard: arms wide and low, shoulders square.
    { t: 0.74, torso: [0.10, 0, 0], rightArm: [-0.70, 0, -0.95], leftArm: [-0.70, 0, 0.95], rightFore: [0, 0, 0.30], leftFore: [0, 0, -0.30], leftLeg: [-0.24, 0, 0.12], rightLeg: [0.18, 0, -0.12], head: [0.06, 0, 0] },
    { t: 0.9, torso: [0.02, 0, 0], rightArm: [-0.40, 0, -0.60], leftArm: [-0.40, 0, 0.60], head: [0.02, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  formSixPaths: [
    { t: 0, torso: [0.02, 0.10, 0], rightArm: [-0.90, 0, -0.25], leftArm: [-0.60, 0, 0.40], head: [0.04, 0.10, 0] },
    // One hand lifts a truth-seeking orb overhead while the other holds at the chest.
    { t: 0.24, torso: [-0.20, 0.16, 0], pelvis: [-0.06, 0.08, 0], rightArm: [-2.45, 0, -0.30], leftArm: [-1.05, 0, 0.70], rightFore: [0, 0, 0.20], leftFore: [0, 0, -0.85], leftLeg: [-0.20, 0, 0.10], rightLeg: [0.16, 0, -0.10], head: [-0.18, 0.12, 0] },
    { t: 0.42, torso: [-0.24, 0.18, 0], pelvis: [-0.08, 0.10, 0], rightArm: [-2.55, 0, -0.34], leftArm: [-1.12, 0, 0.74], rightFore: [0, 0, 0.16], leftFore: [0, 0, -0.90], head: [-0.20, 0.14, 0] },
    // Burst: both arms sweep down and out as the form settles.
    { t: 0.56, torso: [0.20, 0, 0], pelvis: [0.06, 0, 0], rightArm: [-0.45, 0, -1.35], leftArm: [-0.45, 0, 1.35], rightFore: [0, 0, 0.12], leftFore: [0, 0, -0.12], leftLeg: [-0.34, 0, 0.18], leftShin: [0.30, 0, 0], rightLeg: [0.26, 0, -0.18], rightShin: [0.26, 0, 0], head: [0.14, 0, 0] },
    { t: 0.74, torso: [0.04, 0, 0], rightArm: [-0.62, 0, -0.80], leftArm: [-0.62, 0, 0.80], rightFore: [0, 0, 0.22], leftFore: [0, 0, -0.22], head: [0.02, 0, 0] },
    { t: 0.9, torso: [0.02, 0, 0], rightArm: [-0.34, 0, -0.55], leftArm: [-0.34, 0, 0.55], head: [0.02, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ],
  formBaryon: [
    { t: 0, torso: [0.12, 0, 0], rightArm: [-1.05, 0, -0.45], leftArm: [-1.05, 0, 0.45], rightFore: [0, 0, 1.05], leftFore: [0, 0, -1.05], head: [0.12, 0, 0] },
    // Arms crossed tight at the chest, whole body coiled inward: the form burns inward first.
    { t: 0.24, torso: [0.30, 0, 0], pelvis: [-0.20, 0, 0], rightArm: [-1.20, 0, -1.05], leftArm: [-1.20, 0, 1.05], rightFore: [0, 0, 1.45], leftFore: [0, 0, -1.45], leftLeg: [-0.24, 0, 0.10], leftShin: [0.44, 0, 0], rightLeg: [0.20, 0, -0.10], rightShin: [0.38, 0, 0], head: [0.26, 0, 0] },
    { t: 0.40, torso: [0.34, 0, 0], pelvis: [-0.24, 0, 0], rightArm: [-1.26, 0, -1.10], leftArm: [-1.26, 0, 1.10], rightFore: [0, 0, 1.52], leftFore: [0, 0, -1.52], head: [0.30, 0, 0] },
    // Burst: everything snaps outward at once, head up.
    { t: 0.54, torso: [-0.40, 0, 0], pelvis: [0.12, 0, 0], rightArm: [-1.20, 0, -1.62], leftArm: [-1.20, 0, 1.62], rightFore: [0, 0, 0.16], leftFore: [0, 0, -0.16], leftLeg: [-0.44, 0, 0.22], leftShin: [0.30, 0, 0], rightLeg: [0.32, 0, -0.22], rightShin: [0.26, 0, 0], head: [-0.36, 0, 0] },
    // Low fists, wide base, still vibrating.
    { t: 0.72, torso: [0.18, 0, 0], pelvis: [0.04, 0, 0], rightArm: [0.30, 0, -0.55], leftArm: [0.30, 0, 0.55], rightFore: [0, 0, 0.85], leftFore: [0, 0, -0.85], leftLeg: [-0.30, 0, 0.14], leftShin: [0.24, 0, 0], rightLeg: [0.24, 0, -0.14], rightShin: [0.20, 0, 0], head: [0.10, 0, 0] },
    { t: 0.88, torso: [0.06, 0, 0], rightArm: [0.05, 0, -0.40], leftArm: [0.05, 0, 0.40], rightFore: [0, 0, 0.35], leftFore: [0, 0, -0.35], head: [0.02, 0, 0] },
    { t: 1, torso: [0, 0, 0], pelvis: [0, 0, 0], rightArm: [0, 0, 0], rightFore: [0, 0, 0], leftArm: [0, 0, 0], leftFore: [0, 0, 0], leftLeg: [0, 0, 0], leftShin: [0, 0, 0], rightLeg: [0, 0, 0], rightShin: [0, 0, 0], head: [0, 0, 0] }
  ]
});
