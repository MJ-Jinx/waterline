// The Full Demo page controller.
//
// Orchestrates the worker, narrates what is happening, and — this is the part
// that matters for a visitor who has never met a zero-knowledge proof — says
// what is coming NEXT before each wait, so a thirty-second pause reads as
// progress rather than a hang.

const $ = (sel, root) => (root || document).querySelector(sel);

const EOK = 100000000n;
const eok = (n) => `₩${(Number(n) / 1e8).toFixed(1)}억`;
const BANDS = ['danger', 'caution', 'safe'];
const BAND_KO = { danger: '위험 DANGER', caution: '주의 CAUTION', safe: '안전 SAFE' };

/** The books this run will invent. Chosen to land on SAFE at the given value. */
const SCRIPT = {
  leases: [String(25n * EOK / 10n), String(25n * EOK / 10n)], // 2.5억 + 2.5억
  appraised: String(8n * EOK),                                // 8.0억 -> 안전 SAFE
  safePct: '70',
  cautionPct: '80',
};

// The cheat explorer uses the SAME books against a LOWER valuation, so the
// honest answer is 위험 DANGER and understating actually buys the registry
// something. Against the 8.0억 above the building is already safe, which made
// the lie pointless and the narration nonsense: it claimed a smaller total
// "would make the building look safe" when it already was.
//
//   5.0억 of deposits vs 6.0억 valuation -> 70% limit is 4.2억 -> DANGER
//   claim 3.0억                          -> 3.0 <= 4.2        -> would read SAFE
const FORGE_SCRIPT = { ...SCRIPT, appraised: String(6n * EOK) };

/**
 * What to say, and — the important half — what to say is coming next.
 * `next` is shown while the step is still running.
 */
const NARRATION = {
  openBuilding: {
    title: 'Opening the building',
    what: 'The registry creates an entry for a building. The running total of deposits starts at zero, and even that zero is sealed rather than written down in the open.',
    why: 'Nothing here is a database record anyone can read. What goes on the public ledger is a sealed code, a commitment, and nothing else.',
    next: 'Next: the first tenant’s deposit gets added to the sealed total.',
  },
  registerLease: {
    title: 'Adding a deposit',
    what: 'A tenant signs, and their deposit joins the running total. To write the new seal, the registry has to open the old one first.',
    why: 'That is the tally stick. Each entry is chained to the one before it, so the registry cannot quietly rewrite history. It would have to have lied consistently, from the very first tenant, and every one of them holds a matching half.',
    next: 'Next: another deposit, or the verdict.',
  },
  issueCertificate: {
    title: 'Working out the verdict',
    what: 'The registry proves that the hidden total sits on one side of a line drawn from the building’s valuation, and publishes only which side.',
    why: 'This is the whole point. The proof is built from the deposit total, the number of tenants and the secret that seals them. None of those leave this tab. What comes out is one word.',
    next: 'Next: the verdict, and the document you can keep.',
  },
};

function fmtBytes(n) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export function initDemo() {
  const root = $('[data-demo]');
  if (!root) return;

  const runBtn = $('[data-demo-run]', root);
  const stage = $('[data-demo-stage]', root);
  const log = $('[data-demo-log]', root);
  const statusEl = $('[data-demo-status]', root);
  const nextEl = $('[data-demo-next]', root);
  const resultEl = $('[data-demo-result]', root);
  const barEl = $('[data-demo-bar]', root);

  let worker = null;
  let leaseSeen = 0;
  const started = Date.now();

  const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };
  const setNext = (t) => {
    if (!nextEl) return;
    nextEl.textContent = t || '';
    nextEl.style.display = t ? '' : 'none';
  };
  const setBar = (pct) => { if (barEl) barEl.style.width = `${Math.max(0, Math.min(100, pct))}%`; };

  function entry(title, body, tone) {
    if (!log) return null;
    const li = document.createElement('li');
    li.className = `d-entry${tone ? ` d-entry--${tone}` : ''}`;
    const h = document.createElement('h3');
    h.textContent = title;
    li.appendChild(h);
    if (body) {
      const p = document.createElement('p');
      p.textContent = body;
      li.appendChild(p);
    }
    // Newest at the top: during a run the interesting line is the one that just
    // landed, and appending pushed it below the fold on a phone.
    log.insertBefore(li, log.firstChild);
    li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return li;
  }

  function addNote(li, text, cls) {
    if (!li) return;
    const p = document.createElement('p');
    p.className = cls || 'd-note';
    p.textContent = text;
    li.appendChild(p);
  }

  // Progress is by proof, not by time: 4 proofs for the scripted run.
  const TOTAL_PROOFS = 1 + SCRIPT.leases.length + 1;
  let proofsDone = 0;
  let currentEntry = null;
  let honestBand = 0;

  // Every run has to come back through here. The forgery path used to end on a
  // 'forge' message and nothing else, so the button sat disabled reading
  // "Running…" and the status line kept saying it was still fetching keys.
  function finish(statusText, label) {
    setStatus(statusText);
    if (runBtn) { runBtn.disabled = false; runBtn.textContent = label || 'Run it again'; }
    if (forgeBtn) { forgeBtn.disabled = false; forgeBtn.textContent = 'Try the lie'; }
  }

  function onMessage(msg) {
    if (msg.type === 'download') {
      // A total only arrives when the server gave a credible one; see the note
      // in worker.js on why a percentage cannot be assumed.
      setStatus(msg.total
        ? `Downloading proving keys: ${fmtBytes(msg.got)} of ${fmtBytes(msg.total)}`
        : `Downloading proving keys: ${fmtBytes(msg.got)} so far`);
      return;
    }

    if (msg.type === 'building') {
      entry('A building, invented on the spot',
        'This tab just made up a building and a set of private books for it. Nothing was fetched and nothing was pre-baked, which is why the proof below is being computed rather than replayed.');
      return;
    }

    if (msg.type === 'step') {
      const n = NARRATION[msg.name];
      if (msg.phase === 'executing') {
        const title = msg.name === 'registerLease'
          ? `${n.title} ${leaseSeen + 1} of ${SCRIPT.leases.length}`
          : n.title;
        currentEntry = entry(title, n.what);
        addNote(currentEntry, n.why);
        setStatus('Running the calculation…');
      } else if (msg.phase === 'proving') {
        setStatus('Proving. This is real cryptography, and it takes a moment…');
        setNext(msg.name === 'registerLease' && leaseSeen + 1 < SCRIPT.leases.length
          ? 'Next: another deposit joins the sealed total.'
          : NARRATION[msg.name].next);
        addNote(currentEntry, 'Building the proof…', 'd-note d-note--working');
      } else if (msg.phase === 'proved') {
        proofsDone += 1;
        setBar((proofsDone / TOTAL_PROOFS) * 100);
        const working = currentEntry && currentEntry.querySelector('.d-note--working');
        if (working) working.remove();
        addNote(currentEntry,
          `Proved in ${(msg.ms / 1000).toFixed(1)}s: a ${msg.proofBytes.toLocaleString()}-byte proof from a ${msg.preimageBytes}-byte statement.`,
          'd-note d-note--ok');
        if (msg.commitment) {
          addNote(currentEntry, `Sealed code now: ${msg.commitment.slice(0, 24)}…`, 'd-note d-hash');
        }
        if (msg.name === 'registerLease') leaseSeen += 1;
      } else if (msg.phase === 'refused') {
        addNote(currentEntry, `The calculation refused to run: ${msg.error}`, 'd-note d-note--bad');
      }
      return;
    }

    if (msg.type === 'done') {
      setBar(100);
      setNext('');
      const band = BANDS[msg.band] || 'danger';
      const li = entry('The verdict', 'One word goes on the public record. Everything else stays behind the seal.');
      addNote(li, `Verdict: ${BAND_KO[band]}`, `d-note d-verdict d-verdict--${band}`);
      addNote(li,
        `For comparison, here is what this tab knew and never published: ${eok(BigInt(msg.books.total))} across ${msg.books.count} tenants. On the real site that number exists only on the registry’s own machine.`,
        'd-note');
      if (resultEl) {
        resultEl.hidden = false;
        resultEl.dataset.band = band;
        const v = $('[data-demo-verdict]', resultEl);
        if (v) { v.textContent = BAND_KO[band]; v.className = `d-big d-big--${band}`; }
      }
      finish(`Done in ${Math.round((Date.now() - started) / 1000)}s`);
      return;
    }

    if (msg.type === 'forge') {
      if (msg.phase === 'honest') {
        honestBand = msg.band;
        entry('First, the truth',
          `With the real books of ${eok(SCRIPT.leases.reduce((a, l) => a + BigInt(l), 0n))} against a `
          + `${eok(msg.appraised)} valuation, the honest answer is ${BAND_KO[BANDS[msg.band]]}.`);
      } else if (msg.phase === 'refused') {
        const claimed = eok(msg.claimedTotal);
        const li = entry('Now the lie', msg.wouldBe > honestBand
          ? `The same registry claims ${claimed} instead, which would have read ${BAND_KO[BANDS[msg.wouldBe]]}.`
          : `The same registry claims ${claimed} instead, a figure it never sealed.`);
        addNote(li, `Refused: ${msg.error}`, 'd-note d-note--bad');
        finish('The lie was refused');
        addNote(li,
          'Note where that happened: in your browser, before any proof existed. There was no transaction for anyone to reject, because no valid proof can be built from a false total in the first place.',
          'd-note');
      } else if (msg.phase === 'accepted') {
        const li = entry('Now the lie', 'The contract accepted a false opening.');
        addNote(li, 'This should be impossible. If you are seeing it, the contract has a bug and we would like to know.', 'd-note d-note--bad');
        finish('A false opening was accepted');
      }
      return;
    }

    if (msg.type === 'error') {
      setNext('');
      const li = entry('Stopped', msg.error);
      addNote(li, 'The three buildings on the Check page are on the real network and unaffected by this.', 'd-note');
      finish('Something went wrong', 'Try again');
    }
  }

  function start(op, extra) {
    if (worker) worker.terminate();
    if (log) log.innerHTML = '';
    if (resultEl) resultEl.hidden = true;
    proofsDone = 0;
    leaseSeen = 0;
    setBar(0);
    if (stage) stage.hidden = false;
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = 'Running…'; }
    if (forgeBtn) { forgeBtn.disabled = true; forgeBtn.textContent = 'Working…'; }
    setStatus('Starting the proving engine…');

    const job = { op, assetBase: document.baseURI, ...SCRIPT, ...(extra || {}) };

    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const m = ev.data || {};
      // WAIT FOR 'ready' BEFORE SENDING THE JOB. The wasm glue uses top-level
      // await, which makes the worker module async — and a message posted
      // before the module finishes evaluating is dropped, not queued. Posting
      // immediately after `new Worker` therefore did nothing at all: the
      // module loaded, both wasm files fetched, and then silence, because the
      // only message ever sent had already been thrown away.
      if (m.type === 'ready') {
        setStatus('Proving engine ready. Fetching keys…');
        worker.postMessage(job);
        return;
      }
      if (m.type === 'ack') return;
      onMessage(m);
    };
    worker.onerror = (e) => onMessage({ type: 'error', error: e.message || 'worker failed to start' });
  }

  if (runBtn) runBtn.addEventListener('click', () => start('run'));

  const forgeBtn = $('[data-demo-forge]', root);
  if (forgeBtn) {
    forgeBtn.addEventListener('click', () => {
      const input = $('[data-demo-claim]', root);
      const claimEok = Number(input && input.value) || 3;
      start('forge', {
        ...FORGE_SCRIPT,
        claimedTotal: String(BigInt(Math.round(claimEok * 10)) * (EOK / 10n)),
      });
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDemo);
} else {
  initDemo();
}
