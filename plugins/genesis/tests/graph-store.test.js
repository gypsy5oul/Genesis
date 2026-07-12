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

test('emptyGraph includes an empty unresolvedImports array', () => {
  assert.deepEqual(store.emptyGraph().unresolvedImports, []);
});

test('readGraph tolerates an old graph.json with no unresolvedImports field, defaulting to []', () => {
  const d = tmpProject();
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  fs.writeFileSync(store.graphPath(d), JSON.stringify({ version: 1, files: {}, nodes: [], edges: [], skipped: [] }));
  const g = store.readGraph(d);
  assert.deepEqual(g.unresolvedImports, []);
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

test('readGraph rejects a graph.json with "files": null (falls back to emptyGraph, not a corrupted graph object)', () => {
  const d = tmpProject();
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  fs.writeFileSync(store.graphPath(d), JSON.stringify({ version: 1, files: null, nodes: [], edges: [] }));
  assert.deepEqual(store.readGraph(d), store.emptyGraph());
});

test('readGraph rejects a graph.json with "files": [] (array, not a map)', () => {
  const d = tmpProject();
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  fs.writeFileSync(store.graphPath(d), JSON.stringify({ version: 1, files: [], nodes: [], edges: [] }));
  assert.deepEqual(store.readGraph(d), store.emptyGraph());
});

test('readGraph rejects a graph.json missing "version" entirely', () => {
  const d = tmpProject();
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  fs.writeFileSync(store.graphPath(d), JSON.stringify({ files: {}, nodes: [], edges: [] }));
  assert.deepEqual(store.readGraph(d), store.emptyGraph());
});

test('readGraph rejects a graph.json with "version": 2 (incompatible)', () => {
  const d = tmpProject();
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  fs.writeFileSync(store.graphPath(d), JSON.stringify({ version: 2, files: {}, nodes: [], edges: [] }));
  assert.deepEqual(store.readGraph(d), store.emptyGraph());
});

test('writeGraph throws instead of writing when the graph exceeds the size cap', () => {
  const d = tmpProject();
  const g = store.emptyGraph();
  g.nodes.push({ id: 'x', kind: 'function', name: 'x'.repeat(store.MAX_GRAPH_BYTES + 1), file: 'a.js', lines: [1, 1] });
  assert.throws(() => store.writeGraph(d, g), /exceeds/);
  assert.equal(fs.existsSync(store.graphPath(d)), false);
});

test('an over-cap write records an oversized status marker on disk before throwing', () => {
  const d = tmpProject();
  const g = store.emptyGraph();
  g.nodes.push({ id: 'x', kind: 'function', name: 'x'.repeat(store.MAX_GRAPH_BYTES + 1), file: 'a.js', lines: [1, 1] });
  assert.throws(() => store.writeGraph(d, g), /exceeds/);
  const status = store.readGraphStatus(d);
  assert.ok(status, 'a status marker must exist after an over-cap write');
  assert.equal(status.oversized, true);
  assert.ok(status.attemptedBytes > store.MAX_GRAPH_BYTES);
  assert.equal(typeof status.at, 'string');
  // The marker itself is tiny — it fits trivially under any cap.
  assert.ok(fs.statSync(store.graphStatusPath(d)).size < 1000);
});

test('a later successful write clears a previously-set oversized status marker', () => {
  const d = tmpProject();
  // Simulate a prior oversized episode by writing the marker directly.
  store.writeGraphStatus(d, { oversized: true, attemptedBytes: store.MAX_GRAPH_BYTES + 10, at: new Date().toISOString() });
  assert.ok(store.readGraphStatus(d), 'sanity: marker present before the successful write');
  const g = store.emptyGraph();
  g.nodes.push({ id: 'a.js#f', kind: 'function', name: 'f', file: 'a.js', lines: [1, 1] });
  store.writeGraph(d, g); // fits under the cap → must clear the marker
  assert.equal(store.readGraphStatus(d), null, 'the marker must be cleared once a write succeeds');
  assert.equal(fs.existsSync(store.graphStatusPath(d)), false);
});
