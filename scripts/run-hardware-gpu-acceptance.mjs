// Hardware-GPU acceptance orchestrator for Goku, Spider-Man, Iron Spider, Naruto, Vegeta, T-800,
// Hulk, Aquaman and The Flash.
//
// It runs a renderer preflight first, then the existing live suites with HARDWARE_GPU=1. The
// preflight is the gate: if Chromium is on SwiftShader, llvmpipe or another software renderer,
// no fighter suite is allowed to produce hardware evidence.
//
//   npm run accept:hardware-gpu
//   HARDWARE_GPU_ONLY=iron-spider npm run accept:hardware-gpu
//
// On a real display the helper launches headed. If the host has a verified headless GPU path, set
// HARDWARE_GPU_HEADLESS=1 explicitly. A targeted run writes summary-<id>.json so it cannot replace
// the six-fighter hardware summary.
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const out = resolve(root, 'artifacts/hardware-gpu');
await mkdir(resolve(out, 'logs'), { recursive: true });
const env = { ...process.env, HARDWARE_GPU: '1' };

const suites = [
  {
    id: 'goku',
    script: 'scripts/verify-goku-hd-match.mjs',
    expected: 9,
    report: 'artifacts/goku-hd/report.json',
    screenshot: 'artifacts/goku-hd/16-ko.png'
  },
  {
    id: 'spider-man-gameplay',
    script: 'scripts/verify-spider-man-gameplay.mjs',
    expected: 40,
    report: 'artifacts/spider-man-gameplay/report.json',
    screenshot: 'artifacts/spider-man-gameplay/25-after-ultimate.png'
  },
  {
    id: 'spider-man-import',
    script: 'scripts/verify-spider-man-import.mjs',
    expected: 21,
    report: 'artifacts/spider-man-import/report.json',
    screenshot: 'artifacts/spider-man-import/12-bo3-result-spider-man.png'
  },
  {
    id: 'iron-spider',
    script: 'scripts/test-iron-spider.mjs',
    expected: 58,
    report: 'artifacts/iron-spider/hardware-run.json',
    screenshot: 'artifacts/iron-spider-rematch-after-defeat.png'
  },
  {
    id: 'naruto-a1',
    script: 'scripts/verify-naruto-a1.mjs',
    expected: 7,
    report: 'artifacts/a1-naruto/live-a1-probe.json',
    screenshot: 'artifacts/a1-naruto/live-ultimate.png'
  },
  {
    id: 'naruto-transformed-ko',
    script: 'scripts/verify-naruto-transformed-ko.mjs',
    expected: 2,
    report: 'artifacts/a1-naruto/transformed-ko.json',
    screenshot: 'artifacts/a1-naruto/transformed-ko-result.png'
  },
  {
    id: 'vegeta',
    script: 'scripts/verify-imported-migrations.mjs',
    extraEnv: { MIGRATION_ONLY: 'vegeta' },
    expected: 13,
    report: 'artifacts/imported-migrations/report-vegeta.json',
    screenshot: 'artifacts/imported-migrations/vegeta/05-signature.png'
  },
  {
    id: 't800',
    script: 'scripts/verify-imported-migrations.mjs',
    extraEnv: { MIGRATION_ONLY: 't800' },
    expected: 13,
    report: 'artifacts/imported-migrations/report-t800.json',
    screenshot: 'artifacts/imported-migrations/t800/05-signature.png'
  },
  {
    id: 'hulk-a1',
    script: 'scripts/verify-a1-combat-matrix.mjs',
    args: ['Hulk (Bruce Banner)'],
    expected: 42,
    report: 'artifacts/a1-combat/hulk/report.json',
    screenshot: 'artifacts/a1-combat/hulk/11-victory-ko-during-form.png'
  },
  {
    id: 'aquaman-a1',
    script: 'scripts/verify-a1-combat-matrix.mjs',
    args: ['Aquaman'],
    expected: 42,
    report: 'artifacts/a1-combat/aquaman/report.json',
    screenshot: 'artifacts/a1-combat/aquaman/11-victory-ko-during-form.png'
  },
  {
    id: 'the-flash-a1',
    script: 'scripts/verify-a1-combat-matrix.mjs',
    args: ['The Flash (Barry Allen)'],
    expected: 42,
    report: 'artifacts/a1-combat/the-flash/report.json',
    screenshot: 'artifacts/a1-combat/the-flash/11-victory-ko-during-form.png'
  }
];

const ONLY = (process.env.HARDWARE_GPU_ONLY || process.env.HARDWARE_GPU_SUITE || '')
  .split(',').map(part => part.trim()).filter(Boolean);
const selectedSuites = ONLY.length
  ? suites.filter(suite => ONLY.includes(suite.id) || ONLY.includes(suite.script))
  : suites;
if (!selectedSuites.length) {
  throw new Error('HARDWARE_GPU_ONLY selected no suites: ' + ONLY.join(','));
}
const targeted = ONLY.length > 0;
const summaryPath = resolve(out, targeted
  ? 'summary-' + selectedSuites.map(suite => suite.id).join('-') + '.json'
  : 'summary.json');

function runSuite({ id, script, extraEnv, args = [] }) {
  return new Promise(resolveRun => {
    const logFile = resolve(out, 'logs', id + '.log');
    const child = spawn('bash', ['scripts/run-browser-test.sh', script, ...args], {
      cwd: root,
      env: { ...env, ...(extraEnv || {}) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const capture = chunk => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', error => {
      output += '\nSPAWN ERROR ' + String(error?.stack || error) + '\n';
    });
    child.on('close', async code => {
      await writeFile(logFile, output);
      let report = null;
      const definition = suites.find(s => s.id === id);
      try {
        report = JSON.parse(await readFile(resolve(root, definition?.report || ''), 'utf8'));
      } catch {}
      let screenshotBytes = 0;
      try { screenshotBytes = (await stat(resolve(root, definition?.screenshot || ''))).size; } catch {}
      const actual = Number.isFinite(report?.passed)
        ? report.passed
        : report?.checks?.filter(check => check.ok).length ?? null;
      // The imported/migration suites write `gpu`; the A1 matrix writes the same renderer
      // object at `renderer` (with `observations.gpu` retained for review). Accept both shapes
      // without weakening the hardware requirement.
      const rendererInfo = report?.gpu || report?.renderer || null;
      const renderer = rendererInfo?.renderer || null;
      const hardwareReport = report?.hardwareMode === true && rendererInfo?.available === true
        && rendererInfo?.webgl2 === true;
      const rendererMatches = Boolean(renderer) && renderer === preflightReport?.gpu?.renderer;
      const passed = code === 0
        && actual === definition?.expected
        && hardwareReport
        && rendererMatches
        && screenshotBytes > 1024
        && !/swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i.test(String(renderer || ''));
      resolveRun({
        id, script, expected: definition?.expected,
        exitCode: code ?? null, actual, renderer, rendererMatches,
        report: definition?.report || null, screenshot: definition?.screenshot || null,
        screenshotBytes, log: logFile, passed
      });
    });
  });
}

const results = [];
let preflight = null;
let preflightReport = null;
let preflightExit = null;

// The preflight is a hard gate. It is run through the same browser wrapper as the suites, so it
// uses the same Chromium and the same system libraries.
const preflightRun = await new Promise(resolveRun => {
  const logFile = resolve(out, 'logs', 'preflight.log');
  const child = spawn('bash', ['scripts/run-browser-test.sh', 'scripts/probe-hardware-gpu.mjs'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  const capture = chunk => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(text);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', error => {
    output += '\nSPAWN ERROR ' + String(error?.stack || error) + '\n';
  });
  child.on('close', async code => {
    await writeFile(logFile, output);
    preflightExit = code;
    try { preflightReport = JSON.parse(await readFile(resolve(out, 'preflight.json'), 'utf8')); } catch {}
    resolveRun({ log: logFile, exitCode: code ?? null });
  });
});
preflight = preflightRun;

let preflightScreenshotBytes = 0;
try { preflightScreenshotBytes = (await stat(resolve(out, 'preflight.png'))).size; } catch {}
let pass = preflightExit === 0 && preflightReport?.pass === true
  && preflightReport?.hardwareGpu === true && preflightScreenshotBytes > 1024;
if (pass) {
  for (const suite of selectedSuites) results.push(await runSuite(suite));
  pass = results.every(result => result.passed);
}

const summary = {
  generatedAt: new Date().toISOString(),
  target: targeted
    ? selectedSuites.map(suite => suite.id).join(' + ')
    : 'Goku + Spider-Man + Iron Spider + Naruto + Vegeta + T-800 + Hulk + Aquaman + The Flash',
  hardwareMode: true,
  headed: preflightReport?.launch?.headless === false,
  preflight: {
    exitCode: preflightExit,
    report: resolve(out, 'preflight.json'),
    log: preflight.log,
    hardwareGpu: preflightReport?.hardwareGpu === true,
    renderer: preflightReport?.gpu?.renderer || null,
    vendor: preflightReport?.gpu?.vendor || null,
    screenshot: resolve(out, 'preflight.png'),
    screenshotBytes: preflightScreenshotBytes,
    pass: preflightExit === 0 && preflightReport?.pass === true && preflightScreenshotBytes > 1024
  },
  suites: results,
  pass
};
await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n');
console.log('\nSUMMARY ' + JSON.stringify(summary, null, 2));
console.log('SUMMARY_FILE ' + summaryPath);
console.log('HARDWARE ACCEPTANCE ' + (pass ? 'PASS' : 'FAIL'));
process.exitCode = pass ? 0 : 1;
