#!/usr/bin/env node
// Browser-level proof for the online character import UI.
//
//   bash scripts/run-browser-test.sh scripts/test-model-import-browser.mjs
//
// Opens the real game page, drives the panel like a user: search a public provider, filter it,
// preview the actual GLB in the in-page 3D viewer, run an import, and confirm the approval step
// appears with the replace/variant/new/prop choices and the roster untouched.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const origin = process.env.ORIGIN || 'http://127.0.0.1:3100';
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.setDefaultTimeout(180_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 240)));
page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text().slice(0, 240)); });
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const local = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try {
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(local) });
  } catch { await route.fulfill({ status: 404, body: 'missing' }); }
});

try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 180_000, polling: 250 });
  const rosterBefore = await page.evaluate(() => window.characterRosters?.all?.length ?? 0);

  await page.locator('#ocButton').click();
  await page.waitForSelector('#ocPanel.open');
  record('the panel opens from the game', true, 'ONLINE CHARACTERS launcher visible in-match');

  const providers = await page.locator('#ocSource option').allTextContents();
  const filters = await page.evaluate(() => ({
    kinds: document.querySelectorAll('#ocKind option').length,
    rig: document.querySelectorAll('#ocRig option').length,
    animated: document.querySelectorAll('#ocAnimated option').length,
    downloadable: Boolean(document.querySelector('#ocDownloadable'))
  }));
  record('source list is populated from the adapters', providers.length >= 4, providers.join(' | '));
  record('filters cover kind, rig, motion and availability',
    filters.kinds >= 8 && filters.rig === 3 && filters.animated === 3 && filters.downloadable,
    JSON.stringify(filters));

  await page.selectOption('#ocSource', 'polyhaven');
  await page.fill('#ocQuery', 'sword');
  await page.locator('#ocSearch').click();
  await page.waitForFunction(() => document.querySelectorAll('.ocCard').length > 0, null, { timeout: 120_000 });
  const cards = await page.locator('.ocCard').count();
  const firstBadges = await page.locator('.ocCard').first().locator('.ocTag').allTextContents();
  record('search renders classified results', cards > 0, `${cards} card(s); badges: ${firstBadges.join(', ')}`);
  record('results carry a classification and availability badge',
    firstBadges.some(text => /CHARACTER|WEAPON|ARMOUR|ACCESSORY|ENVIRONMENT|MATERIAL|CREATURE|UNKNOWN/.test(text))
    && firstBadges.some(text => /DOWNLOAD/.test(text)), firstBadges.join(' | '));

  await page.selectOption('#ocKind', 'weapon');
  await page.locator('#ocSearch').click();
  await page.waitForFunction(() => document.querySelectorAll('.ocCard').length > 0, null, { timeout: 120_000 });
  const kinds = await page.locator('.ocCard .ocTag').allTextContents();
  const nonWeapon = kinds.filter(text => /CHARACTER|ENVIRONMENT|ACCESSORY|MATERIAL|ANIMALS/.test(text));
  record('kind filter restricts the list to weapons', nonWeapon.length === 0, `${kinds.length} badges, ${nonWeapon.length} non-weapon`);

  await page.locator('.ocCard').first().locator('button', { hasText: 'PREVIEW' }).click();
  await page.waitForSelector('#ocDrawer.open');
  await page.waitForFunction(() => {
    const text = document.querySelector('#ocInfo')?.textContent || '';
    return (/Triangles/.test(text) && document.querySelector('#ocViewer canvas')) || /Preview unavailable/.test(text);
  }, null, { timeout: 180_000 });
  const previewText = await page.locator('#ocInfo').textContent();
  if (/Preview unavailable/.test(previewText || '')) {
    record('the preview renders the actual model in-page', false, String(previewText).slice(0, 260));
  }
  const preview = await page.evaluate(() => {
    const canvas = document.querySelector('#ocViewer canvas');
    const rows = [...document.querySelectorAll('#ocInfo tr')].map(row => row.textContent);
    return { width: canvas?.width || 0, height: canvas?.height || 0, rows, clips: document.querySelectorAll('#ocClips option').length };
  });
  record('the preview renders the actual model in-page', preview.width > 100 && preview.height > 100,
    `canvas ${preview.width}x${preview.height}`);
  record('preview reports measured file facts', preview.rows.some(row => /Triangles/.test(row)) && preview.rows.some(row => /Rig/.test(row)),
    preview.rows.slice(0, 5).join(' · '));

  await page.locator('#ocDrawerClose').click();
  await page.waitForFunction(() => !document.querySelector('#ocDrawer.open'));
  await page.locator('.ocCard').first().locator('button', { hasText: 'IMPORT TO GAME' }).click();
  await page.waitForSelector('#ocDrawer.open');
  await page.waitForFunction(() => {
    const approval = document.querySelector('#ocApproval');
    const failed = /FAILED at/.test(document.querySelector('#ocReport')?.textContent || '');
    return (approval && approval.style.display !== 'none') || failed;
  }, null, { timeout: 240_000 });
  const approval = await page.evaluate(() => {
    const box = document.querySelector('#ocApproval');
    const options = [...document.querySelectorAll('#ocOperation option')].map(option => option.textContent);
    const stages = [...document.querySelectorAll('#ocStages li')].map(item => `${item.className || 'pending'}: ${item.textContent}`);
    return {
      visible: Boolean(box) && box.style.display !== 'none', options, stages,
      approveDisabled: document.querySelector('#ocApproval .approve')?.disabled ?? null,
      report: document.querySelector('#ocReport')?.textContent || ''
    };
  });
  record('import progresses through the staged pipeline', approval.stages.filter(stage => stage.startsWith('done')).length >= 4,
    approval.stages.filter(stage => stage.startsWith('done')).map(stage => stage.split(':')[0]).join(', '));
  record('approval offers real operations, not a fake import', approval.visible && approval.options.length >= 1,
    approval.options.join(' | ') || approval.report.slice(0, 200));
  record('nothing applies without an explicit approval click', approval.approveDisabled === true,
    `apply button disabled=${approval.approveDisabled}`);

  const rosterAfter = await page.evaluate(() => window.characterRosters?.all?.length ?? 0);
  record('review mode left the roster length unchanged', rosterBefore === rosterAfter, `${rosterBefore} → ${rosterAfter}`);
  record('no page errors during the flow', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
} catch (error) {
  record('browser flow completed', false, String(error?.message || error).slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter(entry => !entry.ok);
console.log('\n' + JSON.stringify({ origin, passed: results.length - failed.length, failed: failed.length,
  failures: failed.map(entry => `${entry.name}: ${entry.detail}`), pageErrors: errors.slice(0, 5) }, null, 1));
process.exit(failed.length ? 1 : 0);
