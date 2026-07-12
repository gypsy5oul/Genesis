#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { readGraph, readGraphStatus } = require('./graph-store');
const { indexFile } = require('./graph-index');

function currentHash(absPath) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(absPath)).digest('hex'); } catch { return null; }
}

function findNodeByName(graph, name) {
  return graph.nodes.filter(n => n.name === name || n.id.endsWith('#' + name));
}

// Drift check shared by every verb (where/callers/imports/impact): a query
// should never be wrong due to staleness, regardless of which verb is
// asked. Scans every tracked file's on-disk hash and re-parses any that
// drifted from the graph's last-known hash (the incremental hook missed an
// update) before the caller does its lookup — cheap when nothing drifted
// (just a hash comparison per file), and correct even for a brand-new
// symbol added to a file with no existing node to key a targeted check off
// of.
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

// All four verbs must give an equivalent freshness guarantee — "a query
// should never be wrong due to staleness" applies uniformly, not just to
// where(). refreshAnyDrifted does a cheap hash-check pass over every
// tracked file and only re-parses ones that actually drifted, so calling it
// unconditionally up front is safe and consistent across verbs.
function where(cwd, name) {
  const graph = refreshAnyDrifted(cwd, readGraph(cwd));
  const matches = findNodeByName(graph, name);
  if (!matches.length) return `no data for "${name}"`;
  return matches.map(n => `${n.file}:${n.lines[0]}-${n.lines[1]}`).join('\n');
}

function callers(cwd, name) {
  const graph = refreshAnyDrifted(cwd, readGraph(cwd));
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
  const graph = refreshAnyDrifted(cwd, readGraph(cwd));
  if (!graph.files[relFile]) return `no data for "${relFile}"`;
  const out = graph.edges.filter(e => e.kind === 'imports' && e.from === relFile).map(e => e.to);
  return out.length ? out.join('\n') : `no imports found for "${relFile}"`;
}

function impact(cwd, relFile) {
  const graph = refreshAnyDrifted(cwd, readGraph(cwd));
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
  // Run the handler first (its drift-refresh may itself update or clear the
  // status marker), THEN read the marker so the warning reflects the freshest
  // state. If the graph is frozen over its size cap, prepend one visible
  // staleness warning so the user doesn't silently trust a stale answer.
  const answer = handler(cwd, target);
  const status = readGraphStatus(cwd);
  if (status && status.oversized) {
    const since = typeof status.at === 'string' && status.at ? status.at.slice(0, 10) : 'an earlier update';
    process.stdout.write(`# WARNING: code graph exceeds its size cap and has not been updated since ${since} — answers may be stale.\n`);
  }
  process.stdout.write(answer + '\n');
  process.exit(0);
}

if (require.main === module) runCli(process.argv.slice(2));

module.exports = { where, callers, imports, impact, findNodeByName, refreshAnyDrifted };
