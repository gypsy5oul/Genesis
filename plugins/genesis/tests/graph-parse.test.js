'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const gp = require('../hooks/graph-parse');

function parseJs(src) {
  const parser = new Parser();
  parser.setLanguage(JavaScript);
  return parser.parse(src).rootNode;
}

const TypeScript = require('tree-sitter-typescript').typescript;
function parseTs(src) {
  const parser = new Parser();
  parser.setLanguage(TypeScript);
  return parser.parse(src).rootNode;
}

test('detectLang maps extensions correctly', () => {
  assert.equal(gp.detectLang('src/a.js'), 'javascript');
  assert.equal(gp.detectLang('src/a.jsx'), 'javascript');
  assert.equal(gp.detectLang('src/a.mjs'), 'javascript');
  assert.equal(gp.detectLang('src/a.ts'), 'typescript');
  assert.equal(gp.detectLang('src/a.tsx'), 'tsx');
  assert.equal(gp.detectLang('src/a.py'), null);
  assert.equal(gp.detectLang('README.md'), null);
});

test('extractFromTree finds a top-level function declaration', () => {
  const root = parseJs('function createUser(email) {\n  return email;\n}\n');
  const { nodes } = gp.extractFromTree(root, 'src/users.js');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].kind, 'function');
  assert.equal(nodes[0].name, 'createUser');
  assert.equal(nodes[0].id, 'src/users.js#createUser');
  assert.deepEqual(nodes[0].lines, [1, 3]);
});

test('extractFromTree finds a class and its methods', () => {
  const root = parseJs('class UserService {\n  createUser(email) {\n    return email;\n  }\n}\n');
  const { nodes } = gp.extractFromTree(root, 'src/users.js');
  const kinds = nodes.map(n => `${n.kind}:${n.name}`).sort();
  assert.deepEqual(kinds, ['class:UserService', 'function:UserService.createUser']);
});

test('extractFromTree finds a const-arrow-function declaration', () => {
  const root = parseJs('const helper = (x) => { return x; };\n');
  const { nodes } = gp.extractFromTree(root, 'src/util.js');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].name, 'helper');
});

test('extractFromTree emits a relative import edge', () => {
  const root = parseJs("import { validateEmail } from './validate.js';\n");
  const { edges } = gp.extractFromTree(root, 'src/users.js');
  assert.deepEqual(edges, [{ from: 'src/users.js', to: 'src/validate.js', kind: 'imports' }]);
});

test('extractFromTree does not emit an edge for a bare package import', () => {
  const root = parseJs("import React from 'react';\n");
  const { edges } = gp.extractFromTree(root, 'src/App.js');
  assert.equal(edges.length, 0);
});

test('extractFromTree resolves a same-file call to its declared function', () => {
  const root = parseJs(
    'function createUser(email) {\n  return validateEmail(email);\n}\nfunction validateEmail(e) {\n  return true;\n}\n'
  );
  const { edges } = gp.extractFromTree(root, 'src/users.js');
  assert.deepEqual(edges, [{ from: 'src/users.js#createUser', to: 'src/users.js#validateEmail', kind: 'calls' }]);
});

test('extractFromTree resolves a call inside a class method', () => {
  const root = parseJs(
    'class UserService {\n  createUser(email) {\n    return validateEmail(email);\n  }\n}\nfunction validateEmail(e) {\n  return true;\n}\n'
  );
  const { edges } = gp.extractFromTree(root, 'src/users.js');
  assert.deepEqual(
    edges,
    [{ from: 'src/users.js#UserService.createUser', to: 'src/users.js#validateEmail', kind: 'calls' }]
  );
});

test('extractFromTree does not emit an edge for a call to an unresolved (unknown) name', () => {
  const root = parseJs('function f() {\n  return someImportedThing();\n}\n');
  const { edges } = gp.extractFromTree(root, 'src/a.js');
  assert.equal(edges.filter(e => e.kind === 'calls').length, 0);
});

test('parseFile returns null for an unsupported extension', () => {
  assert.equal(gp.parseFile('/nonexistent/a.py', 'a.py'), null);
});

test('parseFile returns null for a nonexistent file', () => {
  assert.equal(gp.parseFile('/nonexistent/a.js', 'a.js'), null);
});

test('extractFromTree does not record a function nested inside another function as a separate node (avoids same-name collisions)', () => {
  const root = parseJs(
    'function a() {\n  function helper(){return 1;}\n  return helper();\n}\nfunction b() {\n  function helper(){return 2;}\n  return helper();\n}\n'
  );
  const { nodes } = gp.extractFromTree(root, 'src/e.js');
  const names = nodes.map(n => n.name).sort();
  assert.deepEqual(names, ['a', 'b']);
  const ids = nodes.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate node ids');
});

test('extractFromTree attributes a call made inside a nested arrow function to the nearest enclosing top-level function, not the arrow itself', () => {
  const root = parseJs(
    'function outer() {\n  const helper = () => {\n    return inner();\n  };\n  return helper();\n}\nfunction inner(){return 1;}\n'
  );
  const { nodes, edges } = gp.extractFromTree(root, 'src/f.js');
  assert.deepEqual(nodes.map(n => n.name).sort(), ['inner', 'outer']);
  assert.deepEqual(edges, [{ from: 'src/f.js#outer', to: 'src/f.js#inner', kind: 'calls' }]);
});

test('extractFromTree does not record a function nested inside a callback argument as a separate node (avoids same-name collisions across .map() callbacks)', () => {
  const root = parseJs(
    'arr.map(x => { function helper() { return 1; } return helper(); });\n' +
    'arr2.map(x => { function helper() { return 2; } return helper(); });\n'
  );
  const { nodes, edges } = gp.extractFromTree(root, 'src/g.js');
  assert.equal(nodes.length, 0, 'no top-level declarations exist in this snippet');
  assert.equal(edges.filter(e => e.kind === 'calls').length, 0, 'calls to an unrecorded nested helper produce no edge');
});

test('extractFromTree does not record a function nested inside an IIFE as a top-level node', () => {
  const root = parseJs('(function () {\n  function inner() { return 1; }\n  return inner();\n})();\n');
  const { nodes } = gp.extractFromTree(root, 'src/h.js');
  assert.equal(nodes.length, 0, 'inner is nested inside the IIFE, not top-level');
});

test('extractFromTree attributes a call inside an anonymous callback to the nearest enclosing named function', () => {
  const root = parseJs(
    'function outer() {\n  arr.forEach(x => {\n    return inner();\n  });\n}\nfunction inner(){return 1;}\n'
  );
  const { edges } = gp.extractFromTree(root, 'src/i.js');
  assert.deepEqual(edges, [{ from: 'src/i.js#outer', to: 'src/i.js#inner', kind: 'calls' }]);
});

test('extractFromTree does not record a function nested inside an object-literal shorthand method as a top-level node', () => {
  const root = parseJs(
    'register({ foo() { function helper() { return 1; } return helper(); } });\n' +
    'register2({ foo() { function helper() { return 2; } return helper(); } });\n'
  );
  const { nodes } = gp.extractFromTree(root, 'src/j.js');
  assert.equal(nodes.length, 0, 'no top-level declarations exist in this snippet');
});

test('extractFromTree does not record a function nested inside a class-expression method as a top-level node', () => {
  const root = parseJs(
    'const Widget = makeClass(class { render() { function helper() { return 1; } return helper(); } });\n'
  );
  const { nodes } = gp.extractFromTree(root, 'src/k.js');
  const names = nodes.map(n => n.name);
  assert.ok(!names.includes('helper'), `helper should not be recorded as top-level, got: ${names}`);
});

test('extractFromTree gives get/set accessors of the same name distinct ids (no collision)', () => {
  const root = parseJs('class C {\n  get x() { return 1; }\n  set x(v) { this._x = v; }\n}\n');
  const { nodes } = gp.extractFromTree(root, 'src/l.js');
  const ids = nodes.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
  assert.ok(ids.includes('src/l.js#C.get:x'));
  assert.ok(ids.includes('src/l.js#C.set:x'));
});

test('extractFromTree gives a static method and an instance method of the same name distinct ids', () => {
  const root = parseJs('class C {\n  foo() { return 1; }\n  static foo() { return 2; }\n}\n');
  const { nodes } = gp.extractFromTree(root, 'src/m.js');
  const ids = nodes.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
  assert.ok(ids.includes('src/m.js#C.foo'));
  assert.ok(ids.includes('src/m.js#C.static:foo'));
});

test('extractFromTree resolves a call from inside a class method to a same-file function correctly (regression check)', () => {
  const root = parseJs('class UserService {\n  createUser(email) {\n    return validateEmail(email);\n  }\n}\nfunction validateEmail(e) {\n  return true;\n}\n');
  const { edges } = gp.extractFromTree(root, 'src/n.js');
  assert.deepEqual(edges, [{ from: 'src/n.js#UserService.createUser', to: 'src/n.js#validateEmail', kind: 'calls' }]);
});

test('extractFromTree does not record a function nested inside a generator function as a top-level node (avoids collision across sibling generators)', () => {
  const root = parseJs(
    'function* gen1(){ function helper(){return 1;} return helper(); }\n' +
    'function* gen2(){ function helper(){return 2;} return helper(); }\n'
  );
  const { nodes } = gp.extractFromTree(root, 'src/o.js');
  assert.equal(nodes.length, 0);
});

test('extractFromTree does not produce a dangling edge for a call made inside a class static block', () => {
  const root = parseJs(
    'class C {\n  static {\n    function helper(){ return other(); }\n    helper();\n  }\n}\nfunction other(){ return 1; }\n'
  );
  const { nodes, edges } = gp.extractFromTree(root, 'src/p.js');
  const nodeIds = new Set(nodes.map(n => n.id));
  for (const e of edges) {
    assert.ok(e.from === 'src/p.js' || nodeIds.has(e.from), `dangling edge: from=${e.from} not in nodes`);
    assert.ok(nodeIds.has(e.to), `dangling edge: to=${e.to} not in nodes`);
  }
});

test('extractFromTree does not record a function nested inside a TypeScript namespace as a top-level node (avoids collision across sibling namespaces)', () => {
  const root = parseTs('namespace N1 { function f(){ return 1; } }\nnamespace N2 { function f(){ return 2; } }\n');
  const { nodes } = gp.extractFromTree(root, 'src/q.ts');
  assert.equal(nodes.length, 0);
});
