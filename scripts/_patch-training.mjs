// One-shot patch: training mode and match statistics.
//
// main.js is a large minified module that the editing tool refuses as a payload, so the real edits
// are applied here with exact anchors. Every anchor must be found exactly once or nothing is
// written, so a stale anchor can never half-apply a patch.
//
//   node scripts/_patch-training.mjs
//   node scripts/_patch-training.mjs --check
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = new URL('../public/js/main.js', import.meta.url);
const checkOnly = process.argv.includes('--check');

const NEUTRAL = '{left:false,right:false,up:false,down:false,run:false,sprint:false,jump:false,dodge:false,attack:false,special:false,shield:false,parry:false,ascend:false,descend:false,flightToggle:false}';

const PATCHES = [
  // ----------------------------------------------------------- new module import
  [
    "import { initPauseMenu } from './ui/pause_menu.js?v=browser-smash-phase3-v45-20261027';",
    "import { initPauseMenu } from './ui/pause_menu.js?v=browser-smash-phase3-v45-20261027';\n"
    + "import { initTrainingPanel } from './ui/training_panel.js?v=browser-smash-phase3-v45-20261027';"
  ],
  // -------------------------------------------------- training state and stats
  [
    "let matchRules={roundsToWin:2,roundSeconds:80};let paused=false;",
    "let matchRules={roundsToWin:2,roundSeconds:80};let paused=false;\n"
    + "// Training mode state, the running training totals, and the per-match statistics the result\n"
    + "// screen reports. Damage is accumulated by sampling the live damage totals (see\n"
    + "// trackMatchSample), so every damage source is counted by one rule instead of per call site.\n"
    + "let training={dummy:'stand',invulnerable:false,dealt:0,hits:0,biggest:0};\n"
    + "let matchStats={time:0,dealt:[0,0],biggest:0,hits:0};let lastCpuPercent=0,lastPlayerPercent=0;"
  ],
  // ----------------------------------------------------------- dummy opponent
  [
    `const ai={getInputs(){if(window.__browserSmashTrainingDummy)return ${NEUTRAL};if(exploration)return ${NEUTRAL};const dx=`,
    "const NEUTRAL_INPUTS=()=>(" + NEUTRAL + ");\n"
    + "// Training dummy: holds still, holds guard or paces instead of fighting back. The\n"
    + "// window.__browserSmashTrainingDummy hook tests already use still forces a passive opponent.\n"
    + "function dummyInputs(){\n"
    + "  const mode=(practice&&training.dummy!=='off')?training.dummy:(window.__browserSmashTrainingDummy?'stand':null);\n"
    + "  if(!mode)return null;\n"
    + "  const inputs=NEUTRAL_INPUTS();\n"
    + "  if(mode==='guard')inputs.shield=true;\n"
    + "  if(mode==='walk'){const right=Math.floor(performance.now()/900)%2===0;inputs.left=!right;inputs.right=right;}\n"
    + "  return inputs;\n"
    + "}\n"
    + "const ai={getInputs(){const dummy=dummyInputs();if(dummy)return dummy;if(exploration)return NEUTRAL_INPUTS();const dx="
  ],
  // ------------------------------------- team-size/config safety: nothing else changes
  // --------------------------------------------------- sample, clock, HUD refresh
  [
    "  if(!practice&&!exploration){\n    matchState.timer=Math.max(0,matchState.timer-dt);\n    remaining=matchState.timer;\n    if(roundPause<=0)resolveRoundEnd();\n  }\n  updateHud();",
    "  trackMatchSample(dt);\n"
    + "  if(!practice&&!exploration){\n    matchState.timer=Math.max(0,matchState.timer-dt);\n    remaining=matchState.timer;\n    if(roundPause<=0)resolveRoundEnd();\n  }\n  updateHud();"
  ],
  // --------------------------------------------------- training panel + controls
  [
    "window.__browserSmashSetCpuSkill=level=>setCpuSkill(level);",
    "window.__browserSmashSetCpuSkill=level=>setCpuSkill(level);\n"
    + "// --------------------------------------------------------------------- training mode\n"
    + "const trainingPanel=initTrainingPanel({\n"
    + "  onDummyChange:mode=>{training.dummy=mode;return training.dummy;},\n"
    + "  onInvulnerableChange:on=>{training.invulnerable=Boolean(on);return training.invulnerable;},\n"
    + "  onResetPositions:()=>resetTrainingPositions(),\n"
    + "  onResetDamage:()=>resetTrainingDamage(),\n"
    + "  onExit:()=>{setPaused(false);finish('');}\n"
    + "});\n"
    + "/**\n"
    + " * The dummy's damage, hits and biggest hit are sampled from the live damage total rather than\n"
    + " * from every place a hit can land, so a melee swing, a projectile, a signature move and an\n"
    + " * ultimate are all counted once each and a future damage source cannot be forgotten here.\n"
    + " */\n"
    + "function trackMatchSample(dt){\n"
    + "  if(!started||exploration)return;\n"
    + "  const cpuGain=Math.max(0,cpu.percent-lastCpuPercent);\n"
    + "  const playerGain=Math.max(0,player.percent-lastPlayerPercent);\n"
    + "  if(cpuGain>0){training.dealt+=cpuGain;training.hits+=1;training.biggest=Math.max(training.biggest,cpuGain);}\n"
    + "  matchStats.dealt[0]+=cpuGain;matchStats.dealt[1]+=playerGain;\n"
    + "  if(cpuGain>0||playerGain>0){matchStats.hits+=cpuGain>0?1:0;matchStats.biggest=Math.max(matchStats.biggest,cpuGain,playerGain);}\n"
    + "  lastCpuPercent=cpu.percent;lastPlayerPercent=player.percent;\n"
    + "  if(!practice&&!exploration)matchStats.time+=dt;\n"
    + "  if(practice&&training.invulnerable)cpu.invulnerable=Math.max(cpu.invulnerable,1/30);\n"
    + "}\n"
    + "function resetTrainingPositions(){\n"
    + "  const {spawns}=applyArenaLayout();\n"
    + "  placeFightersAtSpawns(spawns);\n"
    + "  for(const f of [player,cpu]){\n"
    + "    f.velocity.set(0,0,0);f.hitstun=0;f.attackQueue.length=0;f.hitboxes.length=0;\n"
    + "    f.attackBuffer=0;f.comboStep=0;f.comboWindow=0;f.invulnerable=0;\n"
    + "  }\n"
    + "  while(projectiles.length){const shot=projectiles.pop();scene.remove(shot.group);}\n"
    + "  window.showCombatCallout?.('POSITIONS RESET','#bfe9ff');\n"
    + "}\n"
    + "function resetTrainingDamage(){\n"
    + "  training.dealt=0;training.hits=0;training.biggest=0;\n"
    + "  player.percent=0;cpu.percent=0;lastCpuPercent=0;lastPlayerPercent=0;\n"
    + "  window.showCombatCallout?.('DAMAGE RESET','#bfe9ff');\n"
    + "}\n"
    + "function resetMatchStats(){matchStats={time:0,dealt:[0,0],biggest:0,hits:0};lastCpuPercent=0;lastPlayerPercent=0;}\n"
    + "window.__browserSmashTraining={state:()=>({...training}),setDummy:mode=>{training.dummy=mode;trainingPanel?.setState({dummy:mode});return training.dummy;},setInvulnerable:on=>{training.invulnerable=Boolean(on);trainingPanel?.setState({invulnerable:training.invulnerable});return training.invulnerable;},resetPositions:()=>resetTrainingPositions(),resetDamage:()=>resetTrainingDamage(),panelVisible:()=>Boolean(trainingPanel?.isVisible)};\n"
    + "window.__browserSmashStats=()=>({...matchStats,dealt:[...matchStats.dealt],wins:[...matchState.wins],round:matchState.round,roundsToWin:matchState.rules.roundsToWin});"
  ],
  // ---------------------------------------------------- result screen statistics
  [
    "$('#result').textContent=text;$('#play').textContent='REMATCH';",
    "$('#result').innerHTML=resultMarkup(text);$('#play').textContent='REMATCH';trainingPanel?.setVisible(false);"
  ],
  [
    "let powerHudWarned=false;",
    "/** The result screen: the headline plus the real numbers the match produced. */\n"
    + "function resultMarkup(text){\n"
    + "  const total=Math.max(0,Math.round(matchStats.time));\n"
    + "  const clock=Math.floor(total/60)+':'+String(total%60).padStart(2,'0');\n"
    + "  const cell=(label,value)=>'<span style=\"display:inline-block;margin:3px 14px 3px 0\"><b style=\"color:#eafaff\">'+label+'</b> '+value+'</span>';\n"
    + "  return '<div style=\"font-size:19px;font-weight:950;color:#7af2ff;letter-spacing:.05em\">'+(text||'MATCH ENDED')+'</div>'\n"
    + "    +'<div style=\"margin-top:7px;font:800 11px/1.7 system-ui,sans-serif;letter-spacing:.1em;color:#a8cfe4\">'\n"
    + "    +cell('ROUNDS',matchState.wins[0]+' – '+matchState.wins[1])\n"
    + "    +cell('MATCH TIME',clock)\n"
    + "    +cell('DAMAGE DEALT',Math.round(matchStats.dealt[0])+'%')\n"
    + "    +cell('DAMAGE TAKEN',Math.round(matchStats.dealt[1])+'%')\n"
    + "    +cell('BIGGEST HIT',Math.round(matchStats.biggest)+'%')\n"
    + "    +cell('HITS LANDED',String(matchStats.hits))\n"
    + "    +'</div>';\n"
    + "}\n"
    + "let powerHudWarned=false;"
  ],
  // ---------------------------------------------- leaving a match / entering training
  [
    "started=true;paused=false;pauseMenu?.close();combatAudio.setPaused?.(false);practice=isPractice;",
    "started=true;paused=false;pauseMenu?.close();combatAudio.setPaused?.(false);practice=isPractice;"
    + "training.dealt=0;training.hits=0;training.biggest=0;training.invulnerable=false;resetMatchStats();"
    + "if(!isPractice)training.dummy='stand';"
    + "trainingPanel?.setState({dummy:training.dummy,invulnerable:false});"
    + "trainingPanel?.setVisible(Boolean(isPractice));"
  ],
  [
    "started=false;paused=false;pauseMenu?.close();combatAudio.setPaused?.(false);document.body.classList.add('in-menu');",
    "started=false;paused=false;pauseMenu?.close();combatAudio.setPaused?.(false);trainingPanel?.setVisible(false);document.body.classList.add('in-menu');"
  ],
  [
    " exploration=false;player.roamMode=false;player.bounds=null;cpu.model.visible=true;",
    " exploration=false;player.roamMode=false;player.bounds=null;cpu.model.visible=true;trainingPanel?.setVisible(false);"
  ],
  // ------------------------------------------------- training keys and HUD refresh
  [
    "addEventListener('keydown',e=>{if(e.key==='Escape'){if(exploration){leaveExploration();return;}if(started){e.preventDefault();setPaused(!paused);}return;}if(e.key==='F3')",
    "addEventListener('keydown',e=>{if(e.key==='Escape'){if(exploration){leaveExploration();return;}if(started){e.preventDefault();setPaused(!paused);}return;}if(started&&practice&&!exploration&&(e.key==='r'||e.key==='R')){resetTrainingPositions();return;}if(started&&practice&&!exploration&&(e.key==='t'||e.key==='T')){resetTrainingDamage();return;}if(e.key==='F3')"
  ],
  [
    "else combo.classList.remove('show');}}",
    "else combo.classList.remove('show');}trainingPanel?.refresh({player,cpu,training,practice,started,exploration});}"
  ]
];

const original = readFileSync(TARGET, 'utf8');
let source = original;
const report = [];

for (const [anchor, replacement] of PATCHES) {
  const first = source.indexOf(anchor);
  const last = source.lastIndexOf(anchor);
  if (first < 0) {
    report.push(`MISSING  ${anchor.slice(0, 66).replace(/\n/g, ' | ')}`);
    continue;
  }
  if (first !== last) {
    report.push(`AMBIGUOUS  ${anchor.slice(0, 66).replace(/\n/g, ' | ')}`);
    continue;
  }
  if (source.includes(replacement)) {
    report.push(`ALREADY  ${anchor.slice(0, 66).replace(/\n/g, ' | ')}`);
    continue;
  }
  source = source.replace(anchor, replacement);
  report.push(`ok       ${anchor.slice(0, 66).replace(/\n/g, ' | ')}`);
}

const failed = report.filter(line => /MISSING|AMBIGUOUS/.test(line));
for (const line of report) console.log('  ' + line);

if (failed.length) {
  console.error(`\n${failed.length} anchor(s) did not apply; main.js left untouched.`);
  process.exit(1);
}
if (checkOnly) {
  console.log('\ncheck only: all anchors present, nothing written.');
  process.exit(0);
}
if (source === original) {
  console.log('\nalready fully patched; nothing to write.');
  process.exit(0);
}
writeFileSync(TARGET, source);
console.log(`\nmain.js patched (${source.length - original.length} bytes added).`);
