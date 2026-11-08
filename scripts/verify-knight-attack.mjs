// Verify the Knight's attack on the real input path: clip identity, weapon alignment, hit resolution.
//   bash scripts/run-browser-test.sh scripts/verify-knight-attack.mjs <Character> <outDir>
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const characterName = process.argv[2] || 'Kaze';
const outDir = resolve(process.cwd(), process.argv[3] || 'artifacts/dev/phase28421/attack');
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
await mkdir(outDir, { recursive: true });

const report = { character: characterName, frames: [], shots: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.setDefaultTimeout(180_000);
page.on('pageerror', e => report.errors.push(String(e.message || e).slice(0, 200)));

try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashStep && window.fighters), null, { timeout: 180_000, polling: 200 });
  await page.evaluate(name => {
    const s = document.querySelector('#p1Character');
    const o = s && [...s.options].find(o => o.value === name);
    if (o) { s.value = name; s.dispatchEvent(new Event('change', { bubbles: true })); }
    document.querySelector('#play')?.click();
  }, characterName);
  await page.waitForFunction(() => window.fighters?.length >= 2 && window.fighters.some(f => f.model), null, { timeout: 180_000, polling: 200 });
  await page.waitForFunction(() => Boolean(window.fighters?.[0]?.model?.userData?.hasAnimationClips), null, { timeout: 60_000, polling: 200 }).catch(() => {});

  report.bind = await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    const THREE = window.__browserSmashThree;
    const root = window.fighters[0].model;
    const u = root.userData || {};
    const hand = u.rightHand || u.leftHand || null;
    const holder = hand?.userData?.weaponHolder || null;
    const bones = [];
    root.traverse?.(n => { if (n.isBone) bones.push(n); });
    window.__atk = { THREE, root, hand, holder, bones: bones.filter(b => /arm|fore|hand|chest|spine/i.test(b.name || '')).slice(0, 8) };
    const [player, cpu] = window.fighters;
    const facing = player.facing ?? 1;
    cpu.position.set(player.position.x + facing * 0.8, player.position.y, player.position.z);
    cpu.percent = 0;
    window.smashCamera.spectate({ fighter: player, framing: 'full', yaw: 35, pitch: 0 });
    window.__browserSmashStep?.(0.1);
    return { hand: hand?.name || null, holder: holder?.name || null, weaponKind: u.weaponKind || null,
      hasClips: !!u.hasAnimationClips, bones: bones.length, clip: u.currentClip || null };
  });

  const sample = () => page.evaluate(() => {
    const { THREE, root, hand, holder, bones } = window.__atk;
    const f = window.fighters[0], cpu = window.fighters[1];
    const wp = new THREE.Vector3(), hp = new THREE.Vector3();
    if (holder) holder.getWorldPosition(wp);
    if (hand) hand.getWorldPosition(hp);
    const cam = window.smashCamera?.camera;
    let framed = false, heightFraction = 0;
    if (cam) {
      const base = new THREE.Vector3(); root.getWorldPosition(base);
      const head = base.clone(); head.y += 1.75;
      const pr = v => { const p = v.clone().project(cam); return { x: p.x, y: p.y }; };
      const h = pr(head), ft = pr(base);
      framed = [h, ft].every(p => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1);
      heightFraction = Math.abs(h.y - ft.y) / 2;
    }
    return {
      clip: root.userData?.currentClip || null,
      queue: (f.attackQueue || []).map(a => a.moveId || a.kind || 'attack'),
      active: (f.attackQueue || []).map(a => ({ kind: a.kind, t: +(a.t || 0).toFixed(2), start: a.start, end: a.end })),
      liveHitboxes: (f.hitboxes || []).filter(hb => !hb.hit).length,
      weaponGap: holder && hand ? +wp.distanceTo(hp).toFixed(4) : null,
      sig: bones.map(b => +b.quaternion.w.toFixed(4)),
      cpuPercent: +cpu.percent.toFixed(2),
      framed, heightFraction: +heightFraction.toFixed(3)
    };
  });

  const idle = await sample();
  report.idle = idle;
  await page.screenshot({ path: resolve(outDir, 'attack-00-idle.png') });

  await page.keyboard.press('j');
  const plan = new Map([[3, 'attack-01-windup.png'], [8, 'attack-02-active.png'], [15, 'attack-03-recovery.png']]);
  for (let frame = 0; frame < 36; frame++) {
    const s = await sample();
    report.frames.push({ frame, ...s });
    const file = plan.get(frame);
    if (file) {
      if (s.framed && s.heightFraction >= 0.3) {
        await page.screenshot({ path: resolve(outDir, file) });
        report.shots.push({ frame, file, clip: s.clip });
      }
      plan.delete(frame);
    }
    if (!plan.size) break;
    await page.evaluate(() => window.__browserSmashStep?.(1 / 60));
  }

  report.damage = await page.evaluate(() => {
    const cpu = window.fighters[1], p = window.fighters[0];
    return { cpuPercent: +cpu.percent.toFixed(2),
      distance: +Math.hypot(cpu.position.x - p.position.x, cpu.position.z - p.position.z).toFixed(2) };
  });

  await page.keyboard.press('j');
  await page.evaluate(() => window.__browserSmashStep?.(0.12));
  const mid = await sample();
  await page.keyboard.press('j');
  await page.evaluate(() => window.__browserSmashStep?.(0.1));
  const after = await sample();
  await page.evaluate(() => window.__browserSmashStep?.(0.6));
  const recovered = await sample();
  report.combo = { mid: mid.clip, after: after.clip, recovered: recovered.clip,
    queueMid: mid.queue, queueAfter: after.queue, damage: recovered.cpuPercent };

  const gapAt = f => f?.weaponGap;
  const gaps = report.frames.map(gapAt).filter(g => typeof g === 'number');
  report.weapon = { gaps, min: Math.min(...gaps), max: Math.max(...gaps), spread: +(Math.max(...gaps) - Math.min(...gaps)).toFixed(4) };

  await writeFile(resolve(outDir, 'attack-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('ATTACK:' + JSON.stringify(report));
} finally {
  await browser.close();
}
