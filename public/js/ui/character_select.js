// Match setup: choose a fighter (both sides), then an arena, then start.
//
// The screen is built at runtime from the roster the game actually has, and it drives the
// existing <select> elements, so the character-swap and map-loading code in main.js stays
// the single implementation. Because the arena is rendered behind the menu, hovering or
// choosing an arena streams the real environment in as its preview instead of showing a
// static picture.

import { MOVESETS, slugOf } from '../combat/movesets.js';
import { abilitiesFor, LIGHT_EXTENSIONS } from '../combat/ability_kit.js';
import { createFighterPreview } from './fighter_preview.js';

const ARCHETYPE_COLORS = {
  warrior: '#ff6a55', ninja: '#3bc8ff', brawler: '#e9a04d', mage: '#a18aff', cyborg: '#48e7d5'
};

const CSS = `
#selectScreen{--ink:#eaf7ff;--dim:#8db4cc;--line:#4ddfff55;--hot:#54eaff;width:min(1180px,96vw);height:min(86dvh,780px);display:flex;flex-direction:column;gap:12px;color:var(--ink);text-align:left;text-shadow:0 2px 12px #000}
#menu .panel.bs-hosting{width:min(1240px,96vw);max-width:1240px;padding:14px 18px}
#menu.bs-select-open{background:linear-gradient(180deg,#030910a8,#04111dd4);backdrop-filter:blur(2px)}
/* The menu must be gone the instant a match starts, even on a slow software renderer
   where the opacity transition never gets a frame. */
#menu.hidden{opacity:0!important;visibility:hidden!important;pointer-events:none!important;transition:none!important}
body.in-menu #hud,body.in-menu #energyHUD,body.in-menu #comboNotice,body.in-menu #cameraSettings,body.in-menu #roundScore,body.in-menu #executeHint{display:none!important}
#menu .panel.bs-hosting>.eyebrow,#menu .panel.bs-hosting>.title,#menu .panel.bs-hosting>.sub{display:none}
#selectScreen .bs-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
#selectScreen .bs-eyebrow{font:900 10px/1 system-ui;letter-spacing:.34em;color:var(--hot)}
#selectScreen .bs-title{margin:6px 0 0;font:1000 clamp(26px,4.4vw,46px)/.95 system-ui;letter-spacing:-.03em;text-shadow:0 0 26px #00bfff66}
#selectScreen .bs-title span{color:var(--hot)}
#selectScreen .bs-steps{display:flex;gap:8px;font:900 10px/1 system-ui;letter-spacing:.18em;color:var(--dim)}
#selectScreen .bs-steps b{padding:7px 12px;border:1px solid #ffffff18;background:#07172699}
#selectScreen .bs-steps b.on{border-color:var(--hot);color:#06131f;background:linear-gradient(100deg,#39e6ff,#8ef7ff);text-shadow:none}
#selectScreen .bs-body{min-height:0;flex:1;overflow-y:auto;overflow-x:hidden;padding:2px;scrollbar-width:thin;scrollbar-color:#3bd7f5 #071726}
#selectScreen .bs-body::-webkit-scrollbar{width:8px}#selectScreen .bs-body::-webkit-scrollbar-thumb{background:#3bd7f5;border-radius:8px}
#selectScreen .bs-step{display:flex;flex-direction:column;gap:10px}
#selectScreen .bs-step[hidden]{display:none}
#selectScreen .bs-mode{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
#selectScreen .bs-mode button{pointer-events:auto;padding:8px 14px;font:900 10px/1 system-ui;letter-spacing:.14em;border:1px solid #4ddfff66;background:#071726cc;color:#cfeeff;cursor:pointer}
#selectScreen .bs-mode button.on{border-color:#7ef0ff;background:linear-gradient(100deg,#0a6f8c,#17c6d6);color:#02121c}
#selectScreen .bs-sides{display:flex;gap:8px}
#selectScreen .bs-side{flex:1;padding:9px 12px;border:1px solid #ffffff18;background:#07172699;cursor:pointer;font:900 11px/1.25 system-ui;letter-spacing:.1em;color:#bfe4f7}
#selectScreen .bs-side small{display:block;font:800 9px/1.4 system-ui;letter-spacing:.08em;color:#7fb2c9;margin-top:3px}
#selectScreen .bs-side.on{border-color:var(--hot);background:linear-gradient(100deg,#0a2c3f,#123c52);box-shadow:inset 0 0 22px #22dfff22}
#selectScreen .bs-rules{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;padding:9px 12px;border:1px solid #ffffff14;background:#07172699}
#selectScreen .bs-rules label{display:flex;flex-direction:column;gap:5px;font:900 9px/1 system-ui;letter-spacing:.16em;color:#7fb2c9}
#selectScreen .bs-rules select{pointer-events:auto;background:#0a1b2d;color:#eafaff;border:1px solid #4ddfff88;padding:6px 8px;font:800 10px/1 system-ui;letter-spacing:.06em}
#selectScreen .bs-rules select:disabled{opacity:.45}
#selectScreen .bs-rules .bs-rulehint{font:800 9px/1.6 system-ui;letter-spacing:.05em;color:#8fb6cb;max-width:34ch}
#selectScreen .bs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:7px}
#selectScreen .bs-card{position:relative;pointer-events:auto;cursor:pointer;border:1px solid #2b4d6488;background:linear-gradient(150deg,#0a1a28ee,#0d2436ee);padding:9px 10px 9px 12px;text-align:left;color:#d7ecf8;overflow:hidden;transition:transform .12s,border-color .12s,background .12s}
#selectScreen .bs-card:hover{transform:translateY(-2px);border-color:#7ef0ff}
#selectScreen .bs-card:before{content:'';position:absolute;inset:0 auto 0 0;width:3px;background:var(--c,#54eaff)}
#selectScreen .bs-card .bs-no{font:900 9px/1 system-ui;letter-spacing:.16em;color:#6fa6bd}
#selectScreen .bs-card .bs-name{display:block;margin-top:4px;font:900 12px/1.18 system-ui;letter-spacing:.02em;color:#f2fbff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#selectScreen .bs-card .bs-tag{display:block;margin-top:5px;font:900 8px/1 system-ui;letter-spacing:.16em;color:var(--c,#54eaff)}
#selectScreen .bs-card.p1{border-color:#5ee6ff;box-shadow:0 0 0 1px #5ee6ff66,0 0 22px #0bd6ff33;background:linear-gradient(150deg,#0b3046ee,#0d3a52ee)}
#selectScreen .bs-card.p2{border-color:#ffad57;box-shadow:0 0 0 1px #ffad5766,0 0 22px #ff8a2c33;background:linear-gradient(150deg,#3a2413ee,#2c2018ee)}
#selectScreen .bs-card.p1:after,#selectScreen .bs-card.p2:after{position:absolute;top:6px;right:7px;font:900 8px/1 system-ui;letter-spacing:.1em;padding:3px 5px;color:#04131d;background:#7ef0ff}
#selectScreen .bs-card.p1:after{content:'P1'}
#selectScreen .bs-card.p2:after{content:attr(data-side-label)}
#selectScreen .bs-matchline{font:800 11px/1.7 system-ui;letter-spacing:.09em;color:#a8cfe4;padding:4px 2px 0}
#selectScreen .bs-movelist{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;border:1px solid #ffffff14;background:linear-gradient(150deg,#07172699,#0a1e2e77);padding:10px 12px}
#selectScreen .bs-movelist h4{margin:0 0 5px;font:900 9px/1 system-ui;letter-spacing:.2em;color:#7fd8f2}
#selectScreen .bs-movelist p{margin:0 0 4px;font:700 10px/1.5 system-ui;letter-spacing:.03em;color:#cfe6f5}
#selectScreen .bs-movelist p b{color:#eafaff;font-weight:900}
#selectScreen .bs-movelist .bs-keycap{display:inline-block;min-width:14px;padding:1px 4px;margin-right:4px;background:#123c52;border:1px solid #4ddfff66;color:#bdf3ff;font:900 9px/1.2 system-ui;text-align:center}
#selectScreen .bs-movelist .bs-note{grid-column:1/-1;color:#8fb6cb;font:700 9px/1.5 system-ui}
#selectScreen .bs-matchline b{color:#eafaff}
#selectScreen .bs-arenas{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;max-height:52vh;overflow:auto;padding-right:4px}
#selectScreen .bs-worldtabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
#selectScreen .bs-worldtabs button{pointer-events:auto;cursor:pointer;border:1px solid #2b4d64;background:#08131f;color:#a8cfe4;font:800 10px/1 system-ui;letter-spacing:.12em;padding:8px 12px;text-transform:uppercase}
#selectScreen .bs-worldtabs button.on{border-color:#ffd76c;color:#ffe9a8;background:#1b1a10;box-shadow:0 0 18px #ffbb3344}
#selectScreen .bs-arena{position:relative;pointer-events:auto;cursor:pointer;height:96px;border:1px solid #2b4d6488;background:var(--bg,#0b1a28);overflow:hidden;padding:10px 12px;color:#f4fbff;text-align:left;transition:transform .12s,border-color .12s}
#selectScreen .bs-arena:hover{transform:translateY(-2px);border-color:#9af4ff}
#selectScreen .bs-arena.on{border-color:#ffd76c;box-shadow:0 0 0 1px #ffd76c88,0 0 26px #ffbb3344}
#selectScreen .bs-arena .bs-aname,#selectScreen .bs-arena .bs-akind{display:block}
#selectScreen .bs-arena .bs-aname{position:relative;font:900 13px/1.15 system-ui;letter-spacing:.02em;text-shadow:0 2px 10px #000}
#selectScreen .bs-arena .bs-akind{position:relative;margin-top:5px;font:900 8px/1 system-ui;letter-spacing:.18em;color:#bfeaff;text-shadow:0 1px 6px #000}
#selectScreen .bs-arena .bs-asize{position:absolute;right:9px;bottom:8px;font:900 8px/1 system-ui;letter-spacing:.1em;color:#d8f6ff;text-shadow:0 1px 6px #000}
#selectScreen .bs-foot{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;border-top:1px solid #ffffff14;padding-top:10px}
#selectScreen .bs-foot .bs-right{display:flex;gap:8px;flex-wrap:wrap}
#selectScreen .bs-foot button{pointer-events:auto}
#selectScreen .bs-foot .bs-key{font:800 9px/1.6 system-ui;letter-spacing:.08em;color:#8fb6cb}
#selectScreen .bs-foot .bs-key b{color:#e8fbff}
#selectScreen .bs-preview{position:relative;height:clamp(260px,42vh,400px);border:1px solid #4ddfff44;background:radial-gradient(ellipse at 50% 30%,#17384d,#05121d 74%);overflow:hidden;box-shadow:inset 0 0 60px #46e6ff14}
#selectScreen .bs-preview:after{content:'';position:absolute;left:0;right:0;bottom:0;height:34%;background:linear-gradient(180deg,transparent,#04101ad9);pointer-events:none}
#selectScreen .bs-preview canvas{display:block;width:100%;height:100%;margin:0 auto}
#selectScreen .bs-preview .bs-pvside{position:absolute;right:12px;top:10px;font:900 9px/1 system-ui;letter-spacing:.16em;color:#04131d;background:#7ef0ff;padding:4px 7px;z-index:2}
#selectScreen .bs-preview .bs-pvside.cpu{background:#ffb45c}
#selectScreen .bs-preview .bs-pvname{position:absolute;left:12px;bottom:10px;font:900 13px/1 system-ui;letter-spacing:.1em;color:#eafaff;text-shadow:0 2px 12px #000}
#selectScreen .bs-preview .bs-pvstatus{position:absolute;left:12px;top:10px;font:900 9px/1 system-ui;letter-spacing:.16em;color:#7fd8f2;text-shadow:0 1px 8px #000}
#selectScreen .bs-preview .bs-pvstatus.warn{color:#ffb45c}
#selectScreen [hidden]{display:none!important}
@media(max-width:760px){
 #selectScreen .bs-grid{grid-template-columns:repeat(auto-fill,minmax(122px,1fr));gap:5px}
 #selectScreen .bs-arena{height:82px}
 #selectScreen .bs-foot{position:sticky;bottom:0;background:linear-gradient(180deg,#04101ccc,#04101cee);padding:8px 0}
}
`;

const LEGACY_LABELS = 'bs-legacy-hidden';

function identityKeyOf(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function hex(color) {
  return '#' + Number(color || 0).toString(16).padStart(6, '0');
}

/**
 * @param {object} options
 * @param {Array<[string, string]>} options.roster  [displayName, archetype] pairs
 * @param {Record<string, object>} options.specials  signature moves keyed by identity slug
 * @param {Record<string, object>} options.themes    arena themes, as used by applyMap
 * @param {Array<[string, object]>} options.arenas   [key, layout] pairs in display order
 * @param {Array<object>} options.worlds   large worlds with their selectable battle locations
 * @param {(name: string) => void} options.onFighter
 * @param {(key: string) => void} options.onArena
 * @param {(mode: '1p'|'2p') => void} options.onMode
 */
export function initCharacterSelect({ roster, specials = {}, themes = {}, arenas = [], worlds = [], rules = {}, difficulty = 'fighter', modes = [], onFighter, onArena, onMode, onRules, onDifficulty } = {}) {
  const menu = document.querySelector('#menu');
  const panel = menu?.querySelector('.panel') || menu;
  const p1Select = document.querySelector('#p1Character');
  const p2Select = document.querySelector('#cpuCharacter');
  const mapSelect = document.querySelector('#menuMapSelect');
  if (!panel || !p1Select || !p2Select) return null;

  const state = {
    step: 1,
    side: 'p1',
    mode: '1p',
    p1: p1Select.value || roster?.[0]?.[0],
    p2: p2Select.value || roster?.[1]?.[0] || roster?.[0]?.[0],
    arena: mapSelect?.value || arenas?.[0]?.[0] || 'valley',
    worldFilter: 'classic',
    // Match rules the simulation will actually read. Kept here so the setup screen shows the
    // same numbers the round loop uses instead of a second copy that can drift.
    rules: {
      roundsToWin: Number(rules?.roundsToWin) || 2,
      roundSeconds: Number(rules?.roundSeconds) || 80
    },
    difficulty: String(difficulty || 'fighter')
  };

  // Which world each battle location belongs to, so the arena step can show one world at a time.
  const worldOf = {};
  const worldTabs = [{ id: 'classic', label: 'Classic arenas' }];
  for (const world of worlds) {
    worldTabs.push({ id: world.id, label: world.label });
    for (const location of world.locations || []) worldOf[location.key] = world.id;
  }
  if (worldOf[state.arena]) state.worldFilter = worldOf[state.arena];
  let syncedArena = state.arena;
  const worldTabsMarkup = worlds.length
    ? `<div class="bs-worldtabs">${worldTabs.map(tab => `<button data-worldtab="${tab.id}" class="${tab.id === state.worldFilter ? 'on' : ''}">${tab.label}</button>`).join('')}</div>`
    : '';

  const style = document.createElement('style');
  style.id = 'selectScreenStyles';
  style.textContent = CSS;
  document.head.appendChild(style);

  // The legacy <select> rows stay in the DOM as the source of truth but are hidden; the
  // cards drive them through real change events so main.js keeps owning the swap logic.
  for (const select of [p1Select, p2Select, mapSelect]) {
    if (!select) continue;
    let node = select.parentElement;
    while (node && node !== panel) {
      if (node.tagName === 'DIV' && node.classList.contains('actions')) {
        node.classList.add(LEGACY_LABELS);
        node.style.display = 'none';
        break;
      }
      node = node.parentElement;
    }
  }

  const playButton = document.querySelector('#play');
  const practiceButton = document.querySelector('#practice');
  const exploreButton = document.querySelector('#explore');
  const result = document.querySelector('#result');

  panel.classList.add('bs-hosting');
  menu.classList.add('bs-select-open');
  document.body.classList.add('in-menu');
  const root = document.createElement('div');
  root.id = 'selectScreen';
  panel.appendChild(root);

  const arenaCards = arenas.map(([key, layout]) => {
    const theme = themes[key] || {};
    const b = layout.bounds;
    const width = Math.round(b.x1 - b.x0);
    const depth = Math.round(b.z1 - b.z0);
    return `<button class="bs-arena" data-arena="${key}" data-world="${worldOf[key] || ''}" style="--bg:linear-gradient(140deg,${hex(theme.sky)},${hex(theme.fog)} 58%,${hex(theme.floor)})">
      <span class="bs-aname">${layout.label || theme.label || key}</span>
      <span class="bs-akind">${String(layout.kind || 'arena').toUpperCase()}</span>
      <span class="bs-asize">${width} × ${depth} M</span>
    </button>`;
  }).join('');

  root.innerHTML = `
    <div class="bs-head">
      <div><div class="bs-eyebrow">BROWSER SMASH · MATCH SETUP</div>
      <h1 class="bs-title" data-role="title">SELECT <span>YOUR FIGHTER</span></h1></div>
      <div class="bs-steps"><b data-stepbadge="1" class="on">01 FIGHTERS</b><b data-stepbadge="2">02 ARENA</b></div>
    </div>
    <div class="bs-body">
      <section class="bs-step" data-step="1">
        <div class="bs-mode">
          <button data-mode="1p" class="on">1P VS CPU</button>
          <button data-mode="2p">2P LOCAL</button>
          <span class="bs-key">P1 <b>WASD</b> · P2 <b>ARROWS</b> · pick a side, then a fighter</span>
        </div>
        <div class="bs-sides">
          <div class="bs-side on" data-side="p1">PLAYER 1<small data-slot="p1"></small></div>
          <div class="bs-side" data-side="p2">PLAYER 2 / CPU<small data-slot="p2"></small></div>
        </div>
        <div class="bs-rules">
          <label>ROUNDS TO WIN<select data-rule="rounds" aria-label="Rounds needed to win the series"><option value="1">FIRST TO 1</option><option value="2" selected>FIRST TO 2</option><option value="3">FIRST TO 3</option></select></label>
          <label>ROUND TIME<select data-rule="timer" aria-label="Round length in seconds"><option value="60">60 SECONDS</option><option value="80" selected>80 SECONDS</option><option value="120">120 SECONDS</option></select></label>
          <label>CPU SKILL<select data-rule="difficulty" aria-label="CPU skill level"><option value="rookie">ROOKIE</option><option value="fighter" selected>FIGHTER</option><option value="ace">ACE</option></select></label>
          <span class="bs-rulehint" data-role="rulehint"></span>
        </div>
        <div class="bs-preview" data-role="preview">
          <canvas data-role="previewcanvas" aria-label="3D preview of the selected fighter"></canvas>
          <span class="bs-pvstatus" data-role="previewstatus">PREVIEW</span>
          <span class="bs-pvside" data-role="previewside">P1 · PLAYER</span>
          <span class="bs-pvname" data-role="previewname"></span>
        </div>
        <div class="bs-grid" data-role="roster"></div>
        <div class="bs-movelist" data-role="moves"></div>
      </section>
      <section class="bs-step" data-step="2" hidden>
        ${worldTabsMarkup}
        <div class="bs-arenas">${arenaCards}</div>
        <div class="bs-matchline" data-role="matchline"></div>
      </section>
    </div>
    <div class="bs-foot">
      <div class="bs-key" data-role="hint"></div>
      <div class="bs-right">
        <button data-nav="back" hidden>BACK</button>
        <button data-nav="next" class="primary">CHOOSE ARENA</button>
      </div>
    </div>
  `;

  const rosterGrid = root.querySelector('[data-role="roster"]');
  const hint = root.querySelector('[data-role="hint"]');

  // 3D preview of the selected fighter, mounted lazily on the first paint of step 1. A renderer
  // that cannot start (no WebGL) reports it and leaves the menu fully usable.
  let preview = null;
  function ensurePreview() {
    if (preview) return preview;
    const canvas = root.querySelector('[data-role="previewcanvas"]');
    if (!canvas) return null;
    const status = root.querySelector('[data-role="previewstatus"]');
    preview = createFighterPreview(canvas, {
      onStatus: ({ state: next, label, detail }) => {
        if (!status) return;
        status.textContent = detail ? `${label} · ${detail}`.slice(0, 72) : label;
        status.classList.toggle('warn', next === 'fallback' || next === 'unavailable');
        status.dataset.state = next;
      }
    });
    // Tooling handle for the roster capture harness (scripts/capture-roster-sheet.mjs). The
    // preview still owns its own canvas, lights and disposal; nothing in gameplay reads this.
    window.__browserSmashPreview = preview;
    return preview;
  }
  const navNext = root.querySelector('[data-nav="next"]');
  const navBack = root.querySelector('[data-nav="back"]');

  // Start / practice / explore normally live in the old panel; move them into this footer
  // so the selection screen owns the whole flow.
  const right = root.querySelector('.bs-right');
  const foot = root.querySelector('.bs-foot');
  // Where the legacy buttons started life. "Return to title" hands them back to the old panel,
  // because a title screen whose only buttons were moved into the setup screen is a dead end.
  const buttonHome = playButton?.parentElement || practiceButton?.parentElement || exploreButton?.parentElement || null;
  const resultHome = result?.parentElement || null;
  function toSelect() {
    if (practiceButton) right.appendChild(practiceButton);
    if (exploreButton) right.appendChild(exploreButton);
    if (playButton) { playButton.textContent = 'START FIGHT'; right.appendChild(playButton); playButton.hidden = true; }
    if (result) { result.style.display = 'block'; result.style.margin = '6px 0 0'; foot.prepend(result); }
    panel.classList.add('bs-hosting');
    menu.classList.add('bs-select-open');
  }
  function toTitle() {
    for (const node of [practiceButton, exploreButton, playButton]) {
      if (node && buttonHome && node.parentElement !== buttonHome) buttonHome.appendChild(node);
    }
    if (result && resultHome && result.parentElement !== resultHome) resultHome.appendChild(result);
    if (playButton) playButton.hidden = false;
    panel.classList.remove('bs-hosting');
    menu.classList.remove('bs-select-open');
  }
  toSelect();

  const cards = roster.map(([name, archetype], index) => {
    const special = specials[identityKeyOf(name)]?.label || '';
    const number = String(index + 1).padStart(2, '0');
    return `<button class="bs-card" data-fighter="${name.replace(/"/g, '&quot;')}" data-side-label="P2"
      style="--c:${ARCHETYPE_COLORS[archetype] || '#54eaff'}">
      <span class="bs-no">${number} · ${String(archetype).toUpperCase()}</span>
      <span class="bs-name">${name}</span>
      <span class="bs-tag">${special || 'SIGNATURE MOVE'}</span>
    </button>`;
  }).join('');
  rosterGrid.innerHTML = cards;

  // Per-fighter move list: what the selected fighter's buttons actually do, with the form and
  // ultimate costs from the same data the simulation reads.
  function moveListMarkup(name) {
    const set = MOVESETS[slugOf(name)];
    if (!set) return `<div class="bs-note">No moveset data for ${name || 'this fighter'}.</div>`;
    const key = label => `<span class="bs-keycap">${label}</span>`;
    const form = set.form;
    const ult = set.ultimate;
    const signature = specials[slugOf(name)]?.label || 'Signature move';
    return `<div>
      <h4>${String(name).toUpperCase()}</h4>
      <p><b>LIGHT</b> ${[...set.lights, ...(LIGHT_EXTENSIONS[slugOf(name)] || [])].join(' → ')}</p>
      <p><b>HEAVY</b> ${set.heavy.join(' · ')}</p>
      <p><b>AIR</b> ${set.aerial}</p>
      <p>${key('J')} chain · ${key('SHIFT')}+${key('J')} heavy · ${key('UP')}+${key('J')} anti-air · ${key('DOWN')}+${key('J')} dive</p>
    </div>
    <div>
      <h4>SIGNATURE &amp; FORM</h4>
      <p>${key('K')} <b>${signature}</b></p>
      ${form ? `<p>${key('I')} ${(Array.isArray(set.forms) && set.forms.length ? set.forms : [form]).map((entry, index) => `<b>${entry.label}</b> · ${entry.cost} power${index === 0 ? ` · ${entry.duration}s` : ''}`).join(' → ')}</p>
      <p>${key('K')} while transformed <b>${form.special?.label || 'empowered special'}</b>${set.forms?.length > 1 ? ' · each tier has its own' : ''}</p>`
      : `<p class="bs-note">No transformation: this fighter spends its meter on the ultimate.</p>`}
      ${abilitiesFor(slugOf(name)).map((entry, index) => `<p>${key(['L', 'H', 'T', 'Y'][index] || '?')} <b>${entry.label}</b> · ${entry.damage} dmg · ${entry.cooldown}s</p>`).join('')}
      <p class="bs-note">${form?.note || ''}</p>
    </div>
    <div>
      <h4>ULTIMATE</h4>
      <p>${key('O')} <b>${ult.label}</b></p>
      <p class="bs-note">${ult.damage} damage · ${String(ult.behaviour).toUpperCase()}${ult.hits ? ' · ' + ult.hits + ' hits' : ''}</p>
      <p class="bs-note">${ult.note || ''}</p>
      <p class="bs-note">Meter fills from damage dealt and taken; refunded if interrupted before it connects.</p>
    </div>`;
  }

  function syncOptions() {
    if (p1Select.value !== state.p1) { p1Select.value = state.p1; }
    if (p2Select.value !== state.p2) { p2Select.value = state.p2; }
    if (mapSelect && mapSelect.value !== state.arena) mapSelect.value = state.arena;
  }

  function paint() {
    for (const card of rosterGrid.querySelectorAll('.bs-card')) {
      card.classList.toggle('p1', card.dataset.fighter === state.p1);
      card.classList.toggle('p2', card.dataset.fighter === state.p2 && card.dataset.fighter !== state.p1);
      card.dataset.sideLabel = state.mode === '2p' ? 'P2' : 'CPU';
    }
    for (const arena of root.querySelectorAll('.bs-arena')) {
      arena.classList.toggle('on', arena.dataset.arena === state.arena);
      arena.hidden = state.worldFilter === 'classic' ? Boolean(arena.dataset.world) : arena.dataset.world !== state.worldFilter;
    }
    for (const tab of root.querySelectorAll('[data-worldtab]')) tab.classList.toggle('on', tab.dataset.worldtab === state.worldFilter);
    for (const side of root.querySelectorAll('.bs-side')) side.classList.toggle('on', side.dataset.side === state.side);
    for (const mode of root.querySelectorAll('[data-mode]')) mode.classList.toggle('on', mode.dataset.mode === state.mode);
    for (const select of root.querySelectorAll('[data-rule]')) {
      if (select.dataset.rule === 'rounds') select.value = String(state.rules.roundsToWin);
      else if (select.dataset.rule === 'timer') select.value = String(state.rules.roundSeconds);
      else if (select.dataset.rule === 'difficulty') { select.value = state.difficulty; select.disabled = state.mode === '2p'; }
    }
    const ruleHint = root.querySelector('[data-role="rulehint"]');
    if (ruleHint) ruleHint.textContent = state.mode === '2p'
      ? 'Local two-player match: there is no CPU on the other side, so CPU skill is not used.'
      : 'CPU skill changes how the opponent reads a startup, guards, dodges and spends meter — never its health or damage.';
    const p1Name = state.p1 || '—';
    const p2Name = state.p2 || '—';
    root.querySelector('[data-slot="p1"]').textContent = p1Name;
    root.querySelector('[data-slot="p2"]').textContent = (state.mode === '2p' ? '' : 'CPU · ') + p2Name;
    root.querySelector('[data-side="p2"]').firstChild.textContent = state.mode === '2p' ? 'PLAYER 2' : 'CPU RIVAL';
    const title = root.querySelector('[data-role="title"]');
    if (title) title.innerHTML = state.step === 1 ? 'SELECT <span>YOUR FIGHTER</span>' : 'CHOOSE <span>YOUR ARENA</span>';
    const matchline = root.querySelector('[data-role="matchline"]');
    const arenaLabel = (arenas.find(([key]) => key === state.arena) || [])[1]?.label || state.arena;
    // Follow the arena only when it changed outside the grid (e.g. the map <select> or a
    // programmatic chooseArena). Clicking a world tab must not be undone by paint().
    if (state.arena !== syncedArena) {
      syncedArena = state.arena;
      if (worldOf[state.arena] && worldOf[state.arena] !== state.worldFilter) {
        state.worldFilter = worldOf[state.arena];
        for (const arena of root.querySelectorAll('.bs-arena')) arena.hidden = arena.dataset.world !== state.worldFilter;
        for (const tab of root.querySelectorAll('[data-worldtab]')) tab.classList.toggle('on', tab.dataset.worldtab === state.worldFilter);
      }
    }
    if (matchline) matchline.innerHTML = `<b>${p1Name}</b> vs <b>${p2Name}</b> · <b>${arenaLabel}</b> · first to 2 rounds · ${state.mode === '2p' ? 'local two-player' : 'solo vs CPU'}`;
    for (const badge of root.querySelectorAll('[data-stepbadge]')) badge.classList.toggle('on', Number(badge.dataset.stepbadge) === state.step);
    for (const step of root.querySelectorAll('.bs-step')) step.hidden = Number(step.dataset.step) !== state.step;
    navBack.hidden = state.step === 1;
    navNext.hidden = state.step === 2;
    if (playButton) playButton.hidden = state.step !== 2;
    hint.innerHTML = state.mode === '2p'
      ? 'P1 <b>WASD</b> · <b>J</b> attack · <b>K</b> special · <b>U</b> grab · <b>SPACE</b> jump · <b>SHIFT</b> dash · <b>E</b> guard<br>P2 <b>ARROWS</b> · <b>,</b> attack · <b>.</b> special · <b>/</b> grab · <b>ENTER</b> jump · <b>RIGHT SHIFT</b> dash · <b>;</b> guard'
      : 'P1 <b>WASD</b> move · <b>J</b> attack (3-hit chain) · <b>K</b> signature · <b>U</b> throw · <b>SPACE</b> jump / double jump · <b>SHIFT</b> dash · <b>E</b> guard, tap to parry · <b>I</b> transform · <b>O</b> ultimate';
    const movePanel = root.querySelector('[data-role="moves"]');
    if (movePanel) movePanel.innerHTML = moveListMarkup(state.side === 'p1' ? state.p1 : state.p2);
    // The preview follows the side being picked, and only renders while step 1 is on screen.
    const previewName = state.side === 'p1' ? state.p1 : state.p2;
    const previewLabel = root.querySelector('[data-role="previewname"]');
    if (previewLabel) previewLabel.textContent = String(previewName || '').toUpperCase();
    const previewSide = root.querySelector('[data-role="previewside"]');
    if (previewSide) {
      const isP1 = state.side === 'p1';
      previewSide.textContent = isP1 ? 'P1 · PLAYER' : (state.mode === '2p' ? 'P2 · PLAYER' : 'CPU · RIVAL');
      previewSide.classList.toggle('cpu', !isP1);
    }
    const previewPanel = root.querySelector('[data-role="preview"]');
    if (previewPanel) previewPanel.hidden = !(state.step === 1 && !root.hidden);
    if (state.step === 1 && !root.hidden) {
      const view = ensurePreview();
      view?.setActive(true);
      view?.show(slugOf(previewName), previewName);
    } else {
      preview?.setActive(false);
    }
    root.querySelector('[data-role="hint"]').style.display = state.step === 2 ? '' : 'none';
  }

  rosterGrid.addEventListener('click', event => {
    const card = event.target.closest('.bs-card');
    if (!card) return;
    const name = card.dataset.fighter;
    if (state.side === 'p1') state.p1 = name; else state.p2 = name;
    syncOptions();
    onFighter?.(state.side, name);
    // Keep the other side from mirroring the same pick when the user has not chosen yet.
    if (state.side === 'p1') state.side = 'p2'; else state.side = 'p1';
    paint();
  });

  for (const side of root.querySelectorAll('.bs-side')) {
    side.addEventListener('click', () => { state.side = side.dataset.side; paint(); });
  }

  // Menu audio is bound to real clicks on the screen, not to the render loop: pointer feedback
  // comes from the same delegated listener, and a click that starts a match is also the gesture
  // that unlocks the audio context.
  root.addEventListener('click', event => {
    window.combatAudio?.unlock?.();
    if (event.target?.closest?.('[data-arena],[data-fighter],[data-mode],[data-registry-mode]')) {
      window.combatAudio?.play?.('menuSelect');
    } else {
      window.combatAudio?.play?.('menuMove');
    }
  }, true);

  // Mode strip from the registry. Playable modes route to the entry point they declare, so a
  // label can never start something different from what it says. Modes with no implementation are
  // rendered disabled with their reason instead of being offered as working.
  const modeRow = root.querySelector('.bs-mode');
  if (modeRow && modes.length) {
    for (const entry of modes) {
      if (entry.id === '1p' || entry.id === '2p') continue; // the versus toggle already covers these
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.registryMode = entry.id;
      button.textContent = entry.available ? entry.label.toUpperCase() : entry.label.toUpperCase() + ' · LOCKED';
      button.title = entry.available ? entry.description : entry.reason || 'Not implemented yet';
      if (!entry.available) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.style.opacity = '.45';
        button.style.cursor = 'not-allowed';
      } else {
        button.addEventListener('click', () => {
          if (entry.entry === 'tournament') { window.__browserSmashTournamentStart?.(); return; }
          if (entry.entry === 'practice') { window.BrowserSmash?.startTraining?.(); return; }
          if (entry.entry === 'explore') { window.BrowserSmash?.startExplore?.(); return; }
          window.BrowserSmash?.startMatch?.();
        });
      }
      modeRow.appendChild(button);
    }
  }

  for (const mode of root.querySelectorAll('[data-mode]')) {
    mode.addEventListener('click', () => {
      state.mode = mode.dataset.mode;
      onMode?.(state.mode);
      paint();
    });
  }

  for (const select of root.querySelectorAll('[data-rule]')) {
    select.addEventListener('change', () => {
      const rule = select.dataset.rule;
      if (rule === 'difficulty') {
        state.difficulty = select.value;
        onDifficulty?.(state.difficulty);
      } else {
        if (rule === 'rounds') state.rules.roundsToWin = Number(select.value) || state.rules.roundsToWin;
        else state.rules.roundSeconds = Number(select.value) || state.rules.roundSeconds;
        onRules?.({ ...state.rules });
      }
      paint();
    });
  }

  for (const arena of root.querySelectorAll('.bs-arena')) {
    arena.addEventListener('click', () => {
      state.arena = arena.dataset.arena;
      syncOptions();
      onArena?.(state.arena);
      paint();
    });
  }

  // World filter: one row of tabs, so a world's eight landmark stages are not lost in a
  // thirty-card grid next to the six small classic arenas.
  for (const tab of root.querySelectorAll('[data-worldtab]')) {
    tab.addEventListener('click', () => { state.worldFilter = tab.dataset.worldtab; paint(); });
  }

  navNext.addEventListener('click', () => { state.step = 2; paint(); });
  navBack.addEventListener('click', () => { state.step = 1; paint(); });

  // Stay in sync if the legacy selects are changed by something else (keyboard, scripts).
  for (const select of [p1Select, p2Select]) {
    select.addEventListener('change', () => {
      if (select === p1Select) state.p1 = select.value; else state.p2 = select.value;
      paint();
    });
  }
  mapSelect?.addEventListener('change', () => { state.arena = mapSelect.value; paint(); });

  paint();

  return {
    state,
    show() { toSelect(); root.hidden = false; state.step = 1; paint(); },
    showTitle() {
      preview?.setActive(false);
      toTitle();
      // The title only renders while #menu owns the bb-title state; without this the panel kept
      // whatever setup/result class it had and #bbTitle stayed display:none after "return to title".
      if (menu) {
        menu.classList.remove('bb-setup', 'bb-result', 'bs-select-open');
        menu.classList.add('bb-title');
      }
      root.hidden = true;
    },
    hide() { preview?.setActive(false); root.hidden = true; },
    clearResult() {
      if (result) {
        result.innerHTML = '';
        result.classList.remove('bb-defeat');
      }
      if (menu) menu.classList.remove('bb-result', 'bb-defeat');
      if (playButton) playButton.textContent = 'START FIGHT';
      return true;
    },
    showResult({ text = '', markup = '', winner = null } = {}) {
      document.body.classList.add('in-menu');
      if (menu) {
        menu.classList.remove('hidden', 'bb-title', 'bb-setup', 'bb-defeat');
        menu.classList.add('bb-result');
        void menu.offsetWidth;
        menu.getAnimations().forEach(animation => {
          if (animation.transitionProperty === 'opacity') animation.finish();
        });
      }
      if (preview) preview.setActive(false);
      toSelect();
      root.hidden = false;
      state.step = 1;
      paint();
      if (result) {
        result.innerHTML = markup || '<div style="font:900 18px/1.2 system-ui;letter-spacing:.08em">' + String(text || 'MATCH ENDED') + '</div>';
        result.style.display = 'block';
        result.style.margin = '6px 0 0';
      }
      if (playButton) {
        playButton.textContent = 'REMATCH';
        playButton.hidden = false;
      }
      return { text: String(text || ''), winner };
    },
    setFighterState(side, name) {
      if (side === 'p1') state.p1 = name;
      else state.p2 = name;
      syncOptions();
      paint();
      return side === 'p1' ? state.p1 : state.p2;
    },
    setArenaState(key) {
      state.arena = key;
      syncOptions();
      paint();
      return state.arena;
    },
    setRules(next = {}) {
      if (Number(next.roundsToWin) >= 1) state.rules.roundsToWin = Number(next.roundsToWin);
      if (Number(next.roundSeconds) >= 15) state.rules.roundSeconds = Number(next.roundSeconds);
      paint();
    },
    setDifficulty(level) { state.difficulty = String(level || state.difficulty); paint(); },
    select(side, name) { if (side === 'p1') state.p1 = name; else state.p2 = name; syncOptions(); onFighter?.(side, name); paint(); },
    chooseArena(key) { state.arena = key; syncOptions(); onArena?.(key); paint(); },
    setMode(mode) { state.mode = mode; onMode?.(mode); paint(); }
  };
}
