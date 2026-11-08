// Per-character ability kit: the two castable specials every fighter has beyond their signature.
//
// Before this file a fighter had exactly one special (main.js SPECIAL_MOVES, key K) and a second
// one only while transformed, so "four distinctive special abilities" was impossible: the roster
// was one button deep. The signature stays where it is — it is the identity's headline move — and
// this module adds the two kit moves that make a character play like a fighting-game character:
// a character-specific setup/pressure tool and a character-specific finisher/mobility tool.
//
// Everything here is executed by the real projectile/signature pipeline (`castAbility` in
// ability_runtime.js calls `window.spawnProjectile` or `window.performSignatureMove`), so damage,
// guarding, cover, invulnerability and knockback all resolve in the live simulation. Nothing is a
// menu-only label: if an entry is listed, it fires a real hit.
//
// Distinctness is the point: a heavyweight tool is slow, short and launches (Hulk, Kratos, All
// Might); a speedster's is fast, cheap and travels (Flash, Levi, Sasuke); a mage's controls space
// instead of damage (Strange's bind, Xavier's disruption); a tactician's sets something up
// (L's feint, Edna's trap). Do not flatten these into one shared "energy ball" with a new colour.

const ab = (label, type, damage, cooldown, extra = {}) => Object.freeze({
  label, type, damage, cooldown,
  speed: extra.speed ?? 32,
  stun: extra.stun ?? .5,
  knockback: extra.knockback ?? 6,
  color: extra.color ?? 0xbde9ff,
  ...extra
});

/**
 * Two kit abilities per identity, in cast order (slot 1 = key L / gamepad X, slot 2 = key H /
 * gamepad Y). Keys are identity slugs, the same keys movesets.js and locomotion.js use.
 */
export const ABILITY_KIT = Object.freeze({
  infantry: Object.freeze([
    ab('RIFLE BURST', 'orb', 9, 2.4, { speed: 58, stun: .28, knockback: 3.4, color: 0xffd27a, note: 'Three-round burst: fast, low damage, holds the midrange.' }),
    ab('FRAG GRENADE', 'orb', 17, 6.0, { speed: 24, stun: .5, knockback: 8.4, color: 0xff9a4d, behavior: 'shockwave', radius: 4.6, note: 'Lobbed charge: slower travel, real blast radius on impact.' })
  ]),

  // ---- DC, science, cosmic -------------------------------------------------------------
  superman: Object.freeze([
    ab('FREEZE BREATH', 'frost', 14, 3.4, { speed: 26, stun: 1.25, knockback: 2.4, color: 0xa8ecff, note: 'Long freeze, almost no knockback: it sets up, it does not finish.' }),
    // Kryptonian strength is not another energy ball: it is a short radial blow with the second
    // largest knockback in his kit, paid for with a long recovery.
    ab('SUPER STRENGTH', 'shockwave', 27, 5.0, { behavior: 'shockwave', radius: 4.2, speed: 20, stun: .78, knockback: 14.2, color: 0xffe08a, note: 'Short-range strength blow: the ring edge still launches.' }),
    ab('SUPER SPEED', 'lightning', 21, 4.2, { behavior: 'dashStrike', dashSpeed: 52, range: 24, speed: 52, stun: .55, knockback: 10.5, color: 0x8fd4ff, note: 'Committed flight charge with a long recovery if it misses.' })
  ]),
  iron_man_tony_stark: Object.freeze([
    ab('MICRO-MISSILE BARRAGE', 'orb', 17, 3.6, { speed: 30, stun: .42, knockback: 5.2, color: 0xffb45e, note: 'Targeting burst that trades per-hit damage for reach.' }),
    ab('THRUSTER DODGE', 'beam', 12, 2.8, { behavior: 'dashStrike', dashSpeed: 44, range: 15, speed: 44, stun: .3, knockback: 4.4, color: 0x8ff9ff, note: 'Escape that still hits: reposition and chip.' })
  ]),
  hulk_bruce_banner: Object.freeze([
    ab('DEBRIS THROW', 'debris', 24, 4.8, { speed: 27, stun: .72, knockback: 10.2, color: 0x8a7358, note: 'Rips a chunk of the arena loose and throws it as a heavy arcing rock.' }),
    ab('LEAPING METEOR SLAM', 'shockwave', 27, 6.2, { behavior: 'shockwave', radius: 6.8, speed: 20, stun: .85, knockback: 14, color: 0xffb05a, note: 'Full-commitment leap: enormous knockback, long recovery.' })
  ]),
  green_lantern_hal_jordan: Object.freeze([
    ab('CONSTRUCT RESTRAINT', 'construct', 12, 3.8, { speed: 26, stun: 1.4, knockback: 2.2, color: 0x7dffb0, note: 'Hard-light bind: the longest hold, the least damage.' }),
    ab('GIANT CONSTRUCT HAMMER', 'construct', 26, 5.6, { behavior: 'shockwave', radius: 5.8, speed: 22, stun: .8, knockback: 12.4, color: 0x5cff9d, note: 'Slow overhead construct with real area denial.' })
  ]),
  wonder_woman: Object.freeze([
    ab('SHIELD THROW', 'orb', 16, 3.2, { speed: 38, stun: .5, knockback: 6.6, color: 0xffd76c, note: 'Fast, flat throw that keeps her sword arm free.' }),
    ab('SWORD RUSH', 'blade', 22, 4.4, { behavior: 'dashStrike', dashSpeed: 40, range: 17, speed: 40, stun: .45, knockback: 8.2, color: 0xfff0b8, note: 'Amazonian closing slash off the parry window.' })
  ]),
  professor_x_charles_xavier: Object.freeze([
    ab('MIND DISRUPTION', 'psychic', 9, 4.6, { speed: 24, stun: 1.6, knockback: 1.2, color: 0xd4c6ff, note: 'Almost no damage; the longest control in the game.' }),
    ab('TELEKINETIC RESTRAINT', 'psychic', 15, 5.2, { speed: 22, stun: 1.05, knockback: 4.8, color: 0xc0a8ff, note: 'Lifts and holds so a slow zoner can follow up.' })
  ]),
  the_flash_barry_allen: Object.freeze([
    ab('LIGHTNING THROW', 'lightning', 16, 2.4, { speed: 54, stun: .34, knockback: 5.4, color: 0xfff06a, note: 'Fastest projectile in the roster, cheapest cooldown.' }),
    ab('TORNADO SPIN', 'wind', 13, 3.6, { behavior: 'shockwave', radius: 4.4, speed: 24, stun: .55, knockback: 9.2, color: 0xc8f2ff, note: 'Close spin that throws people off the ring edge.' })
  ]),
  aquaman: Object.freeze([
    ab('WATER SURGE', 'water', 18, 3.2, { speed: 28, stun: .6, knockback: 7.4, color: 0x9df3ff, note: 'Wide water push that holds a lane.' }),
    ab('TRIDENT THROW', 'orb', 24, 4.8, { speed: 42, stun: .42, knockback: 9.6, color: 0x6ff0ff, note: 'Heavy skewer: slower to recover than his sweep.' })
  ]),
  doctor_strange: Object.freeze([
    ab('BINDING RUNES', 'magic', 11, 3.8, { speed: 25, stun: 1.35, knockback: 2.6, color: 0xffc47a, note: 'Crimson bands: control, not damage.' }),
    ab('PORTAL STRIKE', 'magic', 21, 5, { behavior: 'dashStrike', dashSpeed: 38, range: 18, speed: 38, stun: .5, knockback: 7.8, color: 0xff9a4d, note: 'Steps through a portal and comes out swinging.' })
  ]),
  arnold_schwarzenegger: Object.freeze([
    ab('SUPPRESSIVE ATTACK', 'bullet', 14, 2.6, { speed: 46, stun: .3, knockback: 4.2, color: 0xffa07a, note: 'Cheap automatic-fire pressure.' }),
    ab('EXPLOSIVE LAUNCHER', 'grenade', 26, 5.4, { speed: 22, stun: .7, knockback: 11.6, color: 0xff8261, note: 'Arcing explosive: stopped by walls, brutal in the open.' })
  ]),

  // ---- anime ---------------------------------------------------------------------------
  goku: Object.freeze([
    ab('KI BLAST', 'orb', 13, 2.6, { motion: 'kiBlast', speed: 46, stun: .32, knockback: 5.0, color: 0x4b9dff, note: 'Fast, cheap single ki shot: his poke, not his kill move.' }),
    ab('INSTANT TRANSMISSION', 'lightning', 15, 3.2, { motion: 'instantTransmission', behavior: 'dashStrike', dashSpeed: 56, range: 22, speed: 56, stun: .3, knockback: 5.2, color: 0x7fdcff, note: 'Blink strike: fastest gap-close in the kit.' }),
    ab('DRAGON FIST', 'orb', 31, 6.0, { motion: 'dragonFist', behavior: 'dashStrike', dashSpeed: 46, range: 13, speed: 46, stun: .85, knockback: 12.8, color: 0xffd76c, note: 'Committed dragon-shaped strike: the biggest single hit he can throw untransformed.' })
  ]),
  naruto_uzumaki: Object.freeze([
    // A real entity spawn, not a projectile: two chakra bodies that chase and strike.
    ab('SHADOW CLONE JUTSU', 'orb', 10, 6.5, { motion: 'shadowClone', effect: 'clones', count: 2, speed: 30, stun: .4, knockback: 4, color: 0xffc46a, note: 'Two real clones for nine seconds; they can be dispelled and are capped at three.' }),
    ab('RASENGAN', 'rasengan', 26, 4.5, { motion: 'rasengan', speed: 30, stun: .55, knockback: 10.2, color: 0x7fd8ff, note: 'The signature trade: huge damage for a real gap.' }),
    // Same jutsu, different economy: a radial blast instead of a thrown orb, so it cannot be
    // sidestepped down a lane but must be respected up close.
    ab('GIANT RASENGAN', 'rasengan', 32, 7.2, { motion: 'giantRasengan', behavior: 'shockwave', radius: 6.4, speed: 20, stun: .8, knockback: 13.6, color: 0x4fb8ff, note: 'Slower and radial: a 6.4 m chakra blast that punishes standing next to him.' }),
    // The cheap, fast option: low damage and almost no knockback, but it reaches further than his
    // fists and costs nothing from the power meter. The throw is an authored clip on his own rig
    // (`Naruto_Kunai`), not a re-timed jab.
    ab('KUNAI THROW', 'blade', 9, 1.9, { motion: 'kunai', speed: 70, stun: .22, knockback: 2.4, color: 0xe8eef7, note: 'Fast, flat throw: chip damage and a poke, no meter cost.' })
  ]),
  vegeta: Object.freeze([
    ab('BIG BANG ATTACK', 'orb', 22, 4, { speed: 34, stun: .5, knockback: 8.4, color: 0xc06bff, note: 'Slow orb, punishing if it connects.' }),
    ab('FINAL FLASH', 'beam', 28, 6.4, { speed: 44, stun: .62, knockback: 11.2, color: 0xd99dff, note: 'Lane-wide beam with a long, visible charge.' })
  ]),
  saitama: Object.freeze([
    ab('CONSECUTIVE NORMAL PUNCHES', 'orb', 15, 2.6, { behavior: 'dashStrike', dashSpeed: 46, range: 12, speed: 46, stun: .35, knockback: 6, color: 0xfff3c4, note: 'Fast, cheap and deliberately unimpressive.' }),
    ab('SHOCKWAVE STRIKE', 'shockwave', 29, 6, { behavior: 'shockwave', radius: 6.6, speed: 24, stun: .5, knockback: 15, color: 0xfff0b8, note: 'Air-pressure hit: the largest knockback in the roster.' })
  ]),
  l_death_note_style: Object.freeze([
    ab('PSYCHOLOGICAL FEINT', 'psychic', 7, 3.4, { speed: 20, stun: 1.2, knockback: 1.6, color: 0xe6e8f2, note: 'Baits a whiff and holds the opponent still.' }),
    ab('PREPARED TRAP', 'earth', 17, 5.2, { behavior: 'shockwave', radius: 4.2, speed: 18, stun: .9, knockback: 7.2, color: 0xd4d6e0, note: 'Small marked zone; must be placed before it matters.' })
  ]),
  all_might: Object.freeze([
    ab('OKLAHOMA SMASH', 'shockwave', 24, 4.4, { behavior: 'shockwave', radius: 5.4, speed: 24, stun: .62, knockback: 12.2, color: 0xffdf78, note: 'Heroic area blow with real recovery.' }),
    ab('SHOCKWAVE DASH', 'lightning', 18, 3.6, { behavior: 'dashStrike', dashSpeed: 48, range: 20, speed: 48, stun: .38, knockback: 7.6, color: 0x8ef0ff, note: 'Closes distance behind pressure.' })
  ]),
  edward_elric: Object.freeze([
    ab('WEAPON CREATION', 'blade', 19, 3.4, { speed: 30, stun: .44, knockback: 7, color: 0xffa08f, note: 'Transmutes a blade mid-swing: short, sharp reach.' }),
    ab('GROUND TRANSMUTATION', 'earth', 23, 5.2, { behavior: 'shockwave', radius: 5.6, speed: 18, stun: .8, knockback: 9.4, color: 0xff8a6a, note: 'Reshapes the floor under a marked area.' })
  ]),
  levi_ackerman: Object.freeze([
    ab('THUNDER SPEAR', 'blade', 27, 5, { speed: 46, stun: .4, knockback: 10.8, color: 0xf4faff, note: 'Precision explosive: the biggest single hit in his kit.' }),
    ab('ODM GRAPPLE', 'wind', 14, 2.6, { behavior: 'dashStrike', dashSpeed: 50, range: 19, speed: 50, stun: .3, knockback: 4.6, color: 0xdff0ff, note: 'Gear-driven repositioning that still cuts.' })
  ]),
  mario: Object.freeze([
    ab('FIREBALL', 'fireball', 13, 2.4, { speed: 32, stun: .4, knockback: 4.4, color: 0xff9a3d, note: 'Cheap, bouncing pressure at mid range.' }),
    ab('SUPER JUMP', 'wind', 12, 3.4, { behavior: 'airScooter', dashSpeed: 24, range: 10, lift: 7, speed: 24, stun: .45, knockback: 5.2, color: 0xffe066, note: 'Platforming escape that can still clip an opponent.' })
  ]),
  luigi: Object.freeze([
    ab('GREEN MISSILE', 'lightning', 20, 3.6, { behavior: 'dashStrike', dashSpeed: 44, range: 20, speed: 44, stun: .42, knockback: 7.8, color: 0x9dff9b, note: 'Unreliable in flight, committed on landing.' }),
    ab('POLTERGUST BURST', 'wind', 11, 2.8, { behavior: 'shockwave', radius: 3.8, speed: 22, stun: 1.1, knockback: 3.2, color: 0xc4ffc0, note: 'Pulls and holds: the setup tool for his launches.' })
  ]),
  kratos: Object.freeze([
    ab('BLADES OF CHAOS', 'blade', 18, 3.2, { speed: 34, stun: .5, knockback: 6.8, color: 0xff7a3c, note: 'Chained blades extend his reach without moving him.' }),
    ab('SHIELD COUNTER', 'shockwave', 22, 4.6, { behavior: 'shockwave', radius: 4.2, speed: 20, stun: .9, knockback: 9.6, color: 0xffa05c, note: 'Spartan shield answer to pressure.' })
  ]),
  link: Object.freeze([
    ab('BOMB THROW', 'grenade', 21, 3.8, { speed: 20, stun: .62, knockback: 8.8, color: 0xffe9a8, note: 'Arcing explosive that walls stop.' }),
    ab('BOOMERANG', 'orb', 12, 3, { speed: 30, stun: .55, knockback: 4, color: 0xfff0a8, note: 'Slow return trip that keeps a target occupied.' })
  ]),

  // ---- military, elemental, fantasy -----------------------------------------------------
  master_chief: Object.freeze([
    ab('GRENADE THROW', 'grenade', 22, 3.6, { speed: 22, stun: .66, knockback: 9.8, color: 0xa6ffcf, note: 'Frag arc; the tactical answer to cover camping.' }),
    ab('ENERGY WEAPON BURST', 'beam', 17, 3, { speed: 40, stun: .34, knockback: 5.6, color: 0x8dffc0, note: 'Fast disciplined fire that keeps him mid-range.' })
  ]),
  thor: Object.freeze([
    ab('HAMMER RECALL', 'orb', 20, 3.4, { speed: 36, stun: .48, knockback: 7.4, color: 0x9df0ff, note: 'Returns through the same lane: the second half is the threat.' }),
    ab('THUNDERSTORM', 'lightning', 26, 6, { behavior: 'shockwave', radius: 6.2, speed: 22, stun: .7, knockback: 11.8, color: 0xbdf6ff, note: 'Wide storm zone with a visible warning.' })
  ]),
  aang: Object.freeze([
    ab('WATER WHIP', 'water', 15, 2.8, { speed: 30, stun: .55, knockback: 5.8, color: 0x9de8ff, note: 'Fluid reach: his cheapest spacing tool.' }),
    ab('EARTH WALL', 'earth', 19, 4.4, { behavior: 'shockwave', radius: 4, speed: 18, stun: 1, knockback: 8.4, color: 0xc8a878, note: 'Raises cover and hits anything standing in it.' })
  ]),
  madara_uchiha: Object.freeze([
    ab('GREAT FIREBALL', 'fireball', 23, 4.2, { speed: 28, stun: .55, knockback: 8.2, color: 0xff6a3c, note: 'Wide fire technique: slow, hard to step around.' }),
    ab('SUSANOO BLADE', 'blade', 28, 5.8, { behavior: 'shockwave', radius: 5.2, speed: 24, stun: .8, knockback: 12.6, color: 0xb48bff, note: 'Spectral weapon sweep with real reach.' })
  ]),
  hashirama_senju: Object.freeze([
    ab('WOOD DRAGON', 'wood', 21, 4, { speed: 27, stun: .95, knockback: 6.4, color: 0xa6f0b4, note: 'Tracks and binds: his control tool.' }),
    ab('DEEP FOREST', 'wood', 18, 5.2, { behavior: 'shockwave', radius: 6, speed: 18, stun: .85, knockback: 8.8, color: 0x8fe0a2, note: 'Roots erupt across a wide zone.' })
  ]),
  lord_voldemort: Object.freeze([
    ab('SERPENT SUMMONING', 'curse', 20, 4.2, { speed: 26, stun: 1, knockback: 6, color: 0x9dffb8, note: 'Dark summons that hold a lane.' }),
    ab('APPARITION STRIKE', 'magic', 18, 3.6, { behavior: 'dashStrike', dashSpeed: 40, range: 17, speed: 40, stun: .45, knockback: 5.6, color: 0x7dffa6, note: 'Teleport behind the guard and curse from close.' })
  ]),
  sasuke_uchiha: Object.freeze([
    ab('AMATERASU', 'curse', 24, 5.4, { behavior: 'shockwave', radius: 4.6, speed: 20, stun: .9, knockback: 7.6, color: 0x2f2f4f, note: 'Black flame that punishes standing still.' }),
    ab('FIREBALL STRIKE', 'fireball', 17, 3.2, { speed: 32, stun: .45, knockback: 6, color: 0xff7a4d, note: 'Reliable ranged pressure between Chidori dashes.' })
  ]),
  edna_mode: Object.freeze([
    ab('TRAP SETUP', 'earth', 14, 3.4, { behavior: 'shockwave', radius: 3.6, speed: 18, stun: 1.05, knockback: 5.4, color: 0xff7ab8, note: 'Marks a small area; it is a trap, not a nuke.' }),
    ab('DEFENSIVE FIELD BURST', 'construct', 10, 4.6, { behavior: 'shockwave', radius: 4.8, speed: 22, stun: .7, knockback: 10.4, color: 0xff9ecb, note: 'Low damage, huge push: the panic button.' })
  ]),
  captain_jack_sparrow: Object.freeze([
    ab('PISTOL SHOT', 'bullet', 15, 2.4, { speed: 50, stun: .32, knockback: 5, color: 0xffe6b8, note: 'One quick shot before the reload.' }),
    ab('TRICKSTER FEINT', 'wind', 12, 3.6, { behavior: 'dashStrike', dashSpeed: 38, range: 13, speed: 38, stun: .6, knockback: 4.8, color: 0xffd39a, note: 'Side-step into a cutlass cut: evasive, not explosive.' })
  ]),
  spider_man: Object.freeze([
    ab('WEB SHOT', 'web', 9, 2.4, { speed: 44, stun: 1.3, knockback: 1.8, color: 0xf5fbff, motion: 'spider_web_shot', note: 'Webbing holds a target still for the aerial follow-up.' }),
    // A real displace, not a damage tick: the target is yanked toward Spider-Man, so the pull is
    // best used to drag someone out of a corner, not to chip them.
    ab('WEB PULL', 'web', 12, 3.6, { behavior: 'pull', range: 13, speed: 40, stun: .9, knockback: 2.0, color: 0xdff2ff, motion: 'spider_web_pull', note: 'Yanks a target inside 13 m toward him; the follow-up is the point.' }),
    ab('WEB SWING STRIKE', 'web', 18, 3.8, { behavior: 'dashStrike', dashSpeed: 50, range: 20, speed: 50, stun: .4, knockback: 6.8, color: 0xe8f7ff, motion: 'spider_web_swing', note: 'Swing in fast and kick through.' })
  ]),
  iron_spider: Object.freeze([
    ab('REPULSOR SUIT ATTACK', 'beam', 19, 3.4, { speed: 38, stun: .4, knockback: 6.6, color: 0xffd76a, note: 'Suit-based ranged pressure beside the legs.' }),
    ab('MECHANICAL GRAB', 'legs', 17, 4.2, { behavior: 'shockwave', radius: 4.2, speed: 24, stun: 1.15, knockback: 7.4, color: 0xffe89a, note: 'Four-leg clamp: hold, then throw.' })
  ])
  ,
  // Recovered launch promotions. Their kits follow the same rule as every other identity: a real
  // castable move in each slot, not a relabelled shared orb.
  wolverine_logan: Object.freeze([
    ab('ADAMANTIUM LUNGE', 'blade', 19, 3.2, { behavior: 'dashStrike', dashSpeed: 46, range: 15, speed: 46, stun: .36, knockback: 6.4, color: 0xff7a5c, note: 'Low claw-first gap closer: fast, short recovery.' }),
    ab('BERSERKER FLURRY', 'shockwave', 23, 5.2, { behavior: 'shockwave', radius: 4.8, speed: 22, stun: .55, knockback: 9.8, color: 0xff5a3c, note: 'Close-range claw storm: the area is the point.' })
  ]),
  geralt_of_rivia: Object.freeze([
    ab('AARD BLAST', 'psychic', 14, 3.4, { speed: 28, stun: 1.1, knockback: 7.2, color: 0x9fdfff, note: 'Telekinetic push that opens space for a sword follow-up.' }),
    ab('YRDEN TRAP', 'earth', 17, 5.0, { behavior: 'shockwave', radius: 4.6, speed: 18, stun: 1.25, knockback: 3.4, color: 0xb28cff, note: 'Slowing sign: low knockback, long hold.' })
  ]),
  doom_slayer: Object.freeze([
    ab('CHAINSHOT', 'blade', 16, 2.8, { behavior: 'dashStrike', dashSpeed: 48, range: 14, speed: 48, stun: .32, knockback: 5.6, color: 0xffc46a, note: 'Meat-hook gap closer that drags him into shotgun range.' }),
    ab('BFG-9000', 'beam', 31, 7.0, { speed: 38, stun: .7, knockback: 12.0, color: 0x8dff6a, note: 'Slow, enormous plasma lane: the committed finisher.' })
  ])
  ,
  // Original repository fighter: the kit has to cover it too, or the dev fighter becomes the one
  // body on the roster that cannot answer a kit-slot key.
  kaze: Object.freeze([
    ab('GALE STEP', 'wind', 13, 2.8, { behavior: 'dashStrike', dashSpeed: 44, range: 16, speed: 44, stun: .32, knockback: 5.4, color: 0x9ff2dd, note: 'Wind-step gap closer that keeps his shins moving.' }),
    ab('WHIRLWIND SWEEP', 'wind', 18, 4.2, { behavior: 'shockwave', radius: 4.6, speed: 22, stun: .7, knockback: 8.8, color: 0x7fe6cf, note: 'Low sweep with area control, not a second orb.' })
  ])
});

/** Two extra light-string names per identity, so the 5-hit chain is that character's chain. */
export const LIGHT_EXTENSIONS = Object.freeze({
  infantry: ['Buttstroke', 'Rifle Sweep'],
  superman: ['Solar Knee', 'Worldbreaker Hook'],
  iron_man_tony_stark: ['Servo Uppercut', 'Unibeam Palm'],
  hulk_bruce_banner: ['Shoulder Charge', 'Ruinous Uppercut'],
  green_lantern_hal_jordan: ['Construct Uppercut', 'Willpower Hammer'],
  wonder_woman: ['Amazonian Kick', 'Shield-Assisted Finish'],
  professor_x_charles_xavier: ['Debris Sweep', 'Concentrated Psychic Blast'],
  the_flash_barry_allen: ['Rapid Body Blows', 'Lightning Uppercut'],
  aquaman: ['Elbow Strike', 'Rising Trident'],
  doctor_strange: ['Portal-Assisted Kick', 'Rune Explosion'],
  arnold_schwarzenegger: ['Tactical Kick', 'Heavy Finishing Punch'],
  goku: ['Double Kick', 'Rising Uppercut'],
  naruto_uzumaki: ['Dual-Clone Assault', 'Uzumaki Uppercut'],
  vegeta: ['Rapid Punch', 'Explosive Uppercut'],
  saitama: ['Spinning Strike', 'Powerful Uppercut'],
  l_death_note_style: ['Deceptive Kick', 'Prepared Counterattack'],
  all_might: ['Spinning Punch', 'Detroit Uppercut'],
  edward_elric: ['Weapon Strike', 'Transmuted Uppercut'],
  levi_ackerman: ['Aerial Cross Slash', 'Precision Finisher'],
  mario: ['Jump Strike', 'Uppercut'],
  luigi: ['Vacuum-Assisted Hit', 'Uppercut'],
  kratos: ['Chained Blade Attack', 'Heavy Finisher'],
  link: ['Spinning Attack', 'Finishing Sword Strike'],
  master_chief: ['Tactical Kick', 'Armored Finisher'],
  thor: ['Lightning Strike', 'Overhead Hammer Finisher'],
  aang: ['Elemental Strike', 'Rising Air Blast'],
  madara_uchiha: ['Weapon-Assisted Strike', 'Fire-Enhanced Finisher'],
  hashirama_senju: ['Wooden Staff Hit', 'Wood Dragon Finisher'],
  lord_voldemort: ['Curse Strike', 'Explosive Spell Finisher'],
  sasuke_uchiha: ['Sharingan Counter', 'Chidori Finisher'],
  edna_mode: ['Mechanical Punch', 'Explosive Gadget Finisher'],
  captain_jack_sparrow: ['Reverse Sword Strike', 'Deceptive Finisher'],
  spider_man: ['Aerial Flip Kick', 'Web-Assisted Finisher'],
  iron_spider: ['Dual-Leg Attack', 'Four-Leg Finisher'],
  wolverine_logan: ['Adamantium Slash', 'Berserker Barrage'],
  geralt_of_rivia: ['Silver Sword Slash', 'Whirl Finisher'],
  doom_slayer: ['Glory Kick', 'Chainsaw Finish'],
  kaze: ['Turning Kick', 'Gale Finisher']
});

/** The third heavy per identity: UP+heavy and DOWN+heavy need their own names too. */
export const HEAVY_EXTENSIONS = Object.freeze({
  infantry: 'Rifle Stock Slam',
  superman: 'Meteor Ground Slam', iron_man_tony_stark: 'Aerial Armor Slam',
  hulk_bruce_banner: 'Leaping Meteor Slam', green_lantern_hal_jordan: 'Construct Ground Slam',
  wonder_woman: 'Divine Ground Slam', professor_x_charles_xavier: 'Mind Force Slam',
  the_flash_barry_allen: 'Lightning Ground Strike', aquaman: 'Ocean Slam',
  doctor_strange: 'Dimensional Ground Slam', arnold_schwarzenegger: 'Tactical Ground Strike',
  goku: 'Ki-Enhanced Ground Slam', naruto_uzumaki: 'Whirlwind Barrage',
  vegeta: 'Ground Impact Punch', saitama: 'Ground-Shattering Punch',
  l_death_note_style: 'Prepared Impact Strike', all_might: 'United States Smash Setup',
  edward_elric: 'Ground Transmutation', levi_ackerman: 'Spinning Ground Assault',
  mario: 'Spinning Heavy Attack', luigi: 'Poltergust Slam', kratos: 'Spartan Ground Breaker',
  link: 'Spin Attack', master_chief: 'Armored Ground Slam', thor: 'Mjolnir Ground Slam',
  aang: 'Elemental Ground Slam', madara_uchiha: 'Meteor Technique',
  hashirama_senju: 'Giant Wood Slam', lord_voldemort: 'Forbidden Magic Slam',
  sasuke_uchiha: 'Susanoo Ground Slam', edna_mode: 'Mechanical Ground Trap',
  captain_jack_sparrow: "Pirate's Dirty Trick", spider_man: 'Aerial Slam',
  iron_spider: 'Four-Leg Ground Slam', wolverine_logan: 'Berserker Ground Slam',
  geralt_of_rivia: 'Aard Ground Slam', doom_slayer: 'Glory Ground Slam', kaze: 'Whirlwind Sweep'
});

/**
 * Heavy label for a landed heavy variant. `variant` is the move id the resolver picked, so the HUD
 * names the blow that actually came out rather than the fighter's first heavy every time.
 */
export function heavyLabelFor(fighterOrKey, variant, baseHeavy = [], fallback = '') {
  const key = typeof fighterOrKey === 'string' ? fighterOrKey : fighterOrKey?.identityKey;
  const extra = HEAVY_EXTENSIONS[key];
  if (variant === 'heavyLauncher') return baseHeavy[1] || extra || fallback;
  if (variant === 'heavySlam') return extra || fallback;
  return baseHeavy[0] || fallback;
}

/** Kit abilities for a fighter, or an empty list. */
export function abilitiesFor(fighterOrKey) {
  if (!fighterOrKey) return [];
  const key = typeof fighterOrKey === 'string' ? fighterOrKey : fighterOrKey.identityKey;
  return ABILITY_KIT[key] || [];
}

/** One kit ability by 1-based slot (1 = key L, 2 = key H), or null. */
export function abilityFor(fighterOrKey, slot) {
  const list = abilitiesFor(fighterOrKey);
  return list[Math.max(0, Math.floor(slot) - 1)] || null;
}

/**
 * The label for hit `step` of a fighter's light string (1..5). Falls back to the generic move
 * label so a fighter added later still has a coherent string.
 */
export function lightLabelFor(fighterOrKey, step, baseLights = [], fallback = '') {
  const key = typeof fighterOrKey === 'string' ? fighterOrKey : fighterOrKey?.identityKey;
  const extras = LIGHT_EXTENSIONS[key] || [];
  const chain = [...(baseLights || []), ...extras];
  return chain[Math.max(0, Math.floor(step) - 1)] || fallback;
}
