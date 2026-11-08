> **Phase 26 update:** the licensing material in this document is reference information, not an
> import gate. Nothing in the technical pipeline (retrieval, conversion, rigging, animation,
> registration, preview, gameplay) reads a licence value to decide whether a model may be used.

# Phase 25 — roster art brief (why the five candidates were rejected, and what replaces them)

## 1. The finding that redirects Phase 25

The five candidates researched under Phase 25 (NOTPB sculpt, murilo.kleine "b-MAG", and three
alex94i60 VRM characters) are **off-roster**. They are original anime characters by their authors,
which is exactly why they can be licensed — and exactly why they cannot become anyone in this game.

The roster needs **these specific characters**: Superman, Iron Man, Goku, Naruto, Mario, Shrek,
Kratos, Master Chief, … (38 selectable identities in `public/js/main.js`). None of them can be
sourced by browsing an asset store.

### Why there is nothing to buy

`docs/PROFESSIONAL_ASSET_SOURCING.md` §1 asks three questions of every asset; the third one decides
this whole phase:

> Does the uploader have the right to license it at all?

For a roster character the answer is **no**. A fan sculpt of Iron Man is a derivative work of a
Marvel character: the sculptor owns their mesh, but only Marvel can license Iron Man. The same holds
for Dragon Ball (Toei/Shueisha/Capsule Corp), Naruto (Shueisha/Pierrot), DC, Nintendo, Disney,
One Piece, Attack on Titan, Fullmetal Alchemist, One-Punch Man and the rest. A CC BY badge on such a
model conveys nothing from the rights holder.

The consequence, stated plainly:

- **No legitimate marketplace sells models of these characters.** Asset packs (Synty POLYGON,
  BoZo, Character Creator 5, Unity/Fab stores) contain the sellers' **own** designs at $30–$300.
  They cannot be made to be Iron Man, and buying them would reproduce the same failure as the
  Quaternius mannequin: a rigged stranger that is not our roster.
- **Real-person identities are worse, not better.** `arnold_schwarzenegger`, `keanu_reeves`,
  `the_rock`, `bruce_lee`, `samuel_l_jackson`, `sigourney_weaver`, `lucy_liu`, `burt_reynolds`,
  `jean_claude_van_damme` need publicity rights as well as copyright clearance.
- Therefore "find five professional-quality models of my roster characters" has **no purchasable
  form**. It is a commissioning or licensing problem, not a shopping problem.

The five Phase 25 candidates remain documented in `artifacts/phase25/candidates-api.json` and
`artifacts/phase25/previews/` as evidence of the search, with verified licences. They are rejected
**for roster mismatch**, not for quality: b-MAG is a genuinely designed, CC BY 4.0, 110k-tri anime
fighter, and it is still not allowed to stand in for Goku.

## 2. Three real routes to professional roster art

| Route | What it produces | Legal status | Effort / cost | Can this workspace do it? |
| --- | --- | --- | --- | --- |
| **A. Rights-holder licence** | Officially sanctioned Iron Man / Goku bodies | Clean | Publisher negotiation; not achievable for a fan project | No — needs a company, contract, legal review |
| **B. Original-IP crossover** (recommended) | Rename and redesign each fighter into an original character with the same archetype and silhouette language, then commission professional sculpts of *those* | Clean and shippable | One design pass per fighter + one commission per fighter | Design pass: yes. Sculpts: needs a human artist |
| **C. Commission fan sculpts for a private build** | Artist-made roster-accurate bodies, not distributed | Infringing if published; acceptable for private/portfolio use | $1k–4k per hero character at freelance rates (40–120 h) | Ordering: no. Brief and technical contract: yes (this document) |

Route B is the only one that ends with a game that can ship and a roster that still reads as
"Superman-like", "Goku-like", "Iron Man-like" in silhouette, power set and moves — without using
anyone else's character. Route C is fine for a personal build and is the fastest path to the visual
upgrade the roster is asking for, as long as publishing is off the table.

## 3. What a commissioned body must satisfy (the technical contract)

Every shipped body already obeys this, which is why a commissioned fighter can drop in without
touching the engine.

**Rig — 19 canonical bones, names must classify.** `public/js/anim/rig_map.js` matches keywords;
the ingest pipeline renames *to* these, an artist should simply use them:

```
Hips, Spine, Chest, Neck, Head,
LeftShoulder, LeftArm, LeftForeArm, LeftHand,
RightShoulder, RightArm, RightForeArm, RightHand,
LeftUpLeg, LeftLeg, LeftFoot,
RightUpLeg, RightLeg, RightFoot
```

Traps already paid for in this repo: `leftFore` binds to nothing (no "forearm"/"arm" substring) and
`leftLeg` classifies as a **shin**, deleting the thigh. Use `LeftForeArm` and `LeftUpLeg`.

**Seven clips, exactly these names:** `Idle`, `Walk`, `Run`, `Jump`, `Punch`, `Kick`, `Kamehameha`.
Any other clip name is dropped by the loader. Walk and run must be authored for the fighter's
locomotion profile stride, or foot sliding is guaranteed.

**Ground, scale, facing.** Lowest vertex at y = 0 (±2 cm gate), height per the fighter's profile
(1.6–1.9 m for most; Hulk and All Might are authored taller), facing −Z in the game's convention
(the roster bodies carry a yaw offset where the source disagrees).

**Format.** GLB (glTF 2.0 binary). FBX is acceptable as a source if exported through Blender;
`.vrm` is glTF and its humanoid bones map by name.

**Geometry gate.** `node scripts/inspect-character-glb.mjs <file>` must exit 0: watertight, no
zero-area triangles, no collapsed edges, no degenerate bands. The Quaternius mannequin failed with
6,584 zero-area triangles out of 13,744; a beautiful model that fails this is not shippable.

## 4. What "professional" means for one hero character (art spec)

Judged from the game camera: 6–9 m back, 45–51° FOV, 1080p, three-quarter view most of the time.

| Element | Requirement | Rejection signal |
| --- | --- | --- |
| Budget | 35k–80k triangles, 2–4 PBR texture sets at 2048², one material per costume region | >150k tris with no LOD plan; a single flat material |
| Face | Sculpted brow ridge, nose bridge, lips, jaw; eyes as geometry **plus** iris/pupil texture; at least 4 expression morphs (neutral, strain, shout, KO) | Painted-on eyes on a sphere; a blank mannequin head |
| Hair | 6+ modelled masses or cards with authored flow, silhouette readable in profile | A smooth helmet shape |
| Hands | Five separated fingers, three joints, thumb opposition; correct fist for the punch clip | Mitten hands, or fingers fused into the forearm |
| Clothing | Modelled folds, layered seams, distinct trims; cloth must deform with the adjacent bone, not float | Texture-only "clothing" on bare legs; intersecting shells |
| Anatomy | Trapezius into deltoid, forearm taper, calf mass, knee and elbow structure; stylised proportions allowed, but consistent from all four views | Cylindrical limbs, metaball inflation, one good angle |
| Identity | The costume parts that make the character recognisable in silhouette at 3 m: cape, armour panels, belt, boots, signature weapon mount | Generic body in a recolour |

## 5. Acceptance, unchanged from the existing pipeline

1. **Ingest gate** — provenance fields present, bones remap, seven states exported, feet on the
   floor, height matched (`scripts/ingest-character.mjs`).
2. **Geometry gate** — `scripts/inspect-character-glb.mjs` exits 0.
3. **Visual gate** — front, three-quarter and face captures plus an in-match review through
   `?showcaseCharacter=<key>`, judged against the mannequin baseline. A commissioned body that
   passes 1 and 2 but not 3 is still rejected; that is the rule that produced this phase.

## 6. Recommendation

Pick **one** hero identity and take it all the way, rather than touching 34 bodies. Iron Man is the
right first subject: his silhouette is armour panels and a reactor, which survives stylisation, he
already has an authored body and a fully measured combat set in this repo, and a hard-surface
costume is the cheapest kind of professional commission to specify precisely.

Route B (original-IP redesign) if the game is meant to ship; Route C (commissioned fan sculpt, private
build) if the goal is the visual upgrade itself. Either way the brief above is what the artist is
handed, and the three gates are what decides whether the result enters the roster.
