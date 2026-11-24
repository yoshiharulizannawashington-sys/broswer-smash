// Direct URL and user-supplied file adapter.
//
// This is the honest fallback for every source without an authorised API: if the user can obtain
// a file, this retrieves it. Local paths are restricted to the repository so the service cannot
// be used to read arbitrary files from the machine.
import { existsSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { getBuffer } from './http.mjs';

const FORMATS = ['.glb', '.gltf', '.fbx', '.obj', '.vrm', '.blend', '.zip'];
const repoRoot = process.cwd();

const insideRepo = path => {
  const resolved = resolve(repoRoot, path);
  return resolved === repoRoot || resolved.startsWith(repoRoot + '/') ? resolved : null;
};

export default {
  id: 'direct',
  label: 'Direct URL / file',
  homepage: null,
  capabilities: { search: 'none', download: 'direct', preview: 'none' },
  requires: 'Paste a direct http(s) link to a .glb/.gltf/.fbx/.obj/.vrm/.blend/.zip, or give a path inside this project for a file you already have.',
  needsToken: () => false,

  async search() { return []; },

  async resolve(row) {
    if (row.localPath) {
      const path = insideRepo(row.localPath);
      if (!path) throw new Error('a local file must live inside this project folder');
      if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`no file at ${row.localPath}`);
      const format = extname(path).toLowerCase();
      if (!FORMATS.includes(format)) throw new Error(`unsupported file type ${format}; expected ${FORMATS.join(', ')}`);
      return { localPath: path, format, licence: null, creator: null, page: null };
    }
    const url = String(row.url || '');
    if (!/^https?:\/\//i.test(url)) throw new Error('a direct URL must start with http:// or https://');
    const { buffer, contentType } = await getBuffer(url);
    const fromPath = extname(decodeURIComponent(new URL(url).pathname)).toLowerCase();
    const format = FORMATS.includes(fromPath) ? fromPath
      : /gltf-binary|octet-stream/.test(contentType) ? '.glb'
      : '.bin';
    if (!FORMATS.includes(format)) {
      throw new Error(`the link is not a model file (content-type ${contentType || 'unknown'}). `
        + `Supported: ${FORMATS.join(', ')}. Download pages behind a login cannot be fetched by this service.`);
    }
    return { buffer, filename: basename(new URL(url).pathname) || `download${format}`, format, licence: null, creator: null, page: url };
  }
};
