// Phase 22.3G weapon attachment regression across the whole launch roster.
//
//   bash scripts/run-browser-test.sh scripts/measure-weapon-attachment.mjs
//   bash scripts/run-browser-test.sh scripts/measure-weapon-attachment.mjs --fighters=Thor,Kaze
//
// `audit:roster` proves every selectable fighter mounts its own exported body, its weapon and its
// surface detail. This measures the other half: where each prop actually sits relative to the hand
// that holds it, for every fighter, in one page session. The 22.3C body-relative holder is only
// correct if the holder rides the hand bone (holder distance 0), the grip offset is the authored
// one, and the prop points along the body's facing instead of a fixed compass heading. When the
// authored grip deliberately sits more than a palm's width from the prop origin, the hand must
// still touch the prop rather than float beside it.
//
// Failures are real defects: a prop missing from an armed fighter, a prop not parented to the hand
// bone, a prop detached from the palm, or a grip reading that differs from the other fighters
// carrying the same weapon.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase22-3/acceptance');
await mkdir(outDir, { recursive: true });
const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const argv = process.argv.slice(2);
const flag = name => {
  const hit = argv.find(arg => arg.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};
// A focused run measures only the named fighters. It writes its own artifact so a two-fighter
// check can never overwrite the full-roster acceptance file.
const focus = (flag('fighters') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
const focusKeys = new Set(focus.map(slugOf));
const tag = flag('tag') || (focus.length ? 'focus-' + focus.map(slugOf).join('-') : null);
const outFile = tag ? `attachment-${tag}.json` : 'attachment.json';

// What each fighter's weapon asset says it is, read from the shipped prefab rather than a list
// duplicated here: `extras.kind` and `extras.hand` on every `weapon_<key>_<hand>` root.
const declaredWeapons = new Map();
try {
  const glb = await readFile(resolve(root, 'public/assets/character_weapons.glb'));
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  for (const node of gltf.nodes || []) {
    const extras = node.extras;
    if (!extras?.character_key || !extras?.kind || !/^weapon_/.test(node.name || '')) continue;
    const entry = declaredWeapons.get(extras.character_key) || {};
    entry[extras.hand === 'left' ? 'left' : 'right'] = extras.kind;
    declaredWeapons.set(extras.character_key, entry);
  }
} catch (error) {
  throw new Error('cannot read weapon prefab metadata, so classification cannot be checked: ' + error.message);
}

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
    if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const report = { phase: '22.3G', kind: 'weapon-attachment', focus: null, rows: [], failures: [],
  pageErrors: [], emitters: [], raisedGrips: [], status: 'complete' };
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => report.pageErrors.push(String(error.message || error)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
    } catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.characters?.status === 'loaded'
    && window.__browserSmashAssets?.weapons?.status === 'loaded' && window.fighters?.length === 2,
    null, { timeout: 180_000, polling: 250 });

  const launchRoster = await page.evaluate(() => (window.characterRosters?.launch || []).map(([name]) => name));
  const roster = focusKeys.size
    ? launchRoster.filter(name => focusKeys.has(slugOf(name)))
    : launchRoster;
  if (!focusKeys.size) {
    assert.ok(launchRoster.length >= 32, 'launch roster missing from the page: ' + launchRoster.length);
    report.focus = { requested: [], matched: launchRoster };
  } else {
    const matchedKeys = new Set(roster.map(slugOf));
    const missing = focus.filter(value => !matchedKeys.has(slugOf(value)));
    assert.deepEqual(missing, [], 'roster fighters not found: ' + missing.join(', '));
    report.focus = { requested: focus, matched: roster };
  }

  for (const name of roster) {
    const measured = await page.evaluate(async fighterName => {
      const select = document.querySelector('#p1Character');
      select.value = fighterName;
      select.dispatchEvent(new Event('change'));
      const fighter = window.fighters[0];
      const slug = String(fighterName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const deadline = Date.now() + 45000;
      let model = fighter.model;
      let settledAt = null;
      // Selecting mounts three things in sequence: the prefab body, the fighter's own exported
      // body, then the weapon on the new body. A reading taken while only the prefab body is up
      // describes a body that is about to be replaced, so wait for the exported body file by name
      // and then give the mount a short grace period.
      while (Date.now() < deadline) {
        model = fighter.model;
        const asset = String(model?.userData?.characterAssetUrl || '');
        const bodyLanded = asset.includes('/roster/' + slug + '.glb') || asset.endsWith('/' + slug + '/' + slug + '.glb');
        const armed = model?.userData?.equippedWeaponRight || model?.userData?.equippedWeaponLeft;
        const ready = fighter.identity === fighterName && bodyLanded
          && (armed || model?.userData?.weaponKind === 'unarmed');
        if (ready) { settledAt = Date.now(); break; }
        await new Promise(done => setTimeout(done, 50));
      }
      if (settledAt) await new Promise(done => setTimeout(done, 250));
      // The deliberate carry/stow pose rotates the prop for silhouette and body clearance. Disable
      // it unconditionally: reading weaponCarry.mode to decide is racy, and a missed read measures
      // the posed prop. Then advance one fixed step synchronously. Unlike a render-frame wait, this
      // runs the mixer and sync pass even on the software renderer, so the authored holder is
      // restored before the reading.
      if (typeof window.__browserSmashSetWeaponCarry !== 'function') {
        throw new Error('the audit cannot disable the weapon carry pose');
      }
      if (typeof window.__browserSmashStep !== 'function') {
        throw new Error('the audit cannot advance a fixed step to restore the authored weapon pose');
      }
      window.__browserSmashSetWeaponCarry(false);
      window.__browserSmashStep(1 / 60);
      // A late body swap would otherwise leave the reading on the previous model.
      model = fighter.model;
      const world = object => {
        object.updateWorldMatrix(true, false);
        const e = object.matrixWorld.elements;
        return [e[12], e[13], e[14]];
      };
      const gap = (a, b) => (a && b) ? +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(3) : null;
      const yaw = model.rotation.y;
      const forward = [Math.sin(yaw), 0, Math.cos(yaw)];
      const describe = (weapon, side) => {
        if (!weapon) return { side, present: false };
        const hand = model.userData[side + 'Hand'] || null;
        const fallbackBone = model.userData[side + 'Fore'] || model.userData[side + 'Arm'] || null;
        const palm = hand ? world(hand) : null;
        const grip = world(weapon);
        const holder = weapon.parent ? world(weapon.parent) : null;
        weapon.updateWorldMatrix(true, false);
        const e = weapon.matrixWorld.elements;
        const axis = [e[8], e[9], e[10]];
        const length = Math.hypot(...axis) || 1;
        const propKind = weapon.userData?.kind || null;
        let shieldParts = 0;
        weapon.traverse(node => { if (/^Shield/i.test(node.name || '')) shieldParts += 1; });
        const gripDistance = gap(grip, palm);
        // A grip more than a palm's width from the prop origin is deliberate (e.g. Stormbreaker's
        // raised haft grip). Check that the hand still touches the prop's bounds instead of
        // accepting the origin distance or maintaining a per-weapon exception list.
        const T = window.__browserSmashThree;
        const handToProp = palm && shieldParts === 0 && gripDistance !== null && gripDistance > 0.35 && T?.Box3
          ? +(new T.Box3().setFromObject(weapon)
            .distanceToPoint(new T.Vector3(palm[0], palm[1], palm[2]))).toFixed(3)
          : null;
        return {
          propKind,
          handToProp,
          side, present: true, label: weapon.name,
          parent: weapon.parent?.name || null, parentIsBone: !!weapon.parent?.isBone,
          hasHandJoint: Boolean(hand), fallbackBone: fallbackBone?.name || null,
          // A shield is carried by its centre: its origin sits behind the palm on purpose, so the
          // hand-sized grip rule cannot apply to it. Detect it from the prop, not from the
          // fighter's weaponKind, which describes the right-hand weapon only.
          shieldParts,
          // The mount the game chose: a hand when the body exports one, otherwise the documented
          // forearm/arm fallback (equipCharacterWeapons: rightHand || rightFore || rightArm).
          mountClass: weapon.parent?.userData?.attachIsHand === true ? 'hand'
            : weapon.parent?.userData?.attachBone ? 'forearm-fallback' : 'unlabelled',
          attachBone: weapon.parent?.userData?.attachBone || null,
          attachIsHand: weapon.parent?.userData?.attachIsHand === true,
          underModel: (() => { let node = weapon.parent; while (node) { if (node === model) return true; node = node.parent; } return false; })(),
          gripDistance, holderDistance: gap(holder, palm),
          axisDotForward: +((axis[0] * forward[0] + axis[2] * forward[2]) / length).toFixed(3),
          offset: weapon.position.toArray().map(v => +v.toFixed(3)),
          scale: +weapon.scale.x.toFixed(3)
        };
      };
      const right = describe(model.userData.equippedWeaponRight, 'right');
      const left = describe(model.userData.equippedWeaponLeft, 'left');
      const result = {
        identity: fighter.identity,
        kind: model?.userData?.weaponKind || null,
        weaponLabel: model?.userData?.weaponLabel || null,
        offhandKind: model?.userData?.offhandKind || null,
        offhandLabel: model?.userData?.offhandLabel || null,
        // The game's own "hands are the weapon" flag (models.js equipCharacterWeapons): these
        // fighters carry palm emitters, so their prefab entry is an emitter, not a held weapon.
        unarmedByDesign: model?.userData?.unarmed === true || Boolean(model?.userData?.sculptedBody),
        body: model?.userData?.characterAssetUrl ? 'imported' : 'procedural',
        bodyYawDegrees: +(yaw * 180 / Math.PI).toFixed(1),
        right, left, shieldPartCount: left.shieldParts || 0
      };
      // Restore the deliberate carry pose after the reading and before the next fighter.
      window.__browserSmashSetWeaponCarry(true);
      return result;
    }, name);

    // Classification: the fighter has to report what its weapon asset declares. A missing kind is
    // what made sword fighters fall into the unarmed attack branch.
    const declared = declaredWeapons.get(slugOf(name)) || {};
    const unarmedByDesign = measured.unarmedByDesign === true;
    // An unarmed-by-design fighter keeps reporting 'unarmed' even though the prefab has an emitter
    // entry for its palm; the emitter is recorded rather than mistaken for a missing weapon.
    const expectedRight = unarmedByDesign ? 'unarmed' : (declared.right || 'sword');
    // An unarmed-by-design fighter's prefab emitters are recorded in `emitters`, not equipped as a
    // left holdable. Only an armed fighter is expected to expose the declared offhand kind.
    const expectedOffhand = unarmedByDesign ? null : (declared.left || null);
    if (unarmedByDesign && declared.right) {
      report.emitters.push({ name, declaredKind: declared.right, weaponKind: measured.kind });
    }
    if (!measured.kind) {
      report.failures.push({ name, error: `weaponKind is missing; the equip path should declare ${expectedRight}` });
    } else if (measured.kind !== expectedRight) {
      report.failures.push({ name, error: `weaponKind is ${measured.kind} but the asset declares ${expectedRight}` });
    }
    if ((measured.offhandKind || null) !== expectedOffhand) {
      report.failures.push({ name, error: `offhandKind is ${measured.offhandKind} but the asset declares ${expectedOffhand}` });
    }

    const sides = [measured.right, measured.left].filter(side => side?.present);
    // A gauntlet/emitter is worn on the palm; its authored +Z is the emitter face, not a blade
    // direction along the bearer's facing. The facing check applies to directional held props.
    const emitterKinds = new Set(['lightning', 'gauntlet', 'energy_gauntlet', 'webshooters',
      'alchemy_glove', 'repulsor', 'psychic_focus', 'ki_orb']);
    const directionalProp = !emitterKinds.has(measured.kind);
    if (measured.kind !== 'unarmed' && sides.length === 0) {
      report.failures.push({ name, error: 'armed fighter has no prop attached', ...measured });
    }
    for (const side of sides) {
      if (!side.underModel) report.failures.push({ name, error: `${side.side} prop is not parented under the fighter model`, side });
      // A body that exports a hand and still mounts to the forearm is the defect: the fallback is
      // only legitimate when there is no hand joint to attach to.
      if (side.hasHandJoint && side.mountClass === 'forearm-fallback') {
        report.failures.push({ name, error: `${side.side} body has a hand joint but the prop is on the forearm`, side });
      }
      if (side.mountClass === 'unlabelled') {
        report.failures.push({ name, error: `${side.side} holder carries no attach metadata`, side });
      }
      if (side.mountClass === 'hand') {
        if (side.holderDistance !== 0) {
          report.failures.push({ name, error: `${side.side} holder is not at the hand bone (${side.holderDistance} m)`, side });
        }
        // The shield is a centre grip: its origin sits behind the palm on purpose (0.504 m on
        // Wonder Woman, frozen since 22.3F), so only the sword-like grips are hand-sized.
        if ((side.shieldParts || 0) === 0) {
          if (side.gripDistance === null) {
            report.failures.push({ name, error: `${side.side} grip distance is unmeasurable`, side });
          } else if (side.gripDistance > 0.35 && (side.handToProp === null || side.handToProp > 0.10)) {
            report.failures.push({ name, raisedGrip: true, side,
              error: `${side.side} raised grip hand sits ${side.handToProp} m from the prop` });
          }
        }
        if (directionalProp && Math.abs(side.axisDotForward) < 0.98) {
          report.failures.push({ name, error: `${side.side} prop does not point along the body facing (dot ${side.axisDotForward})`, side });
        }
      }
    }
    report.rows.push(measured);
    process.stdout.write(`\r${report.rows.length + report.failures.length}/${roster.length} fighters measured`);
  }
  process.stdout.write('\n');

  report.classifications = report.rows.map(row => ({ name: row.identity, weaponKind: row.kind,
    weaponLabel: row.weaponLabel, offhandKind: row.offhandKind }));
  report.unarmedByDesign = report.rows.filter(row => row.kind === 'unarmed').map(row => row.identity);
  report.withOffhand = report.classifications.filter(row => row.offhandKind);
  report.raisedGrips = report.rows.flatMap(row => [row.right, row.left]
    .filter(side => side?.present && side.handToProp !== null)
    .map(side => ({ name: row.identity, kind: side.propKind, side: side.side,
      handToProp: side.handToProp, originToPalm: side.gripDistance })));

  // Grouped by weapon kind so a single odd reading stands out against its peers instead of being
  // averaged away across the roster.
  const groups = {};
  for (const row of report.rows) {
    for (const side of [row.right, row.left]) {
      if (!side?.present) continue;
      // A shield is a centre-grip prop, not the sword grip this spread check compares. Counting it
      // under the right-hand weapon kind made Wonder Woman/Link's shields look like 0.5 m sword
      // grips and falsely failed the shared-grip invariant.
      if ((side.shieldParts || 0) > 0) continue;
      const key = `${row.kind}:${side.side}`;
      groups[key] = groups[key] || [];
      groups[key].push({ name: row.identity, gripDistance: side.gripDistance,
        holderDistance: side.holderDistance, offset: side.offset, scale: side.scale,
        axisDotForward: side.axisDotForward });
    }
  }
  for (const [key, entries] of Object.entries(groups)) {
    const grips = entries.map(e => e.gripDistance).filter(v => typeof v === 'number');
    const spread = grips.length ? Math.max(...grips) - Math.min(...grips) : 0;
    if (spread > 0.05) report.failures.push({ key, error: `grip distance spread ${spread.toFixed(3)} m across ${entries.length} fighters`, entries });
  }

  const offsets = await page.evaluate(() => {
    const fighter = window.fighters[0];
    const model = fighter.model;
    const read = weapon => weapon ? { name: weapon.name, offset: weapon.position.toArray().map(v => +v.toFixed(3)) } : null;
    return { right: read(model.userData.equippedWeaponRight), left: read(model.userData.equippedWeaponLeft) };
  });

  const wonderWoman = report.rows.find(row => row.identity === 'Wonder Woman');
  report.baseline = {
    wonderWoman: wonderWoman ? {
      right: wonderWoman.right, left: wonderWoman.left, shieldPartCount: wonderWoman.shieldPartCount
    } : null,
    // 22.3F frozen numbers, re-measured here rather than restated.
    frozen: { swordGrip: wonderWoman?.right?.gripDistance ?? null,
      shieldHolder: wonderWoman?.left?.holderDistance ?? null,
      shieldFaceDotForward: null,
      matches22_3F: wonderWoman?.right?.gripDistance === 0.071 && wonderWoman?.left?.holderDistance === 0 }
  };
  report.groups = groups;
  const mountClasses = {};
  for (const row of report.rows) for (const side of [row.right, row.left]) {
    if (!side?.present) continue;
    mountClasses[side.mountClass] = (mountClasses[side.mountClass] || 0) + 1;
  }
  report.fallbackFighters = report.rows
    .filter(row => [row.right, row.left].some(side => side?.present && side.mountClass === 'forearm-fallback'))
    .map(row => row.identity);
  report.totals = {
    fighters: report.rows.length,
    mountClasses,
    fallbackFighters: report.fallbackFighters,
    armed: report.rows.filter(row => row.kind !== 'unarmed').length,
    unarmed: report.rows.filter(row => row.kind === 'unarmed').map(row => row.identity),
    withLeftProp: report.rows.filter(row => row.left?.present).length,
    withRightProp: report.rows.filter(row => row.right?.present).length,
    raisedGrips: report.raisedGrips.length,
    pageErrors: report.pageErrors.length,
    failures: report.failures.length
  };
  assert.deepEqual(report.failures, [], 'weapon attachment failures: ' + JSON.stringify(report.failures.slice(0, 6), null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors: ' + report.pageErrors.join('\n'));
  assert.equal(report.rows.length, roster.length, 'did not reach every fighter');
} catch (error) {
  report.status = 'failed';
  report.error = String(error.message || error).split('\n').slice(0, 8).join('\n');
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
await writeFile(resolve(outDir, outFile), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, error: report.error || null,
  focus: report.focus, raisedGrips: report.raisedGrips, totals: report.totals,
  baseline: report.baseline?.frozen,
  groupCounts: Object.fromEntries(Object.entries(report.groups || {}).map(([k, v]) => [k, v.length])),
  failures: (report.failures || []).slice(0, 6) }, null, 2));
if (report.status === 'failed') process.exitCode = 1;
