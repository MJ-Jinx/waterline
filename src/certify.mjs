// Issue a public verdict certificate for a building, and demonstrate that a
// landlord who understates the total cannot get one.
//
//   node src/certify.mjs            # honest: appraised 9.0억  -> 안전
//   node src/certify.mjs 7          # honest: appraised 7.0억  -> 위험
//   node src/certify.mjs 7 --attack # claim 3.0억 to flip it   -> REFUSED
//
// issueCertificate writes the band to the ledger, so the honest runs submit a
// transaction. The attack never gets that far: it fails while the circuit is
// still executing locally.

import * as led from '@midnight-ntwrk/ledger-v8';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import {
  S, save, BID, building, compiledContract, zkConfigProvider, publicDataProvider,
  walletProvider, proveAndSubmit, stateHash, waitForAdvance, setLie,
  connect, disconnect, ub, won,
} from './common.mjs';

const SAFE_PCT = 70n;     // at or below 70% of appraised value -> 안전
const CAUTION_PCT = 80n;  // at or below 80%                    -> 주의, else 위험
const BANDS = ['⚠️  위험 wiheom (DANGER)', '△ 주의 juui (CAUTION)', '✅ 안전 anjeon (SAFE)'];

const eok = BigInt(process.argv[2] ?? 9) * 100000000n;
const attack = process.argv.includes('--attack');

const b = building();
if (!b || BigInt(b.count) === 0n) {
  console.log('No leases registered yet. Run:  node src/registry.mjs');
  process.exit(1);
}

console.log('=== REGISTRY BOOKS (private, never on chain) ===');
console.log('   amounts in 억 (eok) = 100 million won');
console.log(`   leases        : ${b.count}`);
console.log(`   total senior  : ${won(BigInt(b.total))}`);
console.log(`   ON CHAIN      : ${(await stateHash(S.addr)).slice(0, 40)}…  <- opaque\n`);

const safeCap = (eok * SAFE_PCT) / 100n;
const cautionCap = (eok * CAUTION_PCT) / 100n;
const claimed = attack ? 300000000n : BigInt(b.total);

console.log(attack
  ? '[ATTACK] landlord understates the total to win a better band'
  : '[HONEST] registry issues a certificate from its real books');
console.log(`   appraised ${won(eok)}   안전 ≤ ${won(safeCap)} (${SAFE_PCT}%)   주의 ≤ ${won(cautionCap)} (${CAUTION_PCT}%)`);
console.log(`   claiming total = ${won(claimed)}${attack ? '   <-- A LIE' : ''}`);

if (attack) setLie({ total: claimed, count: 1n });

await connect();
try {
  const built = await createUnprovenCallTx(
    { zkConfigProvider, publicDataProvider, walletProvider },
    {
      compiledContract,
      contractAddress: S.addr,
      circuitId: 'issueCertificate',
      // Uint<8>/Uint<64> circuit args must be BigInt, never JS numbers.
      args: [ub(BID), eok, SAFE_PCT, CAUTION_PCT],
      initialPrivateState: {},
    },
  );

  const band = Number(built.private.result);
  console.log(`\n   circuit OK -> band ${band}: ${BANDS[band]}`);

  const sent = await proveAndSubmit(built.private.unprovenTx, 'issueCertificate');
  if (sent) {
    S.sh = await waitForAdvance(S.addr, S.sh);
    save();
    console.log('\n   certificate published. Read it back with:  node src/read.mjs');
  }
} catch (e) {
  const msg = String(e.message || e);
  const assertion = msg.match(/failed assert:?\s*([^\n]*)/i)?.[1] ?? msg;
  console.log(`\n   ❌ CIRCUIT REFUSED: ${assertion.slice(0, 120)}`);
  console.log('\n   The forged total does not open the commitment already on chain.');
  console.log('   This failed while the circuit ran on the prover\'s OWN MACHINE:');
  console.log('   no proof was produced, so there was nothing to submit and nothing');
  console.log('   for the network to reject. The lie is unprovable, not merely caught.');
} finally {
  setLie(null);
  await disconnect();
}
process.exit(0);
