#!/usr/bin/env node
'use strict';
const path = require('path');
const { mutateGraph } = require('./graph-store');
const { parseFile } = require('./graph-parse');

function toRel(cwd, absFile) {
  return path.relative(cwd, absFile).split(path.sep).join('/');
}

function pruneFile(graph, relFile) {
  const scoped = (id) => id === relFile || id.startsWith(relFile + '#');
  return {
    ...graph,
    nodes: graph.nodes.filter(n => n.file !== relFile),
    edges: graph.edges.filter(e => !scoped(e.from)),
    skipped: graph.skipped.filter(s => s !== relFile)
  };
}

function indexFile(cwd, absFile) {
  const relFile = toRel(cwd, absFile);
  if (relFile.startsWith('..') || path.isAbsolute(relFile)) {
    return { ok: false, msg: `${absFile} is outside the project` };
  }
  try {
    return mutateGraph(cwd, (graph) => {
      const next = pruneFile(graph, relFile);
      const parsed = parseFile(absFile, relFile);
      if (!parsed) {
        next.skipped.push(relFile);
        return { graph: next, result: { ok: true, updated: false } };
      }
      next.nodes.push(...parsed.nodes);
      next.edges.push(...parsed.edges);
      next.files[relFile] = { lang: parsed.lang, hash: parsed.hash };
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

module.exports = { indexFile, indexFiles, pruneFile };
