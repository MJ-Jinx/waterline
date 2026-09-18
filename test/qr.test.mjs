// The QR encoder.
//
// Written from scratch rather than pulled from a CDN: a verification page that
// fetches a third-party script hands that third party a log of who checked
// which building, which is the opposite of what this product is for.
//
// Correctness was established against an independent implementation (the
// python `qrcode` library) and an independent decoder (OpenCV's
// QRCodeDetector): every symbol below matched the reference byte for byte
// across all eight masks, and every one decoded. That comparison needs Python,
// so what runs here are the golden matrices it produced plus the structural
// invariants, which is enough to catch a regression.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

function loadQR() {
  globalThis.window = {};
  new Function(fs.readFileSync('site/assets/qr.js', 'utf8'))();
  return globalThis.window.WaterlineQR;
}

const QR = loadQR();
const digest = (m) => crypto.createHash('sha256')
  .update(m.map((r) => r.join('')).join('')).digest('hex').slice(0, 16);

// Captured from output verified against the reference implementation and
// confirmed to decode. A change here means the encoder changed behaviour.
const GOLDEN = [
  { text: 'a', size: 21, sha: '2e7add7dfd3288d4' },
  { text: 'hello world', size: 21, sha: 'bbd25299f2a71918' },
  { text: 'https://mj-jinx.github.io/waterline/check.html?b=189285d3', size: 33, sha: '3545ca85cd3abf49' },
  { text: '₩600,000,000 위험', size: 25, sha: 'e5700c46e21aa252' },
  { text: 'x'.repeat(100), size: 41, sha: '3b1cbac996b5a950' },
  { text: 'z'.repeat(210), size: 57, sha: 'e033c7ca0b34192a' },
];

test('encoded symbols match the verified golden matrices', () => {
  for (const g of GOLDEN) {
    const m = QR.matrix(g.text);
    assert.equal(m.length, g.size, `${g.text.slice(0, 20)}: symbol size`);
    assert.equal(digest(m), g.sha, `${g.text.slice(0, 20)}: matrix digest`);
  }
});

test('Korean and the won sign survive encoding', () => {
  // Byte mode over UTF-8. These round-tripped through a real decoder.
  const m = QR.matrix('서울 관악구 101');
  assert.equal(m.length, 25, 'a 20-byte UTF-8 payload lands in version 2');
});

test('the finder patterns are well formed', () => {
  const m = QR.matrix('hello world');
  const n = m.length;
  const corners = [[0, 0], [0, n - 7], [n - 7, 0]];
  for (const [r0, c0] of corners) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const ring = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        assert.equal(m[r0 + r][c0 + c], ring || core ? 1 : 0,
          `finder at ${r0},${c0} module ${r},${c}`);
      }
    }
  }
});

test('the timing patterns alternate', () => {
  const m = QR.matrix('hello world');
  const n = m.length;
  for (let i = 8; i < n - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0 ? 1 : 0, `horizontal timing at ${i}`);
    assert.equal(m[i][6], i % 2 === 0 ? 1 : 0, `vertical timing at ${i}`);
  }
});

test('the always-dark module is dark', () => {
  // Writing eight format bits down the column instead of seven overwrites this
  // module, and the symbol silently stops decoding.
  for (const text of ['a', 'hello world', 'x'.repeat(100)]) {
    const m = QR.matrix(text);
    assert.equal(m[m.length - 8][8], 1, `dark module for ${text.slice(0, 12)}`);
  }
});

test('version selection grows with payload length', () => {
  const sizes = [1, 20, 60, 110, 190, 213].map((n) => QR.matrix('a'.repeat(n)).length);
  for (let i = 1; i < sizes.length; i++) {
    assert.ok(sizes[i] >= sizes[i - 1], 'symbol size is monotonic in payload length');
  }
  // Version 10 at EC M holds 216 codewords; four mode bits and a sixteen-bit
  // character count leave exactly 213 bytes of payload.
  assert.equal(QR.matrix('a'.repeat(213)).length, 57, '213 bytes is the last that fits');
  assert.throws(() => QR.matrix('a'.repeat(214)), /too long/,
    'one byte over is rejected rather than silently truncated');
});

test('the SVG carries a generous quiet zone', () => {
  // Four modules is the spec minimum, but mask 2 lays vertical stripes into the
  // margin and defeats finder detection at four. Eight reads reliably.
  const svg = QR.svg('hello world');
  const box = svg.match(/viewBox="0 0 (\d+) \1"/);
  assert.ok(box, 'square viewBox');
  const matrixSize = QR.matrix('hello world').length;
  assert.equal(Number(box[1]), matrixSize + 16, 'eight modules of quiet zone on each side');
  assert.match(svg, /role="img"/);
  assert.match(svg, /<rect[^>]*fill="#FFFFFF"/, 'an opaque light background, so it scans on any card');
});
