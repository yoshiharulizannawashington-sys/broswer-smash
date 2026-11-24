#!/usr/bin/env node
// Source-motion audit for imported character models.
//
// A clip can exist, carry tracks and still be hollow: every key identical, every channel
// constant, or all motion on a node that is not a skeleton joint. Channel counts cannot catch
// that. This script reads the source glTF/GLB animation accessors directly and measures the
// values the mixer will sample, before the model is accepted or promoted.
//
// It is intentionally source-only: no browser, no renderer and no mutation of the model.
//
// Usage:
//   node scripts/audit-source-motion.mjs <model.glb|model.gltf|directory> [...]
//   node scripts/audit-source-motion.mjs <model> --json artifacts/source-motion/report.json
//   node scripts/audit-source-motion.mjs <model> --allow-static collection,skill07-03
//
// Exit codes:
//   0  every clip has temporal skeleton motion (or is explicitly waived)
//   1  a hollow/static/invalid clip or unreadable model was found
//   2  usage error
//
// The exported audit functions can be used by the import pipeline without spawning this CLI:
//   import { auditSourceMotionFile, auditSourceMotionPaths } from './audit-source-motion.mjs';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync
} from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL = 'audit-source-motion';
export const VERSION = 1;
export const DEFAULT_THRESHOLDS = Object.freeze({
  // Degrees of rotation, source units of translation, scale delta and morph-weight delta.
  // The defaults match the source forensic audit: small exporter noise must not count as motion.
  rotationDegrees: 0.1,
  translation: 0.0001,
  scale: 0.0001,
  weights: 0.0001
});

const SUPPORTED_EXTENSIONS = new Set(['.glb', '.gltf']);
const COMPONENT = {
  5120: { size: 1, read: 'getInt8', normalized: value => Math.max(value / 127, -1) },
  5121: { size: 1, read: 'getUint8', normalized: value => value / 255 },
  5122: { size: 2, read: 'getInt16', normalized: value => Math.max(value / 32767, -1) },
  5123: { size: 2, read: 'getUint16', normalized: value => value / 65535 },
  5125: { size: 4, read: 'getUint32', normalized: value => value / 4294967295 },
  5126: { size: 4, read: 'getFloat32', normalized: value => value }
};
const TYPE_WIDTH = {
  SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16
};
const PATH_WIDTH = { translation: 3, rotation: 4, scale: 3 };
const PATH_NAMES = new Set(['translation', 'rotation', 'scale', 'weights']);

class SourceMotionError extends Error {
  constructor(message, code = 'SOURCE_MOTION_ERROR') {
    super(message);
    this.name = 'SourceMotionError';
    this.code = code;
  }
}

const finite = value => typeof value === 'number' && Number.isFinite(value);
const round = (value, digits = 6) => Number.isFinite(value) ? +value.toFixed(digits) : null;

function parseGlb(buffer, file = 'model.glb') {
  if (buffer.length < 12) throw new SourceMotionError(`${file}: file is too short to be a GLB`, 'BAD_GLB');
  const magic = buffer.readUInt32LE(0);
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  if (magic !== 0x46546c67) throw new SourceMotionError(`${file}: not a GLB (missing glTF magic)`, 'BAD_GLB');
  if (version !== 2) throw new SourceMotionError(`${file}: GLB version ${version}, expected 2`, 'BAD_GLB');
  if (declaredLength !== buffer.length) {
    throw new SourceMotionError(`${file}: header declares ${declaredLength} bytes but the file is ${buffer.length}`, 'BAD_GLB');
  }
  let json = null;
  let bin = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) throw new SourceMotionError(`${file}: chunk runs past the end of the file`, 'BAD_GLB');
    if (type === 0x4e4f534a && !json) {
      try {
        json = JSON.parse(buffer.subarray(start, end).toString('utf8'));
      } catch (error) {
        throw new SourceMotionError(`${file}: JSON chunk is invalid (${error.message})`, 'BAD_GLB');
      }
    } else if (type === 0x004e4942 && !bin) {
      bin = buffer.subarray(start, end);
    }
    offset = end;
  }
  if (!json) throw new SourceMotionError(`${file}: no JSON chunk`, 'BAD_GLB');
  return { json, bin };
}

function decodeDataUri(uri, file) {
  try {
    const comma = uri.indexOf(',');
    if (comma < 0) throw new Error('missing comma');
    const metadata = uri.slice(5, comma);
    const data = uri.slice(comma + 1);
    return /;base64/i.test(metadata)
      ? Buffer.from(data, 'base64')
      : Buffer.from(decodeURIComponent(data), 'utf8');
  } catch (error) {
    throw new SourceMotionError(`${file}: invalid data URI buffer (${error.message})`, 'BAD_BUFFER');
  }
}

function loadBuffers(document, baseDir, glbBin, file) {
  return (document.buffers || []).map((buffer, index) => {
    if (!buffer || typeof buffer !== 'object') {
      throw new SourceMotionError(`${file}: buffers[${index}] is not an object`, 'BAD_BUFFER');
    }
    let bytes;
    if (typeof buffer.uri === 'string') {
      if (buffer.uri.startsWith('data:')) {
        bytes = decodeDataUri(buffer.uri, file);
      } else {
        const uri = decodeURIComponent(buffer.uri);
        const path = resolve(baseDir, uri);
        if (!existsSync(path)) {
          throw new SourceMotionError(`${file}: buffers[${index}] references missing file ${uri}`, 'MISSING_BUFFER');
        }
        bytes = readFileSync(path);
      }
    } else if (index === 0 && glbBin) {
      bytes = glbBin;
    } else {
      throw new SourceMotionError(`${file}: buffers[${index}] has no URI and no GLB binary chunk`, 'MISSING_BUFFER');
    }
    if (finite(buffer.byteLength) && buffer.byteLength > bytes.length) {
      throw new SourceMotionError(
        `${file}: buffers[${index}] declares ${buffer.byteLength} bytes but only ${bytes.length} are available`,
        'TRUNCATED_BUFFER'
      );
    }
    return bytes;
  });
}

/** Read a source GLB or glTF file (with its external/data buffers) without a renderer. */
export function readSource(file) {
  const path = resolve(file);
  const ext = extname(path).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new SourceMotionError(
      `${file}: ${ext || 'unknown format'} is not inspectable here; convert the source to GLB or glTF first`,
      'UNSUPPORTED_FORMAT'
    );
  }
  const bytes = readFileSync(path);
  let document;
  let glbBin = null;
  if (ext === '.glb') {
    const parsed = parseGlb(bytes, file);
    document = parsed.json;
    glbBin = parsed.bin;
  } else {
    try {
      document = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw new SourceMotionError(`${file}: invalid glTF JSON (${error.message})`, 'BAD_GLTF');
    }
  }
  if (!document || document.asset?.version !== '2.0') {
    throw new SourceMotionError(`${file}: expected a glTF 2.0 asset`, 'BAD_GLTF');
  }
  return {
    file,
    format: ext.slice(1),
    bytes: bytes.length,
    document,
    buffers: loadBuffers(document, dirname(path), glbBin, file)
  };
}

function readAccessor(document, buffers, index, file) {
  const accessor = document.accessors?.[index];
  if (!accessor || typeof accessor !== 'object') {
    throw new SourceMotionError(`${file}: accessor ${index} is missing`, 'BAD_ACCESSOR');
  }
  const component = COMPONENT[accessor.componentType];
  const width = TYPE_WIDTH[accessor.type];
  const count = accessor.count;
  if (!component || !width) {
    throw new SourceMotionError(
      `${file}: accessor ${index} has unsupported type/component ${accessor.componentType}/${accessor.type}`,
      'BAD_ACCESSOR'
    );
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new SourceMotionError(`${file}: accessor ${index} has invalid count ${count}`, 'BAD_ACCESSOR');
  }
  const values = new Array(count * width).fill(0);
  const normalized = Boolean(accessor.normalized);

  const readInto = (view, destination, viewOffset, sparseCount) => {
    if (!view || !Number.isInteger(view.buffer) || !buffers[view.buffer]) {
      throw new SourceMotionError(`${file}: accessor ${index} has an invalid bufferView`, 'BAD_ACCESSOR');
    }
    const binary = buffers[view.buffer];
    if (sparseCount === 0) return;
    const stride = view.byteStride || component.size * width;
    const start = (view.byteOffset || 0) + (viewOffset || 0);
    const required = start + Math.max(0, sparseCount - 1) * stride + component.size * width;
    if (required > binary.length) {
      throw new SourceMotionError(`${file}: accessor ${index} reads past buffer ${view.buffer}`, 'TRUNCATED_BUFFER');
    }
    for (let item = 0; item < sparseCount; item++) {
      const data = new DataView(binary.buffer, binary.byteOffset);
      const itemStart = start + item * stride;
      for (let channel = 0; channel < width; channel++) {
        let value = data[component.read](itemStart + channel * component.size, true);
        if (normalized) value = component.normalized(value);
        destination[item * width + channel] = value;
      }
    }
  };

  if (accessor.bufferView !== undefined) {
    readInto(document.bufferViews?.[accessor.bufferView], values, accessor.byteOffset || 0, count);
  }

  if (accessor.sparse) {
    const sparse = accessor.sparse;
    const sparseCount = sparse.count;
    if (!Number.isInteger(sparseCount) || sparseCount < 0 || sparseCount > count) {
      throw new SourceMotionError(`${file}: accessor ${index} has invalid sparse count`, 'BAD_ACCESSOR');
    }
    const indexView = document.bufferViews?.[sparse.indices?.bufferView];
    const valueView = document.bufferViews?.[sparse.values?.bufferView];
    if (!indexView || !valueView) {
      throw new SourceMotionError(`${file}: accessor ${index} sparse data is incomplete`, 'BAD_ACCESSOR');
    }
    const indexComponent = COMPONENT[sparse.indices.componentType];
    if (!indexComponent || ![5121, 5123, 5125].includes(sparse.indices.componentType)) {
      throw new SourceMotionError(`${file}: accessor ${index} has an invalid sparse index type`, 'BAD_ACCESSOR');
    }
    const indexBinary = buffers[indexView.buffer];
    const indexData = new DataView(indexBinary.buffer, indexBinary.byteOffset);
    const indexStart = (indexView.byteOffset || 0) + (sparse.indices.byteOffset || 0);
    const valueBinary = buffers[valueView.buffer];
    const valueData = new DataView(valueBinary.buffer, valueBinary.byteOffset);
    const valueStart = (valueView.byteOffset || 0) + (sparse.values.byteOffset || 0);
    for (let item = 0; item < sparseCount; item++) {
      const target = indexData[indexComponent.read](indexStart + item * indexComponent.size, true);
      if (target >= count) {
        throw new SourceMotionError(`${file}: accessor ${index} sparse index ${target} is out of range`, 'BAD_ACCESSOR');
      }
      for (let channel = 0; channel < width; channel++) {
        let value = valueData[component.read](valueStart + (item * width + channel) * component.size, true);
        if (normalized) value = component.normalized(value);
        values[target * width + channel] = value;
      }
    }
  }

  if (values.some(value => !finite(value))) {
    throw new SourceMotionError(`${file}: accessor ${index} contains a non-finite value`, 'BAD_ACCESSOR');
  }
  return { values, width, count };
}

function normalizeQuaternion(value) {
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  // Some supplied exports contain zero quaternions on unused joints. They are not valid unit
  // rotations, but treating one as a fatal error would reject an otherwise moving clip. Treat it
  // as identity for motion measurement and report it as a warning for the accepting artist.
  if (!finite(length) || length < 1e-12) return { value: [0, 0, 0, 1], zero: true };
  return { value: value.map(component => component / length), zero: false };
}

function quaternionAngleDegrees(a, b) {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
}

function distance(a, b) {
  let squared = 0;
  for (let index = 0; index < a.length; index++) squared += (a[index] - b[index]) ** 2;
  return Math.sqrt(squared);
}

function maxDeltaFromFirst(vectors) {
  let max = 0;
  for (let index = 1; index < vectors.length; index++) max = Math.max(max, distance(vectors[index], vectors[0]));
  return max;
}

function maxRotationDegrees(vectors) {
  let max = 0;
  for (let index = 1; index < vectors.length; index++) {
    max = Math.max(max, quaternionAngleDegrees(vectors[index], vectors[0]));
  }
  return max;
}

function skeletonJoints(document) {
  const joints = new Set();
  for (const skin of document.skins || []) {
    for (const joint of skin.joints || []) {
      if (Number.isInteger(joint) && joint >= 0 && joint < (document.nodes || []).length) joints.add(joint);
    }
  }
  return joints;
}

function nodeLabel(document, index) {
  return document.nodes?.[index]?.name || `#${index}`;
}

function clipStatus(clip, skeleton) {
  if (clip.errors.length) return 'invalid';
  if (clip.channelCount === 0) return 'empty';
  if (clip.movingChannels === 0) return 'static';
  if (skeleton.size > 0 && clip.movingJointChannels === 0) return 'skeleton-hollow';
  return 'moving';
}

function auditClip(document, buffers, animation, skeleton, thresholds, allowStatic, file) {
  const clip = {
    name: animation.name || '(unnamed)',
    durationSeconds: 0,
    channelCount: (animation.channels || []).length,
    parsedChannels: 0,
    movingChannels: 0,
    movingJointChannels: 0,
    movingNonJointChannels: 0,
    staticChannels: 0,
    oneKeyChannels: 0,
    jointTargets: 0,
    targetCount: 0,
    paths: {},
    maxRotationDegrees: 0,
    maxTranslation: 0,
    maxScaleDelta: 0,
    maxWeightDelta: 0,
    maxRotationChannel: null,
    maxTranslationChannel: null,
    maxScaleChannel: null,
    maxWeightChannel: null,
    errors: [],
    warnings: [],
    status: 'invalid',
    waived: false,
    reasons: []
  };
  const targets = new Set();
  const jointTargets = new Set();
  let maxTime = 0;

  for (let channelIndex = 0; channelIndex < (animation.channels || []).length; channelIndex++) {
    const channel = animation.channels[channelIndex];
    try {
      if (!channel || typeof channel !== 'object') throw new SourceMotionError('channel is not an object');
      const target = channel.target || {};
      const node = target.node;
      if (!Number.isInteger(node) || node < 0 || node >= (document.nodes || []).length) {
        throw new SourceMotionError(`target node ${node} does not exist`);
      }
      const path = target.path;
      if (!PATH_NAMES.has(path)) throw new SourceMotionError(`unsupported target path ${path}`);
      const sampler = animation.samplers?.[channel.sampler];
      if (!sampler || typeof sampler !== 'object') {
        throw new SourceMotionError(`sampler ${channel.sampler} is missing`);
      }
      const timeAccessor = readAccessor(document, buffers, sampler.input, file);
      if (timeAccessor.width !== 1) throw new SourceMotionError('sampler input is not SCALAR');
      const times = timeAccessor.values;
      if (!times.length) throw new SourceMotionError('sampler has no key times');
      if (!times.every(finite)) throw new SourceMotionError('sampler times are not finite');
      for (let index = 1; index < times.length; index++) {
        if (times[index] < times[index - 1]) throw new SourceMotionError('sampler times are not sorted');
      }
      for (const time of times) maxTime = Math.max(maxTime, time);
      const output = readAccessor(document, buffers, sampler.output, file);
      const interpolation = sampler.interpolation || 'LINEAR';
      if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(interpolation)) {
        throw new SourceMotionError(`unsupported interpolation ${interpolation}`);
      }
      const frames = times.length * (interpolation === 'CUBICSPLINE' ? 3 : 1);
      if (output.count !== frames) {
        throw new SourceMotionError(
          `output has ${output.count} items, expected ${frames} for ${times.length} ${interpolation} keys`
        );
      }
      const frameWidth = output.count / frames * output.width;
      const expectedWidth = path === 'weights' ? null : PATH_WIDTH[path];
      if (expectedWidth !== null && frameWidth !== expectedWidth) {
        throw new SourceMotionError(`${path} has ${frameWidth} components per key, expected ${expectedWidth}`);
      }
      if (frameWidth < 1 || !Number.isInteger(frameWidth)) {
        throw new SourceMotionError(`${path} has an invalid component width`);
      }
      const keyValues = [];
      for (let key = 0; key < times.length; key++) {
        const offset = (key * (interpolation === 'CUBICSPLINE' ? 3 : 1) + (interpolation === 'CUBICSPLINE' ? 1 : 0)) * frameWidth;
        keyValues.push(output.values.slice(offset, offset + frameWidth));
      }
      const targetLabel = `${nodeLabel(document, node)}.${path}`;
      let moving = false;
      if (path === 'rotation') {
        const normalized = keyValues.map(normalizeQuaternion);
        const zeroCount = normalized.filter(entry => entry.zero).length;
        if (zeroCount) {
          clip.warnings.push(`${targetLabel}: ${zeroCount} zero-quaternion key(s) treated as identity`);
        }
        const peak = maxRotationDegrees(normalized.map(entry => entry.value));
        if (peak > thresholds.rotationDegrees) {
          moving = true;
          if (peak > clip.maxRotationDegrees) {
            clip.maxRotationDegrees = peak;
            clip.maxRotationChannel = targetLabel;
          }
        }
      } else {
        const peak = maxDeltaFromFirst(keyValues);
        if (path === 'translation') {
          if (peak > clip.maxTranslation) {
            clip.maxTranslation = peak;
            clip.maxTranslationChannel = targetLabel;
          }
          moving = peak > thresholds.translation;
        } else if (path === 'scale') {
          if (peak > clip.maxScaleDelta) {
            clip.maxScaleDelta = peak;
            clip.maxScaleChannel = targetLabel;
          }
          moving = peak > thresholds.scale;
        } else {
          if (peak > clip.maxWeightDelta) {
            clip.maxWeightDelta = peak;
            clip.maxWeightChannel = targetLabel;
          }
          moving = peak > thresholds.weights;
        }
      }
      clip.parsedChannels++;
      clip.paths[path] = (clip.paths[path] || 0) + 1;
      targets.add(node);
      if (skeleton.has(node)) jointTargets.add(node);
      if (times.length < 2) clip.oneKeyChannels++;
      if (moving) {
        clip.movingChannels++;
        if (skeleton.has(node)) clip.movingJointChannels++;
        else clip.movingNonJointChannels++;
      } else {
        clip.staticChannels++;
      }
    } catch (error) {
      clip.errors.push(`channel ${channelIndex}: ${error.message}`);
    }
  }

  clip.durationSeconds = round(maxTime, 3);
  clip.targetCount = targets.size;
  clip.jointTargets = jointTargets.size;
  clip.status = clipStatus(clip, skeleton);
  if (clip.status !== 'invalid' && allowStatic.has(clip.name)) {
    clip.waived = true;
  }
  if (clip.status === 'empty') clip.reasons.push('the animation has no channels');
  if (clip.status === 'static') {
    clip.reasons.push(
      `no channel moves above the thresholds (${clip.parsedChannels} parsed, ` +
      `${clip.oneKeyChannels} with fewer than two keys, max rotation ${round(clip.maxRotationDegrees)}°, ` +
      `translation ${round(clip.maxTranslation)}, scale ${round(clip.maxScaleDelta)}, weights ${round(clip.maxWeightDelta)})`
    );
  }
  if (clip.status === 'skeleton-hollow') {
    clip.reasons.push(
      `motion exists but no skeleton joint moves (${clip.movingChannels} moving channel(s), ` +
      `${clip.movingNonJointChannels} on non-joint nodes)`
    );
  }
  if (clip.status === 'invalid') clip.reasons = clip.errors.slice();
  clip.ok = clip.status === 'moving' || clip.waived;
  return clip;
}

/** Audit an already-parsed glTF document. `buffers` are byte arrays in document order. */
export function auditSourceDocument(document, buffers, metadata = {}, options = {}) {
  const file = metadata.file || '(in-memory source)';
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
  const allowStatic = new Set(
    (Array.isArray(options.allowStatic) ? options.allowStatic : String(options.allowStatic || '').split(','))
      .map(name => String(name).trim()).filter(Boolean)
  );
  const nodes = document.nodes || [];
  const skins = document.skins || [];
  const skeleton = skeletonJoints(document);
  const animations = document.animations || [];
  const clips = animations.map(animation => auditClip(document, buffers, animation, skeleton, thresholds, allowStatic, file));
  const summary = {
    moving: clips.filter(clip => clip.status === 'moving').length,
    static: clips.filter(clip => clip.status === 'static').length,
    empty: clips.filter(clip => clip.status === 'empty').length,
    skeletonHollow: clips.filter(clip => clip.status === 'skeleton-hollow').length,
    invalid: clips.filter(clip => clip.status === 'invalid').length,
    waived: clips.filter(clip => clip.waived).length,
    warnings: clips.reduce((sum, clip) => sum + clip.warnings.length, 0)
  };
  const problems = [];
  if (!animations.length) problems.push('no animation clips');
  for (const clip of clips) {
    if (!clip.ok && !clip.waived) problems.push(`${clip.name}: ${clip.status}`);
  }
  return {
    file,
    format: metadata.format || 'gltf',
    bytes: metadata.bytes ?? null,
    ok: problems.length === 0,
    nodes: nodes.length,
    skins: skins.length,
    skinnedMeshes: nodes.filter(node => node.skin !== undefined).length,
    skeletonJoints: skeleton.size,
    clipCount: clips.length,
    clips,
    summary,
    problems
  };
}

/** Audit one GLB/glTF file; returns a report instead of throwing on load errors. */
export function auditSourceMotionFile(file, options = {}) {
  try {
    const source = readSource(file);
    const report = auditSourceDocument(source.document, source.buffers, source, options);
    return report;
  } catch (error) {
    return {
      file,
      format: extname(String(file)).slice(1) || null,
      bytes: null,
      ok: false,
      error: error instanceof SourceMotionError ? error.message : String(error?.message || error),
      nodes: 0,
      skins: 0,
      skinnedMeshes: 0,
      skeletonJoints: 0,
      clipCount: 0,
      clips: [],
      summary: { moving: 0, static: 0, empty: 0, skeletonHollow: 0, invalid: 0, waived: 0, warnings: 0 },
      problems: [error instanceof SourceMotionError ? error.message : String(error?.message || error)]
    };
  }
}

function discoverInputs(inputs) {
  const files = [];
  const seen = new Set();
  const visit = path => {
    const stat = statSync(path);
    if (stat.isFile()) {
      const ext = extname(path).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        throw new SourceMotionError(`${path}: ${ext || 'unknown format'} is not a GLB or glTF`, 'UNSUPPORTED_FORMAT');
      }
      if (!seen.has(path)) {
        seen.add(path);
        files.push(path);
      }
      return;
    }
    if (!stat.isDirectory()) throw new SourceMotionError(`${path}: not a file or directory`, 'BAD_INPUT');
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) visit(join(path, entry.name));
      else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) visit(join(path, entry.name));
    }
  };
  for (const input of inputs) visit(resolve(input));
  return files;
}

/** Audit a list of files and/or directories. */
export function auditSourceMotionPaths(inputs, options = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new SourceMotionError('provide at least one GLB, glTF or model directory', 'NO_INPUTS');
  }
  const files = discoverInputs(inputs);
  if (!files.length) throw new SourceMotionError('no .glb or .gltf files found in the supplied paths', 'NO_INPUTS');
  const reports = files.map(file => auditSourceMotionFile(file, options));
  const total = key => reports.reduce((sum, report) => sum + (report.summary?.[key] || 0), 0);
  const failures = reports.flatMap(report => (report.clips || [])
    .filter(clip => !clip.ok)
    .map(clip => ({ file: report.file, clip: clip.name, status: clip.status, reasons: clip.reasons })));
  if (reports.some(report => report.error)) {
    for (const report of reports) {
      if (report.error) failures.push({ file: report.file, clip: '(file)', status: 'error', reasons: [report.error] });
    }
  }
  return {
    tool: TOOL,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    thresholds: { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) },
    allowStatic: [...new Set(
      (Array.isArray(options.allowStatic) ? options.allowStatic : String(options.allowStatic || '').split(','))
        .map(name => String(name).trim()).filter(Boolean)
    )],
    files: reports,
    totals: {
      files: reports.length,
      clips: reports.reduce((sum, report) => sum + report.clipCount, 0),
      moving: total('moving'),
      static: total('static'),
      empty: total('empty'),
      skeletonHollow: total('skeletonHollow'),
      invalid: total('invalid'),
      waived: total('waived'),
      warnings: total('warnings')
    },
    failures,
    ok: reports.every(report => report.ok)
  };
}

function usage() {
  console.log(`Source motion audit

Usage:
  node scripts/audit-source-motion.mjs <model.glb|model.gltf|directory> [...]
  node scripts/audit-source-motion.mjs <model> --json artifacts/source-motion/report.json
  node scripts/audit-source-motion.mjs <model> --allow-static collection,skill07-03

Options:
  --json <path>                 write the full machine-readable report
  --allow-static <names>        explicit comma-separated waiver for documented static poses
  --rotation-tolerance <deg>    rotation motion floor (default ${DEFAULT_THRESHOLDS.rotationDegrees})
  --translation-tolerance <n>   translation motion floor in source units (default ${DEFAULT_THRESHOLDS.translation})
  --scale-tolerance <n>         scale motion floor (default ${DEFAULT_THRESHOLDS.scale})
  --weight-tolerance <n>        morph-weight motion floor (default ${DEFAULT_THRESHOLDS.weights})
  --report-only                 write/print the audit but exit 0 even when it fails
  --help                        show this help

Detection:
  empty             a named animation with no channels
  static            one-key, constant or sub-threshold tracks (no temporal motion)
  skeleton-hollow   channels move, but no channel targets a skeleton joint
  invalid           malformed/missing target, sampler, accessor or interpolation

Exit: 0 all clips move (or are explicitly waived); 1 findings; 2 usage error.`);
}

function parseArgs(argv) {
  const inputs = [];
  const options = { thresholds: {}, allowStatic: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--report-only') { options.reportOnly = true; continue; }
    if (arg === '--json') {
      const next = argv[index + 1];
      if (!next || next.startsWith('-')) throw new SourceMotionError('--json needs a path', 'USAGE');
      options.json = next;
      index++;
      continue;
    }
    if (arg === '--allow-static') {
      const next = argv[index + 1];
      if (!next || next.startsWith('-')) throw new SourceMotionError('--allow-static needs clip name(s)', 'USAGE');
      options.allowStatic.push(...next.split(','));
      index++;
      continue;
    }
    const threshold = {
      '--rotation-tolerance': 'rotationDegrees',
      '--translation-tolerance': 'translation',
      '--scale-tolerance': 'scale',
      '--weight-tolerance': 'weights'
    }[arg];
    if (threshold) {
      const next = argv[index + 1];
      const value = Number(next);
      if (!next || !Number.isFinite(value) || value < 0) {
        throw new SourceMotionError(`${arg} needs a non-negative number`, 'USAGE');
      }
      options.thresholds[threshold] = value;
      index++;
      continue;
    }
    if (arg.startsWith('-')) throw new SourceMotionError(`unknown option ${arg}`, 'USAGE');
    inputs.push(arg);
  }
  if (!inputs.length) throw new SourceMotionError('provide at least one GLB, glTF or model directory', 'USAGE');
  return { inputs, options };
}

function printReport(report) {
  console.log('Source motion audit');
  for (const file of report.files) {
    if (file.error) {
      console.log(`  ERROR ${file.file} — ${file.error}`);
      continue;
    }
    const label = file.ok ? 'ok  ' : 'FAIL';
    console.log(
      `  ${label} ${file.file} — ${file.clipCount} clip(s): ` +
      `${file.summary.moving} moving, ${file.summary.static} static, ` +
      `${file.summary.empty} empty, ${file.summary.skeletonHollow} skeleton-hollow, ` +
      `${file.summary.invalid} invalid${file.summary.waived ? `, ${file.summary.waived} waived` : ''}` +
      `${file.summary.warnings ? `, ${file.summary.warnings} warning(s)` : ''}`
    );
    for (const problem of file.problems || []) {
      if (!file.clips.some(clip => !clip.ok && (`${clip.name}: ${clip.status}` === problem || problem.startsWith(`${clip.name}:`)))) {
        console.log(`      ${problem}`);
      }
    }
    for (const clip of file.clips.filter(clip => !clip.ok)) {
      const waived = clip.waived ? ' (waived)' : '';
      console.log(`      ${clip.name}: ${clip.status}${waived} — ${clip.reasons.join('; ')}`);
    }
  }
  const { totals } = report;
  console.log(
    `\n${totals.files} file(s), ${totals.clips} clip(s): ${totals.moving} moving, ` +
    `${totals.static} static, ${totals.empty} empty, ${totals.skeletonHollow} skeleton-hollow, ` +
    `${totals.invalid} invalid${totals.waived ? `, ${totals.waived} waived` : ''}` +
    `${totals.warnings ? `, ${totals.warnings} warning(s)` : ''}`
  );
  if (report.ok) {
    console.log('PASS — every clip carries temporal motion or is explicitly waived.');
  } else {
    console.log('FAIL — hollow, static or invalid clips must be fixed or explicitly waived before acceptance.');
  }
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    usage();
    return 2;
  }
  if (parsed.help) {
    usage();
    return 0;
  }
  let report;
  try {
    report = auditSourceMotionPaths(parsed.inputs, parsed.options);
  } catch (error) {
    console.error(`SOURCE MOTION AUDIT: ${error.message}`);
    return 2;
  }
  printReport(report);
  if (parsed.options.json) {
    const target = resolve(parsed.options.json);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
    console.log(`\nWROTE ${parsed.options.json}`);
  }
  if (!report.ok && !parsed.options.reportOnly) return 1;
  return 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(`SOURCE MOTION AUDIT: ${error?.stack || error}`);
    process.exitCode = 1;
  });
}
