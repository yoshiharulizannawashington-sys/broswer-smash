import { ROSTER_AUTHORED_SLOTS } from './attack_motions_roster.js';

// The animation manifest: one source of truth for "which clip plays this gameplay state".
//
// Before this, three places disagreed about clip coverage. The clip library carried 39 authored
// states, every roster GLB shipped 25 baked ones, and the baked-rig binder in human_fighter.js
// picked clips with ad hoc `find('jab', 'punch', ...)` searches that could bind a heavier clip
// because its name contained the lighter one. Nothing declared what was *required*, so a missing
// kick or grab was invisible: the state simply played nothing, or played the wrong clip.
//
// Each state below declares:
//   id       the gameplay state, named for the Phase 11 requirement list
//   phase    'ground' or 'air'
//   loop     whether the clip is expected to loop (checked against CLIP_SPECS)
//   library  the clip id in anim/clip_library.js (rigs driven by the state machine)
//   baked    aliases searched in a rig's own baked clips, most specific first
//   fallback the baked alias used when the rig ships no clip for this state
//   note     why a fallback is legitimate, when one is used
//
// `attackClipsFor` adds per-character attack variety on top: two fighters no longer have to
// throw the same two punches, and the difference is a real clip choice rather than a colour.

/** Ground states, in the order the Phase 11 brief lists them. */
const GROUND = [
  { id: 'idle', label: 'Idle', library: 'idle', baked: ['idle', 'stand'], loop: true },
  { id: 'breathing', label: 'Breathing', library: 'idle', baked: ['idle'], loop: true,
    note: 'Breathing is authored into the idle loop (chest and shoulder rise); no separate clip.' },
  { id: 'walk', label: 'Walking', library: 'walk', baked: ['walk', 'locomotion'], loop: true },
  { id: 'running', label: 'Running', library: 'run', baked: ['run'], loop: true },
  { id: 'turning', label: 'Turning', library: 'turn', baked: ['turn', 'walk'], loop: false,
    fallback: 'walk', note: 'Baked bodies turn inside the locomotion clip; no separate turn.' },
  { id: 'jumping', label: 'Jumping', library: 'jump', baked: ['jump'], loop: false },
  { id: 'landing', label: 'Landing', library: 'land', baked: ['land', 'landing'], loop: false },
  { id: 'lightPunch', label: 'Light punch', library: 'jab', baked: ['jab', 'light_punch'], loop: false },
  { id: 'heavyPunch', label: 'Heavy punch', library: 'heavy_punch', baked: ['heavy_punch', 'heavy'], loop: false },
  { id: 'lightKick', label: 'Light kick', library: 'front_kick', baked: ['front_kick', 'light_kick', 'kick'], loop: false,
    fallback: 'launcher', note: 'Baked roster bodies carry one kick-family clip (launcher/air_attack) rather than a light kick.' },
  { id: 'heavyKick', label: 'Heavy kick', library: 'spinning_kick', baked: ['spinning_kick', 'heavy_kick', 'roundhouse', 'kick'], loop: false,
    fallback: 'launcher', note: 'Same one-kick-family limitation as the light kick; the heavy kick shares the kick clip.' },
  { id: 'blocking', label: 'Blocking', library: 'block', baked: ['block', 'guard'], loop: true },
  { id: 'dodging', label: 'Dodging', library: 'dodge_right', baked: ['dodge', 'evade', 'roll'], loop: false },
  { id: 'grabbing', label: 'Grabbing', library: 'grab', baked: ['grab', 'grapple'], loop: false,
    fallback: 'throw', note: 'Baked bodies ship the throw but not a separate grab; the throw reads as the hold-and-release.' },
  { id: 'throwing', label: 'Throwing', library: 'throw', baked: ['throw'], loop: false },
  { id: 'staggering', label: 'Staggering', library: 'hit_light', baked: ['hit_light', 'stagger'], loop: false },
  { id: 'hitReaction', label: 'Hit reaction', library: 'hit_heavy', baked: ['hit_heavy', 'hit'], loop: false },
  { id: 'knockdown', label: 'Knockdown', library: 'knockdown', baked: ['knockdown', 'knock_down'], loop: false },
  { id: 'gettingUp', label: 'Getting up', library: 'get_up', baked: ['get_up', 'getup', 'stand_up'], loop: false },
  { id: 'victory', label: 'Victory', library: 'victory', baked: ['victory', 'win'], loop: false },
  { id: 'defeat', label: 'Defeat', library: 'defeat', baked: ['defeat', 'lose'], loop: false }
];

/** Air states. */
const AIR = [
  { id: 'takeoff', label: 'Take-off', library: 'fly_start', baked: ['fly_start', 'fly', 'takeoff'], loop: false },
  { id: 'hovering', label: 'Hovering', library: 'fly_loop', baked: ['hover'], loop: true },
  { id: 'forwardFlight', label: 'Forward flight', library: 'fly_loop', baked: ['fly'], loop: true },
  { id: 'backwardFlight', label: 'Backward flight', library: 'fly_loop', baked: ['fly'], loop: true,
    fallback: 'fly', note: 'Flight is driven by thrust direction over one flight loop; there is no reversed clip.' },
  { id: 'sideFlight', label: 'Side flight', library: 'strafe_right', baked: ['strafe'], loop: true },
  { id: 'fastFlight', label: 'Fast flight', library: 'fly_boost', baked: ['fly_boost', 'fly'], loop: true,
    fallback: 'fly', note: 'Baked bodies boost with the same flight loop at a higher playback rate.' },
  { id: 'flightTurn', label: 'Flight turning', library: 'fly_turn', baked: ['fly_turn', 'fly'], loop: true,
    fallback: 'fly', note: 'Banking is applied procedurally to the flight loop on baked bodies.' },
  { id: 'aerialAttack', label: 'Aerial attack', library: 'front_kick', baked: ['air_attack', 'airattack'], loop: false },
  { id: 'aerialHitReaction', label: 'Aerial hit reaction', library: 'hit_heavy', baked: ['hit_heavy'], loop: false },
  { id: 'aerialKnockback', label: 'Aerial knockback', library: 'launch', baked: ['launch', 'hit_heavy'], loop: false,
    fallback: 'hit_heavy', note: 'Baked bodies use the heavy hit clip for an airborne launch; the launch arc is gameplay physics.' },
  { id: 'flightLanding', label: 'Flight landing', library: 'fly_land', baked: ['land', 'fly_land'], loop: false }
];

export const REQUIRED_STATES = Object.freeze([...GROUND, ...AIR].map(state => Object.freeze(state)));

/** Required states by id, for callers that only need one. */
export const STATE_BY_ID = Object.freeze(Object.fromEntries(REQUIRED_STATES.map(s => [s.id, s])));

/**
 * Resolve a state against a rig's own baked clip names.
 * Exact matches win before substring matches, and aliases are tried most-specific first, so a
 * body shipping both `jab` and `heavy_punch` cannot have its jab stolen by the longer name.
 */
export function resolveBakedState(stateId, clipNames = []) {
  const state = STATE_BY_ID[stateId];
  if (!state) return null;
  const entries = clipNames.map(name => [name, String(name).toLowerCase()]);
  for (const alias of state.baked) {
    const exact = entries.find(([, lower]) => lower === alias);
    if (exact) return { clip: exact[0], via: 'exact' };
  }
  for (const alias of state.baked) {
    const partial = entries.find(([, lower]) => lower.includes(alias));
    if (partial) return { clip: partial[0], via: 'alias' };
  }
  return null;
}

/**
 * Resolve the clip a state should play on a baked rig, honouring the declared fallback.
 * Returns `{ clip, via }` where via is 'exact' | 'alias' | 'fallback' | null.
 */
export function bakedClipFor(stateId, clipNames = []) {
  const direct = resolveBakedState(stateId, clipNames);
  if (direct) return direct;
  const state = STATE_BY_ID[stateId];
  if (!state?.fallback) return { clip: null, via: null };
  const entries = clipNames.map(name => [name, String(name).toLowerCase()]);
  for (const alias of [state.fallback, ...state.baked]) {
    const exact = entries.find(([, lower]) => lower === alias);
    if (exact) return { clip: exact[0], via: 'fallback' };
  }
  for (const alias of [state.fallback, ...state.baked]) {
    const partial = entries.find(([, lower]) => lower.includes(alias));
    if (partial) return { clip: partial[0], via: 'fallback' };
  }
  return { clip: null, via: null };
}

/**
 * Attack slot defaults. These are the mappings the game shipped with, kept identical so a fighter
 * without an override behaves exactly as before.
 */
export const DEFAULT_ATTACK_CLIPS = Object.freeze({
  light: 'jab', light2: 'combo_1', finisher: 'combo_2',
  heavy: 'heavy_punch', heavyFinisher: 'spinning_kick',
  air: 'front_kick', airFinisher: 'spinning_kick', counter: 'uppercut'
});

/**
 * Per-character attack clips. Distinct fighters get distinct strike *animation*, not just distinct
 * damage numbers, and only from clips that already exist in the library - no invented weapons or
 * moves. A brawler swings a rising heavy, an agile fighter kicks, a controlled fighter uses the
 * straight cross.
 */
export const ATTACK_CLIP_STYLES = Object.freeze({
  brawler: { heavy: 'uppercut', finisher: 'spinning_kick', light2: 'combo_1', counter: 'uppercut' },
  agile: { light2: 'front_kick', heavy: 'front_kick', finisher: 'spinning_kick', air: 'front_kick' },
  controlled: { light2: 'combo_1', heavy: 'cross_punch', finisher: 'spinning_kick' },
  martial: { light2: 'combo_1', heavy: 'spinning_kick', finisher: 'uppercut' }
});

/** Identity -> style. Anything unlisted falls back to its archetype, then to the defaults. */
export const ATTACK_STYLE_BY_IDENTITY = Object.freeze({
  kratos: 'brawler',
  arnold_schwarzenegger: 'brawler',
  hulk_bruce_banner: 'brawler',
  all_might: 'brawler',
  saitama: 'brawler',
  thor: 'brawler',
  aang: 'agile',
  naruto_uzumaki: 'agile',
  sasuke_uchiha: 'agile',
  levi_ackerman: 'agile',
  spider_man: 'agile',
  iron_spider: 'agile',
  kaze: 'agile',
  edna_mode: 'controlled',
  l_death_note_style: 'controlled',
  captain_jack_sparrow: 'controlled',
  goku: 'martial',
  vegeta: 'martial',
  madara_uchiha: 'martial',
  hashirama_senju: 'martial'
});

/** Archetype fallbacks, so an identity added later still gets a coherent style. */
export const ATTACK_STYLE_BY_ARCHETYPE = Object.freeze({
  brawler: 'brawler',
  ninja: 'agile',
  warrior: 'martial',
  mage: 'controlled',
  cyborg: 'controlled'
});

/** The attack slots for a fighter: defaults, then identity style, then archetype style. */
/**
 * Imported combat clip sets: a body that ships its own keyframed strike clips in a separate
 * clip-only GLB, bound onto the mounted skeleton by bone name. The manifest owns the slot -> clip
 * names so the mixer path (human_fighter.js) and the controller path (animation_controller.js)
 * resolve the same strike from one table, and so a test can assert the exact clip per move.
 *
 * The clips are authored by assets/blender/infantry_combat_animations.py on the imported rig: they
 * move the real 24 joints, and the source model file is never re-exported.
 */
export const IMPORTED_ATTACK_CLIP_SETS = Object.freeze({
  infantry: Object.freeze({
    url: '/models/characters/roster_hd/infantry_combat.glb',
    authoredBy: 'assets/blender/infantry_combat_animations.py',
    slots: Object.freeze({
      // Manifest slot names, used by attackClipsFor/attackClipId.
      light: 'Infantry_RifleButt', light2: 'Infantry_CombatCross', finisher: 'Infantry_BootKick',
      heavy: 'Infantry_ArmourBreaker', heavyFinisher: 'Infantry_StockSlam',
      air: 'Infantry_JumpKnee', airFinisher: 'Infantry_JumpKnee', counter: 'Infantry_CombatCross',
      // Resolved move ids (move_data.js). The mixer path indexes its bound actions by these.
      light1: 'Infantry_RifleButt', light3: 'Infantry_BootKick', light4: 'Infantry_CombatCross',
      light5: 'Infantry_BootKick', heavyLauncher: 'Infantry_StockSlam', heavySlam: 'Infantry_StockSlam',
      dive: 'Infantry_JumpKnee', antiAir: 'Infantry_StockSlam'
    })
  }),
  // The three roster bodies share one armature but not one melee table. Each entry below is a
  // separate authored GLB from roster_bespoke_animations.py; the prefix is the only thing the three
  // clip sets have in common.
  superman: Object.freeze({
    url: '/models/characters/bespoke/superman_bespoke.glb',
    authoredBy: 'assets/blender/roster_bespoke_animations.py',
    slots: Object.freeze({
      light: 'Superman_Jab', light1: 'Superman_Jab', light2: 'Superman_Jab',
      light3: 'Superman_Kick', light4: 'Superman_Kick', light5: 'Superman_Kick',
      finisher: 'Superman_Kick',
      heavy: 'Superman_Heavy', heavyLauncher: 'Superman_Heavy', heavySlam: 'Superman_Heavy',
      heavyFinisher: 'Superman_Heavy',
      air: 'Superman_Air', airFinisher: 'Superman_Air', counter: 'Superman_Jab',
      special: 'Superman_Special', dive: 'Superman_Air', antiAir: 'Superman_Heavy'
    })
  }),
  // Goku's imported body mounts a 73-joint skeleton, not the roster's 19-bone armature, so his
  // original bespoke clip file could not bind a single track. These clips are authored directly on
  // the imported joint names by scripts/author-goku-clips.mjs, in a clip-only GLB: the verified body
  // is never re-exported.
  goku: Object.freeze({
    url: '/models/characters/bespoke/goku_animated.glb',
    authoredBy: 'scripts/author-goku-clips.mjs',
    slots: Object.freeze({
      light: 'Goku_Jab', light1: 'Goku_Jab', light2: 'Goku_Cross',
      light3: 'Goku_Kick', light4: 'Goku_Punch4', light5: 'Goku_Punch5',
      finisher: 'Goku_Punch5',
      heavy: 'Goku_Heavy', heavyLauncher: 'Goku_Launcher', heavySlam: 'Goku_Slam',
      heavyFinisher: 'Goku_Heavy',
      air: 'Goku_AirPunch', airFinisher: 'Goku_AirKick', counter: 'Goku_Cross',
      special: 'Goku_Kamehameha', ultimate: 'Goku_Ultimate',
      grab: 'Goku_Grab', throw: 'Goku_Throw',
      dive: 'Goku_AirKick', antiAir: 'Goku_Launcher'
    })
  }),
  spider_man: Object.freeze({
    url: '/models/characters/bespoke/spider_man_bespoke.glb',
    authoredBy: 'assets/blender/roster_bespoke_animations.py',
    slots: Object.freeze({
      light: 'SpiderMan_Jab', light1: 'SpiderMan_Jab', light2: 'SpiderMan_Cross',
      light3: 'SpiderMan_Kick', light4: 'SpiderMan_Kick', light5: 'SpiderMan_Kick',
      finisher: 'SpiderMan_Kick',
      heavy: 'SpiderMan_Heavy', heavyLauncher: 'SpiderMan_Heavy', heavySlam: 'SpiderMan_Heavy',
      heavyFinisher: 'SpiderMan_Heavy',
      air: 'SpiderMan_Air', airFinisher: 'SpiderMan_Air', counter: 'SpiderMan_Jab',
      special: 'SpiderMan_Special', dive: 'SpiderMan_Air', antiAir: 'SpiderMan_Heavy'
    })
  }),
  // Hulk's imported body ships its own 19 authored clips on its 65-joint Bip001 rig. They are used
  // directly rather than re-authored: the slot table maps the game's attack ids onto the clips the
  // rig already animates, so nothing is retargeted and no bone is renamed.
  hulk_bruce_banner: Object.freeze({
    url: '/models/characters/imported/hulk/hulk.glb',
    authoredBy: 'Marvel Future Fight hero_hulk01_S09 clip set (supplied asset)',
    slots: Object.freeze({
      light: 'Armature|hero_hulk01_S09@atk01', light1: 'Armature|hero_hulk01_S09@atk01',
      light2: 'Armature|hero_hulk01_S09@atk02', light3: 'Armature|hero_hulk01_S09@skill01',
      light4: 'Armature|hero_hulk01_S09@skill02', light5: 'Armature|hero_hulk01_S09@skill05',
      finisher: 'Armature|hero_hulk01_S09@skill05',
      heavy: 'Armature|hero_hulk01_S09@atk02', heavyLauncher: 'Armature|hero_hulk01_S09@skill02',
      heavySlam: 'Armature|hero_hulk01_S09@skill01', heavyFinisher: 'Armature|hero_hulk01_S09@skill05',
      air: 'Armature|hero_hulk01_S09@atk02', airFinisher: 'Armature|hero_hulk01_S09@skill05',
      // skill02 is already the launcher and the dive/anti-air, so the signature used to replay a
      // launcher pose. skill03 is unused by the strike table and gives Thunderclap its own clip.
      counter: 'Armature|hero_hulk01_S09@atk01', special: 'Armature|hero_hulk01_S09@skill03',
      ultimate: 'Armature|hero_hulk01_S09@skill04',
      grab: 'Armature|hero_hulk01_S09@collection', throw: 'Armature|hero_hulk01_S09@skill05',
      dive: 'Armature|hero_hulk01_S09@skill02', antiAir: 'Armature|hero_hulk01_S09@skill02'
    })
  })
});

/** The imported clip set for a fighter, or null when its strikes are not imported clips. */
export function importedAttackClipsFor(fighter) {
  const identity = String(fighter?.identityKey || '').toLowerCase();
  return IMPORTED_ATTACK_CLIP_SETS[identity] || null;
}

/**
 * Imported reaction clip sets: a clip-only GLB authored on the same skeleton, carrying the states
 * a body needs to *react* rather than only attack - idle, jump, landing, light/heavy hit, knockdown,
 * get-up, victory and defeat.
 *
 * Authored by assets/blender/reaction_animations.py. Slot names are the runtime's own state keys,
 * so `human_fighter.js` can assign each one to the action its state machine already consults; the
 * clip names are lower-case suffixes and are matched case-insensitively here.
 */
export const IMPORTED_REACTION_CLIP_SETS = Object.freeze({
  infantry: Object.freeze({
    url: '/models/characters/roster_hd/infantry_reactions.glb',
    authoredBy: 'assets/blender/reaction_animations.py',
    slots: Object.freeze({
      idle: 'Infantry_idle',
      jump: 'Infantry_jump',
      land: 'Infantry_land',
      hit_light: 'Infantry_hit_light',
      hit_heavy: 'Infantry_hit_heavy',
      knockdown: 'Infantry_knockdown',
      get_up: 'Infantry_get_up',
      victory: 'Infantry_victory',
      defeat: 'Infantry_defeat'
    })
  }),
  // Naruto's reactions were authored on the same 567-bone Rigify rig as his body, so a landing or
  // a knockdown can be his own keyframes instead of the nearest generic clip the mount happened to
  // find. Slots are the runtime's own state keys; the binder assigns each one to the action its
  // state machine already reads.
  naruto_uzumaki: Object.freeze({
    url: '/models/characters/naruto_uzumaki/naruto_reactions.glb',
    authoredBy: 'assets/blender/naruto_reactions.py',
    slots: Object.freeze({
      idle: 'Naruto_idle',
      jump: 'Naruto_jump',
      land: 'Naruto_land',
      hit_light: 'Naruto_hit_light',
      hit_heavy: 'Naruto_hit_heavy',
      knockdown: 'Naruto_knockdown',
      get_up: 'Naruto_get_up',
      victory: 'Naruto_victory',
      defeat: 'Naruto_defeat'
    })
  }),
  superman: Object.freeze({
    url: '/models/characters/bespoke/superman_bespoke.glb',
    authoredBy: 'assets/blender/roster_bespoke_animations.py',
    slots: Object.freeze({ hit_light: 'Superman_HitLight', hit_heavy: 'Superman_HitHeavy' })
  }),
  // His states, not only his flinches: idle, walk, run, jump, land, guard, dodge, flight, the hit
  // reactions, the knockdown cycle and both match-end poses. The binder assigns each slot to the
  // action the state machine already reads, so no second animation path exists.
  goku: Object.freeze({
    url: '/models/characters/bespoke/goku_animated.glb',
    authoredBy: 'scripts/author-goku-clips.mjs',
    slots: Object.freeze({
      idle: 'Goku_Idle', jump: 'Goku_Jump', land: 'Goku_Land',
      hit_light: 'Goku_HitLight', hit_heavy: 'Goku_HitHeavy',
      knockdown: 'Goku_Knockdown', get_up: 'Goku_GetUp',
      victory: 'Goku_Victory', defeat: 'Goku_Defeat',
      walk: 'Goku_Walk', run: 'Goku_Run', sprint: 'Goku_Run',
      block: 'Goku_Block', dodge: 'Goku_Dodge',
      fly: 'Goku_Hover', hover: 'Goku_Hover',
      fly_takeoff: 'Goku_FlyTakeoff', fly_back: 'Goku_FlyBack',
      fly_turn: 'Goku_FlyTurn', fly_land: 'Goku_FlyLand', turn: 'Goku_Turn'
    })
  }),
  spider_man: Object.freeze({
    url: '/models/characters/bespoke/spider_man_bespoke.glb',
    authoredBy: 'assets/blender/roster_bespoke_animations.py',
    slots: Object.freeze({ hit_light: 'SpiderMan_HitLight', hit_heavy: 'SpiderMan_HitHeavy' })
  }),
  // The body's own clips, keyed to the runtime's state actions. Clips that this asset does not
  // contain (a true run/jump/guard) fall back to the nearest authored clip it does have, so the
  // fighter always animates instead of freezing in its bind pose.
  hulk_bruce_banner: Object.freeze({
    url: '/models/characters/imported/hulk/hulk.glb',
    authoredBy: 'Marvel Future Fight hero_hulk01_S09 clip set (supplied asset)',
    slots: Object.freeze({
      idle: 'Armature|hero_hulk01_S09@idle', walk: 'Armature|hero_hulk01_S09@walk',
      run: 'Armature|hero_hulk01_S09@dash', sprint: 'Armature|hero_hulk01_S09@dash',
      jump: 'Armature|hero_hulk01_S09@dash', land: 'Armature|hero_hulk01_S09@walk',
      block: 'Armature|hero_hulk01_S09@wait', dodge: 'Armature|hero_hulk01_S09@dash',
      hit_light: 'Armature|hero_hulk01_S09@hit', hit_heavy: 'Armature|hero_hulk01_S09@stun',
      knockdown: 'Armature|hero_hulk01_S09@stun', get_up: 'Armature|hero_hulk01_S09@idle',
      victory: 'Armature|hero_hulk01_S09@skill04', defeat: 'Armature|hero_hulk01_S09@die'
    })
  })
});

/** The imported reaction clip set for a fighter, or null when it has none. */
export function importedReactionClipsFor(fighter) {
  const identity = String(fighter?.identityKey || '').toLowerCase();
  return IMPORTED_REACTION_CLIP_SETS[identity] || null;
}

/**
 * Baked authored clips: the runtime-authored motion exported as real glTF animations.
 *
 * The authored keyframes used to exist only as three.js clips compiled at bind time. Blender now
 * bakes those exact compiled poses into a clip-only GLB on the same Rigify skeleton, so the motion
 * ships as an animation asset and is loaded like every other imported clip set. The runtime compile
 * stays as the fallback: if the GLB is missing or fails to load, nothing regresses.
 */
export const IMPORTED_AUTHORED_CLIP_SETS = Object.freeze({
  // Goku's three transformation sequences plus the Kamehameha charge loop. The strike and reaction
  // sets above carry his combat motion; this set exists so a form id selects its own activation arc
  // and the charge is bound on the same mixer as everything else.
  goku: Object.freeze({
    url: '/models/characters/bespoke/goku_animated.glb',
    authoredBy: 'scripts/author-goku-clips.mjs',
    strikes: Object.freeze({ kamehamehaCharge: 'Goku_KamehamehaCharge' }),
    forms: Object.freeze({
      'goku-super-saiyan': 'Goku_FormSuperSaiyan',
      'goku-super-saiyan-blue': 'Goku_FormSuperSaiyanBlue',
      'goku-ultra-instinct': 'Goku_FormUltraInstinct'
    })
  }),
  naruto_uzumaki: Object.freeze({
    url: '/models/characters/naruto_uzumaki/naruto_authored.glb',
    authoredBy: 'assets/blender/naruto_authored_bake.py',
    strikes: Object.freeze({
      light1: 'authored_light1', light2: 'authored_light2', light3: 'authored_light3',
      light4: 'authored_light4', light5: 'authored_light5',
      heavy: 'authored_heavy', heavyLauncher: 'authored_heavyLauncher', heavySlam: 'authored_heavySlam',
      special: 'authored_rasenshuriken', ultimate: 'authored_ultimate',
      shadowClone: 'authored_shadowClone', rasengan: 'authored_rasengan', giantRasengan: 'authored_giantRasengan',
      grab: 'authored_grab', throw: 'authored_throw'
    }),
    forms: Object.freeze({
      'sage-mode': 'authored_form_formSage',
      'nine-tails-chakra': 'authored_form_formNine',
      'kurama-link': 'authored_form_formKurama',
      'six-paths-sage': 'authored_form_formSixPaths',
      'baryon-mode': 'authored_form_formBaryon'
    })
  })
});

/** The baked authored clip set for a fighter, or null when its motion is compiled at runtime. */
export function importedAuthoredClipsFor(fighter) {
  const identity = String(fighter?.identityKey || '').toLowerCase();
  return IMPORTED_AUTHORED_CLIP_SETS[identity] || null;
}

/**
 * Imported kit-cast clips: moves a fighter fires from the ability bar, addressed by the ability's
 * own `motion` name rather than by a state action or an attack slot.
 *
 * Kept separate from the reaction set because a cast is selected by `abilityCast.motion` on the
 * fighter, and separate from the strike set because attacks and casts have different lifetimes:
 * a strike owns the body for its attack window, a cast owns it for its clip. A clip-only GLB means
 * the body mesh, materials and textures are never re-exported.
 */
export const IMPORTED_ABILITY_CLIP_SETS = Object.freeze({
  // Keyed by `abilityCast.motion`, the field the kit runtime already stamps from the ability def.
  goku: Object.freeze({
    url: '/models/characters/bespoke/goku_animated.glb',
    authoredBy: 'scripts/author-goku-clips.mjs',
    slots: Object.freeze({
      kiBlast: 'Goku_KiBlast',
      instantTransmission: 'Goku_InstantTransmission',
      dragonFist: 'Goku_DragonFist'
    })
  }),
  naruto_uzumaki: Object.freeze({
    url: '/models/characters/naruto_uzumaki/naruto_kunai.glb',
    authoredBy: 'assets/blender/naruto_kunai_animation.py',
    slots: Object.freeze({ kunai: 'Naruto_kunai' })
  })
});

/** The imported kit-cast clip set for a fighter, or null when it has none. */
export function importedAbilityClipsFor(fighter) {
  const identity = String(fighter?.identityKey || '').toLowerCase();
  return IMPORTED_ABILITY_CLIP_SETS[identity] || null;
}

/**
 * The imported slot an already-resolved attack should play, or null when this fighter has no
 * imported strike clips. The resolved move id leads, exactly as authoredStrikeSlotFor does it, so
 * a launcher and a slam cannot collapse onto one clip.
 */
export function importedStrikeSlotFor(fighter, attack, { step = 1, comboStep = step, airborne = false } = {}) {
  const set = importedAttackClipsFor(fighter);
  if (!set) return null;
  const slots = set.slots;
  const id = attack?.id ? String(attack.id) : '';
  if (id && slots[id]) return id;
  const kind = String(attack?.kind || '');
  if (kind === 'air-finisher') return slots.airFinisher ? 'airFinisher' : slots.air ? 'air' : null;
  if (kind === 'air-strike') return slots.air ? 'air' : null;
  if (kind === 'slam') return slots.heavySlam ? 'heavySlam' : slots.heavy ? 'heavy' : null;
  if (kind === 'heavy') return slots.heavy ? 'heavy' : null;
  if (kind === 'counter-strike') return slots.counter ? 'counter' : null;
  if (airborne) return slots.air ? 'air' : null;
  // A queued light strike can carry a stale step (the attack record was created on the first
  // press), while the fighter's own comboStep has already advanced. Take the later of the two so
  // the imported chain actually reaches light2..light5 instead of replaying light1 five times.
  const chain = Math.min(5, Math.max(1, comboStep, Number(fighter?.comboStep) || 0));
  return slots['light' + chain] ? 'light' + chain : slots.light ? 'light' : null;
}

/**
 * Attack slot -> authored motion slot, for identities whose strikes are real keyframes rather than
 * library clips. The controller asks for `authored_<slot>`; animation_controller compiles that id
 * from the motion against the rig it actually owns, so the same authoring drives both owners.
 */
export const AUTHORED_ATTACK_SLOTS = Object.freeze({
  // The roster's generated-but-authored sets. Each identity has its own guard, lead side, weapon
  // arc, signature release and ultimate release; the slot map is shared because the slot names are
  // the runtime contract, not because the motions are shared.
  ...ROSTER_AUTHORED_SLOTS,
  // Goku already has a bespoke motion table and imported strike clips. Keep his special out of the
  // authored map so the explicit Kamehameha clip remains the signature; the rest of his slots can
  // compile from GOKU_MOTIONS when the imported set is absent.
  goku: Object.freeze({
    light1: 'light1', light2: 'light2', light3: 'light3', light4: 'light4', light5: 'light5',
    finisher: 'light5', heavy: 'heavy', heavyLauncher: 'heavyLauncher', heavySlam: 'heavySlam',
    ultimate: 'ultimate', grab: 'grab', throw: 'throw',
    light: 'light1', heavyFinisher: 'heavySlam', air: 'light3', airFinisher: 'light4', counter: 'light2'
  }),
  naruto_uzumaki: {
    // By move id - the only value that separates a launcher from a slam.
    light1: 'light1', light2: 'light2', light3: 'light3', light4: 'light4', light5: 'light5',
    finisher: 'light5', heavy: 'heavy', heavyLauncher: 'heavyLauncher', heavySlam: 'heavySlam',
    // His signature special is RASENSHURIKEN (main.js SPECIAL_MOVES), so the special slot plays the
    // throw, not the Rasengan palm thrust. Rasengan itself is a kit cast below, with its own motion.
    special: 'rasenshuriken', ultimate: 'ultimate',
    // Kit abilities, so a cast plays the move it actually fires rather than a generic strike.
    shadowClone: 'shadowClone', rasengan: 'rasengan', giantRasengan: 'giantRasengan',
    // A grab and a throw are separate moves in move_data.js and read completely differently, so
    // they get separate motions instead of borrowing the special or the baked throw alone.
    grab: 'grab', throw: 'throw',
    // By manifest slot kind, for callers that only have a kind.
    light: 'light1', heavyFinisher: 'heavySlam',
    air: 'light4', airFinisher: 'heavyLauncher', counter: 'light3'
  }
});

/**
 * Transformation sequences: form id -> authored motion slot.
 *
 * A form used to be a stat change with an aura, so every tier looked identical on the frame it
 * landed. Each form now has its own activation arc (a seal, a crouch, a burst and a final pose),
 * selected by the form id the transform record carries. The ids are the ones movesets.js publishes
 * in Naruto's `forms` ladder.
 */
export const AUTHORED_FORM_SLOTS = Object.freeze({
  // The ids movesets.js publishes in Goku's `forms` ladder. Keyed by id, not by tier, so a missing
  // sequence can never borrow another form's animation.
  goku: Object.freeze({
    'goku-super-saiyan': 'formSuperSaiyan',
    'goku-super-saiyan-blue': 'formSuperSaiyanBlue',
    'goku-ultra-instinct': 'formUltraInstinct'
  }),
  naruto_uzumaki: Object.freeze({
    'sage-mode': 'formSage',
    'nine-tails-chakra': 'formNine',
    'kurama-link': 'formKurama',
    'six-paths-sage': 'formSixPaths',
    'baryon-mode': 'formBaryon'
  })
});

/** The form id -> motion slot table for a fighter, or null when it has no authored sequences. */
export function authoredFormClipsFor(fighter) {
  const identity = String(fighter?.identityKey || '').toLowerCase();
  return AUTHORED_FORM_SLOTS[identity] || null;
}

/**
 * Slots a body already ships a clip for, so the binder uses that clip instead of compiling a
 * procedural motion.
 *
 * The procedural motion sets were authored against the generated roster rig's bone names
 * (`RightArm`, `LeftLeg`). An imported body keeps its own skeleton — Naruto's is a 567-bone Rigify
 * chain — so a compiled motion that targets `RightArm` binds no tracks at all and the fighter
 * animates nothing, which is exactly why a cast used to freeze him in the rest pose while the
 * projectile still fired. An imported body that carries its own `rasengan` / `shadow_clone` clips
 * says so here, and those clips win because they are guaranteed to bind.
 */
export const BODY_CLIP_SLOTS = Object.freeze({
  naruto_uzumaki: Object.freeze({
    // Fallbacks only. His strikes, casts, grab, throw and ultimate all compile from his own authored
    // motion now; these baked clips are what the binder uses if a motion slot ever compiles to no
    // tracks, so a body can never end up with a bound slot that animates nothing.
    light1: 'jab', light3: 'front_kick', light4: 'spinning_kick', heavy: 'heavy_punch',
    heavyLauncher: 'spinning_kick', heavySlam: 'front_kick', air: 'front_kick',
    special: 'rasengan', rasengan: 'rasengan', shadowClone: 'shadow_clone', ultimate: 'transformation',
    block: 'block', hit: 'hit_light', knockdown: 'knockdown', victory: 'victory', defeat: 'defeat'
  })
});

/** The body clips a fighter's slots should prefer, or null when it has none. */
export function bodyClipSlotsFor(fighter) {
  const identity = String(fighter?.identityKey || '').toLowerCase();
  return BODY_CLIP_SLOTS[identity] || null;
}

/** The authored motion slots a fighter's attacks should use, or null when it has none. */
export function authoredAttackSlotsFor(fighter) {
  const identity = String(fighter?.identityKey || ('naruto_uzumaki' === String(fighter?.name || '').toLowerCase() ? 'naruto_uzumaki' : '')).toLowerCase();
  return AUTHORED_ATTACK_SLOTS[identity] || null;
}

/**
 * The authored motion slot an already-resolved attack should play, chosen from the move id first.
 *
 * The prefab body used to pick its authored strike from the coarse `kind` plus the chain step. That
 * could never reach the launcher, slam, counter or air-finisher slots: all four arrive as one of
 * three kinds, so the manifest's per-id mapping was bound and then ignored. `attack.id` is what the
 * gameplay code actually committed to (move_data.js), and animation_controller already treats a
 * resolved id as outranking the chain step, so the prefab path now agrees with it.
 *
 * Returns a motion slot name (the key of the bound action map), or null for an identity with no
 * authored motion. `kind` and `step` remain as fallbacks for queue items that carry no id, and an
 * airborne attack never falls back to a ground slot.
 */
export function authoredStrikeSlotFor(fighter, attack, { step = 1, comboStep = step, airborne = false } = {}) {
  const authored = authoredAttackSlotsFor(fighter);
  if (!authored) return null;
  const byId = attack?.id ? authored[attack.id] : null;
  if (byId) return byId;
  const kind = String(attack?.kind || '');
  const byKind = kind === 'counter-strike' ? authored.counter
    : kind === 'air-finisher' ? authored.airFinisher
    : kind === 'air-strike' ? authored.air
    : kind === 'slam' ? (step >= 4 ? authored.heavyFinisher : authored.heavy)
    : kind === 'heavy' ? (comboStep >= 3 ? authored.heavyFinisher : authored.heavy)
    : null;
  if (byKind) return byKind;
  if (airborne) return authored.air;
  if (step >= 5) return authored.finisher;
  return authored[`light${Math.min(5, Math.max(1, step))}`] || authored.light;
}

export function attackClipsFor(fighter) {
  const identity = String(fighter?.identityKey || '').toLowerCase();
  const style = ATTACK_STYLE_BY_IDENTITY[identity]
    || ATTACK_STYLE_BY_ARCHETYPE[String(fighter?.archetype || '').toLowerCase()];
  const overrides = (style && ATTACK_CLIP_STYLES[style]) || null;
  const slots = overrides ? { ...DEFAULT_ATTACK_CLIPS, ...overrides } : { ...DEFAULT_ATTACK_CLIPS };
  // A fighter with authored motion outranks the style table: its own strike is the point of the
  // per-identity work, and a style clip would silently replace it with a generic punch.
  const authored = authoredAttackSlotsFor(fighter);
  if (authored) for (const [kind, motionSlot] of Object.entries(authored)) slots[kind] = `authored_${motionSlot}`;
  // Imported strike clips are the most specific answer there is: the identity's own keyframed
  // motion on its own skeleton, so they outrank both the style table and the shared defaults.
  const imported = importedAttackClipsFor(fighter);
  if (imported) for (const [kind, clip] of Object.entries(imported.slots)) slots[kind] = clip;
  return slots;
}

/**
 * Signature-move clips per identity. A fighter listed here plays its own authored move instead of
 * the shared special_attack clip; anything unlisted keeps the shared clip, so this cannot leave a
 * fighter without an animation. Clip ids must exist in clip_library.js and in the data manifest.
 */
export const SPECIAL_CLIP_BY_IDENTITY = Object.freeze({
  goku: 'goku_kamehameha',
  iron_man_tony_stark: 'iron_man_repulsor',
  spider_man: 'spider_man_web_zip'
});

/** The clip a fighter's signature move should play. */
export function specialClipFor(fighter) {
  const identity = String(fighter?.identityKey || '').toLowerCase();
  // A hand-authored signature clip is the most specific answer and must not be displaced by a
  // generated family motion. Goku's Kamehameha, Iron Man's repulsor and Spider-Man's web zip keep
  // their bespoke clips; everyone else compiles their authored special.
  if (SPECIAL_CLIP_BY_IDENTITY[identity]) return SPECIAL_CLIP_BY_IDENTITY[identity];
  const authored = authoredAttackSlotsFor(fighter);
  if (authored?.special) return `authored_${authored.special}`;
  return 'special_attack';
}

/** Every distinct clip the manifest can ask for, used by the coverage test and the asset report. */
export function manifestClipIds() {
  return [...new Set([
    ...REQUIRED_STATES.map(state => state.library),
    ...Object.values(DEFAULT_ATTACK_CLIPS),
    ...Object.values(ATTACK_CLIP_STYLES).flatMap(style => Object.values(style)),
    ...Object.values(SPECIAL_CLIP_BY_IDENTITY)
  ])].sort();
}
