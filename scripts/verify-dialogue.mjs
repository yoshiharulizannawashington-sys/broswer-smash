// Dialogue-bank quality gate.
//
// Coverage (38/38 identities) is not quality: this checks that every fighter resolves to its own
// bank, that all six occasions are written, that no line is shared between two fighters, that no
// bank names another fighter, and that per-character voice settings stay in a sane, distinct range.
//
// It does NOT verify how a voice sounds. This VM has no audio output device, so listening is a
// separate, unperformed check.
import { LINES, characterKey, voiceFor, lineFor, exchangeFor } from '../public/js/presentation/dialogue.js';
import { MOVESETS } from '../public/js/combat/movesets.js';

let checks = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) failures.push(`${name}${detail ? ' — ' + detail : ''}`);
};

const BANKS = ['intro', 'win', 'lose', 'form', 'ultimate', 'ability'];
const identities = Object.keys(MOVESETS);

check('the roster is populated', identities.length >= 30, `${identities.length} identities`);

// 1. Every fighter resolves to its own authored bank, not the fallback.
const unresolved = identities.filter(identity => !LINES[characterKey(identity)]);
check('every roster identity resolves to an authored bank', unresolved.length === 0, unresolved.join(', '));

// 2. Every bank writes all six occasions with real lines.
const incomplete = [];
for (const identity of identities) {
  const bank = LINES[characterKey(identity)];
  if (!bank) continue;
  for (const occasion of BANKS) {
    const lines = bank[occasion];
    // Short vocalisations are legitimate writing for some fighters (Link's "Hyaa!"), so the gate is
    // "present and not empty", not "at least eight characters".
    if (!Array.isArray(lines) || !lines.length || lines.some(line => typeof line !== 'string' || line.trim().length < 2)) {
      incomplete.push(`${identity}:${occasion}`);
    }
  }
}
check('every bank writes intro/win/lose/form/ultimate/ability', incomplete.length === 0, incomplete.slice(0, 6).join(', '));

// 3. Bank lookups return that fighter's own writing.
const wrongBank = identities.filter(identity => {
  const bank = LINES[characterKey(identity)];
  return !bank || !bank.intro.includes(lineFor(identity, 'intro', 0));
});
check('lineFor returns lines from the fighter’s own bank', wrongBank.length === 0, wrongBank.slice(0, 5).join(', '));

// 4. No line is reused by a second fighter (a shared bank reads as one narrator).
const owners = new Map();
const shared = [];
for (const [key, bank] of Object.entries(LINES)) {
  for (const occasion of BANKS) {
    for (const line of bank[occasion] || []) {
      const normalized = line.trim().toLowerCase();
      const previous = owners.get(normalized);
      if (previous && previous !== key) shared.push(`${previous} / ${key}: "${line.slice(0, 40)}"`);
      else owners.set(normalized, key);
    }
  }
}
check('no dialogue line is shared between two fighters', shared.length === 0, shared.slice(0, 4).join(' | '));

// 5. A fighter's bank must not name another fighter. Only distinctive words (6+ letters) are
//    treated as names, so "Mario" in Luigi's lines or a shared English word is not a failure.
// Generic words that happen to appear in a fighter's roster name are not names on their own:
// "master" in Master Chief must not flag Kratos' "I am its master".
const GENERIC = new Set(['master', 'chief', 'doctor', 'professor', 'captain', 'wonder', 'woman', 'green', 'lantern', 'iron', 'hulk', 'banner', 'flash', 'might', 'solid', 'snake', 'silver', 'golden']);
const names = new Map();
for (const identity of identities) {
  const words = identity.split('_').filter(word => word.length >= 6 && !GENERIC.has(word));
  for (const word of words) names.set(word, identity);
}
const crossName = [];
for (const identity of identities) {
  const bank = LINES[characterKey(identity)];
  if (!bank) continue;
  const own = new Set(identity.split('_'));
  for (const occasion of BANKS) {
    for (const line of bank[occasion] || []) {
      for (const [word, owner] of names) {
        if (owner === identity || own.has(word)) continue;
        if (new RegExp(`\\b${word}\\b`, 'i').test(line)) crossName.push(`${identity} → ${word}: "${line.slice(0, 40)}"`);
      }
    }
  }
}
check('no bank names another fighter', crossName.length === 0, crossName.slice(0, 4).join(' | '));

// 6. Voice settings: in range and distinct enough that fighters do not all sound identical.
const voices = identities.map(identity => voiceFor(identity));
const inRange = voices.every(voice => voice && voice.pitch >= 0.5 && voice.pitch <= 1.5 && voice.rate >= 0.6 && voice.rate <= 1.4);
check('every voice pitch/rate is inside the speech synthesiser’s usable range', inRange);
const distinctVoices = new Set(voices.map(voice => `${voice.pitch}/${voice.rate}`));
check('at least 20 fighters have a distinct pitch/rate pair', distinctVoices.size >= 20, `${distinctVoices.size} distinct of ${voices.length}`);
const lowered = voices.filter(voice => voice.pitch < 1).length;
check('the roster is not pitched to a single register', lowered >= 5 && lowered <= voices.length - 5, `${lowered} lowered`);

// 7. The intro exchange pairs each fighter with its own line, not the opponent's.
const pair = exchangeFor(identities[0], identities[1], 0);
check('the intro exchange speaks for the fighter who owns each line',
  pair[0].identity === identities[0] && pair[1].identity === identities[1]
  && pair[0].text === lineFor(identities[0], 'intro', 0)
  && pair[1].text === lineFor(identities[1], 'intro', 1), JSON.stringify(pair));

// 8. The fallback still works for an unknown identity rather than going silent.
check('an unknown fighter falls back instead of going silent', typeof lineFor('Some Unlisted Fighter', 'intro') === 'string' && lineFor('Some Unlisted Fighter', 'intro').length > 0);

console.log('DIALOGUE QUALITY');
console.log(JSON.stringify({ identities: identities.length, banks: Object.keys(LINES).length, distinctVoices: distinctVoices.size, lines: owners.size, checks, failures }, null, 1));
if (failures.length) {
  console.error('FAILURES:\n' + failures.map(f => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log(`Dialogue quality passed (${checks} checks).`);
