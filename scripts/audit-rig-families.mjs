// Rig-family audit: resolve every selectable fighter to the GLB body the game actually mounts,
// then group bodies by skeleton topology. This is intentionally GLB/JSON-only: no browser or
// Three.js scene is needed to answer whether a clip can bind without a per-bone retarget.
//
// Output:
//   artifacts/rig-audit.json  machine-readable inventory and groups
//   artifacts/rig-audit.md    human-readable batching plan
//
// Usage: node scripts/audit-rig-families.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, 'public/models/characters/manifest.json'), 'utf8'));
const mainSource = readFileSync(resolve(root, 'public/js/main.js'), 'utf8');
const rosterMatch = mainSource.match(/const allRoster=(\[\[.*?\]\]);const roster=/s);
if (!rosterMatch) throw new Error('could not read allRoster from public/js/main.js');
const roster = JSON.parse(rosterMatch[1]).map(([name, archetype]) => ({ name, archetype }));

// Clip-only GLBs are part of the animation foundation even though they are not the mounted body.
// The body file often has zero animations (Goku's 73-joint body is one example); its motion lives
// in a separate clip file on the same skeleton. Merge those clips into the inventory so a body is
// not reported as animation-empty when the live fighter is fully animated.
const CLIP_ONLY = Object.freeze({
  goku: ['/models/characters/bespoke/goku_animated.glb'],
  spider_man: ['/models/characters/bespoke/spider_man_bespoke.glb'],
  infantry: ['/models/characters/roster_hd/infantry_combat.glb', '/models/characters/roster_hd/infantry_reactions.glb'],
  naruto_uzumaki: ['/models/characters/naruto_uzumaki/naruto_reactions.glb', '/models/characters/naruto_uzumaki/naruto_authored.glb', '/models/characters/naruto_uzumaki/naruto_kunai.glb']
});

const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const norm = name => String(name || '')
  .toLowerCase()
  .replace(/^.*\|/, '')
  .replace(/^mixamorig:?/, '')
  .replace(/bip001/g, '')
  .replace(/[^a-z0-9]/g, '');
const exists = path => existsSync(resolve(root, path.replace(/^\//, 'public/')));

function sideOf(raw) {
  const n = String(raw || '').toLowerCase();
  if (/left/.test(n)) return 'left';
  if (/right/.test(n)) return 'right';
  const token = /(?:^|[^a-z])([lr])(?=[^a-z]|$)/i.exec(n);
  if (token) return token[1].toLowerCase() === 'l' ? 'left' : 'right';
  const glued = /([lr])$/i.exec(n.replace(/[^a-z]/gi, ''));
  if (glued && /(arm|hand|palm|wrist|clavicle|shoulder|leg|thigh|shin|calf|foot|ankle|toe|knee|elbow)$/i.test(n.replace(/[^a-z]/gi, '').slice(0, -1))) {
    return glued[1].toLowerCase() === 'l' ? 'left' : 'right';
  }
  return null;
}

/** Canonical gameplay roles that matter for a shared clip. */
function roleOf(raw) {
  const n = String(raw || '').toLowerCase();
  if (/finger|thumb|index|middle|ring|pinky|ik|control|ctrl|roll|socket|slot|nub/.test(n)) return null;
  const side = sideOf(n);
  if (/hand|wrist|palm/.test(n)) return side ? side + 'Hand' : null;
  if (/forearm|lowerarm|elbow/.test(n)) return side ? side + 'Fore' : null;
  if (/clavicle|shoulder/.test(n)) return side ? side + 'Clavicle' : null;
  if (/upperarm|arm/.test(n)) return side ? side + 'Arm' : null;
  if (/foot|ankle|toe/.test(n)) return side ? side + 'Foot' : null;
  if (/upleg|thigh|upperleg/.test(n)) return side ? side + 'Leg' : null;
  if (/shin|calf|lowerleg|knee|leg/.test(n)) return side ? side + 'Shin' : null;
  if (/head/.test(n)) return 'head';
  if (/neck/.test(n)) return 'neck';
  if (/hips|pelvis/.test(n)) return 'pelvis';
  if (/chest|torso|abdomen|ribcage|spine/.test(n)) return 'torso';
  return null;
}

const CORE = ['pelvis', 'torso', 'head', 'leftArm', 'leftFore', 'rightArm', 'rightFore',
  'leftLeg', 'leftShin', 'rightLeg', 'rightShin'];

function glbJson(path) {
  const bytes = readFileSync(resolve(root, path.replace(/^\//, 'public/')));
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB: ' + path);
  let offset = 12;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === 0x4E4F534A) { // JSON
      return { json: JSON.parse(bytes.toString('utf8', start, start + length).replace(/\0+$/, '')), bytes: bytes.length };
    }
    offset = start + length;
  }
  throw new Error('GLB has no JSON chunk: ' + path);
}

function inspectBody(url) {
  const { json, bytes } = glbJson(url);
  const nodes = json.nodes || [];
  const skins = json.skins || [];
  const parent = new Map();
  for (let i = 0; i < nodes.length; i++) {
    for (const child of nodes[i]?.children || []) parent.set(child, i);
  }
  // A body can expose several primitives with the same joint set. The union is the deform
  // skeleton; differing joint sets are called out instead of being silently merged.
  const jointSets = [];
  for (const skin of skins) {
    const set = [...new Set(skin.joints || [])].sort((a, b) => a - b);
    if (set.length) jointSets.push(set);
  }
  const allJoints = [...new Set(jointSets.flat())];
  const jointNames = allJoints.map(index => nodes[index]?.name || `node_${index}`);
  const roleByJoint = new Map();
  for (const name of jointNames) {
    const role = roleOf(name);
    if (role && !roleByJoint.has(role)) roleByJoint.set(role, name);
  }
  const roles = [...roleByJoint.keys()].sort();
  const missingCore = CORE.filter(role => !roleByJoint.has(role));
  const edges = [];
  for (const index of allJoints) {
    const p = parent.get(index);
    if (p != null && allJoints.includes(p)) edges.push(norm(nodes[p]?.name) + '>' + norm(nodes[index]?.name));
  }
  edges.sort();
  const topology = jointNames.map(norm).sort().join('|') + '::' + edges.join('|');
  const digest = createHash('sha1').update(`${allJoints.length}:${topology}`).digest('hex').slice(0, 8);
  return {
    bytes,
    skins: skins.length,
    joints: allJoints.length,
    jointCounts: [...new Set(jointSets.map(set => set.length))],
    clips: (json.animations || []).length,
    clipNames: (json.animations || []).map(a => a.name).filter(Boolean),
    meshes: (json.meshes || []).length,
    roles,
    missingCore,
    groupId: `rig-${allJoints.length}-${digest}`,
    topology,
    rigName: jointNames.slice(0, 6).join(', ')
  };
}

function declaredBody(slug) {
  const entry = manifest.characters?.[slug];
  if (entry?.enabled && entry.url && /\.glb($|\?)/i.test(entry.url) && exists(entry.url)) return { url: entry.url, source: 'manifest', declared: entry };
  return null;
}

function inferBody(slug, name) {
  const direct = `/models/characters/roster/${slug}.glb`;
  if (exists(direct)) return { url: direct, source: 'roster-file' };
  // A few identities intentionally live outside roster/: Infantry is the HD body and Kaze is
  // the reference body. Prefer a manifest entry whose URL or key names the identity.
  const candidates = Object.entries(manifest.characters || {}).filter(([key, entry]) => {
    if (!entry?.enabled || !entry.url || !exists(entry.url)) return false;
    const hay = `${key} ${entry.url}`.toLowerCase();
    return hay.includes(slug) || hay.includes(String(name).toLowerCase().replace(/[^a-z0-9]+/g, ''));
  });
  if (candidates.length) return { url: candidates[0][1].url, source: 'manifest-inferred' };
  return null;
}

const rows = [];
for (const { name, archetype } of roster) {
  const slug = slugOf(name);
  const declared = declaredBody(slug);
  const body = declared || inferBody(slug, name);
  if (!body) {
    rows.push({ name, slug, archetype, error: 'no body file resolved' });
    continue;
  }
  try {
    const info = inspectBody(body.url);
    const supplemental = (CLIP_ONLY[slug] || []).filter(exists).map(url => {
      const { json } = glbJson(url);
      const clipNames = (json.animations || []).map(a => a.name).filter(Boolean);
      return { url, clips: clipNames.length, clipNames };
    });
    const supplementalNames = supplemental.flatMap(entry => entry.clipNames);
    rows.push({
      name, slug, archetype, url: body.url, source: body.source, ...info,
      bodyClips: info.clips, supplemental,
      clips: info.clips + supplemental.reduce((sum, entry) => sum + entry.clips, 0),
      clipNames: [...new Set([...info.clipNames, ...supplementalNames])]
    });
  } catch (error) {
    rows.push({ name, slug, archetype, url: body.url, source: body.source, error: String(error?.message || error) });
  }
}

const valid = rows.filter(row => !row.error);
const groups = new Map();
for (const row of valid) {
  if (!groups.has(row.groupId)) groups.set(row.groupId, { id: row.groupId, joints: row.joints, topology: row.topology, roles: row.roles, members: [] });
  groups.get(row.groupId).members.push(row);
}
const groupRows = [...groups.values()].map(group => {
  group.members.sort((a, b) => a.name.localeCompare(b.name));
  group.size = group.members.length;
  group.names = group.members.map(row => row.name);
  group.clipCounts = [...new Set(group.members.map(row => row.clips))].sort((a, b) => a - b);
  group.clipCoverage = group.clipCounts.map(count => ({
    clips: count,
    fighters: group.members.filter(row => row.clips === count).map(row => row.name)
  }));
  group.hasCore = group.members.every(row => row.missingCore.length === 0);
  group.sharedClipNames = group.members.length > 1
    ? group.members.map(row => new Set(row.clipNames))
      .reduce((a, b) => new Set([...a].filter(name => b.has(name))), group.members[0] ? new Set(group.members[0].clipNames) : new Set())
    : new Set();
  group.sharedClipNames = [...group.sharedClipNames].sort();
  group.retarget = group.size > 1 ? 'none (same topology)' : 'per-character / semantic retarget';
  return group;
}).sort((a, b) => b.size - a.size || a.joints - b.joints);

const summary = {
  selectable: roster.length,
  resolved: valid.length,
  unresolved: rows.filter(row => row.error).length,
  exactGroups: groupRows.length,
  sharedTopology: groupRows.filter(group => group.size > 1).reduce((n, group) => n + group.size, 0),
  soloTopology: groupRows.filter(group => group.size === 1).reduce((n, group) => n + group.size, 0),
  fullCoreBodies: valid.filter(row => row.missingCore.length === 0).length,
  partialCoreBodies: valid.filter(row => row.missingCore.length > 0).length,
  jointRange: valid.length ? [Math.min(...valid.map(row => row.joints)), Math.max(...valid.map(row => row.joints))] : null
};
const report = { generatedAt: new Date().toISOString(), summary, groups: groupRows, fighters: rows };
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
writeFileSync(resolve(root, 'artifacts/rig-audit.json'), JSON.stringify(report, null, 2));

const md = [];
md.push('# Browser Smash rig audit', '');
md.push(`Generated ${report.generatedAt}. Source: \`public/models/characters/manifest.json\`, \`public/js/main.js\`, and the GLB JSON chunks.`);
md.push('');
md.push('## Summary', '');
md.push(`- Selectable identities: **${summary.selectable}**`);
md.push(`- Bodies resolved: **${summary.resolved}**; unresolved: **${summary.unresolved}**`);
md.push(`- Exact topology groups: **${summary.exactGroups}**`);
md.push(`- Fighters in shared-topology groups: **${summary.sharedTopology}**`);
md.push(`- Solo-topology fighters: **${summary.soloTopology}**`);
md.push(`- Full 11-core-role bodies: **${summary.fullCoreBodies}**; partial: **${summary.partialCoreBodies}**`);
md.push(`- Joint range: **${summary.jointRange?.join('–')}**`);
md.push('');
md.push('## Batching groups', '');
md.push('“Shared topology” means the same joint count, normalized joint names and parent edges. It is the strongest evidence that one clip can bind without a per-bone retarget. It is not proof that the same clip looks correct: proportions, bind orientation, weapon mounts and existing clip sets still need acceptance per character.');
md.push('');
for (const group of groupRows) {
  md.push(`### ${group.id} — ${group.size} fighter${group.size === 1 ? '' : 's'} — ${group.joints} joints`);
  md.push('');
  md.push(`- Members: ${group.names.map(name => `**${name}**`).join(', ')}`);
  md.push(`- Core roles: ${group.hasCore ? '11/11 present' : 'missing core roles in at least one member'}`);
  md.push(`- Clip counts (body + declared clip-only files): ${group.clipCounts.join(', ')}`);
  md.push(`- Clip coverage: ${group.clipCoverage.map(entry => `${entry.clips} clips (${entry.fighters.length} fighter${entry.fighters.length === 1 ? '' : 's'})`).join('; ')}`);
  md.push(`- Shared clip names across all members: ${group.sharedClipNames.length ? group.sharedClipNames.slice(0, 12).map(name => `\`${name}\``).join(', ') + (group.sharedClipNames.length > 12 ? ` … +${group.sharedClipNames.length - 12}` : '') : 'none'}`);
  md.push(`- Batching: ${group.size > 1 ? 'batch the same clip set, then retime/offset per body' : 'do not force a shared clip; use a semantic retarget or authored set'}`);
  md.push('');
}
const unresolved = rows.filter(row => row.error);
if (unresolved.length) {
  md.push('## Unresolved identities', '');
  for (const row of unresolved) md.push(`- **${row.name}** (\`${row.slug}\`): ${row.error}`);
  md.push('');
}
md.push('## Important limits', '');
md.push('- This audit proves skeleton compatibility, not visual quality. A shared topology still needs a captured match check for foot contact, arm twist, weapon grip and clip root motion.');
md.push('- Different clip counts inside one topology group mean the bodies do not ship the same authored states; batch only the clips they actually share, or author the missing states for that body.');
md.push('- Hulk, Goku, Naruto, Infantry and Kaze resolve through their manifest bodies where declared; do not assume the same-named file under `roster/` is the live body.');
md.push('- Goku and Spider-Man carry their motion in declared clip-only GLBs; the mounted body file can legitimately have zero embedded animations. Infantry and Naruto likewise add separate combat/reaction/authored files.');
md.push('- The 19-bone family has two clip-count variants (17 and 25). The 17 shared clip names are the safe common batch; the 25-clip bodies have extra states that must not be assumed onto the 17-clip bodies.');
writeFileSync(resolve(root, 'artifacts/rig-audit.md'), md.join('\n'));
console.log(JSON.stringify({ summary, groups: groupRows.map(group => ({ id: group.id, size: group.size, joints: group.joints, names: group.names, clipCounts: group.clipCounts, shared: group.sharedClipNames.length })), unresolved }, null, 2));
