// Provider registry for the online character import system.
//
// Adding a source means dropping one adapter file here. Every adapter declares what it can
// really do, and sources with no public retrieval route are listed with the exact reason instead
// of being turned into a dead button.
import sketchfab from './sketchfab.mjs';
import polyhaven from './polyhaven.mjs';
import blenderkit from './blenderkit.mjs';
import polypizza from './polypizza.mjs';
import ambientcg from './ambientcg.mjs';
import direct from './direct.mjs';

export const SOURCES = { sketchfab, polyhaven, blenderkit, polypizza, ambientcg, direct };

// No public retrieval route. Each entry says what would be required, so the UI can point the user
// at Direct URL or at the provider's own site rather than faking an import.
export const UNSUPPORTED = {
  cgtrader: 'No public API. Browsing and downloads need a CGTrader account; use Direct URL with an authorised download.',
  turbosquid: 'Blocks automated requests and has no public API. Use Direct URL with an authorised download.',
  kenney: 'No API. Kenney publishes free packs as zip downloads on kenney.nl — fetch one and use Direct URL.',
  quaternius: 'No API. Free packs are zip downloads from quaternius.com — fetch one and use Direct URL.',
  smithsonian: 'The Smithsonian 3D API needs an api.data.gov key and its 3D endpoints are not public; use Direct URL with a downloaded file.',
  free3d: 'No public API; downloads need an account and session cookies.',
  '3dexport': 'No public API; downloads require an account.',
  renderhub: 'No public API; downloads require an account.',
  artstation: 'No public model API; Marketplace downloads need an account and a purchase.',
  'vroid-hub': 'API requires X-Api-Version and OAuth; model downloads require authorisation.',
  opengameart: 'HTML catalogue only, no JSON API. Download a file and use Direct URL.',
  'itch.io': 'No public asset search API; downloads live behind per-project pages.',
  actorcore: 'Commercial motion/character store with no public download API.',
  mixamo: 'Requires an Adobe sign-in and a browser session; there is no public download API. Use Direct URL with a downloaded FBX.'
};

export function getProvider(id) {
  const provider = SOURCES[id];
  if (!provider) {
    const error = new Error(`unknown source "${id}"`);
    error.code = 'UNKNOWN_SOURCE';
    throw error;
  }
  return provider;
}

export function capabilities() {
  return {
    sources: Object.entries(SOURCES).map(([id, source]) => ({
      id,
      label: source.label,
      homepage: source.homepage || null,
      capabilities: source.capabilities,
      requires: source.requires,
      needsToken: source.needsToken ? source.needsToken() : false,
      tokenVariable: source.tokenVariable || null,
      assetKinds: source.assetKinds || null
    })),
    unsupported: UNSUPPORTED,
    filters: {
      kinds: ['character', 'creature', 'weapon', 'armor', 'accessory', 'environment', 'vehicle', 'material'],
      rig: ['yes', 'no', 'unknown'],
      animated: ['yes', 'no']
    }
  };
}
