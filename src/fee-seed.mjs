// Write a sync snapshot that starts near the tip instead of at genesis.
//
//   node src/fee-seed.mjs            # write state.fee.json
//   node src/fee-seed.mjs --force    # overwrite an existing one
//
// THE PROBLEM. A fresh wallet seed syncs preprod from block 0. Measured here:
// heap exhaustion at ~3.3 GB under Node's default, and again at 10 GB after ten
// minutes. Nearly all of that work is wasted — this wallet's entire history is
// three faucet payments that landed minutes before it was first opened.
//
// THE WAY AROUND IT. Every wallet serializes to JSON carrying an explicit
// starting position, and restores from it. So the snapshot does not have to be
// earned by a full sync; it can be written directly at a chosen position. This
// builds each wallet, serializes it while still empty, overwrites the position,
// and saves. The next run restores from there and syncs only the tail.
//
// The three positions are NOT the same number, and mixing them up silently
// starts a wallet in the wrong place:
//
//   unshielded  `appliedId`, an indexer TRANSACTION id — the same ids as
//               block(offset:{height:N}){transactions{id}}. Set just below the
//               first faucet payment so its UTxOs are definitely picked up.
//   shielded    `offset`, a zswapLedgerEvents id.
//   dust        `offset`, a dustLedgerEvents id.
//
// The last two are a different sequence entirely, with no HTTP query and no
// mapping to a block height; src/ledger-offset.mjs reads them.
//
// ONLY THE UNSHIELDED WALLET CAN BE SEEDED. Both of the others fail on their
// first update with
//
//   {Dust,Zswap}LocalState.replayEventsWithChanges
//   Error: attempted to apply an update path that wasn't compatible with the tree
//
// Both carry a Merkle tree, and a tree cannot be picked up from the middle of
// the stream: the update paths only mean anything against every prior
// insertion. The unshielded wallet has no tree — it is a flat set of UTxOs —
// so it is the one that can start anywhere.
//
// The ledger does expose a real fast-forward for the other two
// (ZswapLocalState.applyCollapsedUpdate, DustLocalState.apply*CollapsedUpdate,
// fed by the indexer's *MerkleTreeCollapsedUpdate queries), but those are
// indexed by Merkle tree position while the wallet snapshot's `offset` is a
// ledger-event id, and nothing exposes the mapping between the two. Not worth
// it here: once the sync batching in fee.mjs was fixed, syncing those two from
// 0 stopped being the bottleneck it appeared to be.
//
// SAFETY. Being too EARLY only costs sync time. Being too LATE silently skips
// funds and looks exactly like an empty wallet, so every default here errs
// early, and fee-sync.mjs re-reads the real balances from the chain afterwards.

import fs from 'node:fs';
import { firstValueFrom, timeout } from 'rxjs';
import { openFeeWallet, FEE_STATE_FILE } from './fee.mjs';

// The first faucet payment: block 2658332, transaction id 617570. One less, so
// the subscription includes it whether its bound is inclusive or exclusive.
const FIRST_FUNDING_TX_ID = 617570n;
const UNSHIELDED_FROM = FIRST_FUNDING_TX_ID - 1n;

const FORCE = process.argv.includes('--force');

if (fs.existsSync(FEE_STATE_FILE)) {
  if (!FORCE) {
    console.log(`${FEE_STATE_FILE} already exists. Re-run with --force to overwrite it.`);
    process.exit(1);
  }
  // openFeeWallet() restores from this file if it is there, so a --force run
  // would serialize the OLD snapshot and patch that — quietly inheriting
  // whatever was wrong with it. Move it aside first so the wallets are built
  // fresh, and keep the copy: it is the only record of a position that may
  // have been expensive to reach.
  const backup = `${FEE_STATE_FILE}.${Date.now()}.bak`;
  fs.renameSync(FEE_STATE_FILE, backup);
  console.log(`moved the existing snapshot to ${backup}
`);
}

// ---- where do the event streams currently end? ----------------------------
const { createClient } = await import('graphql-ws');
const { default: WebSocket } = await import('ws');
const { IDXWS } = await import('./common.mjs');

const maxIdOf = (field) => new Promise((resolve, reject) => {
  const client = createClient({ url: IDXWS, webSocketImpl: WebSocket, retryAttempts: 0 });
  const done = (fn, v) => { try { client.dispose(); } catch { /* already gone */ } fn(v); };
  const timer = setTimeout(() => done(reject, new Error(`${field}: timed out`)), 30000);
  client.subscribe(
    { query: `subscription($id: Int) { ${field}(id: $id) { id maxId } }`, variables: { id: 0 } },
    {
      next: (m) => { clearTimeout(timer); done(resolve, BigInt(m.data[field].maxId)); },
      error: (e) => { clearTimeout(timer); done(reject, new Error(`${field}: ${JSON.stringify(e).slice(0, 200)}`)); },
      complete: () => {},
    },
  );
});

const zswapMax = await maxIdOf('zswapLedgerEvents');
const dustMax = await maxIdOf('dustLedgerEvents');
// Not negotiable for either tree-backed wallet — see the note above.
const TREE_FROM = 0n;
console.log(`zswapLedgerEvents maxId ${zswapMax} → start ${TREE_FROM} (the tree forbids a mid-stream start)`);
console.log(`dustLedgerEvents  maxId ${dustMax} → start ${TREE_FROM} (same)`);
console.log(`unshielded        first funding tx ${FIRST_FUNDING_TX_ID} → start ${UNSHIELDED_FROM}\n`);

// ---- serialize the wallets while they are still empty ----------------------
// facade.state() is an Observable and replays its current value, so the first
// emission is the freshly built state. Taking it now, rather than after
// waitForSyncedState(), is the entire point: no sync has happened yet.
const { facade, keys } = await openFeeWallet();
console.log(`fee wallet ${keys.address}`);

const state = await firstValueFrom(facade.state().pipe(timeout(60000)));

// Let the SDK produce each snapshot, then change ONLY the position. Hand-writing
// the whole document would mean guessing at key encodings, the hex form of an
// empty ZswapLocalState and DustLocalState, and how effect's Schema.BigInt
// round-trips — all of which the SDK already knows.
const patch = (part, field, value) => {
  const snapshot = JSON.parse(state[part].serialize());
  const was = snapshot[field];
  snapshot[field] = String(value); // Schema.BigInt encodes as a decimal string
  console.log(`  ${part.padEnd(11)} ${field} ${was ?? '(unset)'} → ${snapshot[field]}`);
  return JSON.stringify(snapshot);
};

const out = {
  unshielded: patch('unshielded', 'appliedId', UNSHIELDED_FROM),
  shielded: patch('shielded', 'offset', TREE_FROM),
  dust: patch('dust', 'offset', TREE_FROM),
  savedAt: new Date().toISOString(),
  seededBy: 'src/fee-seed.mjs',
};

fs.writeFileSync(FEE_STATE_FILE, JSON.stringify(out));
console.log(`\nwrote ${FEE_STATE_FILE}`);
console.log('Next:  node src/fee-sync.mjs');

await facade.stop?.();
process.exit(0);
