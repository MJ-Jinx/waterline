/* ==========================================================================
   Waterline — a self-contained QR encoder (Model 2, byte mode, EC level M)

   Deliberately dependency-free. This is a privacy product, and the page that
   issues a verification document is the last place to pull a third-party
   script from a CDN: that hands the CDN a log of who checked which building.
   Everything below is plain ES5 and runs offline.

   Supports versions 1-10, which covers ~216 bytes at EC M — far more than the
   verification URL needs, with enough redundancy to survive a printed page.

   Exposes: window.WaterlineQR.matrix(text) -> array of arrays of 0|1
            window.WaterlineQR.svg(text, opts) -> SVG string
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- GF(256) */
  // Field arithmetic for Reed-Solomon, primitive polynomial 0x11D.
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  /** Generator polynomial for `degree` error-correction codewords. */
  function rsGenerator(degree) {
    var poly = [1];
    for (var d = 0; d < degree; d++) {
      var next = new Array(poly.length + 1).fill(0);
      // Multiplying by (x + α^d): the x term shifts a coefficient up a degree,
      // the constant term scales it. Swapping these builds the generator
      // reversed, which still produces plausible-looking output that no
      // scanner can read.
      for (var i = 0; i < poly.length; i++) {
        next[i] ^= poly[i];
        next[i + 1] ^= gfMul(poly[i], EXP[d]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var rem = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ rem[0];
      rem.shift();
      rem.push(0);
      for (var j = 0; j < ecLen; j++) rem[j] ^= gfMul(gen[j + 1], factor);
    }
    return rem;
  }

  /* ------------------------------------------------------- version tables */
  // EC level M only. Per version: [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data]
  var EC_M = {
    1:  [10, 1, 16, 0, 0],
    2:  [16, 1, 28, 0, 0],
    3:  [26, 1, 44, 0, 0],
    4:  [18, 2, 32, 0, 0],
    5:  [24, 2, 43, 0, 0],
    6:  [16, 4, 27, 0, 0],
    7:  [18, 4, 31, 0, 0],
    8:  [22, 2, 38, 2, 39],
    9:  [22, 3, 36, 2, 37],
    10: [26, 4, 43, 1, 44]
  };

  // Centres of the alignment patterns, per version.
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  function dataCapacity(version) {
    var t = EC_M[version];
    return t[1] * t[2] + t[3] * t[4];
  }

  /* -------------------------------------------------------------- BCH bits */
  function bchRemainder(value, generator, bits) {
    var g = generator, gBits = 0, t = g;
    while (t) { gBits++; t >>= 1; }
    var v = value << (gBits - 1);
    var vBits = 0; t = v;
    while (t) { vBits++; t >>= 1; }
    while (vBits >= gBits) {
      v ^= g << (vBits - gBits);
      vBits = 0; t = v;
      while (t) { vBits++; t >>= 1; }
    }
    return v & ((1 << (gBits - 1)) - 1);
  }

  /** 15-bit format information for EC level M and the given mask. */
  function formatBits(mask) {
    var data = (0x00 << 3) | mask;              // EC M is 00
    var bits = (data << 10) | bchRemainder(data, 0x537, 10);
    return bits ^ 0x5412;                        // spec-mandated mask
  }

  /** 18-bit version information, versions 7 and up. */
  function versionBits(version) {
    return (version << 12) | bchRemainder(version, 0x1f25, 12);
  }

  /* ------------------------------------------------------------- encoding */
  function toUtf8(text) {
    var out = [], s = unescape(encodeURIComponent(text));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
    return out;
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= 10; v++) {
      var countBits = v < 10 ? 8 : 16;
      var needed = 4 + countBits + byteLen * 8;
      if (needed <= dataCapacity(v) * 8) return v;
    }
    throw new Error('QR payload too long for versions 1-10: ' + byteLen + ' bytes');
  }

  function buildCodewords(bytes, version) {
    var countBits = version < 10 ? 8 : 16;
    var bits = [];
    function push(value, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
    }

    push(0b0100, 4);                    // byte mode
    push(bytes.length, countBits);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var capacityBits = dataCapacity(version) * 8;
    push(0, Math.min(4, capacityBits - bits.length));        // terminator
    while (bits.length % 8 !== 0) bits.push(0);              // byte align

    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[b + k];
      data.push(v);
    }
    var pad = [0xec, 0x11], p = 0;
    while (data.length < dataCapacity(version)) data.push(pad[p++ % 2]);
    return data;
  }

  /** Split into blocks, add EC, then interleave as the spec requires. */
  function interleave(data, version) {
    var t = EC_M[version];
    var ecLen = t[0], g1 = t[1], g1d = t[2], g2 = t[3], g2d = t[4];

    var blocks = [], ecBlocks = [], offset = 0, i;
    for (i = 0; i < g1; i++) { blocks.push(data.slice(offset, offset + g1d)); offset += g1d; }
    for (i = 0; i < g2; i++) { blocks.push(data.slice(offset, offset + g2d)); offset += g2d; }
    for (i = 0; i < blocks.length; i++) ecBlocks.push(rsEncode(blocks[i], ecLen));

    var out = [], maxData = Math.max(g1d, g2d), j;
    for (i = 0; i < maxData; i++) {
      for (j = 0; j < blocks.length; j++) if (i < blocks[j].length) out.push(blocks[j][i]);
    }
    for (i = 0; i < ecLen; i++) {
      for (j = 0; j < ecBlocks.length; j++) out.push(ecBlocks[j][i]);
    }
    return out;
  }

  /* --------------------------------------------------------------- matrix */
  function emptyMatrix(size) {
    var m = [], reserved = [];
    for (var r = 0; r < size; r++) {
      m.push(new Array(size).fill(0));
      reserved.push(new Array(size).fill(false));
    }
    return { m: m, reserved: reserved };
  }

  function placeFinder(g, row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= g.m.length || cc >= g.m.length) continue;
        var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                 (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                 (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        g.m[rr][cc] = on ? 1 : 0;
        g.reserved[rr][cc] = true;
      }
    }
  }

  function placeAlignment(g, version) {
    var centres = ALIGN[version], size = g.m.length;
    for (var a = 0; a < centres.length; a++) {
      for (var b = 0; b < centres.length; b++) {
        var row = centres[a], col = centres[b];
        // Skip the three corners already occupied by finder patterns.
        if ((row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8)) continue;
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            g.m[row + r][col + c] = (Math.max(Math.abs(r), Math.abs(c)) !== 1) ? 1 : 0;
            g.reserved[row + r][col + c] = true;
          }
        }
      }
    }
  }

  function placeTiming(g) {
    var size = g.m.length;
    for (var i = 8; i < size - 8; i++) {
      var on = (i % 2 === 0) ? 1 : 0;
      g.m[6][i] = on; g.reserved[6][i] = true;
      g.m[i][6] = on; g.reserved[i][6] = true;
    }
  }

  function reserveFormat(g, version) {
    var size = g.m.length, i;
    for (i = 0; i <= 8; i++) {
      if (i !== 6) { g.reserved[8][i] = true; g.reserved[i][8] = true; }
    }
    for (i = 0; i < 8; i++) {
      g.reserved[8][size - 1 - i] = true;
      g.reserved[size - 1 - i][8] = true;
    }
    g.m[size - 8][8] = 1;                 // the always-dark module
    g.reserved[size - 8][8] = true;
    if (version >= 7) {
      for (i = 0; i < 6; i++) {
        for (var j = 0; j < 3; j++) {
          g.reserved[i][size - 11 + j] = true;
          g.reserved[size - 11 + j][i] = true;
        }
      }
    }
  }

  function placeData(g, codewords) {
    var size = g.m.length, bitIndex = 0, upward = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;                        // skip the vertical timing line
      for (var n = 0; n < size; n++) {
        var row = upward ? size - 1 - n : n;
        for (var k = 0; k < 2; k++) {
          var c = col - k;
          if (g.reserved[row][c]) continue;
          var bit = 0;
          if (bitIndex < codewords.length * 8) {
            bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
          }
          g.m[row][c] = bit;
          bitIndex++;
        }
      }
      upward = !upward;
    }
  }

  function maskFn(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  }

  function applyMask(g, mask) {
    var out = g.m.map(function (row) { return row.slice(); });
    for (var r = 0; r < out.length; r++) {
      for (var c = 0; c < out.length; c++) {
        if (!g.reserved[r][c] && maskFn(mask, r, c)) out[r][c] ^= 1;
      }
    }
    return out;
  }

  function writeFormat(m, mask) {
    var size = m.length, bits = formatBits(mask), i;
    // Copy 1, around the top-left finder.
    for (i = 0; i <= 5; i++) m[8][i] = (bits >> (14 - i)) & 1;
    m[8][7] = (bits >> 8) & 1;
    m[8][8] = (bits >> 7) & 1;
    m[7][8] = (bits >> 6) & 1;
    for (i = 9; i <= 14; i++) m[14 - i][8] = (bits >> (14 - i)) & 1;
    // Copy 2, split between the other two finders: SEVEN modules down the
    // column, then EIGHT along the row. Taking eight down the column overwrites
    // the always-dark module at (size-8, 8) and the symbol stops decoding.
    for (i = 0; i <= 6; i++) m[size - 1 - i][8] = (bits >> (14 - i)) & 1;
    for (i = 7; i <= 14; i++) m[8][size - 15 + i] = (bits >> (14 - i)) & 1;
  }

  function writeVersion(m, version) {
    if (version < 7) return;
    var size = m.length, bits = versionBits(version);
    for (var i = 0; i < 18; i++) {
      var bit = (bits >> i) & 1;
      var r = Math.floor(i / 3), c = i % 3;
      m[r][size - 11 + c] = bit;
      m[size - 11 + c][r] = bit;
    }
  }

  /* --------------------------------------------------------- mask penalty */
  function penalty(m) {
    var size = m.length, score = 0, r, c, i;

    // Rule 1: runs of five or more identical modules.
    for (i = 0; i < size; i++) {
      var runRow = 1, runCol = 1;
      for (var k = 1; k < size; k++) {
        runRow = (m[i][k] === m[i][k - 1]) ? runRow + 1 : 1;
        if (runRow === 5) score += 3; else if (runRow > 5) score += 1;
        runCol = (m[k][i] === m[k - 1][i]) ? runCol + 1 : 1;
        if (runCol === 5) score += 3; else if (runCol > 5) score += 1;
      }
    }

    // Rule 2: 2x2 blocks of one colour.
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }

    // Rule 3: finder-like patterns in any row or column.
    var p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function matches(get, start, pat) {
      for (var j = 0; j < 11; j++) if (get(start + j) !== pat[j]) return false;
      return true;
    }
    for (i = 0; i < size; i++) {
      for (var s = 0; s + 11 <= size; s++) {
        var row = (function (idx) { return m[i][idx]; });
        var col = (function (idx) { return m[idx][i]; });
        if (matches(row, s, p1) || matches(row, s, p2)) score += 40;
        if (matches(col, s, p1) || matches(col, s, p2)) score += 40;
      }
    }

    // Rule 4: deviation from an even split of dark and light.
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) dark += m[r][c];
    var percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  }

  /* ------------------------------------------------------------------ API */
  function matrix(text, opts) {
    opts = opts || {};
    var bytes = toUtf8(text);
    var version = pickVersion(bytes.length);
    var size = version * 4 + 17;

    var g = emptyMatrix(size);
    placeFinder(g, 0, 0);
    placeFinder(g, 0, size - 7);
    placeFinder(g, size - 7, 0);
    placeAlignment(g, version);
    placeTiming(g);
    reserveFormat(g, version);
    placeData(g, interleave(buildCodewords(bytes, version), version));

    // opts.mask forces a specific mask; used by the test suite to compare
    // against a reference implementation without mask choice as a variable.
    var best = null, bestScore = Infinity;
    var from = opts.mask == null ? 0 : opts.mask;
    var to = opts.mask == null ? 7 : opts.mask;
    for (var mask = from; mask <= to; mask++) {
      var candidate = applyMask(g, mask);
      writeFormat(candidate, mask);
      writeVersion(candidate, version);
      var s = penalty(candidate);
      if (s < bestScore) { bestScore = s; best = candidate; }
    }
    return best;
  }

  /**
   * Render as SVG. `quiet` is the mandatory light border — four modules is the
   * spec minimum and scanners genuinely need it.
   */
  function svg(text, opts) {
    opts = opts || {};
    var m = matrix(text);
    // Eight modules, not the spec minimum of four. Mask 2 lays down vertical
    // stripes that can run into the margin and defeat finder detection at four;
    // measured against OpenCV, four fails on exactly those symbols and eight
    // reads every one. On a printed page the extra margin costs nothing.
    var quiet = opts.quiet == null ? 8 : opts.quiet;
    var size = m.length + quiet * 2;
    var dark = opts.dark || '#14243A';
    var light = opts.light || '#FFFFFF';

    var path = [];
    for (var r = 0; r < m.length; r++) {
      for (var c = 0; c < m.length; c++) {
        if (m[r][c]) path.push('M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" ' +
           'shape-rendering="crispEdges" role="img" aria-label="' +
           (opts.label || 'QR code linking to this verification') + '">' +
           '<rect width="' + size + '" height="' + size + '" fill="' + light + '"></rect>' +
           '<path d="' + path.join('') + '" fill="' + dark + '"></path></svg>';
  }

  window.WaterlineQR = { matrix: matrix, svg: svg };
})();
