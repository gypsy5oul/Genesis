#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { readGraph, readGraphStatus, mutateGraph } = require('./graph-store');
const { indexFilesBatch, pruneFile } = require('./graph-index');

function currentHash(absPath) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(absPath)).digest('hex'); } catch { return null; }
}

function findNodeByName(graph, name) {
  return graph.nodes.filter(n => n.name === name || n.id.endsWith('#' + name));
}

// Drift check shared by every verb (where/callers/imports/impact): a query
// should never be wrong due to staleness, regardless of which verb is
// asked. Scans every tracked file's on-disk hash and reconciles any that no
// longer match the graph's last-known state before the caller does its
// lookup — cheap when nothing drifted (just a hash comparison per file), and
// correct even for a brand-new symbol added to a file with no existing node
// to key a targeted check off of.
//
// Two kinds of drift are handled, each batched into ONE locked graph write
// (one lock acquisition, one read-modify-write — the same batching pattern
// indexFilesBatch established) rather than N separate ones:
//   - CONTENT drift (currentHash differs but the file still reads): re-parse
//     every such file in a single indexFilesBatch call.
//   - DELETION (currentHash returns null — the file was removed, renamed, or
//     moved and can no longer be read): its stale nodes/edges/files entry must
//     be PRUNED, otherwise where/callers would still hand back a file:line in
//     a file that no longer exists on disk — a wrong answer, which violates
//     this feature's "silence, not a wrong answer" contract
//     (graph-protocol.md). currentHash returning null used to be silently
//     ignored (the `onDisk && …` guard was false), leaving those nodes
//     forever.
//
// Batching the deletions into one mutateGraph also avoids reading a `graph`
// object that would go stale between per-file prunes: the mutator reads the
// graph fresh inside the lock and folds every deletion into it in order.
function refreshAnyDrifted(cwd, graph) {
  let changed = false;
  const deleted = [];
  const drifted = [];
  for (const relFile of Object.keys(graph.files)) {
    const onDisk = currentHash(path.join(cwd, relFile));
    if (onDisk === null) {
      // File can no longer be read — tracked but gone from disk.
      deleted.push(relFile);
    } else if (onDisk !== graph.files[relFile].hash) {
      drifted.push(path.join(cwd, relFile));
    }
  }
  if (drifted.length) {
    indexFilesBatch(cwd, drifted);
    changed = true;
  }
  if (deleted.length) {
    // pruneFile removes nodes/edges (scoped by `from`)/skipped/unresolvedImports
    // but intentionally leaves the `files` entry (indexFile re-sets or deletes
    // it afterward); for a deletion there's nothing to re-set, so drop it here.
    mutateGraph(cwd, (g) => {
      let next = g;
      for (const relFile of deleted) {
        if (!next.files[relFile]) continue; // already gone (e.g. concurrent write)
        next = pruneFile(next, relFile);
        delete next.files[relFile];
      }
      return { graph: next, result: null };
    });
    changed = true;
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
