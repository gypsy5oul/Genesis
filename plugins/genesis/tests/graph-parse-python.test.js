'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Parser = require('tree-sitter');
const Python = require('tree-sitter-python');
const gpp = require('../hooks/graph-parse-python');

function parsePy(src) {
  const parser = new Parser();
  parser.setLanguage(Python);
  return parser.parse(src).rootNode;
}

test('extractPythonTree records a top-level function', () => {
  const root = parsePy('def create_user(email):\n    return email\n');
  const { nodes } = gpp.extractPythonTree(root, 'src/users.py');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].kind, 'function');
  assert.equal(nodes[0].name, 'create_user');
  assert.equal(nodes[0].id, 'src/users.py#create_user');
  assert.deepEqual(nodes[0].lines, [1, 2]);
});

test('extractPythonTree records a class and its methods, including decorated ones', () => {
  const root = parsePy(
    'class UserService:\n' +
    '    @staticmethod\n' +
    '    def helper():\n' +
    '        return 1\n' +
    '    def create_user(self, email):\n' +
    '        return email\n'
  );
  const { nodes } = gpp.extractPythonTree(root, 'src/users.py');
  const ids = nodes.map(n => n.id).sort();
  assert.deepEqual(ids, [
    'src/users.py#UserService',
    'src/users.py#UserService.create_user',
    'src/users.py#UserService.helper',
  ]);
});

test('extractPythonTree does not record a function nested inside another function (avoids same-name collisions)', () => {
  const root = parsePy(
    'def a():\n    def helper():\n        return 1\n    return helper()\n' +
    'def b():\n    def helper():\n        return 2\n    return helper()\n'
  );
  const { nodes } = gpp.extractPythonTree(root, 'src/e.py');
  const names = nodes.map(n => n.name).sort();
  assert.deepEqual(names, ['a', 'b']);
  const ids = nodes.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate node ids');
});

test('extractPythonTree does not record a lambda, even assigned to a top-level name', () => {
  const root = parsePy('lam = lambda x: x + 1\n');
  const { nodes } = gpp.extractPythonTree(root, 'src/f.py');
  assert.equal(nodes.length, 0);
});

test('extractPythonTree does not record a function nested inside a method as top-level, and does not duplicate the method itself', () => {
  const root = parsePy(
    'class C:\n    def bar(self):\n        def inner():\n            return 1\n        return inner()\n'
  );
  const { nodes } = gpp.extractPythonTree(root, 'src/g.py');
  const ids = nodes.map(n => n.id);
  assert.deepEqual(ids, ['src/g.py#C', 'src/g.py#C.bar']);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids for C.bar');
});

test('extractPythonTree resolves a same-file call from a top-level function to another top-level function', () => {
  const root = parsePy(
    'def create_user(email):\n    return validate_email(email)\n' +
    'def validate_email(e):\n    return True\n'
  );
  const { edges } = gpp.extractPythonTree(root, 'src/users.py');
  const calls = edges.filter(e => e.kind === 'calls');
  assert.deepEqual(calls, [{ from: 'src/users.py#create_user', to: 'src/users.py#validate_email', kind: 'calls' }]);
});

test('extractPythonTree resolves a same-file call from inside a method to a top-level function', () => {
  const root = parsePy(
    'class UserService:\n    def create_user(self, email):\n        return validate_email(email)\n' +
    'def validate_email(e):\n    return True\n'
  );
  const { edges } = gpp.extractPythonTree(root, 'src/users.py');
  const calls = edges.filter(e => e.kind === 'calls');
  assert.deepEqual(calls, [{ from: 'src/users.py#UserService.create_user', to: 'src/users.py#validate_email', kind: 'calls' }]);
});

test('extractPythonTree never resolves a self.method()/obj.method() call, even to a real same-file function of that name', () => {
  const root = parsePy(
    'def validate_email(e):\n    return True\n' +
    'class C:\n    def foo(self):\n        return self.validate_email()\n'
  );
  const { edges } = gpp.extractPythonTree(root, 'src/h.py');
  assert.equal(edges.filter(e => e.kind === 'calls').length, 0);
});

test('extractPythonTree does not crash on async def, and treats it like a plain function', () => {
  const root = parsePy('async def fetch():\n    return 1\n');
  const { nodes } = gpp.extractPythonTree(root, 'src/i.py');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].name, 'fetch');
});

test('extractPythonTree does not record a class nested inside a function', () => {
  const root = parsePy('def outer():\n    class Inner:\n        def m(self):\n            pass\n');
  const { nodes } = gpp.extractPythonTree(root, 'src/n.py');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].name, 'outer');
});

test('extractPythonTree gives two classes with same-named methods distinct ids', () => {
  const root = parsePy('class A:\n    def run(self):\n        return 1\nclass B:\n    def run(self):\n        return 2\n');
  const { nodes } = gpp.extractPythonTree(root, 'src/o.py');
  const ids = nodes.map(n => n.id).sort();
  assert.deepEqual(ids, ['src/o.py#A', 'src/o.py#A.run', 'src/o.py#B', 'src/o.py#B.run']);
});

test('extractPythonTree records the correct line span for a multi-line function', () => {
  const root = parsePy('def f():\n    x = 1\n    y = 2\n    return x + y\n');
  const { nodes } = gpp.extractPythonTree(root, 'src/p.py');
  assert.deepEqual(nodes[0].lines, [1, 4]);
});

test('extractPythonTree does not emit an edge for an absolute import', () => {
  const root = parsePy('import os\n');
  const { edges } = gpp.extractPythonTree(root, 'src/j.py');
  assert.equal(edges.filter(e => e.kind === 'imports').length, 0);
});

test('extractPythonTree does not emit an edge for an absolute from-import', () => {
  const root = parsePy('from pkg.mod import x\n');
  const { edges } = gpp.extractPythonTree(root, 'src/k.py');
  assert.equal(edges.filter(e => e.kind === 'imports').length, 0);
});

test('extractPythonTree resolves a relative from-import with an explicit module path', () => {
  const root = parsePy('from .utils import validate_email\n');
  const { edges } = gpp.extractPythonTree(root, 'src/users.py');
  const imports = edges.filter(e => e.kind === 'imports');
  assert.deepEqual(imports, [{ from: 'src/users.py', to: 'src/utils', kind: 'imports' }]);
});

test('extractPythonTree resolves a two-level-up relative from-import with an explicit module path', () => {
  const root = parsePy('from ..shared import helper\n');
  const { edges } = gpp.extractPythonTree(root, 'src/pkg/users.py');
  const imports = edges.filter(e => e.kind === 'imports');
  assert.deepEqual(imports, [{ from: 'src/pkg/users.py', to: 'src/shared', kind: 'imports' }]);
});

test('extractPythonTree resolves each name in a bare-prefix relative import individually', () => {
  const root = parsePy('from . import sibling, other\n');
  const { edges } = gpp.extractPythonTree(root, 'src/users.py');
  const imports = edges.filter(e => e.kind === 'imports').map(e => e.to).sort();
  assert.deepEqual(imports, ['src/other', 'src/sibling']);
});

test('extractPythonTree resolves the real name (not the alias) in an aliased bare-prefix relative import', () => {
  const root = parsePy('from . import mod as aliased\n');
  const { edges } = gpp.extractPythonTree(root, 'src/users.py');
  const imports = edges.filter(e => e.kind === 'imports');
  assert.deepEqual(imports, [{ from: 'src/users.py', to: 'src/mod', kind: 'imports' }]);
});
