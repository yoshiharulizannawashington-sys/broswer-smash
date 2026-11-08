#!/usr/bin/env node
// Prove the Sketchfab token path without a live Sketchfab account.
//
// A local HTTP server stands in for api.sketchfab.com. The child process uses the real fetch client
// and the real script; only the base URL is redirected (and only when NODE_ENV=test). This exercises
// the things a live download would: the Token authorization scheme, metadata eligibility, staging,
// hashing, the report, and the failure paths. It cannot prove a real account is authorised.
//
//   node scripts/test-fetch-token.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const script = resolve(root, 'scripts/fetch-character-model.mjs');
const testRoot = resolve(root, 'artifacts/dev/fetch-token-test');
const UID = '0123456789abcdef0123456789abcdef';
const TOKEN = 'tok_test_do_not_echo_7f3a';
const SIGNATURE = 'super-secret-signed-query-value';
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(64, 0)]);

rmSync(testRoot, { recursive: true, force: true });
mkdirSync(testRoot, { recursive: true });

const MODEL = {
  uid: UID,
  name: 'Goku test rig',
  description: 'Original fan-made model by the test author.',
  isDownloadable: true,
  isProtected: false,
  faceCount: 77860,
  vertexCount: 39170,
  animationCount: 0,
  license: { label: 'CC Attribution', url: 'https://creativecommons.org/licenses/by/4.0/' },
  user: {
    displayName: 'Test Creator',
    username: 'test_creator',
    profileUrl: 'https://sketchfab.com/test_creator'
  },
  viewerUrl: `https://sketchfab.com/3d-models/${UID}`
};

let requests = [];
let baseOrigin = '';
const server = createServer((req, res) => {
  const url = new URL(req.url, baseOrigin || 'http://127.0.0.1');
  requests.push({ path: url.pathname, authorization: req.headers.authorization || null });
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };
  if (url.pathname === '/v3/me') {
    if (req.headers.authorization !== `Token ${TOKEN}`) {
      return send(401, JSON.stringify({ detail: 'Invalid token.' }));
    }
    return send(200, JSON.stringify({ displayName: 'Test Account', username: 'tester' }));
  }
  if (url.pathname === `/v3/models/${UID}`) return send(200, JSON.stringify(MODEL));
  if (url.pathname === `/v3/models/${UID}/download`) {
    if (req.headers.authorization !== `Token ${TOKEN}`) {
      return send(401, JSON.stringify({ detail: 'Authentication credentials were not provided.' }));
    }
    return send(200, JSON.stringify({
      gltf: { url: `${baseOrigin}/files/goku.glb?X-Amz-Signature=${SIGNATURE}` }
    }));
  }
  if (url.pathname === '/files/goku.glb') return send(200, GLB, 'model/gltf-binary');
  return send(404, JSON.stringify({ detail: 'not found' }));
});

await new Promise(ok => server.listen(0, '127.0.0.1', ok));
baseOrigin = `http://127.0.0.1:${server.address().port}`;

function run(extraArgs, env = {}) {
  requests = [];
  return new Promise(done => {
    const child = spawn(process.execPath, [script, ...extraArgs], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        SKETCHFAB_API_BASE: `${baseOrigin}/v3`,
        SKETCHFAB_TOKEN: '',
        SKETCHFAB_API_TOKEN: '',
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => done({ status, stdout, stderr, output: stdout + stderr }));
  });
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log('PASS  ' + name);
  } else {
    failed += 1;
    console.error('FAIL  ' + name + (detail ? ' · ' + detail : ''));
  }
}

try {
  // ---------------------------------------------------------------- missing secret
  const noTokenDir = join(testRoot, 'no-token');
  const noToken = await run(['--uid', UID, '--identity', 'Goku', '--dir', noTokenDir]);
  check('missing token exits 2', noToken.status === 2, 'exit=' + noToken.status);
  check('missing token creates no output', !existsSync(join(noTokenDir, UID)));
  check('missing token names the secret', noToken.stderr.includes('SKETCHFAB_TOKEN'));
  check('missing token points at --check-auth', noToken.stderr.includes('--check-auth'));

  const noTokenCheck = await run(['--check-auth']);
  check('missing token auth check exits 2', noTokenCheck.status === 2, 'exit=' + noTokenCheck.status);

  // ---------------------------------------------------------------- auth check
  const auth = await run(['--check-auth'], { SKETCHFAB_TOKEN: TOKEN });
  check('valid token auth check exits 0', auth.status === 0, auth.stderr.slice(-200));
  check('auth check names the account', /Test Account/.test(auth.stdout));
  check('auth check downloads nothing', !requests.some(request => request.path.includes('/download')));
  check('auth check does not echo the token', !auth.output.includes(TOKEN));

  const alias = await run(['--check-auth'], { SKETCHFAB_API_TOKEN: TOKEN });
  check('legacy SKETCHFAB_API_TOKEN alias works',
    alias.status === 0 && alias.stdout.includes('SKETCHFAB_API_TOKEN'), alias.stderr.slice(-200));

  const badAuth = await run(['--check-auth'], { SKETCHFAB_TOKEN: 'tok_incorrect' });
  check('invalid token auth check exits 1',
    badAuth.status === 1 && /HTTP 401/.test(badAuth.output), badAuth.stderr.slice(-200));
  check('invalid auth token is not echoed', !badAuth.output.includes('tok_incorrect'));

  // ---------------------------------------------------------------- valid staging run
  const validDir = join(testRoot, 'valid');
  const valid = await run(['--uid', UID, '--identity', 'Goku', '--stage-only', '--dir', validDir],
    { SKETCHFAB_TOKEN: TOKEN });
  const downloadRequest = requests.find(request => request.path === `/v3/models/${UID}/download`);
  const metadataRequest = requests.find(request => request.path === `/v3/models/${UID}`);
  check('valid token stages the model', valid.status === 0, valid.stderr.slice(-300));
  check('download uses Authorization: Token', downloadRequest?.authorization === `Token ${TOKEN}`,
    String(downloadRequest?.authorization));
  check('metadata request stays unauthenticated', !metadataRequest?.authorization);
  check('direct GLB is saved, not unzipped', existsSync(join(validDir, UID, 'model.glb')));

  const reportPath = join(validDir, UID, 'fetch-report.json');
  check('fetch report is written', existsSync(reportPath));
  const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : {};
  const actualHash = createHash('sha256').update(GLB).digest('hex');
  check('report records uid and licence', report.uid === UID && report.license === 'CC Attribution');
  check('report records the archive hash', report.archiveSha256 === actualHash && report.archiveBytes === GLB.length);
  check('report records only the token source name', report.tokenSource === 'SKETCHFAB_TOKEN');
  check('stage-only does not install', report.install === 'staged-only');
  check('signed query is redacted in output',
    valid.stdout.includes('signed query redacted') && !valid.output.includes(SIGNATURE));
  check('token is absent from stdout/stderr', !valid.output.includes(TOKEN));
  check('token and signed query are absent from the report',
    !JSON.stringify(report).includes(TOKEN) && !JSON.stringify(report).includes(SIGNATURE));

  // ---------------------------------------------------------------- invalid secret
  const invalidDir = join(testRoot, 'invalid');
  const invalid = await run(['--uid', UID, '--identity', 'Goku', '--dir', invalidDir],
    { SKETCHFAB_TOKEN: 'tok_definitely_wrong' });
  check('invalid token exits 1', invalid.status === 1, 'exit=' + invalid.status);
  check('invalid token surfaces HTTP 401', /HTTP 401/.test(invalid.output));
  check('invalid token writes no archive', !existsSync(join(invalidDir, UID)));
  check('invalid token is not echoed', !invalid.output.includes('tok_definitely_wrong'));

  // ---------------------------------------------------------------- path-like uid
  const badUidDir = join(testRoot, 'bad-uid');
  const badUid = await run(['--uid', '../../etc', '--identity', 'Goku', '--dir', badUidDir]);
  check('path-like uid is rejected', badUid.status === 1 && /32-character/.test(badUid.stderr));
  check('path-like uid writes nothing', !existsSync(badUidDir));
} finally {
  await new Promise(ok => server.close(ok));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('FETCH TOKEN TEST FAILED');
  process.exit(1);
}
console.log('FETCH TOKEN TEST PASSED: token handling, redaction and failure paths hold.');
