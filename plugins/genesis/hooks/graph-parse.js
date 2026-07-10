'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScriptGrammars = require('tree-sitter-typescript');
const Python = require('tree-sitter-python');
const { MAX_FILE_BYTES } = require('./graph-store');
const { extractPythonTree } = require('./graph-parse-python');

function detectLang(relFile) {
  const ext = path.extname(relFile);
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return 'javascript';
  if (ext === '.ts') return 'typescript';
  if (ext === '.tsx') return 'tsx';
  if (ext === '.py') return 'python';
  return null;
}

function grammarFor(lang) {
  if (lang === 'javascript') return JavaScript;
  if (lang === 'typescript') return TypeScriptGrammars.typescript;
  if (lang === 'tsx') return TypeScriptGrammars.tsx;
  if (lang === 'python') return Python;
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

  // static/get/set are anonymous (unnamed) token children of method_definition
  // in tree-sitter's grammar, not a field — verified via direct inspection.
  // Distinguishes get x() / set x() / static foo() from a same-named instance
  // method or accessor pair, which would otherwise collide on node id.
  function methodQualifier(member) {
    const anon = member.children.filter(c => !c.isNamed).map(c => c.type);
    const parts = [];
    if (anon.includes('static')) parts.push('static');
    if (anon.includes('get')) parts.push('get');
    if (anon.includes('set')) parts.push('set');
    return parts.length ? parts.join(':') + ':' : '';
  }

  // Node types that create a new function/method scope. Anything declared
  // beneath one of these (transitively) is nested, not top-level, and is
  // never individually recorded as its own graph node in v1 — only
  // module-scope functions/classes/const-arrows and a top-level class's own
  // direct methods are indexed. Kept as an explicit set (not scattered
  // if/else branches) specifically so there is exactly one place that
  // decides "is this node a function scope" — the prior two-function
  // design let that decision drift out of sync between declaration
  // recording and call attribution; a single traversal can't drift.
  const SCOPE_CREATING_TYPES = new Set([
    'function_declaration', 'function_expression', 'arrow_function',
    'generator_function_declaration', 'generator_function',
    'method_definition', 'class_static_block'
  ]);

  // Single traversal computing BOTH what gets recorded as a node AND what
  // scope a call attributes to.
  //   insideFunction: true once any SCOPE_CREATING_TYPES node is an
  //     ancestor — gates whether a declaration gets recorded at all.
  //   scope: the nearest enclosing RECORDED scope's node id (or null) —
  //     used to attribute calls. Lags behind insideFunction inside an
  //     unrecorded (nested or anonymous) construct, falling back to the
  //     nearest real one, or to the file itself if there is none.
  //   className: nearest enclosing TOP-LEVEL class's name, for method ids.
  function walk(node, insideFunction, scope, className) {
    let nextInsideFunction = insideFunction;
    let nextScope = scope;
    let nextClassName = className;

    switch (node.type) {
      case 'class_declaration':
      case 'abstract_class_declaration': {
        // abstract_class_declaration (TS `abstract class`) is a distinct
        // grammar node from class_declaration but has an identical shape
        // (name/body fields, class_body of method_definition members) —
        // verified via direct parse. Bodyless abstract_method_signature
        // members are silently skipped by the method-recording loop below
        // (not a method_definition), same as any other bodyless
        // declaration (function_signature, interface members, etc.).
        if (!insideFunction) {
          const nameNode = node.childForFieldName('name');
          const thisClassName = nameNode ? nameNode.text : null;
          if (thisClassName) {
            nodes.push({
              id: nodeId(thisClassName), kind: 'class', name: thisClassName, file: relFile,
              lines: [node.startPosition.row + 1, node.endPosition.row + 1]
            });
            declaredNames.add(thisClassName);
            const body = node.childForFieldName('body');
            if (body) {
              for (const member of body.namedChildren) {
                if (member.type === 'method_definition') {
                  const mNameNode = member.childForFieldName('name');
                  if (mNameNode) {
                    addFunctionNode(
                      `${thisClassName}.${methodQualifier(member)}${mNameNode.text}`,
                      member.startPosition.row, member.endPosition.row
                    );
                  }
                }
              }
            }
            nextClassName = thisClassName;
          }
        }
        // class_declaration itself is not in SCOPE_CREATING_TYPES — its
        // methods are recorded above (each with its own id already); each
        // method's own body becomes a scope via the 'method_definition'
        // case below when the generic recursion reaches it.
        break;
      }
      case 'method_definition': {
        if (!insideFunction && className) {
          const nameNode = node.childForFieldName('name');
          if (nameNode) nextScope = nodeId(`${className}.${methodQualifier(node)}${nameNode.text}`);
        }
        nextInsideFunction = true;
        break;
      }
      case 'function_declaration': {
        if (!insideFunction) {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            addFunctionNode(nameNode.text, node.startPosition.row, node.endPosition.row);
            nextScope = nodeId(nameNode.text);
          }
        }
        nextInsideFunction = true;
        break;
      }
      case 'lexical_declaration': {
        // A single const/let statement can have multiple declarators
        // (`const a = () => inner(), b = () => 1;`). Each one needs its own
        // scope recursed into individually — the generic post-switch
        // recursion below only walks this node's children ONCE, so if it
        // were left to handle recursion, every declarator's body would be
        // walked with whatever single `nextScope` this case last set,
        // mis-attributing calls made inside an earlier declarator's value
        // to a LATER declarator's scope. Recursing here (and returning
        // early, skipping the generic recursion for this node) also lets
        // each declarator's node use its OWN value's line span instead of
        // the whole statement's.
        //
        // The name node also needs walking for anything OTHER than a plain
        // named function declaration (`const helper = () => {...}` — a bare
        // identifier name, nothing to walk): a destructuring pattern's
        // default initializers (`const { a = foo() } = ...`, `const [ x =
        // bar() ] = ...`) live in the NAME node's subtree, not the value's,
        // so skipping it would silently drop calls made inside a
        // destructuring default.
        for (const decl of node.namedChildren) {
          if (decl.type !== 'variable_declarator') continue;
          const nameNode = decl.childForFieldName('name');
          const valueNode = decl.childForFieldName('value');
          if (nameNode && valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
            let declScope = scope;
            if (!insideFunction) {
              addFunctionNode(nameNode.text, valueNode.startPosition.row, valueNode.endPosition.row);
              declScope = nodeId(nameNode.text);
            }
            walk(valueNode, true, declScope, className);
          } else {
            if (nameNode) walk(nameNode, insideFunction, scope, className);
            if (valueNode) walk(valueNode, insideFunction, scope, className);
          }
        }
        return;
      }
      case 'function_expression':
      case 'arrow_function':
      case 'generator_function_declaration':
      case 'generator_function':
      case 'class_static_block':
      case 'internal_module': {
        // internal_module = TypeScript `namespace`/`module` block. Not a
        // function scope semantically, but gated the same way (nested
        // declarations aren't top-level, namespaces aren't indexed in v1)
        // to prevent same-name collisions across sibling namespaces.
        nextInsideFunction = true;
        break;
      }
      case 'import_statement': {
        const sourceNode = node.childForFieldName('source');
        if (sourceNode) {
          const target = resolveImportTarget(relFile, stripQuotes(sourceNode.text));
          if (target) edges.push({ from: relFile, to: target, kind: 'imports' });
        }
        break;
      }
      case 'call_expression': {
        const fn = node.childForFieldName('function');
        // Only a plain identifier callee (`foo()`) is resolved. A
        // member-expression callee (`obj.foo()`, `this.foo()`) is
        // deliberately never resolved, even when the property name happens
        // to match a declared top-level function/method — resolving it
        // would either be a method-target call (out of scope, see
        // graph-protocol.md) or, worse, silently collide with an unrelated
        // top-level declaration sharing the same bare name (e.g.
        // `this.bar()` on a class matching an unrelated top-level
        // `function bar(){}`), producing a WRONG edge instead of silence.
        const calleeName = (fn && fn.type === 'identifier') ? fn.text : null;
        if (calleeName && declaredNames.has(calleeName)) {
          const from = scope !== null ? scope : relFile;
          edges.push({ from, to: nodeId(calleeName), kind: 'calls' });
        }
        break;
      }
    }

    for (const child of node.namedChildren) walk(child, nextInsideFunction, nextScope, nextClassName);
  }

  // walk() is invoked twice against the exact same unchanged implementation.
  // A same-file call can legally target a function/method declared LATER in
  // source order (function declarations are hoisted; a top-level class's
  // methods and a top-level function can equally call each other regardless
  // of which is written first). Checking `declaredNames.has(calleeName)`
  // and recording that name in the very same single preorder pass means a
  // forward call site is visited, and its edge decided, before the callee's
  // own declaration node is ever reached — so the first pass exists purely
  // to fully populate `declaredNames` (its `nodes`/`edges` output is
  // discarded); the second pass recomputes identical nodes and now resolves
  // every call, forward or backward, against the complete name set. This
  // still uses one canonical walk() — not two independently-written
  // traversals — so the two calls cannot structurally disagree with each
  // other the way the old collectDeclarations/collectCalls pair could.
  walk(rootNode, false, null, null);
  nodes.length = 0;
  edges.length = 0;
  walk(rootNode, false, null, null);

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
  const { nodes, edges } = lang === 'python'
    ? extractPythonTree(tree.rootNode, relFile)
    : extractFromTree(tree.rootNode, relFile);
  const hash = crypto.createHash('sha1').update(source).digest('hex');
  return { nodes, edges, hash, lang };
}

module.exports = { detectLang, grammarFor, extractFromTree, resolveImportTarget, stripQuotes, parseFile };
