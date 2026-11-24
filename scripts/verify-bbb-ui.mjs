// Verifies the new interface layer against live game state, not mock data:
//   title menu -> setup -> match HUD (floating chips projected from real fighter positions,
//   ability/ultimate slots reading real cooldowns) -> pause -> settings (audio + camera bound).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/ui2';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (rel === 'index.html') rel = 'public/index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep)) && ['js', 'assets', 'models', 'data', 'css'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 180)));
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' || window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.waitForFunction(() => Boolean(document.querySelector('#bbTitle')), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(1200);

const shots = [];
const shoot = async (name) => { const file = `${out}/${name}.png`; await page.screenshot({ path: file }); shots.push(file); return file; };

await shoot('title');

// VERSUS must reveal the real setup screen (no fabricated navigation).
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForTimeout(700);
const setupVisible = await page.evaluate(() => {
  const panel = document.querySelector('#menu .panel');
  const title = document.querySelector('#bbTitle');
  return {
    titleHidden: title ? getComputedStyle(title).display === 'none' : false,
    panelRevealed: panel ? [...panel.children].some(c => c.id !== 'bbTitle' && getComputedStyle(c).display !== 'none') : false
  };
});
await shoot('setup');

// Real selection, then a real match.
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
});
await page.waitForTimeout(600);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(4000);

const hudState = await page.evaluate(() => {
  const THREE = window.__browserSmashThree;
  const camera = window.smashCamera?.camera;
  const project = f => {
    const v = new THREE.Vector3();
    const head = f.model.userData?.head;
    if (head?.getWorldPosition) head.getWorldPosition(v); else v.copy(f.position);
    v.y += 0.3; v.project(camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  };
  const chips = [...document.querySelectorAll('.bb-float')];
  const rects = chips.map(c => { const r = c.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, opacity: getComputedStyle(c).opacity }; });
  const expected = (window.fighters || []).slice(0, 2).map(project);
  const drift = rects.map((r, i) => r.cx ? Math.round(Math.hypot(r.cx - expected[i].x, (r.cy - expected[i].y))) : null);
  const ultSlot = document.querySelector('.bb-cluster.bb-p1 [data-slot="ultimate"]');
  return {
    layerVisible: getComputedStyle(document.querySelector('#bbHudLayer')).display !== 'none',
    chipCount: chips.length,
    chipDriftPx: drift,
    slots: [...document.querySelectorAll('.bb-cluster.bb-p1 .bb-slot')].map(s => ({
      slot: s.dataset.slot, cd: s.querySelector('.bb-cd')?.textContent, ready: s.classList.contains('ready')
    })),
    ultText: ultSlot?.querySelector('.bb-cd')?.textContent || null,
    meter: Number(window.fighters[0].meter || 0),
    formMeter: document.querySelector('.bb-cluster.bb-p1 [data-role="formmeter"] .bb-fill')?.style.width || null
  };
});
await shoot('match-hud');

// Fill the meter for real, then confirm the ULTIMATE slot flips to ready from that state.
await page.evaluate(() => { window.fighters[0].meter = 100; });
await page.waitForTimeout(600);
const ultReady = await page.evaluate(() => {
  const s = document.querySelector('.bb-cluster.bb-p1 [data-slot="ultimate"]');
  return { ready: s.classList.contains('ready'), cd: s.querySelector('.bb-cd').textContent, meterText: document.querySelector('.bb-cluster.bb-p1 [data-role="ult"]').textContent };
});
await shoot('hud-ultimate-ready');

// Pause overlay.
await page.evaluate(() => window.__browserSmashPause?.toggle());
await page.waitForTimeout(700);
const paused = await page.evaluate(() => ({
  pauseOpen: !document.querySelector('#pauseMenu')?.hidden,
  hudHiddenWhilePaused: getComputedStyle(document.querySelector('#bbHudLayer')).display === 'none'
}));
await shoot('pause');
await page.evaluate(() => window.__browserSmashPause?.toggle());
await page.waitForTimeout(400);

// Settings: audio and camera must move the real controls.
await page.evaluate(() => window.__bbUI.openSettings());
await page.waitForTimeout(600);
const settingsBefore = await page.evaluate(() => ({
  volume: Number(window.combatAudio?.volume ?? -1),
  zoom: document.querySelector('#cameraZoom')?.value || null,
  qualityOptionCount: document.querySelectorAll('#bbSettings [data-set="quality"] option').length
}));
await page.evaluate(() => {
  const vol = document.querySelector('#bbSettings [data-set="volume"]');
  vol.value = '0.2';
  vol.dispatchEvent(new Event('input', { bubbles: true }));
  const zoom = document.querySelector('#bbSettings [data-set="zoom"]');
  zoom.value = '2.2';
  zoom.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(500);
const settingsAfter = await page.evaluate(() => ({
  volume: Number(window.combatAudio?.volume ?? -1),
  zoom: document.querySelector('#cameraZoom')?.value || null
}));
await shoot('settings');
await page.evaluate(() => window.__bbUI.closeSettings());

// Results wiring: the game fires this event from finish(); confirm the actions attach.
const results = await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('browsersmash:matchend', { detail: { text: 'VICTORY', winner: 0 } }));
  return {
    actions: Boolean(document.querySelector('#bbResultActions')),
    buttons: [...document.querySelectorAll('#bbResultActions button')].map(b => b.textContent),
    titleCoveringResults: Boolean(document.querySelector('#bbTitle')) && getComputedStyle(document.querySelector('#bbTitle')).display !== 'none'
  };
});
await shoot('results-actions');

const report = { setupVisible, hudState, ultReady, paused, settingsBefore, settingsAfter, results, shots, errors };
await writeFile(`${out}/ui2-report.json`, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2));
console.log('UI2', JSON.stringify(report));
await browser.close(); server.close();
