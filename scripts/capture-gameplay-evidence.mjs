// Phase 22.2 gameplay evidence: the real match, the real shipped models, real trigger states.
//
//   bash scripts/run-browser-test.sh scripts/capture-gameplay-evidence.mjs --only=thor,naruto_uzumaki
//   bash scripts/run-browser-test.sh scripts/capture-gameplay-evidence.mjs --all
//
// A state is only written when the simulation actually reports it (grounded/speed/attack pose/
// hitstun...). If a state cannot be triggered the run records `unverified` and writes no image for
// it, rather than labelling a pose it did not produce. Victory is produced by landing real hits
// until the match ends; nothing here sets `percent` or the result label.
//
// The match is started in local 2P mode so the opponent is inert (no CPU reacting), and the second
// player's own attack key (",") is used to produce a genuine hit reaction on the fighter under
// test. Positioning the two fighters is test setup; the hit, hitstun, damage and knockback are the
// game's.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const argv = process.argv.slice(2);
const flag = name => {
  const hit = argv.find(arg => arg.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};
const outDir = resolve(root, 'artifacts/phase22-2/gameplay');
await mkdir(outDir, { recursive: true });

const PILOTS = ['thor', 'wonder_woman', 'aquaman', 'green_lantern_hal_jordan',
  'doctor_strange', 'iron_man_tony_stark', 'naruto_uzumaki', 'edward_elric'];
const requested = flag('only')?.split(',').map(s => s.trim()).filter(Boolean)
  || (argv.includes('--all') ? PILOTS : PILOTS);
const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    // Read before writing headers: a 404 must not follow a 200 that was already sent.
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const report = { phase: '22.2', fighters: [], pageErrors: [] };
const launch = () => chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});

for (const slug of requested) {
  let browser;
  try {
    browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(180_000);
    page.on('pageerror', error => report.pageErrors.push(`${slug}: ${String(error.message || error)}`));
    // Three.js from node_modules, so the run does not depend on a CDN.
    await page.route('https://unpkg.com/three@0.152.2/**', async route => {
      const url = new URL(route.request().url());
      const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
      try {
        await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
          headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
      } catch { await route.fulfill({ status: 404, body: 'missing' }); }
    });
    const dir = resolve(outDir, slug);
    await mkdir(dir, { recursive: true });
    const entry = { slug, states: [], unverified: [], equipment: null, status: 'complete' };
    try {
      await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
        && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
        null, { timeout: 120_000, polling: 200 });

      const launch = await page.evaluate(() => (window.characterRosters?.launch || []).map(([name]) => name));
      const label = launch.find(name => slugOf(name) === slug);
      if (!label) throw new Error(`"${slug}" is not in the launch roster`);
      entry.label = label;

      // Local 2P: the opponent never acts on its own, so every captured reaction is the one the
      // inputs produced. P1 is the fighter under test.
      await page.evaluate(({ label }) => {
        window.__browserSmashSelect.setMode('2p');
        document.querySelector('#selectScreen .bs-card[data-fighter="' + CSS.escape(label) + '"]')?.click();
        const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
        const other = cards.find(card => card.dataset.fighter !== label);
        other?.click();
      }, { label });
      await page.click('#selectScreen [data-nav="next"]');
      await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
      await page.click('#play');
      await page.evaluate(() => window.__browserSmashStep(0.1));

      const state = () => page.evaluate(() => {
        const [p1, p2] = window.fighters;
        const speed = Math.hypot(p1.velocity.x, p1.velocity.z);
        return {
          identity: p1.identity, speed: +speed.toFixed(3), y: +p1.position.y.toFixed(3),
          grounded: !!p1.isGrounded, percent: +p1.percent.toFixed(1), hitstun: +(p1.hitstun || 0).toFixed(3),
          guard: !!p1.guardHeld, pose: +(p1.attackPose || 0).toFixed(3),
          queue: (p1.attackQueue || []).map(a => a.label || a.type || 'attack'),
          specialCooldown: +(p1.specialCooldown || 0).toFixed(3),
          dodgeTimer: +(p1.dodgeTimer || 0).toFixed(3), invulnerable: +(p1.invulnerable || 0).toFixed(3),
          match: window.__browserSmashMatch().status
        };
      });
      const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
      // Orientation, measured: the prop's own +Z axis against the direction the fighter is facing.
      // 0 deg means the prop faces forward with the body; a fixed world direction shows up as the
      // angle changing by exactly the turn the fighter made.
      const measureAim = () => page.evaluate(() => {
        const p1 = window.fighters[0];
        const f = [Number(p1.facing) || 1, 0, Number(p1.facingZ) || 0];
        const fl = Math.hypot(f[0], f[2]) || 1;
        // The body's own yaw is what the props inherit; the fighter's facing fields are smoothed
        // input and can differ from the yaw actually applied to the model.
        const bodyYaw = p1.model.rotation.y;
        const bodyForward = [Math.sin(bodyYaw), 0, Math.cos(bodyYaw)];
        const out = { facing: [+(f[0] / fl).toFixed(3), +(f[2] / fl).toFixed(3)],
          bodyYawDegrees: +(bodyYaw * 180 / Math.PI).toFixed(1),
          bodyForward: bodyForward.map(v => +v.toFixed(3)) };
        for (const side of ['right', 'left']) {
          const weapon = p1.model.userData['equippedWeapon' + side[0].toUpperCase() + side.slice(1)];
          if (!weapon) { out[side] = null; continue; }
          weapon.updateWorldMatrix(true, false);
          const e = weapon.matrixWorld.elements;
          const axis = [e[8], e[9], e[10]];
          const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
          const dot = (axis[0] * f[0] + axis[2] * f[2]) / (len * fl);
          const bodyDot = (axis[0] * bodyForward[0] + axis[2] * bodyForward[2]) / len;
          out[side] = {
            axis: axis.map(value => +(value / len).toFixed(3)),
            forwardDot: +dot.toFixed(3),
            degrees: +(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI).toFixed(1),
            bodyDot: +bodyDot.toFixed(3),
            bodyDegrees: +(Math.acos(Math.max(-1, Math.min(1, bodyDot))) * 180 / Math.PI).toFixed(1)
          };
        }
        return out;
      });
      const gather = async (view, predicate, note = '') => {
        const now = await state();
        const ok = predicate(now);
        const file = view + '.png';
        if (ok) {
          // Real viewport frame: the match camera, both fighters, the HUD.
          await page.screenshot({ path: resolve(dir, file) });
          entry.states.push({ view, file, note, observed: now });
        } else {
          entry.unverified.push({ view, note: note || 'predicate not met', observed: now });
        }
        return ok;
      };
      const place = (gap = 1.05) => page.evaluate(gap => {
        const [p1, p2] = window.fighters;
        p1.position.set(0, p1.groundLevel, p1.position.z);
        p1.velocity.set(0, 0, 0); p1.facing = 1; p1.facingZ = 0;
        p1.attackQueue.length = 0; p1.comboWindow = 0; p1.hitstun = 0; p1.invulnerable = 0;
        p2.position.set(gap, p2.groundLevel, p1.position.z);
        p2.velocity.set(0, 0, 0); p2.facing = -1; p2.facingZ = 0;
        p2.attackQueue.length = 0; p2.hitstun = 0;
      }, gap);

      await step(0.5);
      await gather('idle', s => s.speed < 0.25 && s.grounded, 'both hands empty, idle clip');

      await page.keyboard.down('d');
      await step(0.5);
      await gather('walk', s => s.speed > 0.25 && s.speed < 6.5, 'held D, speed ' + (await state()).speed);
      await page.keyboard.up('d');
      await step(0.2);

      await page.keyboard.down('ShiftLeft');
      await page.keyboard.down('d');
      await step(0.55);
      await gather('run', s => s.speed > 4.4, 'held SHIFT + D');
      await page.keyboard.up('d');
      await page.keyboard.up('ShiftLeft');
      await step(0.3);

      await page.keyboard.press('Space');
      await step(0.12);
      const airborne = await gather('jump', s => !s.grounded && s.y > 0.25, 'Space');
      if (airborne) {
        let landed = false;
        for (let i = 0; i < 24 && !landed; i++) {
          await step(0.1);
          landed = (await state()).grounded;
        }
        if (landed) await gather('landing', s => s.grounded, 'first grounded frame after the jump');
        else entry.unverified.push({ view: 'landing', note: 'never landed within 2.4s' });
      }

      await place();
      await page.keyboard.press('j');
      await step(0.1);
      await gather('light-attack', s => s.pose > 0 || s.queue.length > 0, 'J');
      await step(0.5);

      await place();
      await page.keyboard.down('ShiftLeft');
      await page.keyboard.press('j');
      await step(0.12);
      await gather('heavy-attack', s => s.pose > 0 || s.queue.length > 0, 'SHIFT + J, queue: ' + (await state()).queue.join('/'));
      await page.keyboard.up('ShiftLeft');
      await step(0.5);

      await place();
      await page.keyboard.press('k');
      await step(0.1);
      await gather('special', s => s.specialCooldown > 0, 'K, signature move');
      await step(0.6);

      // Weapon attachment, measured: which node carries each prop and how far its grip sits from
      // the hand. A prop parented to the elbow keeps a hand-sized gap that a screenshot alone
      // cannot distinguish from a deliberately long haft.
      entry.mounts = await page.evaluate(() => {
        const model = window.fighters[0].model;
        const world = object => {
          object.updateWorldMatrix(true, false);
          const e = object.matrixWorld.elements;
          return [e[12], e[13], e[14]];
        };
        const describe = (weapon, side) => {
          if (!weapon) return { side, present: false };
          const hand = model.userData[side + 'Hand'] || null;
          const grip = world(weapon);
          const palm = hand ? world(hand) : null;
          const gap = palm ? Math.hypot(grip[0] - palm[0], grip[1] - palm[1], grip[2] - palm[2]) : null;
          const holderPos = weapon.parent ? world(weapon.parent) : null;
          const holderGap = (holderPos && palm)
            ? +Math.hypot(holderPos[0] - palm[0], holderPos[1] - palm[1], holderPos[2] - palm[2]).toFixed(3) : null;
          const m = model.matrixWorld.elements;
          const modelScale = +Math.hypot(m[0], m[1], m[2]).toFixed(3);
          return {
            side, present: true, label: weapon.name, kind: model.userData.weaponKind || null,
            parent: weapon.parent?.name || null, parentIsBone: !!weapon.parent?.isBone,
            hasHandBone: !!hand, handName: hand?.name || null,
            gripDistance: gap === null ? null : +gap.toFixed(3),
            holderDistance: holderGap, modelScale,
            attachBone: weapon.parent?.userData?.attachBone || null,
            attachIsHand: weapon.parent?.userData?.attachIsHand === true,
            offset: weapon.position.toArray().map(value => +value.toFixed(3)),
            bossDistance: (() => {
              let boss = null;
              weapon.traverse(node => { if (!boss && /shield[\s_]*boss/i.test(node.name || '')) boss = node; });
              if (!boss) return null;
              const point = world(boss);
              return +Math.hypot(point[0] - palm[0], point[1] - palm[1], point[2] - palm[2]).toFixed(3);
            })(),
            scale: +weapon.scale.x.toFixed(3)
          };
        };
        const shieldNodes = [];
        model.traverse(node => { if (/shield/i.test(node.name || '')) shieldNodes.push(node.name); });
        return { right: describe(model.userData.equippedWeaponRight, 'right'),
                 left: describe(model.userData.equippedWeaponLeft, 'left'),
                 shieldNodes: shieldNodes.slice(0, 6), shieldNodeCount: shieldNodes.length };
      });

      await place();
      await page.keyboard.down('e');
      await step(0.15);
      await gather('block', s => s.guard, 'held E');
      entry.aimFront = await measureAim();
      await page.keyboard.up('e');
      await step(0.2);

      // Rear view: the fighter faces away from the camera, where a prop clipping through the back
      // shows up but a front three-quarter shot hides it.
      // Four quadrants. The opponent is repositioned so the fighter's own auto-facing settles on
      // the heading under test instead of fighting the test setup.
      const faceFrom = async (x, z, view, note) => {
        await place();
        await page.evaluate(({ x, z }) => {
          const p2 = window.fighters[1];
          p2.position.set(x, p2.groundLevel, z);
          p2.velocity.set(0, 0, 0);
        }, { x, z });
        await page.evaluate(({ x, z }) => {
          const p1 = window.fighters[0];
          p1.facing = x; p1.facingZ = z;
        }, { x, z });
        // Let the facing damping settle before measuring, or the reading catches the fighter
        // mid-turn and reports the turn itself as weapon error.
        for (let i = 0; i < 30; i++) await step(0.04);
        await gather(view, () => true, note);
        return measureAim();
      };
      entry.aimTurn90 = await faceFrom(0, 3, 'turn-90', 'opponent placed to the side: quarter turn');
      entry.aimRear = await faceFrom(-3, 0, 'rear', 'opponent behind the camera: half turn');
      entry.aimTurn270 = await faceFrom(0, -3, 'turn-270', 'opponent placed ahead-left: three-quarter turn');
      await page.evaluate(() => { window.fighters[0].facing = 1; });
      await step(0.15);

      // A tap of the sprint key is the dodge binding.
      await place();
      await page.keyboard.press('ShiftLeft');
      await step(0.06);
      await gather('dodge', s => s.dodgeTimer > 0 || s.invulnerable > 0, 'tapped SHIFT');
      await step(0.5);

      // Genuine hit reaction: the second player attacks the fighter under test.
      await place(1.0);
      const before = await state();
      await page.keyboard.press(',');
      await step(0.12);
      const hit = await state();
      if (hit.percent > before.percent && hit.hitstun > 0) {
        await page.screenshot({ path: resolve(dir, 'hit-reaction.png') });
        entry.states.push({ view: 'hit-reaction', file: 'hit-reaction.png',
          note: "P2's ',' attack landed", observed: hit });
        await step(0.08);
        const knocked = await state();
        if (knocked.hitstun > 0.15 || knocked.speed > 2.5) {
          await page.screenshot({ path: resolve(dir, 'knockback.png') });
          entry.states.push({ view: 'knockback', file: 'knockback.png',
            note: 'still in hitstun after the hit', observed: knocked });
        } else {
          entry.unverified.push({ view: 'knockback', note: 'no measurable knockback after the hit', observed: knocked });
        }
      } else {
        entry.unverified.push({ view: 'hit-reaction', note: 'P2 attack did not connect', observed: hit });
      }

      // Victory: win a real round by landing hits, no forced percent.
      await page.evaluate(() => window.__browserSmashSetRules({ roundsToWin: 1 }));
      await page.click('#play');
      await page.evaluate(() => window.__browserSmashStep(0.2));
      let won = false;
      for (let i = 0; i < 26 && !won; i++) {
        await place(1.0);
        await page.keyboard.press('j');
        await step(0.35);
        const now = await state();
        won = now.match === 'match-over';
      }
      if (won) {
        const final = await page.evaluate(() => ({ match: window.__browserSmashMatch(), text: document.querySelector('#result').textContent }));
        const winner = final.match.winner;
        if (winner === 'p1') {
          await page.screenshot({ path: resolve(dir, 'victory.png') });
          entry.states.push({ view: 'victory', file: 'victory.png', note: 'round won by landed hits', observed: final.match });
        } else {
          entry.unverified.push({ view: 'victory', note: 'match ended without a p1 win', observed: final.match });
        }
      } else {
        entry.unverified.push({ view: 'victory', note: 'no KO within 26 landed-hit attempts; not forced' });
      }

      // Equipment structure: the Phase 22 equipment is skinned into the body mesh rather than
      // parented as separate nodes, so record what the shipped GLB actually contains.
      entry.equipment = await page.evaluate(() => {
        const model = window.fighters[0].model;
        const names = [];
        let skinned = 0, bones = new Set(), tris = 0;
        model.traverse(node => {
          if (node.isSkinnedMesh) skinned++;
          if (node.isBone) bones.add(node.name);
          if (node.name) names.push(node.name);
          if (node.isMesh && node.geometry) {
            const geo = node.geometry;
            tris += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count || 0) / 3;
          }
        });
        return {
          skinnedMeshes: skinned, bones: bones.size, triangles: Math.round(tris),
          separateAccessoryNodes: names.filter(name => /hammer|tiara|trident|bracer|mask|agamotto|faceplate|whisker|automail|lasso/i.test(name)),
          nodeSample: names.slice(0, 12)
        };
      });
    } catch (error) {
      entry.status = 'failed';
      entry.error = String(error.message || error);
    }
    report.fighters.push(entry);
    await writeFile(resolve(dir, 'report.json'), JSON.stringify(entry, null, 2));
    console.log(`${slug}: ${entry.states.length} states, ${entry.unverified.length} unverified, ${entry.status}`);
  } catch (error) {
    report.fighters.push({ slug, status: 'failed', error: String(error.message || error), states: [], unverified: [] });
    console.log(`${slug}: failed — ${String(error.message || error).split('\n')[0]}`);
  } finally {
    await browser?.close();
  }
}
await new Promise(done => server.close(done));
report.capturedAt = new Date().toISOString();
await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  fighters: report.fighters.map(f => ({ slug: f.slug, states: f.states.length, unverified: f.unverified.length, status: f.status })),
  pageErrors: report.pageErrors.slice(0, 5)
}, null, 2));
