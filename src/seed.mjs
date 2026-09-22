// Seed additional live buildings so the site can show all three verdicts
// against real chain data rather than one.
//
//   node src/seed.mjs
//
// Why this exists: `certificates` is a Map keyed by building, so a building
// holds exactly one verdict at a time and issuing a new one overwrites the old.
// The README can truthfully say all three bands ran on preprod, but only the
// last survives on chain. A visitor could therefore only ever see one real
// verdict. Three buildings, one per band, fixes that — the same contract
// answering differently about different books, all readable by anyone.
//
// Re-running is safe: every step is skipped once state.json records it done.
// After this, run `npm run snapshot` to refresh what the site serves.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { ledger } from '../build/waterline/contract/index.js';
import {
  S, save, compiledContract, zkConfigProvider, publicDataProvider, walletProvider,
  proveAndSubmit, waitForAdvance, freshSalt, lastSalt,
  connect, disconnect, ub, hx, won,
} from './common.mjs';

const SAFE_PCT = 70n;
const CAUTION_PCT = 80n;
const BANDS = ['위험 wiheom DANGER', '주의 juui CAUTION', '안전 anjeon SAFE'];

const eok = (n) => BigInt(Math.round(n * 10)) * 10000000n;   // 5.5 -> 550000000n

/**
 * The two buildings to add. Amounts are chosen so each lands in a different
 * band at its own appraisal, which is the whole point: identical machinery,
 * different books, different answers.
 *
 * No real address is ever used. The public label carries no district, no
 * lease count and no amount — only that the entry is live.
 */
const PLAN = [
  {
    key: 'waterline:live:building:2',
    chip: 'Live 2',
    label: 'Live registry entry 2 · Midnight preprod',
    leases: [eok(2.5), eok(2.5)],           // total 5.0억
    appraised: eok(8.0),                    // safe cap 5.6억  -> 안전
    expect: 2,
  },
  {
    key: 'waterline:live:building:3',
    chip: 'Live 3',
    label: 'Live registry entry 3 · Midnight preprod',
    leases: [eok(1.8), eok(1.7), eok(1.7)], // total 5.2억
    appraised: eok(7.0),                    // safe 4.9억, caution 5.6억 -> 주의
    expect: 1,
  },
];

if (!S.addr) {
  console.log('No contract deployed. Run:  node src/registry.mjs');
  process.exit(1);
}

/** Predict the band locally so a wrong plan is caught before spending a proof. */
function bandFor(total, appraised) {
  const load = total * 100n;
  return (load <= appraised * SAFE_PCT ? 1 : 0) + (load <= appraised * CAUTION_PCT ? 1 : 0);
}

for (const p of PLAN) {
  const total = p.leases.reduce((a, b) => a + b, 0n);
  const predicted = bandFor(total, p.appraised);
  if (predicted !== p.expect) {
    console.log(`plan error for ${p.chip}: total ${won(total)} at ${won(p.appraised)} gives band ${predicted}, expected ${p.expect}`);
    process.exit(1);
  }
}
console.log('plan checks out locally; every building lands in its intended band\n');

await connect();

/**
 * Submit one write, wait for the ledger to advance, then record the opening.
 * The salt is chosen before the call so we always know how to open the
 * commitment we are about to create.
 */
async function write(circuitId, args, label, commitLocally, rotateSalt = true) {
  console.log(`   ${label}`);
  if (rotateSalt) freshSalt();
  let built;
  try {
    built = await createUnprovenCallTx(
      { zkConfigProvider, publicDataProvider, walletProvider },
      { compiledContract, contractAddress: S.addr, circuitId, args, initialPrivateState: {} },
    );
  } catch (e) {
    console.log(`      circuit refused: ${String(e.message || e).slice(0, 200)}`);
    return null;
  }
  const result = built.private.result;
  if (!await proveAndSubmit(built.private.unprovenTx, label)) return null;
  S.sh = await waitForAdvance(S.addr, S.sh);
  commitLocally();
  save();
  return result === undefined ? true : result;
}

for (const p of PLAN) {
  const bid = hx(crypto.createHash('sha256').update(p.key).digest());
  const total = p.leases.reduce((a, b) => a + b, 0n);
  console.log(`\n=== ${p.chip}  ${bid.slice(0, 16)}…  target ${BANDS[p.expect]} ===`);

  // ---- open
  if (!S.buildings[bid]) {
    const ok = await write('openBuilding', [ub(bid)], 'openBuilding', () => {
      S.buildings[bid] = { total: '0', count: '0', salt: hx(lastSalt()), liens: '0' };
    });
    if (!ok) { console.log('   stopped'); break; }
  } else {
    console.log('   openBuilding — already done');
  }

  // ---- leases, one at a time, resuming wherever state.json left off
  for (let i = Number(S.buildings[bid].count); i < p.leases.length; i += 1) {
    const amount = p.leases[i];
    const ok = await write('registerLease', [ub(bid), amount], `registerLease ${i + 1}/${p.leases.length} — ${won(amount)}`, () => {
      const cur = S.buildings[bid];
      S.buildings[bid] = {
        ...cur,
        total: String(BigInt(cur.total) + amount),
        count: String(BigInt(cur.count) + 1n),
        salt: hx(lastSalt()),
      };
    });
    if (!ok) { console.log('   stopped'); break; }
  }

  if (BigInt(S.buildings[bid].count) !== BigInt(p.leases.length)) {
    console.log('   leases incomplete; skipping certificate');
    continue;
  }

  // ---- certificate. Reads the commitment, writes only a band: no new salt.
  const band = await write(
    'issueCertificate',
    [ub(bid), p.appraised, SAFE_PCT, CAUTION_PCT],
    `issueCertificate — appraised ${won(p.appraised)}`,
    () => {},
    false,
  );
  if (band === null) { console.log('   stopped'); break; }

  console.log(`   -> band ${Number(band)}: ${BANDS[Number(band)]}`);
  if (Number(band) !== p.expect) {
    console.log(`   *** WARNING: expected ${BANDS[p.expect]}, chain says otherwise ***`);
  }
  console.log(`   books (private): total ${won(total)} across ${p.leases.length} leases`);
}

// ---- register the new buildings in the public config the snapshot reads
const CFG = 'waterline.config.json';
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
let added = 0;
for (const p of PLAN) {
  const bid = hx(crypto.createHash('sha256').update(p.key).digest());
  if (!S.buildings[bid] || cfg.buildings.some((b) => b.id === bid)) continue;
  cfg.buildings.push({ id: bid, chip: p.chip, label: p.label });
  added += 1;
}
// ---- read back what anyone can see on chain: commitments only, no amounts
const st = await publicDataProvider.queryContractState(S.addr);
const l = ledger(st.data);

// Name each chip after the verdict the chain actually returned, not the one we
// intended. "Live 2" tells a visitor nothing, and the whole reason for three
// buildings is that they answer differently — so the chips should say so at a
// glance. Taking the word from the ledger rather than from PLAN also means the
// label cannot drift from the thing it describes: if a band ever came back
// other than planned, the warning above fires and the chip still tells the
// truth.
const CHIP = { 0: 'Live · danger', 1: 'Live · caution', 2: 'Live · safe' };
console.log('\non chain, visible to anyone:');
for (const b of cfg.buildings) {
  const id = ub(b.id);
  const commit = l.buildingState.member(id) ? hx(l.buildingState.lookup(id)) : null;
  const cert = l.certificates.member(id) ? l.certificates.lookup(id) : null;
  if (cert && CHIP[Number(cert.band)]) b.chip = CHIP[Number(cert.band)];
  console.log(`  ${b.chip.padEnd(15)} ${commit ? commit.slice(0, 24) + '…' : 'not registered'}  ${
    cert ? `${BANDS[Number(cert.band)]} at ${won(BigInt(cert.appraisedValue))}` : 'no certificate'}`);
}

fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2) + '\n');
console.log(`\n${CFG}: ${added} building(s) added, chips named from the ledger`);

console.log('\nnow run:  npm run snapshot');

await disconnect();
process.exit(0);
