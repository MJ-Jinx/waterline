// Shared plumbing for Waterline: burner identity, ProofStation as a
// ProvingProvider, the registry's private state, and transaction submission.
//
// Nothing here needs a browser extension, a local proof server, or any funds.

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
export const PS = process.env.PROOF_STATION || `https://api-${NETWORK}.1am.xyz`;
export const IDX = `https://indexer.${NETWORK}.midnight.network/api/v4/graphql`;
export const IDXWS = `wss://indexer.${NETWORK}.midnight.network/api/v4/graphql/ws`;
export const NODE = `wss://rpc.${NETWORK}.midnight.network`;
const STATE_FILE = process.env.STATE_FILE || 'state.json';

netid.setNetworkId(NETWORK);

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const hx = (b) => Buffer.from(b).toString('hex');
export const ub = (h) => new Uint8Array(Buffer.from(h, 'hex'));
/** Display KRW in 억 (100 million won), the unit Koreans actually use for deposits. */
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
  balanceTx: async (tx) => tx, // balancing is done by ProofStation, below
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
// ProofStation as a ProvingProvider. The key insight: the prover key travels
// WITH the request, so a third-party prover can prove a contract it has never
// seen. Note /check and /prove take DIFFERENT payload formats.
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

// ---------------------------------------------------------------- chain
let api = null;
export const connect = async () => {
  api ??= await ApiPromise.create({ provider: new WsProvider(NODE), noInitWarn: true });
  return api;
};
export const disconnect = async () => { if (api) { await api.disconnect(); api = null; } };

/**
 * Prove the transaction, have ProofStation sponsor the dust fee, and submit.
 * Submission happens in the same process with no gap: the intent TTL is short,
 * and a proven transaction left sitting fails with `1010: Custom error: 182`.
 */
export async function sponsorAndSubmit(unprovenTx, label) {
  let proven;
  try {
    proven = await unprovenTx.prove(provingProvider, led.CostModel.initialCostModel());
  } catch (e) {
    console.log(`      prove failed: ${String(e.message || e).slice(0, 200)}`);
    return null;
  }

  const bin = Buffer.from(proven.serialize());
  let balanced = null;
  // ProofStation allows one pending balance request at a time; 429 means wait.
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const r = await post('/balance', bin);
    const j = await r.json().catch(() => ({}));
    if (j.txBytes || j.tx) { balanced = j.txBytes ?? j.tx; break; }
    if (r.status !== 429) {
      console.log(`      balance failed ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
      return null;
    }
    await wait(15000);
  }
  if (!balanced) { console.log('      sponsor never became free'); return null; }

  const final = led.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(balanced, 'hex'));
  const sponsored = /DustSpend/i.test(String(final));

  try {
    // A raw ledger transaction is NOT a valid Substrate extrinsic; it must be
    // wrapped. Submitting raw bytes via author_submitExtrinsic traps the runtime.
    const chain = await connect();
    const hash = await chain.tx.midnight.sendMnTransaction(`0x${balanced}`).send();
    console.log(`      proven + sponsored (dust:${sponsored}) submitted ${hash.toHex().slice(0, 18)}…  ${bin.length}→${balanced.length / 2} B`);
    return { txBytes: balanced, hash: hash.toHex() };
  } catch (e) {
    console.log(`      submit rejected: ${String(e.message || e).slice(0, 160)}`);
    return null;
  }
}

export const stateHash = async (addr) => {
  const st = await publicDataProvider.queryContractState(addr).catch(() => null);
  // NOTE: serialize() lives on ContractState itself, not on .data
  return st ? crypto.createHash('sha256').update(Buffer.from(st.serialize())).digest('hex') : null;
};

export async function waitForAdvance(addr, previous) {
  for (let i = 0; i < 50; i += 1) {
    await wait(6000);
    const h = await stateHash(addr);
    if (h && h !== previous) { console.log('      ledger advanced'); return h; }
  }
  console.log('      timed out waiting for the ledger to advance');
  return previous;
}
