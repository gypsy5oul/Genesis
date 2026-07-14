'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT = path.join(__dirname, '..', 'hooks', 'usage-statusline.sh');

function tmpConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-statusline-'));
}

// Spawns the script with an optional JSON stdin payload (as Claude Code
// actually invokes a statusLine command — see
// https://code.claude.com/docs/en/statusline). `payload` may be a string
// (raw stdin, for malformed-input tests) or an object (JSON-stringified).
function run(configDir, payload) {
  const input = payload === undefined ? '' : (typeof payload === 'string' ? payload : JSON.stringify(payload));
  return spawnSync('bash', [SCRIPT], { input, encoding: 'utf8', timeout: 5000, env: { ...process.env, CLAUDE_CONFIG_DIR: configDir } });
}

function lineFile(configDir, sessionId) {
  return path.join(configDir, `.genesis-usage-line.${sessionId}`);
}

test('prints the pre-rendered line for the session_id given on stdin', () => {
  const d = tmpConfigDir();
  fs.writeFileSync(lineFile(d, 'sess-1'), '[GENESIS] 12.4k tok ~$0.19 session | 84k tok ~$1.26 wk');
  const r = run(d, { session_id: 'sess-1' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[GENESIS\] 12\.4k tok/);
});

test('reads the CORRECT session\'s file — a different session_id must not see another session\'s line', () => {
  const d = tmpConfigDir();
  fs.writeFileSync(lineFile(d, 'sess-1'), '[GENESIS] 1k tok session-one');
  fs.writeFileSync(lineFile(d, 'sess-2'), '[GENESIS] 2k tok session-two');

  const r1 = run(d, { session_id: 'sess-1' });
  assert.equal(r1.status, 0);
  assert.match(r1.stdout, /session-one/);
  assert.ok(!r1.stdout.includes('session-two'));

  const r2 = run(d, { session_id: 'sess-2' });
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /session-two/);
  assert.ok(!r2.stdout.includes('session-one'));
});

test('prints nothing when that session\'s line file is absent (fresh install / first turn)', () => {
  const d = tmpConfigDir();
  const r = run(d, { session_id: 'sess-1' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('malformed JSON on stdin: prints nothing, exits 0, does not crash', () => {
  const d = tmpConfigDir();
  fs.writeFileSync(lineFile(d, 'sess-1'), '[GENESIS] should not print');
  const r = run(d, 'not json {{{');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('missing session_id field on stdin: prints nothing, exits 0', () => {
  const d = tmpConfigDir();
  const r = run(d, { transcript_path: '/some/path.jsonl' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('empty stdin: prints nothing, exits 0', () => {
  const d = tmpConfigDir();
  const r = run(d, '');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('refuses a symlinked line file, prints nothing', () => {
  const d = tmpConfigDir();
  const real = path.join(d, 'real-line');
  fs.writeFileSync(real, '[GENESIS] fake');
  fs.symlinkSync(real, lineFile(d, 'sess-1'));
  const r = run(d, { session_id: 'sess-1' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('strips control/escape bytes from the line before printing', () => {
  const d = tmpConfigDir();
  fs.writeFileSync(lineFile(d, 'sess-1'), '[GENESIS] hi\x1b[2J\x07 tok');
  const r = run(d, { session_id: 'sess-1' });
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes('\x1b'), 'must contain no escape byte');
});

test('caps the read so an oversized line file cannot flood the statusline', () => {
  const d = tmpConfigDir();
  fs.writeFileSync(lineFile(d, 'sess-1'), 'x'.repeat(10000));
  const r = run(d, { session_id: 'sess-1' });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.length <= 256);
});

test('exits 0 (not 1) when the line file is empty', () => {
  const d = tmpConfigDir();
  fs.writeFileSync(lineFile(d, 'sess-1'), '');
  const r = run(d, { session_id: 'sess-1' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('exits 0 (not 1) when the line file contains only control bytes that get stripped to nothing', () => {
  const d = tmpConfigDir();
  fs.writeFileSync(lineFile(d, 'sess-1'), '\x1b\x07\x01');
  const r = run(d, { session_id: 'sess-1' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('sanitizes a session_id containing path-traversal / unsafe characters before use in a path', () => {
  const d = tmpConfigDir();
  // A session id with unsafe characters must not let stdin escape the
  // config dir or match an unrelated file; the sanitized id becomes
  // "etcpasswd" here (only alnum/hyphen/underscore survive), so writing a
  // line file under that sanitized name must be what gets read back.
  fs.writeFileSync(lineFile(d, 'etcpasswd'), '[GENESIS] sanitized');
  const r = run(d, { session_id: '../../etc/passwd' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /sanitized/);
});
