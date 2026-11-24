// Poly Haven adapter.
//
// Poly Haven publishes CC0 models through a documented public API, so retrieval really is
// direct: no account, no token. Its catalogue is props, furniture and environments rather than
// characters, which is exactly why the classifier and the import-intent choice exist.
//
// The `files/<id>` response nests the actual glTF under a resolution key and lists every
// companion file in an `include` map keyed by the relative path the glTF references
// ("antique_estoc.bin", "textures/antique_estoc_diff_1k.jpg"). Those keys are what has to be
// written to disk, not the CDN basenames, or the model cannot be opened.
import { clean, getBuffer, getJson } from './http.mjs';

const RESOLUTIONS = ['1k', '2k', '4k', '8k'];
let indexPromise = null;

const index = () => {
  indexPromise ||= getJson('https://api.polyhaven.com/assets?t=models').catch(error => {
    indexPromise = null;
    throw error;
  });
  return indexPromise;
};

const terms = query => String(query).toLowerCase().split(/\s+/).filter(Boolean);
const urlOf = entry => (typeof entry === 'string' ? entry : entry?.url || null);
const nameOf = url => decodeURIComponent(String(url).split('/').pop());

export default {
  id: 'polyhaven',
  label: 'Poly Haven',
  homepage: 'https://polyhaven.com/models',
  capabilities: { search: 'public', download: 'direct', preview: 'image' },
  requires: 'Public CC0 API. Search and downloads need no account; the catalogue is props and environments, not characters.',
  needsToken: () => false,

  async search(query, { limit = 24 } = {}) {
    const assets = await index();
    const wanted = terms(query);
    const scored = [];
    for (const [id, asset] of Object.entries(assets)) {
      const haystack = [id, asset.name, ...(asset.tags || []), ...(asset.categories || [])].join(' ').toLowerCase();
      const hits = wanted.filter(term => haystack.includes(term)).length;
      if (!hits) continue;
      scored.push({ id, asset, hits });
    }
    scored.sort((a, b) => b.hits - a.hits || String(a.asset.name).localeCompare(String(b.asset.name)));
    return scored.slice(0, limit).map(({ id, asset }) => ({
      source: 'polyhaven',
      uid: id,
      name: clean(asset.name) || id,
      author: Object.keys(asset.authors || {}).join(', ') || 'Poly Haven',
      thumbnail: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=320&height=220`,
      triangles: null,
      animations: 0,
      // Poly Haven's "rigged" category means mechanical/prop rigs, not a humanoid skeleton.
      rig: 'no',
      downloadable: true,
      downloadableNow: true,
      licence: 'CC0',
      pageUrl: `https://polyhaven.com/a/${id}`,
      formats: ['gltf'],
      tags: (asset.tags || []).slice(0, 12),
      categories: (asset.categories || []).map(category => category.replace(/^collection:\s*/, 'collection ')).slice(0, 6)
    }));
  },

  async preview(row) {
    return { kind: 'image', url: `https://cdn.polyhaven.com/asset_img/thumbs/${row.uid}.png?width=1024` };
  },

  async resolve(row) {
    const files = await getJson(`https://api.polyhaven.com/files/${row.uid}`);
    const gltf = files.gltf;
    if (!gltf) throw new Error(`${row.uid} has no glTF export on Poly Haven`);
    const resolution = RESOLUTIONS.find(key => gltf[key]) || Object.keys(gltf)[0];
    const branch = gltf[resolution];
    const mainNode = branch.gltf && branch.gltf.url ? branch.gltf : branch;
    if (!mainNode?.url) throw new Error(`${row.uid} has no glTF file URL at ${resolution}`);

    const downloads = [];
    const add = (name, url) => {
      if (!url || !name) return;
      if (!downloads.some(entry => entry.name === name)) downloads.push({ name, url });
    };
    const mainName = nameOf(mainNode.url);
    add(mainName, mainNode.url);

    // Include keys are the exact relative paths the glTF references, subfolders included.
    for (const [relative, entry] of Object.entries(mainNode.include || branch.include || {})) {
      add(relative, urlOf(entry));
    }
    // Fallback for a response shape without `include`: collect every nested url by basename.
    if (downloads.length === 1) {
      const walk = node => {
        if (!node || typeof node !== 'object') return;
        if (typeof node.url === 'string') add(nameOf(node.url), node.url);
        else for (const value of Object.values(node)) walk(value);
      };
      walk(branch);
    }

    const written = [];
    for (const entry of downloads) {
      try {
        const { buffer } = await getBuffer(entry.url);
        written.push({ name: entry.name, buffer });
      } catch (error) {
        // Optional extras (extra texture resolutions) must not fail the whole retrieval.
        if (entry.name === mainName) throw error;
      }
    }
    return {
      files: written,
      main: mainName,
      format: '.gltf',
      licence: 'CC0',
      creator: row.author,
      page: row.pageUrl
    };
  }
};
