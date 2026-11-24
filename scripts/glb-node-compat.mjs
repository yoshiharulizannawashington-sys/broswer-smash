// Browser image APIs for the Node-side GLB inspectors.
//
// three's GLTFLoader decodes an embedded texture (a GLB's PNG) through `self.URL` and
// `createImageBitmap`. Node has `Blob`, `URL` and `fetch` but neither of those globals, so a GLB
// that ships embedded textures threw `self is not defined` inside the inspection scripts. The
// inspectors only need geometry, skins, clips and material names - never the pixels - so a
// placeholder bitmap is enough to let the material parse complete.
//
// Import this before GLTFLoader in any script that parses a GLB in Node.
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
}
