import { EXTRA_LINES } from './dialogue_banks.js';
// Character voice and dialogue: original lines, subtitles, and a per-character synthetic voice.
//
// Two honest constraints shape this module:
//   1. There are no recorded voice actors here, and imitating a real performer is not acceptable.
//      Voice identity therefore comes from the browser's speech synthesiser with a distinct pitch
//      and rate per fighter, and every line is also rendered as a subtitle so the presentation
//      works with sound off and on machines without speech synthesis.
//   2. All lines are original writing for this game. Nothing is transcribed from a film, show or
//      the games being referenced as presentation targets.
//
// The system is data-first: a fighter adds lines by adding an entry to LINES. Unknown fighters fall
// back to a neutral voice bank rather than going silent.

/** Per-character voice settings and original dialogue. */
const BASE_LINES = Object.freeze({
  naruto_uzumaki: {
    voice: { pitch: 1.25, rate: 1.06 },
    intro: ["I've come too far to lose here.", 'My clones and I will show you what that training was for.'],
    win: ['That is what believing in yourself gets you.', 'Next time, bring more than one plan.'],
    lose: ['I am not done. I will get stronger and come back.'],
    form: ['This is the power I was given. I will not waste it.'],
    ultimate: ['Everything I have, all at once!'],
    ability: ['Shadow clones, move with me!', 'Rasengan!']
  },
  thor: {
    voice: { pitch: .82, rate: .92 },
    intro: ['You face the storm itself.', 'Stand your ground. It will be over quickly.'],
    win: ['The thunder answers to me alone.', 'You fought well. That is the only mercy you get.'],
    lose: ['Even storms are humbled. Remember this.'],
    form: ['Feel the weight of the heavens!'],
    ultimate: ['The sky breaks with me!'],
    ability: ['Mjolnir, to me!']
  },
  kratos: {
    voice: { pitch: .7, rate: .88 },
    intro: ['You should have walked away.', 'There is no glory waiting at the end of this.'],
    win: ['It is finished.', 'Do not return.'],
    lose: ['The fault is mine. It always is.'],
    form: ['Rage is a tool. I am its master.'],
    ultimate: ['For everything I have lost!'],
    ability: ['Blades, hungry and ready.']
  },
  edward_elric: {
    voice: { pitch: 1.05, rate: 1.08 },
    intro: ['Equivalent exchange. You give, I take.', 'I did not come here to lose.'],
    win: ['That is the price of underestimating me.', 'Nothing comes free. You just paid.'],
    lose: ['I miscalculated. It will not happen twice.'],
    form: ['Alchemy answers when I call.'],
    ultimate: ['Everything, transmuted at once!'],
    ability: ['Let me show you real alchemy.']
  },
  captain_jack_sparrow: {
    voice: { pitch: .98, rate: .98 },
    intro: ["I've a ship to find and no time for this.", 'Do try to keep up, there is a good fellow.'],
    win: ['That went rather better than expected.', 'I would love to stay and gloat, but I have a tide to catch.'],
    lose: ['A temporary setback. Ask anyone.'],
    form: ['Now the odds look far more interesting.'],
    ultimate: ['All hands, and all of me!'],
    ability: ['A little misdirection goes a long way.']
  },
  lord_voldemort: {
    voice: { pitch: .62, rate: .82 },
    intro: ['You will kneel, or you will break.', 'There is no spell that saves you from me.'],
    win: ['There is no power you could have offered me.', 'Let this be the last lesson you receive.'],
    lose: ['Impossible. I will not be diminished.'],
    form: ['Witness what I have become.'],
    ultimate: ['Everything I am, unleashed!'],
    ability: ['You cannot deflect what you cannot see.']
  },
  aquaman: {
    voice: { pitch: .74, rate: .9 },
    intro: ['The tide does not negotiate.', 'Stand aside. The deep is patient, I am not.'],
    win: ['The sea keeps what it takes.'],
    lose: ['The current turns. Next time it turns for me.'],
    form: ['The deep answers my call.'],
    ultimate: ['Let the ocean rise!'],
    ability: ['Water remembers every strike.']
  },
  green_lantern_hal_jordan: {
    voice: { pitch: .9, rate: 1.0 },
    intro: ['Will is the only weapon that never runs out.', 'Let us see what you are made of.'],
    win: ['Will beats fear. Every time.'],
    lose: ['I blinked. It will not happen again.'],
    form: ['This ring does not run out of will.'],
    ultimate: ['Everything I can imagine, all at once!'],
    ability: ['The ring makes it real.']
  }
});

// The roster-wide banks: EXTRA_LINES covers the other 26 identities, BASE_LINES the authored eight.
// Authored entries win on a key collision.
export const LINES = Object.freeze({ ...EXTRA_LINES, ...BASE_LINES });

const FALLBACK = Object.freeze({
  voice: { pitch: 1, rate: 1 },
  intro: ['Let us finish this properly.'],
  win: ['It is decided.'],
  lose: ['Not this time.'],
  form: ['A new level of power.'],
  ultimate: ['All of it, now!'],
  ability: ['Take this!']
});


/**
 * Fighters carry a display name ("Naruto Uzumaki", "Lord Voldemort"); the banks are keyed by roster
 * identity. Normalising here means every lookup is one code path and a fighter added to LINES works
 * from both spellings.
 */
export function characterKey(identity) {
  const raw = String(identity || '').trim();
  if (!raw) return '';
  if (LINES[raw]) return raw;
  const slug = raw
    .toLowerCase()
    .replace(/[()\[\]{}.'’,]/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return LINES[slug] ? slug : raw;
}

export function voiceFor(identity) {
  return (LINES[characterKey(identity)] || FALLBACK).voice;
}

/** One original line from a bank, chosen deterministically per exchange index. */
export function lineFor(identity, bank = 'intro', index = 0) {
  const source = LINES[characterKey(identity)] || FALLBACK;
  const lines = source[bank] || source.intro;
  return lines[index % lines.length];
}

/** Fight-start exchange: one line each, opponent-specific where that reads naturally. */
export function exchangeFor(first, second, index = 0) {
  return [
    { identity: first, text: lineFor(first, 'intro', index) },
    { identity: second, text: lineFor(second, 'intro', index + 1) }
  ];
}

const STYLE = {
  plate: 'position:absolute;top:14%;padding:.6rem 1.1rem;font:600 clamp(14px,2.1vw,24px)/1.2 system-ui,sans-serif;letter-spacing:.14em;color:#fff;background:linear-gradient(90deg,rgba(8,14,26,.92),rgba(8,14,26,0));border-left:3px solid #ffc46a;text-transform:uppercase;white-space:nowrap',
  plateRight: 'left:auto;right:0;background:linear-gradient(270deg,rgba(8,14,26,.92),rgba(8,14,26,0));border-left:0;border-right:3px solid #ffc46a;text-align:right',
  sub: 'position:absolute;left:50%;transform:translateX(-50%);bottom:17%;max-width:min(760px,84vw);padding:.55rem .95rem;font:500 clamp(13px,1.7vw,19px)/1.45 system-ui,sans-serif;color:#f7f5ef;background:rgba(6,10,18,.78);border:1px solid rgba(255,255,255,.14);border-radius:3px;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.8)',
  name: 'display:block;font-size:.72em;letter-spacing:.22em;color:#ffc46a;margin-bottom:.25rem'
};

export const DIALOGUE_ENABLED_DEFAULT = true;

/**
 * `root` is normally document.body. Subtitle nodes are created once and reused, so repeated lines do
 * not accumulate DOM nodes.
 */
export function createDialogue({ root = null, speak = true } = {}) {
  const host = root || (typeof document !== 'undefined' ? document.body : null);
  let subtitle = null;
  let timer = null;
  let current = null;
  const stats = { lines: 0, spoken: 0, muted: false, last: null, banks: Object.create(null) };
  const canSpeak = () => speak && !stats.muted && typeof globalThis.speechSynthesis?.speak === 'function'
    && typeof globalThis.SpeechSynthesisUtterance === 'function';

  function ensureSubtitle() {
    if (subtitle || !host) return subtitle;
    subtitle = document.createElement('div');
    subtitle.id = 'browserSmashSubtitle';
    subtitle.style.cssText = STYLE.sub;
    subtitle.style.display = 'none';
    subtitle.setAttribute('role', 'status');
    subtitle.setAttribute('aria-live', 'polite');
    host.appendChild(subtitle);
    return subtitle;
  }

  function cancelSpeech() {
    try { globalThis.speechSynthesis?.cancel?.(); } catch { /* ignore */ }
  }

  function cancel() {
    cancelSpeech();
    if (timer) clearTimeout(timer);
    timer = null;
    if (subtitle) subtitle.style.display = 'none';
    current = null;
  }

  /** Render + speak one line. `seconds` is how long the subtitle stays up. */
  function say(identity, text, { seconds = 2.6, bank = 'line' } = {}) {
    if (!text) return null;
    stats.lines++;
    stats.banks[bank] = (stats.banks[bank] || 0) + 1;
    stats.last = { identity, text, bank };
    const node = ensureSubtitle();
    if (node) {
      node.style.display = 'block';
      // Names come from the roster display name; the identity key is only a fallback.
      node.textContent = `${identity.replace(/_/g, ' ').toUpperCase()}: ${text}`;
    }
    if (canSpeak()) {
      try {
        const utterance = new globalThis.SpeechSynthesisUtterance(text);
        const voice = voiceFor(identity);
        utterance.pitch = Math.max(0, Math.min(2, voice.pitch));
        utterance.rate = Math.max(.5, Math.min(2, voice.rate));
        utterance.volume = .9;
        cancelSpeech();
        globalThis.speechSynthesis.speak(utterance);
        stats.spoken++;
      } catch { /* subtitles remain the source of truth */ }
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { if (node) node.style.display = 'none'; }, Math.max(600, seconds * 1000));
    return { identity, text };
  }

  /**
   * Attack presentation callout. Only abilities, forms, ultimates and clone jutsu speak; ordinary
   * light attacks would turn the match into constant chatter.
   */
  function callout(identity, kind, label) {
    if (!identity || !['ability', 'form', 'ultimate', 'clone'].includes(kind)) return null;
    const bank = kind === 'form' ? 'form' : kind === 'ultimate' ? 'ultimate' : 'ability';
    const line = kind === 'ability' || kind === 'clone'
      ? (LINES[characterKey(identity)] || FALLBACK).ability?.[0]
      : lineFor(identity, bank);
    return say(identity, line, { seconds: 2.2, bank });
  }

  function setMuted(value) {
    stats.muted = Boolean(value);
    if (stats.muted) cancelSpeech();
  }

  function report() {
    return { ...stats, banks: { ...stats.banks }, speaking: Boolean(globalThis.speechSynthesis?.speaking) };
  }

  return { say, callout, cancel, setMuted, report, get enabled() { return !stats.muted; }, get subtitleVisible() { return Boolean(subtitle && subtitle.style.display !== 'none'); } };
}
