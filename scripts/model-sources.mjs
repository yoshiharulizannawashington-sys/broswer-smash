// Source adapters for the online character browser.
//
// Each adapter states what it can really do. A source with no public API is listed as
// unsupported with the exact requirement, rather than pretending to search it.
// Every `search` here was exercised against the live endpoint from the import machine.

const UA = 'BrowserBros/1.0 (character browser)';

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`${response.status} ${text.slice(0, 160)}`);
    error.status = response.status;
    throw error;
  }
  return JSON.parse(text);
}

const clean = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);

export const SOURCES = {
  sketchfab: {
    label: 'Sketchfab',
    capabilities: { search: 'public', download: 'token', preview: 'public' },
    requires: 'Search and previews are public. Downloading a model needs an API token with the download permission.',
    async search(query, limit = 24) {
      const url = `https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(query)}`
        + `&downloadable=true&count=${limit}`;
      const body = await getJson(url);
      return (body.results || []).map(model => ({
        source: 'sketchfab',
        uid: model.uid,
        name: clean(model.name),
        author: clean(model.user?.displayName || model.user?.username || ''),
        thumbnail: model.thumbnails?.images?.[0]?.url || null,
        triangles: model.faceCount || null,
        vertices: model.vertexCount || null,
        animations: model.animationCount ?? null,
        rigged: Boolean(model.isRigged ?? model.rigged),
        downloadable: Boolean(model.isDownloadable),
        licence: model.license?.label || model.license?.slug || null,
        pageUrl: model.viewerUrl || `https://sketchfab.com/3d-models/${model.uid}`,
        formats: Object.values(model.archives || {}).map(a => a?.format).filter(Boolean)
      }));
    },
    async resolveDownload(uid) {
      const token = process.env.SKETCHFAB_TOKEN;
      if (!token) {
        const error = new Error('Sketchfab downloads need SKETCHFAB_TOKEN. Add a token with the download '
          + 'permission to the import machine, then import again. Search and preview need no account.');
        error.code = 'NEEDS_TOKEN';
        throw error;
      }
      const body = await getJson(`https://api.sketchfab.com/v3/models/${uid}/download`, { Authorization: `Token ${token}` });
      const url = body.glb?.url || body.gltf?.url || body.usdz?.url;
      if (!url) throw new Error('this model has no glTF/GLB archive to download');
      return { url, format: body.glb ? '.glb' : '.gltf' };
    }
  },

  blenderkit: {
    label: 'BlenderKit',
    capabilities: { search: 'public', download: 'token', preview: 'public' },
    requires: 'Search is public. Downloading needs a BlenderKit API key from your account page.',
    async search(query, limit = 24) {
      const body = await getJson(`https://www.blenderkit.com/api/v1/search/?query=${encodeURIComponent(query)}&asset_type=model`);
      return (body.results || []).slice(0, limit).map(asset => ({
        source: 'blenderkit', uid: String(asset.id), name: clean(asset.name || asset.displayName),
        author: clean(asset.author?.name || ''), thumbnail: asset.thumbnailLargeUrl || asset.thumbnailUrl || null,
        triangles: asset.tri_count || null, animations: null, rigged: Boolean(asset.isRigged),
        downloadable: Boolean(asset.downloadUrl), licence: asset.license || null,
        pageUrl: asset.assetBaseId ? `https://www.blenderkit.com/asset-gallery-detail/${asset.assetBaseId}/` : null,
        formats: ['blend']
      }));
    },
    async resolveDownload() {
      const error = new Error('BlenderKit downloads need a BlenderKit API key (account page → API key) in BLENDERKIT_API_KEY.');
      error.code = 'NEEDS_TOKEN';
      throw error;
    }
  },

  polypizza: {
    label: 'Poly Pizza',
    capabilities: { search: 'key', download: 'direct', preview: 'public' },
    requires: 'Poly Pizza\'s search API needs an API key (POLY_PIZZA_KEY). Direct static .glb links work without one.',
    async search() {
      const error = new Error('Poly Pizza search needs POLY_PIZZA_KEY. Their CDN still serves direct .glb links, so paste one into Direct URL.');
      error.code = 'NEEDS_TOKEN';
      throw error;
    },
    async resolveDownload() {
      throw new Error('use a direct static.poly.pizza .glb link through the Direct URL source');
    }
  },

  direct: {
    label: 'Direct URL',
    capabilities: { search: 'none', download: 'direct', preview: 'none' },
    requires: 'Paste a direct link to a .glb, .gltf, .fbx, .obj, .vrm or .blend file that the import machine can reach.',
    async search() { return []; },
    async resolveDownload({ url }) {
      if (!/^https?:\/\//i.test(url || '')) throw new Error('a direct URL must start with http:// or https://');
      const response = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!response.ok) throw new Error(`the source refused the download (${response.status})`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const path = new URL(url).pathname;
      const format = (path.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase() || '.glb';
      return { buffer, format, url };
    }
  }
};

// Sources with no public retrieval route, stated plainly instead of faked.
export const UNSUPPORTED = {
  cgtrader: 'No public API. Its catalogue requires a CGTrader account and its downloads are account/licence gated.',
  turbosquid: 'Blocks automated requests (403) and has no public API; downloads require a TurboSquid account.',
  free3d: 'No public API; downloads require a Free3D account and are behind session cookies.',
  '3dexport': 'No public API; downloads require an account.',
  renderhub: 'No public API; downloads require an account.',
  artstation: 'No public model API; ArtStation Marketplace downloads require an account and purchase.',
  'vroid-hub': 'API answers only with an X-Api-Version header and OAuth; model downloads require authorization.',
  opengameart: 'Has an HTML catalogue only; no JSON API to depend on.',
  'itch.io': 'No public asset search API; downloads are per-project pages.',
  actorcore: 'Commercial motion/character store with no public download API.',
  quaternius: 'Publishes free packs as .zip downloads from quaternius.com with no API; add them via Direct URL once hosted.'
};

export const capabilities = () => ({
  sources: Object.entries(SOURCES).map(([id, source]) => ({
    id, label: source.label, capabilities: source.capabilities, requires: source.requires
  })),
  unsupported: UNSUPPORTED
});
