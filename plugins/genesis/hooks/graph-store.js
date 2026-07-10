'use strict';
const fs = require('fs');
const path = require('path');
const { writeFileSafe, withLock } = require('./safe-fs');

const MAX_GRAPH_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 1 * 1024 * 1024;

function graphPath(cwd) { return path.join(cwd, 'docs', 'sdlc', 'graph.json'); }

function emptyGraph() {
  return { version: 1, files: {}, nodes: [], edges: [], skipped: [] };
}

function readGraph(cwd) {
  try {
    const p = graphPath(cwd);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_GRAPH_BYTES) return emptyGraph();
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!data || typeof data !== 'object' ||
        data.files === null || Array.isArray(data.files) || typeof data.files !== 'object' ||
        data.version !== 1 ||
        !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return emptyGraph();
    if (!Array.isArray(data.skipped)) data.skipped = [];
    return data;
  } catch {
    return emptyGraph();
  }
}

function writeGraphUnlocked(cwd, graph) {
  const json = JSON.stringify(graph, null, 2) + '\n';
  if (Buffer.byteLength(json) > MAX_GRAPH_BYTES) {
    throw new Error(`graph exceeds ${MAX_GRAPH_BYTES}-byte cap (${Buffer.byteLength(json)} bytes) — not written`);
  }
  writeFileSafe(cwd, graphPath(cwd), json, { backup: false });
}

function writeGraph(cwd, graph) {
  withLock(graphPath(cwd) + '.lock', () => writeGraphUnlocked(cwd, graph));
}

// Read-modify-write under a single lock acquisition — readGraph()+writeGraph()
// called separately (as indexFile() originally did) leaves a window where a
// second process reads the same pre-mutation graph and its write clobbers the
// first's update (a lost update, the same class of bug approveStage's own
// read-mutate-write in sdlc-state.js guards against with a single withLock).
// `mutator(graph)` returns `{graph: <new graph to persist>, result: <value
// mutateGraph returns to its caller>}`.
function mutateGraph(cwd, mutator) {
  return withLock(graphPath(cwd) + '.lock', () => {
    const graph = readGraph(cwd);
    const { graph: nextGraph, result } = mutator(graph);
    writeGraphUnlocked(cwd, nextGraph);
    return result;
  });
}

module.exports = { graphPath, emptyGraph, readGraph, writeGraph, mutateGraph, MAX_GRAPH_BYTES, MAX_FILE_BYTES };
