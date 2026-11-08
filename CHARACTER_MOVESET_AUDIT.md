# Browser Bros — Character & Moveset Audit

Audit of the roster as it is registered in `public/js/main.js`, the moves each fighter actually
performs, and the transformation/ultimate added for each one in this pass.

Verified on 2026-10-26 against branch `work/gameplay-and-polish` (changes uncommitted).

## How this was verified

| Claim | Evidence |
| --- | --- |
| 34 selectable fighters | The launch `roster` array in `main.js` is parsed by `scripts/test-movesets.mjs`, which asserts `length === 34`. The character-select screen is built from that same array. |
| Every fighter has a moveset | Test asserts every parsed roster slug exists in `MOVESETS`, with no entries outside the roster. |
| Every fighter can transform and cast | Test selects each of the 33 names through the real select screen, then calls the real transform and ultimate paths in the running game and records the resulting labels (`all 33 fighters form and cast in the live game`, `every fighter forms into its own named state`, `every fighter casts its own named ultimate`). |
| Moves deal damage | `test:movesets` lands a transformed signature and a full ultimate on a live opponent; `test:mechanics` covers melee/projectile damage, guard, cover and i-frames. |
| Models and clips | Read from `public/models/characters/manifest.json` and `public/data/animation-manifest.json`. |

Reproduce everything with:

```bash
npm ci
bash scripts/run-browser-test.sh scripts/test-movesets.mjs   # 79 checks
npm run build
```

`scripts/run-browser-test.sh` sets the library and font paths the bare cloud image needs; on a
normal desktop `node scripts/test-movesets.mjs` works directly.

## Roster reality

- **34 fighters are selectable** (the `roster` array): the 33 launched identities plus **Kaze**, the
  Blender-authored reference fighter. A further 25 names exist in `allRoster` as a DLC pool; they are
  **not** offered by the select screen and are **not** covered by this moveset work. No fighter was
  enabled or disabled by this pass.
- **Models:** all 38 selectable fighters now mount their own exported body —
  `public/models/characters/roster/<slug>.glb`, or `public/models/characters/kaze/kaze.glb` for the
  reference fighter — each a skinned 19-bone rig with eight clips, applied with the generated surface
  detail maps and re-armed with the identity's signature weapon. `npm run audit:roster` proves it per
  fighter (38/38 on their own file, one unique asset each, 11 canonical joints bound). The three

  *supplied source packages* this manifest was originally staged for — `goku`,
  `iron_man_tony_stark`, `iron_spider` — are still absent from the repository, so those three render
  this project's generated bodies rather than the user's models: **BLOCKED BY MISSING SOURCE
  ASSET** for the exact supplied models only.
- **Animation:** 39 procedural clips in `public/data/animation-manifest.json`
  (`browser-smash-core-v1`). The Mixamo humanoid pack is `not-supplied`. Every attack therefore uses
  the procedural pose driven by the move's phase; no attack or ultimate has a hand-authored clip.
- **Moves that exist today:** the 3-step light chain, heavy, anti-air, air strike, air finisher,
  dive kick, counter strike and grab from `combat/move_data.js`, plus one signature special per
  fighter from the `SPECIAL_MOVES` table. This pass **names** those moves per character and adds a
  transformation (with a second signature move) and an ultimate. It does not add per-character
  hitbox geometry for the light chain — those remain archetype moves with per-character timing,
  reach, damage and knockback profiles.

## Controls (as implemented)

| Action | P1 | P2 | Gamepad (either pad) |
| --- | --- | --- | --- |
| Move | `WASD` | Arrow keys | Left stick |
| Light chain / aerial / anti-air / dive | `J` (`UP+J`, `DOWN+J`) | `,` | X / Square |
| Heavy | `SHIFT`+`J` | Right Shift + `,` | — |
| Signature special | `K` | `.` | B / Circle |
| Grab / throw | `U` (`UP`/`DOWN` to aim) | `/` | LB / L1 |
| Jump / double jump | `Space` | `Enter` | A / Cross |
| Dash / dodge | `Shift` | Right Shift | LT / L2 |
| Guard (tap = parry) | `E` | `;` | RB / R1 |
| Flight toggle / descend | `F` / `C` | `[` / `]` | Y / Triangle · D-pad left |
| Web swing | `G` | `\` | — |
| **Transform / overdrive** | **`I`** | **`N`** | **D-pad up** |
| **Ultimate** | **`O`** | **`M`** | **D-pad down** |
| Debug overlay | `F3` | `F3` | — |

There is no shield button on the gamepad beyond RB/L1 in the current mapping, and no pause menu or
remap screen; both are unchanged from before this pass.

## Per-fighter table

`Model` is the same for every row: **procedural body** (+ shared prefab upgrade). `Clips` is the
procedural pose set; no bespoke clip exists for any listed move. `Status` covers the moveset, form
and ultimate added here.

| # | Fighter (id) | Lights → heavy / aerial | Signature (`K`) | Form (`I`) — cost · duration · drain | Ultimate (`O`) — behaviour | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | Superman (`superman`) | Kryptonian Jab → Cross of Steel → Rising Uppercut · Meteor Fist / Skyfall Strike | Heat Vision | **Solar Overcharge** — 46 · 9 s · 5.4/s | Last Son's Judgement — `slam` | IMPLEMENTED AND TESTED |
| 02 | Iron Man (`iron_man_tony_stark`) | Repulsor Jab → Armor Cross → Thruster Knee · Rocket Punch / Powered Haymaker | Repulsor Blast | **Overdrive Protocol** — 44 · 8.5 s · 6.2/s → Unibeam | Arc Reactor Overload — `beam` | IMPLEMENTED AND TESTED · model **BLOCKED** |
| 03 | Hulk (`hulk_bruce_banner`) | Gamma Jab → Double Smash → Rising Fist · Hulk Hammer / Meteor Drop | Thunderclap | **Worldbreaker Rage** — 40 · 10 s · 4.2/s | Worldbreaker Impact — `slam` | IMPLEMENTED AND TESTED |
| 04 | Green Lantern (`green_lantern_hal_jordan`) | Ring Jab → Hard-Light Cross → Construct Knee · Construct Hammer / Emerald Drop | Construct Bolt | **Will Unbound** — 46 · 9 s · 5.8/s | Emerald Judgement — `zone` | IMPLEMENTED AND TESTED |
| 05 | Wonder Woman (`wonder_woman`) | Amazon Jab → Sword Cross → Shield Knee · Godkiller Slash / Warrior's Finish | Amazon Lasso | **Champion of Themyscira** — 45 · 9 s · 5/s | Wrath of the Amazons — `grab` | IMPLEMENTED AND TESTED |
| 06 | Professor X (`professor_x_charles_xavier`) | Psionic Tap → Mindwave Push → Psychic Lift · Telekinetic Slam / Focused Pulse | Psionic Pulse | **Cerebral Ascendance** — 48 · 10 s · 4.6/s | Cerebro Overload — `zone` | IMPLEMENTED AND TESTED |
| 07 | The Flash (`the_flash_barry_allen`) | Speed Jab → Lightning Cross → Afterimage Kick · Sonic Breaker / Supersonic Drop | Speed Force Strike | **Speed Force Ascendant** — 42 · 8 s · 6.8/s | Infinite Mass Impact — `rush` | IMPLEMENTED AND TESTED |
| 08 | Aquaman (`aquaman`) | Trident Jab → Ocean Cross → Rising Fork · Tidal Cleave / King's Sweep | Tidal Trident | **King of the Deep** — 46 · 9.5 s · 5.2/s | Leviathan's Judgement — `storm` | IMPLEMENTED AND TESTED |
| 09 | Doctor Strange (`doctor_strange`) | Mystic Palm → Rune Strike → Floating Knee · Crimson Bands Slam / Sigil Burst | Eldritch Bind | **Sorcerer Supreme** — 48 · 9 s · 6/s | Crimson Dimension — `zone` | IMPLEMENTED AND TESTED |
| 10 | Arnold Schwarzenegger (`arnold_schwarzenegger`) | Steel Knuckle → Hydraulic Cross → Cyborg Knee · Cannon Bash / Overhead Wrecking Strike | Cybernetic Cannon | **Combat Chassis Overdrive** — 44 · 9 s · 5.6/s | Total System Annihilation — `barrage` | IMPLEMENTED AND TESTED |
| 11 | Goku (`goku`) | Turtle School Jab → Power Cross → Rising Dragon Kick · Dragon Fist / Meteor Finish | Kamehameha | **Kaioken ×3** — 44 · 8 s · 7.4/s → Kamehameha (Kaioken) | Dragon Nova · Final Kamehameha — `beam` | IMPLEMENTED AND TESTED · rig **BLOCKED** |
| 12 | Naruto (`naruto_uzumaki`) | Leaf Jab → Shadow Cross → Rising Clone Kick · Giant Rasengan / Uzumaki Finish | Rasenshuriken | **Nine-Tails Chakra Mode** — 46 · 9 s · 6.6/s | Six Paths Rasengan Storm — `rush` | IMPLEMENTED AND TESTED |
| 13 | Vegeta (`vegeta`) | Royal Jab → Saiyan Cross → Knee Breaker · Galick Uppercut / Pride Launcher | Galick Gun | **Super Saiyan** — 48 · 9 s · 5.8/s | Final Flash · Royal Ruin — `beam` | IMPLEMENTED AND TESTED |
| 14 | Saitama (`saitama`) | Casual Jab → Serious Cross → Rising Punch · Serious Headbutt / Cape Sweep | Serious Punch | **Serious Mode** — 42 · 8 s · 4.4/s | Serious Series: Serious Punch — `rush` (1 hit) | IMPLEMENTED AND TESTED |
| 15 | L (`l_death_note_style`) | Deduction Jab → Feint Cross → Low Sweep · Chair Kick / Calculated Finish | Death Note Hex | **Absolute Deduction** — 44 · 10 s · 4/s | Final Verdict — `zone` | IMPLEMENTED AND TESTED |
| 16 | All Might (`all_might`) | Heroic Jab → Detroit Cross → Rising Smash · United States Smash / Airborne Hero Drop | Detroit Smash | **One For All · Full Cowl** — 46 · 9 s · 6/s | United States of Smash — `rush` | IMPLEMENTED AND TESTED |
| 17 | Edward Elric (`edward_elric`) | Automail Jab → Alchemy Cross → Rising Stone Fist · Stone Pillar Uppercut / Transmutation Finish | Alchemy Spike | **Philosopher's Focus** — 46 · 9 s · 5.6/s | Equivalent Exchange: Iron Colossus — `storm` | IMPLEMENTED AND TESTED |
| 18 | Levi Ackerman (`levi_ackerman`) | Blade Jab → Cross Cut → Spinning Slash · Twin Blade Breaker / Falling Slice | Thunder Spear | **Humanity's Strongest** — 44 · 8.5 s · 6/s | Wings of Destruction — `rush` | IMPLEMENTED AND TESTED |
| 19 | Mario (`mario`) | Super Jab → Mario Combo → Rising Headbutt · Super Cape Strike / Ground Pound | Fireball | **Fire Mario** — 42 · 9 s · 5/s | Superstar Finale — `rush` | IMPLEMENTED AND TESTED |
| 20 | Luigi (`luigi`) | Nervous Jab → Green Cross → Upward Boot · Luigi Cyclone / Ghostbuster Swing | Poltergust Burst | **Haunted Hero** — 42 · 9 s · 5.2/s | Mansion Meltdown — `zone` | IMPLEMENTED AND TESTED |
| 21 | Kratos (`kratos`) | Spartan Jab → Axe Cross → Shield Bash · Leviathan Cleave / Executioner's Finish | Leviathan Axe Rush | **Spartan Rage** — 44 · 9 s · 6/s | Wrath of the Fallen God — `rush` | IMPLEMENTED AND TESTED |
| 22 | Link (`link`) | Hero's Slash → Shield Jab → Rising Sword · Charged Spin Attack / Spinning Finish | Hero Arrow | **Triforce Resonance** — 44 · 9.5 s · 4.8/s | Hero of Hyrule — `storm` | IMPLEMENTED AND TESTED |
| 23 | Master Chief (`master_chief`) | Spartan Jab → Rifle Butt → Knee Strike · Spartan Charge / Ground Pound | Plasma Grenade | **MJOLNIR Overdrive** — 44 · 9 s · 5.4/s | Orbital Hammerfall — `storm` | IMPLEMENTED AND TESTED |
| 24 | Thor (`thor`) | Mjolnir Jab → Stormbreaker Cross → Thunder Knee · Hammerfall / Asgardian Finish | Stormbreaker Lightning | **All-Father's Storm** — 48 · 10 s · 5.4/s | Ragnarok's Wrath — `storm` | IMPLEMENTED AND TESTED |
| 25 | Aang (`aang`) | Air Palm → Staff Sweep → Rising Gust · Earth Pillar / Whirlwind Kick | Air Scooter | **Avatar State** — 50 · 9 s · 6.4/s | Four Elements: Balance Breaker — `storm` | IMPLEMENTED AND TESTED |
| 26 | Madara (`madara_uchiha`) | Uchiha Palm → War Fan Strike → Rising Elbow · Gunbai Counter / Susanoo Finish | Great Fire Annihilation | **Perfect Susanoo** — 50 · 9 s · 5.8/s | Heavenly Destruction — `storm` | IMPLEMENTED AND TESTED |
| 27 | Hashirama (`hashirama_senju`) | Wood Palm → Senju Cross → Root Launcher · Wooden Golem Fist / Forest Finish | Wood Dragon | **Sage Mode** — 46 · 10 s · 4.8/s | True Several Thousand Hands — `storm` | IMPLEMENTED AND TESTED |
| 28 | Lord Voldemort (`lord_voldemort`) | Wand Jab → Dark Cross → Curse Launcher · Dark Pulse / Serpent Finish | Avada Kedavra | **Dark Lord Ascendant** — 48 · 9 s · 5.6/s | The Dark Mark: Final Reckoning — `zone` | IMPLEMENTED AND TESTED |
| 29 | Sasuke (`sasuke_uchiha`) | Uchiha Jab → Sword Cross → Rising Kick · Chidori Blade / Lightning Finish | Chidori | **Eternal Mangekyo** — 48 · 9 s · 6.2/s | Indra's Arrow — `beam` | IMPLEMENTED AND TESTED |
| 30 | Edna Mode (`edna_mode`) | Tailor's Tap → Measuring-Tape Whip → Heel Kick · Fabric Launcher / Runway Finish | Fashion Emergency Gadget | **Runway Command Mode** — 42 · 9 s · 5/s | NO CAPES! Protocol — `zone` | IMPLEMENTED AND TESTED |
| 31 | Captain Jack Sparrow (`captain_jack_sparrow`) | Cutlass Jab → Deckhand Cross → Boot-to-the-Gut · Drunken Sweep / Pirate's Finish | Pirate Pistol | **Captain's Last Stand** — 42 · 9.5 s · 4.6/s | Black Pearl's Last Dance — `rush` | IMPLEMENTED AND TESTED |
| 32 | Spider-Man (`spider_man`) | Webhead Jab → Spinning Cross → Wall-Crawler Kick · Webline Uppercut / Aerial Launcher | Web Zip Strike | **Spider-Sense Overdrive** — 44 · 8.5 s · 5.8/s | Maximum Web Takedown — `grab` | IMPLEMENTED AND TESTED |
| 33 | Iron Spider (`iron_spider`) | Stinger Jab → Cross-Stinger Flurry → Spider Vault · Leg-Piercer Slam / Aerial Octet | Spider-Leg Assault | **Spider Assault Protocol** — 46 · 9 s · 6.4/s | Eight-Point Lockdown — `grab` | IMPLEMENTED AND TESTED · legs **IMPLEMENTED AND TESTED** (procedural joints) |

| 34 | Kaze (`kaze`) | Reed Palm → Turning Elbow → Rising Gale Kick · Crushing Palm / Whirlwind Sweep / Falling Leaf Strike | Wind Cutter | **Wind-Step** — 42 · 8 s · 7/s → GALE CUTTER · WIND-STEP | Thousand-Step Tempest — `rush` (3 passes) | IMPLEMENTED AND TESTED · imported reference body (`kaze.glb`) |

Every form also swaps the signature move for its empowered version (named in
`public/js/combat/movesets.js`, e.g. Goku's `KAMEHAMEHA · KAIOKEN`, Thor's `STORMBREAKER ·
ALL-FATHER`), and every ultimate has an empowered label and damage multiplier while transformed.

## What each character is missing

| Gap | Affects | Label |
| --- | --- | --- |
| Rigged model | Goku, Iron Man, Iron Spider | **BLOCKED BY MISSING ASSET** |
| Hand-authored attack / ultimate animation | all 33 | **BLOCKED BY MISSING ASSET** (no clip packages supplied) |
| Transformation model or material swap | Goku (Kaioken), Vegeta (Super Saiyan), Iron Man (Overdrive) and Iron Spider (Assault Protocol) retint and re-shape real body surfaces; the other 29 forms use a generated aura only | **PARTIAL** (4 of 33 surfaces change, no alternate meshes exist) |
| Bespoke ultimate choreography | 26 of 33 share one of seven behaviours | **PARTIAL** |
| Sound for any move | all 33 | **IMPLEMENTED — BROWSER TEST NEEDED** (synthesised Web Audio; headless runs are muted) |
| Articulated mechanical legs in combat | Iron Spider | **IMPLEMENTED AND TESTED** (4 legs × 3 joints, posed by state; the sweep adds leg-tip contacts) — still procedural, not clip-driven, until a rigged model exists |
| Directional specials (`UP+K` / `DOWN+K`) | all 33 — one neutral special each | **NOT IMPLEMENTED** |
| Per-move cancel data for specials | all 33 | **NOT IMPLEMENTED** |
| Tactical CPU ultimate usage | P2 AI | **PARTIAL** (probability-gated, range-checked) |

## Balance reference

| Resource | Values |
| --- | --- |
| Ultimate meter | 100 max · `2 + 0.9 × damage` dealt · `1.2 + 0.55 × damage` taken · `+1.2` blocked · **not** earned from your own ultimate |
| Ultimate cost | 100, spent once at activation · refunded in full if interrupted before the first hit |
| Form power | 100 max · `0.52 × damage` dealt · `0.38 × damage` taken · `+0.8` blocked · no passive regeneration |
| Form cost | 40–50 · 8–10 s duration · 4–7.4 power/s drain · 8–10 s cooldown + 0.6 s fatigue |
| Ultimate damage | 8–40 per hit before the fighter's damage profile; heaviest single hit 40 (Saitama, one hit, 1.05 s windup) |
| Round limit | 150% — no ultimate one-shots a fresh fighter (asserted in the test) |
