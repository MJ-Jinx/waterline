// Read what the fee wallet actually holds, and whether it can pay a fee yet.
//
//   node src/fee-balance.mjs
//
// Balance is not a plain indexer query — the public GraphQL API exposes blocks,
// transactions and contract actions, but no "balance for address". A wallet
// balance only exists once a wallet has synced the chain and worked out which
// outputs belong to it, so this builds the same WalletFacade the self-funded
// write path uses and reads its state.
//
// A fresh seed syncs from genesis, so the first run is slow. Later runs resume.
//
// Facade assembly follows ODATANO's NIGHTGATE, Apache-2.0:
// packages/nightgate-tx/example/self-funded.mjs. See https://github.com/ODATANO/NIGHTGATE.

import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { WalletFacade, WalletEntrySchema, mergeWalletEntries } from '@midnight-ntwrk/wallet-sdk-facade';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { makeWasmProvingService } from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import { ZswapSecretKeys, DustSecretKey, LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { S, NETWORK, IDX, IDXWS, NODE } from './common.mjs';

if (!S.feeSeed) {
  console.log('No fee wallet yet. Run:  node src/fee-wallet.mjs');
  process.exit(1);
}

const res = HDWallet.fromSeed(new Uint8Array(Buffer.from(S.feeSeed, 'hex')));
const hd = res.hdWallet ?? res;
const account = hd.selectAccount(0);
const roleSeed = (r) => account.selectRole(r).deriveKeyAt(0).key;

const zswapKeys = ZswapSecretKeys.fromSeed(roleSeed(Roles.Zswap));
const dustKey = DustSecretKey.fromSeed(roleSeed(Roles.Dust));
const keystore = createKeystore(roleSeed(Roles.NightExternal), NETWORK);
const address = keystore.getBech32Address().toString();

console.log(`fee wallet ${address}`);
console.log(`network    ${NETWORK}\n`);

const configuration = {
  networkId: NETWORK,
  relayURL: new URL(NODE),
  // Unused: proving happens in WASM, in-process. The facade still wants the field.
  provingServerUrl: new URL('http://127.0.0.1:6300'),
  indexerClientConnection: { indexerHttpUrl: IDX, indexerWsUrl: IDXWS },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
  costParameters: { additionalFeeOverhead: 1n, feeBlocksMargin: 5 },
};

const facade = await WalletFacade.init({
  configuration,
  provingService: () => makeWasmProvingService({}),
  shielded: () => ShieldedWallet(configuration).startWithSecretKeys(zswapKeys),
  unshielded: () => UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
  dust: () => DustWallet(configuration).startWithSecretKey(dustKey, LedgerParameters.initialParameters().dust),
});

await facade.start(zswapKeys, dustKey);
console.log('syncing to the chain tip (a fresh seed starts at genesis — this can take a while)...');

const started = Date.now();
const timer = setInterval(() => {
  process.stdout.write(`\r  still syncing, ${Math.round((Date.now() - started) / 1000)}s elapsed   `);
}, 5000);

try {
  await facade.waitForSyncedState();
} finally {
  clearInterval(timer);
  process.stdout.write('\r');
}
console.log(`synced in ${Math.round((Date.now() - started) / 1000)}s\n`);

// state() is a METHOD on the facade, not a property — reading it as a property
// yields a function and every field below comes back undefined.
const state = await facade.state();

const show = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);
console.log('balances');
show('unshielded NIGHT', state?.unshielded?.balance ?? state?.unshielded?.totalBalance ?? '(none)');
show('shielded', JSON.stringify(state?.shielded?.balances ?? {}));
show('DUST available', state?.dust?.balance ?? state?.dust?.availableDust ?? '(none)');

// The two things that decide whether a fee can actually be paid.
const night = state?.unshielded?.balance ?? 0n;
const dust = state?.dust?.balance ?? 0n;
console.log('\nreadiness');
show('has NIGHT', BigInt(night || 0) > 0n ? 'yes' : 'NO — request from the faucet');
show('has spendable DUST', BigInt(dust || 0) > 0n
  ? 'yes — self-funded writes are possible'
  : 'NO — register NIGHT for DUST generation, then wait for it to accrue');

if (process.env.DUMP_STATE) {
  console.log('\nfull state:');
  console.log(JSON.stringify(state, (_, v) => (typeof v === 'bigint' ? `${v}n` : v), 2).slice(0, 4000));
}

await facade.close?.();
process.exit(0);
