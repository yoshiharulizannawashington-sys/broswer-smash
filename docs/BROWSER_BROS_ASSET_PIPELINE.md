# Browser Bros reboot: asset workflow

Keep this as a browser-based Three.js game. Improve it in small, testable slices rather than replacing it with a generic demo.

## Current status

- Existing procedural fighters, combat items, environment assets, camera, and animation helpers remain the fallback path.
- `public/models/characters/manifest.json` keeps Goku and Iron Man disabled until their actual source files are installed. Do not enable missing paths.
- `public/data/animationManifest.json`, `weaponManifest.json`, and `itemManifest.json` are catalogs for verified assets. A null path means no external asset is installed.
- These manifests do not imply that any Sketchfab or Mixamo asset has been downloaded.

## Chromebook-friendly workflow

1. Keep changes on a feature branch and preserve `main`.
2. Use Mixamo for compatible humanoid motion clips; download files manually and check the service's current terms.
3. Use Sketchfab only for assets with an available download. Check license, creator attribution, textures, rigging, and whether the actual downloaded file contains animations.
4. Prefer GLB/glTF for browser runtime assets. FBX may require conversion and retargeting.
5. Place validated files under `public/assets/characters/`, `public/assets/animations/`, `public/assets/weapons/`, or `public/assets/items/`, adapting to existing loader conventions.
6. Update a manifest only after verifying the exact file exists, license is recorded, and the file loads.
7. Validate skeleton compatibility, clip names/duration, scale/orientation, materials, texture paths, root motion, and ground contact.
8. Connect animations to gameplay state. Attack hit windows, damage, and knockback must remain in combat logic, not visual effects.
9. Run `npm run build` and the repository's browser smoke test when a runnable environment is available. Report exactly what was tested.

## Quality priorities

1. Reliable startup and safe asset loading.
2. Raised, pulled-back camera centered on both fighters and zooming out as they separate or fly.
3. Responsive movement and flight.
4. Two rigged fighters with validated movement and combat clips.
5. One detailed traversable region with landmarks.
6. Functional weapon attachment and pickups.
7. Lighting/material polish, VFX, optimization, then roster and world expansion.

## Asset records

For every downloaded asset, record its local path, source URL, creator, license, required attribution, file format, texture dependencies, rig/skeleton details, clip list, and validation status. Never mark a missing or untested asset as integrated.

## Important limits

AI-generated still images are not rigged 3D models. Generated meshes may need topology cleanup, skin weights, rigging, material cleanup, and retargeting. Browser-based tools may limit free exports or credits. Never require a paid API and never put private API keys in browser JavaScript.
