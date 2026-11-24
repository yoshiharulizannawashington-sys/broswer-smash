// Live acceptance for the three imported environment arenas: Konoha Hidden Leaf Village,
// Skyloft and the combined Wuhu Island + Sunshine Airport Mario Kart stage.
//
// Each map is opened through the real setup screen, started as a real match, checked for a mounted
// Blender GLB, grounded fighters, usable camera framing and no page errors, then captured.
//
//   bash scripts/run-browser-test.sh scripts/verify-environment-arenas.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/environment/arenas/live';
await mkdir(out, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.hdr': 'image/vnd.radiance', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm'
};
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('nf');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const maps = [
  { key: 'konoha_overlook', label: 'Konoha · Hidden Leaf Village', minMeshes: 1, maxMeshes: 8 },
  { key: 'skyloft', label: 'Skyloft · Skyward Isle', minMeshes: 90, maxMeshes: 180 },
  { key: 'mariokart', label: 'Mario Kart · Wuhu Island Headland', minMeshes: 120, maxMeshes: 200 },
].filter(map => !process.env.ONLY_MAP || map.key === process.env.ONLY_MAP);

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const report = [];
try {
  for (const map of maps) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.setDefaultTimeout(180000);
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error.message || error).slice(0, 240)));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 240)); });

    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
    await page.click('#bbTitle [data-nav="versus"]');
    await page.evaluate(({ key }) => {
      window.__browserSmashSelect.select('p1', 'Goku');
      window.__browserSmashSelect.select('p2', 'Naruto Uzumaki');
      window.__browserSmashSelect.chooseArena(key);
      document.querySelector('#play').click();
    }, map);
    await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 45000, polling: 100 });
    await page.waitForFunction(key => window.__browserSmashAssets?.arenas?.[key]?.status === 'loaded', map.key, { timeout: 180000, polling: 250 });
    // Check the authored spawns before the AI has had time to launch anyone: a stage is not
    // grounded just because a fighter happened to land after a combo.
    // Spawn and sample in one evaluate: the running match loop can move the AI between two
    // evaluate calls, which made this check look like a terrain failure on a later frame.
    const spawnState = await page.evaluate(() => {
      window.__browserSmashSpawnFighters();
      const layout = window.__browserSmashLayout?.() || {};
      return { ground: layout.ground, fighters: window.fighters.map(f => ({ name: f.name, x: +f.position.x.toFixed(2), y: +f.position.y.toFixed(2), z: +f.position.z.toFixed(2), grounded: Boolean(f.isGrounded), visible: f.model?.visible !== false, expectedGround: typeof layout.heightAt === 'function' ? +layout.heightAt(f.position.x, f.position.z).toFixed(3) : layout.ground })) };
    });
    await page.evaluate(() => { for (let i = 0; i < 90; i += 1) window.__browserSmashStep(1 / 60); });
    await page.waitForTimeout(250);

    const state = await page.evaluate(({ key }) => {
      const asset = window.__browserSmashAssets?.arenas?.[key] || null;
      const layout = window.__browserSmashLayout?.() || null;
      const report = window.smashCamera?.report?.(window.fighters[0], window.fighters[1]) || null;
      const visible = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };
      return {
        key,
        selected: document.querySelector('#mapSelect')?.value,
        optionCount: document.querySelectorAll(`#mapSelect option[value="${key}"]`).length,
        menuOptionCount: document.querySelectorAll(`#menuMapSelect option[value="${key}"]`).length,
        asset,
        layout: layout ? { ground: layout.ground, bounds: layout.bounds, spawns: layout.spawns, hideFloor: layout.hideFloor ?? null, blocks: layout.blocks?.length ?? 0 } : null,
        world: window.__browserSmashWorld || null,
        skyloftCollision: window.__browserSmashSkyloftCollision || null,
        skyloftCollisionError: window.__browserSmashSkyloftCollisionError || null,
        skyloftDeck: window.__browserSmashSkyloftDeck || null,
        skyloftPlazaStillPresent: Boolean(window.__browserSmashAuthoredGroup?.getObjectByName?.('skyloft_plaza')),
        konohaCleanup: window.__browserSmashKonohaOverlook || null,
        konohaDeckStillPresent: Boolean(window.__browserSmashAuthoredGroup?.getObjectByName?.('konoha_overlook_deck')),
        konohaBridgeStillPresent: Boolean(window.__browserSmashAuthoredGroup?.getObjectByName?.('konoha_village_bridge')),
        konohaVillagePresent: Boolean(window.__browserSmashAuthoredGroup?.getObjectByName?.('konoha_village')),
        floorVisible: Boolean(window.__browserSmashFloorState?.()?.material) && (() => {
          // floor visibility is not exposed directly; inspect the scene object by its stable name.
          let found = null;
          window.__browserSmashScene?.traverse?.(node => { if (!found && node.isMesh && node.geometry?.type === 'BoxGeometry' && node.material?.name === window.__browserSmashFloorState()?.material) found = node; });
          return found ? found.visible : null;
        })(),
        fighters: window.fighters.map(f => ({
          name: f.identity,
          x: +f.position.x.toFixed(2), y: +f.position.y.toFixed(2), z: +f.position.z.toFixed(2),
          ground: +(f.groundLevel ?? 0).toFixed(2),
          grounded: Boolean(f.isGrounded), visible: visible(f.model), yaw: +f.model.rotation.y.toFixed(2)
        })),
        camera: report ? {
          inside: report.insideGeometry,
          bounds: report.fighters?.map(entry => entry.bounds) || null,
          distance: report.distance ?? null
        } : null,
        renderer: window.__browserSmashRenderer ? {
          calls: window.__browserSmashRenderer.info?.render?.calls ?? null,
          triangles: window.__browserSmashRenderer.info?.render?.triangles ?? null
        } : null,
        status: window.__browserSmashMatch().status,
        arena: window.__browserSmashMatch().arena
      };
    }, map);
    let skyloftTerrain = null;
    if (map.key === 'skyloft') {
      skyloftTerrain = await page.evaluate(() => {
        const layout = window.__browserSmashLayout?.() || {};
        const probes = [[0, 0], [-18, -12], [0, 12], [18, 12], [10, -12], [6.2, 2]];
        const samples = probes.map(([x, z]) => ({ x, z, h: layout.heightAt ? +layout.heightAt(x, z).toFixed(3) : null }));
        window.__browserSmashFreezeAI = true;
        const [p1, p2] = window.fighters;
        p1.position.set(-18, 3, 12); p1.velocity.set(0, 0, 0); p1.isGrounded = false;
        p2.position.set(-10, 3, 12); p2.velocity.set(0, 0, 0); p2.isGrounded = false;
        for (let i = 0; i < 90; i += 1) window.__browserSmashStep(1 / 60);
        return {
          info: window.__browserSmashSkyloftTerrain || null,
          error: window.__browserSmashSkyloftTerrainError || null,
          ground: layout.ground,
          samples,
          fighter: {
            x: +p1.position.x.toFixed(2), y: +p1.position.y.toFixed(3), z: +p1.position.z.toFixed(2),
            grounded: Boolean(p1.isGrounded), ground: +p1.groundLevel.toFixed(3),
            expected: layout.heightAt ? +layout.heightAt(-18, 12).toFixed(3) : null
          }
        };
      });
      // Walk from the raised middle terrace toward the side path. The feet must descend with the
      // sampled island instead of staying on the old plaza height and clipping through the slope.
      await page.evaluate(() => {
        const [p1, p2] = window.fighters;
        p1.position.set(0, 2, 12); p1.velocity.set(0, 0, 0); p1.isGrounded = false;
        p2.position.set(0, 2, -12); p2.velocity.set(0, 0, 0); p2.isGrounded = false;
        window.__browserSmashFreezeAI = true;
        for (let i = 0; i < 60; i += 1) window.__browserSmashStep(1 / 60);
      });
      skyloftTerrain.walkStart = await page.evaluate(() => ({
        x: +window.fighters[0].position.x.toFixed(2), y: +window.fighters[0].position.y.toFixed(3), z: +window.fighters[0].position.z.toFixed(2)
      }));
      await page.keyboard.down('d');
      await page.evaluate(() => { for (let i = 0; i < 120; i += 1) window.__browserSmashStep(1 / 60); });
      await page.keyboard.up('d');
      skyloftTerrain.walkEnd = await page.evaluate(() => {
        const layout = window.__browserSmashLayout?.() || {};
        const p = window.fighters[0];
        return {
          x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(3), z: +p.position.z.toFixed(2),
          expected: layout.heightAt ? +layout.heightAt(p.position.x, p.position.z).toFixed(3) : null,
          grounded: Boolean(p.isGrounded)
        };
      });
    }

    let skyloftCollisionProbe = null;
    if (map.key === 'skyloft') {
      // UI-equivalent input probe: start just outside a generated wall, hold right for two seconds,
      // and prove the fighter stops at the wall rather than crossing it. This is deliberately a real
      // keyboard walk, not a direct resolveCollision() call.
      skyloftCollisionProbe = await page.evaluate(() => {
        const layout = window.__browserSmashLayout?.() || {};
        const bounds = layout.bounds || {};
        const blocks = (layout.blocks || []).filter(block => !block.r
          && block.top != null && (block.top - (block.bottom ?? 0)) > 1.2
          && (block.x1 - block.x0) >= .7 && (block.z1 - block.z0) >= .7);
        const inside = (x, z, block) => !block.r && x > block.x0 && x < block.x1 && z > block.z0 && z < block.z1;
        const candidate = blocks.find(block => {
          const sx = block.x0 - 1.35;
          const sz = (block.z0 + block.z1) / 2;
          const approach = typeof layout.heightAt === 'function' ? layout.heightAt(sx, sz) : (layout.ground ?? 0);
          return sx > (bounds.x0 ?? -21) + 1.2 && sz > (bounds.z0 ?? -15.5) + .7 && sz < (bounds.z1 ?? 15.5) - .7
            && block.top > approach + 1.2
            && !blocks.some(other => inside(sx, sz, other));
        });
        if (!candidate) return { found: false, blocks: blocks.length };
        const sz = (candidate.z0 + candidate.z1) / 2;
        const sx = candidate.x0 - 1.35;
        const sy = typeof layout.heightAt === 'function' ? layout.heightAt(sx, sz) : (layout.ground ?? 0);
        const p1 = window.fighters[0];
        window.__browserSmashFreezeAI = true;
        p1.position.set(sx, sy, sz);
        p1.velocity.set(0, 0, 0);
        p1.isGrounded = true;
        p1.facing = 1;
        return {
          found: true,
          blocks: blocks.length,
          block: candidate,
          start: { x: +sx.toFixed(3), y: +sy.toFixed(3), z: +sz.toFixed(3) }
        };
      });
      if (skyloftCollisionProbe.found) {
        await page.keyboard.down('d');
        await page.evaluate(() => { for (let i = 0; i < 120; i += 1) window.__browserSmashStep(1 / 60); });
        await page.keyboard.up('d');
        skyloftCollisionProbe.after = await page.evaluate(({ block }) => {
          const p = window.fighters[0];
          const inside = p.position.x > block.x0 && p.position.x < block.x1
            && p.position.z > block.z0 && p.position.z < block.z1;
          return {
            x: +p.position.x.toFixed(3), y: +p.position.y.toFixed(3), z: +p.position.z.toFixed(3),
            grounded: Boolean(p.isGrounded), inside
          };
        }, { block: skyloftCollisionProbe.block });
        await page.evaluate(() => { window.__browserSmashSpawnFighters(); window.__browserSmashStep(1 / 60); });
      }
    }
    let konohaStage = null;
    if (map.key === 'konoha_overlook') {
      konohaStage = await page.evaluate(() => {
        const THREE = window.__browserSmashThree;
        const group = window.__browserSmashAuthoredGroup;
        const village = group?.getObjectByName('konoha_village');
        const layout = window.__browserSmashLayout?.() || {};
        const clean = window.__browserSmashKonohaOverlook || null;
        const authored = [];
        group?.traverse?.(node => {
          if (node !== group && /^konoha_(?!village)/.test(node.name || '')) authored.push(node.name);
        });
        const villageBox = village ? (() => {
          const box = new THREE.Box3().setFromObject(village);
          return { min: box.min.toArray().map(v => +v.toFixed(2)), max: box.max.toArray().map(v => +v.toFixed(2)) };
        })() : null;
        const ray = new THREE.Raycaster();
        const probes = [
          ['spawn1', layout.spawns?.[0]?.x, layout.spawns?.[0]?.z],
          ['spawn2', layout.spawns?.[1]?.x, layout.spawns?.[1]?.z],
          ['nw', layout.bounds?.x0, layout.bounds?.z0],
          ['ne', layout.bounds?.x1, layout.bounds?.z0],
          ['sw', layout.bounds?.x0, layout.bounds?.z1],
          ['se', layout.bounds?.x1, layout.bounds?.z1]
        ];
        const hits = probes.map(([label, x, z]) => {
          const expected = typeof layout.heightAt === 'function' ? layout.heightAt(x, z) : layout.ground;
          ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
          const hit = ray.intersectObject(group, true)[0] || null;
          return {
            label, x, z, expected: +expected.toFixed(3),
            y: hit ? +hit.point.y.toFixed(3) : null,
            name: hit?.object?.name || null,
            material: hit?.object?.material?.name || null,
            solid: Boolean(hit) && Math.abs(hit.point.y - expected) < .2
              && hit.object?.name === 'konoha_village'
          };
        });
        return {
          villageBox, clean, authored,
          terrain: window.__browserSmashKonohaTerrain || null,
          terrainError: window.__browserSmashKonohaTerrainError || null,
          collision: window.__browserSmashKonohaCollision || null,
          collisionError: window.__browserSmashKonohaCollisionError || null,
          hits
        };
      });
    }
    let mariokartMerge = null;
    if (map.key === 'mariokart') {
      mariokartMerge = await page.evaluate(() => {
        const THREE = window.__browserSmashThree;
        const group = window.__browserSmashAuthoredGroup;
        const box = object => {
          const bounds = new THREE.Box3().setFromObject(object);
          return { min: bounds.min.toArray().map(v => +v.toFixed(2)), max: bounds.max.toArray().map(v => +v.toFixed(2)) };
        };
        const wuhu = group.getObjectByName('wuhu_island');
        const airport = group.getObjectByName('sunshine_airport');
        const wuhuBox = wuhu ? box(wuhu) : null;
        const airportBox = airport ? box(airport) : null;
        const overlap = wuhuBox && airportBox ? {
          x: Math.min(wuhuBox.max[0], airportBox.max[0]) - Math.max(wuhuBox.min[0], airportBox.min[0]),
          z: Math.min(wuhuBox.max[2], airportBox.max[2]) - Math.max(wuhuBox.min[2], airportBox.min[2])
        } : null;
        const layout = window.__browserSmashLayout?.() || {};
        const ray = new THREE.Raycaster();
        const probes = [
          ['spawn1', layout.spawns?.[0]?.x, layout.spawns?.[0]?.z],
          ['spawn2', layout.spawns?.[1]?.x, layout.spawns?.[1]?.z],
          ['nw', layout.bounds?.x0, layout.bounds?.z0],
          ['ne', layout.bounds?.x1, layout.bounds?.z0],
          ['sw', layout.bounds?.x0, layout.bounds?.z1],
          ['se', layout.bounds?.x1, layout.bounds?.z1]
        ];
        const ground = layout.ground;
        const hits = probes.map(([label, x, z]) => {
          const expected = typeof layout.heightAt === 'function' ? layout.heightAt(x, z) : ground;
          ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
          const hit = ray.intersectObject(group, true)[0] || null;
          const material = hit?.object?.material?.name || null;
          return {
            label, x, z, expected: +expected.toFixed(3),
            y: hit ? +hit.point.y.toFixed(3) : null,
            name: hit?.object?.name || null,
            material,
            solid: Boolean(hit) && Math.abs(hit.point.y - expected) < .2
              && !/sea|water|ocean|apron|runway|taxi/i.test(hit.object?.name || '')
              && !/sea|water|ocean/i.test(material || '')
          };
        });
        return {
          wuhuBox, airportBox, overlap,
          bridgeNames: ['mariokart_deck', 'mariokart_airport_causeway', 'mariokart_airport_base']
            .filter(name => Boolean(group.getObjectByName(name))),
          apron: Boolean(group.getObjectByName('mariokart_apron')),
          runway: Boolean(group.getObjectByName('mariokart_runway')),
          clean: window.__browserSmashMariokartApron || null,
          terrain: window.__browserSmashMariokartTerrain || null,
          terrainError: window.__browserSmashMariokartTerrainError || null,
          collision: window.__browserSmashMariokartCollision || null,
          collisionError: window.__browserSmashMariokartCollisionError || null,
          layoutBlocks: (layout.blocks || []).length,
          steepOnlyBlocks: (layout.blocks || []).filter(block => block.steep && !block.wall)
            .slice(0, 12).map(block => ({ ...block })),
          lowOnlyBlocks: (layout.blocks || []).filter(block => block.lowBoulder && !block.wall)
            .slice(0, 12).map(block => ({ ...block })),
          landBridge: group.getObjectByName('mariokart_land_bridge') ? (() => {
            const bridge = group.getObjectByName('mariokart_land_bridge');
            const box = new THREE.Box3().setFromObject(bridge);
            return { min: box.min.toArray().map(v => +v.toFixed(2)), max: box.max.toArray().map(v => +v.toFixed(2)) };
          })() : null,
          atollShelf: group.getObjectByName('mariokart_atoll_shelf') ? (() => {
            const shelf = group.getObjectByName('mariokart_atoll_shelf');
            const box = new THREE.Box3().setFromObject(shelf);
            return { min: box.min.toArray().map(v => +v.toFixed(2)), max: box.max.toArray().map(v => +v.toFixed(2)) };
          })() : null,
          layoutBounds: layout.bounds || null,
          bridgeSamples: [-22.2, -21.2, -20, -19].map(x => ({ x, z: -35.2, y: typeof layout.heightAt === 'function' ? +layout.heightAt(x, -35.2).toFixed(3) : null })),
          ground, hits
        };
      });
    }

    await page.evaluate(() => document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = 'hidden'; }));
    await page.screenshot({ path: `${out}/${map.key}.png` });
    await page.evaluate(() => document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = ''; }));

    let mariokartLowCollisionProbe = null;
    if (map.key === 'mariokart') {
      mariokartLowCollisionProbe = await page.evaluate(() => {
        const layout = window.__browserSmashLayout?.() || {};
        const blocks = (layout.blocks || []).filter(block => !block.wall
          && (block.lowBoulder || block.steep)
          && block.top != null && block.bottom != null && block.top - block.bottom > .2);
        const bounds = layout.bounds || {};
        const interior = block => block.x0 > (bounds.x0 ?? -45) + .8 && block.x1 < (bounds.x1 ?? -19) - .8
          && block.z0 > (bounds.z0 ?? -36) + .8 && block.z1 < (bounds.z1 ?? -10) - .8;
        const candidates = [
          ['lowBoulder', blocks.find(block => block.lowBoulder && interior(block))],
          ['steepFace', blocks.find(block => block.steep)]
        ];
        const probes = [];
        const p = window.fighters[0];
        window.__browserSmashFreezeAI = true;
        for (const [kind, block] of candidates) {
          if (!block) { probes.push({ kind, found: false }); continue; }
          const x = (block.x0 + block.x1) / 2;
          const z = (block.z0 + block.z1) / 2;
          const y = layout.ground ?? 0;
          p.position.set(x, y, z);
          p.velocity.set(0, 0, 0);
          p.isGrounded = true;
          // Settle the stage before reading the resolution; a single manual tick can be consumed
          // by the map's presentation hand-off after a previous arena has run.
          for (let i = 0; i < 6; i += 1) window.__browserSmashStep(1 / 60);
          const inside = p.position.x > block.x0 && p.position.x < block.x1
            && p.position.z > block.z0 && p.position.z < block.z1;
          probes.push({
            kind, found: true, block,
            start: { x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3) },
            after: {
              x: +p.position.x.toFixed(3), y: +p.position.y.toFixed(3), z: +p.position.z.toFixed(3),
              grounded: Boolean(p.isGrounded), inside
            }
          });
        }
        return { found: probes.every(probe => probe.found), blocks: blocks.length, probes };
      });
      if (mariokartLowCollisionProbe.found) {
        await page.evaluate(() => { window.__browserSmashSpawnFighters(); window.__browserSmashStep(1 / 60); });
      }
    }
    let mariokartCliffWalkProbe = null;
    if (map.key === 'mariokart') {
      mariokartCliffWalkProbe = await page.evaluate(() => {
        const THREE = window.__browserSmashThree;
        const layout = window.__browserSmashLayout?.() || {};
        const blocks = layout.blocks || [];
        const bounds = layout.bounds || {};
        const x0 = bounds.x0 ?? -45, x1 = bounds.x1 ?? -19;
        const z0 = bounds.z0 ?? -36, z1 = bounds.z1 ?? -10;
        const margin = .75;
        const inside = (x, z, block, pad = 0) => block.r != null
          ? Math.hypot(x - block.x, z - block.z) < block.r + pad
          : x > block.x0 - pad && x < block.x1 + pad && z > block.z0 - pad && z < block.z1 + pad;
        const clearPoint = (x, z, pad = margin) => !blocks.some(block => inside(x, z, block, pad));
        const clearSegment = (a, b) => {
          const length = Math.hypot(b.x - a.x, b.z - a.z);
          const steps = Math.max(2, Math.ceil(length / .2));
          for (let i = 0; i <= steps; i += 1) {
            const t = i / steps;
            if (!clearPoint(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
          }
          return true;
        };
        const route = [];
        for (const block of blocks) {
          if (block.r != null || !(block.wall || block.steep)
            || block.top == null || block.bottom == null || block.top - block.bottom < 1.2) continue;
          // Route around one end of the cliff and into the open grass on its far side. Check both
          // ends and both directions; the Wuhu cliffs are stair-stepped, so a west-only plan can
          // be blocked by the next terrace even when the cliff itself has a clear corner.
          const zMid = (block.z0 + block.z1) / 2;
          for (const direction of [1, -1]) {
            const sideZ = direction > 0 ? block.z1 + 1.4 : block.z0 - 1.4;
            for (const side of [-1, 1]) {
              const sideX = side < 0 ? block.x0 - 1.4 : block.x1 + 1.4;
              const farX = side < 0 ? block.x0 + 1.4 : block.x1 - 1.4;
              const start = { x: sideX, z: zMid };
              const corner = { x: sideX, z: sideZ };
              const end = { x: farX, z: sideZ };
              if (start.x < x0 + margin || start.x > x1 - margin
                || start.z < z0 + margin || start.z > z1 - margin
                || corner.z < z0 + margin || corner.z > z1 - margin
                || end.x < x0 + margin || end.x > x1 - margin
                || end.z < z0 + margin || end.z > z1 - margin) continue;
              if (!clearPoint(start.x, start.z) || !clearPoint(corner.x, corner.z) || !clearPoint(end.x, end.z)) continue;
              if (!clearSegment(start, corner) || !clearSegment(corner, end)) continue;
              if (typeof layout.heightAt === 'function'
                && [start, corner, end].some(point => !Number.isFinite(layout.heightAt(point.x, point.z)))) continue;
              route.push({ block, start, corner, end });
            }
          }
        }
        if (!route.length) {
          // The stair-stepped cliff rows make generic rectangular offsets intersect the next
          // terrace. Use a checked path around the southeast corner of the 3.8 m cliff block at
          // x -39.75..-32.25, z -28.5..-27.75; the grid path keeps the body outside every baked
          // collider while ending in the open grass south of the cliff.
          // Collision cells are rasterised from the current bounds, so the block's exact southern
          // edge can move when the playable rectangle grows. Match the intended cliff by its stable
          // west/east footprint, then use the checked path south of it.
          const fixedBlock = blocks.find(block => block.wall
            && Math.abs(block.x0 + 39.75) <= .01
            && Math.abs(block.x1 + 32.25) <= .01
            && block.z0 >= -29.5 && block.z1 <= -27);
          const fixedPath = [
            { x: -31.5, z: -29.75 }, { x: -31.75, z: -30 }, { x: -32, z: -30 },
            { x: -32.25, z: -30.25 }, { x: -32.5, z: -30.5 }, { x: -32.75, z: -30.75 },
            { x: -33, z: -31 }, { x: -33.25, z: -31.25 }, { x: -33.5, z: -31.25 },
            { x: -33.75, z: -31.5 }, { x: -34, z: -31.5 }, { x: -34.25, z: -31.5 },
            { x: -34.5, z: -31.75 }
          ];
          if (fixedBlock && fixedPath.every(point => clearPoint(point.x, point.z))) {
            route.push({
              block: fixedBlock, start: fixedPath[0], corner: fixedPath[1],
              end: fixedPath[fixedPath.length - 1], waypoints: fixedPath.slice(1)
            });
          }
          if (!route.length) {
            const blockedPath = fixedBlock ? fixedPath.map((point, index) => ({
              index, x: point.x, z: point.z,
              blockers: blocks.filter(block => inside(point.x, point.z, block, margin)).slice(0, 4)
            })) : [];
            return {
              found: false, blocks: blocks.length, reason: 'no clear cliff route',
              fixedBlock: fixedBlock || null,
              fixedPathBlocked: blockedPath.filter(point => point.blockers.length),
              near: blocks.filter(block => block.x1 > -40 && block.x0 < -30
                && block.z1 > -33 && block.z0 < -27).slice(0, 12)
            };
          }
        }
        if (!route.length) return { found: false, blocks: blocks.length, reason: 'no clear cliff route' };
        const chosen = route[0];
        const p = window.fighters[0];
        const camera = window.__browserSmashCamera;
        const keys = window.__browserSmashInput.keys;
        const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
        const clearKeys = () => movementKeys.forEach(key => { keys[key] = false; });
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();
        const comboFor = (dx, dz) => {
          camera.getWorldDirection(forward);
          forward.y = 0;
          if (forward.lengthSq() < 1e-6) return ['KeyW'];
          forward.normalize();
          right.set(-forward.z, 0, forward.x);
          let best = { score: -Infinity, keys: ['KeyW'] };
          for (const [u, r] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const vx = forward.x * u + right.x * r;
            const vz = forward.z * u + right.z * r;
            const len = Math.hypot(vx, vz) || 1;
            const score = (vx * dx + vz * dz) / len;
            if (score > best.score) {
              const next = [];
              if (u > 0) next.push('KeyW'); else if (u < 0) next.push('KeyS');
              if (r > 0) next.push('KeyD'); else if (r < 0) next.push('KeyA');
              best = { score, keys: next };
            }
          }
          return best.keys;
        };
        window.__browserSmashFreezeAI = true;
        p.position.set(chosen.start.x, typeof layout.heightAt === 'function'
          ? layout.heightAt(chosen.start.x, chosen.start.z) : (layout.ground ?? 0), chosen.start.z);
        p.velocity.set(0, 0, 0);
        p.isGrounded = true;
        const waypoints = chosen.waypoints || [chosen.corner, chosen.end];
        let reached = 0;
        let frames = 0;
        let stationary = 0;
        let lastX = p.position.x;
        let lastZ = p.position.z;
        const path = [];
        while (reached < waypoints.length && frames < 480) {
          const target = waypoints[reached];
          const dx = target.x - p.position.x;
          const dz = target.z - p.position.z;
          if (Math.hypot(dx, dz) < .5) { reached += 1; continue; }
          clearKeys();
          comboFor(dx, dz).forEach(key => { keys[key] = true; });
          window.__browserSmashStep(1 / 60);
          frames += 1;
          const moved = Math.hypot(p.position.x - lastX, p.position.z - lastZ);
          lastX = p.position.x;
          lastZ = p.position.z;
          if (frames > 12 && moved < .004) stationary += 1; else stationary = 0;
          if (frames % 30 === 0) path.push({ x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(3), z: +p.position.z.toFixed(2), reached });
          if (stationary > 45) break;
        }
        clearKeys();
        const finalPoint = { x: p.position.x, y: p.position.y, z: p.position.z };
        const finalInside = blocks.some(block => inside(finalPoint.x, finalPoint.z, block, 0));
        return {
          found: true, blocks: blocks.length, routeCount: route.length,
          block: chosen.block, start: chosen.start, corner: chosen.corner, end: chosen.end,
          waypointCount: waypoints.length, reached, frames, stationary,
          final: { x: +finalPoint.x.toFixed(3), y: +finalPoint.y.toFixed(3), z: +finalPoint.z.toFixed(3) },
          finalInside, finalOpen: !blocks.some(block => inside(finalPoint.x, finalPoint.z, block, .35)),
          grounded: Boolean(p.isGrounded), path
        };
      });
    }
    let mariokartBridgeWalk = null;
    if (map.key === 'mariokart') {
      // A real keyboard walk from Wuhu's west shore across the authored land bridge. The target
      // is just east of the bridge endpoint (x -19), on the airport side of the rim. Keyboard
      // events travel through the normal InputManager path; only the game clock is stepped.
      mariokartBridgeWalk = await page.evaluate(() => {
        const THREE = window.__browserSmashThree;
        const layout = window.__browserSmashLayout?.() || {};
        const group = window.__browserSmashAuthoredGroup;
        const p = window.fighters[0];
        const heightAt = (x, z) => typeof layout.heightAt === 'function' ? layout.heightAt(x, z) : (layout.ground ?? 0);
        const surfaceAt = (x, z) => {
          const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
          const hit = ray.intersectObject(group, true)[0] || null;
          return hit ? {
            name: hit.object.name || null, material: hit.object.material?.name || null,
            y: +hit.point.y.toFixed(3)
          } : null;
        };
        const blocks = layout.blocks || [];
        const inside = (x, z, block, pad = 0) => block.r != null
          ? Math.hypot(x - block.x, z - block.z) < block.r + pad
          : x > block.x0 - pad && x < block.x1 + pad && z > block.z0 - pad && z < block.z1 + pad;
        const clearAt = (x, z) => !blocks.some(block => inside(x, z, block, .55));
        const sea = hit => /sea|water|ocean/i.test(hit?.name || '') || /sea|water|ocean/i.test(hit?.material || '');
        const clearPath = (a, b) => {
          const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .25));
          for (let i = 0; i <= steps; i += 1) {
            const t = i / steps;
            const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
            if (!clearAt(x, z) || !Number.isFinite(heightAt(x, z))) return false;
          }
          return true;
        };
        // Find a clear west-shore approach and an airport-side landing across the bridge. The
        // bridge is narrow, so probe a few lateral offsets instead of assuming one row works for
        // every source-mesh edge and collision bake.
        const candidates = [];
        for (let z = -36.4; z <= -33.6; z += .35) {
          const starts = [];
          const targets = [];
          for (let x = -23.75; x <= -22.45; x += .25) starts.push({ x, z });
          for (let x = -18.8; x <= -18.2; x += .2) targets.push({ x, z });
          for (const start of starts) {
            const startGround = heightAt(start.x, start.z);
            const startSurface = surfaceAt(start.x, start.z);
            if (!Number.isFinite(startGround) || !clearAt(start.x, start.z)
              || !startSurface || sea(startSurface) || Math.abs(startSurface.y - startGround) > .4) continue;
            for (const target of targets) {
              const targetGround = heightAt(target.x, target.z);
              const targetSurface = surfaceAt(target.x, target.z);
              const bridgeSurface = surfaceAt(-20.5, target.z);
              if (!Number.isFinite(targetGround) || !clearAt(target.x, target.z)
                || !targetSurface || sea(targetSurface) || Math.abs(targetSurface.y - targetGround) > .4
                || !bridgeSurface || sea(bridgeSurface)
                || !clearPath(start, target)) continue;
              candidates.push({
                start: { ...start, y: +startGround.toFixed(3) }, target: { ...target, y: +targetGround.toFixed(3) },
                startSurface, targetSurface, bridgeSurface
              });
            }
            if (candidates.length) break;
          }
          if (candidates.length) break;
        }
        if (!candidates.length) {
          const debug = [];
          for (let z = -36.4; z <= -33.6; z += .35) {
            const start = { x: -23, z };
            const target = { x: -18.5, z };
            const startGround = heightAt(start.x, start.z);
            const startSurface = surfaceAt(start.x, start.z);
            const targetGround = heightAt(target.x, target.z);
            const targetSurface = surfaceAt(target.x, target.z);
            debug.push({
              z: +z.toFixed(2), startGround: +startGround.toFixed(3), startSurface,
              startClear: clearAt(start.x, start.z), targetGround: +targetGround.toFixed(3), targetSurface,
              targetClear: clearAt(target.x, target.z), pathClear: clearPath(start, target),
              startBlockers: blocks.filter(block => inside(start.x, start.z, block, .55)).slice(0, 3),
              targetBlockers: blocks.filter(block => inside(target.x, target.z, block, .55)).slice(0, 3)
            });
          }
          return {
            found: false, reason: 'no clear bridge approach', blocks: blocks.length, debug,
            near: blocks.filter(block => block.x1 > -24 && block.x0 < -18 && block.z1 > -37 && block.z0 < -33)
              .slice(0, 20)
          };
        }
        const chosen = candidates[0];
        const start = chosen.start;
        const target = chosen.target;
        window.__browserSmashFreezeAI = true;
        const keys = window.__browserSmashInput.keys;
        for (const code of Object.keys(keys)) keys[code] = false;
        p.position.set(start.x, start.y, start.z);
        p.velocity.set(0, 0, 0);
        p.isGrounded = true;
        p.hitstun = 0;
        return {
          found: true, start, target,
          startSurface: chosen.startSurface, bridgeSurface: chosen.bridgeSurface,
          targetSurface: chosen.targetSurface, startClear: clearAt(start.x, start.z),
          targetClear: clearAt(target.x, target.z), candidates: candidates.slice(0, 6), path: []
        };
      });
      if (mariokartBridgeWalk.found) {
        const held = [];
        const releaseHeld = async () => {
          for (const key of held.splice(0)) await page.keyboard.up(key);
        };
        for (let chunk = 0; chunk < 12; chunk += 1) {
          const command = await page.evaluate(({ target }) => {
            const THREE = window.__browserSmashThree;
            const camera = window.__browserSmashCamera;
            const p = window.fighters[0];
            const dx = target.x - p.position.x;
            const dz = target.z - p.position.z;
            const forward = new THREE.Vector3();
            const right = new THREE.Vector3();
            camera.getWorldDirection(forward);
            forward.y = 0;
            if (forward.lengthSq() < 1e-6) return { keys: ['KeyW'], x: p.position.x, z: p.position.z };
            forward.normalize();
            right.set(-forward.z, 0, forward.x);
            let best = { score: -Infinity, keys: ['KeyW'] };
            for (const [u, r] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
              const vx = forward.x * u + right.x * r;
              const vz = forward.z * u + right.z * r;
              const score = (vx * dx + vz * dz) / (Math.hypot(vx, vz) || 1);
              if (score > best.score) {
                const next = [];
                if (u > 0) next.push('KeyW'); else if (u < 0) next.push('KeyS');
                if (r > 0) next.push('KeyD'); else if (r < 0) next.push('KeyA');
                best = { score, keys: next };
              }
            }
            return { keys: best.keys, x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2) };
          }, { target: mariokartBridgeWalk.target });
          await releaseHeld();
          for (const code of command.keys) {
            const key = code.replace(/^Key/, '').toLowerCase();
            held.push(key);
            await page.keyboard.down(key);
          }
          await page.evaluate(() => { for (let i = 0; i < 10; i += 1) window.__browserSmashStep(1 / 60); });
          const sample = await page.evaluate(() => {
            const layout = window.__browserSmashLayout?.() || {};
            const p = window.fighters[0];
            return {
              x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(3), z: +p.position.z.toFixed(2),
              grounded: Boolean(p.isGrounded),
              expected: typeof layout.heightAt === 'function' ? +layout.heightAt(p.position.x, p.position.z).toFixed(3) : null
            };
          });
          mariokartBridgeWalk.path.push(sample);
          if (sample.x >= mariokartBridgeWalk.target.x - .2) break;
        }
        await releaseHeld();
        mariokartBridgeWalk.final = await page.evaluate(() => {
          const THREE = window.__browserSmashThree;
          const layout = window.__browserSmashLayout?.() || {};
          const group = window.__browserSmashAuthoredGroup;
          const p = window.fighters[0];
          const blocks = layout.blocks || [];
          const inside = (x, z, block, pad = 0) => block.r != null
            ? Math.hypot(x - block.x, z - block.z) < block.r + pad
            : x > block.x0 - pad && x < block.x1 + pad && z > block.z0 - pad && z < block.z1 + pad;
          const surface = (() => {
            const ray = new THREE.Raycaster(new THREE.Vector3(p.position.x, 100, p.position.z), new THREE.Vector3(0, -1, 0));
            const hit = ray.intersectObject(group, true)[0] || null;
            return hit ? { name: hit.object.name || null, material: hit.object.material?.name || null } : null;
          })();
          return {
            x: +p.position.x.toFixed(3), y: +p.position.y.toFixed(3), z: +p.position.z.toFixed(3),
            expected: typeof layout.heightAt === 'function' ? +layout.heightAt(p.position.x, p.position.z).toFixed(3) : null,
            grounded: Boolean(p.isGrounded), surface,
            inside: blocks.some(block => inside(p.position.x, p.position.z, block))
          };
        });
        await page.evaluate(() => { window.__browserSmashSpawnFighters(); window.__browserSmashStep(1 / 60); });
      }
    }
    let mariokartCollisionProbe = null;
    if (map.key === 'mariokart') {
      // Place a fighter just inside a generated Wuhu cliff/rock block and advance the live game
      // step. The stage camera is diagonal in this layout, so a keyboard walk can slide around the
      // narrow cliff cells; the block probe still exercises the real resolveArenaCollision pass.
      mariokartCollisionProbe = await page.evaluate(() => {
        const layout = window.__browserSmashLayout?.() || {};
        const bounds = layout.bounds || {};
        const blocks = (layout.blocks || []).filter(block => !block.r
          && block.top != null && (block.top - (block.bottom ?? 0)) > 1.2
          && (block.x1 - block.x0) >= .7 && (block.z1 - block.z0) >= .7);
        const inside = (x, z, block) => !block.r && x > block.x0 && x < block.x1 && z > block.z0 && z < block.z1;
        const candidate = blocks.find(block => {
          const sx = block.x0 + .1;
          const sz = (block.z0 + block.z1) / 2;
          const approach = typeof layout.heightAt === 'function' ? layout.heightAt(sx, sz) : (layout.ground ?? 0);
          return sx > (bounds.x0 ?? -45) + .3 && sx < (bounds.x1 ?? -23) - .3
            && sz > (bounds.z0 ?? -26) + .3 && sz < (bounds.z1 ?? -8) - .3
            && block.top > approach + 1.2;
        });
        if (!candidate) return { found: false, blocks: blocks.length };
        const sz = (candidate.z0 + candidate.z1) / 2;
        const sx = candidate.x0 + .1;
        const sy = typeof layout.heightAt === 'function' ? layout.heightAt(sx, sz) : (layout.ground ?? 0);
        const p1 = window.fighters[0];
        window.__browserSmashFreezeAI = true;
        p1.position.set(sx, sy, sz);
        p1.velocity.set(0, 0, 0);
        p1.isGrounded = true;
        p1.facing = 1;
        return {
          found: true,
          blocks: blocks.length,
          block: candidate,
          start: { x: +sx.toFixed(3), y: +sy.toFixed(3), z: +sz.toFixed(3) }
        };
      });
      if (mariokartCollisionProbe.found) {
        await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__browserSmashStep(1 / 60); });
        mariokartCollisionProbe.after = await page.evaluate(({ block }) => {
          const p = window.fighters[0];
          const inside = p.position.x > block.x0 && p.position.x < block.x1
            && p.position.z > block.z0 && p.position.z < block.z1;
          return {
            x: +p.position.x.toFixed(3), y: +p.position.y.toFixed(3), z: +p.position.z.toFixed(3),
            grounded: Boolean(p.isGrounded), inside
          };
        }, { block: mariokartCollisionProbe.block });
        await page.evaluate(() => { window.__browserSmashSpawnFighters(); window.__browserSmashStep(1 / 60); });
      }
    }

    check(`${map.label}: selectable in both map pickers`, state.optionCount === 1 && state.menuOptionCount === 1, `${state.optionCount}/${state.menuOptionCount}`);
    check(`${map.label}: the authored GLB mounted`, state.asset?.status === 'loaded', JSON.stringify(state.asset));
    check(`${map.label}: mesh count matches the assembled asset`, (state.asset?.meshCount ?? 0) >= map.minMeshes && (state.asset?.meshCount ?? 0) <= map.maxMeshes, String(state.asset?.meshCount));
    check(`${map.label}: map selection resolved to the requested key`, state.selected === map.key && state.arena === map.key, `${state.selected}/${state.arena}`);
    check(`${map.label}: both fighters spawn grounded on the stage surface`,
      spawnState.fighters.every(f => f.grounded && Math.abs(f.y - (f.expectedGround ?? spawnState.ground ?? 0)) < 0.08),
      JSON.stringify(spawnState.fighters) + ' ground=' + spawnState.ground);
    check(`${map.label}: both fighters are visible`, state.fighters.every(f => f.visible), JSON.stringify(state.fighters.map(f => f.visible)));
    check(`${map.label}: camera is outside solid geometry`, state.camera?.inside === false, JSON.stringify(state.camera));
    if (state.skyloftCollision || state.skyloftCollisionError) {
      const collision = state.skyloftCollision;
      check(`${map.label}: authored buildings, rails and props contribute colliders`,
        Boolean(collision) && collision.blocks > 0 && collision.wallTriangles > 0 && collision.namedProps > 0 && !state.skyloftCollisionError,
        JSON.stringify({ collision, error: state.skyloftCollisionError }));
      check(`${map.label}: the flat plaza slab and joint grid are removed`,
        Boolean(state.skyloftDeck?.plazaRemoved) && state.skyloftDeck?.jointsRemoved > 0 && !state.skyloftPlazaStillPresent,
        JSON.stringify({ deck: state.skyloftDeck, plazaStillPresent: state.skyloftPlazaStillPresent }));
      const propCoverage = await page.evaluate(() => {
        const THREE = window.__browserSmashThree;
        const group = window.__browserSmashAuthoredGroup;
        const layout = window.__browserSmashLayout?.() || {};
        const blocks = layout.blocks || [];
        const re = /(?:^|_)(?:rail|post|banner|brazier)(?:_|$)/i;
        const b = layout.bounds || {};
        const inside = [];
        group?.traverse?.(node => {
          if (!node.isMesh || !re.test(node.name || '')) return;
          const box = new THREE.Box3().setFromObject(node);
          const cx = (box.min.x + box.max.x) / 2;
          const cz = (box.min.z + box.max.z) / 2;
          if (cx <= b.x0 || cx >= b.x1 || cz <= b.z0 || cz >= b.z1) return;
          const covered = blocks.some(block => block.r == null
            && cx >= block.x0 && cx <= block.x1 && cz >= block.z0 && cz <= block.z1
            && block.top >= box.max.y - .2);
          inside.push({ name: node.name, x: +cx.toFixed(2), z: +cz.toFixed(2), top: +box.max.y.toFixed(2), covered });
        });
        return inside;
      });
      check(`${map.label}: every in-bounds named prop has a collider`,
        propCoverage.length > 0 && propCoverage.every(prop => prop.covered),
        JSON.stringify(propCoverage));
    }
    if (skyloftTerrain) {
      const terrain = skyloftTerrain;
      const heights = terrain.samples.map(sample => sample.h).filter(Number.isFinite);
      check(`${map.label}: the imported island baked a terrain heightfield`,
        Boolean(terrain.info?.samples) && terrain.info.samples > 1000 && !terrain.error,
        JSON.stringify({ info: terrain.info, error: terrain.error }));
      check(`${map.label}: the island surface rises above the authored plaza`,
        heights.length >= 4 && Math.max(...heights) > (terrain.ground ?? 0) + .5,
        JSON.stringify(terrain.samples));
      check(`${map.label}: a fighter grounded on the raised island, not the flat deck`,
        terrain.fighter.grounded && Math.abs(terrain.fighter.y - terrain.fighter.expected) < .05 && terrain.fighter.y > (terrain.ground ?? 0) + .5,
        JSON.stringify(terrain.fighter));
      check(`${map.label}: a walked-into authored wall stops the fighter`,
        skyloftCollisionProbe?.found && skyloftCollisionProbe.after && !skyloftCollisionProbe.after.inside
          && skyloftCollisionProbe.after.x <= skyloftCollisionProbe.block.x0 + .35,
        JSON.stringify(skyloftCollisionProbe));
      check(`${map.label}: walking follows the island slope`,
        terrain.walkEnd?.grounded && Math.abs(terrain.walkEnd.y - terrain.walkEnd.expected) < .05
          && Math.abs(terrain.walkEnd.y - terrain.walkStart?.y) > .2,
        JSON.stringify({ start: terrain.walkStart, end: terrain.walkEnd }));
    }
    if (konohaStage) {
      const clean = state.konohaCleanup || konohaStage.clean;
      check(`${map.label}: the authored overlook is absent from the rebuilt source`,
        clean?.removedCount === 0 && clean?.villageRetained && clean?.markerRetained
          && konohaStage.authored.length === 0 && !state.konohaDeckStillPresent && !state.konohaBridgeStillPresent
          && state.konohaVillagePresent,
        JSON.stringify({ clean, authored: konohaStage.authored, deck: state.konohaDeckStillPresent, bridge: state.konohaBridgeStillPresent, village: state.konohaVillagePresent }));
      check(`${map.label}: the imported village terrain baked a walkable heightfield`,
        Boolean(konohaStage.terrain?.samples) && konohaStage.terrain.samples >= 100
          && konohaStage.terrain.valid >= konohaStage.terrain.samples * .8
          && !konohaStage.terrainError,
        JSON.stringify({ terrain: konohaStage.terrain, error: konohaStage.terrainError }));
      check(`${map.label}: imported walls contribute collision`,
        Boolean(konohaStage.collision) && konohaStage.collision.blocks > 0 && konohaStage.collision.wallTriangles > 0
          && !konohaStage.collisionError,
        JSON.stringify({ collision: konohaStage.collision, error: konohaStage.collisionError }));
      check(`${map.label}: solid village ground is under both spawns and every arena corner`,
        konohaStage.hits.every(hit => hit.solid),
        JSON.stringify(konohaStage.hits));
    }
    if (mariokartMerge) {
      check(`${map.label}: the two imported lands physically overlap`,
        (mariokartMerge.overlap?.x ?? 0) > 1 && (mariokartMerge.overlap?.z ?? 0) > 1,
        JSON.stringify({ wuhu: mariokartMerge.wuhuBox, airport: mariokartMerge.airportBox, overlap: mariokartMerge.overlap }));
      check(`${map.label}: the procedural bridge and causeway are gone`,
        mariokartMerge.bridgeNames.length === 0,
        JSON.stringify(mariokartMerge.bridgeNames));
      check(`${map.label}: the reclaimed apron and runway are removed`,
        !mariokartMerge.apron && !mariokartMerge.runway
          && mariokartMerge.clean?.apronRemoved && mariokartMerge.clean?.runwayRemoved
          && mariokartMerge.clean?.removedCount >= 25,
        JSON.stringify({ apron: mariokartMerge.apron, runway: mariokartMerge.runway, clean: mariokartMerge.clean }));
      check(`${map.label}: Wuhu's natural terrain baked a walkable heightfield`,
        Boolean(mariokartMerge.terrain?.samples) && mariokartMerge.terrain.samples >= 50
          && mariokartMerge.terrain.valid >= mariokartMerge.terrain.samples * .8
          && !mariokartMerge.terrainError,
        JSON.stringify({ terrain: mariokartMerge.terrain, error: mariokartMerge.terrainError }));
      check(`${map.label}: solid natural ground is under both spawns and every arena corner`,
        mariokartMerge.hits.every(hit => hit.solid),
        JSON.stringify(mariokartMerge.hits));
      check(`${map.label}: the playable rectangle extends beyond the airport's western rim`,
        (mariokartMerge.layoutBounds?.x1 ?? -19) > -19
          && Boolean(mariokartMerge.atollShelf)
          && mariokartMerge.hits.filter(hit => hit.label === 'ne' || hit.label === 'se')
            .every(hit => hit.solid && hit.name === 'mariokart_atoll_shelf_top'),
        JSON.stringify({ bounds: mariokartMerge.layoutBounds, shelf: mariokartMerge.atollShelf,
          eastHits: mariokartMerge.hits.filter(hit => hit.label === 'ne' || hit.label === 'se') }));
      check(`${map.label}: Wuhu's cliffs and rocks contribute collision`,
        Boolean(mariokartMerge.collision) && mariokartMerge.collision.blocks > 0
          && mariokartMerge.collision.wallTriangles > 0 && mariokartMerge.layoutBlocks > 0
          && !mariokartMerge.collisionError,
        JSON.stringify({ collision: mariokartMerge.collision, layoutBlocks: mariokartMerge.layoutBlocks, error: mariokartMerge.collisionError }));
      check(`${map.label}: a solid Wuhu cliff or rock block pushes the fighter out`,
        mariokartCollisionProbe?.found && mariokartCollisionProbe.after && !mariokartCollisionProbe.after.inside
          && mariokartCollisionProbe.after.x <= mariokartCollisionProbe.block.x0 + .35,
        JSON.stringify(mariokartCollisionProbe));
      check(`${map.label}: a fighter can walk around a Wuhu cliff into open grass without getting stuck`,
        mariokartCliffWalkProbe?.found
          && mariokartCliffWalkProbe.reached === mariokartCliffWalkProbe.waypointCount
          && mariokartCliffWalkProbe.finalOpen && !mariokartCliffWalkProbe.finalInside
          && mariokartCliffWalkProbe.grounded && mariokartCliffWalkProbe.stationary <= 45,
        JSON.stringify(mariokartCliffWalkProbe));
      check(`${map.label}: low boulders and steep faces contribute solid blocks`,
        (mariokartMerge.collision?.steepTriangles ?? 0) > 0
          && (mariokartMerge.collision?.lowTriangles ?? 0) > 0
          && (mariokartMerge.collision?.newSteepCells ?? 0) > 0
          && (mariokartMerge.collision?.newLowCells ?? 0) > 0
          && (mariokartMerge.collision?.steepBlocks ?? 0) > 0
          && (mariokartMerge.collision?.lowBoulderBlocks ?? 0) > 0,
        JSON.stringify(mariokartMerge.collision));
      check(`${map.label}: low-boulder and steep-face blocks push a fighter out`,
        mariokartLowCollisionProbe?.found
          && mariokartLowCollisionProbe.probes.every(probe => probe.found && probe.after && !probe.after.inside),
        JSON.stringify(mariokartLowCollisionProbe));
      check(`${map.label}: the natural land bridge joins Wuhu to the airport ledge`,
        Boolean(mariokartMerge.landBridge)
          && mariokartMerge.bridgeSamples.every(sample => Number.isFinite(sample.y))
          && mariokartMerge.bridgeSamples[3].y > mariokartMerge.bridgeSamples[0].y + .5,
        JSON.stringify({ bridge: mariokartMerge.landBridge, samples: mariokartMerge.bridgeSamples }));
      const bridgeWalk = mariokartBridgeWalk;
      const bridgeWalkSurface = bridgeWalk?.final?.surface;
      const bridgeWalkCrossedBridge = Boolean(bridgeWalk?.path?.some(sample => sample.x > -22.2 && sample.x < -19));
      check(`${map.label}: a live keyboard walk crosses the Wuhu-airport land bridge to the rim`,
        bridgeWalk?.found && bridgeWalk.startClear && bridgeWalk.targetClear
          && bridgeWalkCrossedBridge
          && bridgeWalk.bridgeSurface && !/sea|water|ocean/i.test(bridgeWalk.bridgeSurface.name || bridgeWalk.bridgeSurface.material || '')
          && bridgeWalk.final?.x >= -19
          && bridgeWalk.final.x > bridgeWalk.start.x + 3
          && bridgeWalk.final.grounded
          && Math.abs(bridgeWalk.final.y - bridgeWalk.final.expected) < .15
          && !bridgeWalk.final.inside
          && bridgeWalkSurface && !/sea|water|ocean/i.test(bridgeWalkSurface.name || bridgeWalkSurface.material || ''),
        JSON.stringify(bridgeWalk));
    }
    check(`${map.label}: no uncaught page errors`, pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
    report.push({ map, state, skyloftCollisionProbe, konohaStage, mariokartMerge, mariokartCollisionProbe, mariokartLowCollisionProbe, mariokartCliffWalkProbe, mariokartBridgeWalk, pageErrors, consoleErrors });
    console.log(`  captured ${out}/${map.key}.png`);
    await page.close();
  }

  // Death Star must remain out of the active game: no option, no runtime key, no source asset.
  if (process.env.ONLY_MAP) { console.log('Skipping Death Star check for focused run.'); }
  const page = process.env.ONLY_MAP ? null : await browser.newPage({ viewport: { width: 800, height: 600 } });
  let deathStar = null;
  if (page) {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__browserSmashMatch && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
    deathStar = await page.evaluate(() => ({
      options: document.querySelectorAll('#mapSelect option[value="deathstar"], #menuMapSelect option[value="deathstar"]').length,
      runtimeKey: Boolean(window.__browserSmashSelect?.state?.arena === 'deathstar'),
      bodyText: /death star|deathstar/i.test(document.body.innerText)
    }));
    check('Death Star has no map option and no runtime presence', deathStar.options === 0 && deathStar.runtimeKey === false, JSON.stringify(deathStar));
    await page.close();
  }
  await writeFile(`${out}/report.json`, JSON.stringify({ maps: report, deathStar, pageErrors: report.flatMap(r => r.pageErrors) }, null, 2));
} finally {
  await browser.close();
  server.close();
}
console.log(failures === 0 ? '\nEnvironment arena acceptance passed.' : `\nEnvironment arena acceptance FAILED (${failures}).`);
process.exitCode = failures === 0 ? 0 : 1;
