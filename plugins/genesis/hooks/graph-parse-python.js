'use strict';

const path = require('path');

// Node types that create a new function scope in Python. Anything declared
// beneath one of these (transitively) is nested, not top-level, and is
// never individually recorded as its own graph node — only module-scope
// functions/classes and a top-level class's own direct methods are
// indexed. `async def` and a `def` containing `yield` both parse to the
// same `function_definition` node (verified — no distinct node type for
// either), so no extra entries are needed here.
const SCOPE_CREATING_TYPES = new Set(['function_definition', 'lambda']);

function nodeId(relFile, name) { return `${relFile}#${name}`; }

// A class-body member might be wrapped in decorated_definition
// (@staticmethod, @property, etc.) — unwrap to reach the real
// function_definition. Verified: decorated_definition has a `definition`
// field pointing at the wrapped node.
function unwrapDecorated(member) {
  if (member.type === 'decorated_definition') {
    return member.childForFieldName('definition') || member;
  }
  return member;
}

// "pkg.mod" -> "pkg/mod"
function dottedToPath(dottedName) {
  return dottedName.split('.').join('/');
}

// Directory `dotCount` levels up from `fromFile`'s own directory.
// dotCount=1 (a single dot) means "same directory" — Python's own
// relative-import convention.
function upDirs(fromFile, dotCount) {
  let dir = path.dirname(fromFile);
  for (let i = 1; i < dotCount; i++) dir = path.dirname(dir);
  return dir.split(path.sep).join('/');
}

function extractPythonTree(rootNode, relFile) {
  const nodes = [];
  const edges = [];
  const declaredNames = new Set();

  function addFunctionNode(name, startRow, endRow) {
    nodes.push({ id: nodeId(relFile, name), kind: 'function', name, file: relFile, lines: [startRow + 1, endRow + 1] });
    declaredNames.add(name);
  }

  function walk(node, insideFunction, scope, className) {
    let nextInsideFunction = insideFunction;
    let nextScope = scope;
    let nextClassName = className;

    switch (node.type) {
      case 'class_definition': {
        if (!insideFunction) {
          const nameNode = node.childForFieldName('name');
          const thisClassName = nameNode ? nameNode.text : null;
          if (thisClassName) {
            nodes.push({
              id: nodeId(relFile, thisClassName), kind: 'class', name: thisClassName, file: relFile,
              lines: [node.startPosition.row + 1, node.endPosition.row + 1]
            });
            declaredNames.add(thisClassName);
            const body = node.childForFieldName('body');
            if (body) {
              for (const rawMember of body.namedChildren) {
                const member = unwrapDecorated(rawMember);
                if (member.type === 'function_definition') {
                  const mNameNode = member.childForFieldName('name');
                  if (mNameNode) {
                    addFunctionNode(`${thisClassName}.${mNameNode.text}`, member.startPosition.row, member.endPosition.row);
                  }
                }
              }
            }
            nextClassName = thisClassName;
          }
        }
        // class_definition itself is not in SCOPE_CREATING_TYPES — its
        // methods are recorded above (each with its own id already); each
        // method's own body becomes a scope via the function_definition
        // case below when the generic recursion reaches it.
        break;
      }
      case 'function_definition': {
        const nameNode = node.childForFieldName('name');
        if (!insideFunction) {
          if (className && nameNode) {
            // Reached via a class body's generic recursion — already
            // recorded by the class_definition case's explicit method
            // loop above. Only compute the matching qualified scope id
            // here, for call attribution inside this method's body — do
            // NOT call addFunctionNode again (would duplicate the node).
            nextScope = nodeId(relFile, `${className}.${nameNode.text}`);
          } else if (nameNode) {
            addFunctionNode(nameNode.text, node.startPosition.row, node.endPosition.row);
            nextScope = nodeId(relFile, nameNode.text);
          }
        }
        break;
      }
      case 'lambda': {
        // Anonymous, never recorded as a node even when assigned to a
        // top-level name (deliberate v1 simplification — see spec).
        break;
      }
      case 'call': {
        const fn = node.childForFieldName('function');
        const calleeName = (fn && fn.type === 'identifier') ? fn.text : null;
        if (calleeName && declaredNames.has(calleeName)) {
          const from = scope !== null ? scope : relFile;
          edges.push({ from, to: nodeId(relFile, calleeName), kind: 'calls' });
        }
        break;
      }
      case 'import_statement': {
        // "import os", "import pkg.submodule" — absolute, v1 doesn't resolve.
        break;
      }
      case 'import_from_statement': {
        const moduleNameNode = node.childForFieldName('module_name');
        if (moduleNameNode && moduleNameNode.type === 'relative_import') {
          const prefixNode = moduleNameNode.namedChildren.find(c => c.type === 'import_prefix');
          const dotCount = prefixNode ? prefixNode.text.length : 0;
          const dottedNameNode = moduleNameNode.namedChildren.find(c => c.type === 'dotted_name');
          if (dottedNameNode) {
            const dir = upDirs(relFile, dotCount);
            const target = dottedToPath(dottedNameNode.text);
            edges.push({ from: relFile, to: `${dir}/${target}`, kind: 'imports' });
          } else {
            const dir = upDirs(relFile, dotCount);
            const nameNodes = node.childrenForFieldName ? node.childrenForFieldName('name') : [];
            for (const n of nameNodes) {
              let importedName = null;
              if (n.type === 'dotted_name') importedName = n.text;
              else if (n.type === 'aliased_import') {
                const realNameNode = n.childForFieldName('name');
                importedName = realNameNode ? realNameNode.text : null;
              }
              if (importedName) edges.push({ from: relFile, to: `${dir}/${importedName}`, kind: 'imports' });
            }
          }
        }
        // module_name being a plain dotted_name (no relative_import) means
        // an absolute from-import — v1 doesn't resolve those either.
        break;
      }
    }

    if (SCOPE_CREATING_TYPES.has(node.type)) nextInsideFunction = true;

    for (const child of node.namedChildren) walk(child, nextInsideFunction, nextScope, nextClassName);
  }

  // Two-pass: pass 1 populates declaredNames fully; pass 2 (with nodes/
  // edges cleared) resolves every call — forward or backward reference —
  // against the complete name set. Mirrors graph-parse.js's JS extractor,
  // which needed this to fix a real forward-reference bug (a call to a
  // function declared later in the file wouldn't resolve in one pass).
  walk(rootNode, false, null, null);
  nodes.length = 0;
  edges.length = 0;
  walk(rootNode, false, null, null);

  return { nodes, edges };
}

module.exports = { extractPythonTree, unwrapDecorated };
