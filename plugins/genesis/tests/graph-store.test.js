'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('../hooks/graph-store');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'graph-store-'));
}

test('readGraph returns emptyGraph when no file exists', () => {
  const g = store.readGraph(tmpProject());
  assert.deepEqual(g, store.emptyGraph());
});

test('writeGraph then readGraph round-trips', () => {
  const d = tmpProject();
  const g = store.emptyGraph();
  g.nodes.push({ id: 'a.js#f', kind: 'function', name: 'f', file: 'a.js', lines: [1, 2] });
  store.writeGraph(d, g);
  const back = store.readGraph(d);
  assert.equal(back.nodes.length, 1);
  assert.equal(back.nodes[0].name, 'f');
});

test('readGraph returns emptyGraph for a corrupt file instead of throwing', () => {
  const d = tmpProject();
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  fs.writeFileSync(store.graphPath(d), 'not json');
  assert.deepEqual(store.readGraph(d), store.emptyGraph());
});

test('readGraph rejects a symlinked graph file', () => {
  const d = tmpProject();
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  const real = path.join(d, 'real.json');
  fs.writeFileSync(real, JSON.stringify(store.emptyGraph()));
  fs.symlinkSync(real, store.graphPath(d));
  assert.deepEqual(store.readGraph(d), store.emptyGraph());
});

test('writeGraph refuses to write through a symlinked docs directory', () => {
  const d = tmpProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-store-outside-'));
  fs.symlinkSync(outside, path.join(d, 'docs'));
  assert.throws(() => store.writeGraph(d, store.emptyGraph()));
});

test('writeGraph throws instead of writing when the graph exceeds the size cap', () => {
  const d = tmpProject();
  const g = store.emptyGraph();
  g.nodes.push({ id: 'x', kind: 'function', name: 'x'.repeat(store.MAX_GRAPH_BYTES + 1), file: 'a.js', lines: [1, 1] });
  assert.throws(() => store.writeGraph(d, g), /exceeds/);
  assert.equal(fs.existsSync(store.graphPath(d)), false);
});
