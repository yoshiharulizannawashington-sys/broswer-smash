# Hogwarts interior: the castle range behind the Great Hall

This document describes what is actually built and walkable in the Hogwarts world, how it is
generated, and what is still missing. Every claim below is backed by a test named at the end;
the per-room measurements live in [`artifacts/hogwarts-quality.json`](../artifacts/hogwarts-quality.json)
and the screenshots in [`artifacts/hogwarts/`](../artifacts/hogwarts).

## What was there before

`public/js/worlds/world_catalog.js` built Hogwarts as one merged world: a raised plateau, the
Black Lake, curtain walls, the Great Hall nave, a courtyard with cloisters, a viaduct, Hagrid's
hut, Hogsmeade, the Quidditch pitch, the boathouse, forest edge, and one dungeon room. Nine
battle stages were registered inside it. Three things were wrong for an explorable castle:

1. **The east range inside the curtain wall was empty.** Forty metres wide and seventy-eight
   deep, it held nothing but a wall-walk and five towers.
2. **The five flanking towers were generated *inside* the ranges.** On the east side they stood
   in the middle of the empty range; on the west one stood in the middle of the dungeon room.
3. **The dungeons were sealed.** Their only stair climbed ten steps into a wall and stopped, so
   "The Dungeons" stage could only be reached through a travel ring — a fake door.

## What is built now

`public/js/worlds/hogwarts_interior.js` builds a three-storey range at **x 22–64, z −148 – −70**,
against the Great Hall's east wall. It emits the same part descriptors as the rest of the
catalog, so:

* `world_builder.js` merges it into the existing per-material draw calls (a whole world is still
  ~12–18 draw calls; the range adds **2,301 of the world's 4,133 parts** but no extra draw calls);
* `blocksFromParts()` turns every `solid` part into a collision volume for the fighter
  controller — **517 volumes** in the Hogwarts world, 15 of them floors and landings.

Floor heights: **ground 0.6 m, first 5.0 m, second 9.4 m, roof 13.8 m** (4.4 m storeys). Floor
slabs are 0.45 m thick with `bottom` set, so they are standable from above and walkable
underneath. Treads rise **0.4 m**, under `arena_layouts.js`'s `STEP_HEIGHT` of 0.42, so the
existing controller climbs them without a second movement system.

### Rooms (15 areas, 14 registered stages)

| Floor | Rooms |
| --- | --- |
| Ground (0.6 m) | Entrance Hall, Kitchens, Defence Against the Dark Arts, Library, Charms, Hospital Wing, Grand Staircase (route, not a stage) |
| First (5.0 m) | Gryffindor Common Room, Ravenclaw Common Room, Slytherin Common Room, History of Magic, library gallery |
| Second (9.4 m) | Headmaster's Office, Room of Requirement, Restricted Archive, Astronomy Tower |

Every room has its own furniture: house tables and benches, kitchen trestles with hanging pans,
duelling circle, hospital beds with screens, bookcase aisles with ladders and a barred
Restricted Section gate, house fireplaces and armchairs, the headmaster's shelf drum with
portraits and silver instruments, the Room of Requirement's training dummies and wall of
discarded things, and the Astronomy Tower's plinths, telescopes and star-painted ceiling.

### Circulation

* **Marble Corridor** runs the full 78 m at every floor (x 40–46), with a 4 m doorway into every
  room. Openings are real: a wall run is split around each door with a lintel above head height,
  so the collision volume has a hole in it.
* **Grand Staircase** is two straight flights that climb *away* from their landings rather than
  over them (a flight above a walkable floor reads as a wall to the collider, correctly). Flight A
  climbs from the ground floor at z −108 to the first-floor landing at z −121…−115.2; flight B
  climbs from there to the second-floor landing at z −108.6…−103.5.
* **Great Hall → Entrance Hall** — the nave's east wall is now built as two segments with a
  6 m × 3.4 m doorway at z −94, and the range's west wall has the matching opening.
* **Courtyard → Dungeons** — a lit stone passage at x −34 runs from the dungeon's south wall,
  through a new gate in the west curtain wall, under a gate cut in the cloister, and out onto
  the courtyard at z −61.

## Defects found and fixed during this pass

| Defect | Fix |
| --- | --- |
| Towers generated inside the ranges (one stood in the dungeon room) | Flanking towers moved to x ±72/78, outside the curtain wall; the south-range tower on the dungeon passage removed |
| Dungeons sealed; stair ended in a wall | Ten-step dead-end stair replaced with a corridor, curtain-wall gate and cloister gate |
| **Fighters could not descend a floor**: `fighter3D.js` clamped `position.y` to `this.groundLevel`, a value cached from the previous frame, so walking off a ledge or landing below snapped the fighter back up | The floor is now computed from the layout at the current position (`groundHeightAt`), falling back to the cached value. This also fixes the Death Star catwalks |
| Astronomy ceiling was a 16 m translucent sphere hanging through the walls and below the floor | Replaced with a star-painted ceiling panel inside the room |
| Chandeliers were near room-sized and read as gold plates with white balloons | Ring radius halved, candles shrunk, six arms |
| Suits of armour were bare cylinders | Tabard and plume added |

## How it is verified

**Node (`npm run test:worlds`, 53,972 assertions).** Every stage's spawns, floor, centre and
doorway ring are checked with the same `groundHeightAt` / `resolveCollision` the controller runs.
Five named routes are walked point-to-point at 0.3 m intervals: Great Hall doorway → Entrance
Hall; Entrance Hall → corridor → Library; Entrance Hall → stairs → first floor; first floor →
stairs → second floor → corridor; corridor → Gryffindor. Each asserts no rise over one tread, no
drop through a hole, no obstruction, and that the route ends on the floor it claims. The
dungeon passage is walked the same way.

**Browser (`npm run test:hogwarts`, 153 assertions).** The same eight routes walked in the running
game, one simulation step at a time, so `resolveArenaCollision` and the fighter's own floor clamp
decide; plus a four-probe multi-floor settle test, a library match that must spawn on the library
floor inside the library fence, and no page errors. Nineteen screenshots are captured through the
real explore camera.

**Regression (`npm run test:gameplay`, `test:smoke`, `test:stage-feel`, `test:explore`).**
88 gameplay checks (a full match through the real camera), boot on both HTML entry points,
138 stage-feel checks across four stages and 49 free-roam assertions all pass with the interior
loaded and the corrected floor clamp in place.

**Report (`node scripts/report-hogwarts.mjs`).** Measures each room: standable floor at its
declared height, walkable floor as a 1 m grid percentage, openings in its boundary walls, and
which route covers it. Current totals: 15 areas, 13 with stages, 15 connected, 15 floor-verified,
**87 % average walkable floor**.

## What is not done

Honest gaps against the full directive:

* **Moving staircases** — deliberately not animated. A stair that moves under a standing fighter
  needs either a kinematic platform or a gated transition; the collider has neither, so the
  flights are fixed. Their geometry and collision are real and tested.
* **Chamber of Secrets** — not built. It is the next large set piece.
* **Potions, Transfiguration, Herbology, Care of Magical Creatures, Ancient Runes, Arithmancy** —
  not separate rooms. The range has DADA, Charms, History of Magic, an Astronomy tower and a
  Restricted Archive. The existing greenhouses are exterior shells without interiors.
* **Hufflepuff common room** — missing; the other three exist.
* **Interaction system** — no door open/close, book reading, switches, lore pickups or
  contextual prompt. Doors are openings, not mechanisms. The game's input map has no interaction
  key, so this needs a deliberate design decision rather than a rebind.
* **Room of Requirement** — exists as a room with a training-dummy interior; the "magical call"
  discovery mechanic is not implemented.
* **Materials and lighting** — palette colours and shared PBR surface maps from
  `worlds/world_textures.js`; no authored castle textures, no baked lighting, no AO pass. Rooms
  are lit by the arena sun plus emissive flame/glass materials.
* **Audio** — no room ambience (the game has combat audio only).
* **Performance** — the geometry is merged, but frame timings here were measured under software
  WebGL (SwiftShader), which is not a Chromebook benchmark. No hardware figure is claimed.

## Next highest-impact work

1. **Chamber of Secrets** as a gated descent from the dungeons with its own navigation route and
   stages, since the passage and the dungeon level now exist to hang it off.
2. **Hufflepuff common room and the missing classrooms**, filling the remaining named spaces with
   the same measured approach.
3. **An interaction layer** (key, prompt, door state, book pickups) so the "restricted",
   "Room of Requirement" and "hidden passage" content becomes discoverable rather than merely
   present.


## Continuity: one place, not a castle and a bridge

The castle was walkable inside, but the route out of it was not. This pass closed the gaps
between the pieces rather than adding more rooms.

### What was actually broken

| Defect | Evidence | Fix |
| --- | --- | --- |
| The Entrance Hall had no opening into the stair well. The documented "north opening" was data only. | The journey walk stalled at `(30.0, -101.5)`, 3.5 m short of the stair foot. The cross wall between `BAND.entrance.z0` and the stair hall was drawn with no doors. | `wallRun` now cuts a 9 m opening at x = 31 in that wall. |
| The viaduct could only be reached by jumping. | The deck top is 1.25 m; the courtyard is 0.3 m; nothing stood between them. | Three 0.32 m treads at the castle end (`z` -29.4 to -27.5), with railings. |
| The viaduct ended in mid-air over the lawn. | Deck runs to z = 36; the far end had no terrace, no steps, and no stage. | A stone landing (z 33.4–44), two 0.32 m steps down to the lawn, and a lamp-lit path north. |
| There was no grounds stage at all, so "exit into the grounds" was not a place. | `WORLDS.hogwarts.locations` had no lawn entry. | `hogwarts_grounds` (x -40…40, z 46…86, floor 0.3), reached and left on foot. |
| The viaduct's far exit was missing, and its fight rectangle stopped at z = 22, halfway along its own deck. | `hogwarts_viaduct` had one exit, at the castle end. | Bounds extended to z = 34 and a second exit registered at z = 32. |

The wall walk and the tower decks above the courtyard are still **built but unreachable**: their
switchback stair sits inside a solid stone tower with no door. They are deliberately left out of
the traversal graph instead of being counted as connected.

### The traversal graph

`HOGWARTS_CONNECTIONS` in `worlds/hogwarts_interior.js` is the graph: 21 nodes (the 15 interior
areas plus `great_hall`, `marble_corridor`, `courtyard`, `viaduct`, `grounds`, `dungeons`) and 21
edges. An edge may only be called proven when it names an entry in `HOGWARTS_NAV_ROUTES`; eight
edges carry a route, and every one of those routes is walked both in node (`test:worlds`) and in
the running game (`test:hogwarts`). `scripts/report-hogwarts.mjs` flood-fills the graph from the
entrance hall and records any node it cannot reach.

### Verified end-to-end

`test:hogwarts` walks one continuous round trip with no teleporting between legs: grounds →
viaduct → courtyard → Great Hall → doorway at x = 21 → Entrance Hall → both stair flights →
second-floor corridor → Astronomy Tower, then back down and out again. Each of the 33 checkpoints
asserts that the fighter is standing on the documented floor.


## The battlement route, the lake and the hut

Three routes that the previous pass reported as missing are now walked and tested.

### The stair turret (courtyard → wall walk)

The old turret was a solid 9 × 9 stone block at (39, −63) with its four flights modelled inside
the solid, and each flight began 0.8 m above the landing before it. Two further obstacles sat on
the walk itself: three south-range towers (x −54, 36, 54 at z −68) whose 6.5 m drums stood
*inside* the castle range and cut the wall walk, and the east greenhouse, whose 12 × 10 stone
base lay across the cloister and the turret footprint.

The turret is now hollow at x 34.5–43.5, z −63.6…−54.6:

* walls with a 3.4 m doorway on both the east and west face onto the cloister walk,
* a stone floor at 0.72 m, flush with the walk,
* five switchback flights of 11 treads (0.4 m rise, 0.42 m run) from 0.72 m to 22.72 m,
* each landing a 0.4 m slab spanning both stair bands, so a turn never walks into a tread,
* the south wall stops at 21.2 m so the stair head runs out onto the wall walk at 22.8 m,
* the top landing is two strips (east head, south approach), never a roof over the last flight.

The three south-range towers were deleted rather than moved: any 13 m drum between the range
(z −70) and the walk (z −67.2) has to overlap one of them, which is exactly what had happened.
The greenhouses moved to the lawn at (42, −42) and (56, −38). The two tower decks moved from
x ±52 (where they were buried in the bastions) to x ±20, clear of everything, 0.2 m above the
walk so they are a step up rather than a step too far.

### Grounds → Black Lake

The lawn path continues north from the bench to a 34 × 10 m stone quay at 0.58 m, 0.26 m above
the path and 0.22 m above the water plane. A 0.56 m parapet on the lake edge is the boundary:
the lake is a surface at 0.36 m, so there is no drowning state and no hole to fall through, but
nobody walks out onto the water. `hogwarts_lakeshore` is a selectable 32 × 10 stage on it.

### Grounds → Hagrid's hut, and inside it

A cobbled track leaves the lawn at (−24, 66), runs west around the south side of Hogsmeade
(one cottage occupies x −77…−67, z 37.5…46.5, which the first draft crossed) and ends at the
hut door at (−96, 13).

The hut used to be a 6 m solid brick drum with a door panel painted on it, so the track ended at
a wall. It is now a hollow round house at (−96, 6), built by `buildHagridsHut` in
`worlds/hogwarts_interior.js`:

* sixteen wall panels ring a 6.1 m radius, each 4.1 m high with its own collider, so the interior
  is enclosed everywhere except the door,
* the panel on the +z face is omitted: a 2.4 m opening at z ≈ 12.1, framed by two timber jambs
  and a lintel that starts at 2.75 m so nothing spans the walk-through,
* a stone floor at 0.36 m inside, 0.06 m above the lawn, so the threshold is a step and not a lip,
* the thatched cone is unchanged on the outside; a ceiling disc at 4.35 m closes the interior, and
  the roof no longer holds a fighter up when it is dropped inside,
* a hearth at the back, a table with two benches, a bookcase, a cauldron, an armchair and two
  sconces — all placed clear of the door line so the walk from the threshold to the middle of the
  room is never blocked,
* the two arena spawns moved to (−101, 14.6) and (−91, 14.6) on the approach lawn, because the old
  ones sat in the new wall ring.

The interior is a route in its own right: `Hagrid's hut door → interior` is walked from the track
through the doorway to (−96, 6.5) and must end on the 0.36 m floor. The browser suite also walks
in, turns to (−96.6, 3.6), walks back out, and proves that the wall beside the door does not let a
fighter through, and that a fighter dropped inside lands on the floor rather than on the roof.

### The explore camera in tight spaces

The chase camera used to shorten its shot to the first wall and stop there, which in the 7.6 m
stair well parked the lens roughly at arm's length from the fighter's head. The fix is a lift, not
a bigger minimum distance: in `explore` mode only, the shot is raised by up to 3.4 m as the wall
behind it gets closer (`SmashCamera.update`, `collisionLift`), the lift is probed upward so it is
never pushed into a ceiling, and it is damped with the same rate as the shot so entering and
leaving a tight space does not snap. Over-the-shoulder framing is preserved by dropping the look
target slightly as the camera rises. Combat and overhead modes take the old code path exactly, so
duel framing is unchanged; the browser suite asserts the free camera keeps > 2.3 m of reach and
sits > 2 m above the floor in the turret, returns to its trailing distance in the open courtyard,
and that the duel camera still pulls back past 7 m in a match.
