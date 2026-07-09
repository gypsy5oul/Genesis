'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScriptGrammars = require('tree-sitter-typescript');
const { MAX_FILE_BYTES } = require('./graph-store');

function detectLang(relFile) {
  const ext = path.extname(relFile);
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return 'javascript';
  if (ext === '.ts') return 'typescript';
  if (ext === '.tsx') return 'tsx';
  return null;
}

function grammarFor(lang) {
  if (lang === 'javascript') return JavaScript;
  if (lang === 'typescript') return TypeScriptGrammars.typescript;
  if (lang === 'tsx') return TypeScriptGrammars.tsx;
  return null;
}

function stripQuotes(s) {
  return s.replace(/^['"]|['"]$/g, '');
}

// Resolves a relative import specifier to a project-relative path. Bare
// package specifiers ('react', 'lodash/map') aren't file-resolvable and
// return null — v1 only graphs same-project relative imports.
function resolveImportTarget(fromFile, source) {
  if (!source.startsWith('.')) return null;
  const resolved = path.normalize(path.join(path.dirname(fromFile), source));
  return resolved.split(path.sep).join('/');
}

function extractFromTree(rootNode, relFile) {
  const nodes = [];
  const edges = [];
  const declaredNames = new Set();

  function nodeId(name) { return `${relFile}#${name}`; }

  function addFunctionNode(name, startRow, endRow) {
    nodes.push({ id: nodeId(name), kind: 'function', name, file: relFile, lines: [startRow + 1, endRow + 1] });
    declaredNames.add(name);
  }

  // Only top-level function/arrow-const declarations and top-level classes'
  // own methods become graph nodes — a function/arrow nested inside another
  // function is not separately recorded (avoids same-name collisions across
  // sibling closures, e.g. two different functions each declaring their own
  // local `helper`). `insideFunction` tracks whether we're already inside
  // such a recorded scope.
  function collectDeclarations(node, insideFunction) {
    let nextInsideFunction = insideFunction;
    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode && !insideFunction) addFunctionNode(nameNode.text, node.startPosition.row, node.endPosition.row);
      nextInsideFunction = true;
    } else if (node.type === 'class_declaration') {
      if (!insideFunction) {
        const nameNode = node.childForFieldName('name');
        const className = nameNode ? nameNode.text : null;
        if (className) {
          nodes.push({
            id: nodeId(className), kind: 'class', name: className, file: relFile,
            lines: [node.startPosition.row + 1, node.endPosition.row + 1]
          });
          declaredNames.add(className);
          const body = node.childForFieldName('body');
          if (body) {
            for (const member of body.namedChildren) {
              if (member.type === 'method_definition') {
                const methodName = member.childForFieldName('name');
                if (methodName) addFunctionNode(`${className}.${methodName.text}`, member.startPosition.row, member.endPosition.row);
              }
            }
          }
        }
      }
      nextInsideFunction = true;
    } else if (node.type === 'lexical_declaration') {
      for (const decl of node.namedChildren) {
        if (decl.type !== 'variable_declarator') continue;
        const nameNode = decl.childForFieldName('name');
        const valueNode = decl.childForFieldName('value');
        if (nameNode && valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
          if (!insideFunction) addFunctionNode(nameNode.text, node.startPosition.row, node.endPosition.row);
        }
      }
      nextInsideFunction = true;
    } else if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const target = resolveImportTarget(relFile, stripQuotes(sourceNode.text));
        if (target) edges.push({ from: relFile, to: target, kind: 'imports' });
      }
    }
    for (const child of node.namedChildren) collectDeclarations(child, nextInsideFunction);
  }
  collectDeclarations(rootNode, false);

  // Mirrors collectDeclarations exactly: only one level of recorded scope
  // can ever be active, so `scope` is the current recorded scope's node id
  // (or null at file/top level) rather than a stack. A call made anywhere
  // inside a nested (unrecorded) closure attributes to the nearest
  // enclosing recorded scope — never to a scope that was never recorded.
  function collectCalls(node, scope, currentClassName) {
    let nextScope = scope;
    let nextClassName = currentClassName;
    if (node.type === 'class_declaration') {
      if (scope === null) {
        const nameNode = node.childForFieldName('name');
        nextClassName = nameNode ? nameNode.text : currentClassName;
      }
    } else if (node.type === 'function_declaration') {
      if (scope === null) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) nextScope = nodeId(nameNode.text);
      }
    } else if (node.type === 'method_definition') {
      if (scope === null) {
        const nameNode = node.childForFieldName('name');
        if (nameNode && currentClassName) nextScope = nodeId(`${currentClassName}.${nameNode.text}`);
      }
    } else if (node.type === 'lexical_declaration') {
      if (scope === null) {
        for (const decl of node.namedChildren) {
          if (decl.type !== 'variable_declarator') continue;
          const nameNode = decl.childForFieldName('name');
          const valueNode = decl.childForFieldName('value');
          if (nameNode && valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
            nextScope = nodeId(nameNode.text);
          }
        }
      }
    }
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      let calleeName = null;
      if (fn && fn.type === 'identifier') calleeName = fn.text;
      else if (fn && fn.type === 'member_expression') {
        const prop = fn.childForFieldName('property');
        if (prop) calleeName = prop.text;
      }
      if (calleeName && declaredNames.has(calleeName)) {
        const from = scope !== null ? scope : relFile;
        edges.push({ from, to: nodeId(calleeName), kind: 'calls' });
      }
    }
    for (const child of node.namedChildren) collectCalls(child, nextScope, nextClassName);
  }
  collectCalls(rootNode, null, null);

  return { nodes, edges };
}

function parseFile(absPath, relFile) {
  const lang = detectLang(relFile);
  if (!lang) return null;
  const grammar = grammarFor(lang);
  let stat;
  try { stat = fs.lstatSync(absPath); } catch { return null; }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  let source;
  try { source = fs.readFileSync(absPath, 'utf8'); } catch { return null; }
  const parser = new Parser();
  parser.setLanguage(grammar);
  let tree;
  try { tree = parser.parse(source); } catch { return null; }
  const { nodes, edges } = extractFromTree(tree.rootNode, relFile);
  const hash = crypto.createHash('sha1').update(source).digest('hex');
  return { nodes, edges, hash, lang };
}

module.exports = { detectLang, grammarFor, extractFromTree, resolveImportTarget, stripQuotes, parseFile };
