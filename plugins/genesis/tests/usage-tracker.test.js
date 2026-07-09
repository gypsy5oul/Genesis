'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ut = require('../hooks/usage-tracker');

function tmpConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-usage-'));
}

function writeTranscript(dir, entries) {
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

function assistantMsg(usage, model) {
  return { type: 'assistant', message: { model: model || 'claude-sonnet-4-5-20250929', usage } };
}

test('computeSessionUsage sums input/output/cache tokens across assistant messages', () => {
  const d = tmpConfigDir();
  const p = writeTranscript(d, [
    assistantMsg({ input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 50, cache_read_input_tokens: 3000 }),
    assistantMsg({ input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000 }),
    { type: 'user', message: {} },
  ]);
  const u = ut.computeSessionUsage(p);
  assert.equal(u.inputTokens, 1500);
  assert.equal(u.outputTokens, 300);
  assert.equal(u.cacheCreationTokens, 50);
  assert.equal(u.cacheReadTokens, 7000);
  assert.equal(u.turns, 2);
  assert.equal(u.model, 'claude-sonnet-4-5-20250929');
});

test('computeSessionUsage coerces a non-numeric (string) token count to 0 instead of string-concatenating', () => {
  const d = tmpConfigDir();
  const p = writeTranscript(d, [
    assistantMsg({ input_tokens: '1e9', output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
    assistantMsg({ input_tokens: 500, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
  ]);
  const u = ut.computeSessionUsage(p);
  assert.equal(u.inputTokens, 500, 'a string input_tokens must coerce to 0, not string-concatenate into the running total');
  assert.equal(typeof u.inputTokens, 'number');
  assert.equal(u.outputTokens, 30);
});

test('computeSessionUsage returns zeros for a missing transcript, does not throw', () => {
  const u = ut.computeSessionUsage('/nonexistent/transcript.jsonl');
  assert.equal(u.turns, 0);
  assert.equal(u.inputTokens, 0);
});

test('priceFor matches the most specific prefix first', () => {
  const p1 = ut.priceFor('claude-opus-4-1-20250805');
  assert.equal(p1.output, 75.00);
  const p2 = ut.priceFor('claude-opus-4-5-20260101');
  assert.equal(p2.output, 25.00);
  assert.equal(ut.priceFor('some-unknown-model'), null);
});

test('priceFor resolves a bare dated claude-opus-4 ID (original 4.0) to the 15/75 tier, not the 4.5+ general bucket', () => {
  const p = ut.priceFor('claude-opus-4-20250514');
  assert.deepEqual({ input: p.input, output: p.output }, { input: 15.00, output: 75.00 });
});

test('priceFor resolves a dated claude-opus-4-5 ID to its own 5/25 tier, distinct from the 4.0 fallback', () => {
  const p = ut.priceFor('claude-opus-4-5-20260101');
  assert.deepEqual({ input: p.input, output: p.output }, { input: 5.00, output: 25.00 });
});

test('estimateCost prices all four token categories, cache-read cheapest', () => {
  const pricing = { input: 10, output: 20, cacheWrite: 12.5, cacheRead: 1 };
  const cost = ut.estimateCost({ inputTokens: 1e6, outputTokens: 1e6, cacheCreationTokens: 1e6, cacheReadTokens: 1e6 }, pricing);
  assert.equal(cost, 10 + 20 + 12.5 + 1);
});

test('estimateCost returns null when pricing is unknown', () => {
  assert.equal(ut.estimateCost({ inputTokens: 100, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 }, null), null);
});

test('humanizeTokens formats thousands and millions', () => {
  assert.equal(ut.humanizeTokens(500), '500');
  assert.equal(ut.humanizeTokens(12400), '12.4k');
  assert.equal(ut.humanizeTokens(2_300_000), '2.3M');
  assert.equal(ut.humanizeTokens(0), '0');
});

test('aggregateWeekly keeps only the latest entry per session_id within the window', () => {
  const now = 1_800_000_000_000;
  const entries = [
    { ts: now - 1000, session_id: 's1', input_tokens: 100, output_tokens: 10, cache_creation_tokens: 0, cache_read_tokens: 0, est_usd: 0.01 },
    { ts: now - 500, session_id: 's1', input_tokens: 200, output_tokens: 20, cache_creation_tokens: 0, cache_read_tokens: 0, est_usd: 0.02 },
    { ts: now - 200, session_id: 's2', input_tokens: 50, output_tokens: 5, cache_creation_tokens: 0, cache_read_tokens: 0, est_usd: 0.005 },
    { ts: now - ut.WEEK_MS - 1000, session_id: 's3', input_tokens: 9999, output_tokens: 9999, cache_creation_tokens: 0, cache_read_tokens: 0, est_usd: 5 },
  ];
  const agg = ut.aggregateWeekly(entries, ut.WEEK_MS, now);
  assert.equal(agg.sessions, 2);
  assert.equal(agg.inputTokens, 250);
  assert.equal(agg.outputTokens, 25);
  assert.ok(Math.abs(agg.estUsd - 0.025) < 1e-9);
});

test('aggregateWeekly excludes a non-numeric token field from that field\'s sum instead of producing NaN/string corruption', () => {
  const now = 1_800_000_000_000;
  const entries = [
    { ts: now - 1000, session_id: 's1', input_tokens: 'not-a-number', output_tokens: 10, cache_creation_tokens: 0, cache_read_tokens: 0, est_usd: 0.01 },
    { ts: now - 500, session_id: 's2', input_tokens: 200, output_tokens: 20, cache_creation_tokens: 0, cache_read_tokens: 0, est_usd: 0.02 },
  ];
  const agg = ut.aggregateWeekly(entries, ut.WEEK_MS, now);
  assert.equal(agg.inputTokens, 200, 'the malformed s1 entry\'s input_tokens must contribute 0, not NaN/string corruption');
  assert.equal(typeof agg.inputTokens, 'number');
  assert.equal(agg.outputTokens, 30);
});

test('renderLine formats session + weekly with cost when known', () => {
  const line = ut.renderLine(
    { inputTokens: 10000, outputTokens: 2400, cacheCreationTokens: 0, cacheReadTokens: 0, estUsd: 0.19 },
    { inputTokens: 80000, outputTokens: 4000, cacheCreationTokens: 0, cacheReadTokens: 0, estUsd: 1.26 }
  );
  assert.match(line, /^\[GENESIS\] 12\.4k tok ~\$0\.19 today \| 84k tok ~\$1\.26 wk$/);
});

test('renderLine omits cost when unknown, still shows tokens', () => {
  const line = ut.renderLine(
    { inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estUsd: null },
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estUsd: null }
  );
  assert.match(line, /^\[GENESIS\] 100 tok today \| 0 tok wk$/);
});

test('renderLine returns empty string when there is nothing to show', () => {
  const zero = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estUsd: null };
  assert.equal(ut.renderLine(zero, zero), '');
});

test('readHistory skips malformed lines and returns emptyish gracefully for a missing file', () => {
  const d = tmpConfigDir();
  const p = path.join(d, 'history.jsonl');
  fs.writeFileSync(p, '{"ts":1,"session_id":"a"}\nnot json\n{"ts":2,"session_id":"b"}\n');
  const entries = ut.readHistory(p);
  assert.equal(entries.length, 2);
  assert.equal(ut.readHistory(path.join(d, 'missing.jsonl')).length, 0);
});

test('readHistory rejects a symlinked history file', () => {
  const d = tmpConfigDir();
  const real = path.join(d, 'real.jsonl');
  fs.writeFileSync(real, '{"ts":1,"session_id":"a"}\n');
  const linked = path.join(d, 'linked.jsonl');
  fs.symlinkSync(real, linked);
  assert.equal(ut.readHistory(linked).length, 0);
});

test('hook mode: end-to-end run appends history and writes the pre-rendered line', () => {
  const configDir = tmpConfigDir();
  const transcript = writeTranscript(configDir, [
    assistantMsg({ input_tokens: 10000, output_tokens: 2400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
  ]);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'usage-tracker.js')], {
    input: JSON.stringify({ session_id: 'sess-1', transcript_path: transcript, cwd: configDir }),
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
  });
  assert.equal(r.status, 0);
  const history = ut.readHistory(path.join(configDir, ut.HISTORY_BASENAME));
  assert.equal(history.length, 1);
  assert.equal(history[0].session_id, 'sess-1');
  assert.equal(history[0].input_tokens, 10000);
  const line = fs.readFileSync(path.join(configDir, ut.LINE_BASENAME), 'utf8');
  assert.match(line, /\[GENESIS\]/);
});

test('hook mode: exits 0 on garbage stdin, writes nothing', () => {
  const configDir = tmpConfigDir();
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'usage-tracker.js')], {
    input: 'not json', encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
  });
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(path.join(configDir, ut.HISTORY_BASENAME)), false);
});

test('hook mode: does not append a history entry when the transcript has zero assistant turns', () => {
  const configDir = tmpConfigDir();
  const transcript = writeTranscript(configDir, [{ type: 'user', message: {} }]);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'usage-tracker.js')], {
    input: JSON.stringify({ session_id: 'sess-2', transcript_path: transcript, cwd: configDir }),
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
  });
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(path.join(configDir, ut.HISTORY_BASENAME)), false);
});
