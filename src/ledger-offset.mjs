// Ask the indexer where the ledger-event streams currently end.
//
//   node src/ledger-offset.mjs
//
// The three wallets do NOT share a position keyspace, which matters when you
// hand-write a sync snapshot:
//
//   unshielded  subscribes with `transactionId` — the same ids you see in
//               `block(offset:{height:N}) { transactions { id } }`, so a block
//               height maps to one over plain HTTP.
//   shielded    subscribes with `zswapLedgerEvents(id:)`
//   dust        subscribes with `dustLedgerEvents(id:)`
//
// Those last two are ledger-event sequence numbers with no HTTP query and no
// mapping to a block height. The only way to read them is to open the
// subscription — but the very first message carries `maxId`, so one message is
// enough. We subscribe at id 0, read one event, and hang up.

import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
import { IDXWS } from './common.mjs';

const firstEvent = (field, id) => new Promise((resolve, reject) => {
  const client = createClient({ url: IDXWS, webSocketImpl: WebSocket, retryAttempts: 0 });
  const done = (fn, v) => { try { client.dispose(); } catch { /* already gone */ } fn(v); };
  const timer = setTimeout(() => done(reject, new Error('timed out')), 30000);
  client.subscribe(
    {
      query: `subscription($id: Int) { ${field}(id: $id) { id maxId protocolVersion } }`,
      variables: { id },
    },
    {
      next: (msg) => { clearTimeout(timer); done(resolve, msg.data?.[field]); },
      error: (e) => { clearTimeout(timer); done(reject, new Error(JSON.stringify(e).slice(0, 300))); },
      complete: () => {},
    },
  );
});

for (const field of ['zswapLedgerEvents', 'dustLedgerEvents']) {
  try {
    const e = await firstEvent(field, 0);
    console.log(`${field.padEnd(20)} first=${e.id}  maxId=${e.maxId}  protocolVersion=${e.protocolVersion}`);
  } catch (err) {
    console.log(`${field.padEnd(20)} failed: ${err.message}`);
  }
}
process.exit(0);
