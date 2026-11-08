// Per-character movesets: named attacks, one transformation/overdrive and one ultimate.
//
// This is data, not behaviour. Every ultimate below is executed by combat/ultimate.js against
// the real fighter simulation (real hit detection, guarding, cover, invulnerability), and every
// transformation is applied by combat/transformation.js. Nothing here invents a model, a clip or
// a sound: the named attacks are the labels for moves the fighter already performs, and the
// visual of a form is a generated aura rather than a rigged asset.
//
// Keyed by the identity slug main.js derives from the display name:
//   "Iron Man (Tony Stark)" -> iron_man_tony_stark
//
// Ultimate definitions:
//   behaviour  beam | rush | slam | storm | zone | grab | barrage  (see ultimate.js)
//   damage     per hit, before the fighter's own damage profile and any transformation
//   kbs        base knockback constant (same unit as move_data.js)
//   range      metres of lane/travel for beam, rush, grab and barrage
//   radius     metres of the radial volume for slam, storm and zone
//   hits       number of separate damage events; each is its own validated hit
//
// Transformation definitions:
//   cost       power required to activate (power is 0..100, earned by dealing/taking damage)
//   duration   seconds the form lasts
//   drain      extra power spent per second while transformed (0 = no drain)
//   cooldown   seconds after the form ends before it can be entered again
//   mods       multipliers applied while transformed:
//                speed    ground/air top speed
//                damage   outgoing damage
//                kbs      outgoing knockback
//                defense  incoming damage (below 1 = takes less)
//                startup  attack windup (below 1 = faster)
//                jump     jump impulse
//   special    the signature move replaced while transformed (a real second move)
//   ultimate   optional label/damage multiplier for the transformed ultimate

const form = (o) => Object.freeze({ ...o, mods: Object.freeze({ ...o.mods }) });

// --------------------------------------------------------------------------- Naruto's forms
// Each form is a different fighter, not a tint: Sage Mode is balanced and regenerates, Nine-Tails
// trades defence for speed and chakra output, Kurama Link is the heavy armoured state, Six Paths is
// the mobile ranged state and Baryon is the glass cannon that drains fastest. Costs and drains rise
// with the tier so the progression is a decision, not a free upgrade ladder.
const FORM_NARUTO_SAGE = form({
  id: 'sage-mode', label: 'SAGE MODE', aura: 'holy', auraScale: .8, color: 0xffb347, tier: 1,
  look: { hair: { emissive: 0xffb347, emissiveIntensity: 1.2, scale: 1.04 }, accent: { emissive: 0xffb347, emissiveIntensity: 2.0 } },
  duration: 10, cost: 34, drain: 4.2, cooldown: 6,
  mods: { speed: 1.08, damage: 1.14, kbs: 1.08, defense: .94, startup: .94, jump: 1.04 },
  special: { label: 'SAGE RASENSANSHURIKEN', type: 'spinning', color: 0xffd08a, damage: 26, speed: 34, cooldown: .78, stun: .6, kn: 8.8, knockback: 8.8 },
  ultimate: { label: 'SAGE ART: MASSIVE RASENGAN BARRAGE', damage: 1.3, behaviour: 'storm', color: 0xffc46a },
  note: 'Balanced sage chakra: faster recovery, stronger Rasengan, natural-energy reach.'
});

const FORM_NARUTO_NINE = form({
  id: 'nine-tails-chakra', label: 'NINE-TAILS CHAKRA MODE', aura: 'flame', auraScale: .58, color: 0xffb03a, tier: 2,
  look: { hair: { color: 0xf7d452, emissive: 0xffb03a, emissiveIntensity: 1.9, scale: 1.08 }, accent: { emissive: 0xffb03a, emissiveIntensity: 2.6 } },
  duration: 10, cost: 42, drain: 5.6, cooldown: 7,
  mods: { speed: 1.2, damage: 1.2, kbs: 1.12, defense: .94, startup: .9, jump: 1.08 },
  special: { label: 'TAILED BEAST RASENGAN', type: 'orb', color: 0xffcf5e, damage: 30, speed: 32, cooldown: .9, stun: .62, knockback: 9.6 },
  ultimate: { label: 'KURAMA CHAKRA BARRAGE', damage: 1.34, behaviour: 'rush', color: 0xffb03a },
  note: 'Chakra cloak: fastest movement tier, chakra arms, heavier Rasengan; defence drops.'
});

const FORM_NARUTO_KURAMA = form({
  id: 'kurama-link', label: 'KURAMA LINK MODE', aura: 'flame', auraScale: .58, color: 0xffd76c, tier: 3,
  look: { hair: { color: 0xffe08a, emissive: 0xffd76c, emissiveIntensity: 2.2, scale: 1.1 }, accent: { emissive: 0xffd76c, emissiveIntensity: 3.0 } },
  duration: 11, cost: 50, drain: 5.0, cooldown: 8,
  mods: { speed: 1.06, damage: 1.3, kbs: 1.22, defense: .78, startup: 1.0, jump: 1.04 },
  special: { label: 'TAILED BEAST BOMB', type: 'orb', color: 0xffe6a0, damage: 34, speed: 26, cooldown: 1.1, stun: .7, knockback: 12.2 },
  ultimate: { label: 'KURAMA AVATAR CATACLYSM', damage: 1.4, behaviour: 'slam', color: 0xffd76c },
  note: 'Armoured avatar link: heavy damage and huge knockback, slower start-ups, real damage taken.'
});

const FORM_NARUTO_SIXPATHS = form({
  id: 'six-paths-sage', label: 'SIX PATHS SAGE MODE', aura: 'lightning', auraScale: .9, color: 0x9fe8ff, tier: 4,
  look: { hair: { color: 0xf2fbff, emissive: 0x9fe8ff, emissiveIntensity: 2.0, scale: 1.06 }, accent: { emissive: 0x9fe8ff, emissiveIntensity: 3.0 } },
  duration: 11, cost: 58, drain: 6.0, cooldown: 9,
  mods: { speed: 1.24, damage: 1.26, kbs: 1.16, defense: .9, startup: .86, jump: 1.14 },
  special: { label: 'TRUTH-SEEKING ORB VOLLEY', type: 'orb', color: 0xdff6ff, damage: 28, speed: 44, cooldown: .68, stun: .5, knockback: 9.0 },
  ultimate: { label: 'SUPER TAILED BEAST RASENSHURIKEN BARRAGE', damage: 1.44, behaviour: 'beam', color: 0x9fe8ff },
  note: 'Six Paths chakra: flight-speed movement, orbs and the strongest ranged ultimate in his kit.'
});

const FORM_NARUTO_BARYON = form({
  id: 'baryon-mode', label: 'BARYON MODE', aura: 'flame', auraScale: .55, color: 0xff4b4b, tier: 5,
  look: { hair: { color: 0xff6a6a, emissive: 0xff3b3b, emissiveIntensity: 2.8, scale: 1.05 }, accent: { emissive: 0xff4b4b, emissiveIntensity: 3.6 } },
  duration: 8, cost: 66, drain: 9.5, cooldown: 11,
  mods: { speed: 1.32, damage: 1.44, kbs: 1.26, defense: 1.12, startup: .8, jump: 1.12 },
  special: { label: 'BARYON RUSH', type: 'spinning', color: 0xff7a7a, damage: 36, speed: 46, cooldown: .8, stun: .55, knockback: 11.4, behavior: 'dashStrike', dashSpeed: 52, range: 22 },
  ultimate: { label: 'BARYON MODE: FINAL IMPACT', damage: 1.55, behaviour: 'rush', color: 0xff4b4b },
  note: 'Short-lived, life-burning form: highest damage and speed, drains hard and you take more.'
});

// Goku's three-form ladder. They are deliberately different fighters: Super Saiyan is the
// balanced power state, Blue spends more drain for speed and a stronger signature, and Ultra
// Instinct is the EVASIVE state - the smallest damage multiplier in the ladder, but the fastest
// start-ups and the best defence, because the dodge is the mechanic, not raw damage.
const FORM_GOKU_SS = form({
  id: 'goku-super-saiyan', label: 'SUPER SAIYAN', aura: 'flame', color: 0xffd45e, tier: 1,
  look: { hair: { color: 0xf7d452, emissive: 0xffe98a, emissiveIntensity: 1.6, scale: 1.14 }, accent: { emissive: 0xffd45e, emissiveIntensity: 2.4 } },
  duration: 10, cost: 40, drain: 5.2, cooldown: 7,
  mods: { speed: 1.14, damage: 1.22, kbs: 1.16, defense: .96, startup: .92, jump: 1.06 },
  special: { label: 'KAMEHAMEHA · SUPER SAIYAN', type: 'beam', color: 0xffe27a, damage: 28, speed: 38, cooldown: .84, stun: .56, knockback: 9.6 },
  ultimate: { label: 'DRAGON NOVA · SUPER SAIYAN', damage: 1.26 },
  note: 'Golden hair, faster wind-ups and heavier ki; a steady drain keeps it a decision.'
});
const FORM_GOKU_SSB = form({
  id: 'goku-super-saiyan-blue', label: 'SUPER SAIYAN BLUE', aura: 'lightning', color: 0x5fc8ff, tier: 2,
  look: { hair: { color: 0x9fe4ff, emissive: 0x4fb8ff, emissiveIntensity: 2.0, scale: 1.12 }, accent: { emissive: 0x5fc8ff, emissiveIntensity: 3.0 } },
  duration: 9, cost: 52, drain: 7.2, cooldown: 9,
  mods: { speed: 1.22, damage: 1.3, kbs: 1.2, defense: .94, startup: .86, jump: 1.1 },
  special: { label: 'DIVINE KAMEHAMEHA', type: 'beam', color: 0x8fd8ff, damage: 32, speed: 42, cooldown: .8, stun: .6, knockback: 10.6 },
  ultimate: { label: 'DRAGON NOVA · BLUE', damage: 1.36 },
  note: 'God ki: more speed and damage than gold, with a heavier drain and no extra defence.'
});
const FORM_GOKU_UI = form({
  id: 'goku-ultra-instinct', label: 'ULTRA INSTINCT', aura: 'holy', color: 0xd8e6ff, tier: 3,
  look: { hair: { color: 0xf4f8ff, emissive: 0xbfd4ff, emissiveIntensity: 1.8, scale: 1.08 }, accent: { emissive: 0xd8e6ff, emissiveIntensity: 2.6 } },
  duration: 10, cost: 60, drain: 6.0, cooldown: 11,
  // Evasion state: the fastest start-ups and the best damage reduction in the ladder, but the
  // smallest damage multiplier - it wins by not being hit, not by hitting harder.
  mods: { speed: 1.32, damage: 1.12, kbs: 1.06, defense: .82, startup: .74, jump: 1.16 },
  special: { label: 'SILVER KI BLAST', type: 'orb', color: 0xeaf4ff, damage: 24, speed: 50, cooldown: .56, stun: .44, knockback: 8.0 },
  ultimate: { label: 'ULTRA INSTINCT · FINAL KAMEHAMEHA', damage: 1.3 },
  note: 'Silvery aura, near-instant start-ups and heavy damage reduction; damage itself barely rises.'
});

const ult = (o) => Object.freeze({ ...o });

export const MOVESETS = Object.freeze({
  // ---------------------------------------------------------------- Infantry (imported HD body)
  // Grounded ranged brawler: melee that closes distance, a rifle for the midrange and one blast
  // ultimate. No transformation and no borrowed signature - the kit is its own.
  infantry: Object.freeze({
    key: 'infantry', style: 'Infantry · grounded ranged brawler', formless: true,
    lights: ['Rifle Butt', 'Combat Cross', 'Boot Kick'],
    heavy: ['Armour Breaker', 'Stock Slam'],
    aerial: 'Jump Knee',
    ultimate: ult({
      label: 'SUPPRESSING FIRE', behaviour: 'barrage', damage: 13, kbs: 96, launchY: 6.2,
      stun: .55, range: 24, hits: 6, color: 0xffd27a, startup: .5, active: .9, recovery: .55,
      note: 'Six rifle bursts down a lane. Each burst is its own hit and cover stops it.'
    })
  }),

  // ---------------------------------------------------------------- DC, science, cosmic
  superman: Object.freeze({
    key: 'superman', style: 'Warrior · flying powerhouse',
    lights: ['Kryptonian Jab', 'Cross of Steel', 'Rising Uppercut'],
    heavy: ['Meteor Fist', 'Groundbreaker'],
    aerial: 'Skyfall Strike',
    form: form({
      id: 'solar-overcharge', label: 'SOLAR OVERCHARGE', aura: 'flame', color: 0xffd45e,
      duration: 9, cost: 46, drain: 5.4, cooldown: 9,
      mods: { speed: 1.08, damage: 1.16, kbs: 1.1, defense: .94, startup: .96, jump: 1.05 },
      special: { label: 'HEAT VISION · SOLAR', type: 'beam', color: 0xffe27a, damage: 24, speed: 46, cooldown: .58, stun: .52, knockback: 6.6 },
      ultimate: { label: "LAST SON'S JUDGEMENT · OVERCHARGE", damage: 1.3 },
      note: 'Heat vision widens, aerials hit harder, flight accelerates — the form drains while you hold it.'
    }),
    ultimate: ult({
      label: "LAST SON'S JUDGEMENT", behaviour: 'slam', damage: 24, kbs: 132, launchY: 12.4,
      stun: 1.05, radius: 7.2, range: 22, color: 0xff5d4a, startup: .62, active: .92, recovery: .66,
      note: 'Leaps up, dives onto the marked landing zone, then launches. The leap is avoidable.'
    })
  }),

  iron_man_tony_stark: Object.freeze({
    key: 'iron_man_tony_stark', style: 'Cyborg · aerial ranged fighter',
    lights: ['Repulsor Jab', 'Armor Cross', 'Thruster Knee'],
    heavy: ['Rocket Punch', 'Airborne Divebomb'],
    aerial: 'Powered Haymaker',
    form: form({
      id: 'overdrive-protocol', label: 'OVERDRIVE PROTOCOL', aura: 'ring', color: 0x36eaff,
      // The arc reactor is real geometry on the fighter's chest: overdrive drives it white-hot
      // and brightens the armour's emissive seams.
      look: { reactor: { color: 0xe8feff, emissive: 0x9dfcff, emissiveIntensity: 3.4 }, accent: { emissive: 0x36eaff, emissiveIntensity: 2.2 } },
      duration: 8.5, cost: 44, drain: 6.2, cooldown: 8,
      mods: { speed: 1.1, damage: 1.14, kbs: 1.04, defense: 1, startup: .9, jump: 1 },
      special: { label: 'UNIBEAM · OVERDRIVE', type: 'beam', color: 0x9dfcff, damage: 25, speed: 40, cooldown: .76, stun: .5, knockback: 7.4 },
      ultimate: { label: 'ARC REACTOR OVERLOAD · OVERDRIVE', damage: 1.28 },
      note: 'Repulsors recharge faster and thrusters bite harder, but the reactor burns energy the whole time.'
    }),
    ultimate: ult({
      label: 'ARC REACTOR OVERLOAD', behaviour: 'beam', beamStyle: 'palms', damage: 30, kbs: 118, launchY: 9.6,
      stun: .95, range: 30, width: 2.6, color: 0x8ff9ff, startup: .6, active: .8, recovery: .62,
      note: 'Sweeps a chest beam down a lane. The charge is interruptible before it fires.'
    })
  }),

  hulk_bruce_banner: Object.freeze({
    key: 'hulk_bruce_banner', style: 'Brawler · heavy grappler',
    lights: ['Gamma Jab', 'Double Smash', 'Rising Fist'],
    heavy: ['Hulk Hammer', 'Ground Pound'],
    aerial: 'Meteor Drop',
    form: form({
      id: 'worldbreaker-rage', label: 'WORLDBREAKER RAGE', aura: 'steam', color: 0x9bff6a,
      duration: 10, cost: 40, drain: 4.2, cooldown: 8,
      mods: { speed: 1.02, damage: 1.3, kbs: 1.28, defense: .82, startup: 1.1, jump: 1 },
      special: { label: 'THUNDERCLAP · WORLDBREAKER', type: 'shockwave', color: 0xc4ff7a, damage: 29, speed: 22, cooldown: 1.0, stun: .7, knockback: 12, behavior: 'shockwave', radius: 8.2 },
      ultimate: { label: 'WORLDBREAKER IMPACT · RAGE', damage: 1.26 },
      note: 'Far more damage and knockback with a wider shockwave, but slower wind-ups.'
    }),
    ultimate: ult({
      label: 'WORLDBREAKER IMPACT', behaviour: 'slam', damage: 27, kbs: 150, launchY: 10.8,
      stun: 1.1, radius: 8.6, range: 18, color: 0xff9d3d, startup: .7, active: 1.05, recovery: .7,
      note: 'Leaps and crashes into a marked zone, then a second outward shockwave.'
    })
  }),

  green_lantern_hal_jordan: Object.freeze({
    key: 'green_lantern_hal_jordan', style: 'Mage · construct control',
    lights: ['Ring Jab', 'Hard-Light Cross', 'Construct Knee'],
    heavy: ['Giant Construct Hammer', 'Power-Fist Slam'],
    aerial: 'Emerald Drop',
    form: form({
      id: 'will-unbound', label: 'WILL UNBOUND', aura: 'construct', color: 0x55ff95,
      duration: 9, cost: 46, drain: 5.8, cooldown: 8.5,
      mods: { speed: 1.06, damage: 1.18, kbs: 1.08, defense: 1, startup: .9, jump: 1 },
      special: { label: 'CONSTRUCT BOLT · UNBOUND', type: 'construct', color: 0x7dffb0, damage: 22, speed: 33, cooldown: .66, stun: .48, knockback: 6.8 },
      ultimate: { label: 'EMERALD JUDGMENT · UNBOUND', damage: 1.25 },
      note: 'Constructs build and fire faster but the ring drains quicker.'
    }),
    ultimate: ult({
      label: 'EMERALD JUDGMENT', behaviour: 'zone', damage: 9, ticks: 4, kbs: 96, launchY: 7.6,
      stun: .62, radius: 6.4, range: 16, color: 0x5cff9d, startup: .58, active: 1.5, recovery: .6,
      note: 'A construct pins a marked area, then a giant hammer lands inside it. Leave the zone.'
    })
  }),

  wonder_woman: Object.freeze({
    key: 'wonder_woman', style: 'Warrior · parry and counter specialist',
    lights: ['Amazon Jab', 'Sword Cross', 'Shield Knee'],
    heavy: ['Godkiller Slash', 'Shieldbreaker'],
    aerial: "Warrior's Finish",
    form: form({
      id: 'champion-of-themyscira', label: 'CHAMPION OF THEMYSCIRA', aura: 'holy', color: 0xffd76c,
      duration: 9, cost: 45, drain: 5, cooldown: 8.5,
      mods: { speed: 1.06, damage: 1.2, kbs: 1.12, defense: .94, startup: .94, jump: 1 },
      special: { label: 'AMAZON LASSO · CHAMPION', type: 'lasso', color: 0xffe49b, damage: 19, speed: 35, cooldown: .7, stun: .92, knockback: 5.4 },
      ultimate: { label: 'WRATH OF THE AMAZONS · CHAMPION', damage: 1.3 },
      note: 'Sword and shield bite harder and the lasso holds longer — no permanent armour.'
    }),
    ultimate: ult({
      label: 'WRATH OF THE AMAZONS', behaviour: 'grab', damage: 20, hits: 3, kbs: 128,
      launchY: 10.4, stun: 1, range: 13, color: 0xffd76c, startup: .5, active: 1.05, recovery: .6,
      note: 'Lasso pull into a shield bash and finishing sword strike. A missed pull ends the chain.'
    })
  }),

  professor_x_charles_xavier: Object.freeze({
    key: 'professor_x_charles_xavier', style: 'Mage · psychic control',
    lights: ['Psionic Tap', 'Mindwave Push', 'Psychic Lift'],
    heavy: ['Telekinetic Slam', 'Mindshock Burst'],
    aerial: 'Focused Pulse',
    form: form({
      id: 'cerebral-ascendance', label: 'CEREBRAL ASCENDANCE', aura: 'ring', color: 0xb5a0ff,
      duration: 10, cost: 48, drain: 4.6, cooldown: 9,
      mods: { speed: 1.04, damage: 1.22, kbs: 1.1, defense: .9, startup: .96, jump: 1 },
      special: { label: 'PSIONIC PULSE · ASCENDANT', type: 'psychic', color: 0xd4c6ff, damage: 16, speed: 26, cooldown: .78, stun: 1.15, knockback: 3.2 },
      ultimate: { label: 'CEREBRO OVERLOAD · ASCENDANT', damage: 1.24 },
      note: 'Wider psychic reach and longer control, at a higher energy price and slower recovery.'
    }),
    ultimate: ult({
      label: 'CEREBRO OVERLOAD', behaviour: 'zone', damage: 8, ticks: 5, kbs: 86, launchY: 6.4,
      stun: .72, radius: 7, range: 18, color: 0xc0a8ff, startup: .64, active: 1.7, recovery: .62,
      note: 'A psychic field disrupts movement inside the ring and ends in a telekinetic shockwave.'
    })
  }),

  the_flash_barry_allen: Object.freeze({
    key: 'the_flash_barry_allen', style: 'Ninja · high-speed rushdown',
    lights: ['Speed Jab', 'Lightning Cross', 'Afterimage Kick'],
    heavy: ['Sonic Breaker', 'Cyclone Kick'],
    aerial: 'Supersonic Drop',
    form: form({
      id: 'speed-force-ascendant', label: 'SPEED FORCE ASCENDANT', aura: 'lightning', color: 0xffdf52,
      duration: 8, cost: 42, drain: 6.8, cooldown: 8,
      mods: { speed: 1.3, damage: 1.06, kbs: 1, defense: 1, startup: .82, jump: 1.12 },
      special: { label: 'SPEED FORCE STRIKE · ASCENDANT', type: 'lightning', color: 0xfff4a0, damage: 20, speed: 52, cooldown: .48, stun: .34, knockback: 5.8, behavior: 'dashStrike', dashSpeed: 54, range: 22 },
      ultimate: { label: 'INFINITE MASS IMPACT · ASCENDANT', damage: 1.3 },
      note: 'Much faster movement and recovery, tiny damage gain, and the speed meter empties fast.'
    }),
    ultimate: ult({
      label: 'INFINITE MASS IMPACT', behaviour: 'rush', damage: 8, hits: 4, kbs: 140, launchY: 10,
      stun: .8, range: 18, color: 0xfff06a, startup: .46, active: 1.4, recovery: .58,
      note: 'Telegraphed high-speed rush of four hits ending in a launch. Dodgeable before the last hit.'
    })
  }),

  aquaman: Object.freeze({
    key: 'aquaman', style: 'Warrior · reach and space control',
    lights: ['Trident Jab', 'Ocean Cross', 'Rising Fork'],
    heavy: ['Tidal Cleave', 'Deep-Sea Slam'],
    aerial: "King's Sweep",
    form: form({
      id: 'king-of-the-deep', label: 'KING OF THE DEEP', aura: 'wind', color: 0x4adfff,
      duration: 9.5, cost: 46, drain: 5.2, cooldown: 9,
      mods: { speed: 1.05, damage: 1.18, kbs: 1.14, defense: .95, startup: .96, jump: 1.06 },
      special: { label: 'TIDAL TRIDENT · KING', type: 'water', color: 0x9df3ff, damage: 23, speed: 30, cooldown: .78, stun: .52, knockback: 8.4 },
      ultimate: { label: "LEVIATHAN'S JUDGMENT · KING", damage: 1.28 },
      note: 'Longer trident reach and heavier water strikes, with slower energy recovery.'
    }),
    ultimate: ult({
      label: "LEVIATHAN'S JUDGMENT", behaviour: 'storm', damage: 15, hits: 2, kbs: 132, launchY: 12,
      stun: 1, radius: 5.4, range: 18, color: 0x54e8ff, startup: .56, active: 1.15, recovery: .62, gap: .5,
      note: 'A wave lifts the target, then a trident strike lands on the marked spot. Both are dodgeable.'
    })
  }),

  doctor_strange: Object.freeze({
    key: 'doctor_strange', style: 'Mage · portals and spell setups',
    lights: ['Mystic Palm', 'Rune Strike', 'Floating Knee'],
    heavy: ['Crimson Bands Slam', 'Mystic Hammer'],
    aerial: 'Sigil Burst',
    form: form({
      id: 'sorcerer-supreme', label: 'SORCERER SUPREME', aura: 'ring', color: 0xffa54d,
      duration: 9, cost: 48, drain: 6, cooldown: 9,
      mods: { speed: 1.05, damage: 1.2, kbs: 1.08, defense: .92, startup: .9, jump: 1 },
      special: { label: 'ELDRITCH BIND · SUPREME', type: 'magic', color: 0xffc47a, damage: 20, speed: 27, cooldown: .7, stun: 1.1, knockback: 4.6 },
      ultimate: { label: 'CRIMSON DIMENSION · SUPREME', damage: 1.26 },
      note: 'Spells recharge faster and bind longer; spell energy drains and portals still cannot cross bounds.'
    }),
    ultimate: ult({
      label: 'CRIMSON DIMENSION', behaviour: 'zone', damage: 9, ticks: 4, kbs: 100, launchY: 7.8,
      stun: .68, radius: 6.6, range: 18, color: 0xff9a4d, startup: .6, active: 1.45, recovery: .62,
      note: 'A bounded mystic ring that burns anything inside, ending in an energy blast.'
    })
  }),

  arnold_schwarzenegger: Object.freeze({
    key: 'arnold_schwarzenegger', style: 'Brawler · heavy cybernetic weapons',
    lights: ['Steel Knuckle', 'Hydraulic Cross', 'Cyborg Knee'],
    heavy: ['Cannon Bash', 'Servo Slam'],
    aerial: 'Overhead Wrecking Strike',
    form: form({
      id: 'combat-chassis-overdrive', label: 'COMBAT CHASSIS OVERDRIVE', aura: 'steam', color: 0xff6c52,
      duration: 9, cost: 44, drain: 5.6, cooldown: 9,
      mods: { speed: .94, damage: 1.26, kbs: 1.18, defense: .88, startup: 1.04, jump: 1 },
      special: { label: 'CYBERNETIC CANNON · OVERDRIVE', type: 'bullet', color: 0xffa07a, damage: 26, speed: 44, cooldown: .95, stun: .46, knockback: 9.2 },
      ultimate: { label: 'TOTAL SYSTEM ANNIHILATION · OVERDRIVE', damage: 1.24 },
      note: 'Cannon hits far harder and armour holds, but the chassis is slower and heats up.'
    }),
    ultimate: ult({
      label: 'TOTAL SYSTEM ANNIHILATION', behaviour: 'barrage', damage: 11, hits: 3, kbs: 120,
      launchY: 8.8, stun: .7, range: 24, radius: 2.4, color: 0xff8261, startup: .58, active: 1.1, recovery: .6,
      note: 'Three cannon shells down a lane; walls stop them and each shell is one real hit.'
    })
  }),

  // ---------------------------------------------------------------- Anime and platform fighters
  goku: Object.freeze({
    key: 'goku', style: 'Warrior · ki martial arts',
    lights: ['Turtle School Jab', 'Power Cross', 'Rising Dragon Kick'],
    heavy: ['Dragon Fist', 'Meteor Combination'],
    aerial: 'Meteor Finish',
    form: FORM_GOKU_SS,
    forms: Object.freeze([FORM_GOKU_SS, FORM_GOKU_SSB, FORM_GOKU_UI]),
    ultimate: ult({
      label: 'DRAGON NOVA · FINAL KAMEHAMEHA', behaviour: 'beam', beamStyle: 'twoHanded', damage: 33, kbs: 126, launchY: 11.2,
      stun: 1, range: 32, width: 2.8, color: 0x4b9dff, startup: .72, active: .85, recovery: .7,
      note: 'Charged Dragon Fist into a Kamehameha down a lane. Interruptible during the charge.'
    })
  }),

  // Original fighter authored in this repository: assets/blender/build_anime_fighter.py exports
  // its rigged, animated GLB (public/models/characters/kaze/kaze.glb). No third-party asset is
  // involved, so this entry is the reference for a fully original character.
  kaze: Object.freeze({
    key: 'kaze', style: 'Warrior · wind-step martial arts',
    lights: ['Reed Palm', 'Turning Elbow', 'Rising Gale Kick'],
    heavy: ['Crushing Palm', 'Whirlwind Sweep'],
    aerial: 'Falling Leaf Strike',
    form: form({
      id: 'wind-step', label: 'WIND-STEP', aura: 'wind', color: 0x7fe6cf,
      look: { hair: { emissive: 0x7fe6cf, emissiveIntensity: 1.2, scale: 1.04 }, accent: { emissive: 0x7fe6cf, emissiveIntensity: 2.0 } },
      duration: 8, cost: 42, drain: 7, cooldown: 9,
      mods: { speed: 1.26, damage: 1.1, kbs: 1.06, defense: .96, startup: .86, jump: 1.12 },
      special: { label: 'GALE CUTTER · WIND-STEP', type: 'orb', color: 0x9ff2dd, damage: 19, speed: 34, cooldown: .6, stun: .5, knockback: 7.2 },
      ultimate: { label: 'THOUSAND-STEP TEMPEST', damage: 1.24 },
      note: 'Faster steps and quicker startups with a teal wind aura; mobility is the trade for weaker raw damage.'
    }),
    ultimate: ult({
      label: 'THOUSAND-STEP TEMPEST', behaviour: 'rush', damage: 16, hits: 3, kbs: 118, launchY: 9.4,
      stun: .86, range: 16, radius: 2.2, color: 0x7fe6cf, startup: .54, active: .9, recovery: .62,
      note: 'Three wind-stepped passes down a lane; each pass is one real hit and the lane can be stepped out of.'
    })
  }),

  naruto_uzumaki: Object.freeze({
    key: 'naruto_uzumaki', style: 'Ninja · clones and chakra forms',
    lights: ['Leaf Jab', 'Shadow Cross', 'Rising Clone Kick'],
    heavy: ['Giant Rasengan', 'Clone Launcher'],
    aerial: 'Uzumaki Finish',
    // Five real forms in sequence. `form` stays as the first one so the HUD, the select screen and
    // the single-form tests keep one authoritative "current form"; `forms` is the progression the
    // runtime walks, and every entry has its own numbers, aura, signature move and ultimate.
    form: FORM_NARUTO_SAGE,
    forms: Object.freeze([FORM_NARUTO_SAGE, FORM_NARUTO_NINE, FORM_NARUTO_KURAMA, FORM_NARUTO_SIXPATHS, FORM_NARUTO_BARYON]),
    ultimate: ult({
      // `cloneBarrage` is read by the ultimate runner: this ultimate has to put real clones on the
      // field, not paint them into the effect, or the name is the only thing clone-specific about it.
      label: 'MASSIVE SHADOW CLONE RASENGAN BARRAGE', behaviour: 'rush', cloneBarrage: true, damage: 9, hits: 4, kbs: 136,
      launchY: 11.6, stun: .9, range: 16, color: 0xffc46a, startup: .56, active: 1.35, recovery: .62,
      note: 'Clone-assisted rush of four hits ending in a Rasengan launcher. Ends if the opener misses.'
    })
  }),

  vegeta: Object.freeze({
    key: 'vegeta', style: 'Warrior · aggressive ki pressure',
    lights: ['Royal Jab', 'Saiyan Cross', 'Knee Breaker'],
    heavy: ['Galick Uppercut', 'Saiyan Hammer'],
    aerial: 'Pride Launcher',
    form: form({
      id: 'super-saiyan', label: 'SUPER SAIYAN', aura: 'flame', color: 0xffd45e,
      // Gold hair with a taller silhouette plus bright ki accents: the transformation changes
      // the body's own surfaces where those surfaces exist, and nothing when they do not.
      look: { hair: { color: 0xf7d452, emissive: 0xffe98a, emissiveIntensity: 1.35, scale: 1.12 }, accent: { emissive: 0xffd45e, emissiveIntensity: 2.6 } },
      duration: 9, cost: 48, drain: 5.8, cooldown: 9,
      mods: { speed: 1.14, damage: 1.22, kbs: 1.16, defense: .96, startup: .92, jump: 1.05 },
      special: { label: 'GALICK GUN · SUPER SAIYAN', type: 'beam', color: 0xd99dff, damage: 27, speed: 38, cooldown: .88, stun: .56, knockback: 9.6 },
      ultimate: { label: 'FINAL FLASH · ROYAL RUIN', damage: 1.3 },
      note: 'Golden aura, bigger ki damage and faster wind-ups, with a steady drain.'
    }),
    ultimate: ult({
      label: 'FINAL FLASH · ROYAL RUIN', behaviour: 'beam', damage: 34, kbs: 130, launchY: 9.8,
      stun: 1, range: 34, width: 2.1, color: 0xc06bff, startup: .8, active: .8, recovery: .72,
      note: 'Narrow, punishing beam. The long charge is a real punish window.'
    })
  }),

  saitama: Object.freeze({
    key: 'saitama', style: 'Brawler · one-punch punish',
    lights: ['Casual Jab', 'Serious Cross', 'Rising Punch'],
    heavy: ['Serious Headbutt', 'Consecutive Normal Punches'],
    aerial: 'Cape Sweep',
    form: form({
      id: 'serious-mode', label: 'SERIOUS MODE', aura: 'steam', color: 0xffe4a2,
      duration: 8, cost: 42, drain: 4.4, cooldown: 8,
      mods: { speed: 1.06, damage: 1.34, kbs: 1.32, defense: .9, startup: 1.06, jump: 1 },
      special: { label: 'SERIOUS PUNCH · SERIES', type: 'shockwave', color: 0xfff3c4, damage: 33, speed: 26, cooldown: 1.2, stun: .5, knockback: 14, behavior: 'shockwave', radius: 8.4 },
      ultimate: { label: 'SERIOUS SERIES · SERIOUS PUNCH', damage: 1.3 },
      note: 'A committed stance: much more damage and knockback, slower wind-ups, still not invulnerable.'
    }),
    ultimate: ult({
      label: 'SERIOUS SERIES: SERIOUS PUNCH', behaviour: 'rush', damage: 40, hits: 1, kbs: 190,
      launchY: 13, stun: 1.25, range: 8, color: 0xfff0b8, startup: 1.05, active: .5, recovery: .95,
      note: 'One enormous hit after a long windup. Missing it leaves him wide open.'
    })
  }),

  l_death_note_style: Object.freeze({
    key: 'l_death_note_style', style: 'Cyborg · traps and prediction',
    lights: ['Deduction Jab', 'Feint Cross', 'Low Sweep'],
    heavy: ['Chair Kick', 'Evidence Slam'],
    aerial: 'Calculated Finish',
    form: form({
      id: 'absolute-deduction', label: 'ABSOLUTE DEDUCTION', aura: 'shadow', color: 0xd4d6e0,
      duration: 10, cost: 44, drain: 4, cooldown: 9,
      mods: { speed: 1.08, damage: 1.16, kbs: 1.04, defense: .92, startup: .9, jump: 1 },
      special: { label: 'DEATH NOTE HEX · DEDUCTION', type: 'psychic', color: 0xf0f0ff, damage: 12, speed: 22, cooldown: 1.05, stun: 1.35, knockback: 1.6 },
      ultimate: { label: 'FINAL VERDICT · DEDUCTION', damage: 1.22 },
      note: 'Longer marks, faster traps and better spacing — never a guaranteed kill.'
    }),
    ultimate: ult({
      label: 'FINAL VERDICT', behaviour: 'zone', damage: 10, ticks: 3, kbs: 92, launchY: 8,
      stun: .8, radius: 5.8, range: 20, color: 0xe6e8f2, startup: .7, active: 1.25, recovery: .6,
      note: 'Marks a zone, sets traps, then triggers an impact inside it. Step out before it lands.'
    })
  }),

  all_might: Object.freeze({
    key: 'all_might', style: 'Brawler · heroic knockback',
    lights: ['Heroic Jab', 'Detroit Cross', 'Rising Smash'],
    heavy: ['United States Smash', 'Texas Breaker'],
    aerial: 'Airborne Hero Drop',
    form: form({
      id: 'full-cowl', label: 'ONE FOR ALL · FULL COWL', aura: 'lightning', color: 0x8ef0ff,
      duration: 9, cost: 46, drain: 6, cooldown: 9,
      mods: { speed: 1.16, damage: 1.2, kbs: 1.14, defense: .96, startup: .94, jump: 1.06 },
      special: { label: 'DETROIT SMASH · FULL COWL', type: 'shockwave', color: 0xc2f6ff, damage: 29, speed: 26, cooldown: 1.05, stun: .58, knockback: 12.4, behavior: 'shockwave', radius: 7.8 },
      ultimate: { label: 'UNITED STATES OF SMASH · COWL', damage: 1.28 },
      note: 'Faster and stronger with crackling energy; heavy attacks build recoil while it runs.'
    }),
    ultimate: ult({
      label: 'UNITED STATES OF SMASH', behaviour: 'rush', damage: 10, hits: 3, kbs: 156,
      launchY: 11.2, stun: .95, range: 17, color: 0xffdf78, startup: .62, active: 1.25, recovery: .66,
      note: 'Multi-hit rush into a ground impact. The final zone can be dodged.'
    })
  }),

  edward_elric: Object.freeze({
    key: 'edward_elric', style: 'Mage · terrain shaping',
    lights: ['Automail Jab', 'Alchemy Cross', 'Rising Stone Fist'],
    heavy: ['Stone Pillar Uppercut', 'Automail Hammer'],
    aerial: 'Transmutation Finish',
    form: form({
      id: 'philosophers-focus', label: "PHILOSOPHER'S FOCUS", aura: 'construct', color: 0xff765f,
      duration: 9, cost: 46, drain: 5.6, cooldown: 9,
      mods: { speed: 1.04, damage: 1.22, kbs: 1.12, defense: .94, startup: .9, jump: 1 },
      special: { label: 'ALCHEMY SPIKE · FOCUS', type: 'earth', color: 0xffa08f, damage: 22, speed: 30, cooldown: .68, stun: .54, knockback: 7.4 },
      ultimate: { label: 'EQUIVALENT EXCHANGE · FOCUS', damage: 1.24 },
      note: 'Faster transmutation and stronger constructs at a higher energy price.'
    }),
    ultimate: ult({
      label: 'EQUIVALENT EXCHANGE: IRON COLOSSUS', behaviour: 'storm', damage: 16, hits: 2, kbs: 128,
      launchY: 10.6, stun: .9, radius: 4.8, range: 17, color: 0xff8a6a, startup: .64, active: 1.05, recovery: .62, gap: .42,
      note: 'A stone colossus punches twice at marked spots; both strikes are avoidable.'
    })
  }),

  levi_ackerman: Object.freeze({
    key: 'levi_ackerman', style: 'Ninja · precision aerial rushdown',
    lights: ['Blade Jab', 'Cross Cut', 'Spinning Slash'],
    heavy: ['Twin Blade Breaker', 'Whirlwind Cleave'],
    aerial: 'Falling Slice',
    form: form({
      id: 'humanitys-strongest', label: "HUMANITY'S STRONGEST", aura: 'wind', color: 0xe5f1ff,
      duration: 8.5, cost: 44, drain: 6, cooldown: 9,
      mods: { speed: 1.2, damage: 1.16, kbs: 1.06, defense: 1, startup: .84, jump: 1.12 },
      special: { label: 'THUNDER SPEAR · STRONGEST', type: 'blade', color: 0xf4faff, damage: 23, speed: 44, cooldown: .62, stun: .4, knockback: 6.8, behavior: 'dashStrike', dashSpeed: 46, range: 18 },
      ultimate: { label: 'WINGS OF DESTRUCTION · STRONGEST', damage: 1.28 },
      note: 'Quicker blades and better air control, with grapple and blade resources limiting pressure.'
    }),
    ultimate: ult({
      label: 'WINGS OF DESTRUCTION', behaviour: 'rush', damage: 9, hits: 5, kbs: 130,
      launchY: 8.4, stun: .72, range: 15, color: 0xdff0ff, startup: .5, active: 1.5, recovery: .6,
      note: 'Circling blade strikes ending in a diving cut. Stops if the opening misses.'
    })
  }),

  mario: Object.freeze({
    key: 'mario', style: 'Warrior · balanced platform fighter',
    lights: ['Super Jab', 'Mario Combo', 'Rising Headbutt'],
    heavy: ['Super Cape Strike', 'Hammer Flip'],
    aerial: 'Ground Pound',
    form: form({
      id: 'fire-mario', label: 'FIRE MARIO', aura: 'flame', color: 0xff632d,
      duration: 9, cost: 42, drain: 5, cooldown: 8.5,
      mods: { speed: 1.06, damage: 1.18, kbs: 1.1, defense: .95, startup: .94, jump: 1 },
      special: { label: 'FIRE FLOWER BURST', type: 'fireball', color: 0xff9a3d, damage: 19, speed: 28, cooldown: .6, stun: .42, knockback: 5.4 },
      ultimate: { label: 'SUPERSTAR FINALE · FIRE', damage: 1.24 },
      note: 'Hotter fireballs and a flame burst on the finisher; still interruptible.'
    }),
    ultimate: ult({
      label: 'SUPERSTAR FINALE', behaviour: 'rush', damage: 9, hits: 3, kbs: 132,
      launchY: 10.2, stun: .85, range: 15, color: 0xffe066, startup: .58, active: 1.2, recovery: .6,
      note: 'A short powered rush ending in a big jump strike. Not invulnerable the whole way.'
    })
  }),

  luigi: Object.freeze({
    key: 'luigi', style: 'Ninja · evasive launcher',
    lights: ['Nervous Jab', 'Green Cross', 'Upward Boot'],
    heavy: ['Luigi Cyclone', 'Super Jump Slam'],
    aerial: 'Ghostbuster Swing',
    form: form({
      id: 'haunted-hero', label: 'HAUNTED HERO', aura: 'wind', color: 0x9dff9b,
      duration: 9, cost: 42, drain: 5.2, cooldown: 8.5,
      mods: { speed: 1.12, damage: 1.12, kbs: 1.06, defense: .96, startup: .9, jump: 1.1 },
      special: { label: 'POLTERGUST BURST · HAUNTED', type: 'wind', color: 0xc4ffc0, damage: 16, speed: 26, cooldown: .64, stun: .85, knockback: 3.6 },
      ultimate: { label: 'MANSION MELTDOWN · HAUNTED', damage: 1.22 },
      note: 'Stronger Poltergust bursts and better aerial recovery; suction still cannot hold forever.'
    }),
    ultimate: ult({
      label: 'MANSION MELTDOWN', behaviour: 'zone', damage: 8, ticks: 4, kbs: 118, launchY: 10.4,
      stun: .7, radius: 5.6, range: 14, color: 0x9dff9b, startup: .62, active: 1.3, recovery: .62,
      note: 'Vacuums a short cone, then releases it upward. Leave the cone or interrupt the setup.'
    })
  }),

  kratos: Object.freeze({
    key: 'kratos', style: 'Brawler · weapon pressure and rage',
    lights: ['Spartan Jab', 'Axe Cross', 'Shield Bash'],
    heavy: ['Leviathan Cleave', 'Spartan Shoulder'],
    aerial: "Executioner's Finish",
    form: form({
      id: 'spartan-rage', label: 'SPARTAN RAGE', aura: 'flame', color: 0xff5a2a,
      duration: 9, cost: 44, drain: 6, cooldown: 9,
      mods: { speed: 1.1, damage: 1.28, kbs: 1.2, defense: .88, startup: .9, jump: 1 },
      special: { label: 'LEVIATHAN AXE RUSH · RAGE', type: 'frost', color: 0xffb07a, damage: 27, speed: 34, cooldown: .9, stun: .58, knockback: 10.2, behavior: 'dashStrike', dashSpeed: 38, range: 15 },
      ultimate: { label: 'WRATH OF THE FALLEN GOD · RAGE', damage: 1.28 },
      note: 'Close-range damage and resistance jump; the rage meter drains and finishers cost recovery.'
    }),
    ultimate: ult({
      label: 'WRATH OF THE FALLEN GOD', behaviour: 'rush', damage: 11, hits: 3, kbs: 148,
      launchY: 11.4, stun: .95, range: 16, color: 0xffa05c, startup: .62, active: 1.3, recovery: .66,
      note: 'Axe chain, shield bash and a runic ground burst. A blocked opener ends the chain.'
    })
  }),

  link: Object.freeze({
    key: 'link', style: 'Warrior · versatile sword and tools',
    lights: ["Hero's Slash", 'Shield Jab', 'Rising Sword'],
    heavy: ['Charged Spin Attack', 'Great Blade Breaker'],
    aerial: 'Spinning Finish',
    form: form({
      id: 'triforce-resonance', label: 'TRIFORCE RESONANCE', aura: 'holy', color: 0xffdc78,
      duration: 9.5, cost: 44, drain: 4.8, cooldown: 9,
      mods: { speed: 1.08, damage: 1.2, kbs: 1.1, defense: .92, startup: .94, jump: 1 },
      special: { label: 'HERO ARROW · RADIANT', type: 'arrow', color: 0xfff0a8, damage: 21, speed: 44, cooldown: .62, stun: .36, knockback: 6.4 },
      ultimate: { label: 'HERO OF HYRULE · RESONANCE', damage: 1.26 },
      note: 'Empowered blade and faster tool recharge — no immunity to damage.'
    }),
    ultimate: ult({
      label: 'HERO OF HYRULE', behaviour: 'storm', damage: 8, hits: 3, kbs: 138, launchY: 11,
      stun: .85, radius: 4.4, range: 16, color: 0xfff0a0, startup: .6, active: 1.2, recovery: .62, gap: .34,
      note: 'Charged arrow, then a sword combo into a radiant blade strike. Each stage hits separately.'
    })
  }),

  // ---------------------------------------------------------------- Military, elemental, fantasy
  master_chief: Object.freeze({
    key: 'master_chief', style: 'Cyborg · tactical ranged combat',
    lights: ['Spartan Jab', 'Rifle Butt', 'Knee Strike'],
    heavy: ['Spartan Charge', 'Shieldbreaker Bash'],
    aerial: 'Ground Pound',
    form: form({
      id: 'mjolnir-overdrive', label: 'MJOLNIR OVERDRIVE', aura: 'ring', color: 0x6effb0,
      duration: 9, cost: 44, drain: 5.4, cooldown: 9,
      mods: { speed: 1.08, damage: 1.14, kbs: 1.08, defense: .84, startup: .94, jump: 1 },
      special: { label: 'PLASMA GRENADE · OVERDRIVE', type: 'grenade', color: 0xa6ffcf, damage: 26, speed: 22, cooldown: .95, stun: .7, knockback: 10.4 },
      ultimate: { label: 'ORBITAL HAMMERFALL · OVERDRIVE', damage: 1.26 },
      note: 'Shield systems recover faster and equipment handles better while the pack burns energy.'
    }),
    ultimate: ult({
      label: 'ORBITAL HAMMERFALL', behaviour: 'storm', damage: 24, hits: 2, kbs: 140, launchY: 10.6,
      stun: .95, radius: 5.2, range: 22, color: 0x9dffd0, startup: .8, active: 1.2, recovery: .7, gap: .55,
      note: 'A marker appears, then a strike lands on it. Move out of the marked zone.'
    })
  }),

  thor: Object.freeze({
    key: 'thor', style: 'Warrior · thunder bruiser',
    lights: ['Mjolnir Jab', 'Stormbreaker Cross', 'Thunder Knee'],
    heavy: ['Hammerfall', 'Bifrost Slam'],
    aerial: 'Asgardian Finish',
    form: form({
      id: 'all-fathers-storm', label: "ALL-FATHER'S STORM", aura: 'lightning', color: 0x7be6ff,
      duration: 10, cost: 48, drain: 5.4, cooldown: 9,
      mods: { speed: 1.12, damage: 1.24, kbs: 1.2, defense: .9, startup: .92, jump: 1.08 },
      special: { label: 'STORMBREAKER · ALL-FATHER', type: 'lightning', color: 0xbdf6ff, damage: 30, speed: 38, cooldown: .92, stun: .62, knockback: 11.4, behavior: 'thunderStrike', range: 38 },
      ultimate: { label: "RAGNAROK'S WRATH · ALL-FATHER", damage: 1.26 },
      note: 'Lightning gains range and flight control tightens, at a heavy storm-energy cost.'
    }),
    ultimate: ult({
      label: "RAGNAROK'S WRATH", behaviour: 'storm', damage: 18, hits: 2, kbs: 146, launchY: 12.4,
      stun: 1, radius: 6, range: 20, color: 0x9df0ff, startup: .62, active: 1.2, recovery: .66, gap: .48,
      note: 'Lightning lands on a marked zone, then a hammer strike follows. Both are dodgeable.'
    })
  }),

  aang: Object.freeze({
    key: 'aang', style: 'Mage · mobility and elemental control',
    lights: ['Air Palm', 'Staff Sweep', 'Rising Gust'],
    heavy: ['Earth Pillar', 'Air Hammer'],
    aerial: 'Whirlwind Kick',
    form: form({
      id: 'avatar-state', label: 'AVATAR STATE', aura: 'wind', color: 0xb7fff0,
      duration: 9, cost: 50, drain: 6.4, cooldown: 10,
      mods: { speed: 1.18, damage: 1.24, kbs: 1.16, defense: .9, startup: .9, jump: 1.12 },
      special: { label: 'AIR SCOOTER · AVATAR', type: 'wind', color: 0xd8fff8, damage: 18, speed: 32, cooldown: .6, stun: .5, knockback: 6.2, behavior: 'airScooter', dashSpeed: 26, range: 12, lift: 6.2 },
      ultimate: { label: 'FOUR ELEMENTS · AVATAR', damage: 1.3 },
      note: 'All four elements strengthen and defensive movement improves; the state drains fast.'
    }),
    ultimate: ult({
      label: 'FOUR ELEMENTS: BALANCE BREAKER', behaviour: 'storm', damage: 9, hits: 4, kbs: 140,
      launchY: 11.8, stun: .8, radius: 5, range: 19, color: 0xc4fff2, startup: .56, active: 1.3, recovery: .62, gap: .3,
      note: 'Air, water, earth and fire in sequence, each with its own hit and an escape window.'
    })
  }),

  madara_uchiha: Object.freeze({
    key: 'madara_uchiha', style: 'Warrior · oppressive area control',
    lights: ['Uchiha Palm', 'War Fan Strike', 'Rising Elbow'],
    heavy: ['Gunbai Counter', 'Susanoo Blade'],
    aerial: 'Susanoo Finish',
    form: form({
      id: 'perfect-susanoo', label: 'PERFECT SUSANOO', aura: 'shadow', color: 0x9b6dff,
      duration: 9, cost: 50, drain: 5.8, cooldown: 9.5,
      mods: { speed: .96, damage: 1.3, kbs: 1.24, defense: .82, startup: 1.04, jump: 1 },
      special: { label: 'SUSANOO STRIKE · PERFECT', type: 'magic', color: 0xc3a4ff, damage: 32, speed: 30, cooldown: 1.05, stun: .7, knockback: 12.6 },
      ultimate: { label: 'HEAVENLY DESTRUCTION · PERFECT', damage: 1.3 },
      note: 'Spectral armour: much more reach, damage and resistance, paid for with slower movement.'
    }),
    ultimate: ult({
      label: 'HEAVENLY DESTRUCTION', behaviour: 'storm', damage: 34, hits: 1, kbs: 165, launchY: 12.6,
      stun: 1.1, radius: 8, range: 24, color: 0xb48bff, startup: 1.05, active: 1.1, recovery: .78, gap: .5,
      note: 'A meteor drops on a wide marked zone with a long warning. Leave the mark.'
    })
  }),

  hashirama_senju: Object.freeze({
    key: 'hashirama_senju', style: 'Warrior · wood constructs',
    lights: ['Wood Palm', 'Senju Cross', 'Root Launcher'],
    heavy: ['Wooden Golem Fist', 'Colossal Palm'],
    aerial: 'Forest Finish',
    form: form({
      id: 'sage-mode-senju', label: 'SAGE MODE', aura: 'holy', color: 0x78d18a,
      duration: 10, cost: 46, drain: 4.8, cooldown: 9,
      mods: { speed: 1.1, damage: 1.22, kbs: 1.12, defense: .88, startup: .92, jump: 1.06 },
      special: { label: 'WOOD DRAGON · SAGE', type: 'wood', color: 0xa6f0b4, damage: 24, speed: 27, cooldown: .9, stun: .95, knockback: 6.4 },
      ultimate: { label: 'TRUE SEVERAL THOUSAND HANDS · SAGE', damage: 1.26 },
      note: 'Wood techniques grow stronger and movement improves while sage energy lasts.'
    }),
    ultimate: ult({
      label: 'TRUE SEVERAL THOUSAND HANDS', behaviour: 'storm', damage: 10, hits: 3, kbs: 142,
      launchY: 10.4, stun: .85, radius: 5.6, range: 18, color: 0x8fe0a2, startup: .66, active: 1.25, recovery: .66, gap: .34,
      note: 'A wooden construct strikes three marked spots and ends with a palm impact.'
    })
  }),

  lord_voldemort: Object.freeze({
    key: 'lord_voldemort', style: 'Mage · curses and ranged pressure',
    lights: ['Wand Jab', 'Dark Cross', 'Curse Launcher'],
    heavy: ['Dark Pulse', 'Forbidden Blast'],
    aerial: 'Serpent Finish',
    form: form({
      id: 'dark-lord-ascendant', label: 'DARK LORD ASCENDANT', aura: 'shadow', color: 0x55ff86,
      duration: 9, cost: 48, drain: 5.6, cooldown: 9,
      mods: { speed: 1.04, damage: 1.3, kbs: 1.14, defense: .96, startup: .9, jump: 1 },
      special: { label: 'AVADA KEDAVRA · ASCENDANT', type: 'curse', color: 0x9dffb8, damage: 30, speed: 38, cooldown: .95, stun: .8, knockback: 9.4 },
      ultimate: { label: 'THE DARK MARK: FINAL RECKONING · ASCENDANT', damage: 1.28 },
      note: 'Curses hit harder and further, but defence recovery gets worse and spells cost more.'
    }),
    ultimate: ult({
      label: 'THE DARK MARK: FINAL RECKONING', behaviour: 'zone', damage: 11, ticks: 3, kbs: 118,
      launchY: 8.8, stun: .85, radius: 6.2, range: 21, color: 0x7dffa6, startup: .72, active: 1.3, recovery: .66,
      note: 'A visible sigil marks the zone before the curse and final blast land inside it.'
    })
  }),

  sasuke_uchiha: Object.freeze({
    key: 'sasuke_uchiha', style: 'Ninja · lightning rushdown',
    lights: ['Uchiha Jab', 'Sword Cross', 'Rising Kick'],
    heavy: ['Chidori Blade', "Lion's Barrage"],
    aerial: 'Lightning Finish',
    form: form({
      id: 'eternal-mangekyo', label: 'ETERNAL MANGEKYO', aura: 'lightning', color: 0x9b7dff,
      duration: 9, cost: 48, drain: 6.2, cooldown: 9,
      mods: { speed: 1.14, damage: 1.24, kbs: 1.12, defense: .94, startup: .88, jump: 1.06 },
      special: { label: 'CHIDORI · MANGEKYO', type: 'lightning', color: 0xc0b4ff, damage: 27, speed: 40, cooldown: .78, stun: .48, knockback: 8.8, behavior: 'dashStrike', dashSpeed: 43, range: 18 },
      ultimate: { label: "INDRA'S ARROW · MANGEKYO", damage: 1.3 },
      note: 'Stronger lightning and Susanoo variants, at a fast chakra drain — no permanent invulnerability.'
    }),
    ultimate: ult({
      label: "INDRA'S ARROW", behaviour: 'beam', damage: 32, kbs: 134, launchY: 10.4,
      stun: 1, range: 33, width: 1.9, color: 0xa8b8ff, startup: .82, active: .72, recovery: .7,
      note: 'A charged lightning arrow down a lane. The charge is interruptible and the shot blockable.'
    })
  }),

  edna_mode: Object.freeze({
    key: 'edna_mode', style: 'Cyborg · gadget traps',
    lights: ["Tailor's Tap", 'Measuring-Tape Whip', 'Heel Kick'],
    heavy: ['Fabric Launcher', 'Sewing-Machine Slam'],
    aerial: 'Runway Finish',
    form: form({
      id: 'runway-command', label: 'RUNWAY COMMAND MODE', aura: 'ring', color: 0xff5ca8,
      duration: 9, cost: 42, drain: 5, cooldown: 8.5,
      mods: { speed: 1.14, damage: 1.14, kbs: 1.06, defense: 1.08, startup: .86, jump: 1 },
      special: { label: 'FASHION EMERGENCY · COMMAND', type: 'gadget', color: 0xff9ecb, damage: 15, speed: 30, cooldown: .58, stun: .44, knockback: 4.2 },
      ultimate: { label: 'NO CAPES! PROTOCOL · COMMAND', damage: 1.22 },
      note: 'Gadgets deploy faster and traps bite harder — she stays fragile in a straight fight.'
    }),
    ultimate: ult({
      label: 'NO CAPES! PROTOCOL', behaviour: 'zone', damage: 8, ticks: 4, kbs: 112, launchY: 9.6,
      stun: .68, radius: 5.8, range: 15, color: 0xff7ab8, startup: .6, active: 1.35, recovery: .6,
      note: 'A sequence of anti-mobility gadgets, then a finale burst. Every gadget is a real hit.'
    })
  }),

  captain_jack_sparrow: Object.freeze({
    key: 'captain_jack_sparrow', style: 'Ninja · unpredictable swordfighter',
    lights: ['Cutlass Jab', 'Deckhand Cross', 'Boot-to-the-Gut'],
    heavy: ['Drunken Sweep', 'Deckbreaker'],
    aerial: "Pirate's Finish",
    form: form({
      id: 'captains-last-stand', label: "CAPTAIN'S LAST STAND", aura: 'wind', color: 0xffd39a,
      duration: 9.5, cost: 42, drain: 4.6, cooldown: 8.5,
      mods: { speed: 1.1, damage: 1.1, kbs: 1.04, defense: .92, startup: .84, jump: 1 },
      special: { label: 'PIRATE PISTOL · RELOADED', type: 'bullet', color: 0xffe6b8, damage: 18, speed: 46, cooldown: .6, stun: .36, knockback: 5.6 },
      ultimate: { label: "BLACK PEARL'S LAST DANCE · LAST STAND", damage: 1.24 },
      note: 'Faster feints, wider parry windows and quicker pistol reload — not more raw damage.'
    }),
    ultimate: ult({
      label: "BLACK PEARL'S LAST DANCE", behaviour: 'rush', damage: 9, hits: 4, kbs: 126,
      launchY: 9.8, stun: .75, range: 14, color: 0xffd39a, startup: .5, active: 1.35, recovery: .64,
      note: 'Cutlass combo, pistol shot and spinning strike; the final hit has its own dodge window.'
    })
  }),

  spider_man: Object.freeze({
    key: 'spider_man', style: 'Ninja · web control and aerials',
    lights: ['Webhead Jab', 'Spinning Cross', 'Wall-Crawler Kick'],
    heavy: ['Webline Uppercut', 'Web Swing Strike'],
    aerial: 'Aerial Launcher',
    form: form({
      id: 'spider-sense-overdrive', label: 'SPIDER-SENSE OVERDRIVE', aura: 'ring', color: 0xff5d5d,
      duration: 8.5, cost: 44, drain: 5.8, cooldown: 9,
      mods: { speed: 1.16, damage: 1.1, kbs: 1.04, defense: .92, startup: .88, jump: 1.1 },
      special: { label: 'WEB ZIP STRIKE · SENSE', type: 'web', color: 0xfff0f0, damage: 17, speed: 40, cooldown: .62, stun: .8, knockback: 6.4, behavior: 'dashStrike', dashSpeed: 47, range: 18 },
      ultimate: { label: 'MAXIMUM WEB TAKEDOWN · SENSE', damage: 1.24 },
      note: 'Tighter dodge windows, faster web recharge and better aerials — never constant invulnerability.'
    }),
    ultimate: ult({
      // The grab chain's follow-up gate is 5.2 m. At the shared 132 knockback the second hit threw
      // Goku beyond that gate and the third hit whiffed, so a three-hit ultimate only ever landed
      // twice. Web restraint keeps the first two beats close; the final slam still launches.
      label: 'MAXIMUM WEB TAKEDOWN', behaviour: 'grab', damage: 18, hits: 3, kbs: 76,
      launchY: 8.6, stun: .95, range: 14, pullSpeed: 2.8, color: 0xf5fbff, startup: .46, active: 1.1, recovery: .6,
      note: 'Webs restrain, then an aerial combo and slam. The final hit is the launch.'
    })
  }),

  iron_spider: Object.freeze({
    key: 'iron_spider', style: 'Cyborg · mechanical reach',
    lights: ['Stinger Jab', 'Cross-Stinger Flurry', 'Spider Vault'],
    heavy: ['Leg-Piercer Slam', 'Mechanical Sweep'],
    aerial: 'Aerial Octet',
    form: form({
      id: 'spider-assault-protocol', label: 'SPIDER ASSAULT PROTOCOL', aura: 'construct', color: 0xffc23d,
      // The four jointed appendages heat up; their own materials are tagged as form surfaces.
      look: { appendage: { color: 0xffe89a, emissive: 0xffd76a, emissiveIntensity: 2.6 }, accent: { emissive: 0xffc23d, emissiveIntensity: 1.9 } },
      duration: 9, cost: 46, drain: 6.4, cooldown: 9,
      mods: { speed: 1.1, damage: 1.22, kbs: 1.14, defense: .9, startup: .86, jump: 1.04 },
      special: { label: 'SPIDER-LEG ASSAULT · PROTOCOL', type: 'legs', color: 0xffd76a, damage: 23, speed: 30, cooldown: .74, stun: .62, knockback: 8.2, behavior: 'shockwave', radius: 6.6, legs: 4 },
      ultimate: { label: 'EIGHT-POINT LOCKDOWN · PROTOCOL', damage: 1.28 },
      note: 'Aggressive leg configuration: more damage and reach, heavier energy drain and recovery.'
    }),
    ultimate: ult({
      label: 'EIGHT-POINT LOCKDOWN', behaviour: 'grab', damage: 19, hits: 3, kbs: 138,
      launchY: 10.2, stun: 1, range: 15, color: 0xffc23d, startup: .5, active: 1.15, recovery: .66,
      note: 'All four legs pin, web the escape, then a diving strike. The pin has an escape window.'
    })
  }),

  // ---------------------------------------------------------------- expansion group: Wolverine, Geralt, Doom Slayer
  wolverine_logan: Object.freeze({
    key: 'wolverine_logan', style: 'Brawler · feral claw pressure',
    lights: ['Adamantium Jab', 'Cross Slash', 'Rising Claw'],
    heavy: ['Berserker Barrage', 'Lunging Claw'],
    aerial: 'Feral Drop',
    form: form({
      id: 'berserker-rage', label: 'BERSERKER RAGE', aura: 'flame', color: 0xff6b3d,
      duration: 8, cost: 42, drain: 6.2, cooldown: 8,
      mods: { speed: 1.16, damage: 1.24, kbs: 1.14, defense: .9, startup: .84, jump: 1.06 },
      special: { label: 'CLAW FLURRY · RAGE', type: 'spinning', color: 0xffd28a, damage: 27, speed: 30, cooldown: .70, stun: .55, knockback: 8.2 },
      ultimate: { label: 'FERAL LUNGE · RAGE', damage: 1.3 },
      note: 'Feral pressure: faster starts, heavier claw strings and a longer lunge, paid for with lower defence.'
    }),
    ultimate: ult({
      label: 'FERAL LUNGE', behaviour: 'rush', damage: 11, hits: 4, kbs: 120, launchY: 9.2,
      stun: .7, range: 18, color: 0xff7a4a, startup: .52, active: .9, recovery: .6,
      note: 'Four claw passes down a lane; each pass is a real hit and the last launches.'
    })
  }),

  geralt_of_rivia: Object.freeze({
    key: 'geralt_of_rivia', style: 'Swordsman · sign control',
    lights: ['Silver Slash', 'Steel Cross', 'Rising Cut'],
    heavy: ['Whirl', 'Igni Burst'],
    aerial: 'Aard Drop',
    form: form({
      id: 'elder-blood', label: 'ELDER BLOOD', aura: 'holy', color: 0x9ad7ff,
      duration: 9, cost: 46, drain: 5.4, cooldown: 8.5,
      mods: { speed: 1.08, damage: 1.16, kbs: 1.08, defense: .92, startup: .9, jump: 1.04 },
      special: { label: 'IGNI · ELDER BLOOD', type: 'fireball', color: 0xffb28a, damage: 26, speed: 32, cooldown: .78, stun: .5, knockback: 7.4 },
      ultimate: { label: 'AARD SHOCKWAVE · ELDER BLOOD', damage: 1.26 },
      note: 'Elder Blood sharpens the signs and steel; the form still trades defence for offence.'
    }),
    ultimate: ult({
      label: 'AARD SHOCKWAVE', behaviour: 'storm', damage: 10, hits: 3, kbs: 116,
      launchY: 9.6, stun: .72, radius: 7.2, range: 18, color: 0x9ad7ff,
      startup: .58, active: 1.0, recovery: .62,
      note: 'Three widening Aard pulses centred on the marked ground; each pulse can be avoided.'
    })
  }),

  doom_slayer: Object.freeze({
    key: 'doom_slayer', style: 'Brawler · heavy weapons',
    lights: ['Rip and Tear', 'Shotgun Bash', 'Glory Knee'],
    heavy: ['Super Shotgun', 'Chainsaw'],
    aerial: 'Meat Hook Drop',
    form: form({
      id: 'doom-overdrive', label: 'DOOM OVERDRIVE', aura: 'steam', color: 0xc8ff6a,
      duration: 8.5, cost: 48, drain: 6.8, cooldown: 9,
      mods: { speed: 1.02, damage: 1.28, kbs: 1.22, defense: .82, startup: 1.04, jump: 1.02 },
      special: { label: 'PLASMA BLAST · OVERDRIVE', type: 'orb', color: 0xd8ff8a, damage: 30, speed: 30, cooldown: 1.0, stun: .62, knockback: 9.4 },
      ultimate: { label: 'BFG DIVISION · OVERDRIVE', damage: 1.3 },
      note: 'Heavy weapons hit harder and knock farther; start-ups slow down and defence drops.'
    }),
    ultimate: ult({
      label: 'BFG DIVISION', behaviour: 'beam', damage: 31, kbs: 126, launchY: 10.2,
      stun: .95, range: 30, width: 2.6, color: 0xd8ff6a, startup: .68, active: .85, recovery: .68,
      note: 'A charged BFG lane. The charge is interruptible before the beam fires.'
    })
  })
});

/** Slug for a display name, identical to the identity key main.js builds. */
export function slugOf(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** The moveset for a fighter (by slug, fighter or display name), or null. */
export function movesetFor(fighterOrKey) {
  if (!fighterOrKey) return null;
  // Imported characters live in their own generated registry, so adding one never edits this file.
  const imported = value => IMPORTED_MOVESETS[value] || null;
  if (typeof fighterOrKey === 'string') return MOVESETS[fighterOrKey] || MOVESETS[slugOf(fighterOrKey)] || imported(fighterOrKey) || imported(slugOf(fighterOrKey)) || null;
  return MOVESETS[fighterOrKey.identityKey] || MOVESET_BY_NAME[fighterOrKey.identity] || imported(fighterOrKey.identityKey) || null;
}

// Display-name lookup, built once, so a fighter that has not had its slug assigned yet still
// resolves (the character select swap path sets identity and identityKey together).
const MOVESET_BY_NAME = {};
for (const key of Object.keys(MOVESETS)) MOVESET_BY_NAME[key.replace(/_/g, ' ')] = MOVESETS[key];
for (const [name, entry] of Object.entries({
  'superman': 'superman', 'iron man (tony stark)': 'iron_man_tony_stark',
  'hulk (bruce banner)': 'hulk_bruce_banner', 'green lantern (hal jordan)': 'green_lantern_hal_jordan',
  'wonder woman': 'wonder_woman', 'professor x (charles xavier)': 'professor_x_charles_xavier',
  'the flash (barry allen)': 'the_flash_barry_allen', 'aquaman': 'aquaman',
  'doctor strange': 'doctor_strange', 'arnold schwarzenegger': 'arnold_schwarzenegger',
  'goku': 'goku', 'naruto uzumaki': 'naruto_uzumaki', 'vegeta': 'vegeta', 'saitama': 'saitama',
  'l (death note style)': 'l_death_note_style', 'all might': 'all_might',
  'edward elric': 'edward_elric', 'levi ackerman': 'levi_ackerman', 'mario': 'mario',
  'luigi': 'luigi', 'kratos': 'kratos', 'link': 'link', 'master chief': 'master_chief',
  'thor': 'thor', 'aang': 'aang', 'madara uchiha': 'madara_uchiha',
  'hashirama senju': 'hashirama_senju', 'lord voldemort': 'lord_voldemort',
  'sasuke uchiha': 'sasuke_uchiha', 'edna mode': 'edna_mode',
  'captain jack sparrow': 'captain_jack_sparrow', 'spider-man': 'spider_man',
  'iron spider': 'iron_spider',
  'wolverine (logan)': 'wolverine_logan',
  'geralt of rivia': 'geralt_of_rivia',
  'doom slayer': 'doom_slayer'
})) {
  MOVESET_BY_NAME[name] = MOVESETS[entry];
}

/** The ultimate a fighter casts right now: transformed variants change label, damage and colour. */
export function ultimateFor(fighter) {
  const set = movesetFor(fighter);
  if (!set?.ultimate) return null;
  const base = set.ultimate;
  const activeForm = fighter?.transform?.form || null;
  const variant = activeForm?.ultimate || (fighter?.transform ? set.form?.ultimate : null);
  if (!variant) return base;
  return {
    ...base,
    // A form may change how the ultimate behaves as well as its name and damage: Six Paths fires a
    // beam, Kurama slams, Baryon rushes. Missing fields fall back to the base ultimate.
    behaviour: variant.behaviour || base.behaviour,
    ...(variant.color != null ? { color: variant.color } : {}),
    label: variant.label || base.label,
    damage: base.damage * (variant.damage || 1),
    color: variant.color ?? activeForm?.color ?? base.color
  };
}

import { IMPORTED_MOVESETS } from './imported_movesets.js';
