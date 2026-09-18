// A local simulator for the Waterline contract.
//
// Runs circuits in-process against @midnight-ntwrk/compact-runtime — no node, no
// indexer, no proving, no funds. Circuit asserts fire exactly as they do on a
// real prover's machine, which is the whole point: the attack tests below prove
// a forged opening cannot even be executed, let alone submitted.
//
// Requires a compiled contract. Run `npm run compile` first.

import crypto from 'node:crypto';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../build/waterline/contract/index.js';

export const hx = (b) => Buffer.from(b).toString('hex');
export const bid = (name) => new Uint8Array(crypto.createHash('sha256').update(name).digest());

const COIN = '0'.repeat(64);

/**
 * A registry that keeps its books off-chain, exactly as the real one does.
 *
 * `total`, `count` and `salt` never reach the ledger — only a commitment over
 * them does. Tests can point `forge` at a different opening to play the
 * landlord who understates the total.
 */
export class Registry {
  constructor({ secretKey = crypto.randomBytes(32) } = {}) {
    this.sk = new Uint8Array(secretKey);
    this.books = new Map();       // buildingId hex -> { total, count, salt, liens }
    this.forge = null;            // set to { total, count } to lie about the opening
    this.nextSalt = crypto.randomBytes(32);

    const self = this;
    this.contract = new Contract({
      registry_secret_key: (ctx) => [ctx.privateState, self.sk],
      building_opening: (ctx, id) => {
        if (self.forge) return [ctx.privateState, self.forge];
        const b = self.book(id);
        return [ctx.privateState, { total: b.total, count: b.count }];
      },
      building_salt: (ctx, id) => [ctx.privateState, self.book(id).salt],
      fresh_salt: (ctx) => [ctx.privateState, new Uint8Array(self.nextSalt)],
      senior_liens: (ctx, id) => [ctx.privateState, self.book(id).liens],
    });

    this.address = rt.sampleContractAddress();
    const ctor = this.contract.initialState(rt.createConstructorContext({}, COIN));
    this.state = ctor.currentContractState;
  }

  book(id) {
    const k = hx(id);
    if (!this.books.has(k)) this.books.set(k, { total: 0n, count: 0n, salt: new Uint8Array(32), liens: 0n });
    return this.books.get(k);
  }

  /** The public ledger, as anyone querying the indexer would see it. */
  get ledger() {
    return ledger(this.state.data ?? this.state);
  }

  /**
   * Run a circuit. Throws whatever the circuit throws, so a failed assert
   * surfaces as a rejected call rather than a silent bad state.
   */
  call(circuit, ...args) {
    const ctx = rt.createCircuitContext(this.address, COIN, this.state, {});
    const res = this.contract.impureCircuits[circuit](ctx, ...args);
    this.state = res.context.currentQueryContext.state;
    return res.result;
  }

  openBuilding(id) {
    this.rollSalt();
    this.call('openBuilding', id);
    const b = this.book(id);
    b.salt = new Uint8Array(this.nextSalt);
    return this;
  }

  /** Register a lease and advance the local books in step with the commitment. */
  registerLease(id, deposit) {
    this.rollSalt();
    this.call('registerLease', id, deposit);
    const b = this.book(id);
    b.total += deposit;
    b.count += 1n;
    b.salt = new Uint8Array(this.nextSalt);
    return this;
  }

  issueCertificate(id, appraised, safePct = 70n, cautionPct = 80n) {
    return this.call('issueCertificate', id, appraised, safePct, cautionPct);
  }

  /** Pre-choose the next commitment salt, so we always know how to reopen it. */
  rollSalt() { this.nextSalt = crypto.randomBytes(32); return this; }

  setLiens(id, amount) { this.book(id).liens = amount; return this; }

  /** Play the landlord: claim a different opening for the next call only. */
  withForgedOpening(opening, fn) {
    this.forge = opening;
    try { return fn(); } finally { this.forge = null; }
  }
}

export const BAND = { DANGER: 0n, CAUTION: 1n, SAFE: 2n };
