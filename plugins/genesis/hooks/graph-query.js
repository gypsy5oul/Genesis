#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { readGraph } = require('./graph-store');
const { indexFile } = require('./graph-index');

function currentHash(absPath) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(absPath)).digest('hex'); } catch { return null; }
}

// If the file backing `relFile` has drifted from the graph's last-known
// hash (the incremental hook missed an update), re-parse just that file
// before answering — a query should never be wrong due to staleness.
function ensureFresh(cwd, graph, relFile) {
  if (!relFile || !graph.files[relFile]) return graph;
  const onDisk = currentHash(path.join(cwd, relFile));
  if (onDisk && onDisk !== graph.files[relFile].hash) {
    indexFile(cwd, path.join(cwd, relFile));
    return readGraph(cwd);
  }
  return graph;
}

function findNodeByName(graph, name) {
  return graph.nodes.filter(n => n.name === name || n.id.endsWith('#' + name));
}

// Fallback drift check for a symbol not (yet) present in the index: a
// brand-new function added to a file the incremental hook missed has no
// existing node to key off of, so ensureFresh(cwd, graph, someFile) can't
// be targeted at it directly. Scan every tracked file's on-disk hash and
// re-parse any that drifted, then the caller retries the name lookup.
function refreshAnyDrifted(cwd, graph) {
  let changed = false;
  for (const relFile of Object.keys(graph.files)) {
    const onDisk = currentHash(path.join(cwd, relFile));
    if (onDisk && onDisk !== graph.files[relFile].hash) {
      indexFile(cwd, path.join(cwd, relFile));
      changed = true;
    }
  }
  return changed ? readGraph(cwd) : graph;
}

function where(cwd, name) {
  let graph = readGraph(cwd);
  let matches = findNodeByName(graph, name);
  if (matches.length) {
    graph = ensureFresh(cwd, graph, matches[0].file);
    matches = findNodeByName(graph, name);
    if (matches.length) return matches.map(n => `${n.file}:${n.lines[0]}-${n.lines[1]}`).join('\n');
  }
  graph = refreshAnyDrifted(cwd, graph);
  matches = findNodeByName(graph, name);
  if (!matches.length) return `no data for "${name}"`;
  return matches.map(n => `${n.file}:${n.lines[0]}-${n.lines[1]}`).join('\n');
}

function callers(cwd, name) {
  const graph = readGraph(cwd);
  const targetIds = findNodeByName(graph, name).map(n => n.id);
  if (!targetIds.length) return `no data for "${name}"`;
  const callerEdges = graph.edges.filter(e => e.kind === 'calls' && targetIds.includes(e.to));
  if (!callerEdges.length) return `no callers found for "${name}"`;
  return callerEdges.map(e => {
    const node = graph.nodes.find(n => n.id === e.from);
    return node ? `${node.name} (${node.file}:${node.lines[0]})` : e.from;
  }).join('\n');
}

function imports(cwd, relFile) {
  const graph = readGraph(cwd);
  if (!graph.files[relFile]) return `no data for "${relFile}"`;
  const out = graph.edges.filter(e => e.kind === 'imports' && e.from === relFile).map(e => e.to);
  return out.length ? out.join('\n') : `no imports found for "${relFile}"`;
}

function impact(cwd, relFile) {
  const graph = readGraph(cwd);
  if (!graph.files[relFile]) return `no data for "${relFile}"`;
  const out = graph.edges.filter(e => e.kind === 'imports' && e.to === relFile).map(e => e.from);
  return out.length ? out.join('\n') : `no importers found for "${relFile}"`;
}

function runCli(argv) {
  const cwdIdx = argv.indexOf('--cwd');
  const cwd = cwdIdx !== -1 ? path.resolve(argv[cwdIdx + 1]) : process.cwd();
  const positional = argv.filter((a, i) => a !== '--cwd' && argv[i - 1] !== '--cwd');
  const [verb, target] = positional;
  if (!verb || !target) {
    process.stdout.write('usage: graph-query.js <where|callers|imports|impact> <target> [--cwd <dir>]\n');
    process.exit(1);
  }
  const handlers = { where, callers, imports, impact };
  const handler = handlers[verb];
  if (!handler) {
    process.stdout.write(`unknown verb "${verb}"\n`);
    process.exit(1);
  }
  process.stdout.write(handler(cwd, target) + '\n');
  process.exit(0);
}

if (require.main === module) runCli(process.argv.slice(2));

module.exports = { where, callers, imports, impact, findNodeByName, ensureFresh, refreshAnyDrifted };
