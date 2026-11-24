// Build one acceptance matrix from the two real verification artifacts. Structural, integration,
// runtime, visual and gameplay milestones are deliberately separate: this report never promotes a
// row because its clips exist or because a numerical check passed.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BATCH = resolve(ROOT, 'artifacts/rig-batch/verification.json');
const SOLO = resolve(ROOT, 'artifacts/rig-solo/verification.json');

const batch = JSON.parse(await readFile(BATCH, 'utf8'));
const solo = JSON.parse(await readFile(SOLO, 'utf8'));
const rows = new Map();

for (const row of batch.rows) {
  const current = rows.get(row.fighter) || {
    name: row.fighter,
    key: row.key,
    family: 'rig-19-14732939',
    lane: 'shared',
    body: row.url,
    clipsTotal: 0,
    clipsPassed: 0,
    clipsFailed: 0,
    tracksResolved: true,
    problems: []
  };
  current.clipsTotal += 1;
  if (row.status === 'passed') current.clipsPassed += 1;
  else { current.clipsFailed += 1; current.problems.push(`${row.clip}: ${row.errors.join('; ')}`); }
  for (const side of ['native', 'shared']) {
    const tracks = row[side]?.trackStats;
    if (!tracks || tracks.unresolved?.length) current.tracksResolved = false;
  }
  rows.set(row.fighter, current);
}

for (const lane of solo.lanes) {
  const bodyClips = lane.clips.filter(clip => clip.applicable !== false);
  rows.set(lane.name, {
    name: lane.name,
    key: lane.key,
    family: lane.family,
    lane: 'solo',
    body: lane.body,
    clipsTotal: lane.boundClips,
    clipsPassed: bodyClips.filter(clip => clip.passed === true).length,
    clipsFailed: bodyClips.filter(clip => clip.passed === false).length,
    tracksResolved: lane.clips.every(clip => !clip.unresolved?.length),
    nonBodyClips: lane.clips.filter(clip => clip.applicable === false).map(clip => ({
      clip: clip.clip, reason: clip.problems?.[0] || 'non-body'
    })),
    problems: bodyClips.filter(clip => clip.passed === false).map(clip => `${clip.clip}: ${clip.problems.join('; ')}`)
  });
}

const out = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)).map(fighter => {
  const structural = fighter.family === 'rig-19-14732939'
    ? fighter.clipsTotal === 17 && fighter.body
    : fighter.lane === 'solo';
  const integrated = fighter.tracksResolved && fighter.clipsPassed > 0;
  const runtime = fighter.clipsFailed === 0;
  return {
    ...fighter,
    structural,
    integrated,
    runtime,
    visual: false,
    gameplay: false,
    statuses: {
      'STRUCTURALLY COMPATIBLE': structural,
      'ANIMATIONS INTEGRATED': integrated,
      'RUNTIME VERIFIED': runtime,
      'VISUALLY VERIFIED': false,
      'GAMEPLAY ACCEPTED': false
    },
    evidence: fighter.name === 'Hulk (Bruce Banner)'
      ? ['artifacts/hulk/debris-pickup.png', 'artifacts/hulk/debris-throw.png', 'artifacts/hulk/hulk-victory-pose.png']
        .filter(path => existsSync(resolve(ROOT, path)))
      : []
  };
});

const count = (predicate) => out.filter(predicate).length;
const report = {
  generatedAt: new Date().toISOString(),
  sources: { batch: BATCH, solo: SOLO },
  totals: {
    fighters: out.length,
    shared: count(f => f.lane === 'shared'),
    solo: count(f => f.lane === 'solo'),
    structurallyCompatible: count(f => f.structural),
    animationsIntegrated: count(f => f.integrated),
    runtimeVerified: count(f => f.runtime),
    visuallyVerified: count(f => f.visual),
    gameplayAccepted: count(f => f.gameplay),
    sharedCombinations: batch.summary.combinations,
    sharedCombinationsPassed: batch.summary.passed,
    soloBodyClips: solo.summary.bodyClips,
    soloBodyClipsPassed: solo.summary.passedClips,
    soloNonBodyClips: solo.summary.nonBodyClips
  },
  fighters: out,
  notes: [
    'VISUALLY VERIFIED and GAMEPLAY ACCEPTED are false for every fighter until a human review of actual gameplay footage accepts that fighter.',
    'Hulk has debris pickup/throw and victory evidence, but the four camera/static clips are not body animation and do not make the whole Hulk lane visually accepted.',
    'The shared matrix verifies both native and shared-source playback for every one of the 935 combinations.'
  ],
  remainingFailures: [
    'Hulk victory presentation: the final collision-aware camera still renders against a dark terrain surface rather than a readable Hulk in artifacts/hulk/hulk-victory-pose.png and artifacts/hulk/match-victory.png. Playback state is verified; visual presentation is not accepted.',
    'Hulk defeat playback: verify-hulk-match reports hulkDefeatAnim:false while hulkDefeatClip is Armature|hero_hulk01_S09@die. The loss result is reachable, but the defeated-body animation has not been accepted.',
    'No full 60-fighter visual or gameplay acceptance pass exists. The gallery captures representative Kaze, Aquaman, Hulk, Spider-Man, Goku and Naruto frames; the remaining fighters and all 935 shared clips still require human visual review.'
  ]
};

await writeFile(resolve(ROOT, 'artifacts/rig-acceptance.json'), JSON.stringify(report, null, 2));

const md = [];
md.push('# Rig acceptance matrix');
md.push('');
md.push(`Generated ${report.generatedAt}`);
md.push('');
md.push(`- **${report.totals.fighters}** fighters: **${report.totals.shared}** shared and **${report.totals.solo}** solo.`);
md.push(`- Structural: **${report.totals.structurallyCompatible}/${report.totals.fighters}**.`);
md.push(`- Animations integrated: **${report.totals.animationsIntegrated}/${report.totals.fighters}**.`);
md.push(`- Runtime verified: **${report.totals.runtimeVerified}/${report.totals.fighters}**.`);
md.push(`- Visually verified: **${report.totals.visuallyVerified}/${report.totals.fighters}**.`);
md.push(`- Gameplay accepted: **${report.totals.gameplayAccepted}/${report.totals.fighters}**.`);
md.push(`- Shared combinations: **${report.totals.sharedCombinationsPassed}/${report.totals.sharedCombinations}**.`);
md.push(`- Solo body clips: **${report.totals.soloBodyClipsPassed}/${report.totals.soloBodyClips}**; non-body camera/static clips: **${report.totals.soloNonBodyClips}**.`);
md.push('');
md.push('| Fighter | Lane | Family | Body clips | Runtime | Visual | Gameplay |');
md.push('|---|---|---|---:|---|---|---|');
for (const fighter of out) {
  md.push(`| ${fighter.name} | ${fighter.lane} | ${fighter.family} | ${fighter.clipsPassed}/${fighter.clipsTotal} | ${fighter.runtime ? 'yes' : 'no'} | ${fighter.visual ? 'yes' : 'no'} | ${fighter.gameplay ? 'yes' : 'no'} |`);
}
md.push('');
md.push('## Remaining failures');
md.push('');
for (const failure of report.remainingFailures) md.push(`- ${failure}`);
md.push('');
md.push('Visual and gameplay acceptance remain open. The runtime checks are numerical/structural plus mixer execution, not a substitute for watching every fighter in play.');
await writeFile(resolve(ROOT, 'artifacts/rig-acceptance.md'), md.join('\n') + '\n');

console.log(JSON.stringify(report.totals, null, 2));
