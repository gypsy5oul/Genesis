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
  // own methods become graph nodes. `insideFunction` is true once ANY
  // function-scope-creating node (function_declaration, class_declaration,
  // lexical_declaration wrapping an arrow/function-expression, or a bare
  // arrow_function/function_expression — e.g. a callback argument or IIFE)
  // is an ancestor. This avoids same-name collisions across sibling
  // closures, however they're nested — named declaration, callback
  // argument, or IIFE.
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
    } else if (node.type === 'arrow_function' || node.type === 'function_expression') {
      // Anonymous/inline function bodies (callback arguments, IIFEs) also
      // establish a new scope, even though this node isn't itself a named
      // declaration. The named case (`const x = () => {}`, handled above
      // via lexical_declaration) sets nextInsideFunction here too when the
      // generic recursion reaches the arrow_function/function_expression
      // node — redundant with the branch above but harmless, since nothing
      // is recorded here, only the flag is set.
      nextInsideFunction = true;
    } else if (node.type === 'method_definition') {
      // A method_definition reached here (NOT via the explicit class-body
      // loop in the class_declaration branch above — that loop already
      // recorded legitimate top-level class methods synchronously,
      // independent of this generic recursion) means it's a bare method:
      // an object-literal shorthand method, a class-expression's method,
      // or similar. Its own name is never recorded as a node (only
      // top-level class methods are), but anything declared inside its
      // body must still be treated as nested, not top-level.
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

  // Mirrors collectDeclarations's insideFunction gating exactly, so a call
  // is only attributed to a NAMED scope that collectDeclarations actually
  // recorded — never to a scope that was never recorded (which would be a
  // dangling reference). `scope` (the nearest enclosing recorded scope's
  // node id, or null) is tracked separately from `insideFunction` because
  // a call inside an anonymous callback (which sets insideFunction=true but
  // has no name of its own) must still attribute to the nearest enclosing
  // NAMED scope, not to nothing.
  function collectCalls(node, insideFunction, scope, currentClassName) {
    let nextInsideFunction = insideFunction;
    let nextScope = scope;
    let nextClassName = currentClassName;
    if (node.type === 'class_declaration') {
      if (!insideFunction) {
        const nameNode = node.childForFieldName('name');
        nextClassName = nameNode ? nameNode.text : currentClassName;
      }
      // Deliberately do NOT set nextInsideFunction here — unlike
      // collectDeclarations (which records a class's methods via an
      // explicit loop, independent of insideFunction propagation),
      // collectCalls relies on reaching method_definition via the generic
      // recursion below with insideFunction still false, so each method
      // can create its own scope. method_definition sets nextInsideFunction
      // itself once its own body is entered.
    } else if (node.type === 'function_declaration') {
      if (!insideFunction) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) nextScope = nodeId(nameNode.text);
      }
      nextInsideFunction = true;
    } else if (node.type === 'method_definition') {
      if (!insideFunction) {
        const nameNode = node.childForFieldName('name');
        if (nameNode && currentClassName) nextScope = nodeId(`${currentClassName}.${nameNode.text}`);
      }
      nextInsideFunction = true;
    } else if (node.type === 'lexical_declaration') {
      if (!insideFunction) {
        for (const decl of node.namedChildren) {
          if (decl.type !== 'variable_declarator') continue;
          const nameNode = decl.childForFieldName('name');
          const valueNode = decl.childForFieldName('value');
          if (nameNode && valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
            nextScope = nodeId(nameNode.text);
          }
        }
      }
      nextInsideFunction = true;
    } else if (node.type === 'arrow_function' || node.type === 'function_expression') {
      nextInsideFunction = true;
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
    for (const child of node.namedChildren) collectCalls(child, nextInsideFunction, nextScope, nextClassName);
  }
  collectCalls(rootNode, false, null, null);

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
