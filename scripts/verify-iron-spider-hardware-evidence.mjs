#!/usr/bin/env node
// Independent post-run evidence gate for the Iron Spider hardware workflow.
//
// The acceptance runner already gates on scripts/probe-hardware-gpu.mjs. This script re-checks the
// written evidence so a missing, stale, software-rendered or mismatched report cannot be uploaded as
// a hardware pass.
//
//   node scripts/verify-iron-spider-hardware-evidence.mjs
//   node scripts/verify-iron-spider-hardware-evidence.mjs --expected-headless true
//
// Options are intentionally small so the workflow and a local audit can use the same gate:
//   --evidence-root <dir>      Root containing the artifacts/ tree (default: cwd)
//   --expected-headless <bool> Expected preflight launch mode (default: EXPECTED_HEADLESS or false)
//   --started-at <ISO time>    Reject evidence older than this run start (default: RUN_STARTED_AT)
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isSoftwareRenderer } from './lib/hardware-gpu.mjs';

const options = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (!argument.startsWith('--')) continue;
  const key = argument.slice(2);
  const value = process.argv[index + 1];
  if (value && !value.startsWith('--')) {
    options[key] = value;
    index += 1;
  } else {
    options[key] = 'true';
  }
}

const evidenceRoot = resolve(process.cwd(), options['evidence-root'] || '.');
const expectedHeadless = String(
  options['expected-headless'] ?? process.env.EXPECTED_HEADLESS ?? 'false'
).toLowerCase();
const startedAt = options['started-at'] ?? process.env.RUN_STARTED_AT ?? '';
const startedMs = startedAt ? Date.parse(startedAt) : null;

const failures = [];
const checked = [];

function check(name, condition, detail = '') {
  if (condition) {
    checked.push(name);
    console.log('PASS ' + name);
    return;
  }
  const message = detail ? `${name}: ${detail}` : name;
  failures.push(message);
  console.error('FAIL ' + message);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function readJson(relativePath, label) {
  const file = resolve(evidenceRoot, relativePath);
  try {
    const body = await readFile(file, 'utf8');
    return { file, value: JSON.parse(body) };
  } catch (error) {
    failures.push(`${label} (${file}): ${error.code === 'ENOENT' ? 'missing' : error.message}`);
    console.error(`FAIL ${label} (${file}): ${error.code === 'ENOENT' ? 'missing' : error.message}`);
    return null;
  }
}

function checkFreshness(label, record) {
  if (!startedMs) return;
  const generated = Date.parse(record?.generatedAt);
  check(
    `${label} was generated during this run`,
    Number.isFinite(generated) && generated >= startedMs - 60_000,
    `generatedAt=${record?.generatedAt || 'missing'}, runStartedAt=${startedAt}`
  );
}

function pngInfo(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

async function checkScreenshot(relativePath, width, height) {
  const file = resolve(evidenceRoot, relativePath);
  try {
    const info = await stat(file);
    check(`${relativePath} exists`, info.size > 1024, `${info.size} bytes`);
    if (startedMs) {
      check(
        `${relativePath} was written during this run`,
        info.mtimeMs >= startedMs - 60_000,
        `mtime=${new Date(info.mtimeMs).toISOString()}, runStartedAt=${startedAt}`
      );
    }
    const buffer = await readFile(file);
    const png = pngInfo(buffer);
    check(`${relativePath} is a PNG`, Boolean(png));
    if (png) {
      check(
        `${relativePath} viewport is ${width}x${height}`,
        png.width === width && png.height === height,
        `${png.width}x${png.height}`
      );
    }
  } catch (error) {
    failures.push(`${relativePath}: ${error.code === 'ENOENT' ? 'missing' : error.message}`);
    console.error(`FAIL ${relativePath}: ${error.code === 'ENOENT' ? 'missing' : error.message}`);
  }
}

check(
  'expected headless mode is valid',
  expectedHeadless === 'true' || expectedHeadless === 'false',
  expectedHeadless
);
check(
  'run start timestamp is valid',
  !startedAt || Number.isFinite(startedMs),
  startedAt
);

const preflightResult = await readJson('artifacts/hardware-gpu/preflight.json', 'preflight');
const reportResult = await readJson('artifacts/iron-spider/hardware-run.json', 'Iron Spider hardware report');
const preflight = preflightResult?.value || null;
const report = reportResult?.value || null;

if (preflight) {
  const gpu = preflight.gpu || {};
  check('preflight.hardwareMode is true', preflight.hardwareMode === true);
  check('preflight.hardwareGpu is true', preflight.hardwareGpu === true);
  check('preflight.softwareRenderer is false', preflight.softwareRenderer === false);
  check('preflight.pass is true', preflight.pass === true);
  check(
    'preflight launch mode matches the dispatch input',
    preflight.launch?.headless === (expectedHeadless === 'true'),
    `launch.headless=${preflight.launch?.headless}, expected=${expectedHeadless}`
  );
  check('preflight gpu.available is true', gpu.available === true);
  check('preflight gpu.webgl2 is true', gpu.webgl2 === true);
  check('preflight gpu.debugRendererInfo is true', gpu.debugRendererInfo === true);
  check('preflight renderer is non-empty', nonEmptyString(gpu.renderer), String(gpu.renderer || ''));
  check('preflight vendor is non-empty', nonEmptyString(gpu.vendor), String(gpu.vendor || ''));
  check(
    'preflight unmasked renderer is non-empty',
    nonEmptyString(gpu.unmaskedRenderer),
    String(gpu.unmaskedRenderer || '')
  );
  check(
    'preflight is not a software renderer',
    gpu.available === true && !isSoftwareRenderer(gpu) && nonEmptyString(gpu.renderer),
    String(gpu.renderer || 'missing')
  );
  check(
    'preflight errors are empty',
    Array.isArray(preflight.errors) && preflight.errors.length === 0,
    JSON.stringify(preflight.errors || [])
  );
  for (const key of ['webglContext', 'webgl2', 'debugRendererInfo', 'hardwareVendor', 'noPageErrors']) {
    check(`preflight checks.${key} is true`, preflight.checks?.[key] === true);
  }
  checkFreshness('preflight', preflight);
}

if (report) {
  const gpu = report.gpu || {};
  const preflightGpu = preflight?.gpu || {};
  check('report.hardwareMode is true', report.hardwareMode === true);
  check('report.hardwareVerified is true', report.hardwareVerified === true);
  check('report.softwareRenderer is false', report.softwareRenderer === false);
  check(
    'report evidenceClass is hardware',
    /hardware/i.test(String(report.evidenceClass || ''))
      && !/software/i.test(String(report.evidenceClass || ''))
  );
  check('report.passed is 58', report.passed === 58, String(report.passed));
  check(
    'report.checks contains 58 entries',
    Array.isArray(report.checks) && report.checks.length === 58,
    String(Array.isArray(report.checks) ? report.checks.length : 'not an array')
  );
  check('report gpu.available is true', gpu.available === true);
  check('report gpu.webgl2 is true', gpu.webgl2 === true);
  check('report gpu.debugRendererInfo is true', gpu.debugRendererInfo === true);
  check('report renderer is non-empty', nonEmptyString(gpu.renderer), String(gpu.renderer || ''));
  check(
    'report is not a software renderer',
    gpu.available === true && !isSoftwareRenderer(gpu) && nonEmptyString(gpu.renderer),
    String(gpu.renderer || 'missing')
  );
  check(
    'report renderer matches preflight renderer',
    nonEmptyString(gpu.renderer) && gpu.renderer === preflightGpu.renderer,
    `report=${gpu.renderer || 'missing'}, preflight=${preflightGpu.renderer || 'missing'}`
  );
  check(
    'report unmasked renderer matches preflight',
    nonEmptyString(gpu.unmaskedRenderer) && gpu.unmaskedRenderer === preflightGpu.unmaskedRenderer,
    `report=${gpu.unmaskedRenderer || 'missing'}, preflight=${preflightGpu.unmaskedRenderer || 'missing'}`
  );
  for (const key of ['errors', 'consoleErrors', 'missingRequests']) {
    check(
      `report.${key} is empty`,
      Array.isArray(report[key]) && report[key].length === 0,
      JSON.stringify(report[key] || [])
    );
  }
  checkFreshness('Iron Spider hardware report', report);
}

await checkScreenshot('artifacts/hardware-gpu/preflight.png', 1366, 768);
await checkScreenshot('artifacts/iron-spider-defeat.png', 1280, 800);
await checkScreenshot('artifacts/iron-spider-rematch-after-victory.png', 1280, 800);
await checkScreenshot('artifacts/iron-spider-rematch-after-defeat.png', 1280, 800);

const renderer = report?.gpu?.renderer || preflight?.gpu?.renderer || 'unavailable';
if (failures.length) {
  console.error('\nHARDWARE EVIDENCE GATE FAIL');
  console.error(`Renderer: ${renderer}`);
  console.error(`Failures: ${failures.length}`);
  process.exitCode = 1;
} else {
  console.log('\nHARDWARE EVIDENCE GATE PASS');
  console.log(`Renderer: ${renderer}`);
  console.log(`Checks validated: ${checked.length}`);
}
