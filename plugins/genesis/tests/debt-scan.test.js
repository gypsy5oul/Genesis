'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const scan = require('../hooks/debt-scan');

test('parseMarkerBody splits ceiling and trigger on the first comma', () => {
  assert.deepEqual(
    scan.parseMarkerBody(' global lock, per-account locks if throughput matters '),
    { ceiling: 'global lock', trigger: 'per-account locks if throughput matters', noTrigger: false }
  );
});

test('parseMarkerBody keeps only the first comma split (trigger text may itself contain a comma)', () => {
  assert.deepEqual(
    scan.parseMarkerBody('naive scan, upgrade when rows exceed 10k, or on first complaint'),
    { ceiling: 'naive scan', trigger: 'upgrade when rows exceed 10k, or on first complaint', noTrigger: false }
  );
});

test('parseMarkerBody with no comma is noTrigger', () => {
  assert.deepEqual(
    scan.parseMarkerBody('quick hack'),
    { ceiling: 'quick hack', trigger: null, noTrigger: true }
  );
});

test('parseMarkerBody with empty body is noTrigger with null ceiling', () => {
  assert.deepEqual(scan.parseMarkerBody('   '), { ceiling: null, trigger: null, noTrigger: true });
});

test('parseMarkerBody with a trailing comma and no trigger text is noTrigger', () => {
  assert.deepEqual(
    scan.parseMarkerBody('quick hack, '),
    { ceiling: 'quick hack', trigger: null, noTrigger: true }
  );
});

test('scanMarkers finds a # marker (Python-style)', () => {
  const found = scan.scanMarkers('def f():\n    x = 1  # genesis: global lock, per-account locks later\n    return x\n');
  assert.deepEqual(found, [{ line: 2, ceiling: 'global lock', trigger: 'per-account locks later', noTrigger: false }]);
});

test('scanMarkers finds a // marker (JS-style) at line start', () => {
  const found = scan.scanMarkers('// genesis: naive O(n^2) scan, upgrade past 10k rows\nfunction f(){}\n');
  assert.deepEqual(found, [{ line: 1, ceiling: 'naive O(n^2) scan', trigger: 'upgrade past 10k rows', noTrigger: false }]);
});

test('scanMarkers finds a -- marker (SQL-style)', () => {
  const found = scan.scanMarkers('SELECT 1; -- genesis: hardcoded id, remove once multi-tenant\n');
  assert.deepEqual(found, [{ line: 1, ceiling: 'hardcoded id', trigger: 'remove once multi-tenant', noTrigger: false }]);
});

test('scanMarkers finds multiple markers on distinct lines', () => {
  const found = scan.scanMarkers('# genesis: a, b\nx = 1\n# genesis: c, d\n');
  assert.deepEqual(found.map(f => f.line), [1, 3]);
});

test('scanMarkers returns empty array when there are no markers', () => {
  assert.deepEqual(scan.scanMarkers('function f(){ return 1; }\n'), []);
});

test('scanMarkers ignores prose that merely mentions the word without a comment prefix', () => {
  assert.deepEqual(scan.scanMarkers('print("genesis: not a marker")\n'), []);
});

// --- Multi-line continuation merging ---------------------------------------

test('scanMarkers merges the real-world 3-line ajv/fastify marker into one row with the trigger captured', () => {
  const source = [
    '// genesis: "ajv" is a transitive dep of fastify (not in package.json) —',
    '// task scope forbids editing package.json here, promote to an explicit',
    '// dependency if fastify ever stops shipping ajv 8.x transitively.',
    ''
  ].join('\n');
  const found = scan.scanMarkers(source);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  assert.equal(found[0].noTrigger, false);
  assert.equal(
    found[0].ceiling,
    '"ajv" is a transitive dep of fastify (not in package.json) — task scope forbids editing package.json here'
  );
  assert.equal(
    found[0].trigger,
    'promote to an explicit dependency if fastify ever stops shipping ajv 8.x transitively.'
  );
});

test('scanMarkers merges a 2-line continuation onto the marker body', () => {
  const source = '// genesis: quick hack, revisit\n// once the vendor SDK ships a stable v2\n';
  const found = scan.scanMarkers(source);
  assert.deepEqual(found, [
    { line: 1, ceiling: 'quick hack', trigger: 'revisit once the vendor SDK ships a stable v2', noTrigger: false }
  ]);
});

test('scanMarkers does NOT merge a marker immediately followed by a second, separate genesis: marker', () => {
  const source = '// genesis: hack one, fix later\n// genesis: hack two, fix later too\n';
  const found = scan.scanMarkers(source);
  assert.deepEqual(found.map(f => f.line), [1, 2]);
  assert.deepEqual(found[0], { line: 1, ceiling: 'hack one', trigger: 'fix later', noTrigger: false });
  assert.deepEqual(found[1], { line: 2, ceiling: 'hack two', trigger: 'fix later too', noTrigger: false });
});

test('scanMarkers does NOT merge across a blank line, even when same-style comments follow', () => {
  const source = '// genesis: hack, fix later\n\n// unrelated comment continuation attempt\n';
  const found = scan.scanMarkers(source);
  assert.deepEqual(found, [
    { line: 1, ceiling: 'hack', trigger: 'fix later', noTrigger: false }
  ]);
});

test('scanMarkers stops merging when a marker is immediately followed by unrelated code', () => {
  const source = '// genesis: hack, fix later\nconst x = 1;\n';
  const found = scan.scanMarkers(source);
  assert.deepEqual(found, [
    { line: 1, ceiling: 'hack', trigger: 'fix later', noTrigger: false }
  ]);
});

test('scanMarkers does NOT merge a following comment line with a different comment style', () => {
  const source = '// genesis: hack, fix later\n# python style comment\n';
  const found = scan.scanMarkers(source);
  assert.deepEqual(found, [
    { line: 1, ceiling: 'hack', trigger: 'fix later', noTrigger: false }
  ]);
});

test('scanMarkers caps continuation merging at a bounded number of lines', () => {
  const lines = ['// genesis: ceiling, trigger start'];
  for (let i = 0; i < 15; i++) lines.push(`// more words ${i}`);
  const found = scan.scanMarkers(lines.join('\n') + '\n');
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  // Only the first 10 continuation lines (0-9) should be merged in.
  assert.ok(found[0].trigger.includes('more words 9'));
  assert.ok(!found[0].trigger.includes('more words 10'));
});
