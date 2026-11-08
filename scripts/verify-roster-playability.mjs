// Real-match playability sweep for the production roster.
//
// Drives the actual game for every named fighter: the real select cards, a real match, keyboard
// movement, a jump, a punch, the fighter's own signature through the live projectile pipeline, a
// forced KO, a rematch, and one screenshot. The mounted body is judged from the skeleton that is
// actually on the fighter, not from a title-screen preview.
//
//   node scripts/verify-roster-playability.mjs "Superman" "Thor"
//   node scripts/verify-roster-playability.mjs --all
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const OUT = 'artifacts/roster-playability';
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};

const mainSource = await readFile(resolve(root, 'public/js/main.js'), 'utf8');
const roster = eval(mainSource.match(/const roster=(\[\[[\s\S]*?\]\]);/)[1]).map(([name]) => name);
const args = process.argv.slice(2);
const targets = args.includes('--all') ? roster : args.filter(arg => !arg.startsWith('--'));
if (!targets.length) {
  console.error('usage: node scripts/verify-roster-playability.mjs "Superman" ... | --all');
  process.exit(2);
}
for (const name of targets) assert.ok(roster.includes(name), `not a launch fighter: ${name}`);

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
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=600' });
    res.end(bytes);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
await mkdir(OUT, { recursive: true });

const slugOf = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const rows = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const boot = async () => {
    await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
      && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 120_000, polling: 200 });
    const versus = page.locator('#bbTitle [data-nav="versus"]');
    if (await versus.count() && await versus.first().isVisible().catch(() => false)) await versus.first().click();
    await page.waitForFunction(() => document.querySelectorAll('#selectScreen .bs-card').length > 20,
      null, { timeout: 20_000, polling: 100 });
  };

  for (let index = 0; index < targets.length; index += 1) {
    const name = targets[index];
    const opponent = name === 'Goku' ? 'Vegeta' : 'Goku';
    const row = { name, opponent, errors: [] };
    await boot();
    try {
      // ---- real select screen ------------------------------------------------------------
      await page.evaluate(() => {
        const set = (selector, value) => { const n = document.querySelector(selector); if (!n) return; n.value = value; n.dispatchEvent(new Event('change', { bubbles: true })); };
        set('[data-rule="rounds"]', '1'); set('[data-rule="timer"]', '60'); set('[data-rule="difficulty"]', 'rookie');
      });
      const card = page.locator(`#selectScreen .bs-card[data-fighter="${name}"]`);
      assert.ok(await card.count(), 'selection card missing');
      await card.first().click();
      await page.locator(`#selectScreen .bs-card[data-fighter="${opponent}"]`).first().click();
      await page.click('#selectScreen [data-nav="next"]');
      await page.click('#selectScreen .bs-arena[data-arena="finalvalley"]');
      await page.waitForTimeout(120);
      await page.click('#play');
      await page.waitForFunction(expected => window.fighters?.[0]?.identity === expected, name, { timeout: 30_000, polling: 100 });
      // The intro card covers the arena and locks input; wait for it to actually clear so both the
      // combat checks and the screenshot see the match, not the ENTERING ARENA slate.
      await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false,
        null, { timeout: 12_000, polling: 100 }).catch(() => {});
      await page.waitForTimeout(400);

      // ---- the body and skeleton that are actually on the match fighter -------------------
      const mount = await page.evaluate(() => {
        const f = window.fighters[0];
        const roles = ['pelvis', 'torso', 'head', 'leftArm', 'rightArm', 'leftFore', 'rightFore',
          'leftLeg', 'rightLeg', 'leftShin', 'rightShin'];
        let asset = null, bones = 0, skinned = 0, meshes = 0;
        f.model?.traverse(n => {
          if (n.userData?.characterAssetUrl) asset = n.userData.characterAssetUrl;
          if (n.isBone) bones += 1;
          if (n.isSkinnedMesh) skinned += 1;
          if (n.isMesh && n.visible) meshes += 1;
        });
        const key = f.identityKey || String(f.identity).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const loaded = window.__browserSmashAssets?.characterModels?.[key] || null;
        const bound = roles.filter(role => f.model?.userData?.[role]);
        return {
          identity: f.identity, key,
          asset: asset || loaded?.url || null,
          modelStatus: loaded?.status || null,
          bones, skinned, meshes, bound: bound.length,
          missing: roles.filter(role => !f.model?.userData?.[role]),
          hasController: Boolean(f.animationController),
          clipCount: f.model?.animations?.length || 0
        };
      });
      row.mount = mount;
      row.asset = mount.asset;
      row.rigOk = mount.bound >= 10 && mount.bones > 0 && mount.skinned > 0 && mount.meshes > 0;

      // ---- idle deformation: the skeleton must actually move ------------------------------
      const sampleBone = () => page.evaluate(() => {
        const f = window.fighters[0];
        const bone = f.model?.userData?.leftHand || f.model?.userData?.rightHand || f.model?.userData?.head;
        if (!bone) return null;
        bone.updateWorldMatrix(true, false);
        const e = bone.matrixWorld.elements;
        return [e[12], e[13], e[14]];
      });
      const before = await sampleBone();
      await page.evaluate(() => window.__browserSmashStep(0.8));
      const after = await sampleBone();
      row.idleDelta = before && after ? Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) : 0;

      // ---- movement ----------------------------------------------------------------------
      const start = await page.evaluate(() => window.fighters[0].position.toArray());
      await page.keyboard.down('d');
      await page.evaluate(() => window.__browserSmashStep(0.6));
      await page.keyboard.up('d');
      const moved = await page.evaluate(() => window.fighters[0].position.toArray());
      row.walked = Math.hypot(moved[0] - start[0], moved[2] - start[2]);

      // ---- jump: reset to the floor, settle, then track the highest point ------------------
      await page.evaluate(() => {
        const p = window.fighters[0];
        p.position.set(0, p.groundLevel, -12); p.velocity.set(0, 0, 0); p.hitstun = 0; p.jumps = 0;
        window.__browserSmashTrainingDummy = true;
      });
      await page.evaluate(() => window.__browserSmashStep(0.2));
      await page.keyboard.press('Space');
      let peak = 0;
      for (let i = 0; i < 16; i += 1) {
        await page.evaluate(() => window.__browserSmashStep(0.05));
        peak = Math.max(peak, await page.evaluate(() => window.fighters[0].position.y - window.fighters[0].groundLevel));
        if (peak > 1.4) break;
      }
      row.jump = peak;

      // ---- punch ------------------------------------------------------------------------
      await page.evaluate(() => {
        const [p1, p2] = window.fighters;
        p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0);
        p1.attackQueue.length = 0; p1.comboWindow = 0; p1.hitstun = 0; p1.invulnerable = 0;
        p1.facing = 1; p1.facingZ = 0;
        p2.position.set(1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0);
        p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.guardHeld = false; p2.aiTimer = 999;
        window.__browserSmashTrainingDummy = true;
      });
      await page.keyboard.press('j');
      await page.evaluate(() => window.__browserSmashStep(0.24));
      row.punch = await page.evaluate(() => window.fighters[1].percent);

      // ---- signature: key press first, then the same live projectile pipeline at close range
      await page.evaluate(() => { const p2 = window.fighters[1]; p2.invulnerable = 0; p2.hitstun = 0; });
      const beforeSpecial = await page.evaluate(() => window.fighters[1].percent);
      // Beam and spinning signatures are charge-on-hold moves: a tap press fires nothing. Hold E,
      // then release, and clear the victim's post-punch invulnerability inside the signature
      // window so the check measures the move's damage pipeline rather than i-frames.
      await page.keyboard.down('e');
      for (let i = 0; i < 12 && !row.keySpecial; i += 1) {
        await page.evaluate(() => { window.fighters[1].invulnerable = 0; window.__browserSmashStep(0.05); });
        row.keySpecial = await page.evaluate(prior => window.fighters[1].percent > prior, beforeSpecial);
      }
      await page.keyboard.up('e');
      for (let i = 0; i < 20 && !row.keySpecial; i += 1) {
        await page.evaluate(() => { window.fighters[1].invulnerable = 0; window.__browserSmashStep(0.1); });
        row.keySpecial = await page.evaluate(prior => window.fighters[1].percent > prior, beforeSpecial);
      }
      if (!row.keySpecial) {
        await page.evaluate(() => {
          const [p1, p2] = window.fighters;
          p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0); p1.facing = 1; p1.facingZ = 0;
          p1.hitstun = 0; p1.invulnerable = 0;
          // The failed key press left this fighter's own signature on cooldown; the live spawn
          // respects that cooldown, so clear it before the second, aimed attempt.
          p1.specialCooldown = 0; p1.attackLock = 0; p1.comboWindow = 0;
          p2.position.set(3.2, p2.groundLevel, -12); p2.hitstun = 0; p2.invulnerable = 0; p2.guardHeld = false;
          window.spawnProjectile(p1, { source: 'special', ...p1.specialProfile });
        });
        for (let i = 0; i < 24 && !row.keySpecial; i += 1) {
          await page.evaluate(() => { window.fighters[1].invulnerable = 0; window.__browserSmashStep(0.1); });
          row.keySpecial = await page.evaluate(prior => window.fighters[1].percent > prior, beforeSpecial);
        }
      }
      row.special = await page.evaluate(prior => Math.max(0, window.fighters[1].percent - prior), beforeSpecial);
      row.specialLabel = await page.evaluate(() => window.fighters[0].specialProfile?.label || null);

      await page.screenshot({ path: `${OUT}/${slugOf(name)}.png` });

      // ---- KO, result, rematch -----------------------------------------------------------
      await page.evaluate(() => { window.__browserSmashTrainingDummy = false; window.fighters[1].percent = 999; });
      let result = { text: '', status: '' };
      for (let i = 0; i < 40; i += 1) {
        await page.evaluate(() => window.__browserSmashStep(0.2));
        result = await page.evaluate(() => ({
          text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
          status: window.__browserSmashMatch?.().status || ''
        }));
        if (/VICTORY|DEFEAT|DRAW/i.test(result.text) && result.status === 'match-over') break;
      }
      row.ko = /VICTORY|DEFEAT|DRAW/i.test(result.text) && result.status === 'match-over';
      row.result = result.text.slice(0, 80);

      const rematch = page.locator('button', { hasText: /REMATCH/i }).first();
      if (await rematch.count() && await rematch.isVisible().catch(() => false)) {
        const identityBefore = await page.evaluate(() => window.fighters[0].identity);
        await rematch.click();
        await page.waitForTimeout(250);
        row.rematchStatus = await page.evaluate(() => window.__browserSmashMatch?.().status || '');
        row.rematch = row.rematchStatus === 'fighting'
          && await page.evaluate(expected => window.fighters?.[0]?.identity === expected && window.fighters.length === 2, identityBefore);
      } else {
        row.rematch = false;
      }
    } catch (error) {
      row.errors.push(error.message);
    }

    row.playable = Boolean(row.asset && row.rigOk && row.idleDelta > 0.001 && row.walked > 0.3
      && row.jump > 0.3 && row.punch > 0 && row.keySpecial && row.ko && row.rematch);
    rows.push(row);
    console.log(`${row.playable ? 'PLAYABLE ' : 'INCOMPLETE'} ${name} | ${row.asset || 'no asset'} | birds=${row.mount?.bones ?? '?'} `
      + `joints=${row.mount?.bound ?? '?'} clips=${row.mount?.clipCount ?? '?'} | idle=${(row.idleDelta || 0).toFixed(3)} `
      + `walk=${(row.walked || 0).toFixed(2)} jump=${(row.jump || 0).toFixed(2)} | punch=${(row.punch || 0).toFixed(1)} `
      + `special=${(row.special || 0).toFixed(1)} ${row.specialLabel || ''} | ko=${row.ko} rematch=${row.rematch} ${row.errors.join('; ')}`);
  }

  await writeFile(`${OUT}/report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), pageErrors, rows }, null, 1));
  const playable = rows.filter(r => r.playable).length;
  console.log(`\nPLAYABILITY ${playable}/${rows.length} passed every check`);
  console.log('report ' + OUT + '/report.json');
  if (pageErrors.length) console.log('pageErrors: ' + pageErrors.join(' | '));
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
