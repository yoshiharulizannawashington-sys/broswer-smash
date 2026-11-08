// Runtime probe for the match-end and heavy-hit states.
//
//   bash scripts/run-browser-test.sh scripts/probe-end-states.mjs
//
// A clip that exists in a GLB and is bound to a search is still not proof that gameplay reaches
// it. This boots the real game, starts a real match, clears the live fight so the CPU cannot
// overwrite the state under test, sets the same fields the match-end code sets (victoryPose on
// the winner, ko on the loser) and a heavy stun, then reads which clip the body's mixer actually
// runs. The subject is Goku, one of the four 25-clip benchmark fighters.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const errors = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => errors.push(String(error).split('\n')[0]));
  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.fighters?.length >= 2, null, { timeout: 120_000 });
  // The select screen covers #menu, so the fight is started through the menu's own handler.
  await page.evaluate(() => document.querySelector('#play').click());
  await page.waitForTimeout(1500);

  // Clear the live exchange and separate the bodies so the CPU cannot land a hit inside the few
  // frames a sample takes; without this the sampled state is whatever the AI was already doing.
  const calm = () => page.evaluate(() => {
    for (const [i, f] of window.fighters.entries()) {
      f.hitstun = 0; f.ko = false; f.victoryPose = 0;
      f.attackQueue.length = 0; f.hitboxes.length = 0; f.attackBuffer = 0;
      f.grabTarget = null; f.grabbedBy = null; f.grabHold = 0; f.heldThrow = null;
      f.parryTimer = 0; f.dodgeTimer = 0;
      f.position.z = 30 + i * 12;
      f.velocity.set(0, 0, 0);
    }
  });
  const sample = () => page.evaluate(() => {
    const subject = window.fighters.find(f => f.identityKey === 'goku') || window.fighters[0];
    const other = window.fighters.find(f => f !== subject);
    const read = f => {
      const mixer = f.model?.userData?.humanMixer;
      return mixer ? mixer._actions.filter(a => a.isRunning() && a.getEffectiveWeight() > 0.01)
        .map(a => a.getClip().name) : [];
    };
    return { subject: subject.identityKey, subjectClips: read(subject), otherClips: read(other) };
  });

  const results = {};
  results.library = await page.evaluate(() => {
    const f = window.fighters.find(x => x.identityKey === 'goku') || window.fighters[0];
    const mixer = f.model?.userData?.humanMixer;
    const clips = mixer ? [...new Set(mixer._actions.map(a => a.getClip().name))].sort() : [];
    return { fighter: f.identityKey, count: clips.length, clips };
  });

  await calm(); await page.waitForTimeout(600);
  results.idle = await sample();

  // Heavy hit: the stun a heavy/ultimate blow applies (>= 0.55 s).
  await calm();
  await page.evaluate(() => { const f = window.fighters.find(x => x.identityKey === 'goku') || window.fighters[0];
    f.hitstun = 0.9; });
  await page.waitForTimeout(300);
  results.heavyHit = await sample();

  // Light hit for comparison: a jab's stun must not borrow the heavy reaction.
  await calm();
  await page.evaluate(() => { const f = window.fighters.find(x => x.identityKey === 'goku') || window.fighters[0];
    f.hitstun = 0.2; });
  await page.waitForTimeout(250);
  results.lightHit = await sample();

  // Match end: winner holds victory, loser stays down on defeat - the same fields resolveRoundEnd sets.
  await calm();
  await page.evaluate(() => {
    const subject = window.fighters.find(f => f.identityKey === 'goku') || window.fighters[0];
    const other = window.fighters.find(f => f !== subject);
    subject.victoryPose = 4; subject.hitstun = 0; subject.isGrounded = true;
    other.ko = true; other.hitstun = 0; other.isGrounded = true;
  });
  await page.waitForTimeout(700);
  results.matchEnd = await sample();

  results.pageErrors = errors;
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  server.close();
}
