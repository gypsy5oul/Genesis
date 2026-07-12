'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const idx = require('../hooks/graph-index');
const q = require('../hooks/graph-query');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'graph-query-'));
}
function writeSrc(d, relFile, content) {
  const abs = path.join(d, relFile);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
function runCli(args) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'graph-query.js'), ...args], {
    encoding: 'utf8', timeout: 5000
  });
}

test('where reports file:line-line for a known function', () => {
  const d = tmpProject();
  idx.indexFile(d, writeSrc(d, 'src/a.js', 'function f(){\n  return 1;\n}\n'));
  assert.equal(q.where(d, 'f'), 'src/a.js:1-3');
});

test('where reports no data for an unknown symbol', () => {
  const d = tmpProject();
  assert.match(q.where(d, 'nope'), /no data/);
});

test('callers lists every caller of a function', () => {
  const d = tmpProject();
  idx.indexFile(d, writeSrc(d, 'src/a.js',
    'function a(){ return b(); }\nfunction c(){ return b(); }\nfunction b(){ return 1; }\n'));
  const out = q.callers(d, 'b');
  assert.match(out, /a \(src\/a\.js:1\)/);
  assert.match(out, /c \(src\/a\.js:2\)/);
});

test('callers reports no callers found (not no data) for a symbol with zero callers', () => {
  const d = tmpProject();
  idx.indexFile(d, writeSrc(d, 'src/a.js', 'function lonely(){}\n'));
  assert.match(q.callers(d, 'lonely'), /no callers found/);
});

test('imports lists what a file imports', () => {
  const d = tmpProject();
  // b.js must exist on disk before a.js is indexed — import edges only
  // resolve (and persist) against a confirmed on-disk target (Finding 1 fix).
  writeSrc(d, 'src/b.js', 'function f(){}\n');
  idx.indexFile(d, writeSrc(d, 'src/a.js', "import './b.js';\n"));
  assert.equal(q.imports(d, 'src/a.js'), 'src/b.js');
});

test('impact lists direct importers of a file', () => {
  const d = tmpProject();
  const b = writeSrc(d, 'src/b.js', 'function f(){}\n');
  const a = writeSrc(d, 'src/a.js', "import './b.js';\n");
  idx.indexFile(d, b);
  idx.indexFile(d, a);
  assert.equal(q.impact(d, 'src/b.js'), 'src/a.js');
});

test('impact retroactively picks up an import edge once the previously-missing target file is indexed', () => {
  const d = tmpProject();
  const a = writeSrc(d, 'src/a.ts', "import './b';\nfunction f(){}\n");
  idx.indexFile(d, a);
  // src/b.ts isn't tracked yet at all (never indexed) — impact() reports "no
  // data", not "no importers found" (that's for a tracked file with zero
  // importers). Either way, a.ts must NOT show up as an importer yet.
  assert.match(q.impact(d, 'src/b.ts'), /no data/);

  const b = writeSrc(d, 'src/b.ts', 'function g(){}\n');
  idx.indexFile(d, b);
  assert.equal(q.impact(d, 'src/b.ts'), 'src/a.ts');
});

test('where re-parses a file whose content drifted since the last indexed hash (drift check)', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.js', 'function f(){}\n');
  idx.indexFile(d, abs);
  // Simulate a missed incremental update: edit the file WITHOUT calling indexFile.
  fs.writeFileSync(abs, 'function f(){}\nfunction g(){}\n');
  assert.equal(q.where(d, 'g'), 'src/a.js:2-2');
});

test('callers re-parses a file whose content drifted since the last indexed hash (drift check)', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.js', 'function f(){ return b(); }\nfunction b(){}\n');
  idx.indexFile(d, abs);
  // Simulate a missed incremental update: edit the file WITHOUT calling indexFile.
  fs.writeFileSync(abs, 'function f(){ return b(); }\nfunction b(){}\nfunction c(){ return b(); }\n');
  assert.match(q.callers(d, 'b'), /c \(src\/a\.js:3\)/);
});

test('imports re-parses a file whose content drifted since the last indexed hash (drift check)', () => {
  const d = tmpProject();
  writeSrc(d, 'src/b.js', 'function g(){}\n');
  writeSrc(d, 'src/c.js', 'function h(){}\n');
  const abs = writeSrc(d, 'src/a.js', "import './b.js';\n");
  idx.indexFile(d, abs);
  // Simulate a missed incremental update: edit the file WITHOUT calling indexFile.
  fs.writeFileSync(abs, "import './b.js';\nimport './c.js';\n");
  assert.equal(q.imports(d, 'src/a.js'), 'src/b.js\nsrc/c.js');
});

test('impact re-parses a file whose content drifted since the last indexed hash (drift check)', () => {
  const d = tmpProject();
  const c = writeSrc(d, 'src/c.js', 'function h(){}\n');
  const abs = writeSrc(d, 'src/a.js', "import './b.js';\n");
  writeSrc(d, 'src/b.js', 'function g(){}\n');
  idx.indexFile(d, abs);
  idx.indexFile(d, c);
  // Simulate a missed incremental update: edit the file WITHOUT calling indexFile.
  fs.writeFileSync(abs, "import './b.js';\nimport './c.js';\n");
  assert.equal(q.impact(d, 'src/c.js'), 'src/a.js');
});

test('where prunes a tracked file that was deleted from disk (no stale location)', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.js', 'function gone(){}\n');
  idx.indexFile(d, abs);
  assert.equal(q.where(d, 'gone'), 'src/a.js:1-1');
  // Delete the file WITHOUT re-indexing — the incremental hook never fires for
  // an rm/mv done outside an Edit/Write/MultiEdit tool call.
  fs.unlinkSync(abs);
  assert.match(q.where(d, 'gone'), /no data/);
});

test('callers/imports/impact no longer return a location in a deleted file', () => {
  const d = tmpProject();
  writeSrc(d, 'src/b.js', 'function g(){}\n');
  const abs = writeSrc(d, 'src/a.js',
    "import './b.js';\nfunction caller(){ return target(); }\nfunction target(){}\n");
  idx.indexFile(d, writeSrc(d, 'src/b.js', 'function g(){}\n'));
  idx.indexFile(d, abs);
  // Sanity: everything resolves while a.js exists.
  assert.match(q.callers(d, 'target'), /caller \(src\/a\.js:2\)/);
  assert.equal(q.impact(d, 'src/b.js'), 'src/a.js');

  fs.unlinkSync(abs);
  // callers of target: target's own node is gone, so this is now "no data".
  assert.match(q.callers(d, 'target'), /no data/);
  // imports of the deleted file: gone.
  assert.match(q.imports(d, 'src/a.js'), /no data/);
  // impact of b.js: a.js was its only importer and is gone -> no importers.
  assert.match(q.impact(d, 'src/b.js'), /no importers found/);
});

test('deletion pruning is persisted to docs/sdlc/graph.json on disk', () => {
  const store = require('../hooks/graph-store');
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.js', 'function gone(){}\n');
  idx.indexFile(d, abs);
  // The node exists on disk before the query.
  let onDisk = JSON.parse(fs.readFileSync(store.graphPath(d), 'utf8'));
  assert.ok(onDisk.nodes.some(n => n.name === 'gone'), 'precondition: node present on disk');
  assert.ok(onDisk.files['src/a.js'], 'precondition: file tracked on disk');

  fs.unlinkSync(abs);
  q.where(d, 'gone');

  onDisk = JSON.parse(fs.readFileSync(store.graphPath(d), 'utf8'));
  assert.ok(!onDisk.nodes.some(n => n.name === 'gone'), 'node pruned from disk graph');
  assert.ok(!onDisk.files['src/a.js'], 'files entry pruned from disk graph');
});

test('a mix of one deleted and one drifted file is reconciled in one pass', () => {
  const d = tmpProject();
  const aAbs = writeSrc(d, 'src/a.js', 'function goneA(){}\n');
  const bAbs = writeSrc(d, 'src/b.js', 'function keepB(){}\n');
  idx.indexFile(d, aAbs);
  idx.indexFile(d, bAbs);
  // Delete a.js; drift b.js (edit without re-indexing).
  fs.unlinkSync(aAbs);
  fs.writeFileSync(bAbs, 'function keepB(){}\nfunction newB(){}\n');

  // A single query triggers refreshAnyDrifted once and must handle both.
  assert.equal(q.where(d, 'newB'), 'src/b.js:2-2');   // drift re-indexed
  assert.match(q.where(d, 'goneA'), /no data/);        // deletion pruned
});

test('no deleted/drifted files -> fast path, graph.json is not rewritten', () => {
  const store = require('../hooks/graph-store');
  const d = tmpProject();
  idx.indexFile(d, writeSrc(d, 'src/a.js', 'function f(){}\n'));
  const before = fs.statSync(store.graphPath(d)).mtimeMs;
  const beforeJson = fs.readFileSync(store.graphPath(d), 'utf8');
  // Nothing changed on disk since indexing -> refreshAnyDrifted must take the
  // fast path with NO mutateGraph write.
  assert.equal(q.where(d, 'f'), 'src/a.js:1-1');
  const afterJson = fs.readFileSync(store.graphPath(d), 'utf8');
  assert.equal(afterJson, beforeJson, 'graph.json content unchanged on fast path');
  assert.equal(fs.statSync(store.graphPath(d)).mtimeMs, before, 'graph.json not rewritten on fast path');
});

test('CLI where prints the answer and exits 0', () => {
  const d = tmpProject();
  idx.indexFile(d, writeSrc(d, 'src/a.js', 'function f(){}\n'));
  const r = runCli(['where', 'f', '--cwd', d]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /src\/a\.js:1-1/);
});

test('CLI with missing args prints usage and exits 1', () => {
  const r = runCli(['where']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /usage/);
});

// Seeds a valid graph.json with a single node in an UNtracked file (files: {}),
// so graph-query's drift check has nothing to re-index and cannot inadvertently
// clear the oversized marker mid-query.
function seedStaticGraph(d) {
  const g = require('../hooks/graph-store').emptyGraph();
  g.nodes.push({ id: 'src/a.js#f', kind: 'function', name: 'f', file: 'src/a.js', lines: [1, 1] });
  fs.mkdirSync(path.dirname(require('../hooks/graph-store').graphPath(d)), { recursive: true });
  fs.writeFileSync(require('../hooks/graph-store').graphPath(d), JSON.stringify(g, null, 2) + '\n');
}

test('CLI prepends a staleness WARNING line when the oversized status marker is present', () => {
  const store = require('../hooks/graph-store');
  const d = tmpProject();
  seedStaticGraph(d);
  store.writeGraphStatus(d, { oversized: true, attemptedBytes: store.MAX_GRAPH_BYTES + 10, at: '2026-07-13T00:00:00.000Z' });
  const r = runCli(['where', 'f', '--cwd', d]);
  assert.equal(r.status, 0);
  const lines = r.stdout.split('\n');
  assert.match(lines[0], /^# WARNING: code graph exceeds its size cap .* since 2026-07-13 .* may be stale\./);
  assert.match(r.stdout, /src\/a\.js:1-1/, 'the real answer must still be printed below the warning');
});

test('CLI does NOT prepend a warning line when no oversized status marker is present', () => {
  const d = tmpProject();
  seedStaticGraph(d);
  const r = runCli(['where', 'f', '--cwd', d]);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /WARNING/);
  assert.equal(r.stdout.trim(), 'src/a.js:1-1');
});

test('one drift pass handles deleted / drifted / unchanged files each correctly (three-way mix)', () => {
  const d = tmpProject();
  const delAbs = writeSrc(d, 'src/del.js', 'function toDelete(){}\n');
  const driftAbs = writeSrc(d, 'src/drift.js', 'function keep(){}\n');
  const sameAbs = writeSrc(d, 'src/same.js', 'function stable(){}\n');
  idx.indexFile(d, delAbs);
  idx.indexFile(d, driftAbs);
  idx.indexFile(d, sameAbs);
  // Mutate disk WITHOUT re-indexing: delete one, drift one, leave one untouched.
  fs.unlinkSync(delAbs);
  fs.writeFileSync(driftAbs, 'function keep(){}\nfunction added(){}\n');

  // A single query drives one refreshAnyDrifted pass that must resolve all three.
  assert.match(q.where(d, 'toDelete'), /no data/);       // deleted -> pruned
  assert.equal(q.where(d, 'added'), 'src/drift.js:2-2');  // drifted -> re-parsed
  assert.equal(q.where(d, 'stable'), 'src/same.js:1-1');  // unchanged -> left alone

  const g = require('../hooks/graph-store').readGraph(d);
  assert.ok(!g.files['src/del.js'], 'deleted file entry removed');
  assert.ok(g.files['src/drift.js'], 'drifted file still tracked');
  assert.ok(g.files['src/same.js'], 'unchanged file still tracked');
});

test('pruning N deleted files in one pass does exactly ONE graph write (batched, not N)', () => {
  const store = require('../hooks/graph-store');
  const d = tmpProject();
  const abs = [
    writeSrc(d, 'src/a.js', 'function a(){}\n'),
    writeSrc(d, 'src/b.js', 'function b(){}\n'),
    writeSrc(d, 'src/c.js', 'function c(){}\n'),
  ];
  for (const a of abs) idx.indexFile(d, a);
  for (const a of abs) fs.unlinkSync(a); // three tracked files vanish at once

  // writeFileSafe commits every graph write with an atomic rename onto graphPath;
  // count those to prove all three deletions collapse into a single mutateGraph.
  const realRename = fs.renameSync;
  let writes = 0;
  fs.renameSync = (from, to) => { if (to === store.graphPath(d)) writes++; return realRename(from, to); };
  try {
    q.refreshAnyDrifted(d, store.readGraph(d));
  } finally {
    fs.renameSync = realRename;
  }
  assert.equal(writes, 1, 'all deleted files must be pruned in a single batched graph write');
});
