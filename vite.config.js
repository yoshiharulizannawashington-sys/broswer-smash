import { defineConfig } from 'vite';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The playable site lives in public/: public/index.html is the real entry point and
// public/js, public/assets and public/models are served from the site root.
// Keeping that folder as Vite's root means `npm run build` produces the same URL
// layout the game already expects (/js/..., /assets/..., /models/...) instead of a
// second, differently-structured copy of the project.
//
// public/ is the site root here, so Vite must not treat it as a publicDir as well.
const stripCacheBustFromEntry = {
  name: 'browser-smash-strip-entry-cache-bust',
  // The HTML entrypoints carry ?v=<build tag> so browsers never serve a stale module.
  // Vite resolves <script src> as a filesystem path and cannot open a path with a
  // query string, so strip the query for the build only. The source HTML keeps its
  // version tag, which is what the repository's cache-version checks inspect.
  transformIndexHtml: {
    order: 'pre',
    handler: html => html.replace(/(<script[^>]*src="\.\/js\/main\.js)\?v=[^"]*(")/g, '$1$2')
  }
};

// Files the game requests by URL at runtime (not through a static import) are invisible
// to the bundler, so they have to be copied verbatim or the built site 404s on them:
//   /models/**  character manifest and any installed Goku/Iron Man package
//   /data/**  animation manifest (fetched by animation_loader.js at runtime)
//   /assets/arenas/**  authored Blender arenas loaded lazily by the arena loader
// Everything else under public/assets is referenced through new URL(..., import.meta.url)
// and is emitted with a content hash by Vite itself.
const copyRuntimeAssets = {
  name: 'browser-smash-copy-runtime-assets',
  writeBundle(options) {
    const outDir = options.dir || join(process.cwd(), 'dist');
    for (const relative of ['models', 'data', join('assets', 'arenas')]) {
      const source = join(process.cwd(), 'public', relative);
      if (!existsSync(source)) continue;
      mkdirSync(join(outDir, relative), { recursive: true });
      cpSync(source, join(outDir, relative), { recursive: true });
    }
  }
};

export default defineConfig({
  root: 'public',
  publicDir: false,
  plugins: [stripCacheBustFromEntry, copyRuntimeAssets],
  server: { host: '0.0.0.0', port: 3000, strictPort: true },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 4096
  }
});
