// The fee wallet: build it, sync it, and keep the sync so it is paid for once.
//
// Waterline's writes were sponsored by 1AM ProofStation, which attaches a
// DustSpend so the operator pays nothing. On 2026-09-22 its preprod balancing
// wallet returned `503 WALLETS_UNAVAILABLE / DUST_SYNC_STALE` for hours while
// preview and mainnet stayed healthy, and no preprod write was possible for as
// long as it was down. A demo that cannot be updated during a hackathon is a
// demo with someone else's hand on the switch.
//
// So this pays its own way instead: hold NIGHT, register it for DUST
// generation, balance locally, submit to the public node. It depends on
// nothing but the node and the indexer.
//
// The approach is ODATANO's, from the Apache-2.0 NIGHTGATE example
// packages/nightgate-tx/example/self-funded.mjs — build and prove locally, pay
// the dust fee from your own wallet, submit yourself.
// https://github.com/ODATANO/NIGHTGATE
//
// WHY THE SERIALIZED STATE MATTERS. A fresh seed syncs preprod from genesis.
// Measured here: it exhausts Node's default heap at ~3.3 GB after four
// minutes, and does not reach the tip inside twenty-five even with 10 GB. The
// SDK exposes serializeState()/restore(), so that cost is paid once and every
// later run resumes. Without this every script in the chain would pay it again.

import fs from 'node:fs';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { WalletFacade, WalletEntrySchema, mergeWalletEntries } from '@midnight-ntwrk/wallet-sdk-facade';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { makeWasmProvingService } from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import { ZswapSecretKeys, DustSecretKey, LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { S, NETWORK, IDX, IDXWS, NODE } from './common.mjs';

// Matches the .gitignore `state*.json` rule, so the sync cache and the keys it
// belongs to are ignored by the same line. Verified with `git check-ignore`.
export const FEE_STATE_FILE = 'state.fee.json';

export function feeKeys() {
  if (!S.feeSeed) throw new Error('No fee wallet. Run: node src/fee-wallet.mjs');
  const res = HDWallet.fromSeed(new Uint8Array(Buffer.from(S.feeSeed, 'hex')));
  const hd = res.hdWallet ?? res;
  if (!hd) throw new Error(`HDWallet.fromSeed failed: ${res?.type ?? 'unknown'}`);
  const account = hd.selectAccount(0);
  const roleSeed = (r) => account.selectRole(r).deriveKeyAt(0).key;

  const keystore = createKeystore(roleSeed(Roles.NightExternal), NETWORK);
  return {
    zswapKeys: ZswapSecretKeys.fromSeed(roleSeed(Roles.Zswap)),
    dustKey: DustSecretKey.fromSeed(roleSeed(Roles.Dust)),
    keystore,
    address: keystore.getBech32Address().toString(),
    addressHex: String(PublicKey.fromKeyStore(keystore).addressHex),
  };
}

export const configuration = {
  networkId: NETWORK,
  relayURL: new URL(NODE),
  // Unused — proving runs in WASM, in-process. The facade still requires it.
  provingServerUrl: new URL('http://127.0.0.1:6300'),
  indexerClientConnection: { indexerHttpUrl: IDX, indexerWsUrl: IDXWS },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
  costParameters: { additionalFeeOverhead: 1n, feeBlocksMargin: 5 },
};

/**
 * Build the facade, restoring each wallet's sync position if we have one.
 * `restored` says whether this run starts from a cache or from genesis, which
 * is the difference between seconds and half an hour.
 */
export async function openFeeWallet() {
  const k = feeKeys();
  const cache = fs.existsSync(FEE_STATE_FILE)
    ? JSON.parse(fs.readFileSync(FEE_STATE_FILE, 'utf8'))
    : null;

  const facade = await WalletFacade.init({
    configuration,
    provingService: () => makeWasmProvingService({}),
    shielded: () => (cache?.shielded
      ? ShieldedWallet(configuration).restore(cache.shielded)
      : ShieldedWallet(configuration).startWithSecretKeys(k.zswapKeys)),
    unshielded: () => (cache?.unshielded
      ? UnshieldedWallet(configuration).restore(cache.unshielded)
      : UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(k.keystore))),
    dust: () => (cache?.dust
      ? DustWallet(configuration).restore(cache.dust)
      : DustWallet(configuration).startWithSecretKey(k.dustKey, LedgerParameters.initialParameters().dust)),
  });

  await facade.start(k.zswapKeys, k.dustKey);
  return { facade, keys: k, restored: Boolean(cache) };
}

/**
 * Persist each wallet's sync position so the next run resumes.
 *
 * Takes the state rather than fetching it. `facade.state()` returns an
 * RxJS Observable, not a Promise — awaiting it hands back the Observable
 * itself, and every field read off it is undefined, which looks exactly like
 * an empty wallet. `waitForSyncedState()` is the one that resolves to a real
 * FacadeState, so callers pass that in.
 */
export async function saveFeeState(state) {
  const out = {};
  for (const part of ['shielded', 'unshielded', 'dust']) {
    const w = state?.[part];
    try {
      if (typeof w?.serialize === 'function') out[part] = w.serialize();
    } catch { /* a wallet that cannot serialize just re-syncs next time */ }
  }
  if (!Object.keys(out).length) return false;
  out.savedAt = new Date().toISOString();
  fs.writeFileSync(FEE_STATE_FILE, JSON.stringify(out));
  return true;
}
