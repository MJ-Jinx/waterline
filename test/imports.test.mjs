// Do the scripts in src/ import things that actually exist?
//
// This exists because they did not. src/seed.mjs was committed calling
// proveAndSubmit while src/common.mjs still exported sponsorAndSubmit, and CI
// stayed green the whole time — the site suite never touches src/, and the
// contract suite drives the contract directly. Nothing ran the write scripts,
// so nothing noticed that one of them could no longer start.
//
// That is the worst shape a break can have for this project, because "clone it
// and run it" is a judging criterion: the failure appears for a stranger on a
// clean machine and for nobody else.
//
// Parsing rather than importing is deliberate. Importing src/common.mjs
// executes it — it writes state.json, derives keys and opens an indexer
// provider — none of which belongs in a unit test. The named exports and named
// imports are both statically declared, so reading them is enough to catch a
// symbol that is not there.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src';
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.mjs'));
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

/** Named exports of a module: `export const x`, `export function y`, `export async function z`. */
function exportsOf(source) {
  const names = new Set();
  const re = /^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of source.matchAll(re)) names.add(m[1]);
  // `export { a, b as c }`
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const as = part.split(/\s+as\s+/);
      const name = (as[1] ?? as[0]).trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Static `import { a, b } from './local.mjs'` bindings, keyed by resolved file. */
function localImportsOf(source) {
  const out = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w.-]+\.mjs)['"]/g;
  for (const m of source.matchAll(re)) {
    const names = m[1]
      .split(',')
      .map((s) => s.split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    out.push({ from: m[2], names });
  }
  return out;
}

const exportsByFile = new Map(files.map((f) => [f, exportsOf(read(f))]));

for (const file of files) {
  test(`${file} imports only symbols that exist`, () => {
    for (const { from, names } of localImportsOf(read(file))) {
      const available = exportsByFile.get(from);
      assert.ok(available, `${file} imports from ./${from}, which is not in ${SRC}/`);
      for (const name of names) {
        assert.ok(
          available.has(name),
          `${file} imports { ${name} } from ./${from}, which does not export it`,
        );
      }
    }
  });
}

test('every src script parses', async () => {
  // Catches a syntax error in a script no other test loads.
  const { execFileSync } = await import('node:child_process');
  for (const file of files) {
    execFileSync(process.execPath, ['--check', path.join(SRC, file)], { stdio: 'pipe' });
  }
});
