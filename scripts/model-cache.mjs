// Asset cache for retrieved models.
//
// Retrieval is expensive and providers rate-limit, so a previewed or imported asset is stored once
// under a content key and reused by later previews and imports. Temporary retrieval lives here and
// is clearly separate from approved game assets under public/models/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
export const CACHE_ROOT = join(root, 'artifacts/dev/model-cache');
export const IMPORT_ROOT = join(root, 'artifacts/dev/imports');

export const cacheKey = (...parts) => createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 16);

export const assetDir = key => join(CACHE_ROOT, key);

export function cachedEntry(key) {
  const file = join(assetDir(key), 'cache.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeCacheEntry(key, entry) {
  mkdirSync(assetDir(key), { recursive: true });
  writeFileSync(join(assetDir(key), 'cache.json'), JSON.stringify(entry, null, 2) + '\n');
  return entry;
}

/** Resolve a file inside the cache without allowing traversal out of it. */
export function cacheFile(key, name) {
  const dir = assetDir(key);
  const target = resolve(dir, name);
  if (!target.startsWith(dir + '/')) return null;
  return existsSync(target) && statSync(target).isFile() ? target : null;
}

export function cacheSize() {
  if (!existsSync(CACHE_ROOT)) return { assets: 0, bytes: 0 };
  let assets = 0; let bytes = 0;
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else { assets++; bytes += statSync(full).size; }
    }
  };
  walk(CACHE_ROOT);
  return { assets, bytes };
}

/** A stable, readable folder name for a staged import. */
export const jobDir = jobId => join(IMPORT_ROOT, jobId);

export function stageJob(jobId, request) {
  const dir = jobDir(jobId);
  mkdirSync(join(dir, 'asset'), { recursive: true });
  writeFileSync(join(dir, 'request.json'), JSON.stringify(request, null, 2) + '\n');
  return dir;
}

export function writeJobReport(jobId, report) {
  const dir = jobDir(jobId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}

export const slugOf = value => String(value || '')
  .normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'imported';
