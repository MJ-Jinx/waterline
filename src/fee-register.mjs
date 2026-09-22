// Register the fee wallet's NIGHT for DUST generation.
//
//   node src/fee-register.mjs            # estimate only
//   node src/fee-register.mjs --submit   # actually register
//
// NIGHT sitting in a wallet pays for nothing. DUST is what pays fees, and DUST
// only accrues against NIGHT that has been REGISTERED for generation. So a
// freshly funded wallet reports a healthy NIGHT balance and still cannot send a
// single transaction — exactly the state this wallet was in after the faucet
// paid out: three UTxOs, all `registeredForDustGeneration = false`.
//
// There is an obvious chicken-and-egg here: registering is itself a
// transaction, and a transaction costs DUST. The SDK's note on
// estimateRegistration says the estimate covers "dust generation of the
// UTxO(s), that would be used for paying the fee ... data that allows to
// compute when the fee could be paid" — so the registration is funded by the
// generation it switches on. That is why this estimates first and prints when
// each UTxO reaches capacity: if the numbers do not cover the fee yet, the
// answer is to wait, not to retry.
//
// Self-funded path after ODATANO's NIGHTGATE, Apache-2.0:
// packages/nightgate-tx/example/self-funded.mjs — https://github.com/ODATANO/NIGHTGATE

import { inspect } from 'node:util';
import { openFeeWallet, saveFeeState } from './fee.mjs';
import { submitFinalized, disconnect } from './common.mjs';

const SUBMIT = process.argv.includes('--submit');

const { facade, keys, restored } = await openFeeWallet();
console.log(`fee wallet ${keys.address}`);
if (!restored) {
  console.log('No snapshot. Run:  node src/fee-seed.mjs');
  await facade.stop?.();
  process.exit(1);
}

const state = await facade.waitForSyncedState();
await saveFeeState(state);

// UtxoWithMeta: the ledger Utxo under `utxo`, the indexer's view under `meta`.
// The registration flag is on `meta` — reading it off the top level yields
// undefined, so every UTxO looks unregistered and this would re-register
// forever, burning a fee each time.
const coins = state.unshielded.availableCoins ?? [];
const unregistered = coins.filter((c) => !c.meta?.registeredForDustGeneration);

console.log(`\nNIGHT UTxOs: ${coins.length} total, ${unregistered.length} not yet registered`);
for (const c of coins) {
  console.log(`  ${String(c.utxo.value).padStart(14)}  registered=${Boolean(c.meta?.registeredForDustGeneration)}`);
}

if (!coins.length) {
  console.log('\nNothing to register — this wallet holds no NIGHT.');
  await facade.stop?.();
  process.exit(1);
}
if (!unregistered.length) {
  console.log('\nEverything is already registered. Wait for DUST to accrue, then re-run src/fee-sync.mjs.');
  await facade.stop?.();
  process.exit(0);
}

// ---- estimate -------------------------------------------------------------
let estimate;
try {
  estimate = await facade.estimateRegistration(unregistered);
} catch (e) {
  console.log(`\nestimateRegistration failed: ${String(e.message || e).slice(0, 400)}`);
  await facade.stop?.();
  process.exit(1);
}

console.log(`\nregistration fee: ${estimate.fee.toLocaleString()} Specks`);

// UtxoWithFullDustDetails nests differently from UtxoWithMeta, so read the
// value defensively rather than assuming a depth. Getting this wrong only
// breaks the printout, but the printout is the thing deciding whether to spend
// real funds, so it should not throw on the way to showing it.
const valueOf = (d) => d?.utxo?.utxo?.value ?? d?.utxo?.value ?? d?.value ?? '?';

let generatedNow = 0n;
for (const d of estimate.dustGenerationEstimations ?? []) {
  const g = d.dust ?? d;
  generatedNow += BigInt(g.generatedNow ?? 0n);
  const capAt = g.maxCapReachedAt ? new Date(g.maxCapReachedAt).toISOString() : 'unknown';
  console.log(`  utxo ${String(valueOf(d)).padStart(14)}`
    + `  now=${String(g.generatedNow ?? '?')}`
    + `  cap=${String(g.maxCap ?? '?')}`
    + `  capAt=${capAt}`);
}
console.log(`  generated so far: ${generatedNow.toLocaleString()} Specks`
  + `  (fee is ${estimate.fee}; ${generatedNow >= estimate.fee ? 'covered' : 'NOT covered yet'})`);

if (!SUBMIT) {
  console.log('\nEstimate only. Re-run with --submit to register.');
  await facade.stop?.();
  process.exit(0);
}

// ---- register -------------------------------------------------------------
console.log('\nbuilding the registration transaction...');
let recipe;
try {
  recipe = await facade.registerNightUtxosForDustGeneration(
    unregistered,
    keys.keystore.getPublicKey(),
    (payload) => keys.keystore.signData(payload),
  );
} catch (e) {
  console.log(`registerNightUtxosForDustGeneration failed: ${String(e.message || e).slice(0, 500)}`);
  await facade.stop?.();
  process.exit(1);
}

/**
 * Say everything the failure knows.
 *
 * The SDK wraps submission failures as "Transaction submission error" with the
 * actual reason — a node rejection, a malformed extrinsic, a fee problem —
 * hidden on `cause`, sometimes nested several deep. Printing only `.message`
 * tells you a transaction failed and nothing whatsoever about why, which is
 * the least useful possible thing to learn when one has just been built.
 */
function explain(e) {
  const seen = new Set();
  const lines = [];
  for (let cur = e, depth = 0; cur && depth < 6; depth += 1) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const tag = cur._tag ? ` [${cur._tag}]` : '';
    lines.push(`${'  '.repeat(depth)}${cur.name ?? typeof cur}${tag}: ${cur.message ?? String(cur)}`);
    for (const k of ['code', 'status', 'reason', 'detail', 'details', 'response', 'data', 'errors']) {
      if (cur[k] !== undefined) lines.push(`${'  '.repeat(depth)}  ${k}: ${JSON.stringify(cur[k]).slice(0, 400)}`);
    }
    cur = cur.cause ?? cur.error ?? cur.originalError;
  }

  // Effect wraps rejections in a FiberFailure whose Cause hangs off a SYMBOL,
  // not off .cause, so the loop above walks straight past it and reports one
  // useless line. Fall back to a deep inspect, which sees symbol keys.
  if (lines.length <= 1) {
    for (const s of Object.getOwnPropertySymbols(e ?? {})) {
      const v = e[s];
      if (v && typeof v === 'object') {
        lines.push(`  via ${String(s)}:`);
        lines.push(inspect(v, { depth: 6, colors: false, breakLength: 100 })
          .split('\n').map((l) => `    ${l}`).join('\n'));
      }
    }
    if (lines.length <= 1) lines.push(inspect(e, { depth: 6, colors: false }));
  }
  return lines.join('\n');
}

let finalized;
try {
  finalized = await facade.finalizeRecipe(recipe);
  console.log(`finalized (${finalized.serialize().length} B)`);
} catch (e) {
  console.log(`finalizeRecipe failed:\n${explain(e)}`);
  await facade.stop?.();
  process.exit(1);
}

try {
  // Our own submission, not facade.submitTransaction — see submitFinalized in
  // common.mjs. The facade opens its node socket once at init, and after an
  // hour of syncing the node has long since closed it.
  const { hash, bytes } = await submitFinalized(finalized);
  console.log(`submitted: ${hash}  (${bytes} B)`);
  console.log('\nRegistration is on its way. DUST accrues over time, so re-run');
  console.log('  node src/fee-sync.mjs');
  console.log('until it reports spendable DUST.');
} catch (e) {
  console.log(`submit failed:\n${explain(e)}`);
  await facade.stop?.();
  process.exit(1);
}

await saveFeeState(await facade.waitForSyncedState());
await facade.stop?.();
await disconnect();
process.exit(0);
