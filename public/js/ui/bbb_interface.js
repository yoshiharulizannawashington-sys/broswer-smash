// Browser Bros interface layer: camera-aware HUD, title screen, settings and results actions.
//
// This is deliberately a separate module rather than edits inside main.js: the combat camera,
// fighter state and existing menu flows are reused read-only, so a HUD bug cannot destabilise the
// simulation. Everything shown here is driven by live game state - no decorative meters.
//
// Camera contract (the actual combat camera sits behind and above P1, looking at the CPU):
//   P1 plate top-left, CPU plate top-right, clock top-centre (that part lives in the entry file),
//   floating health chips over the real fighters, abilities and ultimates in the bottom corners,
//   and nothing in the middle of the screen.
//
// Floating chips are positioned by projecting each fighter's head bone through the live camera and
// converting to pixels, so they track the fighter through zooms, follows and aerial combat.

const THREE = () => window.__browserSmashThree;
const ULT_MAX = 100;

const CSS_READY = () => Boolean(document.querySelector('#bbHudLayer'));

function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}

function fighterAt(i) {
  const list = window.fighters || [];
  return list[i] || null;
}

function label(fighter, fallback) {
  // The roster's identity carries the readable name ("Hulk (Bruce Banner)"); identityKey is the
  // asset slug ("hulk_bruce_banner") and made the floating chip truncate to "HULK BRUCE ...".
  // Drop the parenthetical real name so the plate stays short enough to read at a glance.
  const name = fighter?.displayName || fighter?.identity || fighter?.identityKey || fighter?.type || '';
  const short = String(name).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/_/g, ' ').trim().toUpperCase();
  return short || fallback;
}

function cooldownOf(fighter, key) {
  const table = fighter?.abilityReadyAt;
  if (!table || typeof table !== 'object') return null;
  const now = performance.now() / 1000;
  const values = Object.values(table).map(v => Math.max(0, Number(v) || 0) - now).filter(v => Number.isFinite(v));
  if (!values.length) return null;
  // The longest remaining cooldown is the one worth showing: it is when the kit is fully back.
  return Math.max(...values);
}

function paintSlot(slot, { ready, remaining, value, max, note }) {
  if (!slot) return;
  const fill = slot.querySelector('.bb-fill');
  const cd = slot.querySelector('.bb-cd');
  const pct = max ? Math.max(0, Math.min(1, (value || 0) / max)) : 0;
  if (fill) fill.style.width = (ready ? 100 : Math.round(pct * 100)) + '%';
  if (cd) cd.textContent = ready ? (note || 'READY') : (remaining > 0 ? remaining.toFixed(1) + 's' : note || 'CHARGING');
  slot.classList.toggle('ready', Boolean(ready));
}

/** Build one ability cluster (bottom-left for P1, bottom-right for the CPU). */
function cluster(side) {
  const root = el('div', 'bb-cluster bb-' + side);
  root.innerHTML = `
    <div class="bb-cluster-head"><span>${side === 'p1' ? 'PLAYER 1' : 'CPU'}</span><b data-role="ult">0%</b></div>
    <div class="bb-slots"></div>`;
  return root;
}

function slot(id, name, key) {
  const node = el('div', 'bb-slot', `
    <span class="bb-key">${key}</span>
    <span class="bb-name">${name}</span>
    <span class="bb-cd">READY</span>
    <div class="bb-track"><div class="bb-fill"></div></div>`);
  node.dataset.slot = id;
  return node;
}

function buildHud() {
  const layer = el('div');
  layer.id = 'bbHudLayer';
  layer.innerHTML = '';

  const chips = el('div', 'bb-floats');
  const chipP1 = el('div', 'bb-float p1', '<span class="bb-fname"></span><div class="bb-track"><div class="bb-fill"></div></div><b class="bb-fpct">0%</b>');
  const chipP2 = el('div', 'bb-float p2', '<span class="bb-fname"></span><div class="bb-track"><div class="bb-fill"></div></div><b class="bb-fpct">0%</b>');
  chips.append(chipP1, chipP2);
  layer.append(chips);

  const p1 = cluster('p1');
  const cpu = cluster('cpu');
  p1.querySelector('.bb-slots').append(
    slot('light', 'LIGHT', 'J'),
    slot('heavy', 'HEAVY', '⇧J'),
    slot('signature', 'SIGNATURE', 'K'),
    slot('ultimate', 'ULTIMATE', 'O')
  );
  cpu.querySelector('.bb-slots').append(
    slot('signature', 'SIGNATURE', '·'),
    slot('ability', 'ABILITY', '·'),
    slot('ultimate', 'ULTIMATE', 'M')
  );
  layer.append(p1, cpu);
  // The clock, round score, status line and combo banner are declared in the entry file (main.js
  // writes them directly) and adopted here, so there is one match HUD rather than two overlays.
  const matchBar = document.getElementById('bbMatchBar');
  if (matchBar) layer.appendChild(matchBar);
  document.body.appendChild(layer);
  return { layer, chipP1, chipP2, p1, cpu };
}

/** Project a fighter's head into screen pixels using the live camera. */
const scratch = () => new (THREE().Vector3)();
function projectFighter(fighter) {
  const camera = window.smashCamera?.camera;
  const T = THREE();
  if (!camera || !T || !fighter?.model) return null;
  const head = fighter.model.userData?.head;
  const v = scratch();
  if (head?.getWorldPosition) head.getWorldPosition(v);
  else v.set(fighter.position?.x || 0, (fighter.position?.y || 0) + 2.2, fighter.position?.z || 0);
  v.y += 0.3;
  v.project(camera);
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
  const behind = v.z > 1;
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    behind
  };
}

function placeChip(chip, point, percent, safeTop = 8) {
  if (!chip) return;
  const width = chip.offsetWidth || 96;
  const height = chip.offsetHeight || 24;
  const margin = 8;
  const half = width / 2;
  // Hide a plate whose fighter has left the frame instead of parking a detached label on the edge.
  const off = !point || point.behind
    || point.x < -width || point.x > window.innerWidth + width
    || point.y < -height * 2 || point.y > window.innerHeight + height * 2;
  chip.style.opacity = off ? '0' : '1';
  if (off) return;
  // Keep the whole plate inside the viewport and below the match bar, even for an airborne or
  // cornered fighter. Rounding keeps the text on whole pixels instead of shimmering while moving.
  const x = Math.min(Math.max(point.x, half + margin), window.innerWidth - half - margin);
  const y = Math.min(Math.max(point.y, safeTop + height), window.innerHeight - margin);
  chip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
  const fill = chip.querySelector('.bb-fill');
  if (fill) fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
  const pct = chip.querySelector('.bb-fpct');
  if (pct) pct.textContent = Math.round(percent) + '%';
}

/** Settings: audio, graphics preset, camera distance and view, all bound to real controls. */
function buildSettings() {
  const panel = el('div');
  panel.id = 'bbSettings';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="bb-set-panel" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="bb-set-head"><span>SYSTEM</span><h2>SETTINGS</h2></div>
      <div class="bb-set-grid">
        <div class="bb-set-card">
          <h3>AUDIO</h3>
          <label>MASTER <input type="range" min="0" max="1" step="0.05" data-set="volume"></label>
          <label>MUSIC <input type="range" min="0" max="1" step="0.05" data-set="music"></label>
          <button type="button" data-set="mute">TOGGLE MUTE</button>
        </div>
        <div class="bb-set-card">
          <h3>GRAPHICS</h3>
          <label>QUALITY <select data-set="quality"></select></label>
          <p class="bb-set-note" data-role="qualityNote">Quality applies to the live renderer.</p>
        </div>
        <div class="bb-set-card">
          <h3>CAMERA</h3>
          <label>DISTANCE <input type="range" min="0.75" max="3.2" step="0.05" data-set="zoom"></label>
          <label>VIEW <select data-set="mode">
            <option value="overhead">Overhead · Cinematic</option>
            <option value="over-p1">Over P1 · Follow</option>
            <option value="forward">Forward-facing arena</option>
            <option value="classic">Classic wide view</option>
          </select></label>
        </div>
        <div class="bb-set-card">
          <h3>CONTROLS</h3>
          <p><b>WASD</b> move · <b>SHIFT</b> sprint / dash · <b>SPACE</b> jump</p>
          <p><b>J</b> attack · <b>K</b> signature · <b>O</b> ultimate · <b>I</b> transform</p>
          <p><b>E</b> guard / parry · <b>U</b> throw · <b>F</b> flight · <b>ESC</b> pause</p>
        </div>
      </div>
      <div class="bb-set-foot"><button type="button" class="bb-set-close" data-set="close">DONE</button></div>
    </div>`;
  document.body.appendChild(panel);
  return panel;
}

function wireSettings(panel) {
  const audio = window.combatAudio;
  const vol = panel.querySelector('[data-set="volume"]');
  const music = panel.querySelector('[data-set="music"]');
  const mute = panel.querySelector('[data-set="mute"]');
  const quality = panel.querySelector('[data-set="quality"]');
  const zoom = panel.querySelector('[data-set="zoom"]');
  const mode = panel.querySelector('[data-set="mode"]');

  const initialVolume = Number(audio?.volume ?? 0.55);
  if (vol) {
    vol.value = String(initialVolume);
    vol.addEventListener('input', () => audio?.setVolume?.(Number(vol.value)));
  }
  if (music) {
    music.value = '0.5';
    music.addEventListener('input', () => audio?.setMusicVolume?.(Number(music.value)));
  }
  if (mute) {
    mute.addEventListener('click', () => {
      const off = !(audio?.muted);
      audio?.setMuted?.(off);
      mute.textContent = off ? 'SOUND OFF' : 'TOGGLE MUTE';
    });
  }
  if (quality) {
    // Drive the game's own preset API (window.setGraphicsPreset), which rescales the renderer and
    // keeps its built-in control in sync - so this select can never claim a quality the renderer
    // is not using.
    const real = () => document.querySelector('#graphicsQuality') || document.querySelector('#qualitySelect');
    const options = real()?.querySelectorAll('option');
    quality.innerHTML = options?.length
      ? [...options].map(o => `<option value="${o.value}">${o.textContent}</option>`).join('')
      : '<option value="">UNAVAILABLE</option>';
    const live = () => window.__graphicsPresetName || real()?.value;
    if (options?.length) quality.value = live();
    quality.addEventListener('change', () => {
      if (typeof window.setGraphicsPreset === 'function') window.setGraphicsPreset(quality.value);
      const target = real();
      if (target && target.value !== quality.value) {
        target.value = quality.value;
        target.dispatchEvent(new Event('change', { bubbles: true }));
      }
      quality.value = live();
      panel.querySelector('[data-role="qualityNote"]').textContent = 'Live renderer preset: ' + String(quality.value).toUpperCase();
    });
  }
  const zoomTarget = document.querySelector('#cameraZoom');
  if (zoom && zoomTarget) {
    zoom.value = zoomTarget.value;
    zoom.addEventListener('input', () => {
      if (window.BrowserSmash?.setCameraZoom) {
        const applied = window.BrowserSmash.setCameraZoom(Number(zoom.value));
        zoom.value = String(applied);
        zoomTarget.value = String(applied);
        return;
      }
      zoomTarget.value = zoom.value;
      zoomTarget.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  const modeTarget = document.querySelector('#cameraMode');
  if (mode && modeTarget) {
    mode.value = modeTarget.value;
    mode.addEventListener('change', () => {
      modeTarget.value = mode.value;
      modeTarget.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  panel.querySelector('[data-set="close"]')?.addEventListener('click', () => { panel.hidden = true; });
  panel.addEventListener('click', event => { if (event.target === panel) panel.hidden = true; });
}

/** Title screen: the landing menu, over the existing setup screen rather than replacing it. */
function buildTitle() {
  const node = el('div');
  node.id = 'bbTitle';
  node.innerHTML = `
    <div class="bb-title-art">
      <div class="bb-title-kicker">A CINEMATIC ARENA FIGHTER</div>
      <h1 class="bb-title-logo">BROWSER<span>BROS</span></h1>
      <div class="bb-title-rule"></div>
      <nav class="bb-title-nav">
        <button type="button" data-nav="versus"><b>VERSUS</b><small>Pick fighters and an arena</small></button>
        <button type="button" data-nav="training"><b>TRAINING</b><small>Practice combos on a dummy</small></button>
        <button type="button" data-nav="explore"><b>EXPLORE</b><small>Walk the world between battles</small></button>
        <button type="button" data-nav="settings"><b>SETTINGS</b><small>Audio, graphics, camera</small></button>
      </nav>
      <div class="bb-title-foot"><span>ESC pause</span><span>J attack</span><span>K signature</span><span>O ultimate</span></div>
    </div>`;
  return node;
}

function mountTitle(menu) {
  const panel = menu.querySelector('.panel');
  if (!panel) return null;
  if (panel.querySelector('#bbTitle')) return panel.querySelector('#bbTitle');
  const node = buildTitle();
  panel.prepend(node);
  node.addEventListener('click', event => {
    const button = event.target.closest('[data-nav]');
    if (!button) return;
    if (button.dataset.nav === 'versus') { menu.classList.remove('bb-title', 'bb-result'); menu.classList.add('bb-setup'); return; }
    if (button.dataset.nav === 'training') { window.BrowserSmash?.startTraining?.(); return; }
    if (button.dataset.nav === 'explore') { window.BrowserSmash?.startExplore?.(); return; }
    if (button.dataset.nav === 'settings') { openSettings(); }
  });
  return node;
}

let settingsPanel = null;
export function openSettings() {
  if (!settingsPanel) {
    settingsPanel = buildSettings();
    wireSettings(settingsPanel);
  }
  settingsPanel.hidden = false;
}

function mountResultsActions() {
  window.addEventListener('browsersmash:matchend', event => {
    const result = document.querySelector('#result');
    if (!result) return;
    // A loss is a real match outcome, not a colour choice: the game reports it in the result text
    // and in the winner field, so the screen can style itself from either.
    const text = String(event.detail?.text || '').toUpperCase();
    const defeat = text.startsWith('DEFEAT') || event.detail?.winner === 'p2';
    result.classList.toggle('bb-defeat', defeat);
    document.querySelector('#menu')?.classList.toggle('bb-defeat', defeat);
    if (result.querySelector('#bbResultActions')) return;
    const actions = el('div', null, `
      <button type="button" data-result="rematch">REMATCH</button>
      <button type="button" data-result="select">CHARACTER SELECT</button>
      <button type="button" data-result="title">MAIN MENU</button>`);
    actions.id = 'bbResultActions';
    actions.addEventListener('click', event => {
      const button = event.target.closest('[data-result]');
      if (!button) return;
      const menu = document.querySelector('#menu');
      if (button.dataset.result === 'rematch') { window.BrowserSmash?.rematch?.(); return; }
      // Character select: hand the panel back to the real setup screen at step 1, so the player can
      // change fighter, arena or rules and fight again from the same screen the flow started on.
      if (button.dataset.result === 'select') {
        menu?.classList.remove('bb-result', 'bb-defeat');
        menu?.classList.add('bb-setup');
        result.innerHTML = '';
        window.__browserSmashSelect?.show?.();
        return;
      }
      // Main menu: let the engine leave the match, then restore the title screen.
      window.BrowserSmash?.returnToTitle?.();
    });
    result.appendChild(actions);
  });
}

/**
 * Match loading screen.
 *
 * It is a real gate rather than an animation: the bar is the fraction of the game's own critical
 * assets reporting `loaded` (the same flags main.js prints into #loading), the status line is the
 * renderer's actual status, and it clears only once the world is running and has drawn frames.
 * It therefore cannot hide a slow load, and it cannot outstay a fast one by more than a beat.
 */
function mountLoading() {
  const node = el('div');
  node.id = 'bbLoading';
  node.hidden = true;
  node.innerHTML = `
    <div class="bb-load-inner">
      <div class="bb-load-kicker">BROWSER BROS · MATCH</div>
      <div class="bb-load-match"><span data-role="p1">PLAYER 1</span><i>VS</i><span data-role="p2">CPU</span></div>
      <div class="bb-load-arena" data-role="arena"></div>
      <div class="bb-load-track"><div class="bb-load-fill" data-role="fill"></div></div>
      <div class="bb-load-status" data-role="status">PREPARING</div>
    </div>`;
  document.body.appendChild(node);

  const nameOf = (index, fallback) => {
    const fighter = fighterAt(index);
    const source = fighter?.identityKey || fighter?.type || '';
    return source ? String(source).replace(/_/g, ' ').toUpperCase() : fallback;
  };
  const arenaOf = () => {
    const key = document.querySelector('#mapSelect')?.value || 'valley';
    const option = document.querySelector(`#mapSelect option[value="${key}"]`);
    return (option?.textContent || key).split('·')[0].trim().toUpperCase();
  };
  const assets = () => window.__browserSmashAssets || {};
  const critical = () => [assets().characters, assets().weapons, assets().finalValley];

  let visible = false;
  let shownAt = 0;
  let framesAtShow = 0;

  const paint = () => {
    const parts = critical();
    const done = parts.filter(part => part?.status === 'loaded').length;
    const failed = parts.some(part => part && ['error', 'fallback', 'partial'].includes(part.status));
    const running = assets().app?.status === 'running';
    const frames = window.__browserSmashFrames || 0;
    node.querySelector('[data-role="p1"]').textContent = nameOf(0, 'PLAYER 1');
    node.querySelector('[data-role="p2"]').textContent = nameOf(1, 'CPU');
    node.querySelector('[data-role="arena"]').textContent = arenaOf();
    node.querySelector('[data-role="fill"]').style.width = Math.round((done / parts.length) * 100) + '%';
    node.querySelector('[data-role="status"]').textContent = failed
      ? 'ASSET FALLBACK · FIGHTING ANYWAY'
      : running && done === parts.length
        ? '3D WORLD READY · ENTERING ARENA'
        : `LOADING 3D ASSETS · ${done}/${parts.length}`;
    // Clear only on real readiness (or a real fallback), and only after the world has drawn, so the
    // screen never lifts onto an empty canvas.
    const settled = (running && done === parts.length) || (failed && running);
    if (visible && settled && frames > framesAtShow + 1 && performance.now() - shownAt > 450) hide();
  };

  function show() {
    if (visible) return;
    visible = true;
    shownAt = performance.now();
    framesAtShow = window.__browserSmashFrames || 0;
    node.hidden = false;
    paint();
    requestAnimationFrame(function loop() {
      if (!visible) return;
      paint();
      requestAnimationFrame(loop);
    });
  }
  function hide() {
    if (!visible) return;
    visible = false;
    node.hidden = true;
  }

  // Both match entry points (versus and practice) run through these real buttons.
  document.addEventListener('click', event => {
    if (event.target.closest('#play, #practice')) show();
  }, true);
  window.addEventListener('browsersmash:matchend', hide);
  return { show, hide, describe: () => ({ visible, status: node.querySelector('[data-role="status"]')?.textContent, fill: node.querySelector('[data-role="fill"]')?.style.width }) };
}

function boot() {
  if (CSS_READY()) return;
  const menu = document.querySelector('#menu');
  if (menu) {
    mountTitle(menu);
    // Boot lands on the title, but a finished match must land on its results panel instead.
    menu.classList.add('bb-title');
    window.addEventListener('browsersmash:matchend', () => {
      menu.classList.remove('bb-title', 'bb-setup');
      menu.classList.add('bb-result');
    });
  }
  const hud = buildHud();
  mountResultsActions();
  const loadingScreen = mountLoading();
  window.__bbLoading = loadingScreen;

  const tick = () => {
    requestAnimationFrame(tick);
    const menuOpen = menu ? !menu.classList.contains('hidden') : false;
    // A cinematic owns the frame. The intro hides the rest of the HUD through its own selectors,
    // which this later layer is not part of, so leaving it on painted living health chips and
    // cooldown plates straight through the entrances. Trust the presentation report rather than
    // the mere existence of #browserSmashCinematic: that node outlives the intro by several
    // seconds, which left the match HUD hidden after the entrances had already finished.
    const cinematic = window.__browserSmashPresentation?.report?.().intro?.active === true;
    // The staged victory/defeat camera is part of the match presentation, not live combat. It
    // owns the frame just like the intro, but only the fighter-attached floats need to leave:
    // the match bar, ability clusters and result panel must remain available.
    const match = window.__browserSmashMatch?.() || null;
    const stagedPresentation = !menuOpen && !cinematic && (
      Boolean(window.smashCamera?.spectateState) || match?.status === 'match-over'
    );
    // The control legend, arena status line and roster button live outside #hud too, so the body
    // carries the cinematic state and the stylesheet hides them with it.
    document.body.classList.toggle('bb-cinematic', cinematic);
    hud.layer.classList.toggle('bb-presentation', stagedPresentation);
    const inMatch = Boolean(fighterAt(0) && fighterAt(1)) && !menuOpen && !cinematic;
    hud.layer.style.display = inMatch ? '' : 'none';
    hud.layer.classList.toggle('bb-hidden', !inMatch);
    if (!inMatch) return;

    const p1 = fighterAt(0);
    const cpu = fighterAt(1);
    const p1hp = 100 - Math.max(0, Math.min(100, Number(p1.percent) || 0));
    const cpuHp = 100 - Math.max(0, Math.min(100, Number(cpu.percent) || 0));

    // Do not let the per-frame projector make either chip visible again while the staged
    // presentation is running. The class gate hides both chips; this guard also skips their
    // DOM/label updates so a later frame cannot undo the presentation state.
    if (!stagedPresentation) {
      hud.chipP1.querySelector('.bb-fname').textContent = label(p1, 'P1');
      hud.chipP2.querySelector('.bb-fname').textContent = label(cpu, 'CPU');
      // Reserve the top band occupied by the clock/round bar so a high-flying fighter's plate
      // never slides underneath it.
      const safeTop = (document.getElementById('bbMatchBar')?.getBoundingClientRect().bottom || 0) + 8;
      placeChip(hud.chipP1, projectFighter(p1), p1hp, safeTop);
      placeChip(hud.chipP2, projectFighter(cpu), cpuHp, safeTop);
    }

    const paintCluster = (root, fighter, isCpu) => {
      const ult = Math.max(0, Math.min(ULT_MAX, Number(fighter.meter) || 0));
      const ultReady = ult >= ULT_MAX && !fighter.casting;
      const sigCd = Number(fighter.specialCooldown) || 0;
      const kitCd = cooldownOf(fighter);
      // Ultimate and transformation meters belong to the fighter plates in the top corners; this
      // cluster repeats only the ultimate percentage so a player checking cooldowns never has to
      // look away, without drawing a second set of meters.
      root.querySelector('[data-role="ult"]').textContent = Math.round(ult) + '%';

      const byId = id => root.querySelector(`[data-slot="${id}"]`);
      paintSlot(byId('light'), { ready: !(fighter.attackLock > 0), note: 'READY' });
      paintSlot(byId('heavy'), { ready: !(fighter.attackLock > 0), note: 'READY' });
      const sig = byId('signature');
      if (sig) {
        sig.querySelector('.bb-name').textContent = String(fighter.specialProfile?.label || 'SIGNATURE').slice(0, 18).toUpperCase();
        paintSlot(sig, { ready: sigCd <= 0, remaining: sigCd });
      }
      paintSlot(byId('ultimate'), { ready: ultReady, remaining: (ULT_MAX - ult) / ULT_MAX, note: ultReady ? 'READY' : Math.round(ult) + '%' });
      const ability = byId('ability');
      if (ability) paintSlot(ability, { ready: kitCd === null || kitCd <= 0, remaining: kitCd || 0, note: isCpu ? 'CPU' : 'READY' });
      paintSlot(byId('ability'), { ready: kitCd === null || kitCd <= 0, remaining: kitCd || 0 });
    };

    paintCluster(hud.p1, p1, false);
    paintCluster(hud.cpu, cpu, true);
  };
  requestAnimationFrame(tick);

  window.__bbUI = {
    openSettings,
    closeSettings: () => { if (settingsPanel) settingsPanel.hidden = true; },
    settingsPanel: () => settingsPanel,
    describe: () => ({
      hud: Boolean(document.querySelector('#bbHudLayer')),
      title: Boolean(document.querySelector('#bbTitle')),
      settings: Boolean(document.querySelector('#bbSettings')),
      presentation: Boolean(document.querySelector('#bbHudLayer')?.classList.contains('bb-presentation')),
      floats: [...document.querySelectorAll('.bb-float')].map(n => ({ transform: n.style.transform, hidden: n.hidden, width: Math.round(n.getBoundingClientRect().width) })),
      slots: [...document.querySelectorAll('.bb-slot')].map(n => ({
        slot: n.dataset.slot, cls: n.className, cd: n.querySelector('.bb-cd')?.textContent
      }))
    })
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
