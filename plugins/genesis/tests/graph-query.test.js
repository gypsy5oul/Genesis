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
