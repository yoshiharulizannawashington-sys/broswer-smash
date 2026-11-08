// Authored attack vocabulary for the full roster.
//
// Naruto and Goku have hand-written files because their bodies deserve a bespoke read. Copying
// that approach 33 more times would create 33 files that nobody can review together. This module
// keeps the same keyframe contract but builds each set from an explicit identity profile: guard,
// lead hand, weapon family, attack arc, signature arc and ultimate arc. The generated result is
// still a normal authored motion table, so it goes through the one compiler in attack_clips.js and
// the one runtime selector in attack_animator.js. There is no second animation system.
//
// The important distinction from the shared MOTIONS table: a heavy for a sword fighter is a
// committed overhead cut, a heavy for a staff fighter is a two-handed thrust, a heavy for a
// boxer is a lunging cross, and a caster's finisher is a two-handed release. The profile also
// changes the guard, foot stance, lead side and signature/ultimate geometry, so two fighters do
// not resolve to the same sampled pose merely because they share a slot name.
//
// Keyframe schema: { t, joint: [x, y, z] }, t in 0..1 of the move, deltas in radians added to the
// rest pose. Every joint a slot touches returns to zero at t=1, so a missed cancel cannot leave a
// fighter frozen in an attack pose.

const GUARDS = Object.freeze({
  balanced: Object.freeze({
    torso: [0.04, 0.06, 0], head: [-0.03, -0.04, 0],
    leftArm: [-0.42, 0, 0.34], leftFore: [0, 0, -0.58],
    rightArm: [-0.46, 0, -0.34], rightFore: [0, 0, 0.58],
    leftLeg: [-0.06, 0, 0.04], leftShin: [0.14, 0, 0],
    rightLeg: [0.06, 0, -0.04], rightShin: [0.12, 0, 0]
  }),
  boxing: Object.freeze({
    torso: [0.06, 0.08, 0], head: [-0.04, -0.06, 0],
    leftArm: [-0.62, 0, 0.28], leftFore: [0, 0, -0.88],
    rightArm: [-0.66, 0, -0.28], rightFore: [0, 0, 0.88],
    leftLeg: [-0.10, 0, 0.06], leftShin: [0.20, 0, 0],
    rightLeg: [0.10, 0, -0.06], rightShin: [0.18, 0, 0]
  }),
  low: Object.freeze({
    torso: [0.12, 0.04, 0], head: [-0.10, -0.02, 0],
    leftArm: [-0.55, 0, 0.46], leftFore: [0, 0, -0.82],
    rightArm: [-0.58, 0, -0.46], rightFore: [0, 0, 0.82],
    leftLeg: [-0.24, 0, 0.10], leftShin: [0.42, 0, 0],
    rightLeg: [0.22, 0, -0.10], rightShin: [0.34, 0, 0]
  }),
  wide: Object.freeze({
    torso: [0.02, 0.10, 0], head: [-0.02, -0.08, 0],
    leftArm: [-0.76, 0, 0.52], leftFore: [0, 0, -0.50],
    rightArm: [-0.76, 0, -0.52], rightFore: [0, 0, 0.50],
    leftLeg: [-0.14, 0, 0.16], leftShin: [0.24, 0, 0],
    rightLeg: [0.14, 0, -0.16], rightShin: [0.24, 0, 0]
  }),
  blade: Object.freeze({
    torso: [0.02, 0.22, 0], head: [-0.02, -0.14, 0],
    leftArm: [-0.34, 0, 0.50], leftFore: [0, 0, -0.74],
    rightArm: [-0.62, 0, -0.42], rightFore: [0, 0, 0.96], rightHand: [0, 0, -0.34],
    leftLeg: [-0.08, 0, 0.08], leftShin: [0.18, 0, 0],
    rightLeg: [0.12, 0, -0.08], rightShin: [0.16, 0, 0]
  }),
  staff: Object.freeze({
    torso: [0.03, 0.24, 0], head: [-0.02, -0.16, 0],
    leftArm: [-0.50, 0, 0.62], leftFore: [0, 0, -1.02],
    rightArm: [-0.58, 0, -0.62], rightFore: [0, 0, 1.02],
    leftLeg: [-0.10, 0, 0.12], leftShin: [0.20, 0, 0],
    rightLeg: [0.14, 0, -0.12], rightShin: [0.18, 0, 0]
  }),
  gun: Object.freeze({
    torso: [0.03, 0.14, 0], head: [-0.02, -0.10, 0],
    leftArm: [-0.58, 0, 0.28], leftFore: [0, 0, -1.12],
    rightArm: [-0.72, 0, -0.24], rightFore: [0, 0, 0.98],
    leftLeg: [-0.08, 0, 0.08], leftShin: [0.16, 0, 0],
    rightLeg: [0.10, 0, -0.08], rightShin: [0.14, 0, 0]
  }),
  caster: Object.freeze({
    torso: [0.02, 0.10, 0], head: [-0.03, -0.06, 0],
    leftArm: [-0.28, 0, 0.54], leftFore: [0, 0, -1.22],
    rightArm: [-0.32, 0, -0.54], rightFore: [0, 0, 1.22],
    leftLeg: [-0.06, 0, 0.10], leftShin: [0.18, 0, 0],
    rightLeg: [0.08, 0, -0.10], rightShin: [0.16, 0, 0]
  }),
  acrobat: Object.freeze({
    torso: [0.10, 0.06, 0], head: [-0.08, -0.04, 0],
    leftArm: [-0.70, 0, 0.38], leftFore: [0, 0, -0.64],
    rightArm: [-0.70, 0, -0.38], rightFore: [0, 0, 0.64],
    leftLeg: [-0.20, 0, 0.18], leftShin: [0.40, 0, 0],
    rightLeg: [0.18, 0, -0.18], rightShin: [0.36, 0, 0]
  }),
  heavy: Object.freeze({
    torso: [0.08, 0.08, 0], head: [-0.06, -0.05, 0],
    leftArm: [-0.62, 0, 0.46], leftFore: [0, 0, -0.74],
    rightArm: [-0.64, 0, -0.46], rightFore: [0, 0, 0.74],
    leftLeg: [-0.16, 0, 0.14], leftShin: [0.30, 0, 0],
    rightLeg: [0.16, 0, -0.14], rightShin: [0.28, 0, 0]
  })
});

/**
 * Explicit identity profiles. `weapon` changes the melee arc, not the moveset's damage; `sig` and
 * `ult` choose the authored release shape. The numbers are intentionally readable: guard family,
 * lead side, amplitude, and the two signature families.
 */
export const ROSTER_PROFILES = Object.freeze({
  infantry: { guard: 'gun', lead: 'right', amp: 1.02, weapon: 'gun', sig: 'gun', ult: 'barrage', beat: 1 },
  superman: { guard: 'balanced', lead: 'right', amp: 1.12, weapon: 'none', sig: 'beam', ult: 'slam', beat: 2 },
  iron_man_tony_stark: { guard: 'gun', lead: 'right', amp: 1.00, weapon: 'gun', sig: 'beam', ult: 'beam', beat: 3 },
  hulk_bruce_banner: { guard: 'heavy', lead: 'right', amp: 1.16, weapon: 'none', sig: 'smash', ult: 'slam', beat: 4 },
  green_lantern_hal_jordan: { guard: 'caster', lead: 'right', amp: 1.04, weapon: 'none', sig: 'construct', ult: 'storm', beat: 5 },
  wonder_woman: { guard: 'blade', lead: 'right', amp: 1.08, weapon: 'blade', sig: 'slash', ult: 'grab', beat: 6 },
  professor_x_charles_xavier: { guard: 'caster', lead: 'right', amp: 0.88, weapon: 'none', sig: 'psychic', ult: 'zone', beat: 7 },
  the_flash_barry_allen: { guard: 'acrobat', lead: 'left', amp: 0.96, weapon: 'none', sig: 'dash', ult: 'rush', beat: 8 },
  aquaman: { guard: 'staff', lead: 'right', amp: 1.12, weapon: 'staff', sig: 'thrust', ult: 'storm', beat: 9 },
  doctor_strange: { guard: 'caster', lead: 'left', amp: 1.00, weapon: 'none', sig: 'magic', ult: 'zone', beat: 10 },
  arnold_schwarzenegger: { guard: 'heavy', lead: 'right', amp: 1.10, weapon: 'gun', sig: 'gun', ult: 'barrage', beat: 11 },
  kaze: { guard: 'acrobat', lead: 'right', amp: 0.98, weapon: 'none', sig: 'wind', ult: 'rush', beat: 12 },
  vegeta: { guard: 'boxing', lead: 'left', amp: 1.06, weapon: 'none', sig: 'beam', ult: 'beam', beat: 13 },
  saitama: { guard: 'balanced', lead: 'right', amp: 1.00, weapon: 'none', sig: 'fist', ult: 'rush', beat: 14 },
  l_death_note_style: { guard: 'caster', lead: 'right', amp: 0.86, weapon: 'none', sig: 'fist', ult: 'zone', beat: 15 },
  all_might: { guard: 'wide', lead: 'right', amp: 1.14, weapon: 'none', sig: 'smash', ult: 'rush', beat: 16 },
  edward_elric: { guard: 'caster', lead: 'left', amp: 1.02, weapon: 'none', sig: 'alchemy', ult: 'storm', beat: 17 },
  levi_ackerman: { guard: 'blade', lead: 'left', amp: 1.00, weapon: 'blade', sig: 'slash', ult: 'rush', beat: 18 },
  mario: { guard: 'boxing', lead: 'right', amp: 1.02, weapon: 'none', sig: 'fist', ult: 'rush', beat: 19 },
  luigi: { guard: 'acrobat', lead: 'left', amp: 0.94, weapon: 'none', sig: 'gadget', ult: 'zone', beat: 20 },
  kratos: { guard: 'heavy', lead: 'right', amp: 1.14, weapon: 'blade', sig: 'slash', ult: 'rush', beat: 21 },
  link: { guard: 'blade', lead: 'right', amp: 0.98, weapon: 'blade', sig: 'slash', ult: 'storm', beat: 22 },
  master_chief: { guard: 'gun', lead: 'right', amp: 1.04, weapon: 'gun', sig: 'gun', ult: 'barrage', beat: 23 },
  thor: { guard: 'wide', lead: 'right', amp: 1.16, weapon: 'hammer', sig: 'smash', ult: 'storm', beat: 24 },
  aang: { guard: 'staff', lead: 'left', amp: 0.94, weapon: 'staff', sig: 'wind', ult: 'storm', beat: 25 },
  madara_uchiha: { guard: 'blade', lead: 'right', amp: 1.10, weapon: 'blade', sig: 'slash', ult: 'storm', beat: 26 },
  hashirama_senju: { guard: 'wide', lead: 'right', amp: 1.08, weapon: 'none', sig: 'summon', ult: 'storm', beat: 27 },
  lord_voldemort: { guard: 'caster', lead: 'right', amp: 0.92, weapon: 'none', sig: 'magic', ult: 'zone', beat: 28 },
  sasuke_uchiha: { guard: 'blade', lead: 'left', amp: 0.98, weapon: 'blade', sig: 'chidori', ult: 'beam', beat: 29 },
  edna_mode: { guard: 'caster', lead: 'right', amp: 0.90, weapon: 'none', sig: 'gadget', ult: 'zone', beat: 30 },
  captain_jack_sparrow: { guard: 'blade', lead: 'right', amp: 1.00, weapon: 'blade', sig: 'slash', ult: 'rush', beat: 31 },
  spider_man: { guard: 'acrobat', lead: 'left', amp: 0.96, weapon: 'none', sig: 'web', ult: 'grab', beat: 32 },
  iron_spider: { guard: 'acrobat', lead: 'right', amp: 1.04, weapon: 'none', sig: 'legs', ult: 'grab', beat: 33 }
});

const mix = (base, changes = {}) => {
  const out = {};
  for (const key of Object.keys(base)) out[key] = [...base[key]];
  for (const [key, value] of Object.entries(changes)) {
    const before = out[key] || [0, 0, 0];
    out[key] = [before[0] + (value[0] || 0), before[1] + (value[1] || 0), before[2] + (value[2] || 0)];
  }
  return out;
};

const T = (t, pose) => ({ t, ...pose });

function frames(profile, table) {
  // Timing is part of identity. A heavier fighter lands the same family of strike a little later;
  // a speedster lands it earlier. This shifts only interior keys, keeps the first/last pose exact,
  // and makes a shared-family light or ultimate measurably different even before pose offsets.
  const phase = ((Number(profile.beat) || 17) - 17) * 0.003;
  return table.map(([t, changes]) => {
    if (t >= 1) return T(1, {});
    if (t <= 0) return T(0, mix(profile.guardPose, changes));
    return T(Math.max(0.04, Math.min(0.96, t + phase)), mix(profile.guardPose, changes));
  });
}

function armChanges(p, side, values) {
  const suffix = side === 'left' ? 'left' : 'right';
  return {
    [`${suffix}Arm`]: values.arm || [0, 0, 0],
    [`${suffix}Fore`]: values.fore || [0, 0, 0],
    [`${suffix}Hand`]: values.hand || [0, 0, 0]
  };
}

function legChanges(p, side, values) {
  const suffix = side === 'left' ? 'left' : 'right';
  return {
    [`${suffix}Leg`]: values.leg || [0, 0, 0],
    [`${suffix}Shin`]: values.shin || [0, 0, 0],
    [`${suffix}Foot`]: values.foot || [0, 0, 0]
  };
}

function strikeArm(p, side, reach = 1, height = 0) {
  const dir = side === 'left' ? -1 : 1;
  return armChanges(p, side, {
    arm: [-1.34 * p.amp * reach, p.jitter * 0.7, -0.08 * dir + height + p.bias],
    fore: [0, 0, 0.04 * dir],
    hand: [0, 0, 0.04 * dir]
  });
}

function weaponStrikeArm(p, side, kind, strength = 1) {
  const dir = side === 'left' ? -1 : 1;
  if (kind === 'blade') {
    return armChanges(p, side, {
      arm: [-1.12 * strength * p.amp, 0.34 * dir + p.jitter, -0.62 * dir + p.bias],
      fore: [0, 0, 0.22 * dir],
      hand: [0.22, 0, -0.30 * dir]
    });
  }
  if (kind === 'staff' || kind === 'hammer') {
    return armChanges(p, side, {
      arm: [-1.50 * strength * p.amp, p.jitter, -0.06 * dir + p.bias],
      fore: [0, 0, 0.10 * dir],
      hand: [0, 0, 0.08 * dir]
    });
  }
  if (kind === 'gun') {
    return armChanges(p, side, {
      arm: [-1.38 * strength * p.amp, p.jitter * 0.6, -0.04 * dir + p.bias],
      fore: [0, 0, 0.20 * dir],
      hand: [0, 0, 0.02 * dir]
    });
  }
  return strikeArm(p, side, strength);
}

function lightOne(p) {
  const side = p.lead;
  const dir = side === 'left' ? -1 : 1;
  const hit = p.weapon === 'none'
    ? strikeArm(p, side)
    : weaponStrikeArm(p, side, p.weapon, 0.92);
  return frames(p, [
    [0, {}],
    [0.14, { torso: [0.04, 0.24 * dir, 0], ...armChanges(p, side, { arm: [0.22, 0, 0], fore: [0, 0, 0.20 * dir] }) }],
    [0.30, { torso: [0.06, -0.34 * dir, 0.02], head: [-0.02, -0.12 * dir, 0], ...hit,
      ...legChanges(p, side, { leg: [-0.10, 0, 0.04 * dir], shin: [0.12, 0, 0] }) }],
    [0.46, { torso: [0.04, -0.22 * dir, 0], ...hit, ...armChanges(p, side, { arm: [0.12, 0, 0] }) }],
    [0.72, { torso: [0.01, -0.06 * dir, 0], ...armChanges(p, side, { arm: [0.18, 0, 0] }) }],
    [1, {}]
  ]);
}

function lightTwo(p) {
  const side = p.off;
  const dir = side === 'left' ? -1 : 1;
  const hit = p.weapon === 'none'
    ? strikeArm(p, side, 1.04, 0.02)
    : weaponStrikeArm(p, side, p.weapon, 1.02);
  return frames(p, [
    [0, {}],
    [0.12, { torso: [0.04, -0.18 * dir, 0], ...armChanges(p, side, { arm: [0.24, 0, 0], fore: [0, 0, 0.22 * dir] }) }],
    [0.32, { torso: [0.10, 0.46 * dir, -0.04], head: [-0.04, 0.18 * dir, 0], ...hit,
      ...legChanges(p, side, { leg: [-0.14, 0, 0.05 * dir], shin: [0.16, 0, 0] }) }],
    [0.50, { torso: [0.06, 0.30 * dir, 0], ...hit, ...armChanges(p, side, { arm: [0.10, 0, 0] }) }],
    [0.76, { torso: [0.02, 0.08 * dir, 0], ...armChanges(p, side, { arm: [0.16, 0, 0] }) }],
    [1, {}]
  ]);
}

function lightThree(p) {
  const side = p.lead;
  const dir = side === 'left' ? -1 : 1;
  const kick = legChanges(p, side, {
    leg: [-1.14 * p.amp, 0, -0.20 * dir],
    shin: [0.22, 0, 0],
    foot: [0.10, 0, 0]
  });
  const weaponCounter = p.weapon === 'blade' || p.weapon === 'staff'
    ? armChanges(p, p.off, { arm: [-0.46, 0, 0.56 * dir], fore: [0, 0, -0.28 * dir] })
    : armChanges(p, p.off, { arm: [-0.50, 0, 0.64 * dir] });
  return frames(p, [
    [0, {}],
    [0.16, { pelvis: [0, -0.26 * dir, 0], torso: [0.03, -0.18 * dir, 0], ...kick, ...weaponCounter }],
    [0.32, { pelvis: [0, 1.18 * dir, -0.04], torso: [0.08, 0.72 * dir, -0.06], head: [-0.04, 0.34 * dir, 0], ...kick,
      ...armChanges(p, p.lead, { arm: [0.30, 0, -0.48 * dir] }) }],
    [0.54, { pelvis: [0, 0.82 * dir, 0], torso: [0.05, 0.50 * dir, 0], ...kick, ...weaponCounter }],
    [0.76, { pelvis: [0, 0.24 * dir, 0], torso: [0.02, 0.14 * dir, 0] }],
    [1, {}]
  ]);
}

function lightFour(p) {
  const side = p.lead;
  const kick = legChanges(p, side, { leg: [-1.52 * p.amp, 0, -0.04], shin: [1.28, 0, 0], foot: [0.18, 0, 0] });
  return frames(p, [
    [0, {}],
    [0.18, { pelvis: [-0.20, 0.06, 0], torso: [-0.04, 0.08, 0], ...kick, ...armChanges(p, p.off, { arm: [-0.55, 0, 0.48] }) }],
    [0.34, { pelvis: [-0.30, 0.10, 0], torso: [0.20, 0.04, 0], head: [-0.12, 0, 0], ...kick,
      ...armChanges(p, p.off, { arm: [-0.38, 0, 0.40] }) }],
    [0.58, { pelvis: [-0.16, 0.08, 0], torso: [0.08, 0.02, 0], ...kick }],
    [0.80, { pelvis: [-0.04, 0.02, 0] }],
    [1, {}]
  ]);
}

function lightFive(p) {
  const side = p.lead;
  const dir = side === 'left' ? -1 : 1;
  if (p.weapon === 'blade' || p.weapon === 'staff') {
    const hit = weaponStrikeArm(p, side, p.weapon, 1.24);
    return frames(p, [
      [0, {}],
      [0.16, { torso: [0.02, 0.48 * dir, 0], ...armChanges(p, side, { arm: [-1.80, 0.12 * dir, 0.20 * dir], fore: [0, 0, 0.52 * dir], hand: [0.14, 0, -0.22 * dir] }) }],
      [0.34, { torso: [0.10, -0.62 * dir, -0.05], head: [-0.06, -0.24 * dir, 0], ...hit,
        ...legChanges(p, p.off, { leg: [-0.28, 0, 0.12 * dir], shin: [0.34, 0, 0] }) }],
      [0.58, { torso: [0.06, -0.42 * dir, 0], ...hit }],
      [0.82, { torso: [0.02, -0.12 * dir, 0] }],
      [1, {}]
    ]);
  }
  if (p.weapon === 'gun') {
    return frames(p, [
      [0, {}],
      [0.18, { torso: [0.02, -0.24 * dir, 0], ...armChanges(p, side, { arm: [-0.40, 0, -0.40 * dir], fore: [0, 0, 0.70 * dir] }) }],
      [0.34, { torso: [0.08, 0.40 * dir, 0], ...weaponStrikeArm(p, side, 'gun', 1.12),
        ...legChanges(p, p.off, { leg: [-0.24, 0, 0.10 * dir], shin: [0.30, 0, 0] }) }],
      [0.56, { torso: [0.04, 0.26 * dir, 0], ...weaponStrikeArm(p, side, 'gun', 1.0) }],
      [0.82, { torso: [0.01, 0.06 * dir, 0] }],
      [1, {}]
    ]);
  }
  return frames(p, [
    [0, {}],
    [0.14, { torso: [0.12, 0.34 * dir, 0], ...armChanges(p, side, { arm: [0.16, 0, 0.28 * dir], fore: [0, 0, 0.58 * dir] }) }],
    [0.32, { torso: [-0.28, -0.22 * dir, 0], head: [-0.14, 0, 0], ...strikeArm(p, side, 1.10, 0.04),
      ...armChanges(p, p.off, { arm: [-0.30, 0, 0.34 * dir], fore: [0, 0, -0.12 * dir] }),
      ...legChanges(p, p.off, { leg: [-0.36, 0, 0.14 * dir], shin: [0.42, 0, 0] }) }],
    [0.58, { torso: [-0.20, -0.14 * dir, 0], ...strikeArm(p, side, 0.92) }],
    [0.82, { torso: [-0.06, -0.04 * dir, 0] }],
    [1, {}]
  ]);
}

function heavy(p) {
  const side = p.lead;
  const dir = side === 'left' ? -1 : 1;
  const hit = p.weapon === 'none'
    ? strikeArm(p, side, 1.26, 0.02)
    : weaponStrikeArm(p, side, p.weapon, 1.26);
  return frames(p, [
    [0, {}],
    [0.18, { torso: [0.10, 0.52 * dir, 0], pelvis: [0, 0.24 * dir, 0], ...armChanges(p, side, { arm: [0.36, 0, 0.24 * dir], fore: [0, 0, 0.48 * dir] }),
      ...legChanges(p, p.off, { leg: [-0.26, 0, 0.12 * dir], shin: [0.42, 0, 0] }) }],
    [0.40, { torso: [0.02, -0.58 * dir, 0.04], pelvis: [0, -0.34 * dir, 0], head: [-0.12, -0.22 * dir, 0], ...hit,
      ...legChanges(p, p.off, { leg: [-0.46, 0, 0.18 * dir], shin: [0.48, 0, 0] }) }],
    [0.62, { torso: [0.06, -0.36 * dir, 0], pelvis: [0, -0.18 * dir, 0], ...hit }],
    [0.84, { torso: [0.02, -0.10 * dir, 0] }],
    [1, {}]
  ]);
}

function launcher(p) {
  const side = p.off;
  const dir = side === 'left' ? -1 : 1;
  return frames(p, [
    [0, {}],
    [0.18, { pelvis: [0.16, 0, 0], torso: [0.34, 0.08 * dir, 0], ...armChanges(p, side, { arm: [0.45, 0, -0.30 * dir], fore: [0, 0, 0.55 * dir] }),
      ...legChanges(p, p.lead, { leg: [-0.30, 0, 0.12], shin: [0.52, 0, 0] }) }],
    [0.36, { pelvis: [-0.22, -0.08 * dir, 0], torso: [-0.34, -0.16 * dir, 0], head: [-0.24, 0, 0],
      ...armChanges(p, side, { arm: [-2.16 * p.amp, 0, -0.12 * dir], fore: [0, 0, 0.06 * dir], hand: [0, 0, 0.04 * dir] }),
      ...legChanges(p, p.off, { leg: [0.08, 0, 0], shin: [0.16, 0, 0] }) }],
    [0.58, { pelvis: [-0.14, 0, 0], torso: [-0.22, -0.08 * dir, 0], ...armChanges(p, side, { arm: [-1.72, 0, -0.20 * dir] }) }],
    [0.82, { torso: [-0.06, 0, 0] }],
    [1, {}]
  ]);
}

function slam(p) {
  const both = {
    ...armChanges(p, 'left', { arm: [-2.42 * p.amp, 0, 0.20], fore: [0, 0, -0.18] }),
    ...armChanges(p, 'right', { arm: [-2.42 * p.amp, 0, -0.20], fore: [0, 0, 0.18] })
  };
  return frames(p, [
    [0, {}],
    [0.18, { torso: [-0.26, 0, 0], pelvis: [-0.16, 0, 0], head: [-0.20, 0, 0], ...both }],
    [0.36, { torso: [0.52, 0, 0], pelvis: [0.30, 0, 0], head: [0.28, 0, 0],
      ...armChanges(p, 'left', { arm: [0.18, 0, 0.12], fore: [0, 0, -0.10] }),
      ...armChanges(p, 'right', { arm: [0.18, 0, -0.12], fore: [0, 0, 0.10] }),
      ...legChanges(p, 'left', { leg: [-0.50, 0, 0.18], shin: [0.58, 0, 0] }),
      ...legChanges(p, 'right', { leg: [-0.34, 0, -0.18], shin: [0.46, 0, 0] }) }],
    [0.60, { torso: [0.36, 0, 0], pelvis: [0.18, 0, 0], ...armChanges(p, 'left', { arm: [-0.10, 0, 0.14] }), ...armChanges(p, 'right', { arm: [-0.10, 0, -0.14] }) }],
    [0.82, { torso: [0.10, 0, 0] }],
    [1, {}]
  ]);
}

function grabMotion(p) {
  return frames(p, [
    [0, {}],
    [0.18, { torso: [0.18, 0.05, 0], ...armChanges(p, 'left', { arm: [-1.55, 0, 0.22], fore: [0, 0, -0.06] }),
      ...armChanges(p, 'right', { arm: [-1.55, 0, -0.22], fore: [0, 0, 0.06] }) }],
    [0.36, { torso: [-0.12, 0, 0], ...armChanges(p, 'left', { arm: [-1.02, 0, -0.34], fore: [0, 0, -0.90] }),
      ...armChanges(p, 'right', { arm: [-1.02, 0, 0.34], fore: [0, 0, 0.90] }),
      ...legChanges(p, 'left', { leg: [-0.18, 0, 0.10], shin: [0.24, 0, 0] }) }],
    [0.56, { torso: [-0.08, 0, 0], ...armChanges(p, 'left', { arm: [-1.08, 0, -0.30], fore: [0, 0, -0.84] }),
      ...armChanges(p, 'right', { arm: [-1.08, 0, 0.30], fore: [0, 0, 0.84] }) }],
    [0.82, { torso: [0, 0, 0] }],
    [1, {}]
  ]);
}

function throwMotion(p) {
  const dir = p.lead === 'left' ? -1 : 1;
  return frames(p, [
    [0, {}],
    [0.16, { torso: [-0.16, -0.48 * dir, 0], pelvis: [-0.08, -0.28 * dir, 0],
      ...armChanges(p, 'left', { arm: [-1.10, 0, -0.46], fore: [0, 0, -0.66] }),
      ...armChanges(p, 'right', { arm: [-1.18, 0, 0.46], fore: [0, 0, 0.66] }) }],
    [0.36, { torso: [0.34, 0.70 * dir, -0.04], pelvis: [0.14, 0.44 * dir, 0], head: [0.10, 0.30 * dir, 0],
      ...weaponStrikeArm(p, p.lead, 'none', 1.15),
      ...armChanges(p, p.off, { arm: [-0.42, 0, 0.30 * dir] }),
      ...legChanges(p, p.lead, { leg: [-0.32, 0, 0.14 * dir], shin: [0.36, 0, 0] }) }],
    [0.58, { torso: [0.24, 0.46 * dir, 0], ...strikeArm(p, p.lead, 0.80) }],
    [0.82, { torso: [0.08, 0.16 * dir, 0] }],
    [1, {}]
  ]);
}

/**
 * Signature release shapes. Each entry returns the wind-up, impact and hold deltas. Ten shapes
 * cover the roster; the profile's weapon, lead side, guard and amplitude then differentiate the
 * same family, while the identity's move label remains the source of truth for damage/VFX.
 */
const SIGNATURES = Object.freeze({
  beam: p => ({
    wind: { torso: [0.14, 0.24, 0], pelvis: [0.04, 0.12, 0], head: [0.06, 0.16, 0],
      ...armChanges(p, 'left', { arm: [-0.16, 0, 0.72], fore: [0, 0, -1.22] }),
      ...armChanges(p, 'right', { arm: [-0.22, 0, -0.72], fore: [0, 0, 1.22] }),
      ...legChanges(p, 'left', { leg: [-0.32, 0, 0.16], shin: [0.44, 0, 0] }),
      ...legChanges(p, 'right', { leg: [0.18, 0, -0.16], shin: [0.28, 0, 0] }) },
    hit: { torso: [-0.22, -0.16, 0], pelvis: [-0.08, -0.08, 0], head: [-0.10, -0.08, 0],
      ...armChanges(p, 'left', { arm: [-1.50, 0, 0.12], fore: [0, 0, -0.04] }),
      ...armChanges(p, 'right', { arm: [-1.50, 0, -0.12], fore: [0, 0, 0.04] }),
      ...legChanges(p, 'left', { leg: [-0.48, 0, 0.18], shin: [0.44, 0, 0] }) },
    hold: { torso: [-0.16, -0.12, 0], ...armChanges(p, 'left', { arm: [-1.38, 0, 0.16] }), ...armChanges(p, 'right', { arm: [-1.38, 0, -0.16] }) }
  }),
  palm: p => ({
    wind: { torso: [0.18, -0.38, 0], pelvis: [0.04, -0.22, 0], head: [0.06, 0.26, 0],
      ...armChanges(p, p.lead, { arm: [-0.08, 0, -1.12], fore: [0, 0, 1.38] }),
      ...armChanges(p, p.off, { arm: [-0.54, 0, 0.66], fore: [0, 0, -0.62] }),
      ...legChanges(p, 'left', { leg: [-0.36, 0, 0.16], shin: [0.48, 0, 0] }) },
    hit: { torso: [-0.26, 0.54, -0.04], pelvis: [-0.08, 0.34, 0], head: [-0.14, -0.18, 0],
      ...strikeArm(p, p.lead, 1.20, 0.02),
      ...armChanges(p, p.off, { arm: [-0.28, 0, 0.24], fore: [0, 0, -0.06] }),
      ...legChanges(p, p.off, { leg: [-0.48, 0, 0.18], shin: [0.46, 0, 0] }) },
    hold: { torso: [-0.20, 0.42, 0], ...strikeArm(p, p.lead, 1.02) }
  }),
  slash: p => ({
    wind: { torso: [0.04, 0.62, 0], pelvis: [0, 0.28, 0], head: [0.02, -0.20, 0],
      ...armChanges(p, p.lead, { arm: [-1.82, 0.30, 0.34], fore: [0, 0, 0.62], hand: [0.20, 0, -0.28] }),
      ...armChanges(p, p.off, { arm: [-0.48, 0, 0.52] }),
      ...legChanges(p, p.off, { leg: [-0.26, 0, 0.12], shin: [0.38, 0, 0] }) },
    hit: { torso: [0.10, -0.72, -0.04], pelvis: [0.04, -0.42, 0], head: [-0.06, 0.26, 0],
      ...armChanges(p, p.lead, { arm: [-1.18, -0.42, -0.74], fore: [0, 0, 0.18], hand: [0.18, 0, -0.30] }),
      ...legChanges(p, 'left', { leg: [-0.42, 0, 0.16], shin: [0.42, 0, 0] }) },
    hold: { torso: [0.06, -0.52, 0], ...armChanges(p, p.lead, { arm: [-1.30, -0.28, -0.62] }) }
  }),
  thrust: p => ({
    wind: { torso: [0.08, 0.36, 0], pelvis: [0.02, 0.20, 0],
      ...armChanges(p, p.lead, { arm: [0.24, 0, -0.42], fore: [0, 0, 0.92], hand: [0, 0, -0.22] }),
      ...armChanges(p, p.off, { arm: [-0.35, 0, 0.55], fore: [0, 0, -0.30] }),
      ...legChanges(p, p.off, { leg: [-0.30, 0, 0.14], shin: [0.38, 0, 0] }) },
    hit: { torso: [-0.24, -0.30, 0], pelvis: [-0.08, -0.18, 0], head: [-0.10, 0.14, 0],
      ...armChanges(p, p.lead, { arm: [-1.52, 0.12, -0.08], fore: [0, 0, 0.04], hand: [0, 0, 0.02] }),
      ...legChanges(p, 'left', { leg: [-0.52, 0, 0.18], shin: [0.44, 0, 0] }) },
    hold: { torso: [-0.18, -0.22, 0], ...armChanges(p, p.lead, { arm: [-1.36, 0.08, -0.12] }) }
  }),
  smash: p => ({
    wind: { torso: [-0.30, 0, 0], pelvis: [-0.18, 0, 0], head: [-0.24, 0, 0],
      ...armChanges(p, 'left', { arm: [-2.36, 0, 0.26], fore: [0, 0, -0.22] }),
      ...armChanges(p, 'right', { arm: [-2.36, 0, -0.26], fore: [0, 0, 0.22] }),
      ...legChanges(p, 'left', { leg: [-0.28, 0, 0.12], shin: [0.42, 0, 0] }),
      ...legChanges(p, 'right', { leg: [0.18, 0, -0.12], shin: [0.30, 0, 0] }) },
    hit: { torso: [0.52, 0, 0], pelvis: [0.30, 0, 0], head: [0.26, 0, 0],
      ...armChanges(p, 'left', { arm: [0.16, 0, 0.12], fore: [0, 0, -0.08] }),
      ...armChanges(p, 'right', { arm: [0.16, 0, -0.12], fore: [0, 0, 0.08] }),
      ...legChanges(p, 'left', { leg: [-0.52, 0, 0.18], shin: [0.58, 0, 0] }),
      ...legChanges(p, 'right', { leg: [-0.34, 0, -0.18], shin: [0.46, 0, 0] }) },
    hold: { torso: [0.36, 0, 0], ...armChanges(p, 'left', { arm: [0.02, 0, 0.14] }), ...armChanges(p, 'right', { arm: [0.02, 0, -0.14] }) }
  }),
  dash: p => ({
    wind: { torso: [0.14, -0.35, 0], pelvis: [0.06, -0.20, 0], head: [0.04, 0.20, 0],
      ...armChanges(p, p.lead, { arm: [0.58, 0, -0.45], fore: [0, 0, 0.52] }),
      ...legChanges(p, 'left', { leg: [-0.44, 0, 0.18], shin: [0.56, 0, 0] }),
      ...legChanges(p, 'right', { leg: [0.12, 0, -0.18], shin: [0.28, 0, 0] }) },
    hit: { torso: [-0.26, 0.28, 0], pelvis: [-0.10, 0.18, 0], head: [-0.18, -0.08, 0],
      ...strikeArm(p, p.lead, 1.26),
      ...armChanges(p, p.off, { arm: [-0.48, 0, 0.36] }),
      ...legChanges(p, 'left', { leg: [-0.60, 0, 0.22], shin: [0.42, 0, 0] }) },
    hold: { torso: [-0.18, 0.20, 0], ...strikeArm(p, p.lead, 1.04) }
  }),
  summon: p => ({
    wind: { torso: [-0.16, 0, 0], pelvis: [-0.08, 0, 0], head: [-0.12, 0, 0],
      ...armChanges(p, 'left', { arm: [-1.22, 0, -0.92], fore: [0, 0, -1.18] }),
      ...armChanges(p, 'right', { arm: [-1.22, 0, 0.92], fore: [0, 0, 1.18] }),
      ...legChanges(p, 'left', { leg: [-0.18, 0, 0.08], shin: [0.32, 0, 0] }) },
    hit: { torso: [0.26, 0, 0], pelvis: [0.10, 0, 0], head: [0.18, 0, 0],
      ...armChanges(p, 'left', { arm: [-0.38, 0, -1.46], fore: [0, 0, -0.16] }),
      ...armChanges(p, 'right', { arm: [-0.38, 0, 1.46], fore: [0, 0, 0.16] }),
      ...legChanges(p, 'left', { leg: [-0.40, 0, 0.18], shin: [0.38, 0, 0] }) },
    hold: { torso: [0.16, 0, 0], ...armChanges(p, 'left', { arm: [-0.55, 0, -1.22] }), ...armChanges(p, 'right', { arm: [-0.55, 0, 1.22] }) }
  }),
  magic: p => ({
    wind: { torso: [-0.06, -0.16, 0], pelvis: [-0.04, -0.10, 0],
      ...armChanges(p, 'left', { arm: [-1.18, 0, -0.48], fore: [0, 0, -1.32] }),
      ...armChanges(p, 'right', { arm: [-1.24, 0, 0.42], fore: [0, 0, 1.38] }),
      ...legChanges(p, 'left', { leg: [-0.14, 0, 0.10], shin: [0.26, 0, 0] }) },
    hit: { torso: [-0.24, 0.48, 0], pelvis: [-0.08, 0.28, 0], head: [-0.14, -0.16, 0],
      ...armChanges(p, 'left', { arm: [-1.36, 0, -0.20], fore: [0, 0, -0.22] }),
      ...armChanges(p, 'right', { arm: [-1.10, 0, 0.36], fore: [0, 0, 0.20] }),
      ...legChanges(p, 'left', { leg: [-0.42, 0, 0.16], shin: [0.42, 0, 0] }) },
    hold: { torso: [-0.18, 0.36, 0], ...armChanges(p, 'left', { arm: [-1.24, 0, -0.26] }), ...armChanges(p, 'right', { arm: [-1.02, 0, 0.32] }) }
  }),
  fist: p => ({
    wind: { torso: [0.18, 0.46, 0], pelvis: [0.04, 0.28, 0],
      ...armChanges(p, p.lead, { arm: [0.62, 0, -0.36], fore: [0, 0, 0.62] }),
      ...armChanges(p, p.off, { arm: [-0.56, 0, 0.48] }),
      ...legChanges(p, p.off, { leg: [-0.30, 0, 0.12], shin: [0.38, 0, 0] }) },
    hit: { torso: [-0.24, -0.52, 0.04], pelvis: [-0.08, -0.34, 0], head: [-0.16, -0.18, 0],
      ...strikeArm(p, p.lead, 1.34),
      ...legChanges(p, 'left', { leg: [-0.54, 0, 0.20], shin: [0.48, 0, 0] }) },
    hold: { torso: [-0.18, -0.38, 0], ...strikeArm(p, p.lead, 1.12) }
  }),
  gun: p => ({
    wind: { torso: [0.04, 0.26, 0], head: [0.02, 0.18, 0],
      ...armChanges(p, p.lead, { arm: [-1.38, 0, -0.10], fore: [0, 0, 0.36], hand: [0, 0, 0.02] }),
      ...armChanges(p, p.off, { arm: [-1.22, 0, 0.28], fore: [0, 0, -1.16] }),
      ...legChanges(p, p.off, { leg: [-0.18, 0, 0.10], shin: [0.30, 0, 0] }) },
    hit: { torso: [-0.10, -0.26, 0], head: [-0.08, -0.18, 0],
      ...armChanges(p, p.lead, { arm: [-1.44, 0, -0.08], fore: [0, 0, 0.30], hand: [0, 0, 0.04] }),
      ...armChanges(p, p.off, { arm: [-1.16, 0, 0.34], fore: [0, 0, -1.02] }) },
    hold: { torso: [-0.04, -0.16, 0], ...armChanges(p, p.lead, { arm: [-1.34, 0, -0.12] }) }
  }),
  construct: p => ({
    wind: { torso: [-0.12, 0.18, 0], pelvis: [-0.06, 0.10, 0],
      ...armChanges(p, 'left', { arm: [-2.12, 0, 0.28], fore: [0, 0, -0.36] }),
      ...armChanges(p, 'right', { arm: [-2.02, 0, -0.28], fore: [0, 0, 0.36] }),
      ...legChanges(p, 'left', { leg: [-0.26, 0, 0.14], shin: [0.38, 0, 0] }) },
    hit: { torso: [0.44, -0.18, 0], pelvis: [0.24, -0.10, 0], head: [0.22, 0, 0],
      ...armChanges(p, 'left', { arm: [0.20, 0, 0.16], fore: [0, 0, -0.12] }),
      ...armChanges(p, 'right', { arm: [0.20, 0, -0.16], fore: [0, 0, 0.12] }),
      ...legChanges(p, 'left', { leg: [-0.48, 0, 0.18], shin: [0.52, 0, 0] }) },
    hold: { torso: [0.30, -0.12, 0], ...armChanges(p, 'left', { arm: [0.05, 0, 0.18] }), ...armChanges(p, 'right', { arm: [0.05, 0, -0.18] }) }
  }),
  psychic: p => ({
    wind: { torso: [-0.08, 0, 0], head: [-0.10, 0, 0],
      ...armChanges(p, 'left', { arm: [-1.82, 0, -0.88], fore: [0, 0, -1.32] }),
      ...armChanges(p, 'right', { arm: [-1.82, 0, 0.88], fore: [0, 0, 1.32] }),
      ...legChanges(p, 'left', { leg: [-0.08, 0, 0.06], shin: [0.18, 0, 0] }) },
    hit: { torso: [-0.20, 0, 0], head: [-0.22, 0, 0],
      ...armChanges(p, 'left', { arm: [-1.48, 0, -0.34], fore: [0, 0, -0.12] }),
      ...armChanges(p, 'right', { arm: [-1.48, 0, 0.34], fore: [0, 0, 0.12] }) },
    hold: { torso: [-0.14, 0, 0], ...armChanges(p, 'left', { arm: [-1.30, 0, -0.42] }), ...armChanges(p, 'right', { arm: [-1.30, 0, 0.42] }) }
  }),
  alchemy: p => ({
    wind: { torso: [0.18, 0, 0], pelvis: [-0.10, 0, 0], head: [0.10, 0, 0],
      ...armChanges(p, 'left', { arm: [-0.86, 0, -0.72], fore: [0, 0, -1.12] }),
      ...armChanges(p, 'right', { arm: [-0.86, 0, 0.72], fore: [0, 0, 1.12] }),
      ...legChanges(p, 'left', { leg: [-0.34, 0, 0.16], shin: [0.46, 0, 0] }) },
    hit: { torso: [0.50, 0, 0], pelvis: [0.24, 0, 0], head: [0.30, 0, 0],
      ...armChanges(p, 'left', { arm: [0.12, 0, -0.18], fore: [0, 0, -0.10] }),
      ...armChanges(p, 'right', { arm: [0.12, 0, 0.18], fore: [0, 0, 0.10] }),
      ...legChanges(p, 'left', { leg: [-0.56, 0, 0.20], shin: [0.58, 0, 0] }) },
    hold: { torso: [0.32, 0, 0], ...armChanges(p, 'left', { arm: [-0.10, 0, -0.22] }), ...armChanges(p, 'right', { arm: [-0.10, 0, 0.22] }) }
  }),
  web: p => ({
    wind: { torso: [0.06, -0.24, 0], ...armChanges(p, p.lead, { arm: [-1.24, 0, -0.26], fore: [0, 0, 0.36], hand: [0, 0, 0.24] }) },
    hit: { torso: [-0.18, 0.34, 0], pelvis: [-0.06, 0.20, 0], ...armChanges(p, p.lead, { arm: [-1.48, 0, -0.10], fore: [0, 0, 0.04], hand: [0, 0, 0.26] }),
      ...armChanges(p, p.off, { arm: [-0.44, 0, 0.42] }) },
    hold: { torso: [-0.10, 0.24, 0], ...armChanges(p, p.lead, { arm: [-1.30, 0, -0.16] }) }
  }),
  legs: p => ({
    wind: { torso: [-0.26, 0, 0], pelvis: [-0.14, 0, 0], head: [-0.18, 0, 0],
      ...armChanges(p, 'left', { arm: [0.14, 0, 0.96], fore: [0, 0, -0.36] }),
      ...armChanges(p, 'right', { arm: [0.14, 0, -0.96], fore: [0, 0, 0.36] }),
      ...legChanges(p, 'left', { leg: [-0.22, 0, 0.12], shin: [0.38, 0, 0] }) },
    hit: { torso: [0.24, 0, 0], pelvis: [0.10, 0, 0], head: [0.16, 0, 0],
      ...armChanges(p, 'left', { arm: [-0.38, 0, 0.58], fore: [0, 0, -0.12] }),
      ...armChanges(p, 'right', { arm: [-0.38, 0, -0.58], fore: [0, 0, 0.12] }),
      ...legChanges(p, 'left', { leg: [-0.42, 0, 0.18], shin: [0.40, 0, 0] }) },
    hold: { torso: [0.14, 0, 0], ...armChanges(p, 'left', { arm: [-0.58, 0, 0.46] }), ...armChanges(p, 'right', { arm: [-0.58, 0, -0.46] }) }
  }),
  wind: p => ({
    wind: { torso: [0.08, 0.56, 0], pelvis: [0.02, 0.30, 0], ...armChanges(p, p.lead, { arm: [-0.34, 0, -0.74], fore: [0, 0, 0.56] }) },
    hit: { torso: [-0.16, -0.66, 0.04], pelvis: [-0.06, -0.38, 0], head: [-0.08, 0.28, 0],
      ...armChanges(p, p.lead, { arm: [-1.34, -0.20, 0.60], fore: [0, 0, 0.18] }),
      ...armChanges(p, p.off, { arm: [-0.34, 0, 0.34] }),
      ...legChanges(p, 'left', { leg: [-0.44, 0, 0.18], shin: [0.44, 0, 0] }) },
    hold: { torso: [-0.10, -0.46, 0], ...armChanges(p, p.lead, { arm: [-1.12, -0.12, 0.48] }) }
  }),
  chidori: p => ({
    wind: { torso: [0.14, -0.46, 0.04], pelvis: [0.04, -0.28, 0], ...armChanges(p, p.lead, { arm: [0.08, 0, -1.08], fore: [0, 0, 1.32] }) },
    hit: { torso: [-0.24, 0.62, -0.04], pelvis: [-0.08, 0.38, 0], head: [-0.16, -0.18, 0],
      ...armChanges(p, p.lead, { arm: [-1.66, 0, -0.10], fore: [0, 0, 0.04] }),
      ...legChanges(p, p.off, { leg: [-0.52, 0, 0.20], shin: [0.46, 0, 0] }) },
    hold: { torso: [-0.18, 0.46, 0], ...armChanges(p, p.lead, { arm: [-1.44, 0, -0.16] }) }
  }),
  gadget: p => ({
    wind: { torso: [0.06, -0.28, 0], ...armChanges(p, p.lead, { arm: [0.12, 0, -0.50], fore: [0, 0, 0.96] }) },
    hit: { torso: [-0.08, 0.34, 0], ...armChanges(p, p.lead, { arm: [-1.26, 0, -0.16], fore: [0, 0, 0.10] }),
      ...armChanges(p, p.off, { arm: [-0.38, 0, 0.32] }) },
    hold: { torso: [-0.04, 0.20, 0], ...armChanges(p, p.lead, { arm: [-1.02, 0, -0.20] }) }
  })
});

const ULTIMATES = Object.freeze({
  beam: p => ({
    charge: { torso: [-0.26, 0.18, 0], pelvis: [-0.12, 0.10, 0], head: [-0.22, -0.10, 0],
      ...armChanges(p, 'left', { arm: [-2.10, 0, -0.30], fore: [0, 0, -0.42] }),
      ...armChanges(p, 'right', { arm: [-2.10, 0, 0.30], fore: [0, 0, 0.42] }) },
    release: { torso: [-0.22, -0.08, 0], ...armChanges(p, 'left', { arm: [-1.52, 0, 0.14], fore: [0, 0, -0.04] }),
      ...armChanges(p, 'right', { arm: [-1.52, 0, -0.14], fore: [0, 0, 0.04] }),
      ...legChanges(p, 'left', { leg: [-0.56, 0, 0.20], shin: [0.46, 0, 0] }) },
    recover: { torso: [-0.06, 0, 0], ...armChanges(p, 'left', { arm: [-0.60, 0, 0.34] }), ...armChanges(p, 'right', { arm: [-0.60, 0, -0.34] }) }
  }),
  rush: p => ({
    charge: { torso: [0.22, 0.18, 0], pelvis: [0.10, 0.10, 0],
      ...armChanges(p, p.lead, { arm: [0.50, 0, -0.38], fore: [0, 0, 0.62] }),
      ...legChanges(p, 'left', { leg: [-0.44, 0, 0.18], shin: [0.54, 0, 0] }) },
    release: { torso: [-0.30, -0.18, 0.04], pelvis: [-0.10, -0.14, 0], head: [-0.18, 0, 0],
      ...strikeArm(p, p.lead, 1.42), ...strikeArm(p, p.off, 0.70),
      ...legChanges(p, 'left', { leg: [-0.62, 0, 0.22], shin: [0.40, 0, 0] }) },
    recover: { torso: [-0.10, -0.06, 0], ...armChanges(p, p.lead, { arm: [-0.75, 0, -0.28] }), ...armChanges(p, p.off, { arm: [-0.65, 0, 0.30] }) }
  }),
  slam: p => ({
    charge: { torso: [-0.34, 0, 0], pelvis: [-0.24, 0, 0], head: [-0.26, 0, 0],
      ...armChanges(p, 'left', { arm: [-2.42, 0, 0.28], fore: [0, 0, -0.26] }),
      ...armChanges(p, 'right', { arm: [-2.42, 0, -0.28], fore: [0, 0, 0.26] }),
      ...legChanges(p, 'left', { leg: [-0.46, 0, 0.20], shin: [0.58, 0, 0] }) },
    release: { torso: [0.58, 0, 0], pelvis: [0.34, 0, 0], head: [0.30, 0, 0],
      ...armChanges(p, 'left', { arm: [0.18, 0, 0.16], fore: [0, 0, -0.10] }),
      ...armChanges(p, 'right', { arm: [0.18, 0, -0.16], fore: [0, 0, 0.10] }),
      ...legChanges(p, 'left', { leg: [-0.56, 0, 0.22], shin: [0.60, 0, 0] }) },
    recover: { torso: [0.24, 0, 0], ...armChanges(p, 'left', { arm: [-0.30, 0, 0.20] }), ...armChanges(p, 'right', { arm: [-0.30, 0, -0.20] }) }
  }),
  storm: p => ({
    charge: { torso: [-0.18, 0, 0], pelvis: [-0.08, 0, 0],
      ...armChanges(p, 'left', { arm: [-2.16, 0, 0.56], fore: [0, 0, -0.30] }),
      ...armChanges(p, 'right', { arm: [-2.16, 0, -0.56], fore: [0, 0, 0.30] }) },
    release: { torso: [0.24, 0, 0], pelvis: [0.16, 0, 0], head: [0.14, 0, 0],
      ...armChanges(p, 'left', { arm: [-0.32, 0, 1.36], fore: [0, 0, -0.10] }),
      ...armChanges(p, 'right', { arm: [-0.32, 0, -1.36], fore: [0, 0, 0.10] }),
      ...legChanges(p, 'left', { leg: [-0.48, 0, 0.22], shin: [0.44, 0, 0] }) },
    recover: { torso: [0.08, 0, 0], ...armChanges(p, 'left', { arm: [-0.56, 0, 0.86] }), ...armChanges(p, 'right', { arm: [-0.56, 0, -0.86] }) }
  }),
  zone: p => ({
    charge: { torso: [-0.10, 0, 0], ...armChanges(p, 'left', { arm: [-1.32, 0, -0.82], fore: [0, 0, -1.30] }),
      ...armChanges(p, 'right', { arm: [-1.32, 0, 0.82], fore: [0, 0, 1.30] }) },
    release: { torso: [-0.26, 0, 0], pelvis: [-0.10, 0, 0], head: [-0.16, 0, 0],
      ...armChanges(p, 'left', { arm: [-1.64, 0, -0.48], fore: [0, 0, -0.14] }),
      ...armChanges(p, 'right', { arm: [-1.64, 0, 0.48], fore: [0, 0, 0.14] }) },
    recover: { torso: [-0.08, 0, 0], ...armChanges(p, 'left', { arm: [-0.92, 0, -0.42] }), ...armChanges(p, 'right', { arm: [-0.92, 0, 0.42] }) }
  }),
  grab: p => ({
    charge: { torso: [0.16, 0, 0], ...armChanges(p, 'left', { arm: [-1.60, 0, 0.28], fore: [0, 0, -0.12] }),
      ...armChanges(p, 'right', { arm: [-1.60, 0, -0.28], fore: [0, 0, 0.12] }) },
    release: { torso: [-0.16, 0.74, 0], pelvis: [0.10, 0.44, 0], head: [0.08, 0.30, 0],
      ...armChanges(p, 'left', { arm: [-1.42, 0, 0.62], fore: [0, 0, -0.06] }),
      ...armChanges(p, 'right', { arm: [-0.60, 0, -0.40], fore: [0, 0, 0.42] }) },
    recover: { torso: [-0.04, 0.20, 0], ...armChanges(p, 'left', { arm: [-0.72, 0, 0.36] }), ...armChanges(p, 'right', { arm: [-0.46, 0, -0.28] }) }
  }),
  barrage: p => ({
    charge: { torso: [0.18, 0.40, 0], pelvis: [0.06, 0.22, 0],
      ...armChanges(p, p.lead, { arm: [0.58, 0, -0.34], fore: [0, 0, 0.64] }),
      ...legChanges(p, 'left', { leg: [-0.38, 0, 0.16], shin: [0.50, 0, 0] }) },
    release: { torso: [-0.28, -0.44, 0.04], pelvis: [-0.10, -0.30, 0],
      ...strikeArm(p, p.lead, 1.44), ...strikeArm(p, p.off, 1.06),
      ...legChanges(p, 'left', { leg: [-0.58, 0, 0.20], shin: [0.44, 0, 0] }) },
    recover: { torso: [-0.10, -0.14, 0], ...armChanges(p, p.lead, { arm: [-0.78, 0, -0.26] }), ...armChanges(p, p.off, { arm: [-0.66, 0, 0.28] }) }
  }),
  sword: p => ({
    charge: { torso: [0.06, 0.52, 0], pelvis: [0, 0.28, 0], ...armChanges(p, p.lead, { arm: [-1.72, 0.30, 0.34], fore: [0, 0, 0.56], hand: [0.18, 0, -0.24] }) },
    release: { torso: [0.10, -0.78, -0.04], pelvis: [0.04, -0.42, 0],
      ...armChanges(p, p.lead, { arm: [-1.22, -0.40, -0.78], fore: [0, 0, 0.12], hand: [0.16, 0, -0.30] }),
      ...legChanges(p, 'left', { leg: [-0.48, 0, 0.18], shin: [0.44, 0, 0] }) },
    recover: { torso: [0.02, -0.30, 0], ...armChanges(p, p.lead, { arm: [-0.82, -0.16, -0.36] }) }
  })
});

function identityShape(q, p) {
  const v = p.jitter * 5.5 + p.bias * 0.55;
  return {
    wind: mix(q.wind, { torso: [0, v, 0], pelvis: [0, v * 0.55, 0], [p.leadArm]: [0, 0, v * 0.45] }),
    hit: mix(q.hit, { torso: [0, -v, 0], head: [0, -v * 0.5, 0], [p.offArm]: [0, 0, -v * 0.35] }),
    hold: mix(q.hold, { torso: [0, v * 0.55, 0] })
  };
}

function identityUltimateShape(q, p) {
  const v = p.jitter * 5.5 + p.bias * 0.55;
  return {
    charge: mix(q.charge, { torso: [0, v, 0], pelvis: [0, v * 0.55, 0], [p.leadArm]: [0, 0, v * 0.45] }),
    release: mix(q.release, { torso: [0, -v, 0], head: [0, -v * 0.5, 0], [p.offArm]: [0, 0, -v * 0.35] }),
    recover: mix(q.recover, { torso: [0, v * 0.55, 0] })
  };
}

function signature(p) {
  const shape = SIGNATURES[p.sig] || SIGNATURES.fist;
  const q = identityShape(shape(p), p);
  return frames(p, [
    [0, {}],
    [0.20, q.wind],
    [0.38, q.hit],
    [0.58, q.hold],
    [0.82, { torso: [0.02, 0, 0] }],
    [1, {}]
  ]);
}

function ultimate(p) {
  const shape = ULTIMATES[p.ult] || ULTIMATES.rush;
  const q = identityUltimateShape(shape(p), p);
  return frames(p, [
    [0, {}],
    [0.20, q.charge],
    [0.44, q.release],
    [0.64, q.release],
    [0.84, q.recover],
    [1, {}]
  ]);
}

const SLOT_BUILDERS = Object.freeze({
  light1: lightOne,
  light2: lightTwo,
  light3: lightThree,
  light4: lightFour,
  light5: lightFive,
  heavy,
  heavyLauncher: launcher,
  heavySlam: slam,
  special: signature,
  ultimate,
  grab: grabMotion,
  throw: throwMotion
});

const COMPLETE_SLOTS = Object.freeze({
  light1: 'light1', light2: 'light2', light3: 'light3', light4: 'light4', light5: 'light5',
  light: 'light1', finisher: 'light5', heavy: 'heavy', heavyFinisher: 'heavySlam',
  heavyLauncher: 'heavyLauncher', heavySlam: 'heavySlam',
  air: 'light3', airFinisher: 'light4', counter: 'light2',
  special: 'special', ultimate: 'ultimate', grab: 'grab', throw: 'throw'
});

function buildSet(profile) {
  const lead = profile.lead === 'left' ? 'left' : 'right';
  const off = lead === 'right' ? 'left' : 'right';
  const baseGuard = GUARDS[profile.guard] || GUARDS.balanced;
  // Two fighters can share a guard family and a weapon family without sharing a silhouette. This
  // deterministic, profile-owned offset changes the resting shoulder/hip line and head angle just
  // enough that a generated light or heavy is never byte-identical to another identity's. It is a
  // stance change, not a random animation; the same identity always gets the same offset.
  const beat = Number(profile.beat) || 0;
  // Use the full beat, not a small modulus: identities with beats 9 apart otherwise collapse onto
  // the same stance offset (Link/Captain Jack, Doctor Strange/Voldemort) and their shared-family
  // motions become byte-identical.
  const jitter = (beat - 17) * 0.0035;
  // A second identity-owned axis changes the strike trajectory itself, not just the stance: a
  // boxer's lead can come from a different shoulder line, a caster can release slightly across the
  // body. This is what keeps two members of one family from reading as the same punch.
  const bias = ((beat * 11) % 17 - 8) * 0.018;
  const guardPose = Object.freeze(mix(baseGuard, {
    torso: [0, jitter, 0], head: [0, -jitter * 0.6, 0], pelvis: [0, jitter * 0.35, 0],
    rightArm: [0, 0, jitter * 0.55], leftArm: [0, 0, -jitter * 0.55]
  }));
  // The profile supplies readable intent; these four derived fields let every builder address the
  // same joints without each one re-implementing side selection.
  const p = Object.freeze({
    ...profile,
    amp: Number(profile.amp) || 1,
    lead,
    off,
    jitter,
    bias,
    leadArm: `${lead}Arm`, offArm: `${off}Arm`,
    leadFore: `${lead}Fore`, offFore: `${off}Fore`,
    leadLeg: `${lead}Leg`, offLeg: `${off}Leg`,
    guardPose
  });
  const motions = {};
  for (const [slot, builder] of Object.entries(SLOT_BUILDERS)) motions[slot] = builder(p);
  return Object.freeze(motions);
}

export const ROSTER_MOTIONS = Object.freeze(
  Object.fromEntries(Object.entries(ROSTER_PROFILES).map(([identity, profile]) => [identity, buildSet(profile)]))
);

export const ROSTER_MOTION_BY_IDENTITY = Object.freeze(
  Object.fromEntries(Object.keys(ROSTER_PROFILES).map(identity => [identity, identity]))
);

export const ROSTER_AUTHORED_SLOTS = Object.freeze(
  Object.fromEntries(Object.keys(ROSTER_PROFILES).map(identity => [identity, COMPLETE_SLOTS]))
);

export const ROSTER_SIGNATURE_FAMILIES = Object.freeze(
  Object.fromEntries(Object.entries(ROSTER_PROFILES).map(([identity, profile]) => [identity, profile.sig]))
);

export const ROSTER_ULTIMATE_FAMILIES = Object.freeze(
  Object.fromEntries(Object.entries(ROSTER_PROFILES).map(([identity, profile]) => [identity, profile.ult]))
);
