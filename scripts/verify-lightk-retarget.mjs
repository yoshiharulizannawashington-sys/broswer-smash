import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let file;
    if (path === '/__test.html') file = resolve(root, 'scripts/fixtures/lightk-retarget.html');
    else if (path.startsWith('/node_modules/')) file = resolve(root, path.slice(1));
    else if (path.startsWith('/js/') || path.startsWith('/models/') || path.startsWith('/assets/')) file = resolve(root, 'public', path.slice(1));
    else file = resolve(root, 'public', normalize(path).replace(/^[/\\]+/, '') || 'index.html');
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
await page.goto(origin + '/__test.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__result || window.__error, null, { timeout: 120000, polling: 250 });
const error = await page.evaluate(() => window.__error || null);
if (error) {
  console.error('RETARGET_ERROR', error);
  for (const e of errors) console.error('PAGE_ERROR', e);
  await browser.close(); server.close(); process.exit(1);
}
const result = await page.evaluate(() => window.__result);
for (const [label, dataUrl] of Object.entries(result.images)) {
  await writeFile(`artifacts/goku-candidates/lightk-retarget-${label}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
}
delete result.images;
console.log('RESULT ' + JSON.stringify(result));
console.log('ERRORS ' + JSON.stringify(errors));
await browser.close();
server.close();
