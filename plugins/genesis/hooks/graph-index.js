#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { mutateGraph, readGraph } = require('./graph-store');
const { parseFile, detectLang, readSourceSafe } = require('./graph-parse');
const { scanMarkers } = require('./debt-scan');
const { reconcileFileMarkers } = require('./debt-store');
const { statePath } = require('./sdlc-state');

function toRel(cwd, absFile) {
  return path.relative(cwd, absFile).split(path.sep).join('/');
}

// graph-parse.js's resolveImportTarget stays pure (no filesystem access) and
// only produces the extensionless relative candidate. Actual on-disk
// resolution happens here, where cwd/disk access already live. Tries the
// bare extensionless path first, then real file extensions, then directory
// index files — the common TypeScript "import './b'" convention where the
// tracked file is keyed 'src/b.ts'. First existing regular file wins.
const IMPORT_RESOLUTION_SUFFIXES = [
  '', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '/index.cjs',
  '.py', '/__init__.py'
];

function resolveImportEdgeTarget(cwd, extensionlessRelTarget) {
  for (const suffix of IMPORT_RESOLUTION_SUFFIXES) {
    const candidate = extensionlessRelTarget + suffix;
    try {
      if (fs.statSync(path.join(cwd, candidate)).isFile()) return candidate;
    } catch { /* try next candidate */ }
  }
  return null;
}

// Resolves every 'imports'-kind edge's extensionless target against the real
// filesystem, rewriting edge.to on a match. Edges that resolve to nothing
// confirmable are NOT dropped outright — the target file may simply not
// exist yet (e.g. `a.ts` imports `./b` before `b.ts` is created). They're
// returned separately as `unresolved` entries so the caller can remember
// them (graph.unresolvedImports) and retroactively resolve them once the
// target file is eventually indexed, rather than silently discarding all
// record of the import until `a.ts` happens to be re-edited. 'calls'-kind
// edges pass through unchanged.
function resolveImportEdges(cwd, edges) {
  const out = [];
  const unresolved = [];
  for (const edge of edges) {
    if (edge.kind !== 'imports') { out.push(edge); continue; }
    const resolved = resolveImportEdgeTarget(cwd, edge.to);
    if (resolved) out.push({ ...edge, to: resolved });
    else unresolved.push({ from: edge.from, target: edge.to });
  }
  return { edges: out, unresolved };
}

// Any entry in graph.unresolvedImports whose target now resolves to the file
// just indexed (relFile) gets promoted to a real edge and dropped from the
// pending list — this is what retroactively restores an edge that couldn't
// be confirmed at the time its importing file was indexed. Mutates `graph`
// in place (edges/unresolvedImports); called with the already-pruned,
// already-updated graph right after the just-indexed file's own fresh
// edges/unresolvedImports have been merged in.
function resolvePendingImportsTargeting(cwd, graph, relFile) {
  const stillUnresolved = [];
  for (const entry of graph.unresolvedImports) {
    const resolved = resolveImportEdgeTarget(cwd, entry.target);
    if (resolved === relFile) {
      graph.edges.push({ from: entry.from, to: relFile, kind: 'imports' });
    } else {
      stillUnresolved.push(entry);
    }
  }
  graph.unresolvedImports = stillUnresolved;
}

function pruneFile(graph, relFile) {
  const scoped = (id) => id === relFile || id.startsWith(relFile + '#');
  return {
    ...graph,
    nodes: graph.nodes.filter(n => n.file !== relFile),
    edges: graph.edges.filter(e => !scoped(e.from)),
    skipped: graph.skipped.filter(s => s !== relFile),
    // Only THIS file's own pending entries are cleared — they get naturally
    // replaced by the fresh resolution attempt below. A different file's
    // still-pending entry must survive re-indexing of an unrelated file.
    unresolvedImports: (graph.unresolvedImports || []).filter(u => u.from !== relFile)
  };
}

function indexFile(cwd, absFile) {
  const relFile = toRel(cwd, absFile);
  if (relFile.startsWith('..') || path.isAbsolute(relFile)) {
    return { ok: false, msg: `${absFile} is outside the project` };
  }
  // Debt-marker reconciliation runs before (and independent of) code-graph
  // parsing below: it must cover every file a builder touches, including
  // ones detectLang/parseFile skip entirely (YAML, Go, etc.) — a genesis:
  // marker is a plain comment, not a graph node. A read failure here (huge
  // file, disappeared mid-hook) just means no markers found this pass, not
  // an error — and any store/reconcile bug is caught so it can never block
  // the code-graph update that follows.
  const source = readSourceSafe(absFile);
  if (source !== null) {
    try { reconcileFileMarkers(cwd, relFile, scanMarkers(source)); } catch { /* never block graph indexing */ }
  }
  try {
    // Cheap read-only peek before taking the lock: a file with an
    // unsupported extension that's already recorded in `skipped` from a
    // prior index can never turn parseable just by being edited again (its
    // extension doesn't change), so re-running the full locked
    // read-parse-write cycle for every such edit is pure churn for zero
    // benefit. A first-time-seen unsupported file still goes through the
    // normal locked path once, to get recorded into `skipped`.
    if (detectLang(relFile) === null && readGraph(cwd).skipped.includes(relFile)) {
      return { ok: true, updated: false };
    }
    return mutateGraph(cwd, (graph) => {
      const next = pruneFile(graph, relFile);
      const parsed = parseFile(absFile, relFile);
      if (!parsed) {
        next.skipped.push(relFile);
        delete next.files[relFile];
        return { graph: next, result: { ok: true, updated: false } };
      }
      next.nodes.push(...parsed.nodes);
      const { edges: resolvedEdges, unresolved } = resolveImportEdges(cwd, parsed.edges);
      next.edges.push(...resolvedEdges);
      for (const u of unresolved) {
        if (!next.unresolvedImports.some(e => e.from === u.from && e.target === u.target)) {
          next.unresolvedImports.push(u);
        }
      }
      next.files[relFile] = { lang: parsed.lang, hash: parsed.hash };
      resolvePendingImportsTargeting(cwd, next, relFile);
      return { graph: next, result: { ok: true, updated: true } };
    });
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

function indexFiles(cwd, absFiles) {
  return absFiles.map(f => ({ file: f, ...indexFile(cwd, f) }));
}

function runCli(argv) {
  const cwdIdx = argv.indexOf('--cwd');
  const cwd = cwdIdx !== -1 ? path.resolve(argv[cwdIdx + 1]) : process.cwd();
  const fileIdx = argv.indexOf('--file');
  const filesIdx = argv.indexOf('--files');
  let targets = [];
  if (fileIdx !== -1) {
    targets = [argv[fileIdx + 1]];
  } else if (filesIdx !== -1) {
    for (let i = filesIdx + 1; i < argv.length; i++) {
      if (argv[i] === '--cwd') break;
      targets.push(argv[i]);
    }
  }
  const results = indexFiles(cwd, targets.map(t => path.resolve(cwd, t)));
  process.stdout.write(JSON.stringify({ results }) + '\n');
  process.exit(results.some(r => !r.ok) ? 1 : 0);
}

function runHook() {
  let input = '';
  process.stdin.on('data', c => { input += c; });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const cwd = (data && typeof data.cwd === 'string') ? data.cwd : process.cwd();
      // Gate: the automatic PostToolUse path only runs in a project that has
      // actually been initialized with /genesis:init (i.e. docs/sdlc/state.json
      // exists). Without this, editing any file in ANY project where the plugin
      // is enabled would silently create docs/sdlc/graph.json + debt.json —
      // surprise folders in repos that never opted into Genesis. The explicit
      // CLI (--files) path stays ungated: it's only ever invoked deliberately by
      // Genesis stage skills (including init's own baseline scan, which runs
      // AFTER init has written state.json), so it must keep working regardless.
      try { if (!fs.existsSync(statePath(cwd))) { process.exit(0); } } catch { process.exit(0); }
      const toolName = data && data.tool_name;
      const filePath = data && data.tool_input && data.tool_input.file_path;
      if (['Edit', 'Write', 'MultiEdit'].includes(toolName) && typeof filePath === 'string') {
        indexFile(cwd, path.resolve(cwd, filePath));
      }
    } catch { /* silent — never block the session on a hook bug */ }
    process.exit(0);
  });
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--file') || argv.includes('--files')) runCli(argv);
  else runHook();
}

module.exports = {
  indexFile, indexFiles, pruneFile, resolveImportEdgeTarget, resolveImportEdges,
  resolvePendingImportsTargeting
};
