// ambientCG adapter: public CC0 PBR materials. These are textures, not models, so they are
// classified as material and can never be offered as a playable character.
import { clean, getJson } from './http.mjs';

export default {
  id: 'ambientcg',
  label: 'ambientCG',
  homepage: 'https://ambientcg.com/',
  capabilities: { search: 'public', download: 'direct', preview: 'image' },
  requires: 'Public CC0 material library. Downloads are texture/map archives only — ambientCG publishes no character models.',
  needsToken: () => false,
  assetKinds: ['material'],

  async search(query, { limit = 24 } = {}) {
    const params = new URLSearchParams({ type: 'Material', limit: String(Math.min(48, Math.max(1, limit))), q: query });
    const body = await getJson(`https://ambientcg.com/api/v2/full_json?${params}`);
    const assets = body.foundAssets || body.assets || [];
    return assets.map(asset => ({
      source: 'ambientcg',
      uid: asset.assetId,
      name: clean(asset.displayName || asset.assetId),
      author: 'ambientCG',
      thumbnail: asset.previewImage?.['256-PNG'] || asset.previewImage?.['512-PNG'] || null,
      triangles: null,
      animations: 0,
      rig: 'no',
      downloadable: true,
      downloadableNow: true,
      licence: 'CC0',
      pageUrl: `https://ambientcg.com/a/${asset.assetId}`,
      formats: ['zip (textures)'],
      tags: (asset.tags || []).slice(0, 10),
      categories: (asset.categories || []).slice(0, 5)
    }));
  },

  async preview(row) {
    return { kind: 'image', url: row.thumbnail };
  },

  async resolve(row) {
    return {
      url: `https://ambientcg.com/get?file=${encodeURIComponent(row.uid)}_1K-JPG.zip`,
      format: '.zip',
      licence: 'CC0',
      page: row.pageUrl
    };
  }
};
