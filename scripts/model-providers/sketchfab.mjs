// Sketchfab adapter.
//
// Search, metadata and embed previews are public. Downloading is a separate, authorised
// operation: the official download endpoint needs an account token with the download permission.
// That distinction is carried through the whole UI instead of being papered over with an import
// button that cannot work.
import { clean, getJson } from './http.mjs';

const token = () => process.env.SKETCHFAB_TOKEN || process.env.SKETCHFAB_API_TOKEN || '';

export default {
  id: 'sketchfab',
  label: 'Sketchfab',
  homepage: 'https://sketchfab.com/',
  capabilities: { search: 'public', download: 'token', preview: 'embed' },
  requires: 'Search, metadata and 3D embeds are public. Downloading a model needs an account API token with the download permission in SKETCHFAB_TOKEN.',
  needsToken: () => !token(),
  tokenVariable: 'SKETCHFAB_TOKEN',

  async search(query, { limit = 24, downloadableOnly = false } = {}) {
    const params = new URLSearchParams({ type: 'models', q: query, count: String(Math.min(48, Math.max(1, limit))) });
    if (downloadableOnly) params.set('downloadable', 'true');
    const body = await getJson(`https://api.sketchfab.com/v3/search?${params}`);
    return (body.results || []).map(model => ({
      source: 'sketchfab',
      uid: model.uid,
      name: clean(model.name) || model.uid,
      author: clean(model.user?.displayName || model.user?.username || '') || null,
      thumbnail: model.thumbnails?.images?.slice(-1)[0]?.url || model.thumbnails?.images?.[0]?.url || null,
      triangles: model.faceCount ?? null,
      vertices: model.vertexCount ?? null,
      animations: model.animationCount ?? null,
      rig: model.isRigged === true ? 'yes' : model.isRigged === false ? 'no' : 'unknown',
      downloadable: Boolean(model.isDownloadable),
      downloadableNow: Boolean(model.isDownloadable) && Boolean(token()),
      licence: model.license?.label || model.license?.slug || null,
      pageUrl: model.viewerUrl || `https://sketchfab.com/3d-models/${model.uid}`,
      formats: Object.values(model.archives || {}).map(archive => archive?.format).filter(Boolean),
      tags: (model.tags || []).map(tag => clean(tag.name || tag)).filter(Boolean).slice(0, 12),
      categories: (model.categories || []).map(category => clean(category.name || category)).filter(Boolean)
    }));
  },

  /** Public embed used by the preview pane before (or instead of) a download. */
  async embed(row) {
    return `https://sketchfab.com/models/${row.uid}/embed?autospin=0.2&preload=1&ui_theme=dark`;
  },

  async resolve(row) {
    if (!token()) {
      const error = new Error('Sketchfab downloads need SKETCHFAB_TOKEN (Account → Settings → Password & API → API token with download access). '
        + 'Search, previews and inspection of public metadata work without it.');
      error.code = 'NEEDS_TOKEN';
      throw error;
    }
    const body = await getJson(`https://api.sketchfab.com/v3/models/${row.uid}/download`, { Authorization: `Token ${token()}` });
    const archive = body.glb || body.gltf || body.usdz;
    if (!archive?.url) throw new Error('this model has no glTF/GLB archive available to this account');
    return {
      url: archive.url,
      format: body.glb ? '.glb' : '.gltf',
      licence: row.licence,
      creator: row.author,
      page: row.pageUrl
    };
  }
};
