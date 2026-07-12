'use strict';
// Simulates a REAL marketplace install: the plugin ships, but the native
// tree-sitter grammars were never `npm install`ed, so they can't be resolved.
// The whole point of the fix is that requiring the hook chain still doesn't
// throw, the code graph silently degrades to a no-op, and the (tree-sitter-
// independent) genesis: debt-marker ledger keeps working.
//
// Technique: patch Module._load to make the four tree-sitter package names
// unresolvable BEFORE any hook module is required in this process. node's test
// runner runs each test file in its own child process, so this interception is
// isolated to this file and cannot affect the other suites (which need the
// real grammars).
const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HIDDEN = new Set(['tree-sitter', 'tree-sitter-javascript', 'tree-sitter-typescript', 'tree-sitter-python']);
const origLoad = Module._load;
Module._load = function (request) {
  if (HIDDEN.has(request)) {
    const err = new Error(`Cannot find module '${request}' — hidden by test to simulate a fresh marketplace install`);
    err.code = 'MODULE_NOT_FOUND';
    throw err;
  }
  return origLoad.apply(this, arguments);
};

// These requires happen WITH the tree-sitter packages hidden. If requiring
// graph-parse (and therefore graph-index, and therefore the whole PostToolUse
// hook) throws here, the module-load error propagates and the test file fails
// to load at all — which is exactly the production bug this fix removes.
let gp, idx, debtStore, store, sessionStart;
let requireError = null;
try {
  gp = require('../hooks/graph-parse');
  idx = require('../hooks/graph-index');
  debtStore = require('../hooks/debt-store');
  store = require('../hooks/graph-store');
  sessionStart = require('../hooks/sdlc-session-start');
} catch (e) {
  requireError = e;
}

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'graph-degraded-'));
}

test('requiring the hook chain does NOT throw when tree-sitter is unavailable', () => {
  assert.equal(requireError, null, requireError && requireError.stack);
  assert.equal(gp.grammarsAvailable(), false, 'grammars must report unavailable in this simulated install');
});

test('grammarFor returns null for every supported language when the grammars are unavailable', () => {
  for (const lang of ['javascript', 'typescript', 'tsx', 'python']) {
    assert.equal(gp.grammarFor(lang), null, `grammarFor(${lang}) must be null, same as an unknown language`);
  }
  assert.equal(gp.grammarFor('cobol'), null);
});

test('parseFile returns null (graceful no-op, not a throw) for a supported extension when grammars are unavailable', () => {
  const d = tmpProject();
  const abs = path.join(d, 'a.py');
  fs.writeFileSync(abs, 'def f():\n    return 1\n');
  assert.equal(gp.parseFile(abs, 'a.py'), null);
});

// The critical, subtlest guarantee: the debt ledger is wired into the SAME
// indexFile as the code graph, but runs BEFORE (and independent of) any
// tree-sitter code path. It must survive the grammars being absent.
test('indexFile still writes the debt row for a .py genesis: marker when tree-sitter is unavailable — while the code graph records nothing', () => {
  const d = tmpProject();
  const abs = path.join(d, 'a.py');
  fs.writeFileSync(abs, 'def f():\n    x = 1  # genesis: global lock, per-account locks later\n    return x\n');

  const r = idx.indexFile(d, abs);
  assert.equal(r.ok, true, 'indexFile must not error when tree-sitter is unavailable');

  const items = debtStore.readDebt(d).items;
  assert.equal(items.length, 1, 'the debt row must still be written without tree-sitter');
  assert.equal(items[0].file, 'a.py');
  assert.equal(items[0].line, 2);
  assert.equal(items[0].ceiling, 'global lock');

  const g = store.readGraph(d);
  assert.equal(g.nodes.length, 0, 'no code-graph nodes exist without the grammars');
  assert.ok(g.skipped.includes('a.py'), 'the unparseable file is recorded as skipped, not errored');
});

test('codegraphNotice fires once for a Genesis-initialized project when grammars are unavailable, then never again', () => {
  const d = tmpProject();
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  fs.writeFileSync(
    path.join(d, 'docs', 'sdlc', 'state.json'),
    JSON.stringify({ project: 'demo', currentStage: 'develop', stages: {} })
  );
  const savedRoot = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = '/opt/plugins/genesis-install';
  try {
    const first = sessionStart.codegraphNotice(d, true);
    assert.ok(first, 'expected a one-time notice on the first session');
    assert.match(first, /npm install/);
    assert.match(first, /\/opt\/plugins\/genesis-install/, 'must name the CLAUDE_PLUGIN_ROOT path, not a hardcoded one');
    assert.ok(fs.existsSync(sessionStart.codegraphNoticePath(d)), 'a persistence marker must be written');

    const second = sessionStart.codegraphNotice(d, true);
    assert.equal(second, null, 'the notice must not repeat once the marker exists');
  } finally {
    if (savedRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = savedRoot;
  }
});

test('codegraphNotice stays silent in a non-Genesis project (no state.json) even when grammars are unavailable', () => {
  const d = tmpProject();
  assert.equal(sessionStart.codegraphNotice(d, false), null);
});
