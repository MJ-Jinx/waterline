// Put the Full Demo's key material where the browser can fetch it.
//
//   node src/stage-demo.mjs
//
// Two different kinds of file, treated differently on purpose:
//
//   site/zk/      prover + verifier keys and the compiled IR, 11 MB. Produced
//                 by `npm run compile`, so it is reproducible and GITIGNORED —
//                 committing it would put 11 MB in front of every judge who
//                 clones the repo, and "we clone your repository" is step one
//                 of the judging.
//
//   site/params/  the Plonk SRS, 4.5 MB. NOT reproducible from this repo: it
//                 comes from a Midnight S3 bucket that has timed out on us
//                 repeatedly, so it is committed. A deploy that depends on a
//                 flaky third party to produce a working page is a deploy that
//                 breaks on the day it matters.
//
// The tenant-facing pages load none of this. Only demo.html does, and only
// after someone presses the button.

import fs from 'node:fs';
import path from 'node:path';

const BUILD = 'build/waterline';
const OUT_ZK = 'site/zk';
const OUT_PARAMS = 'site/params';
const CIRCUITS = ['openBuilding', 'registerLease', 'issueCertificate'];

let copied = 0;
let bytes = 0;

function copy(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied += 1;
  bytes += fs.statSync(to).size;
  return true;
}

const missing = [];
for (const c of CIRCUITS) {
  if (!copy(path.join(BUILD, 'keys', `${c}.prover`), path.join(OUT_ZK, `${c}.prover`))) missing.push(`${c}.prover`);
  if (!copy(path.join(BUILD, 'keys', `${c}.verifier`), path.join(OUT_ZK, `${c}.verifier`))) missing.push(`${c}.verifier`);
  if (!copy(path.join(BUILD, 'zkir', `${c}.bzkir`), path.join(OUT_ZK, `${c}.bzkir`))) missing.push(`${c}.bzkir`);
}

// The SRS is committed, so it is normally already in place; copy it from the
// build directory only if someone has just downloaded it there.
for (const k of [13, 14]) {
  const name = `bls_midnight_2p${k}`;
  const target = path.join(OUT_PARAMS, name);
  if (!fs.existsSync(target)) {
    if (!copy(path.join('build/params', name), target)) missing.push(name);
  }
}

if (missing.length) {
  console.log(`missing: ${missing.join(', ')}`);
  console.log('Run `npm run compile` first (and see the note above about the SRS).');
  process.exit(1);
}

console.log(`staged ${copied} file(s), ${(bytes / 1048576).toFixed(1)} MB`);
console.log(`  ${OUT_ZK}/      prover + verifier + IR   (gitignored, rebuilt by npm run compile)`);
console.log(`  ${OUT_PARAMS}/  Plonk SRS                (committed)`);
process.exit(0);
