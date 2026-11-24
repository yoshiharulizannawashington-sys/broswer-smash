#!/usr/bin/env node
// Find downloadable 3D models whose CREATOR publishes an off-Sketchfab download link.
//
// Sketchfab's own download endpoint requires a signed-in account (HTTP 401 without one), and that is
// never circumvented. Plenty of creators, however, publish their project files in the model
// description — a Drive folder, a Mega link, a GitHub repo. That is open, no-account delivery, and it
// is how the Naruto body was obtained.
//
//   node scripts/find-downloadable-model.mjs superman goku "spider-man"
//
// Prints every downloadable candidate with its licence, triangle count and the external links found
// in its description, so a download can be attempted without touching a gated endpoint.
const API = 'https://api.sketchfab.com/v3';
const EXTERNAL = /https?:\/\/(?!sketchfab\.com|www\.sketchfab\.com|help\.sketchfab\.com)[^\s"'<>)]+/gi;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(url, attempt = 1) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'browser-bros-asset-scan/1.0' } });
  if (response.status === 429 && attempt <= 3) {
    await sleep(4000 * attempt);
    return getJson(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function linksIn(description = '') {
  const found = new Set();
  for (const match of String(description).matchAll(EXTERNAL)) {
    const url = match[0].replace(/&amp;/g, '&').replace(/[.,;]+$/, '');
    found.add(url);
  }
  return [...found];
}

async function scan(term) {
  const search = await getJson(`${API}/search?type=models&q=${encodeURIComponent(term)}&downloadable=true&count=24&sort_by=-likeCount`);
  const results = (search.results || []).map(r => ({
    uid: r.uid,
    name: r.name,
    creator: r.user?.displayName || r.user?.username || null,
    faces: r.faceCount ?? null,
    license: r.license?.label || r.license?.slug || null,
    downloadable: Boolean(r.isDownloadable),
    url: r.viewerUrl || `https://sketchfab.com/3d-models/${r.uid}`
  }));
  const detailed = [];
  for (const item of results.slice(0, 14)) {
    await sleep(350);
    try {
      const model = await getJson(`${API}/models/${item.uid}`);
      detailed.push({ ...item, links: linksIn(model.description), animations: model.animationCount ?? null });
    } catch (error) {
      detailed.push({ ...item, links: [], error: String(error.message || error) });
    }
  }
  const withLinks = detailed.filter(item => item.links.length);
  return { term, total: search.totalCount ?? null, results: detailed.length, withLinks };
}

const terms = process.argv.slice(2);
if (!terms.length) {
  console.error('usage: node scripts/find-downloadable-model.mjs <term> [term…]');
  process.exit(1);
}

const report = [];
for (const term of terms) {
  try {
    const scanResult = await scan(term);
    report.push(scanResult);
    console.log(`\n=== ${term}: ${scanResult.withLinks.length} of ${scanResult.results} downloadable candidates publish an external link (${scanResult.total} total hits)`);
    for (const item of scanResult.withLinks) {
      console.log(`  ${item.name}  [${item.uid}]`);
      console.log(`    creator=${item.creator} faces=${item.faces} license=${item.license} animations=${item.animations ?? '?'}`);
      for (const link of item.links.slice(0, 4)) console.log(`    link: ${link}`);
    }
  } catch (error) {
    report.push({ term, error: String(error.message || error) });
    console.log(`\n=== ${term}: FAILED ${error.message}`);
  }
  await sleep(1200);
}

console.log('\nJSON ' + JSON.stringify(report));
