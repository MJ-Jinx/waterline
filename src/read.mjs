// The tenant-facing read path — everything the /check page needs.
//
//   node src/read.mjs
//
// No wallet, no proving, no prover keys, no transaction. Two ledger lookups
// against the public indexer. This is the exact data contract the web UI binds
// to, so keep it in step with the page.

import crypto from 'node:crypto';
import { ledger } from '../build/waterline/contract/index.js';
import { S, BID, publicDataProvider, ub, won } from './common.mjs';

const BANDS = [
  { ko: '위험', roman: 'wiheom', en: 'DANGER', mark: '⚠️' },
  { ko: '주의', roman: 'juui', en: 'CAUTION', mark: '△' },
  { ko: '안전', roman: 'anjeon', en: 'SAFE', mark: '✅' },
];

if (!S.addr) { console.log('No contract deployed yet. Run: node src/registry.mjs'); process.exit(1); }

const state = await publicDataProvider.queryContractState(S.addr);
if (!state) { console.log('Contract not visible on the indexer yet.'); process.exit(1); }

const l = ledger(state.data);
const bid = ub(BID);

console.log('=== WATERLINE / 워터라인 — building check ===');
console.log(`   contract  ${S.addr.slice(0, 32)}…`);
console.log(`   building  ${BID.slice(0, 16)}…\n`);

if (!l.buildingState.member(bid)) {
  console.log('   NOT REGISTERED — this building has no entry in the registry.');
  console.log('   (a UI should treat this as "unknown", never as "safe")');
  process.exit(0);
}

const commitment = Buffer.from(l.buildingState.lookup(bid)).toString('hex');

if (!l.certificates.member(bid)) {
  console.log('   NO CERTIFICATE — registered, but no verdict published yet.');
  console.log(`   commitment ${commitment.slice(0, 40)}…`);
  process.exit(0);
}

const cert = l.certificates.lookup(bid);
const band = BANDS[Number(cert.band)];
const boundTo = Buffer.from(cert.boundTo).toString('hex');
// Freshness with zero disclosure: if the books moved since issuance, the
// commitment the certificate was bound to no longer matches the live one.
const fresh = boundTo === commitment;

console.log(`   VERDICT   ${band.mark} ${band.ko} ${band.roman} (${band.en})`);
console.log(`   basis     appraised ${won(cert.appraisedValue)}  ·  안전 ≤ ${cert.safePct}%  ·  주의 ≤ ${cert.cautionPct}%`);
console.log(`   freshness ${fresh ? 'CURRENT — books unchanged since issuance' : 'STALE — the books moved; request a new certificate'}`);
console.log(`   bound to  ${boundTo.slice(0, 40)}…`);
console.log(`   live      ${commitment.slice(0, 40)}…`);

console.log('\n   --- what you were told, and what you were not ---');
console.log('   disclosed      : band, appraised value, both thresholds, commitment');
console.log('   NOT disclosed  : individual deposits, total senior deposits,');
console.log('                    number of prior leases, the commitment salt');
console.log('\n   The exact load is unknown to this page by construction. A UI must');
console.log('   therefore render the level as indeterminate — never a precise figure.');

process.exit(0);
