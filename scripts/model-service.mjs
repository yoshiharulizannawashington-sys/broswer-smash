// Cloud-side model service for the in-game online browser.
//
// The browser only talks to its own origin; searching, retrieval, extraction, inspection,
// preparation and reporting happen on the machine serving the game. Nothing here registers a
// character: preparation always ends at "ready for approval", and a separate, explicit commit
// chooses replace / variant / new.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { capabilities, getProvider, SOURCES } from './model-providers/index.mjs';
import { classify, matchesFilters } from './model-providers/classify.mjs';
import { inspectModel } from './model-inspect.mjs';
import {
  CACHE_ROOT, IMPORT_ROOT, assetDir, cacheFile, cacheKey, cacheSize, cachedEntry, jobDir,
  slugOf, stageJob, writeCacheEntry, writeJobReport
} from './model-cache.mjs';

const root = resolve(import.meta.dirname, '..');
const jobs = new Map();
let counter = 0;

const MODEL_EXT = ['.glb', '.gltf', '.fbx', '.obj', '.vrm', '.blend'];
const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

const readBody = req => new Promise((done, fail) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; if (raw.length > 2e6) fail(new Error('request body too large')); });
  req.on('end', () => { try { done(raw ? JSON.parse(raw) : {}); } catch (error) { fail(error); } });
  req.on('error', fail);
});

const contentTypes = {
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ktx2': 'image/ktx2', '.json': 'application/json'
};

const STAGES = [
  ['retrieve', 'Retrieving model file'],
  ['extract', 'Extracting archive'],
  ['validate', 'Validating format'],
  ['classify', 'Classifying asset'],
  ['prepare', 'Preparing model and rig'],
  ['validate-output', 'Validating prepared output'],
  ['ready', 'Ready for approval']
];
const stageList = () => STAGES.map(([id, label]) => ({ id, label, state: 'pending', detail: null }));
const setStage = (job, id, state, detail) => {
  const stage = job.stages.find(item => item.id === id);
  if (!stage) return;
  stage.state = state;
  if (detail) stage.detail = String(detail).slice(0, 400);
  job.stage = id;
  if (state === 'failed') job.state = 'failed';
};
const log = (job, line) => {
  job.log.push(String(line).slice(0, 500));
  if (job.log.length > 120) job.log.splice(0, job.log.length - 120);
};

const need = (condition, message) => { if (!condition) { const error = new Error(message); error.code = 'BAD_REQUEST'; throw error; } };

/** Write whatever the provider returned into the job's asset folder and return the main file. */
async function materialise(resolved, dir) {
  const written = [];
  // Relative paths are preserved (a glTF may reference "textures/x.jpg"), but nothing may escape
  // the import folder.
  const write = (name, buffer) => {
    const relative = String(name).replace(/\\/g, '/').split('/')
      .filter(segment => segment && segment !== '.' && segment !== '..').join('/');
    const safe = relative.replace(/[^\w./\- ]+/g, '_');
    const target = resolve(dir, safe);
    if (!target.startsWith(resolve(dir) + '/')) throw new Error(`refusing to write outside the import folder: ${name}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buffer);
    written.push(safe);
    return target;
  };
  if (resolved.localPath) {
    const copy = readFileSync(resolved.localPath);
    return { main: write(basename(resolved.localPath), copy), written, format: resolved.format };
  }
  if (resolved.files?.length) {
    for (const file of resolved.files) write(file.name, file.buffer);
    return { main: join(dir, basename(resolved.main || written[0])), written, format: resolved.format || extname(resolved.main || '') };
  }
  const name = resolved.filename || `${slugOf(basename(String(resolved.url || 'model'))) }${resolved.format || '.glb'}`;
  const target = write(name, resolved.buffer);
  return { main: target, written, format: resolved.format || extname(name) };
}

/** Unzip an archive in place and pick the model inside. */
function extract(mainFile, dir, job) {
  if (extname(mainFile).toLowerCase() !== '.zip') return mainFile;
  const zip = join(dir, 'archive.zip');
  if (mainFile !== zip) writeFileSync(zip, readFileSync(mainFile));
  const out = join(dir, 'extracted');
  mkdirSync(out, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zip, '-d', out], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  const found = [];
  const walk = folder => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (MODEL_EXT.includes(extname(entry.name).toLowerCase())) found.push(full);
    }
  };
  walk(out);
  if (!found.length) throw new Error('the archive contains no .glb/.gltf/.fbx/.obj/.vrm/.blend file');
  const rank = file => (extname(file) === '.glb' ? 0 : extname(file) === '.gltf' ? 1 : 2);
  found.sort((a, b) => rank(a) - rank(b) || statSync(b).size - statSync(a).size);
  log(job, `extracted ${found.length} candidate model(s); using ${basename(found[0])}`);
  return found[0];
}

const stageDir = (job, name) => {
  const dir = join(job.dir, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * Normalise anything that is not a single-file GLB into one before inspection or preparation.
 * External-buffer glTF (what Poly Haven ships) and FBX/OBJ/BLEND all take this route, so the
 * inspector and the rigging pipeline always see the same container the game will load.
 */
function ensureGlb(file, dir, job) {
  const ext = extname(file).toLowerCase();
  if (ext === '.glb' || ext === '.vrm') return file;
  if (ext !== '.gltf' && !MODEL_EXT.includes(ext)) return file;
  const out = join(dir, `${slugOf(basename(file, ext))}-converted.glb`);
  let stdout = '';
  try {
    stdout = execFileSync('bash', ['scripts/blender.sh', '-b', '--python', 'scripts/blender_tools.py', '--', 'convert', file, out],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
  } catch (error) {
    stdout = String(error.stdout || '');
    if (!stdout) throw new Error(`Blender could not run a conversion: ${String(error.stderr || error.message).slice(0, 200)}`);
  }
  // Blender logs its own failures as a RESULT line and still exits 0, so the result has to be
  // read rather than inferred from the exit code.
  const resultLine = stdout.split('\n').filter(line => line.startsWith('RESULT:')).pop();
  const result = resultLine ? JSON.parse(resultLine.slice(7)) : null;
  if (result && result.ok === false) throw new Error(`Blender could not convert ${ext} to GLB: ${String(result.error).slice(0, 240)}`);
  if (!existsSync(out)) throw new Error(`Blender wrote no GLB for ${ext}${result ? ` (reported ${JSON.stringify(result).slice(0, 200)})` : ''}`);
  log(job, `converted ${ext} → ${basename(out)} before inspection`);
  return out;
}

const classificationOf = (row, inspection) => {
  const rig = inspection?.inspected ? inspection.rig : row.rig;
  const animations = inspection?.inspected ? inspection.clips.length : row.animations;
  return classify({
    name: row.name, tags: row.tags || [], categories: row.categories || [],
    rig, animations: animations ?? null, triangles: inspection?.triangles ?? row.triangles
  });
};

/* ------------------------------------------------------------------ staged import ---------- */
async function runImport(job, request) {
  const row = request.row || {};
  const name = String(request.name || row.name || 'Imported asset').slice(0, 60);
  job.name = name;
  job.state = 'running';
  try {
    const provider = getProvider(request.source || row.source);

    setStage(job, 'retrieve', 'running');
    const resolved = await provider.resolve({ ...row, url: request.url || row.url, localPath: request.localPath || row.localPath });
    const assetFolder = stageDir(job, 'asset');
    const { main, format } = await materialise(resolved, assetFolder);
    job.licence = resolved.licence || row.licence || null;
    job.creator = resolved.creator || row.author || null;
    job.page = resolved.page || row.pageUrl || null;
    setStage(job, 'retrieve', 'done', `${basename(main)} (${format || 'file'})`);

    setStage(job, 'extract', 'running');
    const extracted = extract(main, assetFolder, job);
    const modelFile = ensureGlb(extracted, assetFolder, job);
    setStage(job, 'extract', 'done', `${basename(main)}${modelFile !== extracted ? ` → ${basename(modelFile)}` : ''}`);

    setStage(job, 'validate', 'running');
    const inspection = await inspectModel(modelFile);
    if (inspection.inspected && inspection.meshes === 0) throw new Error('the file contains no meshes');
    if (!inspection.inspected) log(job, `note: ${inspection.reason}`);
    setStage(job, 'validate', 'done', inspection.inspected
      ? `${inspection.triangles.toLocaleString()} triangles, ${inspection.meshes} mesh(es), rig ${inspection.rig}`
      : inspection.reason);

    setStage(job, 'classify', 'running');
    const classification = classificationOf({ ...row, name }, inspection);
    const requested = request.intent === 'character' || request.intent === 'prop' ? request.intent : 'auto';
    const isCharacter = requested === 'character' ? true
      : requested === 'prop' ? false
      : classification.playable && classification.kind === 'character';
    job.classification = { ...classification, requested, path: isCharacter ? 'character' : 'prop' };
    setStage(job, 'classify', 'done', `${classification.kind} (${classification.confidence} confidence) → ${isCharacter ? 'character preparation' : 'prop / attachment preparation'}`);
    if (requested === 'character' && !classification.playable) {
      log(job, `warning: this asset classified as "${classification.kind}", not a playable humanoid. Preparation continues because a character import was explicitly requested.`);
    }

    setStage(job, 'prepare', 'running');
    let preparedRel = null;
    let prepareReport = null;
    if (isCharacter) {
      const reportPath = join(job.dir, 'prepare.json');
      const args = ['scripts/prepare-character.mjs', '--file', modelFile, '--name', name, '--archetype', request.archetype || 'warrior',
        '--report', reportPath];
      if (request.targetHeight) args.push('--height', String(request.targetHeight));
      if (request.retarget) args.push('--retarget');
      const child = spawn(process.execPath, args, { cwd: root });
      await new Promise((done, fail) => {
        child.stdout.on('data', chunk => String(chunk).split('\n').filter(Boolean).forEach(line => log(job, line)));
        child.stderr.on('data', chunk => String(chunk).split('\n').filter(Boolean).forEach(line => log(job, line)));
        child.on('error', fail);
        child.on('close', code => (code === 0 ? done() : fail(new Error(`preparation failed (exit ${code}); see the log for the failing stage`))));
      });
      if (!existsSync(reportPath)) throw new Error('preparation finished without writing a report');
      prepareReport = JSON.parse(readFileSync(reportPath, 'utf8'));
      preparedRel = prepareReport.prepared;
      setStage(job, 'prepare', 'done', `${prepareReport.rigState} rig, ${prepareReport.skeleton?.bonesMapped ?? 0} bones mapped, `
        + `${Object.keys(prepareReport.animation?.states || {}).length}/7 states, ${prepareReport.animation?.substitutions?.length ?? 0} substitute clip(s)`);
    } else {
      const propDir = stageDir(job, 'prop');
      const propFile = join(propDir, `${slugOf(name)}${extname(modelFile)}`);
      writeFileSync(propFile, readFileSync(modelFile));
      preparedRel = propFile.replace(root + '/', '');
      setStage(job, 'prepare', 'done', 'kept as a prop/attachment: no rig, roster or moveset work performed');
    }

    setStage(job, 'validate-output', 'running');
    let gate = { ok: false, output: '' };
    if (isCharacter) {
      try {
        gate = { ok: true, output: execFileSync(process.execPath, ['scripts/inspect-character-glb.mjs', preparedRel], { cwd: root, encoding: 'utf8' }) };
      } catch (error) {
        gate = { ok: false, output: String(error.stdout || '') + String(error.stderr || '') };
      }
    } else {
      gate = { ok: true, output: 'prop path: no character gate applies' };
    }
    // A failing gate is a property of the source model (open hems, degenerate faces), not a
    // pipeline crash: the import stays available for approval and the report says exactly why.
    const gateDetail = gate.ok ? 'technical inspection passed' : gate.output.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300);
    setStage(job, 'validate-output', 'done', `gate ${gate.ok ? 'PASSED' : 'FAILED'} — ${gateDetail}`);
    job.gate = { ok: gate.ok, detail: gateDetail };

    const report = {
      name, slug: slugOf(name), source: request.source || row.source || 'direct', uid: row.uid || null,
      path: isCharacter ? 'character' : 'prop',
      classification: job.classification,
      origin: { page: job.page, creator: job.creator, licence: job.licence },
      inspection,
      prepared: preparedRel,
      character: prepareReport ? {
        rigState: prepareReport.rigState, bones: prepareReport.skeleton?.bonesMapped, joints: prepareReport.skeleton?.joints,
        states: prepareReport.animation?.states, substitutions: prepareReport.animation?.substitutions,
        clips: prepareReport.animation?.clips, retargeted: prepareReport.retargeted,
        geometryGate: prepareReport.geometryGate, registered: prepareReport.registered, steps: prepareReport.steps
      } : null,
      gate: gate.ok ? 'pass' : 'fail', gateDetail,
      stageLog: job.log.slice(-40),
      approvalRequired: true,
      rosterUntouched: true
    };
    writeJobReport(job.id, report);
    job.report = report;
    setStage(job, 'ready', 'done', 'review mode: nothing was added to the roster');
    job.state = 'ready';
    job.finished = Date.now();
  } catch (error) {
    job.state = 'failed';
    job.error = String(error?.message || error);
    job.needs = error?.code === 'NEEDS_TOKEN' ? 'TOKEN' : null;
    const current = job.stages.find(stage => stage.state === 'running');
    if (current) { current.state = 'failed'; current.detail = job.error.slice(0, 400); }
    log(job, `FAILED: ${job.error}`);
    writeJobReport(job.id, {
      name, failed: true, error: job.error, needs: job.needs,
      source: request.source || row.source || 'direct', uid: row.uid || null,
      stageLog: job.log.slice(-40), stages: job.stages, approvalRequired: true, rosterUntouched: true
    });
    job.finished = Date.now();
  }
}

/* ------------------------------------------------------------------ roster snapshot -------- */
function rosterSnapshot() {
  const main = readFileSync(join(root, 'public/js/main.js'), 'utf8');
  const parse = name => {
    const match = main.match(new RegExp(`const ${name}=\\[([\\s\\S]*?)\\];`));
    if (!match) return [];
    try { return JSON.parse(`[${match[1]}]`); } catch { return []; }
  };
  const manifest = JSON.parse(readFileSync(join(root, 'public/models/characters/manifest.json'), 'utf8'));
  const characters = manifest.characters || {};
  return {
    launch: parse('roster').map(([name, archetype]) => ({ name, archetype })),
    all: parse('allRoster').map(([name, archetype]) => ({ name, archetype })),
    manifestKeys: Object.keys(characters),
    activeModels: Object.fromEntries(Object.entries(characters).map(([key, entry]) => [key, {
      url: entry?.url || null,
      restorableVersions: Array.isArray(entry?.versions) ? Math.max(0, entry.versions.length - 0) : 0
    }]))
  };
}

export function modelService() {
  return {
    name: 'browser-smash-model-service',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith('/api/models/')) return next();
        try {
          /* ---------------------------------------------------------------- sources */
          if (url.pathname === '/api/models/sources') {
            return json(res, 200, { ...capabilities(), cache: cacheSize(), roster: rosterSnapshot() });
          }

          /* ---------------------------------------------------------------- search */
          if (url.pathname === '/api/models/search') {
            const query = (url.searchParams.get('q') || '').trim();
            const sourceId = url.searchParams.get('source') || 'sketchfab';
            const provider = getProvider(sourceId);
            if (provider.capabilities.search === 'none') return json(res, 400, { error: `${provider.label} has no search; use Direct URL`, needs: 'NO_SEARCH' });
            if (!query) return json(res, 400, { error: 'type something to search for' });
            const limit = Math.min(48, Math.max(1, Number(url.searchParams.get('limit')) || 24));
            const raw = await provider.search(query, { limit, downloadableOnly: url.searchParams.get('downloadable') === 'yes' });
            const filters = {
              kind: url.searchParams.get('kind') || undefined,
              rigged: url.searchParams.get('rigged') || undefined,
              animated: url.searchParams.get('animated') || undefined,
              maxTriangles: Number(url.searchParams.get('maxTriangles')) || undefined,
              downloadable: url.searchParams.get('downloadable') || undefined
            };
            const results = raw.map(row => {
              const classification = classify({
                name: row.name, tags: row.tags || [], categories: row.categories || [],
                rig: row.rig, animations: row.animations, triangles: row.triangles
              });
              return { ...row, classification };
            }).filter(row => matchesFilters(row, filters));
            return json(res, 200, {
              source: sourceId, query, total: results.length, filters,
              downloadableNow: provider.capabilities.download === 'direct' || provider.capabilities.download === 'public',
              results
            });
          }

          /* ---------------------------------------------------------------- preview */
          if (url.pathname === '/api/models/preview' && req.method === 'POST') {
            const body = await readBody(req);
            const row = body.row || {};
            const provider = getProvider(body.source || row.source);
            const key = cacheKey(provider.id, row.uid || row.url || row.localPath);
            let entry = cachedEntry(key);
            if (!entry) {
              const resolved = await provider.resolve({ ...row, url: row.url, localPath: row.localPath });
              const dir = assetDir(key);
              mkdirSync(dir, { recursive: true });
              const { main } = await materialise(resolved, dir);
              const stubJob = { log: [] };
              const extracted = extract(main, dir, stubJob) || main;
              // The in-page viewer needs one self-contained file, so external-buffer glTF is
              // converted here exactly as the import pipeline converts it.
              const modelFile = ensureGlb(extracted, dir, stubJob);
              const inspection = await inspectModel(modelFile);
              entry = writeCacheEntry(key, {
                key, source: provider.id, uid: row.uid || null, name: row.name || inspection.file,
                main: basename(modelFile), inspection, licence: resolved.licence || row.licence || null,
                creator: resolved.creator || row.author || null, page: resolved.page || row.pageUrl || null,
                retrievedAt: new Date().toISOString()
              });
            }
            const embed = provider.embed ? await provider.embed(row) : null;
            return json(res, 200, {
              key,
              cached: Boolean(cachedEntry(key)),
              inspection: entry.inspection,
              licence: entry.licence, creator: entry.creator, page: entry.page,
              classification: classificationOf({ ...row, name: row.name || entry.name }, entry.inspection),
              modelUrl: entry.main ? `/api/models/cache/${key}/${encodeURIComponent(entry.main)}` : null,
              format: extname(entry.main || '').toLowerCase() || null,
              embedUrl: embed,
              thumbnail: body.row?.thumbnail || null
            });
          }

          /* ---------------------------------------------------------------- cache files */
          if (url.pathname.startsWith('/api/models/cache/')) {
            const [, , , , key, ...rest] = url.pathname.split('/');
            const file = cacheFile(key, decodeURIComponent(rest.join('/')));
            if (!file) return json(res, 404, { error: 'not cached' });
            res.statusCode = 200;
            res.setHeader('Content-Type', contentTypes[extname(file).toLowerCase()] || 'application/octet-stream');
            res.setHeader('Cache-Control', 'public, max-age=300');
            return res.end(readFileSync(file));
          }

          /* ---------------------------------------------------------------- import */
          if (url.pathname === '/api/models/import' && req.method === 'POST') {
            const body = await readBody(req);
            need(body.source || body.row?.source || body.localPath || body.url, 'an import needs a source');
            const id = `imp${Date.now().toString(36)}${(++counter).toString(36)}`;
            const job = {
              id, state: 'queued', stage: 'retrieve', stages: stageList(), log: [],
              createdAt: Date.now(), name: body.name || body.row?.name || 'Imported asset', request: body
            };
            job.dir = stageJob(id, body);
            jobs.set(id, job);
            runImport(job, body).catch(error => {
              job.state = 'failed';
              job.error = String(error?.message || error);
            });
            return json(res, 202, { job: { id, state: job.state, stages: job.stages } });
          }

          /* ---------------------------------------------------------------- jobs */
          if (url.pathname.startsWith('/api/models/jobs/')) {
            const id = url.pathname.split('/').pop();
            const job = jobs.get(id);
            if (!job) {
              const reportPath = join(jobDir(id), 'report.json');
              if (existsSync(reportPath)) {
                const report = JSON.parse(readFileSync(reportPath, 'utf8'));
                return json(res, 200, { id, state: report.failed ? 'failed' : 'ready', report, stages: report.stages || [], log: report.stageLog || [] });
              }
              return json(res, 404, { error: 'unknown job' });
            }
            return json(res, 200, {
              id: job.id, name: job.name, state: job.state, stage: job.stage, error: job.error || null,
              needs: job.needs || null, stages: job.stages, log: job.log.slice(-8),
              elapsed: Math.round(((job.finished || Date.now()) - job.createdAt) / 100) / 10,
              classification: job.classification || null,
              report: job.report || null, commit: job.commit || null, verification: job.verification || null
            });
          }

          /* ---------------------------------------------------------------- approval / commit */
          if (url.pathname === '/api/models/commit' && req.method === 'POST') {
            const body = await readBody(req);
            need(body.approved === true, 'committing a model needs explicit approval');
            need(['replace', 'variant', 'new', 'prop'].includes(body.mode), 'mode must be replace, variant, new or prop');
            const job = jobs.get(body.jobId);
            need(job, 'unknown or expired job; re-run the import');
            need(job.state === 'ready', `job is ${job.state}, not ready for approval`);
            if (body.mode === 'replace') need(body.target, 'replacing a model needs the existing character to replace');
            const before = rosterSnapshot();
            const args = ['scripts/model-commit.mjs', '--job', job.dir, '--mode', body.mode, '--approved',
              '--name', body.name || job.name];
            if (body.target) args.push('--target', body.target);
            if (body.archetype) args.push('--archetype', body.archetype);
            let output;
            try {
              output = execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
            } catch (error) {
              const detail = `${error.stdout || ''}${error.stderr || ''}`.split('\n').filter(Boolean).slice(-4).join(' ');
              return json(res, 400, { error: `commit failed: ${detail || error.message}` });
            }
            const result = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
            const after = rosterSnapshot();
            job.state = 'integrated';
            job.commit = {
              ...result, mode: body.mode,
              roster: {
                ...(result.roster || {}),
                launchAdded: after.launch.filter(entry => !before.launch.some(old => old.name === entry.name)).map(entry => entry.name),
                manifestAdded: after.manifestKeys.filter(key => !before.manifestKeys.includes(key))
              }
            };
            return json(res, 200, { job: { id: job.id, state: job.state }, commit: job.commit });
          }

          /* ---------------------------------------------------------------- rollback */
          if (url.pathname === '/api/models/rollback' && req.method === 'POST') {
            const body = await readBody(req);
            need(body.approved === true, 'restoring a previous model needs explicit approval');
            need(body.target, 'rollback needs the character to restore');
            const target = join(root, 'public/models/characters/manifest.json');
            need(existsSync(target), 'character manifest is missing');
            let output;
            try {
              output = execFileSync(process.execPath, ['scripts/model-commit.mjs', '--mode', 'rollback', '--target', body.target, '--approved',
                '--job', body.jobId && jobs.has(body.jobId) ? jobs.get(body.jobId).dir : 'artifacts/dev/imports'],
                { cwd: root, encoding: 'utf8' });
            } catch (error) {
              const detail = `${error.stdout || ''}${error.stderr || ''}`.split('\n').filter(Boolean).slice(-3).join(' ');
              return json(res, 400, { error: `rollback failed: ${detail || error.message}` });
            }
            const result = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
            return json(res, 200, { rollback: result, roster: rosterSnapshot() });
          }

          /* ---------------------------------------------------------------- runtime verification */
          if (url.pathname === '/api/models/verify' && req.method === 'POST') {
            const body = await readBody(req);
            const job = jobs.get(body.jobId);
            need(job, 'unknown or expired job');
            need(job.commit?.url, 'commit the model before verifying it in the runtime');
            const target = join(root, 'public', job.commit.url.replace(/^\//, ''));
            need(existsSync(target), `committed file is missing: ${job.commit.url}`);
            let output;
            try {
              output = execFileSync('bash', ['scripts/run-browser-test.sh', 'scripts/verify-model-runtime.mjs', job.commit.url],
                { cwd: root, encoding: 'utf8', timeout: 180_000 });
            } catch (error) {
              const detail = `${error.stdout || ''}${error.stderr || ''}`.split('\n').filter(Boolean).slice(-5).join(' ');
              job.verification = { ok: false, detail };
              return json(res, 200, { ok: false, detail });
            }
            const result = JSON.parse(output.slice(output.lastIndexOf('VERIFY:') + 7).trim());
            job.verification = result;
            if (result.ok) job.state = 'verified';
            return json(res, 200, result);
          }

          /* ---------------------------------------------------------------- library */
          if (url.pathname === '/api/models/library') {
            const entries = [];
            if (existsSync(IMPORT_ROOT)) {
              for (const id of readdirSync(IMPORT_ROOT)) {
                const reportPath = join(IMPORT_ROOT, id, 'report.json');
                const requestPath = join(IMPORT_ROOT, id, 'request.json');
                if (!existsSync(reportPath)) continue;
                const report = JSON.parse(readFileSync(reportPath, 'utf8'));
                const request = existsSync(requestPath) ? JSON.parse(readFileSync(requestPath, 'utf8')) : {};
                entries.push({
                  id, name: report.name, state: report.failed ? 'failed' : 'ready',
                  error: report.error || null, path: report.path || 'character',
                  prepared: report.prepared || null, source: report.source || request.source || null,
                  kind: report.classification?.kind || null, gate: report.gate || null,
                  integrated: Boolean(jobs.get(id)?.commit)
                });
              }
            }
            return json(res, 200, { entries: entries.reverse(), cache: cacheSize(), sources: Object.keys(SOURCES) });
          }

          return json(res, 404, { error: 'unknown endpoint' });
        } catch (error) {
          const status = error?.code === 'BAD_REQUEST' ? 400
            : error?.code === 'NEEDS_TOKEN' ? 402
            : error?.code === 'UNKNOWN_SOURCE' ? 404 : 500;
          return json(res, status, { error: String(error?.message || error), needs: error?.code || null });
        }
      });
    }
  };
}
