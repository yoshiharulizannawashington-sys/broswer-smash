// Per-foot ground sampling probe.
//   bash scripts/run-browser-test.sh scripts/probe-per-foot-ground.mjs
//
// This runs on the Hogwarts Entrance Hall's Grand Staircase, where 0.4 m treads sit on a
// multi-level flight. One foot is placed one tread above the other. A single root-height foot
// layer would target the root tread for both ankles; the report must instead show two different
// sampled grounds and a target on each sampled surface, with both ankles in contact.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/per-foot-ground');
await mkdir(out, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const bytes = await readFile(resolve(root, relative));
    res.writeHead(200, { 'Content-Type': mime[extname(relative).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const results = [];
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  results.push(name);
  console.log(`  ok  ${name}${detail ? ' — ' + detail : ''}`);
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.stack || error)));
  page.on('console', message => {
    if (message.type() === 'error' && !/404 \(Not Found\)/.test(message.text())) errors.push(message.text());
  });
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
    } catch (error) {
      await route.fulfill({ status: 404, body: String(error?.message || error) });
    }
  });

  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 200 });
  await page.evaluate(() => window.__browserSmashSelect.chooseArena('hogwarts_entrance_hall'));
  await page.evaluate(() => window.__browserSmashExplore());
  await page.waitForFunction(() => window.__browserSmashWorld?.location === 'hogwarts_entrance_hall',
    null, { timeout: 120_000, polling: 200 });
  // Let the castle world mount and the mixer bind before placing the body on the staircase.
  await page.evaluate(() => window.__browserSmashStep(0.5));

  const read = () => page.evaluate(() => window.fighters.map(f => {
    const m = f.model;
    const report = m?.userData?.locomotionReport || null;
    const bones = ['leftFoot', 'rightFoot'].map(key => {
      const bone = m?.userData?.[key] || f.animationController?.rig?.joints?.[key];
      if (!bone) return null;
      bone.updateWorldMatrix(true, false);
      const e = bone.matrixWorld.elements;
      return { x: Number(e[12].toFixed(3)), y: Number(e[13].toFixed(3)), z: Number(e[14].toFixed(3)) };
    });
    return {
      identity: f.identity,
      position: { x: Number(f.position.x.toFixed(3)), y: Number(f.position.y.toFixed(3)),
        z: Number(f.position.z.toFixed(3)) },
      layout: f.layout?.label || null,
      report,
      feet: bones
    };
  }));

  // The Grand Staircase in the entrance hall. Flight A is 0.4 m per tread, at x 24..31,
  // z -109.2..-115.2. Stand on the 1.0 m tread with the body facing +X so the two idle feet
  // straddle the next (1.4 m) tread. A stair is the hardest case: the levels differ by one step
  // and both feet must resolve against their own tread.
  const placed = await page.evaluate(() => {
    const p1 = window.fighters[0];
    p1.position.set(27.5, 1.0, -109.1);
    p1.model.position.copy(p1.position);
    p1.facing = 1;
    p1.facingZ = 0;
    p1.velocity.set(0, 0, 0);
    p1.isGrounded = true;
    p1.landPulse = 0;
    window.__browserSmashStep(0.5);
    return { rootGround: p1.groundLevel ?? null, layout: p1.layout?.label ?? null };
  });
  let sample = (await read())[0];
  for (let i = 0; i < 80; i += 1) {
    if (sample.report?.feet?.length === 2
      && sample.report.feet.every(foot => foot.ground != null && foot.target && foot.weight > 0.9)) break;
    await page.evaluate(() => window.__browserSmashStep(0.05));
    sample = (await read())[0];
    await page.waitForTimeout(40);
  }
  const grounds = sample.report?.feet?.map(foot => foot.ground) || [];
  const targets = sample.report?.feet?.map(foot => foot.target?.[1]) || [];
  const contact = sample.report?.calibration?.foot?.contactHeight || 0.107;
  const distinct = new Set(grounds.map(value => Number(value.toFixed(2))));
  const targetHeights = sample.report?.feet?.map(foot => foot.target && foot.ground != null
    ? Number((foot.target[1] - foot.ground).toFixed(3)) : null);
  const rootTargetHeight = Number((sample.report?.groundRoot ?? 0) + contact).toFixed(3);

  console.log('PLACED ' + JSON.stringify({ placed, sample, grounds, targets, targetHeights }));
  check('the match loaded a multi-level Hogwarts stage', sample.layout?.includes('Hogwarts')
    && sample.layout?.includes('Entrance Hall'), JSON.stringify(sample.layout));
  check('the two feet sampled different stair treads', distinct.size >= 2
    && Math.max(...grounds) - Math.min(...grounds) > 0.25,
    JSON.stringify({ grounds, feet: sample.report?.feet }));
  check('each foot target is anchored to its own sampled ground',
    sample.report?.feet?.length === 2
    && targetHeights.every(value => value != null && Math.abs(value - contact) < 0.08),
    JSON.stringify({ contact, targetHeights, targets, rootTargetHeight }));
  check('the higher foot is not collapsed onto the root tread',
    grounds.some(value => Math.abs(value - sample.report.groundRoot) < 0.08)
    && grounds.some(value => Math.abs(value - sample.report.groundRoot) > 0.25),
    JSON.stringify({ groundRoot: sample.report?.groundRoot, grounds }));
  check('both sampled feet resolve into their own contact bands',
    sample.report?.feet?.every(foot => foot.contact && Math.abs(foot.height) < 0.24),
    JSON.stringify(sample.report?.feet));

  await page.evaluate(() => {
    window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'full', distance: 3.2, yaw: 90, pitch: 4 });
    window.__browserSmashStep(0.1);
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(out, 'grand-staircase-per-foot.png') });
  await writeFile(resolve(out, 'per-foot-report.json'), JSON.stringify({ placed, sample, results }, null, 2));

  check('no page errors while sampling a multi-level stage', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser?.close();
  server.close();
}

console.log(`\n✓ Per-foot ground checks passed: ${results.length} assertions`);
