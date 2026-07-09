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
    if (!data || typeof data !== 'object' || typeof data.files !== 'object' ||
        !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return emptyGraph();
    if (!Array.isArray(data.skipped)) data.skipped = [];
    return data;
  } catch {
    return emptyGraph();
  }
}

function writeGraph(cwd, graph) {
  const json = JSON.stringify(graph, null, 2) + '\n';
  if (Buffer.byteLength(json) > MAX_GRAPH_BYTES) {
    throw new Error(`graph exceeds ${MAX_GRAPH_BYTES}-byte cap (${Buffer.byteLength(json)} bytes) — not written`);
  }
  withLock(graphPath(cwd) + '.lock', () => {
    writeFileSafe(cwd, graphPath(cwd), json, { backup: false });
  });
}

module.exports = { graphPath, emptyGraph, readGraph, writeGraph, MAX_GRAPH_BYTES, MAX_FILE_BYTES };
