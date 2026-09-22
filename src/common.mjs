// Shared plumbing for Waterline: the registry's identity and private state,
// local proving, and paying for and submitting its own transactions.
//
// This is the REGISTRY side — the side that holds the books. It needs a proof
// server and a funded wallet. The tenant-facing site needs neither: reading a
// verdict is a plain GraphQL query, because issueCertificate already wrote the
// band to the ledger.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as led from '@midnight-ntwrk/ledger-v8';
import {
  ZKConfigProvider, createProverKey, createVerifierKey, createZKIR,
} from '@midnight-ntwrk/midnight-js-types';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import * as netid from '@midnight-ntwrk/midnight-js-network-id';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Contract } from '../build/waterline/contract/index.js';

export const NETWORK = process.env.NETWORK || 'preprod';
export const BUILD = './build/waterline';
// Where proofs are generated. Defaults to a proof server on localhost, which
// is what `midnight-tooling:proof-server` or the devnet compose file gives you.
//
// This used to default to 1AM ProofStation, which proved AND sponsored the fee
// in one call. That was genuinely elegant — no wallet, no DUST, nothing to
// install — but it put a third party on the critical path of every write, and
// on 2026-09-22 its preprod balancer returned 503 for hours while preview and
// mainnet were fine. Nothing could be written for as long as it was down.
//
// A local proof server also keeps the witness on this machine. The proving
// payload carries the proof preimage, and this contract's witnesses include
// the registry secret key, the deposit total, the lease count and the salt —
// every value the project exists to protect. Sending that to a third party is
// acceptable for a testnet demo with invented buildings and unacceptable for
// anything real. See the README on the production trust boundary.
//
// Set PROVER (or the older PROOF_STATION) to override.
export const PS = process.env.PROVER || process.env.PROOF_STATION || 'http://127.0.0.1:6300';
export const IDX = `https://indexer.${NETWORK}.midnight.network/api/v4/graphql`;
export const IDXWS = `wss://indexer.${NETWORK}.midnight.network/api/v4/graphql/ws`;
export const NODE = `wss://rpc.${NETWORK}.midnight.network`;
const STATE_FILE = process.env.STATE_FILE || 'state.json';

netid.setNetworkId(NETWORK);

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const hx = (b) => Buffer.from(b).toString('hex');
export const ub = (h) => new Uint8Array(Buffer.from(h, 'hex'));
/** Display KRW in 억 (eok) = 100 million won — the unit Koreans use for deposits. */
export const won = (n) => `₩${(Number(n) / 1e8).toFixed(1)}억`;

// ---------------------------------------------------------------- state
// The registry secret key is unrecoverable if lost, and `registryPk` is sealed
// at construction — lose this file and the deployed contract is bricked.
export const S = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  : { seed: hx(crypto.randomBytes(32)), registrySk: hx(crypto.randomBytes(32)), addr: null, buildings: {} };
export const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(S, null, 2));
if (!S.bid) S.bid = hx(crypto.createHash('sha256').update('서울 관악구 다가구 101').digest());
save();
export const BID = S.bid;
export const building = () => S.buildings[BID];

// ---------------------------------------------------------------- ZK artifacts
// Exactly the layout GitHub Pages serves: keys/<circuit>.prover|.verifier and
// zkir/<circuit>.bzkir.
class FileZkConfigProvider extends ZKConfigProvider {
  constructor(base) { super(); this.base = base; }
  async getZKIR(id) { return createZKIR(fs.readFileSync(path.join(this.base, 'zkir', `${id}.bzkir`))); }
  async getProverKey(id) { return createProverKey(fs.readFileSync(path.join(this.base, 'keys', `${id}.prover`))); }
  async getVerifierKey(id) { return createVerifierKey(fs.readFileSync(path.join(this.base, 'keys', `${id}.verifier`))); }
}
export const zkConfigProvider = new FileZkConfigProvider(BUILD);
export const publicDataProvider = indexerPublicDataProvider(IDX, IDXWS);

// ---------------------------------------------------------------- identity
// A throwaway keypair. No extension, no seed phrase, no user interaction.
const zswap = led.ZswapSecretKeys.fromSeed(ub(S.seed));
export const walletProvider = {
  // The SDK accepts hex or Bech32m here; a raw Uint8Array throws in bech32 decode.
  getCoinPublicKey: () => hx(led.encodeCoinPublicKey(zswap.coinPublicKey)),
  getEncryptionPublicKey: () => zswap.encryptionPublicKey,
  balanceTx: async (tx) => tx, // balancing happens after proving, in proveAndSubmit
};

// ---------------------------------------------------------------- witnesses
let LIE = null;    // set to forge a building opening (see src/verify.mjs case C)
let NEXT = null;   // pre-chosen salt, so we always know the commitment opening

export const setLie = (v) => { LIE = v; };
export const freshSalt = () => { NEXT = crypto.randomBytes(32); return NEXT; };
export const lastSalt = () => NEXT;

export const witnesses = {
  registry_secret_key: (ctx) => [ctx.privateState, ub(S.registrySk)],

  building_opening: (ctx, bid) => {
    if (LIE) return [ctx.privateState, LIE];
    const e = S.buildings[hx(bid)];
    return [ctx.privateState, e ? { total: BigInt(e.total), count: BigInt(e.count) } : { total: 0n, count: 0n }];
  },

  building_salt: (ctx, bid) => {
    const e = S.buildings[hx(bid)];
    return [ctx.privateState, e ? ub(e.salt) : new Uint8Array(32)];
  },

  fresh_salt: (ctx) => [ctx.privateState, NEXT],

  senior_liens: (ctx, bid) => [ctx.privateState, BigInt(S.buildings[hx(bid)]?.liens ?? 0)],
};

// CompiledContract combinators MUST be called data-first. The curried `.pipe()`
// form yields an object missing its contract context and fails deep inside
// compact-js with an opaque "reading 'Symbol()'" error.
let _cc = CompiledContract.make('Waterline', Contract);
_cc = CompiledContract.withWitnesses(_cc, witnesses);
_cc = CompiledContract.withCompiledFileAssets(_cc, BUILD);
export const compiledContract = _cc;

// ---------------------------------------------------------------- proving
// A ProvingProvider over the standard proof-server API. The prover key travels
// WITH the request, so the server can prove a contract it has never seen —
// which is what made a third-party prover possible at all, and is also exactly
// why we no longer use one: that request carries the witness. Note that /check
// and /prove take DIFFERENT payload formats.
const keyMaterial = (circuit) => ({
  proverKey: fs.readFileSync(path.join(BUILD, 'keys', `${circuit}.prover`)),
  verifierKey: fs.readFileSync(path.join(BUILD, 'keys', `${circuit}.verifier`)),
  ir: fs.readFileSync(path.join(BUILD, 'zkir', `${circuit}.bzkir`)),
});
const post = (endpoint, body) => fetch(PS + endpoint, {
  method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body,
});

export const provingProvider = {
  // /check wants option(wrapped-ir) and answers in BINARY, not JSON.
  async check(preimage, circuit) {
    const r = await post('/check', led.createCheckPayload(preimage, keyMaterial(circuit).ir));
    if (!r.ok) throw new Error(`check ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return led.parseCheckResult(new Uint8Array(await r.arrayBuffer()));
  },
  // /prove wants option(proving-data): the full key material.
  async prove(preimage, circuit, overwriteBindingInput) {
    const r = await post('/prove', led.createProvingPayload(preimage, overwriteBindingInput, keyMaterial(circuit)));
    if (!r.ok) throw new Error(`prove ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return new Uint8Array(await r.arrayBuffer());
  },
};

// ---------------------------------------------------------------- fee wallet
// Imported lazily. fee.mjs reads S, NETWORK and the endpoints from this module,
// so a top-level import here would be a cycle — which ESM tolerates but which
// leaves one of the two modules half-initialised depending on entry point.
//
// Opened once and shared: every write in a run pays from the same wallet, and
// syncing it more than once would waste the thing the snapshot exists to avoid.
let _fee = null;
async function feeWallet() {
  if (_fee) return _fee;
  const { openFeeWallet } = await import('./fee.mjs');
  const { facade, keys, restored } = await openFeeWallet();
  if (!restored) {
    await facade.stop?.();
    throw new Error('no fee wallet snapshot — run: node src/fee-seed.mjs && node src/fee-sync.mjs');
  }
  process.stdout.write('      syncing the fee wallet… ');
  await facade.waitForSyncedState();
  console.log('done');
  _fee = { facade, keys };
  return _fee;
}

// ---------------------------------------------------------------- chain
let api = null;
export const connect = async () => {
  api ??= await ApiPromise.create({ provider: new WsProvider(NODE), noInitWarn: true });
  return api;
};
export const disconnect = async () => {
  if (api) { await api.disconnect(); api = null; }
  if (_fee) { await _fee.facade.stop?.(); _fee = null; }
};

/**
 * Submit a finalized ledger transaction to the node.
 *
 * NOT facade.submitTransaction, and the reason is worth recording. The facade
 * builds its node client once, when the facade is initialised, and never
 * reconnects it. Syncing this wallet takes the better part of an hour, by
 * which time the node has long since dropped an idle socket, so every
 * submission failed with
 *
 *   SubmissionError: Transaction submission error
 *     cause: disconnected from wss://rpc.preprod.midnight.network/: 1000:: Normal Closure
 *
 * — a transport failure wearing the costume of a rejected transaction. The
 * transaction was fine; the pipe was shut.
 *
 * Connecting here instead means the socket is opened when there is something
 * to send. A raw ledger transaction is also not a valid Substrate extrinsic on
 * its own: it must be wrapped in `midnight.sendMnTransaction`, or submitting
 * the bytes through author_submitExtrinsic traps the runtime.
 */
export async function submitFinalized(finalized) {
  const hex = Buffer.from(finalized.serialize()).toString('hex');
  // Reconnect if a previous call left a dead handle behind.
  if (api && !api.isConnected) { try { await api.disconnect(); } catch { /* already gone */ } api = null; }
  const chain = await connect();
  const hash = await chain.tx.midnight.sendMnTransaction(`0x${hex}`).send();
  return { hash: hash.toHex(), bytes: hex.length / 2 };
}

/**
 * Prove the transaction, pay its DUST fee from our own wallet, and submit.
 *
 * This used to hand the proven transaction to 1AM ProofStation, which attached
 * a DustSpend and gave it back balanced. That was one HTTP call and cost
 * nothing, but it put a third party on the critical path of every write — and
 * on 2026-09-22 its preprod balancer returned 503 for hours while preview and
 * mainnet were fine, so nothing could be written at all.
 *
 * The order matters and is not the obvious one: PROVE first, then balance.
 * Balancing appends a DustSpend to an already-proven transaction rather than
 * being part of what gets proved, which is why a third party could do it at all.
 *
 * Submission follows immediately and in the same process. The intent TTL is
 * short, and a proven transaction left sitting is rejected with
 * `1010: Custom error: 182`.
 */
export async function proveAndSubmit(unprovenTx, label) {
  let proven;
  try {
    proven = await unprovenTx.prove(provingProvider, led.CostModel.initialCostModel());
  } catch (e) {
    console.log(`      prove failed: ${String(e.message || e).slice(0, 200)}`);
    console.log(`      is a proof server running at ${PS}?`);
    return null;
  }

  let facade;
  let keys;
  try {
    ({ facade, keys } = await feeWallet());
  } catch (e) {
    console.log(`      ${String(e.message || e).slice(0, 300)}`);
    return null;
  }

  try {
    // The wallet needs a deadline for the balancing intent. Long enough that a
    // slow in-process proof of the DustSpend does not expire it, short enough
    // that a failed run does not leave DUST locked for long.
    const ttl = new Date(Date.now() + 10 * 60 * 1000);
    // UNBOUND, not finalized. `prove()` preserves the binding type parameter —
    // Transaction<S, PreProof, PreBinding> proves to Transaction<S, Proof,
    // PreBinding> — so what comes back is proven and still UNBOUND. That is
    // exactly the SDK's UnboundTransaction.
    //
    // Handing it to balanceFinalizedTransaction is accepted without complaint
    // and quietly wrong: that path assumes the base transaction is already
    // bound and never binds it, so the chain rejects the merged result with
    // `Intent with id NNNNN is not bound`. Only the unbound path calls
    // .bind() on our transaction.
    const recipe = await facade.balanceUnboundTransaction(
      proven,
      { shieldedSecretKeys: keys.zswapKeys, dustSecretKey: keys.dustKey },
      { ttl },
    );

    // SIGN BEFORE FINALIZING, or the chain rejects the whole thing with
    // `Intent with id NNNNN is not bound`.
    //
    // Balancing does not modify our proven transaction; it returns it
    // untouched alongside a SECOND, unproven transaction carrying the
    // DustSpend, and finalizeRecipe proves, binds and merges that one. But the
    // balancing transaction spends our NIGHT, so it needs our signature first
    // — and an intent that should be signed and is not cannot be bound.
    //
    // The error names binding because that is where it is noticed, which sends
    // you looking at Pedersen commitments rather than at a missing signature.
    const signed = await facade.signRecipe(recipe, (data) => keys.keystore.signData(data));
    const finalized = await facade.finalizeRecipe(signed);
    const { hash, bytes } = await submitFinalized(finalized);
    console.log(`      proven locally + self-funded, submitted ${hash.slice(0, 18)}…  ${bytes} B`);
    return { hash };
  } catch (e) {
    console.log(`      ${label} failed: ${String(e.message || e).slice(0, 300)}`);
    return null;
  }
}

export const stateHash = async (addr) => {
  const st = await publicDataProvider.queryContractState(addr).catch(() => null);
  // NOTE: serialize() lives on ContractState itself, not on .data
  return st ? crypto.createHash('sha256').update(Buffer.from(st.serialize())).digest('hex') : null;
};

/** The commitment currently published for one building, or null if it has none. */
export async function buildingCommitment(addr, bid) {
  const st = await publicDataProvider.queryContractState(addr).catch(() => null);
  if (!st) return null;
  const { ledger: decode } = await import('../build/waterline/contract/index.js');
  const l = decode(st.data);
  const id = ub(bid);
  return l.buildingState.member(id) ? hx(l.buildingState.lookup(id)) : null;
}

/**
 * Wait until THIS building's commitment changes from what it was.
 *
 * waitForAdvance below watches the hash of the whole contract state, which is
 * both too loose and too tight. Too loose: any other write satisfies it, so it
 * returns for something unrelated and the next circuit reads a building that
 * is not there yet — `expected a cell, received null`. Too tight: it needs a
 * correct previous hash to compare against, and an unset one makes the first
 * poll succeed unconditionally.
 *
 * Watching one building's commitment says exactly what the caller means: the
 * write I just sent has landed.
 */
export async function waitForCommitment(addr, bid, previous, tries = 50) {
  for (let i = 0; i < tries; i += 1) {
    await wait(6000);
    const now = await buildingCommitment(addr, bid);
    if (now !== previous) { console.log(`      landed (${now ? `${now.slice(0, 16)}…` : 'removed'})`); return now; }
  }
  console.log('      timed out waiting for the write to land');
  return previous;
}

export async function waitForAdvance(addr, previous) {
  for (let i = 0; i < 50; i += 1) {
    await wait(6000);
    const h = await stateHash(addr);
    if (h && h !== previous) { console.log('      ledger advanced'); return h; }
  }
  console.log('      timed out waiting for the ledger to advance');
  return previous;
}
