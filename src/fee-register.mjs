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

import { openFeeWallet, saveFeeState } from './fee.mjs';

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
let generatedNow = 0n;
for (const d of estimate.dustGenerationEstimations ?? []) {
  generatedNow += BigInt(d.dust.generatedNow ?? 0n);
  console.log(`  utxo ${String(d.utxo.utxo.value).padStart(14)}`
    + `  now=${String(d.dust.generatedNow)}`
    + `  cap=${String(d.dust.maxCap)}`
    + `  capAt=${new Date(d.dust.maxCapReachedAt).toISOString()}`);
}
console.log(`  available now: ${generatedNow.toLocaleString()} Specks`
  + `  (${generatedNow >= estimate.fee ? 'covers the fee' : 'does NOT cover the fee yet'})`);

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

try {
  const finalized = await facade.finalizeRecipe(recipe);
  const id = await facade.submitTransaction(finalized);
  console.log(`submitted: ${String(id).slice(0, 60)}`);
  console.log('\nRegistration is on its way. DUST accrues over time, so re-run');
  console.log('  node src/fee-sync.mjs');
  console.log('until it reports spendable DUST.');
} catch (e) {
  console.log(`submit failed: ${String(e.message || e).slice(0, 500)}`);
  await facade.stop?.();
  process.exit(1);
}

await saveFeeState(await facade.waitForSyncedState());
await facade.stop?.();
process.exit(0);
