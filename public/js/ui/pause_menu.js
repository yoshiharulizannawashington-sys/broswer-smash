// In-match pause menu.
//
// The game had no way to stop a match: Escape only left free-roam, and the only exits were
// losing or finishing the series. This overlay supplies the missing controls and, just as
// importantly, freezes the things that are easy to forget: the simulation, the match clock, the
// particles and the combat audio. Freezing only the fighters would let a paused player watch a
// projectile land and take damage.
//
// This module owns presentation only. It never mutates game state: every button calls a callback
// supplied by main.js, which is the module that actually knows how to restart a match or return
// to the title. Escape is deliberately NOT bound here - main.js owns the single Escape handler so
// one key press cannot both open and close the menu.

const CSS = `
#pauseMenu{position:fixed;inset:0;z-index:14;display:flex;align-items:center;justify-content:center;padding:16px;background:linear-gradient(180deg,rgba(3,9,17,.72),rgba(3,9,17,.86));backdrop-filter:blur(6px);color:#eaf7ff;font-family:Inter,system-ui,-apple-system,sans-serif;text-align:left}
#pauseMenu[hidden]{display:none!important}
#pauseMenu .pm-panel{width:min(760px,96vw);max-height:92dvh;overflow-y:auto;padding:clamp(16px,2.4vw,26px);border:1px solid #4ddfff77;background:linear-gradient(160deg,#071a2bee,#050f1bee);box-shadow:0 20px 60px #000a,inset 0 0 40px #0bd6ff11}
#pauseMenu .pm-eyebrow{font:900 10px/1 system-ui;letter-spacing:.34em;color:#54eaff}
#pauseMenu h2{margin:6px 0 2px;font:1000 clamp(30px,5vw,46px)/1 system-ui;letter-spacing:-.03em;text-shadow:0 0 26px #00bfff55}
#pauseMenu .pm-stats{font:800 11px/1.7 system-ui;letter-spacing:.12em;color:#9fc9dd}
#pauseMenu .pm-stats b{color:#eafaff}
#pauseMenu .pm-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin:16px 0 6px}
#pauseMenu button{pointer-events:auto;cursor:pointer;padding:13px 16px;border:1px solid #4ddfff99;background:linear-gradient(145deg,#082234,#0b3348);color:#f2fbff;font:900 11px/1.2 system-ui;letter-spacing:.12em;text-align:left;transition:transform .14s,border-color .14s,background .14s}
#pauseMenu button:hover,#pauseMenu button:focus-visible{transform:translateY(-2px);border-color:#a5f7ff;background:linear-gradient(145deg,#0d3d57,#10566b);outline:none}
#pauseMenu button small{display:block;margin-top:4px;font:700 9px/1.4 system-ui;letter-spacing:.05em;color:#8fb6cb}
#pauseMenu .pm-primary{border-color:#8ef7ff;background:linear-gradient(105deg,#0da6d4,#20e5f3);color:#02111a}
#pauseMenu .pm-primary small{color:#04425a}
#pauseMenu .pm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-top:14px}
#pauseMenu .pm-card{border:1px solid #ffffff16;background:#07172699;padding:10px 12px}
#pauseMenu .pm-card h3{margin:0 0 6px;font:900 9px/1 system-ui;letter-spacing:.2em;color:#7fd8f2}
#pauseMenu .pm-card p{margin:0 0 3px;font:700 10px/1.6 system-ui;letter-spacing:.03em;color:#cfe6f5}
#pauseMenu .pm-card b{color:#eafaff}
#pauseMenu kbd{display:inline-block;min-width:14px;padding:1px 4px;margin-right:4px;background:#123c52;border:1px solid #4ddfff66;color:#bdf3ff;font:900 9px/1.2 system-ui;text-align:center}
#pauseMenu .pm-audio{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#pauseMenu .pm-audio input[type=range]{width:150px;accent-color:#50eaff}
#pauseMenu .pm-foot{margin-top:12px;font:800 9px/1.6 system-ui;letter-spacing:.12em;color:#8fb6cb}
#pauseMenu .pm-foot b{color:#eafaff}
body.is-paused #bbMatchBar,body.is-paused #executeHint{opacity:.25!important}
`;

export function initPauseMenu({ onResume, onRestart, onQuitToSelect, onQuitToTitle, audio, getStats } = {}) {
  if (typeof document === 'undefined') return null;
  if (document.querySelector('#pauseMenu')) return null;

  const style = document.createElement('style');
  style.id = 'pauseMenuStyles';
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'pauseMenu';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Match paused');
  root.innerHTML = `
    <div class="pm-panel">
      <div class="pm-eyebrow">MATCH PAUSED</div>
      <h2>TAKE A BREATH</h2>
      <div class="pm-stats" data-role="stats"></div>
      <div class="pm-actions">
        <button class="pm-primary" data-action="resume">RESUME<small>Back to the fight · Esc</small></button>
        <button data-action="restart">RESTART SERIES<small>Round 1, score 0 – 0</small></button>
        <button data-action="select">CHARACTER SELECT<small>Keep these rules, pick new fighters</small></button>
        <button data-action="title">RETURN TO TITLE<small>Back to the main screen</small></button>
      </div>
      <div class="pm-grid">
        <div class="pm-card">
          <h3>PLAYER 1</h3>
          <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>SHIFT</kbd> sprint / dash</p>
          <p><kbd>J</kbd> attack · <kbd>K</kbd> signature · <kbd>U</kbd> throw</p>
          <p><kbd>SPACE</kbd> jump / double jump · <kbd>E</kbd> guard (tap = parry)</p>
          <p><kbd>F</kbd> flight · <kbd>C</kbd> descend · <kbd>I</kbd> transform · <kbd>O</kbd> ultimate</p>
        </div>
        <div class="pm-card">
          <h3>PLAYER 2 · LOCAL VERSUS</h3>
          <p><kbd>ARROWS</kbd> move · <kbd>R-SHIFT</kbd> sprint / dash</p>
          <p><kbd>,</kbd> attack · <kbd>.</kbd> signature · <kbd>/</kbd> throw</p>
          <p><kbd>ENTER</kbd> jump · <kbd>;</kbd> guard (tap = parry)</p>
          <p><kbd>N</kbd> transform · <kbd>M</kbd> ultimate</p>
        </div>
        <div class="pm-card">
          <h3>AUDIO</h3>
          <div class="pm-audio">
            <button type="button" data-action="mute" style="padding:9px 12px">SOUND ON</button>
            <label style="font:800 9px/1 system-ui;letter-spacing:.14em;color:#8fb6cb">VOLUME
              <input type="range" min="0" max="1" step="0.05" value="0.55" data-role="volume">
            </label>
          </div>
          <p style="margin-top:8px">Every effect is synthesised at runtime; nothing is downloaded.</p>
        </div>
      </div>
      <div class="pm-foot"><b>ESC</b> resumes · <b>F3</b> toggles the hitbox overlay · the match clock is stopped while this screen is open</div>
    </div>
  `;
  document.body.appendChild(root);

  const statsEl = root.querySelector('[data-role="stats"]');
  const muteButton = root.querySelector('[data-action="mute"]');
  const volumeInput = root.querySelector('[data-role="volume"]');

  function paintStats() {
    if (!statsEl) return;
    const stats = typeof getStats === 'function' ? getStats() || {} : {};
    const score = Array.isArray(stats.wins) ? `${stats.wins[0]} – ${stats.wins[1]}` : '0 – 0';
    const parts = [
      stats.mode || 'VS CPU',
      `ROUND <b>${stats.round ?? 1}</b>`,
      `SCORE <b>${score}</b>`,
      stats.arena ? `<b>${stats.arena}</b>` : '',
      stats.rules ? `FIRST TO <b>${stats.rules.roundsToWin}</b> · <b>${stats.rules.roundSeconds}s</b> ROUNDS` : '',
      stats.skill ? `CPU <b>${stats.skill}</b>` : ''
    ].filter(Boolean);
    statsEl.innerHTML = parts.join(' · ');
  }

  function paintAudio() {
    if (!audio) {
      for (const node of root.querySelectorAll('.pm-card h3')) {
        if (/AUDIO/i.test(node.textContent)) node.closest('.pm-card').hidden = true;
      }
      return;
    }
    if (muteButton) muteButton.textContent = audio.muted ? 'SOUND OFF' : 'SOUND ON';
    if (volumeInput) volumeInput.value = String(audio.volume ?? 0.55);
  }

  function open() {
    paintStats();
    paintAudio();
    root.hidden = false;
    document.body.classList.add('is-paused');
    root.querySelector('[data-action="resume"]')?.focus?.({ preventScroll: true });
    return true;
  }

  function close() {
    root.hidden = true;
    document.body.classList.remove('is-paused');
    return false;
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    event.stopPropagation();
    switch (button.dataset.action) {
      case 'resume': close(); onResume?.(); break;
      case 'restart': close(); onRestart?.(); break;
      case 'select': close(); onQuitToSelect?.(); break;
      case 'title': close(); onQuitToTitle?.(); break;
      case 'mute':
        if (audio) { audio.setMuted(!audio.muted); paintAudio(); }
        break;
      default: break;
    }
  });

  volumeInput?.addEventListener('input', () => {
    audio?.setVolume?.(Number(volumeInput.value));
    paintAudio();
  });

  // Keys pressed on the overlay must not reach the fight. Buttons are ordinary <button>
  // elements, so Space/Enter activate the focused one - which is why the simulation is gated by
  // main.js as well instead of relying on this handler.
  //
  // Escape is the exception. Because this handler sits on the overlay root and focus moves to the
  // RESUME button when it opens, stopping Escape here also stopped it from ever reaching the
  // window listener that owns pause - so once paused, the keyboard could not resume. Close here
  // instead, through the same callback path the RESUME button uses.
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      onResume?.();
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
  });

  return {
    root,
    open,
    close,
    paintStats,
    paintAudio,
    get isOpen() { return !root.hidden; }
  };
}
