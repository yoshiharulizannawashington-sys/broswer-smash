// Cinematic match presentation: an introduction and a victory beat, in the spirit of a modern
// fighting game's character intros, built from what this game already has.
//
// The sequence is driven by the game's own clock (`update(dt)`), not by setTimeout. Timer-based
// cinematics desynchronise from gameplay, degrade when a tab is throttled, and cannot be tested
// deterministically; a beat list advanced by the same fixed step as combat can be.
//
// The camera work reuses SmashCamera.focus (a short push-in that restores itself), so nothing here
// invents a second camera. The intro is skippable by Escape, Space, Enter or a pointer press, always
// ends itself after its authored duration, and reports its state so tests can assert both the
// sequence and the skip. All copy is original.
import { exchangeFor, lineFor } from './dialogue.js';

const PLATE_STYLE = 'position:absolute;top:34%;padding:.6rem 1.15rem;background:rgba(6,10,18,.86);border-left:3px solid #ffc46a;color:#fff;font:700 clamp(16px,2.4vw,30px)/1.2 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;transform:translateX(-110%);transition:transform .42s cubic-bezier(.2,.8,.2,1)';
const WRAP_STYLE = 'position:absolute;inset:0;pointer-events:none;z-index:40;overflow:hidden';

function el(tag, css, text) {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * @param {object} options
 * @param {import('../SmashCamera.js').default} options.camera
 * @param {ReturnType<import('./dialogue.js').createDialogue>} options.dialogue
 */
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;


// The HUD would sit on top of the intro plates, so the intro hides it and restores exactly what it
// changed. Nothing is removed from the DOM; gameplay HUD state is untouched.
// `#roundScore` is a fixed element created in main.js, outside `#hud`, and it sits at almost the
// same height as the intro's arena tag. Leaving it out painted the round line straight through the
// arena title, which read as a duplicated title in captures while the tag itself was a single line.
// `#combatCallout` is included for the same reason: a graphics-quality or round callout that fires
// as the match starts otherwise lands on top of the VS beat and the arena title.
const HUD_SELECTORS = ['#hud', '#cameraSettings', '.energyHUD', '#comboNotice', '#exploreHint', '#roundScore', '#combatCallout'];
let hiddenHud = [];
function hideHud() {
  if (typeof document === 'undefined') return;
  hiddenHud = HUD_SELECTORS.map(selector => {
    const node = document.querySelector(selector);
    return node ? [node, node.style.visibility] : null;
  }).filter(Boolean);
  hiddenHud.forEach(([node]) => { node.style.visibility = 'hidden'; });
}
function showHud() {
  hiddenHud.forEach(([node, previous]) => { node.style.visibility = previous || ''; });
  hiddenHud = [];
}

export function createCinematics({ camera = null, dialogue = null, root = null, duration = 5.0 } = {}) {
  const host = root || (typeof document !== 'undefined' ? document.body : null);
  const stats = { played: 0, completed: 0, skipped: 0, lastLines: [], victory: 0 };
  let state = null;

  function teardown({ skipped = false } = {}) {
    if (!state) return false;
    if (state.wrap?.parentNode) state.wrap.parentNode.removeChild(state.wrap);
    showHud();
    dialogue?.cancel?.();
    camera?.endCineShot?.();
    if (skipped) stats.skipped++; else stats.completed++;
    state.active = false;
    state = null;
    return true;
  }

  /**
   * Play the pre-match introduction. Returns its authored duration in seconds so the caller can hold
   * the round for exactly that long.
   */
  function playIntro({ p1 = null, p2 = null, arena = '', round = 1, exchangeIndex = 0, seconds = null } = {}) {
    teardown();
    if (!host || !p1 || !p2) return 0;
    // A longer sequence is allowed for capture/verification runs. The point is that a low frame
    // rate must not tear the overlay down before its own plates have finished sliding in.
    const sequence = Math.max(2, Number(seconds) || duration);
    const wrap = el('div', WRAP_STYLE);
    wrap.id = 'browserSmashCinematic';
    const plateA = el('div', PLATE_STYLE + ';left:3vw', p1.displayName || p1.identity);
    const plateB = el('div', PLATE_STYLE + ';right:3vw;border-left:0;border-right:3px solid #ffc46a;transform:translateX(110%);text-align:right', p2.displayName || p2.identity);
    const tag = el('div', 'position:absolute;left:50%;top:9%;transform:translateX(-50%);font:600 clamp(11px,1.45vw,16px)/1.2 system-ui,sans-serif;letter-spacing:.2em;text-align:center;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis;color:rgba(255,255,255,.82);text-shadow:0 2px 8px rgba(0,0,0,.75)', `${arena || 'ARENA'} · ROUND ${String(round).padStart(2, '0')}`);
    const versus = el('div', 'position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);font:800 clamp(30px,7vw,84px)/1 system-ui,sans-serif;letter-spacing:.08em;color:#fff;text-shadow:0 0 28px rgba(255,196,106,.75),0 4px 18px rgba(0,0,0,.6);opacity:0;transition:opacity .3s', 'VS');
    tag.dataset.role='tag';plateA.dataset.role='plate-a';plateB.dataset.role='plate-b';versus.dataset.role='versus';
    wrap.append(plateA, plateB, tag, versus);
    host.appendChild(wrap);
    hideHud();

    const exchange = exchangeFor(p1.identity, p2.identity, exchangeIndex);
    stats.lastLines = exchange.map(line => line.text);
    stats.played++;
    camera?.focus?.(p1, { seconds: .55, zoom: .14, bias: .22 });

    // Beat list, in seconds from the first frame of the cinematic.
    const beats = [
      { at: .09, fn: () => { plateA.style.transform = 'translateX(0)'; } },
      { at: .30, fn: () => { plateB.style.transform = 'translateX(0)'; } },
      { at: .62, fn: () => { versus.style.opacity = '1'; camera?.impact?.(.12); } },
      { at: 1.20, fn: () => camera?.focus?.(p2, { seconds: .55, zoom: .14, bias: .22 }) },
      { at: 1.50, fn: () => dialogue?.say?.(exchange[0].identity, exchange[0].text, { seconds: 2.2, bank: 'intro' }) },
      { at: 2.95, fn: () => dialogue?.say?.(exchange[1].identity, exchange[1].text, { seconds: 2.2, bank: 'intro' }) },
      {
        at: Math.max(.7, sequence - .55),
        fn: () => {
          versus.style.opacity = '0';
          plateA.style.transform = 'translateX(-110%)';
          plateB.style.transform = 'translateX(110%)';
        }
      }
    ];
    state = { active: true, elapsed: 0, startedAt: now(), duration: sequence, wrap, beats, fired: new Set(), lines: stats.lastLines, skipped: false };
    return sequence;
  }

  /** A victory beat: winner framed, plate and line, closing itself after 2.4 s of game time. */
  function playVictory({ winner = null, loser = null } = {}) {
    if (!host || !winner) return 0;
    teardown();
    const wrap = el('div', WRAP_STYLE);
    wrap.id = 'browserSmashCinematic';
    const plate = el('div', PLATE_STYLE + ';left:50%;top:26%;transform:translate(-50%,0);border-left:0;border-bottom:3px solid #ffc46a', `WINNER · ${winner.displayName || winner.identity}`);
    wrap.append(plate);
    host.appendChild(wrap);
    hideHud();
    camera?.focus?.(winner, { seconds: .6, zoom: .12, bias: .2 });
    dialogue?.say?.(winner.identity, lineFor(winner.identity, 'win'), { seconds: 2.4, bank: 'win' });
    stats.victory++;
    state = { active: true, elapsed: 0, startedAt: now(), duration: 2.4, wrap, beats: [], fired: new Set(), lines: [], skipped: false, victory: true };
    return 2.4;
  }

  /** Advance the cinematic. Called once per frame with the game's own delta. */
  function update(dt) {
    if (!state) return;
    // Elapsed real time, not accumulated frame deltas: a cinematic must last five seconds on a
    // 144 Hz machine and on a software renderer running at two frames a second.
    state.elapsed = Math.max(state.elapsed + Math.max(0, Number(dt) || 0), now() - state.startedAt);
    state.beats.forEach((beat, index) => {
      if (state.fired.has(index) || state.elapsed < beat.at) return;
      state.fired.add(index);
      try { beat.fn(); } catch { /* one bad beat must not stall the match */ }
    });
    if (state.elapsed >= state.duration) teardown();
  }

  /** Skip whatever is playing right now. Returns true if something was actually skipped. */
  function skip() {
    if (!state) return false;
    state.skipped = true;
    return teardown({ skipped: true });
  }

  function end() {
    return teardown();
  }

  function report() {
    return {
      active: Boolean(state?.active),
      elapsed: state ? +state.elapsed.toFixed(2) : 0,
      duration: state?.duration ?? duration,
      lines: state?.lines?.length ? state.lines : stats.lastLines,
      ...stats
    };
  }

  return { playIntro, playVictory, update, skip, end, report, get active() { return Boolean(state?.active); } };
}
