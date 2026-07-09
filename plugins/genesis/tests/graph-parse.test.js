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
