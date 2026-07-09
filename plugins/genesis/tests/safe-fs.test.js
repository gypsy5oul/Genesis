'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const safeFs = require('../hooks/safe-fs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'safe-fs-'));
}

test('writeFileSafe refuses to write through a symlinked directory component', () => {
  const d = tmpDir();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-fs-outside-'));
  fs.symlinkSync(outside, path.join(d, 'linked'));
  const target = path.join(d, 'linked', 'sub', 'file.json');
  assert.throws(() => safeFs.writeFileSafe(d, target, '{}'));
  assert.equal(fs.existsSync(path.join(outside, 'sub', 'file.json')), false);
});

test('writeFileSafe refuses to overwrite a symlinked target file', () => {
  const d = tmpDir();
  const real = path.join(d, 'real.json');
  fs.writeFileSync(real, '{"a":1}');
  const linked = path.join(d, 'linked.json');
  fs.symlinkSync(real, linked);
  assert.throws(() => safeFs.writeFileSafe(d, linked, '{"a":2}'));
  assert.equal(JSON.parse(fs.readFileSync(real, 'utf8')).a, 1);
});

test('writeFileSafe writes and round-trips content, no backup on first write', () => {
  const d = tmpDir();
  const target = path.join(d, 'sub', 'file.json');
  safeFs.writeFileSafe(d, target, '{"a":1}');
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).a, 1);
  assert.equal(fs.existsSync(target + '.bak'), false);
});

test('writeFileSafe backs up prior content by default on overwrite', () => {
  const d = tmpDir();
  const target = path.join(d, 'file.json');
  safeFs.writeFileSafe(d, target, '{"a":1}');
  safeFs.writeFileSafe(d, target, '{"a":2}');
  assert.equal(JSON.parse(fs.readFileSync(target + '.bak', 'utf8')).a, 1);
});

test('writeFileSafe skips backup when opts.backup is false', () => {
  const d = tmpDir();
  const target = path.join(d, 'file.json');
  safeFs.writeFileSafe(d, target, '{"a":1}');
  safeFs.writeFileSafe(d, target, '{"a":2}', { backup: false });
  assert.equal(fs.existsSync(target + '.bak'), false);
});

test('writeFileSafe uses a unique temp filename per call', () => {
  const d = tmpDir();
  const target = path.join(d, 'file.json');
  const seen = new Set();
  const orig = fs.writeFileSync;
  fs.writeFileSync = (p, ...rest) => { if (String(p).includes('.tmp')) seen.add(p); return orig(p, ...rest); };
  try {
    safeFs.writeFileSafe(d, target, '{"a":1}');
    safeFs.writeFileSafe(d, target, '{"a":2}');
  } finally {
    fs.writeFileSync = orig;
  }
  assert.equal(seen.size, 2);
});

test('acquireLock throws after timeout if lock is held and fresh', () => {
  const d = tmpDir();
  const lockPath = path.join(d, 'x.lock');
  fs.writeFileSync(lockPath, '1');
  assert.throws(() => safeFs.acquireLock(lockPath), /lock/i);
});

test('acquireLock treats a stale lock as abandoned', () => {
  const d = tmpDir();
  const lockPath = path.join(d, 'x.lock');
  fs.writeFileSync(lockPath, '1');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lockPath, old, old);
  const got = safeFs.acquireLock(lockPath);
  assert.equal(got, lockPath);
  safeFs.releaseLock(lockPath);
});

test('withLock releases the lock even if fn throws', () => {
  const d = tmpDir();
  const lockPath = path.join(d, 'x.lock');
  assert.throws(() => safeFs.withLock(lockPath, () => { throw new Error('boom'); }));
  assert.equal(fs.existsSync(lockPath), false);
});

test('appendFileSafe creates the file and appends lines without truncating', () => {
  const d = tmpDir();
  const target = path.join(d, 'log.jsonl');
  safeFs.appendFileSafe(d, target, '{"a":1}');
  safeFs.appendFileSafe(d, target, '{"a":2}');
  const lines = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(lines, ['{"a":1}', '{"a":2}']);
});

test('appendFileSafe refuses to append through a symlinked directory component', () => {
  const d = tmpDir();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-fs-outside-'));
  fs.symlinkSync(outside, path.join(d, 'linked'));
  const target = path.join(d, 'linked', 'sub', 'log.jsonl');
  assert.throws(() => safeFs.appendFileSafe(d, target, '{"a":1}'));
  assert.equal(fs.existsSync(path.join(outside, 'sub', 'log.jsonl')), false);
});

test('appendFileSafe refuses to append to a symlinked target file', () => {
  const d = tmpDir();
  const real = path.join(d, 'real.jsonl');
  fs.writeFileSync(real, '{"a":1}\n');
  const linked = path.join(d, 'linked.jsonl');
  fs.symlinkSync(real, linked);
  assert.throws(() => safeFs.appendFileSafe(d, linked, '{"a":2}'));
  assert.equal(fs.readFileSync(real, 'utf8'), '{"a":1}\n');
});
