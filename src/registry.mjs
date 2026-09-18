// Registry side (stands in for 주민센터): deploy the contract, open a building,
// and register two tenant leases. Every write is proven, dust-sponsored and
// submitted — nothing here costs the operator anything.
//
//   node src/registry.mjs
//
// Re-running is safe: progress is persisted to state.json and each step is
// skipped once done.

import * as led from '@midnight-ntwrk/ledger-v8';
import { createUnprovenDeployTx, createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import {
  S, save, BID, building, compiledContract, zkConfigProvider, publicDataProvider,
  walletProvider, sponsorAndSubmit, stateHash, waitForAdvance, freshSalt, lastSalt,
  connect, disconnect, wait, ub, hx, won,
} from './common.mjs';

const TENANT_A = 300000000n; // ₩3.0억 (300 million won)
const TENANT_B = 250000000n; // ₩2.5억 (250 million won)

await connect();
console.log(`building  ${BID.slice(0, 16)}…  (서울 관악구 다가구 101 — Gwanak-gu, Seoul: multi-household house 101)`);
console.log('amounts shown in 억 (eok) = 100 million won\n');

// ---------------------------------------------------------------- 1. deploy
if (!S.addr) {
  console.log('\n[1] deploy registry contract');
  const dep = await createUnprovenDeployTx(
    { zkConfigProvider, walletProvider },
    { compiledContract, initialPrivateState: {}, signingKey: led.sampleSigningKey() },
  );
  S.addr = dep.public.contractAddress;
  save();
  console.log(`      contract ${S.addr}`);
  // The unproven transaction is on .private, not .public.
  if (!await sponsorAndSubmit(dep.private.unprovenTx, 'deploy')) process.exit(1);

  let h = null;
  for (let i = 0; i < 50 && !h; i += 1) { await wait(6000); h = await stateHash(S.addr); }
  console.log(`      visible on indexer: ${Boolean(h)}`);
  S.sh = h;
  save();
} else {
  console.log(`\n[1] reusing contract ${S.addr}`);
}

/**
 * Build a write call, submit it, wait for the ledger to advance, then record the
 * new opening locally. The salt is pre-chosen so we always know how to open the
 * commitment we just created.
 */
async function write(circuitId, args, label, commitLocally) {
  console.log(`\n${label}`);
  freshSalt();
  let built;
  try {
    built = await createUnprovenCallTx(
      { zkConfigProvider, publicDataProvider, walletProvider },
      { compiledContract, contractAddress: S.addr, circuitId, args, initialPrivateState: {} },
    );
  } catch (e) {
    console.log(`      circuit refused: ${String(e.message || e).slice(0, 200)}`);
    return false;
  }
  if (!await sponsorAndSubmit(built.private.unprovenTx, label)) return false;
  S.sh = await waitForAdvance(S.addr, S.sh);
  commitLocally();
  save();
  return true;
}

// ---------------------------------------------------------------- 2. open
if (!building()) {
  await write('openBuilding', [ub(BID)], '[2] openBuilding — registry opens the building ledger', () => {
    S.buildings[BID] = { total: '0', count: '0', salt: hx(lastSalt()), liens: '0' };
  });
}

// ---------------------------------------------------------------- 3 & 4. leases
if (building() && BigInt(building().count) === 0n) {
  await write('registerLease', [ub(BID), TENANT_A], `[3] registerLease — tenant A deposit ${won(TENANT_A)}`, () => {
    S.buildings[BID] = { ...building(), total: String(TENANT_A), count: '1', salt: hx(lastSalt()) };
  });
}
if (building() && BigInt(building().count) === 1n) {
  await write('registerLease', [ub(BID), TENANT_B], `[4] registerLease — tenant B deposit ${won(TENANT_B)}`, () => {
    S.buildings[BID] = {
      ...building(), total: String(TENANT_A + TENANT_B), count: '2', salt: hx(lastSalt()),
    };
  });
}

// ---------------------------------------------------------------- summary
const b = building();
if (b) {
  console.log(`\n   registry books (PRIVATE, never on chain): total=${won(BigInt(b.total))} across ${b.count} leases`);
  console.log(`   on chain, anyone can see only: ${(await stateHash(S.addr)).slice(0, 32)}… (opaque commitment)`);
  console.log('\n   now run:  node src/verify.mjs');
}

await disconnect();
process.exit(0);
