// Per-character height, proportion and relative-scale profiles.
//
// Browser Bros used one 2.05 m target for every imported body. That is wrong for the roster:
// Hulk is a 2.45 m bruiser, Mario is a short platform fighter, Edna is deliberately tiny, and
// Professor X is seated. The authored standalone bodies already differ (Superman 1.896 m,
// Hulk 2.320 m, Mario 1.754 m, Edna 1.510 m), but imported bodies were normalised to 2.05 m and
// the prefab swap could overwrite a profile. This module is the single source of truth for the
// target height, build, collision radius and combat-volume scale of every selectable identity.
//
// 2.05 m remains only the authoring baseline for scale ratios. No character is forced to it.
//
// Body proportions are never re-authored here. Every body is scaled uniformly about its own
// origin; `build` is a classification of the depiction, not a licence to stretch an axis.
import * as THREE from 'three';

export const AUTHORING_BASELINE_HEIGHT = 2.05;

const profile = (label, targetHeight, options = {}) => {
  const heightScale = +(targetHeight / AUTHORING_BASELINE_HEIGHT).toFixed(4);
  const bodyRadius = options.bodyRadius ?? Math.min(.95, Math.max(.4, .36 + targetHeight * .13));
  return Object.freeze({
    label,
    targetHeight,
    referenceHeight: options.referenceHeight ?? targetHeight,
    // Source-media reference for the chosen height. Imported bodies are matched to this figure,
    // not to a convenient round number.
    source: options.source || 'source-media depiction; height taken from the character’s commonly listed stature',
    build: options.build || 'human',
    proportions: Object.freeze({ frame: options.build || 'human', uniformOnly: true }),
    // Ground alignment and root position are applied by the mount path: feet land on y=0 and the
    // fighter root sits at the same point the procedural body used.
    groundY: 0,
    rootY: 0,
    bodyRadius,
    hurtboxRadius: options.hurtboxRadius ?? +(bodyRadius * .92).toFixed(3),
    hurtboxHeight: options.hurtboxHeight ?? +(targetHeight * .92).toFixed(3),
    // Derived combat dimensions. A 1.5 m fighter's arm/weapon volumes are smaller than a 2.45 m
    // one's; the game clamps these ratios so an extreme body cannot create an unusable hitbox.
    hitboxScale: heightScale,
    weaponScale: heightScale,
    // Camera framing follows the body rather than a single human height.
    cameraHeight: options.cameraHeight ?? +(targetHeight * .55).toFixed(3),
    cameraDistanceScale: +(0.9 + heightScale * 0.1).toFixed(3),
    seated: Boolean(options.seated),
    notes: options.notes || ''
  });
};

// The keys are the identity slugs used by the roster, movesets and manifest.
// Height is the in-game target in metres, not a claim that every adaptation is identical.
// Reference heights come from the character's commonly established stature; where a character
// changes size across versions, the version used by this roster is named in `source`.
export const CHARACTER_SCALE_PROFILES = Object.freeze({
  // ---- launch roster -------------------------------------------------------------------
  infantry: profile('Infantry', 1.8, { build: 'soldier', bodyRadius: .62, source: 'Generic soldier archetype; 5 ft 11 in service build' }),
  superman: profile('Superman', 1.91, { build: 'powerhouse', bodyRadius: .72, referenceHeight: 1.91, source: 'DC Comics canon: 6 ft 3 in (191 cm)' }),
  iron_man_tony_stark: profile('Iron Man', 1.98, { build: 'armored', bodyRadius: .70, referenceHeight: 1.98, source: 'Armoured suit height 6 ft 6 in (198 cm); Tony Stark himself is 6 ft 1 in' }),
  hulk_bruce_banner: profile('Hulk', 2.45, { build: 'massive', bodyRadius: .95, referenceHeight: 2.44, source: 'Marvel.com Hulk profile 7 ft 6 in; comics range 7–8 ft (2.13–2.44 m), MCU 8 ft 2 in. 2.45 m sits at the MCU end' }),
  green_lantern_hal_jordan: profile('Green Lantern', 1.88, { build: 'athletic', bodyRadius: .64, referenceHeight: 1.88, source: 'DC Comics canon: 6 ft 2 in (188 cm)' }),
  wolverine_logan: profile('Wolverine', 1.6, { build: 'compact', bodyRadius: .54, referenceHeight: 1.6, source: 'Marvel Comics canon: 5 ft 3 in (160 cm); deliberately short and stocky' }),
  wonder_woman: profile('Wonder Woman', 1.83, { build: 'amazonian', bodyRadius: .64, referenceHeight: 1.83, source: 'DC Comics canon: 6 ft 0 in (183 cm)' }),
  professor_x_charles_xavier: profile('Professor X', 1.3, { build: 'seated', bodyRadius: .62, referenceHeight: 1.3, seated: true, source: 'Seated height including the wheelchair, not the standing 6 ft 0 in body' }),
  the_flash_barry_allen: profile('The Flash', 1.83, { build: 'lean', bodyRadius: .58, referenceHeight: 1.83, source: 'DC Comics canon: 6 ft 0 in (183 cm)' }),
  aquaman: profile('Aquaman', 1.93, { build: 'powerhouse', bodyRadius: .72, referenceHeight: 1.93, source: 'DC Comics canon: 6 ft 4 in (193 cm)' }),
  doctor_strange: profile('Doctor Strange', 1.88, { build: 'athletic', bodyRadius: .63, referenceHeight: 1.88, source: 'Marvel Comics canon: 6 ft 2 in (188 cm)' }),
  arnold_schwarzenegger: profile('The Terminator', 1.88, { build: 'armored', bodyRadius: .76, referenceHeight: 1.88, source: 'T-800 depiction modelled on Arnold Schwarzenegger: 6 ft 2 in (188 cm)' }),
  goku: profile('Goku', 1.75, { build: 'martial-artist', bodyRadius: .60, referenceHeight: 1.75, source: 'Dragon Ball canon: 5 ft 9 in (175 cm) as an adult' }),
  naruto_uzumaki: profile('Naruto Uzumaki', 1.8, { build: 'ninja', bodyRadius: .60, referenceHeight: 1.8, source: 'Naruto Shippuden canon: 5 ft 11 in (180 cm)' }),
  vegeta: profile('Vegeta', 1.65, { build: 'compact', bodyRadius: .58, referenceHeight: 1.65, source: 'Dragon Ball canon: 5 ft 5 in (165 cm); deliberately shorter than Goku' }),
  saitama: profile('Saitama', 1.75, { build: 'lean', bodyRadius: .58, referenceHeight: 1.75, source: 'One-Punch Man canon: 5 ft 9 in (175 cm)' }),
  l_death_note_style: profile('Light Yagami', 1.78, { build: 'lean', bodyRadius: .57, referenceHeight: 1.78, source: 'Death Note canon: 5 ft 10 in (178 cm); supplied model measured 1.82 m' }),
  all_might: profile('All Might', 2.2, { build: 'massive', bodyRadius: .80, referenceHeight: 2.2, source: 'My Hero Academia: 7 ft 2.6 in (220 cm) in muscle form' }),
  edward_elric: profile('Edward Elric', 1.65, { build: 'compact', bodyRadius: .55, referenceHeight: 1.65, source: 'Fullmetal Alchemist canon: 5 ft 5 in (165 cm) as an adult' }),
  levi_ackerman: profile('Levi Ackerman', 1.6, { build: 'compact', bodyRadius: .54, referenceHeight: 1.6, source: 'Attack on Titan canon: 5 ft 3 in (160 cm)' }),
  mario: profile('Mario', 1.55, { build: 'short', bodyRadius: .49, referenceHeight: 1.55, source: 'Nintendo-approved 1:1 statue and commonly cited canon: 5 ft 1 in (155 cm)' }),
  luigi: profile('Luigi', 1.73, { build: 'tall-short', bodyRadius: .51, referenceHeight: 1.73, source: 'Commonly cited game-version height: about 5 ft 8 in (173 cm); taller than Mario, still short' }),
  kratos: profile('Kratos', 1.93, { build: 'powerhouse', bodyRadius: .76, referenceHeight: 1.93, source: 'God of War canon: 6 ft 4 in (193 cm)' }),
  link: profile('Link', 1.7, { build: 'athletic', bodyRadius: .58, referenceHeight: 1.7, source: 'Zelda canon (adult Link): about 5 ft 7 in (170 cm)' }),
  master_chief: profile('Master Chief', 2.18, { build: 'armored', bodyRadius: .74, referenceHeight: 2.18, source: 'Halo: 7 ft 2 in (218 cm) in Mjolnir armour' }),
  geralt_of_rivia: profile('Geralt', 1.85, { build: 'athletic', bodyRadius: .63, referenceHeight: 1.85, source: 'Witcher canon: 6 ft 1 in (185 cm)' }),
  doom_slayer: profile('Doom Slayer', 2.03, { build: 'armored', bodyRadius: .74, referenceHeight: 2.03, source: 'DOOM depiction: 6 ft 8 in (203 cm) in armour' }),
  thor: profile('Thor', 1.98, { build: 'powerhouse', bodyRadius: .76, referenceHeight: 1.98, source: 'Marvel Comics canon: 6 ft 6 in (198 cm)' }),
  aang: profile('Aang', 1.5, { build: 'young', bodyRadius: .52, referenceHeight: 1.5, source: 'Avatar: The Last Airbender canon: 4 ft 11 in (150 cm) as a 12-year-old' }),
  madara_uchiha: profile('Madara Uchiha', 1.79, { build: 'athletic', bodyRadius: .61, referenceHeight: 1.79, source: 'Naruto canon: 5 ft 10.5 in (179 cm)' }),
  hashirama_senju: profile('Hashirama Senju', 1.85, { build: 'athletic', bodyRadius: .64, referenceHeight: 1.85, source: 'Naruto canon: 6 ft 1 in (185 cm)' }),
  lord_voldemort: profile('Harry Potter', 1.9, { build: 'athletic', bodyRadius: .60, referenceHeight: 1.877, source: 'Supplied rigged Harry Potter model measured 1.877 m; slot scale retained at 1.90 m for combat parity' }),
  sasuke_uchiha: profile('Sasuke Uchiha', 1.82, { build: 'athletic', bodyRadius: .60, referenceHeight: 1.82, source: 'Naruto Shippuden canon: 5 ft 11.5 in (182 cm)' }),
  edna_mode: profile('Edna Mode', 1.3, { build: 'short', bodyRadius: .44, referenceHeight: 1.3, source: 'The Incredibles depiction: deliberately tiny, about 4 ft 3 in (130 cm)' }),
  captain_jack_sparrow: profile('Captain Jack Sparrow', 1.78, { build: 'lean', bodyRadius: .58, referenceHeight: 1.78, source: 'Pirates depiction modelled on Johnny Depp: 5 ft 10 in (178 cm)' }),
  spider_man: profile('Spider-Man', 1.78, { build: 'athletic', bodyRadius: .59, referenceHeight: 1.78, source: 'Marvel Comics canon: 5 ft 10 in (178 cm)' }),
  iron_spider: profile('Iron Spider', 1.78, { build: 'armored', bodyRadius: .64, referenceHeight: 1.78, source: 'Iron Spider armour over Peter Parker: 5 ft 10 in (178 cm)' }),
  kaze: profile('Kaze', 1.78, { build: 'martial-artist', bodyRadius: .58, referenceHeight: 1.78, source: 'Original Browser Bros fighter; 5 ft 10 in reference build' }),

  // ---- DLC / catalogue -----------------------------------------------------------------
  the_rock: profile('The Rock', 1.96, { build: 'powerhouse', bodyRadius: .76, referenceHeight: 1.96, source: 'Dwayne Johnson: 6 ft 5 in (196 cm)' }),
  samuel_l_jackson: profile('Samuel L. Jackson', 1.89, { build: 'lean', bodyRadius: .61, referenceHeight: 1.89, source: 'Samuel L. Jackson: 6 ft 2.5 in (189 cm)' }),
  bruce_lee: profile('Bruce Lee', 1.72, { build: 'compact', bodyRadius: .56, referenceHeight: 1.72, source: 'Bruce Lee: 5 ft 7.5 in (172 cm)' }),
  jean_claude_van_damme: profile('Jean-Claude Van Damme', 1.8, { build: 'athletic', bodyRadius: .60, referenceHeight: 1.8, source: 'Jean-Claude Van Damme: 5 ft 10 in (180 cm)' }),
  lucy_liu: profile('Lucy Liu', 1.6, { build: 'compact', bodyRadius: .51, referenceHeight: 1.6, source: 'Lucy Liu: 5 ft 3 in (160 cm)' }),
  sigourney_weaver: profile('Sigourney Weaver', 1.82, { build: 'athletic', bodyRadius: .60, referenceHeight: 1.82, source: 'Sigourney Weaver: 6 ft 0 in (182 cm)' }),
  keanu_reeves: profile('Keanu Reeves', 1.86, { build: 'lean', bodyRadius: .60, referenceHeight: 1.86, source: 'Keanu Reeves: 6 ft 1 in (186 cm)' }),
  burt_reynolds: profile('Burt Reynolds', 1.78, { build: 'athletic', bodyRadius: .62, referenceHeight: 1.78, source: 'Burt Reynolds: 5 ft 11 in (178 cm)' }),
  grace_jones: profile('Grace Jones', 1.75, { build: 'athletic', bodyRadius: .58, referenceHeight: 1.75, source: 'Grace Jones: 5 ft 9 in (175 cm)' }),
  roronoa_zoro: profile('Roronoa Zoro', 1.81, { build: 'athletic', bodyRadius: .62, referenceHeight: 1.81, source: 'One Piece canon: 5 ft 11 in (181 cm)' }),
  jotaro_kujo: profile('Jotaro Kujo', 1.95, { build: 'powerhouse', bodyRadius: .72, referenceHeight: 1.95, source: 'JoJo canon: 6 ft 5 in (195 cm); unusually tall' }),
  solid_snake: profile('Solid Snake', 1.82, { build: 'soldier', bodyRadius: .62, referenceHeight: 1.82, source: 'Metal Gear canon: 6 ft 0 in (182 cm)' }),
  lara_croft: profile('Lara Croft', 1.75, { build: 'athletic', bodyRadius: .58, referenceHeight: 1.75, source: 'Tomb Raider canon: 5 ft 9 in (175 cm)' }),
  sephiroth: profile('Sephiroth', 1.85, { build: 'lean', bodyRadius: .60, referenceHeight: 1.85, source: 'Final Fantasy VII canon: 6 ft 1 in (185 cm) before the Masamune' }),
  shrek: profile('Shrek', 2.3, { build: 'massive', bodyRadius: .90, referenceHeight: 2.3, source: 'Shrek films: 7–8 ft (213–244 cm); 7 ft 6 in target' }),
  aladdin: profile('Aladdin', 1.75, { build: 'lean', bodyRadius: .55, referenceHeight: 1.75, source: 'Disney depiction: about 5 ft 9 in (175 cm)' }),
  ariel: profile('Ariel', 1.65, { build: 'young', bodyRadius: .50, referenceHeight: 1.65, source: 'The Little Mermaid depiction: about 5 ft 5 in (165 cm)' }),
  ursula: profile('Ursula', 2.1, { build: 'massive', bodyRadius: .90, referenceHeight: 2.1, source: 'The Little Mermaid depiction: large sea-witch frame, about 6 ft 10 in (210 cm)' }),
  sesshomaru: profile('Sesshomaru', 1.88, { build: 'lean', bodyRadius: .58, referenceHeight: 1.88, source: 'Inuyasha canon: 6 ft 2 in (188 cm)' }),
  norman_bates: profile('Norman Bates', 1.78, { build: 'lean', bodyRadius: .57, referenceHeight: 1.78, source: 'Psycho depiction: 5 ft 10 in (178 cm)' }),
  han_solo: profile('Han Solo', 1.85, { build: 'athletic', bodyRadius: .60, referenceHeight: 1.85, source: 'Star Wars canon: 6 ft 1 in (185 cm)' }),
  indiana_jones: profile('Indiana Jones', 1.83, { build: 'athletic', bodyRadius: .61, referenceHeight: 1.83, source: 'Indiana Jones canon: 6 ft 0 in (183 cm)' })
});

// Short names used in tests, console probes and move data must resolve to the same body as the
// full roster identity. This is deliberately an alias table, not a second set of heights.
const PROFILE_ALIASES = Object.freeze({
  hulk: 'hulk_bruce_banner', the_hulk: 'hulk_bruce_banner', bruce_banner: 'hulk_bruce_banner',
  iron_man: 'iron_man_tony_stark', ironman: 'iron_man_tony_stark', tony_stark: 'iron_man_tony_stark',
  professor_x: 'professor_x_charles_xavier', charles_xavier: 'professor_x_charles_xavier',
  the_flash: 'the_flash_barry_allen', flash: 'the_flash_barry_allen', barry_allen: 'the_flash_barry_allen',
  green_lantern: 'green_lantern_hal_jordan', hal_jordan: 'green_lantern_hal_jordan',
  wolverine: 'wolverine_logan', logan: 'wolverine_logan',
  arnold: 'arnold_schwarzenegger', terminator: 'arnold_schwarzenegger', t_800: 'arnold_schwarzenegger', the_terminator: 'arnold_schwarzenegger',
  l: 'l_death_note_style', death_note_l: 'l_death_note_style', light: 'l_death_note_style', light_yagami: 'l_death_note_style',
  harry: 'lord_voldemort', harry_potter: 'lord_voldemort',
  allmight: 'all_might',
  ed: 'edward_elric', fullmetal: 'edward_elric', fullmetal_alchemist: 'edward_elric',
  edna: 'edna_mode',
  geralt: 'geralt_of_rivia',
  jack_sparrow: 'captain_jack_sparrow',
  spider: 'spider_man', peter_parker: 'spider_man',
  masterchief: 'master_chief',
  doomguy: 'doom_slayer', doomslayer: 'doom_slayer',
  rock: 'the_rock', the_rock: 'the_rock',
  snake: 'solid_snake',
  lara: 'lara_croft',
  shrek: 'shrek'
});

const DEFAULT_PROFILE = profile('Fighter', 1.8, { build: 'human', bodyRadius: .6, source: 'Unknown identity fallback; not a roster height', notes: 'unknown identity; not a roster default height' });

export function identitySlug(value) {
  return String(value?.identityKey || value?.identity || value?.name || value)
    .normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function heightProfileFor(fighterOrKey) {
  const key = identitySlug(fighterOrKey);
  return CHARACTER_SCALE_PROFILES[PROFILE_ALIASES[key] || key] || DEFAULT_PROFILE;
}

export function heightFor(fighterOrKey) {
  return heightProfileFor(fighterOrKey).targetHeight;
}

/** Uniform scale from the authoring baseline. Used for combat volumes, not model mounting. */
export function heightScaleFor(fighterOrKey) {
  return heightProfileFor(fighterOrKey).targetHeight / AUTHORING_BASELINE_HEIGHT;
}

function isEquippedNode(node) {
  for (let current = node; current; current = current.parent) {
    if (String(current.name || '').startsWith('Equipped')) return true;
  }
  return false;
}

/** Measure a body without an equipped weapon. The model is measured at scale 1. */
export function measureCharacterHeight(model) {
  if (!model?.isObject3D) return 0;
  const previous = model.scale.clone();
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  model.traverse(node => {
    if (!node.isMesh || isEquippedNode(node)) return;
    const meshBox = new THREE.Box3().setFromObject(node);
    if (!meshBox.isEmpty()) box.union(meshBox);
  });
  model.scale.copy(previous);
  model.updateMatrixWorld(true);
  return box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).y;
}

/**
 * Apply the identity's height, body radius and uniform visual scale to the live fighter.
 *
 * Imported bodies arrive with their root already normalised to `targetHeight`; their holder is
 * only responsible for the arena's stage scale. Prefab/procedural bodies are measured at their
 * authored scale and then uniformly scaled to the target. `characterScale` is kept as the
 * body-authored-to-target ratio so `applyMap` can multiply it by the stage scale without
 * stacking a second character scale on an imported root.
 */
export function applyHeightProfile(fighter, options = {}) {
  if (!fighter) return null;
  const gameProfile = heightProfileFor(fighter);
  const stageScale = Number(options.stageScale) > 0 ? Number(options.stageScale) : 1;
  fighter.heightProfile = gameProfile;
  fighter.height = gameProfile.targetHeight;
  fighter.heightScale = gameProfile.targetHeight / AUTHORING_BASELINE_HEIGHT;
  fighter.hurtboxRadius = gameProfile.bodyRadius;
  fighter.hurtboxHeight = gameProfile.hurtboxHeight;
  fighter.cameraHeight = gameProfile.cameraHeight;
  fighter.cameraDistanceScale = gameProfile.cameraDistanceScale;
  fighter.hitboxScale = gameProfile.hitboxScale;
  fighter.weaponScale = gameProfile.weaponScale;
  fighter.model?.userData && (fighter.model.userData.heightProfile = gameProfile);

  const model = fighter.model;
  if (!model?.userData) return gameProfile;
  const imported = Boolean(model.userData.importedModel);
  let authoredHeight = 0;
  let appliedScale = 1;
  if (imported) {
    const placement = model.userData.placement || {};
    authoredHeight = Number(placement.sourceHeight) || 0;
    appliedScale = Number(placement.scale) || 0;
    // The root is already at targetHeight. The holder only receives the stage multiplier.
    model.userData.characterScale = 1;
    model.userData.visualScale = 1;
    model.scale.setScalar(stageScale);
  } else {
    authoredHeight = measureCharacterHeight(model);
    if (!(authoredHeight > .01)) authoredHeight = gameProfile.targetHeight;
    appliedScale = gameProfile.targetHeight / authoredHeight;
    model.userData.characterScale = appliedScale;
    model.userData.visualScale = appliedScale;
    model.scale.setScalar(appliedScale * stageScale);
  }
  model.userData.targetHeight = gameProfile.targetHeight;
  model.userData.authoredHeight = authoredHeight;
  model.userData.appliedScale = appliedScale;
  model.userData.stageScale = stageScale;
  model.userData.uniformScaleOnly = true;
  model.updateMatrixWorld(true);

  if (typeof window !== 'undefined') {
    window.__browserSmashScale = window.__browserSmashScale || {};
    window.__browserSmashScale[identitySlug(fighter)] = {
      identity: fighter.identity || fighter.name || null,
      profile: gameProfile.label,
      source: gameProfile.source,
      referenceHeight: gameProfile.referenceHeight,
      targetHeight: gameProfile.targetHeight,
      authoredHeight: +authoredHeight.toFixed(3),
      appliedScale: +appliedScale.toFixed(3),
      stageScale,
      bodyRadius: gameProfile.bodyRadius,
      hurtboxRadius: gameProfile.hurtboxRadius,
      hurtboxHeight: gameProfile.hurtboxHeight,
      hitboxScale: gameProfile.hitboxScale,
      weaponScale: gameProfile.weaponScale,
      cameraHeight: gameProfile.cameraHeight,
      cameraDistanceScale: gameProfile.cameraDistanceScale,
      seated: gameProfile.seated,
      imported
    };
  }
  return gameProfile;
}

/** Human-readable placement report for the runtime diagnostics and the scale test. */
export function describeHeightProfile(fighterOrKey) {
  const p = heightProfileFor(fighterOrKey);
  return `${p.label}: ${p.targetHeight.toFixed(2)} m target, ${p.bodyRadius.toFixed(2)} m body radius, ${p.seated ? 'seated' : p.build}`;
}
