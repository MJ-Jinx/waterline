// Self-contained documents for a demo run.
//
// The Check page hands a tenant a verification sheet they can print, and the
// Full Demo produced nothing at all — the verdict lived and died in the tab.
// So the run ended with a word on screen and no way to take it anywhere, which
// is the wrong lesson: the certificate IS the product.
//
// These are deliberately NOT the same document as check.html's. That one is a
// reading of the live ledger and its QR sends a scanner back to re-read it.
// Nothing here is on chain — the building was invented seconds ago in this tab
// — so a document that looked like the real one would be a forgery of exactly
// the kind the rest of this page exists to make impossible. Every sheet below
// says so on its face, and the QR points at the demo rather than at a building
// that does not exist.

const BAND_WORD = { 2: '안전 SAFE', 1: '주의 CAUTION', 0: '위험 DANGER' };
const BAND_HEX = { 2: '#2F6B4F', 1: '#A8701A', 0: '#C0352B' };
const BAND_SENTENCE = {
  2: 'Senior deposits sit within the safe share of the appraised value.',
  1: 'Senior deposits are above the safe line but within the caution line.',
  0: 'Senior deposits exceed the caution line. A new tenant would rank behind them.',
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const won = (raw) => '₩' + String(raw).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function qrFor(url, label) {
  // The encoder is a plain global on the page, not a module. If it is missing
  // the document still has to be valid, so this degrades to no QR rather than
  // throwing halfway through building the HTML.
  try {
    if (typeof WaterlineQR !== 'undefined') {
      return WaterlineQR.svg(url, { dark: '#14243A', label });
    }
  } catch { /* fall through */ }
  return '';
}

const STYLE = '*{box-sizing:border-box}body{margin:0;padding:32px;background:#F5F3EE;'
  + 'font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#33455C}'
  + '.doc{max-width:720px;margin:0 auto;background:#fff;border:1px solid #E2DCD0;'
  + 'border-radius:8px;padding:34px 38px}'
  + 'h1{margin:0;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6B7A8C}'
  + '.verdict{font-size:54px;font-weight:700;line-height:1;letter-spacing:-.012em;margin:14px 0 6px}'
  + '.sentence{margin:0 0 20px;font-size:16px;color:#14243A}'
  + 'table{width:100%;border-collapse:collapse;margin:0 0 20px}'
  + 'th,td{text-align:left;padding:9px 0;border-bottom:1px solid #EFEBE2;vertical-align:top}'
  + 'th{width:40%;font-weight:600;color:#6B7A8C;font-size:12px;letter-spacing:.06em;'
  + 'text-transform:uppercase}'
  + 'td{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#14243A;'
  + 'word-break:break-all}'
  + '.split{display:flex;gap:26px;align-items:flex-start;flex-wrap:wrap}'
  + '.qr{width:190px;flex:0 0 190px}.qr svg{width:100%;height:auto;display:block;'
  + 'border:1px solid #E2DCD0;border-radius:6px}'
  + '.qr p{font-size:11px;color:#6B7A8C;margin:8px 0 0;text-align:center}'
  + '.notes{flex:1 1 300px;font-size:13px}'
  + '.notes h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6B7A8C;margin:0 0 8px}'
  + '.notes ul{margin:0 0 16px;padding-left:18px}.notes li{margin:3px 0}'
  + '.banner{border-left:3px solid #A8701A;background:rgba(168,112,26,.07);padding:12px 15px;'
  + 'font-size:13px;margin:0 0 20px}'
  + '.foot{margin-top:24px;padding-top:16px;border-top:1px solid #EFEBE2;font-size:12px;color:#6B7A8C}'
  + '@media print{body{background:#fff;padding:0}.doc{border:0;padding:0}}';

function shell(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${esc(title)}</title><style>${STYLE}</style></head>`
    + `<body><div class="doc">${body}</div></body></html>`;
}

const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;

/** Where a scanner should land. The demo, not a building that does not exist. */
function demoUrl() {
  try { return location.origin + location.pathname; } catch { return ''; }
}

/**
 * The document for a completed run: the verdict, what it was computed from,
 * and the proofs that were actually built to get there.
 */
export function runDocument(run, chain) {
  const word = BAND_WORD[run.band] || 'NO VERDICT';
  const hue = BAND_HEX[run.band] || '#5A6B7E';
  const url = demoUrl();
  const limit = (BigInt(run.appraised) * BigInt(run.safePct)) / 100n;
  const total = run.proofs.reduce((a, p) => a + p.ms, 0);

  const proofRows = run.proofs.map((p) => (
    `<tr><th>${esc(p.name)}</th><td>${(p.ms / 1000).toFixed(1)}s · `
    + `${p.proofBytes.toLocaleString()} B proof · ${p.preimageBytes} B statement</td></tr>`
  )).join('');

  return shell(`Waterline demo — ${word}`,
    '<h1>Waterline — demo run, computed in a browser</h1>'
    + `<div class="verdict" style="color:${hue}">${esc(word)}</div>`
    + `<p class="sentence">${esc(BAND_SENTENCE[run.band] || '')}</p>`
    + '<div class="banner"><b>This is a demo, not a registry record.</b> The building below was '
    + 'invented in the browser that produced this sheet and was never submitted to any network. '
    + 'The cryptography is real; the building is not. A genuine certificate is read off the '
    + 'Midnight ledger on the Check page.</div>'
    + '<table>'
    + row('Building reference', esc(run.buildingId))
    + row('Verdict', esc(word))
    + row('Appraised value', esc(won(run.appraised)))
    + row(`Limit at ${run.safePct}%`, esc(won(String(limit))))
    + row('Caution line', `${run.cautionPct}%`)
    + row('Senior deposit total', '<span style="color:#7D8B9B">not disclosed by the proof</span>')
    + row('Commitment', esc(run.commitment || '—'))
    + row('Proofs computed', `${run.proofs.length} · ${(total / 1000).toFixed(1)}s total`)
    + row('Computed at', esc(new Date().toUTCString().replace('GMT', 'UTC')))
    + row('On chain', 'no — nothing was submitted')
    + '</table>'
    + '<h1 style="margin-bottom:10px">Proofs built for this run</h1>'
    + `<table>${proofRows}</table>`
    + `<div class="split"><div class="qr">${qrFor(url, 'Scan to run this demo yourself')}`
    + '<p>Scan to run the same<br>demo in your own browser</p></div>'
    + '<div class="notes"><h2>What the proof showed</h2><ul>'
    + '<li>Which band the building falls in</li>'
    + '<li>The appraised value and the thresholds</li>'
    + '<li>The commitment the verdict was bound to</li></ul>'
    + '<h2>What it kept hidden</h2><ul>'
    + '<li>Every individual deposit</li>'
    + '<li>The total of senior deposits</li>'
    + '<li>How many households hold leases</li>'
    + '<li>The commitment salt</li></ul>'
    + (chain && chain.contract
      ? `<h2>The real contract</h2><p style="margin:0">${esc(chain.explorer || '')}</p>`
      : '')
    + '</div></div>'
    + '<p class="foot">Every proof listed above was computed on the device that produced this '
    + 'sheet, using the same circuit and the same proving keys the registry runs. No wallet was '
    + 'connected and nothing was paid for. Because the building was invented locally, this sheet '
    + 'records a demonstration and confers nothing on anyone.'
    + (url ? `<br><br>${esc(url)}` : '') + '</p>');
}

/**
 * The document for an attempted verification: what was claimed, what the books
 * actually said, and what the contract did about it. Covers both outcomes,
 * because "the truthful figure was accepted" is the half that proves the
 * refusal means something.
 */
export function attemptDocument(att, chain) {
  const accepted = att.outcome === 'accepted';
  const truthful = !!att.truthful;
  const headline = accepted
    ? (truthful ? 'ACCEPTED' : 'ACCEPTED — UNEXPECTED')
    : 'REFUSED';
  const hue = accepted ? (truthful ? '#2F6B4F' : '#C0352B') : '#C0352B';
  const url = demoUrl();

  const sentence = accepted
    ? (truthful
      ? 'The figure entered matched the sealed books, so the circuit ran and produced a verdict.'
      : 'A figure that does not match the sealed books was accepted. This should not be possible.')
    : 'The figure entered did not match the sealed books, so no proof could be built from it.';

  return shell(`Waterline demo — verification ${headline}`,
    '<h1>Waterline — verification attempt, computed in a browser</h1>'
    + `<div class="verdict" style="color:${hue};font-size:44px">${esc(headline)}</div>`
    + `<p class="sentence">${esc(sentence)}</p>`
    + '<div class="banner"><b>This is a demo, not a registry record.</b> The building below was '
    + 'invented in the browser that produced this sheet. What is real is the circuit, the '
    + 'commitment and the refusal.</div>'
    + '<table>'
    + row('Building reference', esc(att.buildingId || '—'))
    + row('Claimed total', esc(won(att.claimedTotal)))
    + row('Total actually sealed', esc(won(att.realTotal)))
    + row('Households sealed', esc(att.count))
    + row('Appraised value', esc(won(att.appraised)))
    + row('Honest verdict', esc(BAND_WORD[att.honestBand] || '—'))
    + row('Verdict claimed figure would have given', esc(BAND_WORD[att.wouldBe] || '—'))
    + row('Commitment', esc(att.commitment || '—'))
    + row('Outcome', esc(accepted ? 'accepted by the circuit' : `refused: ${att.error || 'assert failed'}`))
    + row('Where it was decided', 'in the browser, before any proof existed')
    + row('Attempted at', esc(new Date().toUTCString().replace('GMT', 'UTC')))
    + '</table>'
    + `<div class="split"><div class="qr">${qrFor(url, 'Scan to try this yourself')}`
    + '<p>Scan to try the same<br>attempt in your own browser</p></div>'
    + '<div class="notes"><h2>Why this is the whole argument</h2><ul>'
    + '<li>The refusal is the circuit\'s, not a message written by a web page</li>'
    + '<li>It happens before a proof exists, so there is no transaction to reject</li>'
    + '<li>The truthful figure is accepted, which is what makes the refusal meaningful</li>'
    + '<li>Only someone who can open the commitment can issue a certificate at all</li></ul>'
    + (chain && chain.contract
      ? `<h2>The real contract</h2><p style="margin:0">${esc(chain.explorer || '')}</p>`
      : '')
    + '</div></div>'
    + '<p class="foot">The figure above was checked against a commitment sealed moments earlier '
    + 'in the same tab. Changing it breaks the chain, and the circuit refuses to run — which is '
    + 'the property the contract exists to provide.'
    + (url ? `<br><br>${esc(url)}` : '') + '</p>');
}

/** Save a built document as a file the visitor keeps. */
export function download(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
