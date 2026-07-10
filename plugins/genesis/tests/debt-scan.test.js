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
