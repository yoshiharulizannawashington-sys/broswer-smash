// Asset classification for the online character import system.
//
// A search hit is not a character. Sketchfab happily returns headbands, ramen shops and
// environment scans for "naruto", so every result is classified from its name, tags, source
// categories and rig evidence before the UI is allowed to call it a character. The classifier
// reports the reasons it decided, and low-confidence results are labelled as such rather than
// being promoted to "playable character".

export const KINDS = ['character', 'creature', 'weapon', 'armor', 'accessory', 'environment', 'vehicle', 'material', 'unknown'];

const RULES = [
  ['material', /\b(texture|material|pbr|hdri|hdr|surface|tiles?|brick|plaster|fabric|concrete|asphalt|marble|metal plate|wall panel)s?\b/i],
  ['weapon', /\b(sword|katana|dagger|blade|axe|hatchet|spear|lance|bow|arrow|gun|rifle|pistol|shotgun|knife|hammer|mace|club|staff|wand|scythe|weapon|shield)\b/i],
  ['armor', /\b(helmet|helm|armou?r|gauntlet|pauldron|greave|breastplate|cuirass|chestplate|mask|visor)\b/i],
  ['accessory', /\b(headband|bandana|scarf|cape|cloak|hat|cap|glasses|goggles|necklace|ring|belt|bag|backpack|pouch|boots?|gloves?|earring|crown|tiara|badge|emblem|flag|banner)\b/i],
  ['vehicle', /\b(car|truck|ship|boat|plane|aircraft|bike|motorcycle|tank|train|shuttle|spaceship)\b/i],
  ['creature', /\b(dragon|beast|monster|animal|dog|cat|wolf|fox|bird|horse|dinosaur|creature|golem|slime|insect)\b/i],
  ['environment', /\b(house|building|tower|castle|room|hall|kitchen|library|classroom|dungeon|temple|shrine|forest|tree|terrain|landscape|cave|street|city|arena|stage|chair|table|sofa|lamp|barrel|crate|box|rock|cliff|bridge|fence|door|window|roof|wall|floor|ground|shelf|sign)s?\b/i],
  ['character', /\b(character|humanoid|warrior|knight|soldier|fighter|hero|villain|ninja|samurai|wizard|mage|archer|robot|android|cyborg|man|woman|boy|girl|human|person|guy|gal|king|queen|prince|princess|lord|saint|angel|demon|zombie|skeleton|pirate|viking|monk|boxer|wrestler)\b/i]
];

const CATEGORY_HINTS = [
  ['character', /character|people|human|creature|person/i],
  ['weapon', /weapon|military|gun|melee/i],
  ['armor', /armou?r/i],
  ['environment', /architecture|environment|interior|exterior|building|nature|terrain|food|plant/i],
  ['vehicle', /vehicle|car|aircraft|boat/i],
  ['material', /material|texture/i]
];

const HUMANISH = /\b(character|humanoid|warrior|knight|soldier|fighter|hero|ninja|samurai|wizard|mage|robot|cyborg|man|woman|boy|girl|human|person|king|queen|pirate|viking|monk|boxer|wrestler)\b/i;

const score = (text, regex) => {
  const matches = String(text).match(new RegExp(regex.source, 'gi'));
  return matches ? matches.length : 0;
};

/**
 * @param {{name?:string, tags?:string[], categories?:string[], rig?:'yes'|'no'|'unknown', animations?:number|null, triangles?:number|null, source?:string}} input
 * @returns {{kind:string, playable:boolean, humanoid:boolean, confidence:'high'|'medium'|'low', reasons:string[]}}
 */
export function classify(input = {}) {
  const name = String(input.name || '');
  const tags = (input.tags || []).map(String);
  const categories = (input.categories || []).map(String);
  const text = [name, ...tags, ...categories].join(' ');
  const reasons = [];
  const totals = Object.fromEntries(KINDS.map(kind => [kind, 0]));

  for (const [kind, regex] of RULES) {
    const inName = score(name, regex);
    const inTags = score(tags.join(' '), regex);
    const inCategories = score(categories.join(' '), regex);
    // A concrete object named in the tags ("sword", "helmet") is strong evidence; a generic
    // catalogue bucket like "props" is not, so categories alone never outvote an object noun.
    totals[kind] += inName * 4 + inTags * 3 + inCategories * 2;
    if (inName || inTags || inCategories) {
      const where = [inName && 'name', inTags && 'tags', inCategories && 'categories'].filter(Boolean).join('+');
      reasons.push(`${kind} keyword in ${where}`);
    }
  }
  for (const [kind, regex] of CATEGORY_HINTS) {
    if (categories.some(category => regex.test(category))) { totals[kind] += 4; reasons.push(`source category says ${kind}`); }
  }
  // "props", "tools", "furniture" describe a catalogue shelf, not what the object is.
  if (categories.some(category => /prop|tool|furniture/i.test(category))) {
    totals.environment += 1;
    reasons.push('listed on a props/tools shelf (weak signal only)');
  }

  // Rig evidence is the strongest signal that something can become a fighter, but it never
  // overrides a clear prop/environment name: a rigged pirate ship is still a ship.
  const humanoidName = HUMANISH.test(name) || tags.some(tag => HUMANISH.test(tag));
  if (input.rig === 'yes') { totals.character += humanoidName ? 6 : 2; reasons.push('source reports a skeleton'); }
  if (input.rig === 'no') { totals.character -= 3; reasons.push('source reports no skeleton'); }
  if ((input.animations || 0) > 0) { totals.character += Math.min(4, input.animations); reasons.push(`${input.animations} animation clip(s)`); }
  if (input.rig === 'unknown') totals.character -= 1;

  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const [kind, best] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  const resolvedKind = best <= 0 ? 'unknown' : kind;
  const confidence = best <= 0 ? 'low' : best - runnerUp >= 4 ? 'high' : best - runnerUp >= 2 ? 'medium' : 'low';
  const humanoid = resolvedKind === 'character' && (humanoidName || input.rig === 'yes');
  // An unrigged humanoid is still character material: the pipeline can generate a rig. Whether it
  // is rigged today is reported separately, so the import path and the rig state stay distinct.
  const playable = humanoid;
  if (resolvedKind === 'unknown') reasons.push('no reliable keyword or rig evidence');
  if (resolvedKind === 'character' && !humanoidName) reasons.push('character score but no humanoid wording — treated as unconfirmed');

  return { kind: resolvedKind, playable, humanoid, confidence, reasons: [...new Set(reasons)].slice(0, 5) };
}

/** Filter rows for the result list. */
export function matchesFilters(row, { kind, rigged, animated, maxTriangles, downloadable } = {}) {
  if (kind && kind !== 'all' && row.classification?.kind !== kind) return false;
  if (rigged === 'yes' && row.rig !== 'yes') return false;
  if (rigged === 'no' && row.rig !== 'no') return false;
  if (animated === 'yes' && !(row.animations > 0)) return false;
  if (animated === 'no' && row.animations > 0) return false;
  if (maxTriangles && Number(row.triangles) > Number(maxTriangles)) return false;
  if (downloadable === 'yes' && !row.downloadable) return false;
  return true;
}
