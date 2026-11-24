// Poly Pizza adapter: search and download both require an API key, which the UI states plainly.
import { clean, getJson } from './http.mjs';

const token = () => process.env.POLY_PIZZA_KEY || '';

export default {
  id: 'polypizza',
  label: 'Poly Pizza',
  homepage: 'https://poly.pizza/',
  capabilities: { search: 'key', download: 'key', preview: 'image' },
  requires: 'Poly Pizza requires an API key (POLY_PIZZA_KEY) for both search and download. Direct CDN .glb links still work through Direct URL without a key.',
  needsToken: () => !token(),
  tokenVariable: 'POLY_PIZZA_KEY',

  async search(query, { limit = 24 } = {}) {
    if (!token()) {
      const error = new Error('Poly Pizza search needs POLY_PIZZA_KEY. Their models are CC0; a direct static.poly.pizza .glb link works through Direct URL without a key.');
      error.code = 'NEEDS_TOKEN';
      throw error;
    }
    const body = await getJson(`https://api.poly.pizza/v1.1/search/${encodeURIComponent(query)}`, { 'x-auth-token': token() });
    const rows = Array.isArray(body) ? body : body.results || body.models || [];
    return rows.slice(0, limit).map(item => {
      const download = item.Download || item.download || item.Model || item.model || null;
      return {
        source: 'polypizza',
        uid: String(item.Id || item.id || item.Slug || item.slug),
        name: clean(item.Title || item.title || item.name) || 'Untitled',
        author: clean(item.Creator?.Username || item.creator || '') || null,
        thumbnail: item.Thumbnail || item.thumbnail || null,
        triangles: item.TriCount ?? item.triangles ?? null,
        animations: 0,
        rig: 'unknown',
        downloadable: Boolean(download),
        downloadableNow: Boolean(download),
        licence: 'CC0',
        pageUrl: item.Slug ? `https://poly.pizza/m/${item.Slug}` : item.id ? `https://poly.pizza/m/${item.id}` : null,
        formats: ['glb'],
        tags: (item.Tags || item.tags || []).map(tag => clean(tag.Name || tag.name || tag)).filter(Boolean).slice(0, 10),
        categories: []
      };
    });
  },

  async preview(row) {
    return { kind: 'image', url: row.thumbnail };
  },

  async resolve(row) {
    if (!row.downloadUrl) {
      const error = new Error('Poly Pizza download needs a resolved download URL from an authorised search (POLY_PIZZA_KEY).');
      error.code = 'NEEDS_TOKEN';
      throw error;
    }
    return { url: row.downloadUrl, format: '.glb', licence: 'CC0', page: row.pageUrl };
  }
};
