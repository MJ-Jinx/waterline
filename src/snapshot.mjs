// Read the live ledger and write what the /check page renders.
//
//   node src/snapshot.mjs
//
// Decoding contract state needs the compiled contract, which is why this runs
// here and not in the browser: the tenant page stays a static fetch with no
// WASM, no prover keys and no wallet. The trade is that the page shows a
// snapshot rather than a live read, so the output carries the block height and
// the time it was taken, and the page says so.
//
// Takes nothing secret. Contract address and building ids come from
// waterline.config.json and are both public on chain.

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import * as rt from '@midnight-ntwrk/compact-runtime';
import * as netid from '@midnight-ntwrk/midnight-js-network-id';
import { ledger } from '../build/waterline/contract/index.js';

const cfg = JSON.parse(fs.readFileSync('waterline.config.json', 'utf8'));
const OUT = process.env.SNAPSHOT_OUT || 'site/data/certificates.json';

netid.setNetworkId(cfg.network);
const IDX = `https://indexer.${cfg.network}.midnight.network/api/v4/graphql`;

const ub = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const hx = (b) => Buffer.from(b).toString('hex');
const BANDS = ['danger', 'caution', 'safe'];

/**
 * Fetch the contract's latest action: its serialized state plus the block it
 * landed in, over plain HTTP.
 *
 * Deliberately NOT indexerPublicDataProvider. That opens a graphql-ws
 * subscription, which needs a WebSocket implementation — absent as a global
 * before Node 22, so it worked locally on Node 24 and failed in CI on Node 20.
 * This script issues exactly one query and never subscribes, so the socket was
 * pure cost.
 */
async function fetchAction() {
  const r = await fetch(IDX, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{ contractAction(address: "${cfg.contract}") {
        state transaction { hash block { height timestamp } } } }`,
    }),
  });
  if (!r.ok) throw new Error(`indexer ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  if (j.errors) throw new Error(`indexer: ${JSON.stringify(j.errors).slice(0, 200)}`);
  return j?.data?.contractAction ?? null;
}

const action = await fetchAction();
if (!action) {
  console.error(`Contract ${cfg.contract} is not visible on the ${cfg.network} indexer.`);
  process.exit(1);
}

const stateBytes = Buffer.from(action.state.replace(/^0x/, ''), 'hex');
const contractState = rt.ContractState.deserialize(new Uint8Array(stateBytes));

// A fingerprint of the raw ledger state, so the browser can confirm this
// snapshot still matches the chain without decoding anything. The tenant page
// re-fetches the same field from the indexer, hashes it with SubtleCrypto and
// compares — no WASM, no keys, no wallet, and the visitor watches it happen.
//
// Coarse on purpose: it changes when ANY building is written, not just one. It
// can therefore over-report staleness but never under-report it, which is the
// safe direction for a check whose whole job is to not reassure wrongly.
const stateHash = crypto.createHash('sha256').update(stateBytes).digest('hex');
const l = ledger(contractState.data);
const tip = {
  block: action.transaction.block.height,
  timestamp: action.transaction.block.timestamp,
  tx: action.transaction.hash,
};

const buildings = cfg.buildings.map((b) => {
  const id = ub(b.id);
  const out = { id: b.id, chip: b.chip, label: b.label, registered: l.buildingState.member(id) };
  if (!out.registered) return out;

  out.commitment = hx(l.buildingState.lookup(id));
  if (!l.certificates.member(id)) {
    out.certificate = null;          // registered, but no verdict published yet
    return out;
  }

  const c = l.certificates.lookup(id);
  const boundTo = hx(c.boundTo);
  out.certificate = {
    band: BANDS[Number(c.band)],
    bandIndex: Number(c.band),
    appraisedValue: String(c.appraisedValue),
    safePct: Number(c.safePct),
    cautionPct: Number(c.cautionPct),
    // limit is derived, not disclosed — it follows from appraised value and pct
    limit: String((BigInt(c.appraisedValue) * BigInt(c.safePct)) / 100n),
    boundTo,
    // Freshness with zero disclosure: if the books moved after issuance, the
    // commitment the certificate was computed against no longer matches.
    fresh: boundTo === out.commitment,
  };
  return out;
});

const snapshot = {
  network: cfg.network,
  contract: cfg.contract,
  explorer: cfg.explorer + cfg.contract,
  takenAt: new Date().toISOString(),
  stateHash,
  block: tip?.block ?? null,
  blockTimestamp: tip?.timestamp ?? null,
  buildings,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n');

console.log(`wrote ${OUT}`);
console.log(`  contract ${cfg.contract.slice(0, 16)}…  block ${tip?.block ?? 'unknown'}`);
for (const b of buildings) {
  const c = b.certificate;
  console.log(`  ${b.chip.padEnd(15)} ${
    !b.registered ? 'NOT REGISTERED'
      : !c ? 'registered, no certificate'
      : `${c.band.toUpperCase()} · ${c.fresh ? 'current' : 'STALE'} · commitment ${b.commitment.slice(0, 16)}…`}`);
}
process.exit(0);
