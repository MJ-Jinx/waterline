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
import path from 'node:path';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import * as netid from '@midnight-ntwrk/midnight-js-network-id';
import { ledger } from '../build/waterline/contract/index.js';

const cfg = JSON.parse(fs.readFileSync('waterline.config.json', 'utf8'));
const OUT = process.env.SNAPSHOT_OUT || 'site/data/certificates.json';

netid.setNetworkId(cfg.network);
const IDX = `https://indexer.${cfg.network}.midnight.network/api/v4/graphql`;
const IDXWS = `wss://indexer.${cfg.network}.midnight.network/api/v4/graphql/ws`;

const ub = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const hx = (b) => Buffer.from(b).toString('hex');
const BANDS = ['danger', 'caution', 'safe'];

/** Latest on-chain action for the contract — gives us a real block height. */
async function chainTip() {
  const r = await fetch(IDX, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{ contractAction(address: "${cfg.contract}") {
        __typename transaction { hash block { height timestamp } } } }`,
    }),
  });
  const j = await r.json();
  const a = j?.data?.contractAction;
  if (!a) return null;
  return {
    block: a.transaction.block.height,
    timestamp: a.transaction.block.timestamp,
    tx: a.transaction.hash,
  };
}

const provider = indexerPublicDataProvider(IDX, IDXWS);
const state = await provider.queryContractState(cfg.contract);
if (!state) {
  console.error(`Contract ${cfg.contract} is not visible on the ${cfg.network} indexer.`);
  process.exit(1);
}

const l = ledger(state.data);
const tip = await chainTip();

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
  console.log(`  ${b.chip.padEnd(8)} ${
    !b.registered ? 'NOT REGISTERED'
      : !c ? 'registered, no certificate'
      : `${c.band.toUpperCase()} · ${c.fresh ? 'current' : 'STALE'} · commitment ${b.commitment.slice(0, 16)}…`}`);
}
process.exit(0);
