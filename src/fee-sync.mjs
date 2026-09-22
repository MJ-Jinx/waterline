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

// Report POSITION, not just elapsed time. The sync drops its WebSocket every
// minute or so and resubscribes, and from the outside a reconnect that resumes
// and one that starts over look identical — both just print a bigger number of
// seconds. Watching appliedIndex climb is the only way to tell the difference
// between slow and never, so print where each wallet actually is.
//
// The two counters are different keyspaces: the unshielded wallet counts
// transaction ids, the other two count ledger events.
let latest = null;
const sub = facade.state().subscribe({ next: (s) => { latest = s; }, error: () => {} });

const at = (p, applied, highest) => {
  if (!p) return 'n/a';
  const a = p[applied] ?? 0n;
  const h = p[highest] ?? 0n;
  const pct = h > 0n ? ` ${((Number(a) / Number(h)) * 100).toFixed(1)}%` : '';
  return `${a}/${h}${pct}${p.isConnected ? '' : ' (disconnected)'}`;
};

// CHECKPOINT AS WE GO. The dust stream is the long pole — measured at a steady
// ~107 events/sec against ~1.5M events, so hours rather than minutes. Saving
// only on completion means a dropped connection, a reboot or a stray Ctrl-C at
// hour three throws away all of it, and the next run starts at zero again.
//
// Restoring a half-synced wallet is exactly what the snapshot format is for:
// the serialized state carries the tree built so far plus the position it
// reached, so a resume continues rather than restarts.
const CHECKPOINT_EVERY = 4; // ticks, so once a minute
let ticks = 0;
let saved = 0;

const started = Date.now();
const tick = setInterval(() => {
  const s = Math.round((Date.now() - started) / 1000);
  if (!latest) { process.stdout.write(`  ${s}s — no state yet\n`); return; }
  ticks += 1;
  let note = '';
  if (ticks % CHECKPOINT_EVERY === 0) {
    try {
      if (saveFeeState(latest)) { saved += 1; note = `  [checkpoint ${saved}]`; }
    } catch (e) {
      note = `  [checkpoint failed: ${String(e.message || e).slice(0, 60)}]`;
    }
  }
  process.stdout.write(
    `  ${s}s  unshielded ${at(latest.unshielded?.progress, 'appliedId', 'highestTransactionId')}`
    + `  shielded ${at(latest.shielded?.progress, 'appliedIndex', 'highestIndex')}`
    + `  dust ${at(latest.dust?.progress, 'appliedIndex', 'highestIndex')}${note}\n`,
  );
}, 15000);

let state;
try {
  // The RESOLVED value is the real FacadeState. facade.state() is an Observable,
  // and awaiting that yields the Observable itself, so every balance below it
  // reads undefined — indistinguishable from an empty wallet.
  state = await facade.waitForSyncedState();
} finally {
  clearInterval(tick);
  sub.unsubscribe();
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
