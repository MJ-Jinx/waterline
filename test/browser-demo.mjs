// Does the Full Demo actually prove in a real browser?
//
//   node test/browser-demo.mjs                 # against ./site, from a local server
//   BASE=https://mj-jinx.github.io/waterline node test/browser-demo.mjs
//
// The second form is the one that answers the question a judge will ask: does
// the DEPLOYED site prove? The bundle and the 11 MB of keys are built in CI and
// never committed, so passing locally says nothing about whether the deploy
// staged them. Different question, same assertions.
//
// Not part of `npm test`: it needs Chromium, downloads ~15 MB of key material
// and spends a minute or two computing four real Plonk proofs. But it is the
// only check that means anything for this page — every other test here can
// pass while the demo is a frozen tab, because the proving lives in a worker
// and the worker only exists in a browser.
//
// Requires: npm run compile && npm run build:demo

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const SITE = 'site';
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
};

// Point at a deployed site and skip the local server entirely.
const REMOTE = (process.env.BASE || '').replace(/[/]+$/, '');

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(SITE, rel);
  // Log every request. When the worker went silent, the only way to tell a
  // failed fetch from a module that never finished loading was to ask the
  // server what the browser had actually asked for.
  const ok = file.startsWith(SITE) && fs.existsSync(file) && !fs.statSync(file).isDirectory();
  console.log(`  [http] ${ok ? '200' : '404'} ${rel}${ok ? ` (${(fs.statSync(file).size / 1024).toFixed(0)} KB)` : ''}`);
  if (!ok) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Content-Length': fs.statSync(file).size,
  });
  fs.createReadStream(file).pipe(res);
});

let base = REMOTE;
if (REMOTE) {
  console.log(`testing the deployed site at ${REMOTE}`);
} else {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  console.log(`serving ${SITE} at ${base}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();

// Stream everything as it happens. Waiting ten minutes on a selector that will
// never appear, with the reason sitting unread in an array, is how the first
// run of this test wasted a quarter of an hour.
const problems = [];
const note = (s) => { problems.push(s); console.log(`  [browser] ${s}`); };
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') {
    if (/ERR_(SOCKET_NOT_CONNECTED|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED)/.test(t)) return;
    note(`console: ${t}`);
  } else if (process.env.VERBOSE) console.log(`  [console] ${t}`);
});
page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => {
  // Only our own assets matter. The webfont CDN is unreachable from a sandbox
  // and its absence changes nothing about whether the demo proves.
  if (!r.url().startsWith(base)) { console.log(`  [skip] external ${new URL(r.url()).host}`); return; }
  // A CDN-fronted host can 404 a font or a map without affecting the proving.
  if (/[.](woff2?|map)$/.test(r.url())) { console.log(`  [skip] ${r.url().split('/').pop()}`); return; }
  note(`request failed: ${r.url()} ${r.failure()?.errorText}`);
});

// Surface the demo's own status line so a stall is visible rather than silent.
// Download progress fires per chunk — hundreds of lines for 15 MB, which
// buries the steps that matter. Report the first of each run and then only
// non-download changes.
let sawDownload = false;
await page.exposeFunction('__probe', (s) => {
  if (/^Downloading/.test(s)) {
    if (sawDownload) return;
    sawDownload = true;
  } else {
    sawDownload = false;
  }
  console.log(`  [demo] ${s}`);
});

let failed = false;
const started = Date.now();
try {
  await page.goto(`${base}/demo.html`, { waitUntil: 'domcontentloaded' });

  // The proving keys and SRS are big, and four real proofs follow, so this
  // waits minutes rather than seconds. A tighter bound would just make the
  // test flaky on a slow machine.
  await page.evaluate(() => {
    const el = document.querySelector('[data-demo-status]');
    if (!el) return;
    new MutationObserver(() => window.__probe(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });

  await page.click('[data-demo-run]');

  // Fail fast on the demo's own error path instead of waiting out the timeout.
  const ok = page.waitForSelector('[data-demo-result]:not([hidden])', { timeout: 10 * 60 * 1000 })
    .then(() => 'done');
  const bad = page.waitForSelector('.d-entry h3:text-is("Stopped")', { timeout: 10 * 60 * 1000 })
    .then(() => 'stopped');
  const outcome = await Promise.race([ok, bad]);
  if (outcome === 'stopped') {
    const why = await page.textContent('.d-entry:last-child p');
    throw new Error(`the demo stopped: ${why}`);
  }

  const verdict = (await page.textContent('[data-demo-verdict]') || '').trim();
  const band = await page.getAttribute('[data-demo-result]', 'data-band');
  const steps = await page.$$eval('.d-entry h3', (els) => els.map((e) => e.textContent.trim()));
  const proved = await page.$$eval('.d-note--ok', (els) => els.map((e) => e.textContent.trim()));

  console.log(`\nfinished in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`verdict: ${verdict}  (band=${band})`);
  console.log('\nsteps:');
  for (const s of steps) console.log(`  ${s}`);
  console.log('\nproofs:');
  for (const p of proved) console.log(`  ${p}`);

  // Four real proofs: openBuilding, two leases, issueCertificate.
  if (proved.length !== 4) {
    console.log(`\nFAIL: expected 4 proofs, saw ${proved.length}`);
    failed = true;
  }
  // Newest first. The timeline used to append, which buried the step that had
  // just landed below the fold on a phone. Nothing else here would notice if it
  // flipped back, because every other assertion is order-independent.
  if (steps[0] !== 'The verdict' || steps[steps.length - 1] !== 'A building, invented on the spot') {
    console.log('\nFAIL: timeline is not newest-first');
    console.log(`  top: ${steps[0]}`);
    console.log(`  bottom: ${steps[steps.length - 1]}`);
    failed = true;
  }
  // The scripted books are 5.0억 against an 8.0억 valuation, so 70% -> SAFE.
  if (band !== 'safe') {
    console.log(`\nFAIL: expected band "safe", got "${band}"`);
    failed = true;
  }
  if (!/안전|SAFE/.test(verdict)) {
    console.log(`\nFAIL: verdict text did not name the band: ${verdict}`);
    failed = true;
  }

  // A run that produces nothing to keep demonstrates the cryptography and
  // hides the point: the certificate IS the product.
  const saveRun = await page.$('[data-demo-save-run]:not([hidden])');
  if (!saveRun) {
    console.log('\nFAIL: a completed run offered no certificate to download');
    failed = true;
  } else {
    const [dl] = await Promise.all([page.waitForEvent('download'), saveRun.click()]);
    const doc = fs.readFileSync(await dl.path(), 'utf8');
    console.log(`\ncertificate: ${dl.suggestedFilename()} (${doc.length} B)`);
    // It must carry a QR and must not pass itself off as a registry record.
    for (const [needle, why] of [
      ['<svg', 'no QR code'],
      ['demo, not a registry record', 'does not disclaim being a registry record'],
      ['nothing was submitted', 'does not say it never reached a chain'],
    ]) {
      if (!doc.includes(needle)) { console.log(`FAIL: the certificate ${why}`); failed = true; }
    }
  }

  // And the lie must be refused, in the browser, before any proof exists.
  await page.fill('[data-demo-claim]', '3.0');
  await page.click('[data-demo-forge]');
  await page.waitForSelector('.d-note--bad', { timeout: 3 * 60 * 1000 });
  const refusal = (await page.textContent('.d-note--bad') || '').trim();
  console.log(`forgery: ${refusal}`);
  if (!/refused|Stale opening|assert/i.test(refusal)) {
    console.log('FAIL: the forged total was not refused');
    failed = true;
  }

  // The other half, and the one that makes the refusal mean anything: the TRUE
  // total is accepted. This used to be reported as "the contract accepted a
  // false opening — this should be impossible", so entering the honest figure
  // told the visitor the contract was broken. Every assertion still passed.
  await page.fill('[data-demo-claim]', '5.0');
  await page.click('[data-demo-forge]');
  await page.waitForSelector('.d-note--ok', { timeout: 3 * 60 * 1000 });
  const accepted = (await page.textContent('[data-demo-status]') || '').trim();
  console.log(`truthful claim: ${accepted}`);
  if (!/accepted/i.test(accepted) || /false opening/i.test(accepted)) {
    console.log('FAIL: the true total was not accepted');
    failed = true;
  }

  const saveAttempt = await page.$('[data-demo-save-attempt]:not([hidden])');
  if (!saveAttempt) {
    console.log('FAIL: no verification record offered after an attempt');
    failed = true;
  } else {
    const [dl2] = await Promise.all([page.waitForEvent('download'), saveAttempt.click()]);
    const rec = fs.readFileSync(await dl2.path(), 'utf8');
    console.log(`record: ${dl2.suggestedFilename()} (${rec.length} B)`);
    if (!rec.includes('ACCEPTED') || rec.includes('UNEXPECTED')) {
      console.log('FAIL: the record does not report a plain acceptance');
      failed = true;
    }
  }
} catch (e) {
  console.log(`\nFAIL: ${e.message}`);
  failed = true;
}

if (problems.length) {
  console.log('\nbrowser problems:');
  for (const p of [...new Set(problems)]) console.log(`  ${p}`);
  failed = true;
}

await browser.close();
if (!REMOTE) server.close();
console.log(failed ? '\nFAILED' : '\nOK — the demo proves in a real browser');
process.exit(failed ? 1 : 0);
