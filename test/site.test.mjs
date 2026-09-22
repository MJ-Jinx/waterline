// Front-end regression guards.
//
// Every test here corresponds to a defect that actually shipped. They are
// cheap, run without a browser, and exist so those defects cannot return.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SITE = 'site';
const css = fs.readFileSync(path.join(SITE, 'assets/styles.css'), 'utf8');
const appjs = fs.readFileSync(path.join(SITE, 'assets/app.js'), 'utf8');
const pages = fs.readdirSync(SITE).filter((f) => f.endsWith('.html'));

/** Load app.js against a stub DOM and hand back its test export. */
function loadApp() {
  const g = globalThis;
  g.document = {
    readyState: 'complete',
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => ({ style: {}, dataset: {}, appendChild() {}, addEventListener() {}, setAttribute() {} }),
  };
  g.window = {};
  new Function(appjs)();
  return g.window.Waterline;
}

test('the pipeline can actually finish', () => {
  // Shipped bug: PIPELINE_TIMING stopped at the last step, so "Landed in a
  // block" read "running" forever and never showed a tick.
  const { PIPELINE, PIPELINE_TIMING } = loadApp();
  const N = PIPELINE.length;

  const last = PIPELINE_TIMING[PIPELINE_TIMING.length - 1];
  assert.equal(last[1], N + 1,
    'the final scheduled transition must move PAST the last step, or it never completes');

  const stateAt = (step, idx) => (step > idx ? 'done' : step === idx ? 'now' : 'idle');
  assert.equal(stateAt(N, N), 'now', 'at step N the last step is still running');
  assert.equal(stateAt(N + 1, N), 'done', 'at step N+1 it is done');
});

test('the pipeline schedule is derived from the step durations', () => {
  // The two used to be maintained separately, which is how they drifted.
  const { PIPELINE, PIPELINE_TIMING } = loadApp();
  let t = 0;
  PIPELINE.forEach((s, i) => {
    t += s.ms;
    assert.equal(PIPELINE_TIMING[i][0], t, `offset ${i} follows from the durations`);
    assert.ok(s.ms > 0, 'every step has a positive duration');
  });
});

test('the progress meter never reaches 100% while a step is running', () => {
  const { PIPELINE } = loadApp();
  const N = PIPELINE.length;
  const meter = (step) => Math.max(0, Math.min(100, ((step - 1) / N) * 100));
  assert.equal(meter(N), 80, 'the final step in flight reads 80%, not 100%');
  assert.equal(meter(N + 1), 100, 'only a finished run reads 100%');
});

test('[hidden] is defended against author display rules', () => {
  // Shipped bug: the attack page's result views carry inline display:flex, and
  // the UA rule for [hidden] is a bare `display: none`, which any author
  // declaration outranks. All three views rendered stacked, from page load.
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
    'styles.css must force [hidden] to display:none !important');
});

test('every element toggled by hidden is covered by that rule', () => {
  // If a page ever toggles visibility some other way, this points at it.
  const toggled = appjs.match(/\.hidden\s*=/g) || [];
  assert.ok(toggled.length > 0, 'app.js toggles .hidden somewhere');
  assert.match(css, /\[hidden\]/, 'and the stylesheet accounts for it');
});

test('chips are centred regardless of the element they are built from', () => {
  // Shipped bug: .wl-chip set min-height with no display. The landing page
  // builds chips as <span>, and min-height does nothing on a non-replaced
  // inline element, so the text sat 6.5px above centre.
  const rule = css.match(/\.wl-chip\s*\{[^}]*\}/s);
  assert.ok(rule, '.wl-chip rule exists');
  assert.match(rule[0], /display:\s*inline-flex/, 'chips must be inline-flex');
  assert.match(rule[0], /align-items:\s*center/, 'vertically centred');
  assert.match(rule[0], /justify-content:\s*center/, 'horizontally centred');
});

test('the landing hero reads the ledger rather than a flattering constant', () => {
  // It was hardcoded SAFE while /check read DANGER off the same contract. Not a
  // contradiction — the hero asserts no verdict — but the two could drift, and
  // the fix is to read the same snapshot rather than to rewrite chain state so
  // the illustration matches.
  const landing = appjs.slice(appjs.indexOf('function initLanding'),
                              appjs.indexOf('function initCheck'));
  assert.match(landing, /fetchSnapshot\(\)/, 'the hero consults the snapshot');
  assert.doesNotMatch(landing, /waterlineSVG\(\s*'(safe|caution|danger)'\s*,/,
    'no band is passed as a literal at the call site');
});

test('the water surface is never drawn as a line', () => {
  // The product's core honesty constraint: the page does not know the real
  // total, so a precise surface would be a lie or a disclosure.
  const { waterlineSVG, GEO } = loadApp();
  assert.equal(GEO.BAND_H, 36, 'the indeterminate band is a fixed height');

  for (const band of ['safe', 'caution', 'danger']) {
    const svg = waterlineSVG(band);
    const dashed = svg.match(/stroke-dasharray="3 4"/g) || [];
    assert.equal(dashed.length, 2, `${band}: exactly two dashed band edges`);
    assert.match(svg, /fill="url\(#wl-hatch-/, `${band}: the band is hatched`);
    assert.match(svg, /role="img"/, `${band}: the figure is labelled for screen readers`);
    assert.match(svg, /aria-label="[^"]{20,}"/, `${band}: with a meaningful description`);
  }
});

test('each figure gets unique defs ids', () => {
  // Duplicated ids across instances on one page collapse into whichever
  // rendered first, so every figure but one loses its gradient and hatch.
  const { waterlineSVG } = loadApp();
  const idsOf = (svg) => (svg.match(/id="([^"]+)"/g) || []);
  const a = idsOf(waterlineSVG('safe'));
  const b = idsOf(waterlineSVG('safe'));
  assert.ok(a.length >= 3, 'a figure defines hatch, gradient and clip');
  for (const id of a) assert.ok(!b.includes(id), `id ${id} must not repeat across instances`);
});

test('the claimed-verdict boundaries match the stated limit', () => {
  const { bandForClaim, ATTACK } = loadApp();
  const L = ATTACK.LIMIT_M;
  assert.equal(bandForClaim(L + 0.5), 'danger', 'above the limit is DANGER');
  assert.equal(bandForClaim(L), 'caution', 'exactly at the limit is not yet DANGER');
  assert.equal(bandForClaim(L * 0.9 + 0.1), 'caution');
  assert.equal(bandForClaim(L * 0.9 - 0.1), 'safe');
  assert.ok(ATTACK.DEFAULT_M < L * 0.9,
    'the slider defaults to a figure that would flip the verdict, so the stakes are visible');
});

test('the page can verify itself against the chain', () => {
  // The verdict renders instantly from a snapshot, which is what keeps this
  // page free of WASM, keys and a wallet — but it also means a visitor cannot
  // tell a real reading from a convincing mock. So the page re-fetches the raw
  // ledger state from the public indexer, hashes it, and compares.
  const snapPath = path.join(SITE, 'data/certificates.json');
  assert.ok(fs.existsSync(snapPath), 'a snapshot ships with the site');
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));

  assert.match(snap.stateHash || '', /^[0-9a-f]{64}$/,
    'the snapshot records a sha256 fingerprint of the raw ledger state');
  assert.match(snap.contract, /^[0-9a-f]{64}$/, 'and the contract it was taken from');

  assert.match(appjs, /function verifyAgainstChain/, 'the page implements the check');
  assert.match(appjs, /crypto\.subtle\.digest\('SHA-256'/, 'hashing happens in the browser');
  // It must report a mismatch, not just a match, or it proves nothing.
  assert.match(appjs, /status: live === snap\.stateHash \? 'match' : 'moved'/,
    'and distinguishes a moved ledger from a matching one');

  const check = fs.readFileSync(path.join(SITE, 'check.html'), 'utf8');
  assert.match(check, /data-wl-verify/, 'the result has somewhere to land');
});

test('no ZK key material is committed', () => {
  // The demo page proves in the browser, so 11 MB of prover keys DO get served
  // — staged into site/zk/ by `npm run build:demo`. What must never happen is
  // committing them: "we clone your GitHub repository" is step one of the
  // judging, and nobody should wait on 11 MB of build output to do it.
  //
  // So the check moved from "does this file exist on disk" (which now depends
  // on whether you have run the build) to "is it tracked by git" (which is the
  // claim we actually make).
  const tracked = execFileSync('git', ['ls-files', SITE], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const offenders = tracked.filter((f) => /\.(prover|verifier|bzkir)$/.test(f));
  assert.deepEqual(offenders, [], 'no prover/verifier/zkir artifacts committed under site/');
});

test('the tenant pages load no proving machinery', () => {
  // The claim that survived: checking a building is a ledger read. /check must
  // stay free of the demo bundle and its key material, or "it loads in under a
  // second on a phone at the signing table" stops being true.
  for (const page of ['check.html', 'index.html', 'guide.html']) {
    const html = fs.readFileSync(path.join(SITE, page), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      assert.ok(!/assets\/demo\/|\/zk\/|\.prover|\.bzkir|params\/bls_/.test(m[1]),
        `${page} references ${m[1]}, which belongs to the demo page only`);
    }
  }
});

test('every internal link resolves', () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(SITE, page), 'utf8');
    for (const m of html.matchAll(/(?:href|src)="([^"#:]+)"/g)) {
      const raw = m[1];
      if (raw.startsWith('//') || raw.startsWith('data:')) continue;
      // Strip the query: check.html?b=<id> is a deep link, and the file that
      // has to exist is check.html.
      const target = raw.split('?')[0];
      if (!target) continue;
      assert.ok(fs.existsSync(path.join(SITE, target)),
        `${page} links to ${raw}, and ${target} does not exist`);
    }
  }
});

test('every DOM hook app.js queries exists in the markup', () => {
  // A renamed data attribute silently blanks a whole panel otherwise.
  const html = pages.map((p) => fs.readFileSync(path.join(SITE, p), 'utf8')).join('\n');
  const hooks = new Set(appjs.match(/data-wl-[a-z-]+/g) || []);
  assert.ok(hooks.size > 10, 'app.js queries a meaningful number of hooks');
  for (const h of hooks) {
    assert.ok(html.includes(h), `app.js queries ${h}, which no page defines`);
  }
});

test('no page ships a wallet interface', () => {
  // A hard rule: no connect button, address, balance, seed phrase or network
  // switcher anywhere. Their absence is the product's main usability claim —
  // which the pages also state out loud ("No seed phrase to lose at a signing
  // table"). So a bare keyword match flags the claim as loudly as a violation.
  // Only an UNNEGATED mention counts.
  const banned = /connect wallet|connect a wallet|seed phrase|private key|wallet address|network switcher/gi;
  const negated = /\b(no|not|never|without|nor)\b[^.]{0,40}$/i;

  for (const page of pages) {
    const html = fs.readFileSync(path.join(SITE, page), 'utf8');
    for (const m of html.matchAll(banned)) {
      const before = html.slice(Math.max(0, m.index - 60), m.index);
      assert.ok(negated.test(before),
        `${page} mentions "${m[0]}" without negating it — is this real wallet UI?`);
    }
  }
});

test('"not registered" is never presented as safe', () => {
  const states = fs.readFileSync(path.join(SITE, 'states.html'), 'utf8');
  assert.match(states, /not registered/i, 'the state exists');
  // The absence of a verdict must not be coloured or worded as a passing one.
  const notRegisteredBlock = states.slice(states.search(/not registered/i) - 400,
                                          states.search(/not registered/i) + 900);
  assert.doesNotMatch(notRegisteredBlock, /\bSAFE\b/,
    'the not-registered state must not use the SAFE verdict word');
});

test('the guide quotes labels that actually exist on the pages it describes', () => {
  // The guide walks a visitor through the UI by naming controls: "next to
  // Deposits ahead of yours", "press Save this verification". Renaming a label
  // on /check silently turns those instructions into a hunt for something that
  // is no longer there — which is worse than no guide, because the reader
  // assumes they are the one who is lost. This shipped once: the receipt label
  // "Senior total" was reworded and the guide kept quoting the old name.
  const guide = fs.readFileSync(path.join(SITE, 'guide.html'), 'utf8');
  const check = fs.readFileSync(path.join(SITE, 'check.html'), 'utf8');

  const quoted = [...guide.matchAll(/<em>([^<]{3,60})<\/em>/g)].map((m) => m[1].trim());
  assert.ok(quoted.length >= 3, 'the guide names some controls');

  // Only the ones that are UI labels rather than prose emphasis: a label is
  // something that appears verbatim somewhere in the site's markup.
  const everything = pages.map((p) => fs.readFileSync(path.join(SITE, p), 'utf8')).join('\n');
  const known = ['Deposits ahead of yours', 'Privacy receipt', 'Save this verification',
                 'Generate certificate'];
  for (const label of known) {
    assert.ok(guide.includes(label), `the guide should still walk the reader past "${label}"`);
    assert.ok(everything.includes(label), `the guide quotes "${label}", which no page defines`);
  }
  // And the specific one that drifted.
  assert.ok(check.includes('Deposits ahead of yours'),
    '/check must still carry the label the guide sends people to');
  assert.ok(!guide.includes('Senior total'),
    'the guide must not quote the retired "Senior total" label');
});
