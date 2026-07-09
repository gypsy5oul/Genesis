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
function run(configDir) {
  return spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 5000, env: { ...process.env, CLAUDE_CONFIG_DIR: configDir } });
}

test('prints the pre-rendered line when present', () => {
  const d = tmpConfigDir();
  fs.writeFileSync(path.join(d, '.genesis-usage-line'), '[GENESIS] 12.4k tok ~$0.19 today | 84k tok ~$1.26 wk');
  const r = run(d);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[GENESIS\] 12\.4k tok/);
});

test('prints nothing when the line file is absent (fresh install)', () => {
  const d = tmpConfigDir();
  const r = run(d);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('refuses a symlinked line file, prints nothing', () => {
  const d = tmpConfigDir();
  const real = path.join(d, 'real-line');
  fs.writeFileSync(real, '[GENESIS] fake');
  fs.symlinkSync(real, path.join(d, '.genesis-usage-line'));
  const r = run(d);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('strips control/escape bytes from the line before printing', () => {
  const d = tmpConfigDir();
  fs.writeFileSync(path.join(d, '.genesis-usage-line'), '[GENESIS] hi\x1b[2J\x07 tok');
  const r = run(d);
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes('\x1b'), 'must contain no escape byte');
});

test('caps the read so an oversized line file cannot flood the statusline', () => {
  const d = tmpConfigDir();
  fs.writeFileSync(path.join(d, '.genesis-usage-line'), 'x'.repeat(10000));
  const r = run(d);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.length <= 256);
});
