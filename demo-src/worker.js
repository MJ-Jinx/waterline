// The proving worker.
//
// Everything here is real: real circuit execution, real Plonk proofs, real
// asserts. What is invented is the BOOKS — this worker plays the registry over
// deposits it makes up locally, because the registry is the only party that may
// hold them. A tenant's browser proving `issueCertificate` would mean the
// tenant was holding the landlord's private ledger, which is the exact thing
// the contract exists to prevent.
//
// It runs in a worker because proving takes tens of seconds of solid WASM. On
// the main thread that is a frozen tab, which reads as "broken" rather than
// "working hard".

import * as rt from '@midnight-ntwrk/compact-runtime';
import { prove } from '@midnight-ntwrk/zkir-v2';
import { Contract, ledger } from '../build/waterline/contract/index.js';

const COIN = '0'.repeat(64);
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

// Where the key material lives. Resolved against a base the page passes in,
// NOT against this file: a bundled worker is served from assets/demo/, so a
// relative fetch here would look for the keys underneath that directory
// instead of at the site root.
let BASE = './';
const ASSETS = {
  key: (n) => new URL(`zk/${n}.prover`, BASE).href,
  ver: (n) => new URL(`zk/${n}.verifier`, BASE).href,
  ir: (n) => new URL(`zk/${n}.bzkir`, BASE).href,
  params: (k) => new URL(`params/bls_midnight_2p${k}`, BASE).href,
};

const post = (msg) => self.postMessage(msg);

// Cache aggressively: the prover keys are 11 MB and the SRS 4.5 MB, and a run
// touches registerLease's key three times.
const cache = new Map();
async function bytes(url) {
  if (cache.has(url)) return cache.get(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not load ${url} (${r.status})`);
  const total = Number(r.headers.get('content-length') || 0);
  // Stream so the page can show progress on the big files rather than sitting
  // silent for several seconds on a phone connection.
  const reader = r.body?.getReader?.();
  let out;
  if (reader && total) {
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      post({ type: 'download', url, got, total });
    }
    out = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
  } else {
    out = new Uint8Array(await r.arrayBuffer());
  }
  cache.set(url, out);
  return out;
}

const kmProvider = {
  async lookupKey(loc) {
    const name = String(loc).replace(/^.*\//, '');
    try {
      const [proverKey, verifierKey, ir] = await Promise.all([
        bytes(ASSETS.key(name)), bytes(ASSETS.ver(name)), bytes(ASSETS.ir(name)),
      ]);
      return { proverKey, verifierKey, ir };
    } catch {
      return undefined;
    }
  },
  getParams: (k) => bytes(ASSETS.params(k)),
};

/** A registry that keeps its books in this tab and nowhere else. */
function makeRegistry() {
  const sk = rand(32);
  let nextSalt = rand(32);
  let forge = null;
  const books = new Map();
  const book = (id) => {
    const k = hex(id);
    if (!books.has(k)) books.set(k, { total: 0n, count: 0n, salt: new Uint8Array(32), liens: 0n });
    return books.get(k);
  };

  const contract = new Contract({
    registry_secret_key: (ctx) => [ctx.privateState, new Uint8Array(sk)],
    building_opening: (ctx, id) => [ctx.privateState, forge ?? { total: book(id).total, count: book(id).count }],
    building_salt: (ctx, id) => [ctx.privateState, book(id).salt],
    fresh_salt: (ctx) => [ctx.privateState, new Uint8Array(nextSalt)],
    senior_liens: (ctx, id) => [ctx.privateState, book(id).liens],
  });

  const address = rt.sampleContractAddress();
  let state = contract.initialState(rt.createConstructorContext({}, COIN)).currentContractState;

  return {
    book,
    setForge: (v) => { forge = v; },
    rollSalt: () => { nextSalt = rand(32); },
    commitSalt: (id) => { book(id).salt = new Uint8Array(nextSalt); },
    commitment: (id) => {
      const l = ledger(state.data ?? state);
      return l.buildingState.member(id) ? hex(l.buildingState.lookup(id)) : null;
    },
    /** Execute a circuit. Throws exactly what the circuit throws. */
    execute(name, ...args) {
      const ctx = rt.createCircuitContext(address, COIN, state, {});
      const res = contract.impureCircuits[name](ctx, ...args);
      state = res.context.currentQueryContext.state;
      return res;
    },
    /** Turn an executed circuit into a real proof. */
    async proveOf(name, res) {
      const pd = res.proofData;
      const preimage = rt.proofDataIntoSerializedPreimage(
        pd.input, pd.output, pd.publicTranscript, pd.privateTranscriptOutputs, name,
      );
      const started = Date.now();
      const proof = await prove(preimage, kmProvider);
      return { proof, preimageBytes: preimage.length, proofBytes: proof.length, ms: Date.now() - started };
    },
  };
}

async function runFullDemo({ leases, appraised, safePct, cautionPct }) {
  const reg = makeRegistry();
  const id = rand(32);
  post({ type: 'building', id: hex(id) });

  const step = async (name, label, args) => {
    post({ type: 'step', name, phase: 'executing', label });
    let res;
    try {
      res = reg.execute(name, ...args);
    } catch (e) {
      post({ type: 'step', name, phase: 'refused', error: String(e?.message ?? e) });
      throw e;
    }
    post({ type: 'step', name, phase: 'proving', label });
    const p = await reg.proveOf(name, res);
    post({
      type: 'step', name, phase: 'proved',
      proofBytes: p.proofBytes, preimageBytes: p.preimageBytes, ms: p.ms,
      commitment: reg.commitment(id),
    });
    return res.result;
  };

  reg.rollSalt();
  await step('openBuilding', 'Opening the building', [id]);
  reg.commitSalt(id);

  for (let i = 0; i < leases.length; i += 1) {
    const amount = BigInt(leases[i]);
    reg.rollSalt();
    await step('registerLease', `Registering deposit ${i + 1} of ${leases.length}`, [id, amount]);
    const b = reg.book(id);
    b.total += amount;
    b.count += 1n;
    reg.commitSalt(id);
  }

  const band = await step('issueCertificate', 'Working out the verdict', [
    id, BigInt(appraised), BigInt(safePct), BigInt(cautionPct),
  ]);

  const b = reg.book(id);
  post({
    type: 'done',
    band: Number(band),
    commitment: reg.commitment(id),
    // Disclosed ONLY because this tab is playing the registry. On the real
    // site these never leave the registry's machine.
    books: { total: String(b.total), count: String(b.count) },
  });
}

/**
 * The lie. Executes issueCertificate against a claimed opening that does not
 * match the sealed one, so the circuit's assert fires — in the visitor's own
 * browser, before any proof exists.
 */
async function runForgery({ leases, appraised, safePct, cautionPct, claimedTotal }) {
  const reg = makeRegistry();
  const id = rand(32);

  reg.rollSalt();
  reg.execute('openBuilding', id);
  reg.commitSalt(id);
  for (const amount of leases) {
    reg.rollSalt();
    reg.execute('registerLease', id, BigInt(amount));
    const b = reg.book(id);
    b.total += BigInt(amount);
    b.count += 1n;
    reg.commitSalt(id);
  }

  const honest = reg.execute('issueCertificate', id, BigInt(appraised), BigInt(safePct), BigInt(cautionPct));
  post({ type: 'forge', phase: 'honest', band: Number(honest.result) });

  reg.setForge({ total: BigInt(claimedTotal), count: reg.book(id).count });
  try {
    const res = reg.execute('issueCertificate', id, BigInt(appraised), BigInt(safePct), BigInt(cautionPct));
    // Reaching here would mean the contract accepted a false opening.
    post({ type: 'forge', phase: 'accepted', band: Number(res.result) });
  } catch (e) {
    post({ type: 'forge', phase: 'refused', error: String(e?.message ?? e) });
  } finally {
    reg.setForge(null);
  }
}

// Say we are alive the moment the module body finishes. A module worker that
// throws or hangs during init is otherwise completely silent: no error event
// reaches the page, and the only symptom is a status line that never moves.
post({ type: 'ready' });

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  post({ type: 'ack', op: msg.op });
  if (msg.assetBase) BASE = msg.assetBase;
  try {
    if (msg.op === 'run') await runFullDemo(msg);
    else if (msg.op === 'forge') await runForgery(msg);
  } catch (e) {
    post({ type: 'error', error: String(e?.message ?? e) });
  }
};
