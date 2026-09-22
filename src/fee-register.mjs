// Register the fee wallet's NIGHT for DUST generation.
//
//   node --max-old-space-size=10240 src/fee-register.mjs           # estimate only
//   node --max-old-space-size=10240 src/fee-register.mjs --submit   # actually register
//
// NIGHT sitting in a wallet pays for nothing. DUST is what pays fees, and DUST
// only accrues against NIGHT that has been registered for generation. So a
// freshly funded wallet reports a healthy NIGHT balance and still cannot send
// a single transaction — which is exactly the state this wallet was in after
// the faucet paid out: three UTxOs, all `registeredForDustGeneration = false`.
//
// The SDK's own note on estimateRegistration says the returned figures include
// "estimation of dust generation of the UTxO(s), that would be used for paying
// the fee ... data that allows to compute when the fee could be paid". So the
// registration is funded by the generation it switches on. Estimate first, and
// only submit when the numbers say it can actually be paid.
//
// Self-funded path after ODATANO's NIGHTGATE, Apache-2.0:
// packages/nightgate-tx/example/self-funded.mjs — https://github.com/ODATANO/NIGHTGATE

import { openFeeWallet, saveFeeState } from './fee.mjs';

const SUBMIT = process.argv.includes('--submit');

const { facade, keys, restored } = await openFeeWallet();
console.log(`fee wallet ${keys.address}`);
console.log(restored ? 'restored a cached sync position' : 'no cache — syncing from genesis');

const state = await facade.waitForSyncedState();
await saveFeeState(state);

const all = state?.unshielded?.utxos ?? state?.unshielded?.availableUtxos ?? [];
const utxos = Array.isArray(all) ? all : [];
const unregistered = utxos.filter((u) => !u?.registeredForDustGeneration);

console.log(`\nNIGHT UTxOs: ${utxos.length} total, ${unregistered.length} not yet registered`);
for (const u of utxos) {
  console.log(`  ${String(u.value).padStart(14)}  registered=${Boolean(u.registeredForDustGeneration)}`);
}

if (!utxos.length) {
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
  console.log(`\nestimateRegistration failed: ${String(e.message || e).slice(0, 300)}`);
  await facade.stop?.();
  process.exit(1);
}

console.log(`\nregistration fee: ${String(estimate.fee)}`);
for (const d of estimate.dustGenerationEstimations ?? []) {
  const keys2 = Object.keys(d).filter((k) => typeof d[k] !== 'object');
  console.log(`  ${keys2.map((k) => `${k}=${String(d[k])}`).join('  ').slice(0, 200)}`);
}

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
  console.log(`registerNightUtxosForDustGeneration failed: ${String(e.message || e).slice(0, 400)}`);
  await facade.stop?.();
  process.exit(1);
}

try {
  const finalized = await facade.finalizeRecipe(recipe);
  const id = await facade.submitTransaction(finalized);
  console.log(`submitted: ${String(id).slice(0, 40)}…`);
  console.log('\nRegistration is on its way. DUST accrues over time, so re-run');
  console.log('  node --max-old-space-size=10240 src/fee-sync.mjs');
  console.log('until it reports spendable DUST.');
} catch (e) {
  console.log(`submit failed: ${String(e.message || e).slice(0, 400)}`);
  await facade.stop?.();
  process.exit(1);
}

await saveFeeState(await facade.waitForSyncedState());
await facade.stop?.();
process.exit(0);
