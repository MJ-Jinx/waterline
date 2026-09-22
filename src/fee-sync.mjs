// Sync the fee wallet, cache the sync, and report whether it can pay a fee.
//
//   node --max-old-space-size=10240 src/fee-sync.mjs
//
// The heap flag is not optional on a first run: syncing preprod from genesis
// dies at ~3.3 GB under Node's default. Later runs restore from state.fee.json
// and are quick, but the flag costs nothing to keep.
//
// Reports two facts separately, because only one of them is the usual blocker:
// whether NIGHT has arrived, and whether any of it is registered for DUST
// generation. Unregistered NIGHT generates no DUST, and DUST is what pays fees.

import { openFeeWallet, saveFeeState } from './fee.mjs';
import { NETWORK } from './common.mjs';

const { facade, keys, restored } = await openFeeWallet();
console.log(`fee wallet ${keys.address}`);
console.log(`network    ${NETWORK}`);
console.log(restored ? 'restored a cached sync position\n' : 'no cache — syncing from genesis, this is the slow one\n');

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

const big = (v) => { try { return BigInt(v ?? 0); } catch { return 0n; } };
const night = big(state?.unshielded?.balance ?? state?.unshielded?.totalBalance);
const dust = big(state?.dust?.balance ?? state?.dust?.availableDust);

console.log('balances');
console.log(`  NIGHT (unshielded)   ${night.toLocaleString()}`);
console.log(`  DUST (spendable)     ${dust.toLocaleString()}`);

const utxos = state?.unshielded?.utxos ?? state?.unshielded?.availableUtxos ?? [];
const list = Array.isArray(utxos) ? utxos : [];
const registered = list.filter((u) => u?.registeredForDustGeneration);
console.log(`  NIGHT UTxOs          ${list.length} total, ${registered.length} registered for DUST`);

console.log('\ncan this wallet pay a fee?');
if (dust > 0n) {
  console.log('  YES — self-funded writes are possible now.');
} else if (night > 0n && registered.length === 0) {
  console.log('  NOT YET — NIGHT is here but none of it is registered for DUST generation.');
  console.log('  Next:  node --max-old-space-size=10240 src/fee-register.mjs');
} else if (registered.length > 0) {
  console.log('  NOT YET — NIGHT is registered, but no DUST has accrued against it yet. Wait and re-run.');
} else {
  console.log('  NO — no NIGHT at this address. Request some from the faucet first.');
}

if (process.env.DUMP_STATE) {
  console.log('\nraw state:');
  console.log(JSON.stringify(state, (_, v) => (typeof v === 'bigint' ? `${v}n` : v), 2).slice(0, 6000));
}

await facade.stop?.();
process.exit(0);
