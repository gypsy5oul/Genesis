'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('../hooks/debt-store');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'debt-store-'));
}

test('readDebt returns empty debt when no file exists', () => {
  const d = tmpProject();
  assert.deepEqual(store.readDebt(d), { version: 1, items: [] });
});

test('readDebt returns empty debt for a corrupted file', () => {
  const d = tmpProject();
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  fs.writeFileSync(store.debtPath(d), 'not json');
  assert.deepEqual(store.readDebt(d), { version: 1, items: [] });
});

test('readDebt returns empty debt for an oversized file', () => {
  const d = tmpProject();
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  const big = JSON.stringify({ version: 1, items: [] }) + ' '.repeat(store.MAX_DEBT_BYTES + 1);
  fs.writeFileSync(store.debtPath(d), big);
  assert.deepEqual(store.readDebt(d), { version: 1, items: [] });
});

test('mutateDebt writes and reads back a roundtrip', () => {
  const d = tmpProject();
  store.mutateDebt(d, (debt) => ({
    debt: { ...debt, items: [{ file: 'a.py', line: 1, ceiling: 'x', trigger: 'y', noTrigger: false, addedAt: 'now' }] },
    result: null,
  }));
  const after = store.readDebt(d);
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].file, 'a.py');
});

test('reconcileFileMarkers adds new rows for found markers', () => {
  const d = tmpProject();
  store.reconcileFileMarkers(d, 'a.py', [{ line: 3, ceiling: 'hack', trigger: 'later', noTrigger: false }]);
  const items = store.readDebt(d).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].file, 'a.py');
  assert.equal(items[0].line, 3);
  assert.equal(items[0].ceiling, 'hack');
  assert.equal(typeof items[0].addedAt, 'string');
});

test('reconcileFileMarkers preserves addedAt when a marker is unchanged on re-scan', () => {
  const d = tmpProject();
  store.reconcileFileMarkers(d, 'a.py', [{ line: 3, ceiling: 'hack', trigger: 'later', noTrigger: false }]);
  const firstAddedAt = store.readDebt(d).items[0].addedAt;
  store.reconcileFileMarkers(d, 'a.py', [{ line: 3, ceiling: 'hack', trigger: 'later', noTrigger: false }]);
  const secondAddedAt = store.readDebt(d).items[0].addedAt;
  assert.equal(secondAddedAt, firstAddedAt);
});

test('reconcileFileMarkers updates addedAt when ceiling/trigger text changes', () => {
  const d = tmpProject();
  store.reconcileFileMarkers(d, 'a.py', [{ line: 3, ceiling: 'hack', trigger: 'later', noTrigger: false }]);
  const firstAddedAt = store.readDebt(d).items[0].addedAt;
  store.reconcileFileMarkers(d, 'a.py', [{ line: 3, ceiling: 'hack v2', trigger: 'later', noTrigger: false }]);
  const items = store.readDebt(d).items;
  assert.equal(items[0].ceiling, 'hack v2');
  assert.ok(items[0].addedAt >= firstAddedAt);
});

test('reconcileFileMarkers drops a row whose line no longer has a marker', () => {
  const d = tmpProject();
  store.reconcileFileMarkers(d, 'a.py', [
    { line: 3, ceiling: 'hack', trigger: 'later', noTrigger: false },
    { line: 8, ceiling: 'hack2', trigger: 'later2', noTrigger: false },
  ]);
  store.reconcileFileMarkers(d, 'a.py', [{ line: 8, ceiling: 'hack2', trigger: 'later2', noTrigger: false }]);
  const items = store.readDebt(d).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].line, 8);
});

test('reconcileFileMarkers never touches another file\'s rows', () => {
  const d = tmpProject();
  store.reconcileFileMarkers(d, 'a.py', [{ line: 1, ceiling: 'x', trigger: 'y', noTrigger: false }]);
  store.reconcileFileMarkers(d, 'b.py', [{ line: 1, ceiling: 'p', trigger: 'q', noTrigger: false }]);
  store.reconcileFileMarkers(d, 'a.py', []);
  const items = store.readDebt(d).items;
  assert.deepEqual(items.map(i => i.file), ['b.py']);
});

test('reconcileFileMarkers records a noTrigger row without dropping it', () => {
  const d = tmpProject();
  store.reconcileFileMarkers(d, 'a.py', [{ line: 1, ceiling: 'quick hack', trigger: null, noTrigger: true }]);
  const items = store.readDebt(d).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].noTrigger, true);
});
