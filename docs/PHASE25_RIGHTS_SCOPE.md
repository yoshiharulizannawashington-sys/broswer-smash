> **Phase 26 update:** the licensing material in this document is reference information, not an
> import gate. Nothing in the technical pipeline (retrieval, conversion, rigging, animation,
> registration, preview, gameplay) reads a licence value to decide whether a model may be used.

# Phase 25 — rights coverage, character by character

Scope: every identity the game can spawn. Source of truth is `allRoster` in `public/js/main.js`
(60 identities: 38 launch, 22 DLC) plus the bodies in `public/models/characters/manifest.json`.

This document answers one question per character: **who owns it, what do they own, and what has to be
cleared before it can be used?** It does not repeat the sourcing rulebook in
`docs/PROFESSIONAL_ASSET_SOURCING.md`; it applies it.

## 1. How to read the tiers

| Tier | Meaning | Rights needed | Realistic outcome |
| --- | --- | --- | --- |
| **A** | Original to this project | none | ships as-is |
| **B** | Fictional character, single franchise owner | copyright (character + visual design) + trademark (name, logo, costume marks) | licence, or redesign |
| **C** | Real person | right of publicity / personality rights (all US states vary; post-mortem rights differ) + trademark where the name is a brand | consent, or redesign |
| **D** | Character **and** the performer who plays them | B + C together | most expensive clearance in the roster |

Three separate rights attach, and clearing one does not clear the others:

1. **Copyright** — the character as a protected creative work. A model, however original, that
   reproduces a protected character is a derivative work. This is what blocks bought fan sculpts.
2. **Trademark** — the name, logo, trade dress. Relevant to the character-select screen, the store
   page, the URL, the trailer, the description. A trademark can be infringed even where copyright
   clearance exists (a licensee of Spider-Man for games may still not own the mark for merchandise).
3. **Personality rights** — only for the ten Tier C/D identities. Survives the death of the person in
   several jurisdictions, which is why the Bruce Lee and Burt Reynolds slots are not "free".

## 2. Coverage table

Tier A = original; B = character/franchise; C = real person; D = character + performer.

| # | Identity | Rights holder(s) | Tier | Clearance note |
| --- | --- | --- | --- | --- |
| 1 | The Rock | Dwayne Johnson (Seven Bucks / WME likeness) | C | Publicity rights; "The Rock" is also a registered mark owned by Johnson |
| 2 | Samuel L. Jackson | Samuel L. Jackson | C | Publicity rights only; no character rights attach |
| 3 | Bruce Lee | Bruce Lee Enterprises (estate) | C | Post-mortem publicity rights actively enforced; the estate licenses the likeness, not just the name |
| 4 | Jean-Claude Van Damme | Jean-Claude Van Damme | C | Publicity rights |
| 5 | Lucy Liu | Lucy Liu | C | Publicity rights |
| 6 | Sigourney Weaver | Sigourney Weaver | C | Publicity rights |
| 7 | Keanu Reeves | Keanu Reeves | C | Publicity rights |
| 8 | Burt Reynolds | Burt Reynolds estate | C | Post-mortem publicity rights |
| 9 | Grace Jones | Grace Jones | C | Publicity rights |
| 10 | Arnold Schwarzenegger | Arnold Schwarzenegger | C | Publicity rights; "Terminator"-adjacent styling would escalate to B |
| 11 | Superman | DC (Warner Bros. Discovery) | B | Copyright status of the earliest stories is contested; the modern character and S-shield mark are not |
| 12 | Iron Man (Tony Stark) | Marvel (Disney) | B | Character + armour trade dress; RDJ likeness not implied by this slot |
| 13 | Hulk (Bruce Banner) | Marvel (Disney) | B | Character; Banner's human design is the licensable part |
| 14 | Green Lantern (Hal Jordan) | DC (WBD) | B | Character; the ring/power-battery iconography is separately marked |
| 15 | Wolverine (Logan) | Marvel (Disney) | B | Character; yellow-and-blue costume is trade dress |
| 16 | Wonder Woman | DC (WBD) | B | Character; the WW monogram is a registered mark |
| 17 | Professor X (Charles Xavier) | Marvel (Disney) | B | Character |
| 18 | The Flash (Barry Allen) | DC (WBD) | B | Character; lightning-bolt mark |
| 19 | Aquaman | DC (WBD) | B | Character |
| 20 | Doctor Strange | Marvel (Disney) | B | Character |
| 21 | Goku | Toei Animation, Shueisha, Capsule Corp, Bandai Namco | B | Four-way rights stack; SSJ hair silhouette is trade dress |
| 22 | Naruto Uzumaki | Shueisha, Studio Pierrot | B | Character; the headband/leaf symbol is a mark |
| 23 | Vegeta | Toei, Shueisha, Capsule Corp | B | Same stack as Goku |
| 24 | Saitama | ONE, Yusuke Murata, Shueisha | B | Manga and anime rights split; Cape design is the licensable element |
| 25 | L (Death Note Style) | Tsugumi Ohba, Takeshi Obata, Shueisha | B | Character; "Death Note Style" in the id already implies a pastiche, which does not clear it |
| 26 | Levi Ackerman | Hajime Isayama, Kodansha | B | Character; ODM gear is the distinctive design |
| 27 | Edward Elric | Hiromu Arakawa, Square Enix | B | Character; automail design |
| 28 | Roronoa Zoro | Eiichiro Oda, Shueisha, Toei | B | Character; three-sword silhouette |
| 29 | All Might | Kohei Horikoshi, Shueisha | B | Character |
| 30 | Jotaro Kujo | Hirohiko Araki, Shueisha | B | Character; the hat-and-coat silhouette |
| 31 | Mario | Nintendo | B | Character + name mark; Nintendo enforces aggressively |
| 32 | Luigi | Nintendo | B | Character + name mark |
| 33 | Solid Snake | Konami | B | Character; Kojima does not hold the rights |
| 34 | Geralt of Rivia | CD Projekt (game likeness), Andrzej Sapkowski (literary) | B | Two rights holders; the game design is the one this slot visually copies |
| 35 | Kratos | Sony Interactive Entertainment (Santa Monica Studio) | B | Character; the Blades of Chaos design |
| 36 | Link | Nintendo | B | Character; the Master Sword and Hylian shield are marks |
| 37 | Lara Croft | Crystal Dynamics / Embracer (CDE) | B | Character + name mark |
| 38 | Sephiroth | Square Enix | B | Character; Masamune design |
| 39 | Master Chief | Microsoft (Halo Studios) | B | Character; Mjolnir armour trade dress |
| 40 | Doom Slayer | Microsoft (id Software / ZeniMax) | B | Character; praetor suit design |
| 41 | Shrek | DreamWorks (Universal) | B | Character + name mark |
| 42 | Aladdin | Disney | B | Character; note the folk tale is public domain, this design is not |
| 43 | Ariel | Disney | B | Character |
| 44 | Ursula | Disney | B | Character |
| 45 | Edna Mode | Disney / Pixar | B | Character |
| 46 | Captain Jack Sparrow | Disney **and** Johnny Depp | D | Character plus the performance and likeness the design copies |
| 47 | Sesshomaru | Rumiko Takahashi, Shogakukan, Sunrise | B | Character |
| 48 | Norman Bates | Universal Pictures (Psycho) | B | The novel is still in copyright; the film design is Universal's |
| 49 | Han Solo | Lucasfilm (Disney) **and** Harrison Ford | D | Character plus performer likeness |
| 50 | Indiana Jones | Lucasfilm (Disney) **and** Harrison Ford | D | Character plus performer likeness; the fedora-and-whip silhouette is trade dress |
| 51 | Sasuke Uchiha | Shueisha, Studio Pierrot | B | Character; Sharingan design |
| 52 | Hashirama Senju | Shueisha, Studio Pierrot | B | Character |
| 53 | Madara Uchiha | Shueisha, Studio Pierrot | B | Character |
| 54 | Lord Voldemort | J.K. Rowling, Warner Bros. | B | Literary and film rights held separately |
| 55 | Thor | Marvel (Disney) — **and** Norse mythology, which is public domain | B | The mythological figure is free; this hammer-and-cape design is not |
| 56 | Aang | Paramount / Avatar Studios (Nickelodeon) | B | Character; arrow tattoo design |
| 57 | Spider-Man | Marvel (Disney) | B | Character; web-pattern trade dress; film rights sit with Sony, game rights do not follow them |
| 58 | Iron Spider | Marvel (Disney) | B | Character variant; MCU-exclusive design elements are the licensable part |
| 59 | Kaze | **this repository** | **A** | Original work; no clearance needed. The one identity that can carry a professional art commission today |

Tally: **1 original, 48 Tier B, 6 Tier C, 4 Tier D.**

## 3. What the distribution model changes

| Distribution | Exposure | What it actually means |
| --- | --- | --- |
| Private, local, never distributed | Lowest | No publication, so no distribution right is exercised. Still not a licence: the moment a build is shared, published or streamed commercially, the analysis changes. |
| Free public web build | **High** | Free is not a defence. Publication triggers infringement, takedowns, and statutory damages in the US; ad revenue or donations can convert it to commercial. This is the riskiest middle ground. |
| Commercial / paid | Highest | Requires licences, not arguments. 58 rights holders is a licensing campaign, not a task. |
| Marketing surfaces (trailer, store page, domain, social) | Independent | Trademark exposure exists even where the build itself is private: a store listing naming "Goku" is a mark use. |

## 4. Practical consequence

- **Kaze is the only identity that can be commissioned to professional standard today** without
  anyone's permission. That is also the only identity where a purchased or commissioned asset is
  unambiguously ours.
- **Every other slot needs either a licence or a redesign.** There is no third option, and no
  asset store shortens it: the blocking right is the character, not the mesh.
- **A partial roster is the realistic shipping shape.** If only a handful clear (or are redesigned),
  ship those and gate the rest. The roster infrastructure already supports this — `launch`, `dlc`
  and `all` are separate lists in `public/js/main.js`, and `?showcaseCharacter=<key>` reviews a body
  without touching `roster`.
- **The four Tier D slots (Jack Sparrow, Han Solo, Indiana Jones, and any performer-derived design)
  are the worst value in the roster**: two rights holders each, and the thing that makes them
  recognisable — the performer — is exactly what cannot be licensed cheaply.

## 5. What I would do first

Pick the identity whose clearance is genuinely obtainable, and make it the visual flagship. Today that
is **Kaze** (Tier A, no permission needed, already the reference fighter the whole roster's geometry
kernel is built on). It is also the honest answer to "high-level models for the characters I have":
one of them is ours, and it can be commissioned to any standard we like.

For the other 58, the decision is a business one, not an engineering one: license a small number, or
redesign them into Tier A originals using the spec in `docs/PHASE25_ROSTER_ART_BRIEF.md`.
