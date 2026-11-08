// Per-identity presentation signatures: the colour and sound of a character's impact.
//
// The combat data already says what a fighter can do (combat/movesets.js: strikes, form, special,
// ultimate) and how they move (combat/locomotion.js). What it did not say was what a character
// *looks and sounds like* when an ability lands, so every fighter's hit produced the same spark
// colour and the same impact pitch.
//
// This module derives a signature from the data that already exists instead of hand-authoring a
// second table that could drift from it:
//   colour  the identity's own form colour when it has one, otherwise a stable hash colour
//   pitch   the impact pitch, chosen by the form's aura family (flame, lightning, shadow, ...)
//   aura    the aura family the moveset declares, or 'none'
//
// A signature never invents a power: it only restyles what movesets.js already defines.

import { MOVESETS } from './movesets.js';

/** Aura family -> impact pitch. Flame and lightning read sharper, shadow and ring read deeper. */
export const AURA_PITCH = Object.freeze({
  flame: 1.08, lightning: 1.24, ring: 0.92, shadow: 0.78, ice: 1.14,
  light: 1.3, wind: 1.18, none: 1
});

/**
 * Explicit tints for identities whose signature should not be their form colour: a fighter whose
 * form is cyan but whose body is crimson, or one with no form at all.
 * Values are presentation only - no damage, reach or cooldown lives here.
 */
export const IDENTITY_TINTS = Object.freeze({
  kratos: { color: 0xc0392b, pitch: 0.84, note: 'Blades and heavy blows read warm and low.' },
  aang: { color: 0x7fd8e8, pitch: 1.18, note: 'Airbending reads light and quick.' },
  edna_mode: { color: 0xd94f8a, pitch: 1.1, note: 'Crisp, precise, high.' },
  arnold_schwarzenegger: { color: 0xd9a441, pitch: 0.8, note: 'Heavy ordnance, low report.' },
  l_death_note_style: { color: 0x8e9bb3, pitch: 0.94, note: 'Quiet, controlled.' },
  iron_man_tony_stark: { color: 0x59eaff, pitch: 1.12, note: 'Repulsor whine.' },
  iron_spider: { color: 0x87d8ff, pitch: 1.16, note: 'Repulsor whine with a metallic edge.' },
  spider_man: { color: 0xf7fbff, pitch: 1.22, note: 'Web snap.' },
  goku: { color: 0xffb347, pitch: 1.04, note: 'Ki discharge.' },
  vegeta: { color: 0x9b6dff, pitch: 1.06, note: 'Ki discharge, sharper.' },
  hulk_bruce_banner: { color: 0x6fbf4a, pitch: 0.72, note: 'Ground-shaking impact.' },
  thor: { color: 0x91eaff, pitch: 1.2, note: 'Thunder crack.' }
});

/** Stable string hash, so an identity without a tint still gets its own colour every run. */
function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A stable, readable colour from a hash: saturated, mid-light, never near-black. */
export function hashColor(value, { saturation = 0.62, lightness = 0.6 } = {}) {
  const hue = (hash(String(value)) % 360) / 360;
  const s = saturation, l = lightness;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = t => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const to255 = n => Math.max(0, Math.min(255, Math.round(n * 255)));
  return (to255(channel(hue + 1 / 3)) << 16) | (to255(channel(hue)) << 8) | to255(channel(hue - 1 / 3));
}

/** The identity slug used by the roster, the manifest and the moveset table. */
export function identitySlug(fighter) {
  const raw = typeof fighter === 'string' ? fighter : (fighter?.identityKey || fighter?.identity || '');
  return String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Presentation signature for a fighter (or an identity slug).
 * Returns `{ identity, color, pitch, aura, style, source }`, where `source` records where the
 * values came from so a report can distinguish a declared tint from a derived one.
 */
export function signatureFor(fighter) {
  const identity = identitySlug(fighter);
  const set = MOVESETS[identity] || null;
  const tint = IDENTITY_TINTS[identity] || null;
  const aura = set?.form?.aura || 'none';
  const color = tint?.color ?? set?.form?.color ?? hashColor(identity || 'fighter');
  const pitch = tint?.pitch ?? AURA_PITCH[aura] ?? 1;
  return {
    identity,
    color,
    pitch: Math.max(0.6, Math.min(1.6, Number(pitch) || 1)),
    aura,
    style: set?.style || 'Unstyled fighter',
    source: tint ? 'identity-tint' : (set?.form?.color != null ? 'moveset-form' : 'hash')
  };
}

/** Impact sound parameters for a landed hit, ready for combatAudio.play(name, params). */
export function impactSoundFor(fighter, intensity = 5) {
  const signature = signatureFor(fighter);
  return { intensity, pitch: signature.pitch };
}

/** Every distinct colour the roster can show, for the asset report and the tests. */
export function rosterSignatures(identities) {
  return identities.map(identity => signatureFor(identity));
}
