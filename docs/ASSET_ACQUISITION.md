# External asset acquisition — what the search actually found

This is a record of genuine external asset discovery for Naruto, Superman, Goku and Spider-Man, not a
local inventory. Every row below was fetched from this workspace on 2026-11-06. HTTP codes are the real
responses; nothing here is inferred.

## What works from this environment

| Capability | Result |
| --- | --- |
| Outbound HTTPS | Works (poly.pizza 200, api.sketchfab.com 200, blendswap 200, opengameart 200, raw.githubusercontent 200) |
| Direct binary download | Works — `Soldier.glb` 2,160,468 B, `Xbot.glb` 2,930,032 B, `Michelle.glb` 3,276,888 B, all HTTP 200 |
| Rig inspection after download | Works — the installer reported *"2 meshes, 7434 vertices, 2 skinned, 49 bones; height 1.832 m; clips Idle, Run, TPose, Walk"* for `Soldier.glb` |
| Manifest install | Works (`scripts/install-character-model.mjs`, verified with `--dry-run`) |
| Blender 4.2.23 LTS | Works (`scripts/blender.sh`) |

So the pipeline is not the blocker. **Access is.**

## Source-by-source results

| Source | Reachability | Free rigged versions of these four characters? | Download without an account? |
| --- | --- | --- | --- |
| Sketchfab | 200 (metadata API), download API **401** | Yes, many, all CC Attribution | **No** — documented requirement |
| CGTrader | **202 with 0 bytes** (WAF challenge) on both model page and `/download` | Yes, e.g. "Goku GT Free Rig" (BLEND+FBX, free) | No (account), and unreachable anyway |
| TurboSquid | **403** | Some | No |
| free3d.com | **403** | Some | No |
| RenderHub | 404 on the free listing URL tried | Paid, IP-restricted licences | No |
| BlendSwap | 200 | Yes ("Amazing Spiderman Rigged V2" cc-by, "Future Foundation Spiderman" cc-by) | No (account) |
| OpenGameArt | 200 | **No** — searched naruto/goku/spiderman/superman with the 3D-art filter; only "Kunai" for naruto, nothing for the rest | Yes, but nothing to download |
| poly.pizza | 200 | No — "goku" returns **No results**; others empty | Yes, but nothing to download |
| GitHub (raw) | 200 | Only unattributed rips (e.g. a Dragon Ball repo that credits *Xenoverse*) | Yes, but rights are unusable |
| GitHub (API/search) | **403 / JS-rendered** | — | — |
| Fab (Epic) | 200 | Marketplace, account required | No |
| open3dmodel.com | 200 | Rip-heavy, licence unverifiable | Yes, but rejects on rights |
| Meshy | 200 | AI-generated fan interpretations, "most are static meshes in a neutral pose" | Account; and its own page notes a trademarked character still needs a rights-holder licence |

### The gate is policy, not a glitch

Sketchfab's own Download API guidelines state it plainly:

> "Downloading models requires users to be authenticated with a Sketchfab account… If you want your
> application to download models without end-user authentication, contact us."

The API agrees: `GET /v3/models/{uid}/download` returned **401 `{"detail":"Authentication credentials
were not provided."}`** for all five UIDs tested, while `GET /v3/models/{uid}` returned **200** with
full licence metadata. The legacy `/download` page URL just redirects to the model page. No
unauthenticated endpoint exists, and scraping the viewer or ripping the embed would be circumvention,
so this pipeline does not do it.

## Candidates found (verified metadata, not memory)

All rows: `isDownloadable = true`, licence **CC Attribution**, `animations = 0` — none ship clips, so
animation would come from the authoring pipeline in
[INFANTRY_COMBAT_ANIMATION_PIPELINE.md](INFANTRY_COMBAT_ANIMATION_PIPELINE.md).

| Character | Model | Author | Triangles | Verdict |
| --- | --- | --- | --- | --- |
| Naruto | Naruto Uzumaki (Running Animation) `e18903e…` | Monhoo | 164,134 | **Best candidate.** Original fan art by the uploader, CC BY |
| Naruto | Naruto Rigged `775848d…` | rithul.kamesh | 18,196 | **Rejected** — description says "from Ultimate Ninja Storm 4", i.e. a ripped commercial asset |
| Spider-Man | Fully Rigged Spider-Man `3447ec9…` | SPARSHGUPTA | 53,562 | Candidate, CC BY |
| Spider-Man | Spider Man – Rigged `5fd02d7…` | DevPoly3D | 38,724 | Candidate; uploader states fan-made, not Marvel-affiliated |
| Spider-Man | Rigged Spider-Man `a84d93e…` | arjunpkrishna | 18,308 | Candidate, CC BY |
| Spider-Man | Spider Man `b718c03…` | Nytherix | 311,212 | Candidate; largest, "educational and non-commercial" stated |
| Superman | Superman (Textured) (Rigged) `61ecb87…` | 3dworldz | 4,858 | Candidate but very low-poly (black suit variant) |
| Goku | Goku model rig `75b88c3…` | vaclelenmenttin77 | 77,860 | **Best candidate.** Original, CC BY, "use it in any of your projects… give proper credit" |
| Goku | Goku From Dragon Ball `43d3974…` | Light.k | 76,424 | Candidate, CC BY, textured and rigged |
| Goku | Goku `6a79ab6…` | nemix | 6,384 | **Rejected** — "from chinese mobile game" |
| Goku | Goku (Rigged & Animated) `3ed060d…` | keetos349 | 2,432 | Candidate but far too low-poly for an HD roster slot |

## The rights distinction, stated plainly

These are **technically suitable but rights-limited**: the CC BY licence covers the *uploader's model*
and requires credit, and it does **not** grant rights to Naruto, Superman, Goku or Spider-Man
themselves — those remain with the original rights holders. Nothing here is officially licensed, and
this document does not claim otherwise. That is a separate question from technical quality, and it is
the user's (or the project owner's) call to make.

## What is missing, exactly

One thing: an authenticated Sketchfab token, or the four files supplied directly. The token path is
wired and tested without a live account (`npm run test:fetch-token`); the missing piece is the secret,
not the client. With it, the rest is already built:

```bash
# 1. Validate the secret, then stage WITHOUT registering a second character. Naruto already exists
#    in the roster, so --install is wrong here: it would add a manifest key named "naruto" that no
#    roster slot reads, leaving a duplicate body behind.
export SKETCHFAB_TOKEN=…            # project secret / shell environment only; never written to disk
node scripts/fetch-character-model.mjs --check-auth   # validates the secret; downloads nothing
node scripts/fetch-character-model.mjs --uid e18903ef372b4be6b4d1935815f21a6f --identity "Naruto" --stage-only

# 2. Inspect the real archive before trusting it (mesh, skinned meshes, bones, height, clips).
node scripts/install-character-model.mjs artifacts/asset-fetch/e18903ef372b4be6b4d1935815f21a6f/extracted \
  --identity "Naruto" --dry-run

# 3. Only after it passes: upgrade the existing `naruto_uzumaki` slot in place. This backs up the
#    old body and keeps the character id, URL, moveset and roster entry count unchanged.
node scripts/install-model-upgrade.mjs naruto_uzumaki <inspected.glb> \
  --source "https://sketchfab.com/3d-models/naruto-uzumaki-running-animation-e18903ef372b4be6b4d1935815f21a6f" \
  --license "CC Attribution" \
  --notes "Monhoo candidate; CC BY covers the upload only, not the Naruto character"

npm run audit:roster && bash scripts/run-browser-test.sh scripts/verify-naruto-roster.mjs
```

The upgrade step was rehearsed in a throwaway manifest copy: it restored the original bytes from the
backup, replaced the target, kept `url` unchanged and left exactly one roster entry. `naruto_uzumaki`
is **already installed and playable** (567 bones, 19 clips, 18/18 roster checks), so the token gates an
alternative body, not Naruto's first install.

For Goku the same sequence applies with uid `75b88c3bf6a446df87680b8e7d4ba8e0`. He is **not** staged
yet; the candidate ships zero clips, so staging only begins the work, and the existing `goku` roster
slot would be upgraded in place rather than duplicated.

Re-checked from this workspace on 2026-11-06 with no token: the fetch script printed the eligible
metadata (Monhoo, CC Attribution, 164,134 triangles, downloadable) and exited **2** before the download
endpoint, and `artifacts/asset-fetch/e18903ef372b4be6b4d1935815f21a6f/` was never created. The live
candidate registry, including honest milestone flags for Naruto, Superman, Goku and Spider-Man, is at
`artifacts/asset-fetch/candidate-registry.json`.

`scripts/fetch-character-model.mjs` reads the token from `SKETCHFAB_TOKEN` (or the legacy
`SKETCHFAB_API_TOKEN`) in the environment only. It refuses models whose licence is not CC0/CC BY,
refuses descriptions that state the mesh came from a commercial game, and refuses view-only models.
It sends `Authorization: Token …` to the official download endpoint, never prints the token or the
signed archive query, strips both token variables from the environment of `unzip` and the installer,
and writes `fetch-report.json` with the source, licence, attribution, SHA-256 and install outcome.

Guard rails verified on 2026-11-06:

- **no token** (real, no account): eligible metadata is printed, exit **2**, and no output directory
  is created;
- **valid token, staged model** (local mock): the `Token` header is sent, the archive is saved,
  hashed and staged; the token and signed query appear in neither stdout/stderr nor the report;
- **invalid token** (local mock): the download endpoint's **401** is surfaced, exit **1**, nothing is
  written;
- **path-like uid** (local): rejected before any request or directory is created;
- **ripped candidate** (real metadata): refused on its own description before any download.

`npm run test:fetch-token` runs the mock cases. It does not prove a live Sketchfab account works, and
no live model has been downloaded through this token path: the Goku milestone remains blocked on the
secret.
