// Tournament overlay: shows the bracket, the player's next opponent and the run's outcome.
//
// The bracket logic lives in public/js/combat/tournament.js; this file only presents it and asks
// main.js to start the next real match. It never simulates a fight itself.
//
// Coordinates, not a full screen takeover: the bracket is read between matches, so the panel can
// sit beside the character-select screen the same way the training panel sits beside a match.

const CSS = `
#tournamentPanel{position:fixed;right:22px;top:96px;z-index:9;width:min(380px,94vw);max-height:min(72vh,620px);overflow:auto;padding:12px 14px;background:linear-gradient(160deg,#08131fe8,#0a1c2ce8);border:1px solid #ffd16677;box-shadow:0 14px 40px #000a,inset 0 0 30px #ffb02e12;color:#eaf7ff;font-family:Inter,system-ui,-apple-system,sans-serif;pointer-events:auto}
#tournamentPanel[hidden]{display:none!important}
#tournamentPanel .tp-title{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font:900 11px/1 system-ui;letter-spacing:.2em;color:#ffd166}
#tournamentPanel .tp-title span{font:800 9px/1 system-ui;letter-spacing:.14em;color:#9ab6c8}
#tournamentPanel .tp-next{margin:11px 0 9px;padding:9px 10px;border:1px solid #ffffff1f;background:#050f1a}
#tournamentPanel .tp-next .tp-vs{font:900 13px/1.3 system-ui;color:#f3fbff}
#tournamentPanel .tp-next .tp-meta{margin-top:5px;font:800 9px/1.5 system-ui;letter-spacing:.12em;color:#8fb6cb}
#tournamentPanel .tp-round{margin-top:10px;font:900 9px/1 system-ui;letter-spacing:.18em;color:#7fd4ff}
#tournamentPanel .tp-match{display:flex;justify-content:space-between;gap:8px;padding:3px 0;font:800 10px/1.5 system-ui;color:#b9d7e6;border-bottom:1px dotted #ffffff12}
#tournamentPanel .tp-match b{color:#eafaff}
#tournamentPanel .tp-match .won{color:#7cf3b0}
#tournamentPanel .tp-match .lost{color:#ff9aa8}
#tournamentPanel .tp-match.you b{color:#ffd166}
#tournamentPanel .tp-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
#tournamentPanel button{pointer-events:auto;cursor:pointer;padding:8px 11px;border:1px solid #ffd16677;background:#1b1408;color:#ffe9b8;font:900 9px/1.1 system-ui;letter-spacing:.12em}
#tournamentPanel button:hover{border-color:#ffe6a7;background:#2a2009}
#tournamentPanel button.primary{border-color:#ffd166;background:linear-gradient(100deg,#8a5a08,#e6b33c);color:#1a1204}
#tournamentPanel .tp-champion{padding:10px;border:1px solid #ffe08a;background:#20180a;color:#fff3d0;font:900 13px/1.4 system-ui;text-align:center}
#tournamentPanel .tp-foot{margin-top:10px;font:800 9px/1.5 system-ui;letter-spacing:.08em;color:#82a9bd}
`;

export function initTournamentPanel({ onStart, onExit } = {}) {
  if (typeof document === 'undefined') return null;
  if (document.querySelector('#tournamentPanel')) {
    // Reuse the existing overlay rather than stacking a second one.
    return window.__tournamentPanelHandle || null;
  }
  const style = document.createElement('style');
  style.id = 'tournamentPanelStyles';
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'tournamentPanel';
  root.hidden = true;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Tournament bracket');
  root.innerHTML = `
    <div class="tp-title">TOURNAMENT <span data-read="round">QUARTER-FINAL</span></div>
    <div data-role="next"></div>
    <div data-role="bracket"></div>
    <div class="tp-actions">
      <button type="button" class="primary" data-act="start">FIGHT</button>
      <button type="button" data-act="exit">LEAVE TOURNAMENT</button>
    </div>
    <div class="tp-foot">Win three matches to take the bracket. A loss ends the run.</div>
  `;
  document.body.appendChild(root);

  const region = name => root.querySelector(`[data-role="${name}"]`);
  const read = name => root.querySelector(`[data-read="${name}"]`);
  let model = null;

  root.addEventListener('click', event => {
    const action = event.target.closest('[data-act]')?.dataset.act;
    if (action === 'start') onStart?.();
    else if (action === 'exit') onExit?.();
  });

  function paint() {
    const state = model?.describe?.();
    if (!state) return;
    const roundLabel = read('round');
    if (roundLabel) {
      roundLabel.textContent = state.complete
        ? (state.playerWonTournament ? 'CHAMPION' : 'ELIMINATED')
        : (state.roundName || 'BRACKET').toUpperCase();
    }
    const next = region('next');
    if (next) {
      if (state.complete) {
        next.innerHTML = `<div class="tp-champion">${state.playerWonTournament
          ? 'TOURNAMENT VICTORY'
          : 'ELIMINATED BY ' + String(state.eliminatedBy || '—').toUpperCase()}<br><span style="font:800 10px/1.5 system-ui;color:#c9b184">CHAMPION · ${String(state.champion || '—').toUpperCase()}</span></div>`;
      } else if (state.pending) {
        next.innerHTML = `<div class="tp-vs">${escapeHtml(state.pending.player)} vs ${escapeHtml(state.pending.opponent)}</div>
          <div class="tp-meta">${String(state.pending.roundName).toUpperCase()} · CPU ${String(state.pending.difficulty).toUpperCase()} · ${state.wins} WON / ${state.losses} LOST</div>`;
      } else {
        next.innerHTML = '<div class="tp-meta">BRACKET COMPLETE</div>';
      }
    }
    const bracket = region('bracket');
    if (bracket) {
      const byRound = new Map();
      for (const result of state.results) {
        if (!byRound.has(result.round)) byRound.set(result.round, []);
        byRound.get(result.round).push(result);
      }
      const names = ['QUARTER-FINALS', 'SEMI-FINALS', 'FINAL'];
      const rows = [];
      for (const [round, results] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
        rows.push(`<div class="tp-round">${names[round] || 'ROUND ' + (round + 1)}</div>`);
        for (const result of results) {
          const involvesPlayer = result.player === state.player || result.opponent === state.player;
          const winner = result.won ? result.player : result.opponent;
          const className = involvesPlayer ? 'tp-match you' : 'tp-match';
          rows.push(`<div class="${className}"><span>${escapeHtml(result.player)} vs ${escapeHtml(result.opponent)}</span><span class="${result.won ? 'won' : 'lost'}">${escapeHtml(winner)}</span></div>`);
        }
      }
      bracket.innerHTML = rows.join('') || '';
    }
    const startButton = root.querySelector('[data-act="start"]');
    if (startButton) {
      startButton.hidden = Boolean(state.complete) || !state.pending;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
  }

  const handle = {
    root,
    bind(tournament) { model = tournament; paint(); return handle; },
    open() {
      root.hidden = false;
      // The bracket occupies the same top-right space as the graphics panel. Showing both stacked
      // the tournament card over the quality controls, so the settings step aside while it is open.
      const settings = document.querySelector('#cameraSettings');
      if (settings) { settings.dataset.tournamentDisplay = settings.style.display || 'block'; settings.style.display = 'none'; }
      paint();
      return true;
    },
    close() {
      root.hidden = true; model = null;
      const settings = document.querySelector('#cameraSettings');
      if (settings?.dataset.tournamentDisplay) {
        // Give it back only to a live round: in the menu the settings panel has no business showing.
        settings.style.display = document.body.classList.contains('in-menu') ? 'none' : settings.dataset.tournamentDisplay;
        delete settings.dataset.tournamentDisplay;
      }
      return true;
    },
    refresh() { paint(); return handle; },
    get isOpen() { return !root.hidden; },
    get bracket() { return model?.describe?.() || null; }
  };
  window.__tournamentPanelHandle = handle;
  return handle;
}
