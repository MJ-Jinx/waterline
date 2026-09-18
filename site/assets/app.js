/* ==========================================================================
   Waterline — behaviour
   Vanilla JS, no build step. Every controller no-ops unless its root is present,
   so one file can serve every page.
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     THE CORE CONSTRAINT
     ----------------------------------------------------------------------
     The page never knows the real senior-deposit total, so it must never
     render an exact water level. The surface is always a BAND of fixed
     height (BAND_H) with dashed edges — indeterminate surface, definite
     verdict. Do not "improve" this into a single water line.
     ====================================================================== */

  var GEO = {
    VIEWBOX: '0 0 240 372',
    X: 48, Y: 28, W: 144, H: 308,   // building rect; bottom edge = Y + H = 336
    BOTTOM: 336,
    FLOORS: [79, 130, 181, 232, 283],
    THRESHOLD: 0.70,                // load line at 70% of appraised value
    BAND_H: 36                      // the undisclosed surface, always 36 units
  };

  // y for a given fraction of the building height, measured from the base
  function yAt(fraction) { return GEO.BOTTOM - fraction * GEO.H; }

  var LOAD_LINE_Y = Math.round(yAt(GEO.THRESHOLD));   // 120

  var BANDS = {
    safe: {
      label: 'SAFE',
      color: 'var(--wl-safe)', hex: '#1F7A5C',
      bandTop: 173,                                    // ≈47% — clear of the line
      caption: 'Level: below the line',
      sentence: 'Senior deposits sit below this building’s appraisal limit.',
      alt: 'Building cross-section, safe: the water band sits below the load line'
    },
    caution: {
      label: 'CAUTION',
      color: 'var(--wl-caution)', hex: '#A8701A',
      bandTop: 102,                                    // straddles the line
      caption: 'Level: straddling the line',
      sentence: 'Senior deposits sit close to the limit. Ask before you sign.',
      alt: 'Building cross-section, caution: the water band straddles the load line'
    },
    danger: {
      label: 'DANGER',
      color: 'var(--wl-danger)', hex: '#C0352B',
      bandTop: 53,                                     // clear above the line
      caption: 'Level: above the line',
      sentence: 'Senior deposits exceed this building’s appraisal limit.',
      alt: 'Building cross-section, danger: the water band sits above the load line'
    }
  };

  var uid = 0;

  /**
   * Build the signature figure.
   * @param {string} band   'safe' | 'caution' | 'danger'
   * @param {object} opts   { animate:boolean, bracket:boolean, lineLabel:string }
   * @returns {string} SVG markup
   */
  function waterlineSVG(band, opts) {
    opts = opts || {};
    var b = BANDS[band];
    var n = ++uid;
    var hatchId = 'wl-hatch-' + n;
    var gradId  = 'wl-grad-' + n;
    var clipId  = 'wl-clip-' + n;

    var top = b.bandTop;
    var waterH = GEO.BOTTOM - 1 - top;          // fill from the band down to the base
    var bandBottom = top + GEO.BAND_H;

    // Keep the load-line label clear of both the rule and the band.
    var labelY = (band === 'danger') ? LOAD_LINE_Y + 24 : LOAD_LINE_Y - 12;
    if (band === 'caution') labelY = top - 14;

    // The mark turns navy when the band is red, so red-on-red never collides.
    // NOTE: literal hex, not var() — CSS custom properties are not reliable
    // inside SVG presentation attributes.
    var markColor = (band === 'danger') ? '#0F2A4A' : '#C0352B';

    var waterClass = opts.animate ? ' class="wl-water-anim"' : '';
    var markClass  = opts.animate ? ' class="wl-mark-anim"'  : '';

    return [
      '<svg viewBox="' + GEO.VIEWBOX + '" role="img" aria-label="' + b.alt + '">',
        '<defs>',
          '<pattern id="' + hatchId + '" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">',
            '<line x1="0" y1="0" x2="0" y2="7" stroke="' + b.hex + '" stroke-width="2.4"></line>',
          '</pattern>',
          '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">',
            '<stop offset="0%" stop-color="' + b.hex + '" stop-opacity="0"></stop>',
            '<stop offset="55%" stop-color="' + b.hex + '" stop-opacity="0.26"></stop>',
            '<stop offset="100%" stop-color="' + b.hex + '" stop-opacity="0.22"></stop>',
          '</linearGradient>',
          // keeps the water inside the shell while it rises on load
          '<clipPath id="' + clipId + '"><rect x="49" y="29" width="142" height="306"></rect></clipPath>',
        '</defs>',

        // building shell
        '<rect x="' + GEO.X + '" y="' + GEO.Y + '" width="' + GEO.W + '" height="' + GEO.H + '" ',
          'fill="#FBFAF7" stroke="#0F2A4A" stroke-width="1.5"></rect>',

        // floors
        '<g stroke="#DCD6C9" stroke-width="1">',
          GEO.FLOORS.map(function (y) {
            return '<line x1="' + GEO.X + '" y1="' + y + '" x2="' + (GEO.X + GEO.W) + '" y2="' + y + '"></line>';
          }).join(''),
        '</g>',

        // water: gradient body + hatched band + dashed edges. NO solid surface line.
        '<g' + waterClass + ' clip-path="url(#' + clipId + ')">',
          '<rect x="49" y="' + top + '" width="142" height="' + waterH + '" fill="url(#' + gradId + ')"></rect>',
          '<rect x="49" y="' + top + '" width="142" height="' + GEO.BAND_H + '" fill="url(#' + hatchId + ')" opacity="0.45"></rect>',
          '<line x1="49" y1="' + top + '" x2="191" y2="' + top + '" stroke="' + b.hex + '" stroke-width="1" stroke-dasharray="3 4" opacity="0.7"></line>',
          '<line x1="49" y1="' + bandBottom + '" x2="191" y2="' + bandBottom + '" stroke="' + b.hex + '" stroke-width="1" stroke-dasharray="3 4" opacity="0.7"></line>',
        '</g>',

        // Plimsoll mark: disc on the hull, rule across the section
        '<g' + markClass + '>',
          '<line x1="22" y1="' + LOAD_LINE_Y + '" x2="206" y2="' + LOAD_LINE_Y + '" stroke="' + markColor + '" stroke-width="2"></line>',
          '<circle cx="' + GEO.X + '" cy="' + LOAD_LINE_Y + '" r="13" fill="none" stroke="' + markColor + '" stroke-width="2"></circle>',
          '<text x="190" y="' + labelY + '" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="10" letter-spacing="0.06" fill="' + markColor + '">',
            (opts.lineLabel || 'LOAD LINE 70%'),
          '</text>',
        '</g>',

        // appraisal bracket
        opts.bracket === false ? '' :
          '<g stroke="#B9B2A6" stroke-width="1" fill="none"><path d="M 30 28 L 22 28 L 22 336 L 30 336"></path></g>' +
          '<text x="14" y="182" text-anchor="middle" transform="rotate(-90 14 182)" font-family="IBM Plex Mono, monospace" font-size="9" fill="#6B7A8C">APPRAISED VALUE</text>',
      '</svg>'
    ].join('');
  }

  /* ======================================================================
     Demo data — invented, internally consistent, clearly fictional buildings.
     Never use a real address or a district tied to a real jeonse-fraud case.
     ====================================================================== */

  var BUILDINGS = [
    {
      id: 'SEO-2019-0412', chip: 'Seocho',
      place: 'Seocho-gu, Seoul · Serim Heights, Block 102',
      appraised: '₩1,050,000,000', limit: '₩735,000,000', band: 'safe',
      hash: '0x9f4c8b21…a1e8', block: '3,417,882', issued: '18 Sep 2026, 11:04 KST'
    },
    {
      id: 'MPO-2017-0883', chip: 'Mapo',
      place: 'Mapo-gu, Seoul · Eunha Villa, Block A',
      appraised: '₩620,000,000', limit: '₩434,000,000', band: 'caution',
      hash: '0x3d71ae04…5c92', block: '3,417,601', issued: '18 Sep 2026, 09:47 KST'
    },
    {
      id: 'BCN-2014-1176', chip: 'Bucheon',
      place: 'Bucheon, Gyeonggi · Cheongnim Town, Block 3',
      appraised: '₩285,000,000', limit: '₩199,500,000', band: 'danger',
      hash: '0xc082f5d9…30b7', block: '3,416,944', issued: '17 Sep 2026, 18:22 KST'
    }
  ];

  // Each step carries its own duration, and the schedule below is derived from
  // them. Previously the durations were implicit in a hand-written offset table
  // that stopped at step 5, so the final step stayed "running" forever.
  // Step 2 (proving) is deliberately the long one — a spinner would hide the
  // single most interesting fact about the system.
  var PIPELINE = [
    { name: 'Building the contract call', detail: '5,168 B · registerLease()',              ms: 1100 },
    { name: 'Proving, locally',           detail: '2–5s · 12,904 constraints · 5.1 MB key', ms: 3100 },
    { name: 'Fee sponsored',              detail: '0.0142 tDUST · paid by the registry',    ms: 1000 },
    { name: 'Submitted to the node',      detail: '14,432 B · preprod',                     ms: 1400 },
    { name: 'Landed in a block',          detail: 'block 3,418,120 · final',                ms: 2400 }
  ];

  // Cumulative offsets from the click, so schedule and durations cannot drift.
  // Each entry advances to the NEXT step, so the final entry lands one past the
  // last step — that is what marks the whole run complete.
  var PIPELINE_TIMING = (function () {
    var out = [], t = 0;
    PIPELINE.forEach(function (s, i) { t += s.ms; out.push([t, i + 2]); });
    return out;
  })();

  var PIPELINE_TOTAL = PIPELINE.reduce(function (a, s) { return a + s.ms; }, 0);

  var ATTACK = {
    building: 'Cheongnim Town, Block 3 · Bucheon',
    appraised: '₩285,000,000',
    limitLabel: '₩199,500,000',
    commitment: '0xc082f5d9…30b7 · block 3,416,944',
    LIMIT_M: 199.5,          // limit, in millions of KRW
    MIN_M: 100, MAX_M: 285, STEP_M: 5,
    DEFAULT_M: 165,          // pre-set to a figure that flips DANGER into SAFE
    PROVE_MS: 2600
  };

  function bandForClaim(m) {
    if (m > ATTACK.LIMIT_M) return 'danger';
    if (m > ATTACK.LIMIT_M * 0.9) return 'caution';
    return 'safe';
  }

  function won(millions) {
    return '₩' + (millions * 1000000).toLocaleString('en-US');
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ======================================================================
     Landing — one static figure, animated once
     ====================================================================== */

  function initLanding() {
    var host = $('[data-wl-hero-figure]');
    if (!host) return;
    host.innerHTML = waterlineSVG('safe', { animate: true });
  }

  /* ======================================================================
     /check — the money page. Pure read: no proving, no keys, no wallet.
     ====================================================================== */

  /**
   * Certificates read off the live ledger at build time, written by
   * src/snapshot.mjs. Decoding contract state needs the compiled contract, so
   * the read happens in CI rather than here — which is what keeps this page a
   * plain static fetch with no WASM, no prover keys and no wallet.
   *
   * It is a snapshot, not a live read, so the page says so and prints the block
   * it was taken at. Missing or unreachable (opening the file over file://),
   * the page falls back to the fictional demo buildings.
   */
  function fetchSnapshot() {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch('data/certificates.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function wonFromString(raw) {
    // Raw won as a decimal string -> '₩600,000,000'
    return '₩' + String(raw).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** Turn a snapshot entry into the same shape the demo buildings use. */
  function liveToBuilding(b, snap) {
    var c = b.certificate;
    return {
      id: b.id.slice(0, 12).toUpperCase(),
      chip: b.chip || 'Live',
      place: b.label,
      live: true,
      registered: b.registered,
      band: c ? c.band : null,
      appraised: c ? wonFromString(c.appraisedValue) : '—',
      limit: c ? wonFromString(c.limit) : '—',
      hash: b.commitment ? '0x' + b.commitment.slice(0, 8) + '…' + b.commitment.slice(-4) : '—',
      fullHash: b.commitment || '',
      block: snap.block ? String(snap.block).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '—',
      issued: snap.takenAt ? new Date(snap.takenAt).toUTCString().replace('GMT', 'UTC') : '—',
      fresh: c ? c.fresh : null,
      explorer: snap.explorer,
      network: snap.network
    };
  }

  function initCheck() {
    var root = $('[data-wl-check]');
    if (!root) return;

    var els = {
      id:      $('[data-wl-id]', root),
      chips:   $('[data-wl-chips]', root),
      place:   $('[data-wl-place]', root),
      verdict: $('[data-wl-verdict]', root),
      sentence:$('[data-wl-sentence]', root),
      figure:  $('[data-wl-figure]', root),
      caption: $('[data-wl-caption]', root),
      appraised: $('[data-wl-appraised]', root),
      limit:   $('[data-wl-limit]', root),
      hash:    $('[data-wl-hash]', root),
      block:   $('[data-wl-block]', root),
      issued:  $('[data-wl-issued]', root),
      proofNote: $('[data-wl-proofnote]', root)
    };

    var list = BUILDINGS.slice();     // replaced once the snapshot resolves
    var current = 0;

    function buildChips() {
      els.chips.innerHTML = '';
      list.forEach(function (b, i) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wl-chip';
        if (b.band) btn.dataset.band = b.band;
        btn.setAttribute('aria-pressed', String(i === current));
        btn.textContent = b.chip;
        btn.addEventListener('click', function () { select(i); });
        els.chips.appendChild(btn);
      });
    }

    function select(i) {
      var b = list[i];
      current = i;

      $$('.wl-chip', els.chips).forEach(function (c, n) {
        c.setAttribute('aria-pressed', String(n === i));
      });

      if (els.id) els.id.value = b.id;
      els.place.textContent = b.place;

      // A live entry may be registered with no verdict, or not registered at
      // all. Neither is a passing result, and neither may borrow a verdict
      // colour — the absence of a verdict is not a safe one.
      if (b.live && !b.band) {
        var unknown = b.registered
          ? ['NO CERTIFICATE', 'Registered, but no verdict has been published for this building yet.']
          : ['NOT REGISTERED', 'This building has no entry in the registry. That is not the same as safe.'];
        els.verdict.textContent = unknown[0];
        els.verdict.className = 'wl-verdict wl-verdict--sm';
        els.sentence.textContent = unknown[1];
        els.figure.innerHTML = '';
        els.caption.textContent = 'No level to draw.';
      } else {
        var band = BANDS[b.band];
        els.verdict.textContent = band.label;
        els.verdict.className = 'wl-verdict wl-is-' + b.band;
        els.sentence.textContent = band.sentence;
        els.figure.innerHTML = waterlineSVG(b.band, { lineLabel: 'LOAD LINE 70%' });
        els.caption.textContent = band.caption;
      }

      els.appraised.textContent = b.appraised;
      els.limit.textContent = b.limit;
      els.hash.textContent = b.hash + ' ⧉';
      els.hash.dataset.value = b.fullHash || b.hash;
      els.block.textContent = b.block;
      els.issued.textContent = b.issued;

      var explorer = $('[data-wl-explorer]', root);
      if (explorer && b.explorer) explorer.href = b.explorer;

      var origin = $('[data-wl-origin]', root);
      if (origin) {
        origin.textContent = b.live
          ? 'Read from the Midnight ' + b.network + ' ledger'
          : 'Demo buildings are fictional';
      }

      if (els.proofNote) {
        els.proofNote.textContent = b.live
          ? 'Read from the contract’s ledger at block ' + b.block + ', snapshot taken ' +
            b.issued + '. The verdict was written on chain by the registry; this page only reads it' +
            (b.fresh === false ? ', and the books have moved since it was issued.' : '.')
          : 'Illustrative demo building. The contract and block below are real; this building is not.';
      }
    }

    if (els.hash) {
      els.hash.addEventListener('click', function () {
        var v = els.hash.dataset.value || '';
        if (navigator.clipboard) navigator.clipboard.writeText(v).catch(function () {});
      });
    }

    buildChips();
    select(0);

    // Upgrade to the real ledger read as soon as it arrives. Same-origin and
    // under a kilobyte, so in practice this lands before a first paint is
    // noticed; if it never lands, the demo buildings above stay.
    fetchSnapshot().then(function (snap) {
      if (!snap || !snap.buildings || !snap.buildings.length) return;
      var live = snap.buildings.map(function (b) { return liveToBuilding(b, snap); });
      list = live.concat(BUILDINGS);
      current = 0;
      buildChips();
      select(0);
    });
  }

  /* ======================================================================
     /registry — simulated console. The pipeline is the interesting part,
     so it gets real progress states rather than a spinner.
     ====================================================================== */

  function initRegistry() {
    var root = $('[data-wl-registry]');
    if (!root) return;

    var list   = $('[data-wl-pipeline]', root);
    var runBtn = $('[data-wl-run]', root);
    var timers = [];
    var ticker = null;

    // step 0 = idle, 1..N = that step is in flight, N+1 = the run is complete.
    // The extra terminal value is what lets the last step finish; treating
    // step === N as "done" is what left it pulsing forever.
    var DONE = PIPELINE.length + 1;
    var step = 0;
    var stepStart = 0;   // Date.now() when the in-flight step began
    var runStart = 0;    // Date.now() at the click

    function secs(ms) { return (ms / 1000).toFixed(1) + 's'; }
    function eta(ms)  { return '~' + Math.round(ms / 1000) + 's'; }

    PIPELINE.forEach(function (s, i) {
      var row = document.createElement('div');
      row.className = 'wl-step';
      row.dataset.state = 'idle';
      row.innerHTML =
        '<div class="wl-step__dot">' + (i + 1) + '</div>' +
        '<div class="wl-step__name">' + s.name + '</div>' +
        '<div class="wl-step__detail">—</div>' +
        '<div class="wl-step__status">' +
          '<span class="wl-step__state">waiting</span>' +
          // The list is aria-live; a clock ticking ten times a second would
          // flood a screen reader, so it stays out of the accessibility tree.
          '<span class="wl-step__clock" aria-hidden="true"></span>' +
        '</div>';
      list.appendChild(row);
    });

    /** Clock text for one row: estimate when waiting, elapsed vs estimate while
     *  running, and the measured duration once done. */
    function clockFor(i, state) {
      if (state === 'idle') return eta(PIPELINE[i].ms);
      if (state === 'done') return secs(PIPELINE[i].ms);
      return secs(Date.now() - stepStart) + ' / ' + eta(PIPELINE[i].ms);
    }

    /** Cheap path: only the in-flight clocks move, so do not repaint the rest. */
    function tick() {
      var row = $('.wl-step[data-state="now"]', list);
      if (row) {
        var i = $$('.wl-step', list).indexOf(row);
        $('.wl-step__clock', row).textContent = clockFor(i, 'now');
      }
      var el = $('[data-wl-elapsed]', root);
      if (el) el.textContent = secs(Date.now() - runStart) + ' / ' + eta(PIPELINE_TOTAL) + ' total';
    }

    function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

    function paint() {
      var done = step >= DONE;

      $$('.wl-step', list).forEach(function (row, i) {
        var idx = i + 1;
        var state = step > idx ? 'done' : (step === idx ? 'now' : 'idle');
        row.dataset.state = state;
        $('.wl-step__dot', row).textContent = state === 'done' ? '✓' : String(idx);
        $('.wl-step__detail', row).textContent = state === 'idle' ? '—' : PIPELINE[i].detail;
        $('.wl-step__state', row).textContent =
          state === 'done' ? 'done' : (state === 'now' ? 'running' : 'waiting');
        $('.wl-step__clock', row).textContent = clockFor(i, state);
      });

      var set = function (sel, text) { var e = $(sel, root); if (e) e.textContent = text; };

      set('[data-wl-newlease]', step === 0 ? '—' : '₩80,000,000');
      set('[data-wl-total]',    done ? '₩355,000,000' : '₩275,000,000');
      set('[data-wl-count]',    done ? '4' : '3');
      set('[data-wl-after]',    done ? '0x7a2be6f0…9d14' : 'pending');
      set('[data-wl-afterblock]', done ? 'block 3,418,120' : '—');
      set('[data-wl-bytes]',    step >= 2 ? '14,432' : '—');

      var verdict = $('[data-wl-outcome]', root);
      if (verdict) {
        verdict.textContent = done ? 'SAFE' : '—';
        verdict.className = 'wl-verdict wl-verdict--sm' + (done ? ' wl-is-safe' : '');
        if (!done) verdict.style.color = 'var(--wl-ink-idle)'; else verdict.style.color = '';
      }

      // Progress is COMPLETED steps, not the index in flight: the meter must not
      // read 100% while the final step is still working.
      var fill = $('[data-wl-meter]', root);
      if (fill) {
        var pct = (step - 1) / PIPELINE.length * 100;
        fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
      }

      set('[data-wl-phase]', step === 0
        ? 'Idle'
        : (done ? 'Complete · landed in block 3,418,120'
                : 'Step ' + step + ' of ' + PIPELINE.length + ' · ' + PIPELINE[step - 1].name));

      set('[data-wl-elapsed]', step === 0
        ? eta(PIPELINE_TOTAL) + ' total'
        : (done ? secs(PIPELINE_TOTAL) + ' total'
                : secs(Date.now() - runStart) + ' / ' + eta(PIPELINE_TOTAL) + ' total'));

      runBtn.textContent = step === 0 ? 'Register lease' : (done ? 'Run again' : 'Registering…');
      runBtn.className = 'wl-btn wl-btn--block ' +
        (step === 0 || done ? 'wl-btn--primary' : 'wl-btn--busy');
      runBtn.disabled = !(step === 0 || done);
    }

    runBtn.addEventListener('click', function () {
      timers.forEach(clearTimeout);
      timers = [];
      stopTicker();

      runStart = stepStart = Date.now();
      step = 1;
      paint();
      ticker = setInterval(tick, 100);

      PIPELINE_TIMING.forEach(function (pair) {
        timers.push(setTimeout(function () {
          step = pair[1];
          stepStart = Date.now();
          // The last entry advances past the final step, which ends the run.
          if (step >= DONE) stopTicker();
          paint();
        }, pair[0]));
      });
    });

    paint();
  }

  /* ======================================================================
     /attack — the differentiator.
     The refusal happens on the landlord's own machine, BEFORE a proof exists.
     Nothing is submitted and nothing is rejected. Keep the copy honest.
     ====================================================================== */

  function initAttack() {
    var root = $('[data-wl-attack]');
    if (!root) return;

    var slider  = $('[data-wl-claim]', root);
    var amount  = $('[data-wl-claim-amount]', root);
    var lie     = $('[data-wl-lie]', root);
    var lieAmt  = $('[data-wl-lie-amount]', root);
    var goBtn   = $('[data-wl-generate]', root);
    var panel   = $('[data-wl-result]', root);
    var views   = {
      idle:    $('[data-wl-view="idle"]', root),
      proving: $('[data-wl-view="proving"]', root),
      refused: $('[data-wl-view="refused"]', root)
    };

    var phase = 'idle';
    var timer = null;

    slider.min = ATTACK.MIN_M;
    slider.max = ATTACK.MAX_M;
    slider.step = ATTACK.STEP_M;
    slider.value = ATTACK.DEFAULT_M;

    function paint() {
      var m = Number(slider.value);
      var band = bandForClaim(m);

      amount.textContent = won(m);
      if (lieAmt) lieAmt.textContent = won(m);
      lie.textContent = BANDS[band].label;
      lie.className = 'wl-verdict wl-verdict--sm wl-is-' + band;

      Object.keys(views).forEach(function (k) {
        if (views[k]) views[k].hidden = (k !== phase);
      });

      panel.className = 'wl-card wl-card--flat' + (phase === 'refused' ? ' wl-card--danger wl-refused' : '');
      // restart the shake on each refusal
      if (phase === 'refused') {
        panel.classList.remove('wl-refused');
        void panel.offsetWidth;
        panel.classList.add('wl-refused');
      }

      goBtn.textContent = phase === 'proving' ? 'Generating proof…'
                        : (phase === 'refused' ? 'Try again' : 'Generate certificate');
      goBtn.className = 'wl-btn wl-btn--block ' + (phase === 'proving' ? 'wl-btn--busy' : 'wl-btn--danger');
      goBtn.disabled = phase === 'proving';
    }

    slider.addEventListener('input', function () {
      phase = 'idle';
      if (timer) clearTimeout(timer);
      paint();
    });

    goBtn.addEventListener('click', function () {
      if (timer) clearTimeout(timer);
      phase = 'proving';
      paint();
      timer = setTimeout(function () { phase = 'refused'; paint(); }, ATTACK.PROVE_MS);
    });

    paint();
  }

  /* ======================================================================
     Documentation page: render one figure per band
     ====================================================================== */

  function initGallery() {
    $$('[data-wl-band]').forEach(function (host) {
      host.innerHTML = waterlineSVG(host.dataset.wlBand, { lineLabel: 'LIMIT 70%', bracket: false });
    });
  }

  /* ====================================================================== */

  function boot() {
    initLanding();
    initCheck();
    initRegistry();
    initAttack();
    initGallery();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Exposed for reuse / testing
  window.Waterline = {
    GEO: GEO, BANDS: BANDS, BUILDINGS: BUILDINGS,
    PIPELINE: PIPELINE, PIPELINE_TIMING: PIPELINE_TIMING, ATTACK: ATTACK,
    waterlineSVG: waterlineSVG, bandForClaim: bandForClaim, won: won,
    LOAD_LINE_Y: LOAD_LINE_Y
  };
})();
