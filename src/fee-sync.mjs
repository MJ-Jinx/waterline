// Sync the fee wallet, cache the position, and report whether it can pay a fee.
//
//   node src/fee-sync.mjs
//
// Run src/fee-seed.mjs first. Without a snapshot this starts at genesis and
// exhausts the heap — 10 GB was not enough. With one it syncs only the tail.
//
// Reports two facts separately, because only one of them is the usual blocker:
// whether NIGHT has arrived, and whether any of it is registered for DUST
// generation. Unregistered NIGHT generates no DUST, and DUST is what pays fees.

import { openFeeWallet, saveFeeState } from './fee.mjs';
import { NETWORK } from './common.mjs';

const { facade, keys, restored } = await openFeeWallet();
console.log(`fee wallet ${keys.address}`);
console.log(`network    ${NETWORK}`);
if (!restored) {
  console.log('\nNo snapshot — this would sync from genesis and run out of memory.');
  console.log('Run:  node src/fee-seed.mjs');
  await facade.stop?.();
  process.exit(1);
}
console.log('restored a snapshot; syncing the tail\n');

const started = Date.now();
const tick = setInterval(() => {
  process.stdout.write(`  syncing… ${Math.round((Date.now() - started) / 1000)}s\n`);
}, 15000);

let state;
try {
  // The RESOLVED value is the real FacadeState. facade.state() is an Observable,
  // and awaiting that yields the Observable itself, so every balance below it
  // reads undefined — indistinguishable from an empty wallet.
  state = await facade.waitForSyncedState();
} finally {
  clearInterval(tick);
}
console.log(`synced in ${Math.round((Date.now() - started) / 1000)}s`);

console.log(await saveFeeState(state)
  ? 'cached the sync position; the next run resumes from here\n'
  : 'could not cache the sync position; the next run re-syncs\n');

// A NIGHT UTxO arrives as UtxoWithMeta: the ledger Utxo under `utxo`, and the
// indexer's view of it under `meta`. The registration flag lives on `meta`, not
// on the Utxo — reading it off the top level yields undefined, which makes an
// already-registered wallet look unregistered forever.
const coins = state.unshielded.availableCoins ?? [];
const night = coins.reduce((sum, c) => sum + BigInt(c.utxo.value), 0n);
const registered = coins.filter((c) => c.meta?.registeredForDustGeneration);

// dust.balance is a METHOD taking the time to value generation at — DUST
// accrues continuously, so "the balance" is only meaningful at an instant.
const now = new Date();
const dust = state.dust.balance(now);

console.log('balances');
console.log(`  NIGHT                ${night.toLocaleString()}`);
console.log(`  DUST (Specks, now)   ${dust.toLocaleString()}`);
console.log(`  NIGHT UTxOs          ${coins.length} total, ${registered.length} registered for DUST`);
for (const c of coins) {
  console.log(`    ${String(c.utxo.value).padStart(14)}  registered=${Boolean(c.meta?.registeredForDustGeneration)}`);
}

console.log('\ncan this wallet pay a fee?');
if (dust > 0n) {
  console.log('  YES — self-funded writes are possible now.');
} else if (night > 0n && registered.length === 0) {
  console.log('  NOT YET — NIGHT is here but none of it is registered for DUST generation.');
  console.log('  Next:  node src/fee-register.mjs');
} else if (registered.length > 0) {
  console.log('  NOT YET — NIGHT is registered, but no DUST has accrued yet. Wait and re-run.');
} else {
  console.log('  NO — no NIGHT at this address. Check the snapshot offset in src/fee-seed.mjs;');
  console.log('  a snapshot that starts AFTER the funding arrived looks exactly like this.');
}

await facade.stop?.();
process.exit(0);
