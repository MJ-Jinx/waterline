// Derive the wallet that pays transaction fees when no sponsor is available.
//
//   node src/fee-wallet.mjs
//
// WHY THIS EXISTS
//
// Every write in this project is proven locally and then handed to 1AM
// ProofStation, which attaches a DustSpend so the operator pays nothing. That
// is what makes the demo free and wallet-free, and it is genuinely the right
// default. It is also a single third-party dependency on the write path, which
// the README already flags as a production risk — and on 2026-09-22 that risk
// arrived: ProofStation's preprod balancing wallet returned
// `503 WALLETS_UNAVAILABLE / DUST_SYNC_STALE` for hours while preview and
// mainnet stayed healthy, so nothing could be written to preprod at all.
//
// This is the fallback. Instead of asking a sponsor to pay the fee, the
// project pays its own: hold NIGHT, register it for DUST generation, and
// balance the transaction locally. Slower to set up, but it depends on nothing
// but the public node and indexer.
//
// The approach is taken from ODATANO's NIGHTGATE, whose Apache-2.0
// `packages/nightgate-tx/example/self-funded.mjs` documents the whole
// self-funded path — build and prove locally, pay the dust fee from your own
// wallet, submit to the public node yourself.
// See https://github.com/ODATANO/NIGHTGATE.
//
// The fee wallet is deliberately SEPARATE from the registry secret key. The
// registry key authorises writes and is sealed into the contract at
// construction; the fee wallet only pays. Rotating or refunding one must never
// put the other at risk.

import crypto from 'node:crypto';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { S, save } from './common.mjs';

const NETWORK = process.env.NETWORK || 'preprod';
const FAUCET = `https://midnight-tmnight-${NETWORK}.nethermind.dev/`;

// A 64-byte seed: what HDWallet.fromSeed expects for a full-entropy wallet.
if (!S.feeSeed) {
  S.feeSeed = crypto.randomBytes(64).toString('hex');
  save();
  console.log('created a new fee wallet seed and saved it to state.json\n');
} else {
  console.log('reusing the fee wallet seed already in state.json\n');
}

const res = HDWallet.fromSeed(new Uint8Array(Buffer.from(S.feeSeed, 'hex')));
const hd = res.hdWallet ?? res;
if (!hd) {
  console.error(`HDWallet.fromSeed failed: ${res?.type ?? 'unknown'}`);
  process.exit(1);
}

// NightExternal is the role that receives NIGHT. Dust and Zswap are derived
// from the same seed at spend time; only this one needs funding.
const keystore = createKeystore(
  hd.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0).key,
  NETWORK,
);
const address = keystore.getBech32Address().toString();

console.log('fee wallet (pays transaction fees; holds no authority over the contract)');
console.log(`  network  ${NETWORK}`);
console.log(`  address  ${address}\n`);
console.log('To use it, two manual steps — neither can be automated:');
console.log(`  1. Request tNIGHT for that address at:\n       ${FAUCET}`);
console.log('  2. Register the received NIGHT for DUST generation, then wait for DUST to accrue.\n');
console.log('State: state.json now holds feeSeed. It is gitignored and must stay that way —');
console.log('it is spending authority over whatever that address holds.');
