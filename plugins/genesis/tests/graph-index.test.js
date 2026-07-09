'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('../hooks/graph-store');
const idx = require('../hooks/graph-index');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'graph-index-'));
}
function writeSrc(d, relFile, content) {
  const abs = path.join(d, relFile);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
function runCli(args, input) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'graph-index.js'), ...args], {
    input: input || '', encoding: 'utf8', timeout: 5000
  });
}

test('indexFile adds nodes/edges for a new file', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.js', 'function f(){ return 1; }\n');
  const r = idx.indexFile(d, abs);
  assert.equal(r.ok, true);
  assert.equal(r.updated, true);
  const g = store.readGraph(d);
  assert.equal(g.nodes.length, 1);
  assert.equal(g.nodes[0].name, 'f');
  assert.equal(g.files['src/a.js'].lang, 'javascript');
});

test('indexFile replaces prior nodes/edges for the same file (no duplicates)', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.js', 'function f(){}\n');
  idx.indexFile(d, abs);
  writeSrc(d, 'src/a.js', 'function g(){}\n');
  idx.indexFile(d, abs);
  const g = store.readGraph(d);
  assert.equal(g.nodes.length, 1);
  assert.equal(g.nodes[0].name, 'g');
});

test('indexFile does not touch nodes/edges belonging to other files', () => {
  const d = tmpProject();
  const a = writeSrc(d, 'src/a.js', 'function f(){}\n');
  const b = writeSrc(d, 'src/b.js', 'function g(){}\n');
  idx.indexFile(d, a);
  idx.indexFile(d, b);
  writeSrc(d, 'src/a.js', 'function f2(){}\n');
  idx.indexFile(d, a);
  const g = store.readGraph(d);
  const names = g.nodes.map(n => n.name).sort();
  assert.deepEqual(names, ['f2', 'g']);
});

test('indexFile records an unsupported file as skipped, not an error', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'README.md', '# hi\n');
  const r = idx.indexFile(d, abs);
  assert.equal(r.ok, true);
  assert.equal(r.updated, false);
  const g = store.readGraph(d);
  assert.ok(g.skipped.includes('README.md'));
});

test('indexFile refuses a file outside the project root', () => {
  const d = tmpProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-index-outside-'));
  const abs = writeSrc(outside, 'evil.js', 'function f(){}\n');
  const r = idx.indexFile(d, abs);
  assert.equal(r.ok, false);
});

test('CLI --file mode indexes a single file and exits 0', () => {
  const d = tmpProject();
  writeSrc(d, 'src/a.js', 'function f(){}\n');
  const r = runCli(['--file', 'src/a.js', '--cwd', d]);
  assert.equal(r.status, 0);
  assert.equal(store.readGraph(d).nodes.length, 1);
});

test('CLI --files mode indexes multiple files', () => {
  const d = tmpProject();
  writeSrc(d, 'src/a.js', 'function f(){}\n');
  writeSrc(d, 'src/b.js', 'function g(){}\n');
  const r = runCli(['--files', 'src/a.js', 'src/b.js', '--cwd', d]);
  assert.equal(r.status, 0);
  assert.equal(store.readGraph(d).nodes.length, 2);
});

test('hook mode indexes the file named in tool_input.file_path for an Edit/Write/MultiEdit tool', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.js', 'function f(){}\n');
  const r = runCli([], JSON.stringify({ cwd: d, tool_name: 'Write', tool_input: { file_path: abs } }));
  assert.equal(r.status, 0);
  assert.equal(store.readGraph(d).nodes.length, 1);
});

test('hook mode ignores non-Edit/Write/MultiEdit tools and exits 0', () => {
  const d = tmpProject();
  const r = runCli([], JSON.stringify({ cwd: d, tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.equal(r.status, 0);
  assert.deepEqual(store.readGraph(d), store.emptyGraph());
});

test('hook mode exits 0 on garbage stdin', () => {
  const r = runCli([], 'not json');
  assert.equal(r.status, 0);
});

test('indexFile re-indexing the TARGET of a cross-file import does not delete the importing file\'s edge', () => {
  const d = tmpProject();
  const a = writeSrc(d, 'src/a.js', "import './b.js';\nfunction f(){}\n");
  const b = writeSrc(d, 'src/b.js', 'function g(){}\n');
  idx.indexFile(d, a);
  idx.indexFile(d, b);
  const g = store.readGraph(d);
  assert.deepEqual(g.edges, [{ from: 'src/a.js', to: 'src/b.js', kind: 'imports' }]);
});
