// BlenderKit adapter: public search, token-gated download.
import { clean, getJson } from './http.mjs';

const token = () => process.env.BLENDERKIT_API_KEY || '';
const licenceUrl = asset => {
  const value = asset.license;
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.name || value.id || value.slug || null;
};

export default {
  id: 'blenderkit',
  label: 'BlenderKit',
  homepage: 'https://www.blenderkit.com/',
  capabilities: { search: 'public', download: 'token', preview: 'image' },
  requires: 'Search is public. Downloading an asset needs a BlenderKit API key in BLENDERKIT_API_KEY.',
  needsToken: () => !token(),
  tokenVariable: 'BLENDERKIT_API_KEY',

  async search(query, { limit = 24 } = {}) {
    const params = new URLSearchParams({ query, asset_type: 'model', page_size: String(Math.min(48, Math.max(1, limit))) });
    const body = await getJson(`https://www.blenderkit.com/api/v1/search/?${params}`);
    return (body.results || []).map(asset => ({
      source: 'blenderkit',
      uid: String(asset.id),
      name: clean(asset.name || asset.displayName) || String(asset.id),
      author: clean(asset.author?.name || '') || null,
      thumbnail: asset.thumbnailLargeUrl || asset.thumbnailUrl || asset.thumbnailMiddleUrl || null,
      triangles: asset.tri_count ?? null,
      animations: null,
      rig: asset.isRigged === true ? 'yes' : asset.isRigged === false ? 'no' : 'unknown',
      downloadable: Boolean(token()),
      downloadableNow: Boolean(token()),
      licence: licenceUrl(asset),
      pageUrl: asset.assetBaseId ? `https://www.blenderkit.com/asset-gallery-detail/${asset.assetBaseId}/` : null,
      formats: ['blend'],
      tags: (asset.tags || []).map(tag => clean(tag.name || tag)).filter(Boolean).slice(0, 12),
      categories: (asset.categories || []).map(category => clean(category.name || category)).filter(Boolean)
    }));
  },

  async preview(row) {
    return { kind: 'image', url: row.thumbnail };
  },

  async resolve() {
    const error = new Error('BlenderKit downloads need a BlenderKit API key (account → API key) in BLENDERKIT_API_KEY. '
      + 'BlenderKit assets are also .blend files, which this pipeline converts through Blender.');
    error.code = 'NEEDS_TOKEN';
    throw error;
  }
};
