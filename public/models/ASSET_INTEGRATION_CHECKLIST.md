# Sketchfab asset integration checklist

The game's GLB character loader expects character files at:
- `public/models/characters/spider_man.glb`
- `public/models/characters/woody.glb`
- `public/models/characters/goku.glb`
- `public/models/characters/naruto.glb`
- `public/models/characters/superman.glb`
- `public/models/characters/thor.glb`
- `public/models/characters/deadpool.glb`
- `public/models/characters/ben_10.glb`

Environment GLBs (static scenery, not fighters) should go at:
- `public/models/environments/avengers_tower.glb`
- `public/models/environments/avengers_compound.glb`
- `public/models/environments/hogwarts_great_hall.glb`
- `public/models/environments/valley_of_the_end.glb`
- `public/models/environments/asgard.glb`

Weapon GLBs can go in `public/models/weapons/`; weapons need pivot/origin checks before they can be attached to a fighter's hand.

## User-provided candidate links

Characters:
- Spider-Man — YE YE: https://sketchfab.com/3d-models/spider-man-smbnd-mcu-f1ea205c0fa148c9b50d07cfdecaff39
- Woody — https://sketchfab.com/3d-models/woody-toy-story-5-rig-92c2fef50e4d4823ab223b3e7ef15a1c
- Goku (damaged) — https://sketchfab.com/3d-models/dbxv2-goku-damaged3-a4af18c89c9a4156b9beda79aa6ee650
- Naruto Sage — https://sketchfab.com/3d-models/naruto-sage-161369399a0d4b6e9657023a1bcbfb31
- Ben 10: no Ben 10 asset link was supplied; the provided extra character link is Superman.
- Superman — https://sketchfab.com/3d-models/fornite-james-gunn-superman-b77f2f6533ce453ca43dfe13b7f0b2a0
- Thor — https://sketchfab.com/3d-models/thor-infinity-war-59f5c44bcf18428abe8977a1bb1cd775
- Deadpool (static/no rig) — https://sketchfab.com/3d-models/deadpool-static-no-rig-gameready-f336c9dfe3c24c4192fd305c7a6c58c7

Environments:
- Avengers Tower — https://sketchfab.com/3d-models/the-avengers-tower-c9bcc0bad326433ea201a2d82aff581d
- Avengers QG / compound — https://sketchfab.com/3d-models/avengers-qg-c1397a34344b4b5397a56ff569a4fa6f
- Hogwarts Great Hall — https://sketchfab.com/3d-models/howarts-great-hall-b2277535730a49d7bab586e8a495a850
- Valley of the End — https://sketchfab.com/3d-models/valley-of-the-end-cba6fe75daf641a3810ec8b95544327c
- Asgard schematic — https://sketchfab.com/3d-models/asgardschematic-602b832831104dd38bd964bec8d9cc12

Other sources:
- Environment collection: https://sketchfab.com/dovahkhalesshi/collections/environments-7745060f758a4ab3b5741dd4b22a6537
- Weapons collection search: https://sketchfab.com/search?q=weapons&type=collections
- Terrain collection: https://sketchfab.com/saracarena1/collections/terrain-models-4241bb512a77401998c91bd872c59467

## Important status

This file is a checklist, not a claim that the models have been downloaded. The repo needs the actual downloaded GLB files before the game can display these specific assets. Download each model from Sketchfab while signed in, then upload the GLB (or the original ZIP/archive) to the project. Keep the creator and license details and add attribution for each asset that is actually used. Check each license and underlying IP rights before distributing the game.

Rigging note: Woody's title says rig, but verify that the downloadable package contains a usable armature and animations. Deadpool is explicitly static/no-rig and needs rigging/retargeting before normal combat animation. Environments may need decimation, scale adjustment, collision setup, and lighting optimization for browser performance.
