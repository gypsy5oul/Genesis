'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'hooks', 'usage-statusline.sh');

// Spawns the script with an optional JSON stdin payload (as Claude Code
// actually invokes a statusLine command — see
// https://code.claude.com/docs/en/statusline). `payload` may be a string
// (raw stdin, for malformed-input tests) or an object (JSON-stringified).
function run(payload) {
  const input = payload === undefined ? '' : (typeof payload === 'string' ? payload : JSON.stringify(payload));
  return spawnSync('bash', [SCRIPT], { input, encoding: 'utf8', timeout: 5000 });
}

test('prints 5h/wk usage percentages from rate_limits on stdin', () => {
  const r = run({
    rate_limits: {
      five_hour: { used_percentage: 42, resets_at: '2026-07-14T18:00:00Z' },
      seven_day: { used_percentage: 18, resets_at: '2026-07-20T00:00:00Z' },
    },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '[GENESIS] 5h: 42% | wk: 18%');
});

test('rounds decimal used_percentage values to the nearest whole percent', () => {
  const r = run({
    rate_limits: {
      five_hour: { used_percentage: 42.5, resets_at: '2026-07-14T18:00:00Z' },
      seven_day: { used_percentage: 18.4, resets_at: '2026-07-20T00:00:00Z' },
    },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '[GENESIS] 5h: 43% | wk: 18%');
});

test('rounds a decimal that carries into the next whole number (99.9 -> 100)', () => {
  const r = run({
    rate_limits: {
      five_hour: { used_percentage: 99.9 },
      seven_day: { used_percentage: 0.5 },
    },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '[GENESIS] 5h: 100% | wk: 1%');
});

test('missing rate_limits object entirely: prints nothing, exits 0', () => {
  const r = run({ session_id: 'sess-1' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('missing five_hour.used_percentage field: prints nothing, exits 0', () => {
  const r = run({
    rate_limits: {
      five_hour: { resets_at: '2026-07-14T18:00:00Z' },
      seven_day: { used_percentage: 18 },
    },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('missing seven_day.used_percentage field: prints nothing, exits 0', () => {
  const r = run({
    rate_limits: {
      five_hour: { used_percentage: 42 },
      seven_day: { resets_at: '2026-07-20T00:00:00Z' },
    },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('non-numeric used_percentage value: prints nothing, exits 0', () => {
  const r = run('{"rate_limits":{"five_hour":{"used_percentage":"a lot","resets_at":"x"},"seven_day":{"used_percentage":18,"resets_at":"y"}}}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('used_percentage in scientific notation: prints nothing, exits 0', () => {
  const r = run('{"rate_limits":{"five_hour":{"used_percentage":4.2e1,"resets_at":"x"},"seven_day":{"used_percentage":18,"resets_at":"y"}}}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('used_percentage followed by trailing garbage (malformed number): prints nothing, exits 0', () => {
  const r = run('{"rate_limits":{"five_hour":{"used_percentage":42xyz,"resets_at":"x"},"seven_day":{"used_percentage":18,"resets_at":"y"}}}');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('malformed JSON on stdin: prints nothing, exits 0, does not crash', () => {
  const r = run('not json {{{');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('empty stdin: prints nothing, exits 0', () => {
  const r = run('');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
