// Training-mode overlay.
//
// Practice mode existed but told the player nothing: it switched the round clock off and printed
// "PRACTICE MODE · POWERS ENABLED", while the CPU kept fighting back with full AI. There was no
// way to see what a move actually did, no way to make the opponent hold still, and no way to
// reset.
//
// This panel reads the live simulation (no simulated numbers of its own) and offers the controls a
// training mode needs: a stationary / guarding / pacing dummy, invulnerability for the dummy,
// position reset, damage reset, and an exit back to the menu. Damage dealt is accumulated by the
// simulation from the live damage totals, so a melee hit, a projectile and an ultimate are all
// counted by the same rule.
//
// Presentation only: every control calls a callback supplied by main.js.

import { stateOf, attackPhase } from '../combat/fighter_state.js';

const CSS = `
#trainingPanel{position:fixed;left:18px;bottom:18px;z-index:9;width:min(360px,92vw);padding:11px 13px;background:linear-gradient(160deg,#04121fe8,#061a29e0);border:1px solid #4ddfff77;box-shadow:0 12px 34px #0009,inset 0 0 26px #0bd6ff0f;color:#eaf7ff;font-family:Inter,system-ui,-apple-system,sans-serif;pointer-events:auto}
#trainingPanel[hidden]{display:none!important}
#trainingPanel .tp-head{display:flex;justify-content:space-between;align-items:center;gap:8px;font:900 9px/1 system-ui;letter-spacing:.22em;color:#54eaff}
#trainingPanel .tp-head span{color:#8fb6cb;letter-spacing:.1em}
#trainingPanel .tp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 12px;margin:9px 0 10px}
#trainingPanel .tp-row{font:800 10px/1.5 system-ui;letter-spacing:.05em;color:#9fc9dd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#trainingPanel .tp-row b{color:#eafaff;font-weight:900}
#trainingPanel .tp-buttons{display:flex;flex-wrap:wrap;gap:5px}
#trainingPanel button{pointer-events:auto;cursor:pointer;padding:7px 9px;border:1px solid #4ddfff66;background:#082234;color:#dff3ff;font:900 9px/1.15 system-ui;letter-spacing:.1em;transition:border-color .14s,background .14s,transform .14s}
#trainingPanel button:hover{border-color:#a5f7ff;background:#0d3d57;transform:translateY(-1px)}
#trainingPanel button.on{border-color:#8ef7ff;background:linear-gradient(100deg,#0a6f8c,#17c6d6);color:#02121c}
#trainingPanel .tp-foot{margin-top:8px;font:800 9px/1.5 system-ui;letter-spacing:.08em;color:#7fb2c9}
#trainingPanel kbd{display:inline-block;padding:1px 4px;background:#123c52;border:1px solid #4ddfff55;color:#bdf3ff;font:900 9px/1.2 system-ui}
`;

const DUMMIES = [
  ['stand', 'STAND STILL'],
  ['guard', 'HOLD GUARD'],
  ['walk', 'PACE'],
  ['off', 'FIGHT BACK']
];

export function initTrainingPanel({ onDummyChange, onInvulnerableChange, onResetPositions, onResetDamage, onExit } = {}) {
  if (typeof document === 'undefined') return null;
  if (document.querySelector('#trainingPanel')) return null;

  const style = document.createElement('style');
  style.id = 'trainingPanelStyles';
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'trainingPanel';
  root.hidden = true;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Training readout');
  root.innerHTML = `
    <div class="tp-head">TRAINING MODE <span data-read="dummyMode">STAND STILL</span></div>
    <div class="tp-grid">
      <div class="tp-row">DAMAGE DEALT <b data-read="dealt">0%</b></div>
      <div class="tp-row">HITS LANDED <b data-read="hits">0</b></div>
      <div class="tp-row">BIGGEST HIT <b data-read="biggest">0%</b></div>
      <div class="tp-row">COMBO <b data-read="combo">—</b></div>
      <div class="tp-row">YOUR MOVE <b data-read="move">idle</b></div>
      <div class="tp-row">HITSTUN <b data-read="hitstun">0.00s</b></div>
      <div class="tp-row">POWER / METER <b data-read="meter">0 / 0</b></div>
      <div class="tp-row">DUMMY DAMAGE <b data-read="dummyDamage">0%</b></div>
      <div class="tp-row">DUMMY HITSTUN <b data-read="dummyStun">0.00s</b></div>
      <div class="tp-row">DUMMY KNOCKBACK <b data-read="dummyKnock">0.0</b></div>
    </div>
    <div class="tp-buttons" data-role="dummies">
      ${DUMMIES.map(([mode, label]) => `<button type="button" data-dummy="${mode}" class="${mode === 'stand' ? 'on' : ''}">${label}</button>`).join('')}
    </div>
    <div class="tp-buttons" style="margin-top:5px">
      <button type="button" data-invuln>DUMMY INVULNERABLE: OFF</button>
      <button type="button" data-act="reset-positions">RESET POSITIONS · R</button>
      <button type="button" data-act="reset-damage">RESET DAMAGE · T</button>
      <button type="button" data-act="exit">EXIT TRAINING · ESC</button>
    </div>
    <div class="tp-foot">Move <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · attack <kbd>J</kbd> · signature <kbd>K</kbd> · transform <kbd>I</kbd> · ultimate <kbd>O</kbd> · <kbd>F3</kbd> hitboxes</div>
  `;
  document.body.appendChild(root);

  const read = name => root.querySelector(`[data-read="${name}"]`);
  const invulnButton = root.querySelector('[data-invuln]');
  let visible = false;
  let dummy = 'stand';
  let invulnerable = false;

  function paintDummyButtons() {
    for (const button of root.querySelectorAll('[data-dummy]')) {
      button.classList.toggle('on', button.dataset.dummy === dummy);
    }
    const labels = Object.fromEntries(DUMMIES);
    const target = read('dummyMode');
    if (target) target.textContent = labels[dummy] || 'STAND STILL';
    if (invulnButton) {
      invulnButton.classList.toggle('on', invulnerable);
      invulnButton.textContent = `DUMMY INVULNERABLE: ${invulnerable ? 'ON' : 'OFF'}`;
    }
  }

  root.addEventListener('click', event => {
    const dummyButton = event.target.closest('[data-dummy]');
    if (dummyButton) {
      dummy = dummyButton.dataset.dummy;
      onDummyChange?.(dummy);
      paintDummyButtons();
      return;
    }
    if (event.target.closest('[data-invuln]')) {
      invulnerable = !invulnerable;
      onInvulnerableChange?.(invulnerable);
      paintDummyButtons();
      return;
    }
    const action = event.target.closest('[data-act]')?.dataset.act;
    if (action === 'reset-positions') onResetPositions?.();
    else if (action === 'reset-damage') onResetDamage?.();
    else if (action === 'exit') onExit?.();
  });

  paintDummyButtons();

  const speedOf = fighter => Math.hypot(
    fighter?.velocity?.x || 0, fighter?.velocity?.y || 0, fighter?.velocity?.z || 0
  );

  /**
   * Draw one frame from the live simulation. Hides itself outside training, so main.js can call it
   * unconditionally from the HUD update.
   */
  function refresh({ player, cpu, training, practice, started, exploration } = {}) {
    const show = Boolean(practice && started && !exploration && player && cpu);
    if (show !== visible) {
      root.hidden = !show;
      visible = show;
    }
    if (!show) return { visible: false };
    const phase = attackPhase(player);
    const counters = training || {};
    const set = (name, value) => { const node = read(name); if (node) node.textContent = value; };
    set('dealt', `${Math.round(counters.dealt || 0)}%`);
    set('hits', String(counters.hits || 0));
    set('biggest', `${Math.round(counters.biggest || 0)}%`);
    set('combo', player.comboWindow > 0 && player.comboHitCount > 1
      ? `${player.comboHitCount} HIT${player.comboStep >= 3 ? ' · FINISHER' : ''}`
      : '—');
    set('move', phase ? `${phase.id} · ${phase.phase}` : stateOf(player));
    set('hitstun', `${(player.hitstun || 0).toFixed(2)}s`);
    set('meter', `${Math.round(player.meter || 0)} / ${Math.round(player.power || 0)}`);
    set('dummyDamage', `${Math.floor(cpu.percent || 0)}%`);
    set('dummyStun', `${(cpu.hitstun || 0).toFixed(2)}s`);
    set('dummyKnock', speedOf(cpu).toFixed(1));
    if (counters.dummy && counters.dummy !== dummy) { dummy = counters.dummy; paintDummyButtons(); }
    if (typeof counters.invulnerable === 'boolean' && counters.invulnerable !== invulnerable) {
      invulnerable = counters.invulnerable;
      paintDummyButtons();
    }
    return { visible: true, dummy, invulnerable };
  }

  return {
    root,
    refresh,
    setState({ dummy: nextDummy, invulnerable: nextInvulnerable } = {}) {
      if (nextDummy) dummy = nextDummy;
      if (typeof nextInvulnerable === 'boolean') invulnerable = nextInvulnerable;
      paintDummyButtons();
    },
    setVisible(next) {
      visible = Boolean(next);
      root.hidden = !visible;
      return visible;
    },
    get isVisible() { return visible; },
    get dummy() { return dummy; },
    get invulnerable() { return invulnerable; }
  };
}
