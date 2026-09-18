// Contract behaviour, run against the local simulator.
//
//   npm test
//
// These are the claims the README makes, written as assertions. If the band
// arithmetic drifts, or a forged opening ever becomes executable, this fails.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Registry, BAND, bid, hx } from './harness.mjs';

const EOK = 100000000n;              // 억 — 100 million won
const APPRAISED = 10n * EOK;         // ₩10.0억
const SAFE_CAP = 7n * EOK;           // 70% of appraised
const CAUTION_CAP = 8n * EOK;        // 80%

/** A registry with one open building carrying exactly `total` in deposits. */
function buildingWith(total, { liens = 0n } = {}) {
  const r = new Registry();
  const id = bid('building-' + total + '-' + liens);
  r.openBuilding(id);
  if (total > 0n) r.registerLease(id, total);
  if (liens > 0n) r.setLiens(id, liens);
  return { r, id };
}

test('the registry public key is sealed at construction', () => {
  const r = new Registry();
  const pk = r.ledger.registryPk;
  assert.equal(pk.length, 32, 'registryPk is a 32-byte hash');
  assert.notEqual(hx(pk), '0'.repeat(64), 'and is actually derived, not left zero');

  // A different secret key must produce a different public key, or the key
  // would not bind the registry to the contract at all.
  const other = new Registry();
  assert.notEqual(hx(other.ledger.registryPk), hx(pk));
});

test('openBuilding publishes a commitment and nothing else', () => {
  const r = new Registry();
  const id = bid('gwanak-101');
  r.openBuilding(id);

  assert.equal(r.ledger.buildingState.member(id), true);
  const commitment = r.ledger.buildingState.lookup(id);
  assert.equal(commitment.length, 32, 'the ledger holds a 32-byte commitment');
  assert.equal(r.ledger.certificates.member(id), false, 'no verdict yet');
});

test('registering a lease advances the commitment', () => {
  const r = new Registry();
  const id = bid('advance');
  r.openBuilding(id);
  const before = hx(r.ledger.buildingState.lookup(id));

  r.registerLease(id, 3n * EOK);
  const after = hx(r.ledger.buildingState.lookup(id));

  assert.notEqual(after, before, 'the commitment moves when the books move');
});

test('a stale opening cannot register a lease', () => {
  const r = new Registry();
  const id = bid('stale');
  r.openBuilding(id);
  r.registerLease(id, 3n * EOK);

  // Claim the building is still empty, as it was one lease ago.
  assert.throws(
    () => r.withForgedOpening({ total: 0n, count: 0n }, () => r.registerLease(id, 1n * EOK)),
    /Stale opening/,
    'the circuit refuses an opening that does not match the chain',
  );
});

test('the band boundaries are inclusive at the cap', () => {
  // load <= cap is SAFE, so a building sitting exactly on 70% is still safe.
  const at = buildingWith(SAFE_CAP);
  assert.equal(at.r.issueCertificate(at.id, APPRAISED), BAND.SAFE);

  const over = buildingWith(SAFE_CAP + 1n);
  assert.equal(over.r.issueCertificate(over.id, APPRAISED), BAND.CAUTION,
    'one won over the safe cap drops to CAUTION');

  const atCaution = buildingWith(CAUTION_CAP);
  assert.equal(atCaution.r.issueCertificate(atCaution.id, APPRAISED), BAND.CAUTION,
    'exactly 80% is still CAUTION');

  const overCaution = buildingWith(CAUTION_CAP + 1n);
  assert.equal(overCaution.r.issueCertificate(overCaution.id, APPRAISED), BAND.DANGER,
    'one won over the caution cap is DANGER');
});

test('an empty building is SAFE, and a building over its value is DANGER', () => {
  const empty = buildingWith(0n);
  assert.equal(empty.r.issueCertificate(empty.id, APPRAISED), BAND.SAFE);

  const drowned = buildingWith(12n * EOK);   // 120% of appraised
  assert.equal(drowned.r.issueCertificate(drowned.id, APPRAISED), BAND.DANGER);
});

test('senior liens count against the building', () => {
  // 6억 of deposits alone is SAFE against a 10억 appraisal...
  const without = buildingWith(6n * EOK);
  assert.equal(without.r.issueCertificate(without.id, APPRAISED), BAND.SAFE);

  // ...but a 2억 mortgage ahead of the tenants pushes the same building over.
  const withLien = buildingWith(6n * EOK, { liens: 2n * EOK });
  assert.equal(withLien.r.issueCertificate(withLien.id, APPRAISED), BAND.CAUTION,
    'exposure is deposits plus senior liens, not deposits alone');
});

test('a landlord who understates the total cannot get a certificate', () => {
  const r = new Registry();
  const id = bid('attack');
  r.openBuilding(id);
  r.registerLease(id, 3n * EOK);
  r.registerLease(id, 250000000n);   // ₩2.5억 — total is now ₩5.5억

  // Honestly this building is DANGER against a 6억 appraisal.
  assert.equal(r.issueCertificate(id, 6n * EOK), BAND.DANGER);

  // The lie that would flip it to SAFE cannot be executed at all.
  assert.throws(
    () => r.withForgedOpening({ total: 3n * EOK, count: 1n },
      () => r.issueCertificate(id, 6n * EOK)),
    /Stale opening/,
    'the forged total does not open the commitment already on chain',
  );
});

test('the certificate is bound to the commitment it was computed against', () => {
  const r = new Registry();
  const id = bid('freshness');
  r.openBuilding(id);
  r.registerLease(id, 3n * EOK);
  r.issueCertificate(id, APPRAISED);

  const live = hx(r.ledger.buildingState.lookup(id));
  const cert = r.ledger.certificates.lookup(id);
  assert.equal(hx(cert.boundTo), live, 'fresh: boundTo matches the live commitment');

  // One more lease, and the same certificate is now provably out of date —
  // without the reader learning the count, the total or the salt.
  r.registerLease(id, 1n * EOK);
  const moved = hx(r.ledger.buildingState.lookup(id));
  const stale = r.ledger.certificates.lookup(id);
  assert.notEqual(moved, live, 'the books moved');
  assert.equal(hx(stale.boundTo), live, 'the certificate still points at the old commitment');
  assert.notEqual(hx(stale.boundTo), moved, 'so a reader can detect staleness by comparison');
});

test('the certificate discloses the band and nothing that identifies the total', () => {
  // Two buildings with different books that land in the same band must produce
  // certificates that are identical apart from the commitment they bind to.
  const a = buildingWith(2n * EOK);
  const b = buildingWith(5n * EOK);
  a.r.issueCertificate(a.id, APPRAISED);
  b.r.issueCertificate(b.id, APPRAISED);

  const ca = a.r.ledger.certificates.lookup(a.id);
  const cb = b.r.ledger.certificates.lookup(b.id);

  assert.deepEqual(Object.keys(ca).sort(),
    ['appraisedValue', 'band', 'boundTo', 'cautionPct', 'safePct'],
    'the certificate carries exactly five fields');

  assert.equal(ca.band, cb.band, 'same band');
  assert.equal(ca.appraisedValue, cb.appraisedValue);
  assert.equal(ca.safePct, cb.safePct);
  assert.equal(ca.cautionPct, cb.cautionPct);

  // The only differing field is the opaque commitment.
  assert.notEqual(hx(ca.boundTo), hx(cb.boundTo));

  // And no published field equals either building's true total.
  for (const v of [ca.band, ca.appraisedValue, ca.safePct, ca.cautionPct]) {
    assert.notEqual(v, 2n * EOK);
    assert.notEqual(v, 5n * EOK);
  }
});

test('thresholds are parameters, not constants', () => {
  const { r, id } = buildingWith(5n * EOK);
  // The same books read differently under a stricter policy.
  assert.equal(r.issueCertificate(id, APPRAISED, 70n, 80n), BAND.SAFE);
  assert.equal(r.issueCertificate(id, APPRAISED, 40n, 45n), BAND.DANGER);
});
