// Every action this contract has ever taken on chain, with its transaction.
//
//   npm run chain            # refresh site/data/chain.json and print it
//   node src/chain-log.mjs --json
//
// Why this exists: the README recorded transaction hashes TRUNCATED, and
// nothing else stored them, so the one piece of evidence a judge would most
// want to click — "show me this actually happened" — could not be linked. Worse,
// what it recorded was the SUBSTRATE EXTRINSIC hash returned by
// `sendMnTransaction(...).send()`, which is not the Midnight transaction hash
// the explorer indexes. Those hashes were real and unfindable. The indexer had
// kept the whole history, so nothing had to be re-run to recover it.
//
// `contractAction` over HTTP returns only the LATEST action, and a block offset
// has to name a height where an action actually landed — which you cannot know
// in advance. So the full history is a subscription, and this is the only
// script here that opens a websocket purely to read. It hangs up once the
// stream goes quiet, because a subscription has no "you are now caught up"
// message.
//
// The output is committed, and CI does not run this: the history only changes
// when the registry writes, which is a deliberate act. Re-run it after a write.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { ledger } from '../build/waterline/contract/index.js';
import { IDXWS, NETWORK } from './common.mjs';
import cfg from '../waterline.config.json' with { type: 'json' };

const QUIET_MS = 4000;
const OUT = process.env.CHAIN_OUT || 'site/data/chain.json';

const history = (address) => new Promise((resolve, reject) => {
  const client = createClient({ url: IDXWS, webSocketImpl: WebSocket, retryAttempts: 0 });
  const seen = [];
  let timer;
  const done = (fn, v) => {
    clearTimeout(timer);
    try { client.dispose(); } catch { /* already gone */ }
    fn(v);
  };
  // No "caught up" signal exists, so treat a gap in the stream as the end.
  const nudge = () => {
    clearTimeout(timer);
    timer = setTimeout(() => done(resolve, seen), QUIET_MS);
  };
  nudge();
  client.subscribe(
    {
      query: `subscription($addr: HexEncoded!) {
        contractActions(address: $addr, offset: { height: 0 }) {
          __typename
          state
          transaction { hash block { height timestamp } }
          ... on ContractCall { entryPoint }
        }
      }`,
      variables: { addr: address },
    },
    {
      next: (msg) => {
        const a = msg.data?.contractActions;
        if (a) seen.push(a);
        nudge();
      },
      error: (e) => done(reject, new Error(JSON.stringify(e).slice(0, 300))),
      complete: () => done(resolve, seen),
    },
  );
});

const actions = await history(cfg.contract);
if (!actions.length) {
  console.error(`No actions for ${cfg.contract} on the ${NETWORK} indexer.`);
  process.exit(1);
}

const txBase = cfg.explorer.replace(/contracts\/$/, 'transactions/');
const hx = (b) => Buffer.from(b).toString('hex');

/**
 * Which building did this action touch?
 *
 * The entry point names the circuit but not its argument, so a bare log cannot
 * say which of three buildings a `registerLease` belonged to — and the README
 * asserted a grouping ("those three rows are one of the buildings") that
 * nothing in the data actually supported. Decoding each action's ledger state
 * and diffing against the previous one settles it from the chain itself.
 *
 * Only public state is read here. The commitment is opaque by construction;
 * the deposits behind it are not on chain in any form.
 */
function readState(hexState) {
  const bytes = Buffer.from(String(hexState).replace(/^0x/, ''), 'hex');
  const l = ledger(rt.ContractState.deserialize(new Uint8Array(bytes)).data);
  const buildings = new Map();
  const certs = new Map();
  for (const [k, v] of l.buildingState) buildings.set(hx(k), hx(v));
  for (const [k, v] of l.certificates) certs.set(hx(k), Number(v.band));
  return { buildings, certs };
}

let prev = { buildings: new Map(), certs: new Map() };
const rows = actions.map((a) => {
  let touched = null;
  let commitment = null;
  let band = null;
  let next = prev;
  try {
    next = readState(a.state);
    for (const [id, commit] of next.buildings) {
      if (prev.buildings.get(id) !== commit) { touched = id; commitment = commit; }
    }
    if (touched === null) {
      for (const [id, b] of next.certs) {
        if (prev.certs.get(id) !== b) { touched = id; band = b; commitment = next.buildings.get(id); }
      }
    } else if (next.certs.has(touched)) {
      band = next.certs.get(touched);
    }
  } catch {
    // A state we cannot decode still has a real transaction worth linking.
  }
  prev = next;

  return {
    // ContractDeploy has no entry point; a call names its circuit directly.
    kind: a.__typename === 'ContractDeploy' ? 'deploy' : 'call',
    entryPoint: a.entryPoint || 'constructor',
    building: touched,
    commitment,
    band: a.entryPoint === 'issueCertificate' ? band : null,
    tx: a.transaction.hash,
    block: a.transaction.block.height,
    at: new Date(a.transaction.block.timestamp).toISOString(),
    explorer: txBase + a.transaction.hash,
  };
});

const out = {
  network: NETWORK,
  contract: cfg.contract,
  contractExplorer: cfg.explorer + cfg.contract,
  takenAt: new Date().toISOString(),
  counts: rows.reduce((acc, r) => { acc[r.entryPoint] = (acc[r.entryPoint] || 0) + 1; return acc; }, {}),
  actions: rows,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${OUT}`);
  console.log(`contract ${cfg.contract}  (${NETWORK})`);
  console.log(`${rows.length} action${rows.length === 1 ? '' : 's'} on chain\n`);
  for (const r of rows) {
    const who = r.building ? `${r.building.slice(0, 10)}…` : '—'.padEnd(11);
    const seal = r.commitment ? `${r.commitment.slice(0, 10)}…` : '';
    console.log(`  ${String(r.block).padStart(9)}  ${r.entryPoint.padEnd(17)} ${who}  ${r.tx.slice(0, 12)}…  ${seal}`);
  }
}
process.exit(0);
