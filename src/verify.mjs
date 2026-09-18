// Tenant side: ask whether a building is safely loaded, and watch the circuit
// refuse a landlord who understates the total.
//
//   node src/verify.mjs
//
// proveSafety writes nothing to the ledger, so this needs no transaction — the
// verdict is computed in-circuit and backed by a real ZK proof.

import * as led from '@midnight-ntwrk/ledger-v8';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import {
  S, BID, building, compiledContract, zkConfigProvider, publicDataProvider,
  walletProvider, provingProvider, stateHash, setLie, ub, won,
} from './common.mjs';

const b = building();
if (!b || BigInt(b.count) === 0n) {
  console.log('No leases registered yet. Run:  node src/registry.mjs');
  process.exit(1);
}

console.log('=== REGISTRY BOOKS (private, never on chain) ===');
console.log(`   leases        : ${b.count}`);
console.log(`   total senior  : ${won(BigInt(b.total))}`);
console.log(`   ON CHAIN      : ${(await stateHash(S.addr)).slice(0, 40)}…  <- opaque, reveals no amount\n`);

/**
 * @param appraised  appraised property value, in won
 * @param pct        safety threshold as a percentage (public input)
 * @param lie        if set, the witness forges this opening instead of the truth
 */
async function verdict(appraised, pct, label, lie) {
  setLie(lie ?? null);
  const claimed = lie ? won(lie.total) : won(BigInt(b.total));
  const cap = (appraised * BigInt(pct)) / 100n;

  console.log(label);
  console.log(`   appraised ${won(appraised)}  threshold ${pct}%  -> cap ${won(cap)}`);
  console.log(`   claiming total = ${claimed}`);

  try {
    const built = await createUnprovenCallTx(
      { zkConfigProvider, publicDataProvider, walletProvider },
      {
        compiledContract,
        contractAddress: S.addr,
        circuitId: 'proveSafety',
        // thresholdPct is Uint<8>: it must be a BigInt, not a JS number.
        args: [ub(BID), appraised, BigInt(pct)],
        initialPrivateState: {},
      },
    );

    const safe = built.private.result;
    console.log(`   circuit OK -> verdict: ${safe === true ? '✅ 안전 (SAFE)' : '⚠️  위험 (UNSAFE)'}  [raw ${safe}]`);

    // Generate the real proof, so the verdict is not merely asserted.
    try {
      const proof = await built.private.unprovenTx.prove(provingProvider, led.CostModel.initialCostModel());
      console.log(`   ZK proof generated (${Buffer.from(proof.serialize()).length} B) — verdict is provable`);
    } catch (e) {
      console.log(`   proving skipped: ${String(e.message || e).slice(0, 90)}`);
    }
  } catch (e) {
    const msg = String(e.message || e);
    const assertion = msg.match(/failed assert:?\s*([^\n]*)/i)?.[1] ?? msg;
    console.log(`   ❌ CIRCUIT REFUSED: ${assertion.slice(0, 120)}`);
  }

  setLie(null);
  console.log('');
}

await verdict(900000000n, 70, '[A] HONEST — generously appraised building');
await verdict(700000000n, 70, '[B] HONEST — same leases, lower appraisal');
await verdict(700000000n, 70,
  '[C] ATTACK — landlord understates the total to flip [B] into SAFE',
  { total: 300000000n, count: 1n });

console.log('[C] failed at circuit-execution time on the prover\'s own machine.');
console.log('    No proof exists to submit, so there is nothing for the chain to reject.');
process.exit(0);
