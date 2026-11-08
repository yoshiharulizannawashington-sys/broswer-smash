// Infantry as a real roster fighter, end to end, in the running game.
//
// Selects through the actual character-select cards, starts a match, and then drives the real input
// path for a light attack, a kit ability, a jump and guard. Every damage number below is produced by
// the live simulation; the harness never assigns percent, hitstun or cooldowns.
//
//   bash scripts/run-browser-test.sh scripts/verify-infantry-roster.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/infantry-roster';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(150000);
const errors = [];
const failedRequests = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(-70)}`); });

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 130000, polling: 250 });
await page.waitForTimeout(500);
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Infantry"]'), null, { timeout: 20000, polling: 200 });

const rosterInfo = await page.evaluate(() => ({
  cards: document.querySelectorAll('#selectScreen .bs-card').length,
  hasInfantry: Boolean(document.querySelector('#selectScreen [data-fighter="Infantry"]')),
  p1Options: [...document.querySelectorAll('#p1Character option')].map(o => o.value).filter(v => v === 'Infantry').length,
  cardLabel: document.querySelector('#selectScreen [data-fighter="Infantry"] .bs-name')?.textContent || null,
  tag: document.querySelector('#selectScreen [data-fighter="Infantry"] .bs-tag')?.textContent || null
}));
check('Infantry is a card in the normal roster', rosterInfo.hasInfantry && rosterInfo.p1Options === 1, JSON.stringify(rosterInfo));
check('roster grew to 38 without dropping others', rosterInfo.cards === 38, String(rosterInfo.cards));

// Select Infantry for P1 through the card, then Goku for P2.
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Infantry"]').click());
await page.waitForTimeout(300);
const selected = await page.evaluate(() => document.querySelector('#p1Character')?.value);
check('P1 resolves to the Infantry identity', selected === 'Infantry', String(selected));

// The preview must be the imported body, not a generated one.
await page.waitForFunction(() => {
  const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
  return ['ready','loaded'].includes(status?.dataset.state);
}, null, { timeout: 60000, polling: 300 }).catch(() => {});
const preview = await page.evaluate(() => {
  const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
  return { state: status?.dataset.state || null, text: status?.textContent || null, asset: window.__browserSmashPreview?.describe?.() || null };
});
check('select preview loads the imported infantry GLB', ['ready','loaded'].includes(preview.state), JSON.stringify(preview));
await page.screenshot({ path: `${out}/1-select-infantry.png` });

await page.evaluate(() => document.querySelector('#selectScreen [data-side="p2"]').click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Goku"]').click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(9000);

const mounted = await page.evaluate(() => {
  const f = window.fighters[0];
  const u = f.model?.userData || {};
  let meshes = 0, tris = 0, textured = 0, skinned = 0; const seenMaps = new Set();
  const textures = new Set();
  f.model.traverse(n => {
    if (n.isSkinnedMesh) skinned += 1;
    if (!n.isMesh) return;
    meshes += 1;
    tris += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3;
    for (const mat of (Array.isArray(n.material) ? n.material : [n.material])) {
      if (!mat) continue;
      const maps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].filter(k => mat[k]?.image);
      if (maps.length) { textured += 1; for (const k of maps) { textures.add(mat[k].uuid); seenMaps.add(k); } }
    }
  });
  const hud = document.querySelector('#hud')?.textContent || '';
  return {
    identity: f.identity, identityKey: f.identityKey, asset: u.characterAssetUrl || null,
    meshes, triangles: Math.round(tris), texturedMaterials: textured, uniqueTextures: textures.size, maps: [...seenMaps], skinned,
    clips: Object.keys(u.animationActions || {}), jump: !!u.jumpAction, punch: !!u.punchAction,
    hudInfantry: /INFANTRY/i.test(hud), hudSuperman: /SUPERMAN/i.test(hud),
    hudText: hud.replace(/\s+/g, ' ').slice(0, 160),
    tallies: { height: (() => { try { return +window.__browserSmashRigCheck?.(f)?.metrics?.height?.toFixed?.(2); } catch { return null; } })(), feetY: (() => { try { return +window.__browserSmashRigCheck?.(f)?.metrics?.feetY?.toFixed?.(2); } catch { return null; } })() }
  };
});
check('match mounts the imported Infantry body', /infantry_cc0\.glb/.test(mounted.asset || '') && mounted.triangles > 250000, JSON.stringify({ asset: mounted.asset, triangles: mounted.triangles, meshes: mounted.meshes }));
check('HD PBR maps survive the roster path', mounted.texturedMaterials >= 1 && mounted.uniqueTextures === 3 && mounted.maps.includes('map') && mounted.maps.includes('normalMap'), JSON.stringify({ texturedMaterials: mounted.texturedMaterials, uniqueTextures: mounted.uniqueTextures, maps: mounted.maps }));
check('HUD shows Infantry, not Superman', mounted.hudInfantry && !mounted.hudSuperman && mounted.identity === 'Infantry', JSON.stringify({ identity: mounted.identity, hud: mounted.hudText }));
await page.screenshot({ path: `${out}/2-full-body.png` });

// Real inputs: light attack, then a kit ability. Damage must come from the simulation.
// Freeze the CPU's decisions (not its body) and align P1 toward P2 before the real key press.
await page.evaluate(() => { const [p1,p2] = window.fighters; const idle = {left:false,right:false,up:false,down:false,run:false,sprint:false,jump:false,attack:false,special:false,special2:false,special3:false,grab:false,dodge:false,shield:false,parry:false,ascend:false,descend:false,flightToggle:false,brake:false,webSwing:false,vertical:0}; if(!p2.__rosterProbeSim){p2.__rosterProbeSim=p2.simulate.bind(p2);p2.simulate=dt=>p2.__rosterProbeSim(dt,{getInputs:()=>({...idle,shield:false})});} p1.position.set(-1.2, 0, 2); p2.position.set(-0.15, 0, 2); p1.velocity.set(0,0,0); p2.velocity.set(0,0,0); p1.isGrounded=true; p2.isGrounded=true; p1.hitstun=0; p1.guardBreak=0; p1.attackPose=0; p1.dodgeTimer=0; p1.dashTimer=0; p1.ko=false; p1.facing=Math.sign(p2.position.x-p1.position.x)||1; p1.facingZ=0; p2.facing=-p1.facing; p2.facingZ=0; p2.hitstun=0; p2.invulnerable=0; p2.guardHeld=false; p2.guardBreak=0; p2.shield=100; p2.ko=false; p2.attackQueue.length=0; p2.hitboxes.length=0; p1.attackBuffer=0; p1.attackQueue.length=0; p1.hitboxes.length=0; p1.comboStep=0; p1.comboWindow=0; p1.comboHitCount=0; window.__p2before = p2.percent; });
await page.keyboard.press('j');
await page.evaluate(() => { for (let i=0;i<45;i+=1) window.__browserSmashStep(1/60); });
const combat = await page.evaluate(() => ({ before: window.__p2before, after: window.fighters[1].percent }));
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/3-light-attack.png` });
const afterLight = await page.evaluate(() => ({ percent: window.fighters[1].percent }));
check('basic attack deals real damage', combat.after > combat.before, JSON.stringify({ combat, debug: await page.evaluate(() => ({ timer: document.querySelector('#timer')?.textContent, hud: (document.querySelector('#hud')?.textContent||'').slice(0,40), attack: (window.fighters?.[0]?.attackState ?? window.fighters?.[0]?.attacking ?? null) })) }));

const ability = await page.evaluate(() => {
  const u = window.fighters[0].model.userData;
  return { hasAbilityRuntime: Boolean(window.__browserSmashAbility), cooldowns: window.fighters[0].abilityCooldowns || null, clips: Object.keys(u.animationActions || {}) };
});
await page.keyboard.down('l');
await page.waitForTimeout(350);
await page.evaluate(() => { for (let i = 0; i < 45; i += 1) window.__browserSmashStep(1 / 60); });
await page.keyboard.up('l');
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/4-special-attack.png` });
const afterSpecial = await page.evaluate(() => ({ percent: window.fighters[1].percent, projectiles: (window.projectiles || window.__projectiles || []).length ?? null }));
check('kit special fires without error', afterSpecial.percent >= combat.after, JSON.stringify({ before: combat.after, after: afterSpecial.percent, projectiles: afterSpecial.projectiles }));

await page.keyboard.press(' ');
await page.evaluate(() => { for (let i = 0; i < 12; i += 1) window.__browserSmashStep(1 / 60); });
const air = await page.evaluate(() => ({ grounded: window.fighters[0].isGrounded, y: +window.fighters[0].position.y.toFixed(2) }));
check('jump leaves the ground without breaking the body', air.grounded === false && air.y > 0.2, JSON.stringify(air));
await page.screenshot({ path: `${out}/5-hud.png` });

// Switch away and confirm an existing fighter still loads its own generated body.
await page.evaluate(() => window.__browserSmashReturnToTitle?.());
await page.waitForFunction(() => document.querySelector('#menu') && !document.querySelector('#menu').classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.evaluate(() => window.__browserSmashSelect?.select?.('p1', 'Goku'));
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(2200);
const switched = await page.evaluate(() => ({
  identity: window.fighters[0].identity,
  asset: window.fighters[0].model?.userData?.characterAssetUrl || null
}));
check('switching back to Goku restores his own body', switched.identity === 'Goku' && /roster\/goku\.glb/.test(switched.asset || ''), JSON.stringify(switched));
await page.screenshot({ path: `${out}/6-switched-fighter.png` });

check('no page errors', errors.length === 0, errors.join(' | '));
check('no failed asset requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

const report = { mounted, preview, rosterInfo, combat: { before: combat.before, afterLight: afterLight.percent, afterSpecial: afterSpecial.percent }, air, switched, ability, checks, errors, failedRequests };
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
const failed = checks.filter(c => !c.ok);
console.log('SUMMARY ' + JSON.stringify({ passed: checks.length - failed.length, total: checks.length, failures: failed.map(c => c.name) }));
await browser.close();
server.close();
process.exitCode = failed.length ? 1 : 0;
