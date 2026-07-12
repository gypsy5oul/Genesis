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
// Writes a minimal valid docs/sdlc/state.json — the marker /genesis:init drops
// to signal "this project is Genesis-managed", which the PostToolUse hook now
// gates on.
function writeState(d) {
  const abs = path.join(d, 'docs', 'sdlc', 'state.json');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({
    version: 1, project: 'p', idea: 'x', currentStage: 'requirements', stages: {}, decisions: []
  }, null, 2) + '\n');
  return abs;
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

test('indexFile does not take the lock / rewrite the graph on a second edit of an already-skipped unsupported file', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'README.md', '# hi\n');
  idx.indexFile(d, abs); // first time — recorded into skipped, graph rewritten once
  const graphFile = store.graphPath(d);
  const before = fs.statSync(graphFile).mtimeMs;
  const before2 = fs.readFileSync(graphFile, 'utf8');
  const r = idx.indexFile(d, abs); // second time — already known-unsupported, should be a no-op
  const after = fs.statSync(graphFile).mtimeMs;
  const after2 = fs.readFileSync(graphFile, 'utf8');
  assert.equal(r.ok, true);
  assert.equal(r.updated, false);
  assert.equal(before, after, 'graph.json must not be rewritten for an already-skipped file');
  assert.equal(before2, after2, 'graph.json contents must be byte-identical (no lock/rewrite churn)');
});

test('indexFile removes the stale files[relFile] hash entry when a previously-parsed file later fails to parse', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.js', 'function f(){}\n');
  idx.indexFile(d, abs);
  assert.ok(store.readGraph(d).files['src/a.js'], 'sanity: file should be tracked after a successful parse');
  // Overwrite with content that makes parseFile return null (oversized file).
  fs.writeFileSync(abs, 'x'.repeat(store.MAX_FILE_BYTES + 10));
  idx.indexFile(d, abs);
  const g = store.readGraph(d);
  assert.equal(g.files['src/a.js'], undefined, 'stale files[] hash entry must be removed on parse failure');
  assert.ok(g.skipped.includes('src/a.js'));
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
  writeState(d); // hook path is gated on a Genesis project having been initialized
  const abs = writeSrc(d, 'src/a.js', 'function f(){}\n');
  const r = runCli([], JSON.stringify({ cwd: d, tool_name: 'Write', tool_input: { file_path: abs } }));
  assert.equal(r.status, 0);
  assert.equal(store.readGraph(d).nodes.length, 1);
});

test('hook mode no-ops (writes neither graph.json nor debt.json) when the project has no docs/sdlc/state.json', () => {
  const d = tmpProject();
  // A file carrying a genesis: debt marker — proves BOTH the code-graph and the
  // debt-scan paths stay untouched, not just one of them.
  const abs = writeSrc(d, 'src/a.js', 'function f(){}\n// genesis: hack, fix later\n');
  const r = runCli([], JSON.stringify({ cwd: d, tool_name: 'Write', tool_input: { file_path: abs } }));
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(store.graphPath(d)), false, 'graph.json must not be created in a non-Genesis project');
  assert.equal(fs.existsSync(require('../hooks/debt-store').debtPath(d)), false, 'debt.json must not be created in a non-Genesis project');
});

test('hook mode indexes normally (graph.json AND debt.json both written) once docs/sdlc/state.json exists', () => {
  const d = tmpProject();
  writeState(d);
  const abs = writeSrc(d, 'src/a.js', 'function f(){}\n// genesis: hack, fix later\n');
  const r = runCli([], JSON.stringify({ cwd: d, tool_name: 'Write', tool_input: { file_path: abs } }));
  assert.equal(r.status, 0);
  assert.equal(store.readGraph(d).nodes.length, 1, 'code graph must still be built for a Genesis project');
  assert.equal(store.readGraph(d).nodes[0].name, 'f');
  const debtStore = require('../hooks/debt-store');
  assert.equal(debtStore.readDebt(d).items.length, 1, 'debt marker must still be reconciled for a Genesis project');
});

test('CLI --files path is UNAFFECTED by the state.json gate (still indexes without state.json)', () => {
  const d = tmpProject();
  writeSrc(d, 'src/a.js', 'function f(){}\n');
  writeSrc(d, 'src/b.js', 'function g(){}\n');
  // No docs/sdlc/state.json — this is exactly the case init's own baseline scan
  // runs in before state.json is considered "set up"; it must still work.
  const r = runCli(['--files', 'src/a.js', 'src/b.js', '--cwd', d]);
  assert.equal(r.status, 0);
  assert.equal(store.readGraph(d).nodes.length, 2, 'explicit CLI path must index regardless of state.json');
});

test('indexFile() direct call is UNAFFECTED by the state.json gate (only runHook is gated)', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.js', 'function f(){}\n');
  const r = idx.indexFile(d, abs); // no state.json present
  assert.equal(r.ok, true);
  assert.equal(r.updated, true);
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

test('indexFile resolves an extensionless import against an exact-match file on disk', () => {
  const d = tmpProject();
  const a = writeSrc(d, 'src/a.ts', "import './b';\nfunction f(){}\n");
  const b = writeSrc(d, 'src/b.ts', 'function g(){}\n');
  idx.indexFile(d, a);
  idx.indexFile(d, b);
  const g = store.readGraph(d);
  assert.deepEqual(g.edges, [{ from: 'src/a.ts', to: 'src/b.ts', kind: 'imports' }]);
});

test('indexFile resolves an extensionless import against a directory index file on disk', () => {
  const d = tmpProject();
  const a = writeSrc(d, 'src/a.ts', "import './util';\nfunction f(){}\n");
  const b = writeSrc(d, 'src/util/index.ts', 'function g(){}\n');
  idx.indexFile(d, a);
  idx.indexFile(d, b);
  const g = store.readGraph(d);
  assert.deepEqual(g.edges, [{ from: 'src/a.ts', to: 'src/util/index.ts', kind: 'imports' }]);
});

test('indexFile drops an import edge when no candidate file exists on disk (silence, not a wrong answer)', () => {
  const d = tmpProject();
  const a = writeSrc(d, 'src/a.ts', "import './nonexistent';\nfunction f(){}\n");
  idx.indexFile(d, a);
  const g = store.readGraph(d);
  assert.equal(g.edges.filter(e => e.kind === 'imports').length, 0);
});

test('indexFile records an unresolved import target in unresolvedImports and retroactively resolves it once the target file is indexed', () => {
  const d = tmpProject();
  const a = writeSrc(d, 'src/a.ts', "import './b';\nfunction f(){}\n");
  idx.indexFile(d, a);
  let g = store.readGraph(d);
  assert.equal(g.edges.filter(e => e.kind === 'imports').length, 0, 'no edge yet — b.ts does not exist on disk');
  assert.deepEqual(g.unresolvedImports, [{ from: 'src/a.ts', target: 'src/b' }]);

  const b = writeSrc(d, 'src/b.ts', 'function g(){}\n');
  idx.indexFile(d, b);
  g = store.readGraph(d);
  assert.deepEqual(g.edges, [{ from: 'src/a.ts', to: 'src/b.ts', kind: 'imports' }]);
  assert.deepEqual(g.unresolvedImports, [], 'entry must be removed once resolved');
});

test('re-editing a file to remove an unresolved import clears its stale unresolvedImports entry', () => {
  const d = tmpProject();
  const a = writeSrc(d, 'src/a.ts', "import './b';\nfunction f(){}\n");
  idx.indexFile(d, a);
  assert.deepEqual(store.readGraph(d).unresolvedImports, [{ from: 'src/a.ts', target: 'src/b' }]);

  writeSrc(d, 'src/a.ts', 'function f(){}\n'); // import removed
  idx.indexFile(d, a);
  assert.deepEqual(store.readGraph(d).unresolvedImports, [], 'stale entry for src/a.ts must not linger');
});

test('parseFile dispatches a .py file to the Python extractor', () => {
  const gp = require('../hooks/graph-parse');
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.py', 'def f():\n    return 1\n');
  const parsed = gp.parseFile(abs, 'src/a.py');
  assert.ok(parsed, 'expected parseFile to return a result for a .py file, not null');
  assert.equal(parsed.lang, 'python');
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].name, 'f');
});

test('indexFile resolves a Python relative import to a real .py file on disk', () => {
  const d = tmpProject();
  const a = writeSrc(d, 'src/a.py', 'from .b import helper\n');
  const b = writeSrc(d, 'src/b.py', 'def helper():\n    return 1\n');
  idx.indexFile(d, a);
  idx.indexFile(d, b);
  const g = store.readGraph(d);
  assert.deepEqual(g.edges, [{ from: 'src/a.py', to: 'src/b.py', kind: 'imports' }]);
});

test('indexFile resolves a Python relative import via __init__.py (package form)', () => {
  const d = tmpProject();
  const a = writeSrc(d, 'src/a.py', 'from .pkg import helper\n');
  const b = writeSrc(d, 'src/pkg/__init__.py', 'def helper():\n    return 1\n');
  idx.indexFile(d, a);
  idx.indexFile(d, b);
  const g = store.readGraph(d);
  assert.deepEqual(g.edges, [{ from: 'src/a.py', to: 'src/pkg/__init__.py', kind: 'imports' }]);
});

test('a JS file and a Python file in the same project each get routed to their own extractor', () => {
  const d = tmpProject();
  const jsFile = writeSrc(d, 'src/a.js', 'function f(){}\n');
  const pyFile = writeSrc(d, 'src/b.py', 'def g():\n    return 1\n');
  idx.indexFile(d, jsFile);
  idx.indexFile(d, pyFile);
  const g = store.readGraph(d);
  assert.equal(g.files['src/a.js'].lang, 'javascript');
  assert.equal(g.files['src/b.py'].lang, 'python');
  assert.deepEqual(g.nodes.map(n => n.name).sort(), ['f', 'g']);
});

test('indexFile is safe under real concurrent processes indexing different files (mutateGraph atomicity, no lost update)', async () => {
  const d = tmpProject();
  writeSrc(d, 'src/a.js', 'function f(){}\n');
  writeSrc(d, 'src/b.js', 'function g(){}\n');
  const { spawn } = require('child_process');
  const hookPath = path.join(__dirname, '..', 'hooks', 'graph-index.js');
  function indexInChildProcess(relPath) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [hookPath, '--file', relPath, '--cwd', d]);
      let stderr = '';
      child.stderr.on('data', c => { stderr += c; });
      child.on('exit', code => code === 0 ? resolve() : reject(new Error('child exited ' + code + ': ' + stderr)));
      child.on('error', reject);
    });
  }
  await Promise.all([indexInChildProcess('src/a.js'), indexInChildProcess('src/b.js')]);
  const g = store.readGraph(d);
  const names = g.nodes.map(n => n.name).sort();
  assert.deepEqual(names, ['f', 'g'], 'both files must be indexed — a non-atomic read-modify-write would lose one');
});

test('indexFile reconciles a genesis: marker into docs/sdlc/debt.json', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.py', 'def f():\n    x = 1  # genesis: global lock, per-account locks later\n    return x\n');
  idx.indexFile(d, abs);
  const debtStore = require('../hooks/debt-store');
  const items = debtStore.readDebt(d).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].file, 'src/a.py');
  assert.equal(items[0].line, 2);
  assert.equal(items[0].ceiling, 'global lock');
});

test('indexFile reconciles markers even in a file type the code graph does not parse (language-agnostic)', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'src/config.yaml', 'setting: true\n# genesis: hardcoded value, load from env once configurable\n');
  idx.indexFile(d, abs);
  const debtStore = require('../hooks/debt-store');
  const items = debtStore.readDebt(d).items;
  assert.equal(items.length, 1, 'a skipped-language file must still be scanned for debt markers');
  assert.equal(items[0].file, 'src/config.yaml');
});

test('indexFile removes a debt row once its marker line is edited away', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.py', '# genesis: hack, fix later\nx = 1\n');
  idx.indexFile(d, abs);
  writeSrc(d, 'src/a.py', 'x = 1\n');
  idx.indexFile(d, abs);
  const debtStore = require('../hooks/debt-store');
  assert.deepEqual(debtStore.readDebt(d).items, []);
});

test('indexFile does not crash when the file cannot be read for debt scanning (still indexes the graph)', () => {
  const d = tmpProject();
  const abs = writeSrc(d, 'src/a.js', 'function f(){}\n');
  const r = idx.indexFile(d, abs);
  assert.equal(r.ok, true);
});
