'use strict';
const fs = require('fs');
const path = require('path');
const { writeFileSafe, withLock } = require('./safe-fs');

const MAX_GRAPH_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 1 * 1024 * 1024;

function graphPath(cwd) { return path.join(cwd, 'docs', 'sdlc', 'graph.json'); }

// A tiny, always-writable sidecar recording that the last write attempt
// overflowed MAX_GRAPH_BYTES. The main graph write throws (and the caller
// swallows it, per "never block the session on a hook bug"), so without this
// marker the overflow leaves zero on-disk trace and the graph freezes stale
// silently. This file is a few dozen bytes — it fits trivially under any cap —
// so graph-query.js can read it and warn the user their answers may be stale.
function graphStatusPath(cwd) { return path.join(cwd, 'docs', 'sdlc', 'graph-status.json'); }

function readGraphStatus(cwd) {
  try {
    const p = graphStatusPath(cwd);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

function writeGraphStatus(cwd, status) {
  // Best-effort: a status-marker failure must never mask the real reason we're
  // here (the oversized-graph throw the caller is about to receive).
  try {
    writeFileSafe(cwd, graphStatusPath(cwd), JSON.stringify(status, null, 2) + '\n', { backup: false });
  } catch { /* status marker is advisory only */ }
}

function clearGraphStatus(cwd) {
  try { fs.unlinkSync(graphStatusPath(cwd)); } catch { /* absent already — the normal, healthy case */ }
}

function emptyGraph() {
  return { version: 1, files: {}, nodes: [], edges: [], skipped: [], unresolvedImports: [] };
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
    if (!Array.isArray(data.unresolvedImports)) data.unresolvedImports = [];
    return data;
  } catch {
    return emptyGraph();
  }
}

function writeGraphUnlocked(cwd, graph) {
  const json = JSON.stringify(graph, null, 2) + '\n';
  const bytes = Buffer.byteLength(json);
  if (bytes > MAX_GRAPH_BYTES) {
    // Record the overflow on disk BEFORE throwing so the condition survives the
    // caller's catch-and-discard. Then throw as before (no partial/oversized
    // graph gets written).
    writeGraphStatus(cwd, { oversized: true, attemptedBytes: bytes, at: new Date().toISOString() });
    throw new Error(`graph exceeds ${MAX_GRAPH_BYTES}-byte cap (${bytes} bytes) — not written`);
  }
  writeFileSafe(cwd, graphPath(cwd), json, { backup: false });
  // The write fit under the cap — any prior oversized marker is now stale
  // (e.g. pruning stale files brought the graph back under budget), so clear it
  // and stop warning.
  clearGraphStatus(cwd);
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

module.exports = {
  graphPath, emptyGraph, readGraph, writeGraph, mutateGraph, MAX_GRAPH_BYTES, MAX_FILE_BYTES,
  graphStatusPath, readGraphStatus, writeGraphStatus, clearGraphStatus,
};
