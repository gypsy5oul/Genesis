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

test('priceFor resolves claude-opus-4-8 to its own 5/25 tier, not the bare claude-opus-4 (15/75) fallback', () => {
  const p = ut.priceFor('claude-opus-4-8');
  assert.deepEqual({ input: p.input, output: p.output }, { input: 5.00, output: 25.00 });
});

test('priceFor resolves claude-opus-4-8[1m] (bracket suffix variant) to the 5/25 tier, not the bare claude-opus-4 (15/75) fallback', () => {
  const p = ut.priceFor('claude-opus-4-8[1m]');
  assert.deepEqual({ input: p.input, output: p.output }, { input: 5.00, output: 25.00 });
});

test('priceFor resolves claude-sonnet-5 to 3.00/15.00, not null', () => {
  const p = ut.priceFor('claude-sonnet-5');
  assert.deepEqual({ input: p.input, output: p.output }, { input: 3.00, output: 15.00 });
});

test('priceFor resolves claude-fable-5 to 10.00/50.00, not null', () => {
  const p = ut.priceFor('claude-fable-5');
  assert.deepEqual({ input: p.input, output: p.output }, { input: 10.00, output: 50.00 });
});

test('priceFor still resolves claude-haiku-4-5 (dated ID) to the existing correct 1.00/5.00 tier', () => {
  const p = ut.priceFor('claude-haiku-4-5-20251001');
  assert.deepEqual({ input: p.input, output: p.output }, { input: 1.00, output: 5.00 });
});

test('estimateCost returns a real non-null dollar figure for claude-sonnet-5 at a realistic token count', () => {
  const pricing = ut.priceFor('claude-sonnet-5');
  const cost = ut.estimateCost({ inputTokens: 100000, outputTokens: 20000, cacheCreationTokens: 5000, cacheReadTokens: 50000 }, pricing);
  assert.ok(typeof cost === 'number' && Number.isFinite(cost) && cost > 0, 'expected a real non-null dollar figure');
  // 100000/1e6*3 + 20000/1e6*15 + 5000/1e6*3.75 + 50000/1e6*0.3
  assert.ok(Math.abs(cost - (0.3 + 0.3 + 0.01875 + 0.015)) < 1e-9);
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
  assert.equal(ut.humanizeTokens(84000), '84k');
  assert.equal(ut.humanizeTokens(1000), '1k');
  assert.equal(ut.humanizeTokens(2_300_000), '2.3M');
  assert.equal(ut.humanizeTokens(0), '0');
});

test('humanizeTokens promotes a k-tier value that rounds up to 1000 into the M tier', () => {
  // 999_999 / 1000 = 999.999, which rounds to 1000.0 at one decimal place —
  // must promote to "1M", not render as the boundary artifact "1000k".
  assert.equal(ut.humanizeTokens(999_999), '1M');
});

test('humanizeTokens does not over-promote a value that stays under the k-tier rounding boundary', () => {
  assert.equal(ut.humanizeTokens(999_499), '999.5k');
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
  assert.match(line, /^\[GENESIS\] 12\.4k tok ~\$0\.19 session \| 84k tok ~\$1\.26 wk$/);
});

test('renderLine omits cost when unknown, still shows tokens', () => {
  const line = ut.renderLine(
    { inputTokens: 100, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estUsd: null },
    { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estUsd: null }
  );
  assert.match(line, /^\[GENESIS\] 100 tok session \| 0 tok wk$/);
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

function runHook(configDir, payload) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'usage-tracker.js')], {
    input: JSON.stringify(payload),
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
  });
}

function sessionLinePath(configDir, sessionId) {
  return path.join(configDir, `${ut.LINE_BASENAME_PREFIX}${sessionId}`);
}

test('hook mode: end-to-end run appends history and writes the pre-rendered line to a SESSION-SCOPED file', () => {
  const configDir = tmpConfigDir();
  const transcript = writeTranscript(configDir, [
    assistantMsg({ input_tokens: 10000, output_tokens: 2400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
  ]);
  const r = runHook(configDir, { session_id: 'sess-1', transcript_path: transcript, cwd: configDir });
  assert.equal(r.status, 0);
  const history = ut.readHistory(path.join(configDir, ut.HISTORY_BASENAME));
  assert.equal(history.length, 1);
  assert.equal(history[0].session_id, 'sess-1');
  assert.equal(history[0].input_tokens, 10000);
  const line = fs.readFileSync(sessionLinePath(configDir, 'sess-1'), 'utf8');
  assert.match(line, /\[GENESIS\]/);
});

test('regression: two concurrent sessions write two DIFFERENT line files with independent content (would have collided under the old shared-file behavior)', () => {
  const configDir = tmpConfigDir();
  const transcriptA = writeTranscript(configDir, [
    assistantMsg({ input_tokens: 10000, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
  ]);
  const rA = runHook(configDir, { session_id: 'session-aaa', transcript_path: transcriptA, cwd: configDir });
  assert.equal(rA.status, 0);

  // Rename the transcript so the second run's usage is unambiguously
  // different (and doesn't merely append to the same weekly history in a
  // way that would mask independent per-session content).
  const transcriptB = path.join(configDir, 'transcript-b.jsonl');
  fs.writeFileSync(transcriptB, [
    JSON.stringify(assistantMsg({ input_tokens: 500000, output_tokens: 90000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })),
  ].join('\n') + '\n');
  const rB = runHook(configDir, { session_id: 'session-bbb', transcript_path: transcriptB, cwd: configDir });
  assert.equal(rB.status, 0);

  const lineA = fs.readFileSync(sessionLinePath(configDir, 'session-aaa'), 'utf8');
  const lineB = fs.readFileSync(sessionLinePath(configDir, 'session-bbb'), 'utf8');
  assert.notEqual(lineA, lineB, 'each session must get its own independent line content');
  assert.match(lineA, /11k tok/); // 10000 + 1000
  assert.match(lineB, /590k tok/); // 500000 + 90000
});

test('a session_id containing unsafe characters is sanitized to a safe filename component before use', () => {
  const configDir = tmpConfigDir();
  const transcript = writeTranscript(configDir, [
    assistantMsg({ input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
  ]);
  const dirty = '../../etc/passwd; rm -rf';
  const r = runHook(configDir, { session_id: dirty, transcript_path: transcript, cwd: configDir });
  assert.equal(r.status, 0);
  const expected = sessionLinePath(configDir, ut.sanitizeSessionId(dirty));
  assert.ok(fs.existsSync(expected), 'expected the sanitized-name line file to exist');
  const line = fs.readFileSync(expected, 'utf8');
  assert.match(line, /\[GENESIS\]/);
});

test('sanitizeSessionId strips unsafe characters, keeps alnum/hyphen/underscore', () => {
  assert.equal(ut.sanitizeSessionId('abc-123_XYZ'), 'abc-123_XYZ');
  assert.equal(ut.sanitizeSessionId('../../etc/passwd'), 'etcpasswd');
  assert.equal(ut.sanitizeSessionId('a b/c:d'), 'abcd');
  assert.equal(ut.sanitizeSessionId(''), '');
  assert.equal(ut.sanitizeSessionId(null), '');
});

test('when sanitizing a session_id strips it to empty, no line file is written at all (never falls back to a fixed/collidable path)', () => {
  const configDir = tmpConfigDir();
  const transcript = writeTranscript(configDir, [
    assistantMsg({ input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
  ]);
  // A session_id made entirely of characters the sanitizer strips.
  const r = runHook(configDir, { session_id: '!!!///:::', transcript_path: transcript, cwd: configDir });
  assert.equal(r.status, 0);
  const entries = fs.readdirSync(configDir);
  const lineFiles = entries.filter(f => f.startsWith('.genesis-usage-line'));
  assert.equal(lineFiles.length, 0, 'no line file of any name should be written when the sanitized session id is empty');
  // History (session-scoped by field, not by filename) still gets written —
  // only the per-turn line file write is skipped.
  const history = ut.readHistory(path.join(configDir, ut.HISTORY_BASENAME));
  assert.equal(history.length, 1);
});

test('the old fixed global .genesis-usage-line file is no longer written', () => {
  const configDir = tmpConfigDir();
  const transcript = writeTranscript(configDir, [
    assistantMsg({ input_tokens: 10000, output_tokens: 2400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
  ]);
  const r = runHook(configDir, { session_id: 'sess-1', transcript_path: transcript, cwd: configDir });
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(path.join(configDir, '.genesis-usage-line')), false,
    'the old global fixed-path line file must not be written anymore');
});

test('the weekly aggregate is unaffected by per-session line-file scoping: it still reads the single shared history file', () => {
  const configDir = tmpConfigDir();
  const transcriptA = writeTranscript(configDir, [
    assistantMsg({ input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
  ]);
  runHook(configDir, { session_id: 'sess-a', transcript_path: transcriptA, cwd: configDir });

  const transcriptB = path.join(configDir, 'transcript-b.jsonl');
  fs.writeFileSync(transcriptB, JSON.stringify(assistantMsg({ input_tokens: 2000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })) + '\n');
  runHook(configDir, { session_id: 'sess-b', transcript_path: transcriptB, cwd: configDir });

  const historyPath = path.join(configDir, ut.HISTORY_BASENAME);
  assert.equal(fs.existsSync(historyPath), true, 'history stays a single shared file');
  const entries = ut.readHistory(historyPath);
  assert.equal(entries.length, 2);
  const weekly = ut.aggregateWeekly(entries, ut.WEEK_MS, Date.now());
  assert.equal(weekly.sessions, 2);
  assert.equal(weekly.inputTokens, 3000);
  assert.equal(weekly.outputTokens, 300);
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

test('reapStaleLineFiles unlinks per-session line files older than the given window, keeps fresh ones', () => {
  const d = tmpConfigDir();
  const now = Date.now();
  const staleOld = path.join(d, `${ut.LINE_BASENAME_PREFIX}stale-old`);
  const staleOlder = path.join(d, `${ut.LINE_BASENAME_PREFIX}stale-older`);
  const fresh = path.join(d, `${ut.LINE_BASENAME_PREFIX}fresh`);
  fs.writeFileSync(staleOld, '[GENESIS] old');
  fs.writeFileSync(staleOlder, '[GENESIS] older');
  fs.writeFileSync(fresh, '[GENESIS] fresh');
  const staleTime = (now - ut.WEEK_MS - 60_000) / 1000;
  fs.utimesSync(staleOld, staleTime, staleTime);
  fs.utimesSync(staleOlder, staleTime, staleTime);

  ut.reapStaleLineFiles(d, ut.WEEK_MS, now);

  assert.equal(fs.existsSync(staleOld), false);
  assert.equal(fs.existsSync(staleOlder), false);
  assert.equal(fs.existsSync(fresh), true);
});

test('reapStaleLineFiles never throws even if the directory is missing', () => {
  assert.doesNotThrow(() => ut.reapStaleLineFiles('/nonexistent/genesis-config-dir', ut.WEEK_MS, Date.now()));
});

test('hook mode: Stop-hook run reaps stale per-session line files (older than the weekly horizon) while keeping the fresh one and the just-written current session line', () => {
  const configDir = tmpConfigDir();

  // Pre-existing stale per-session line files from long-abandoned sessions.
  const staleA = path.join(configDir, `${ut.LINE_BASENAME_PREFIX}old-session-a`);
  const staleB = path.join(configDir, `${ut.LINE_BASENAME_PREFIX}old-session-b`);
  fs.writeFileSync(staleA, '[GENESIS] 1k tok session | 1k tok wk');
  fs.writeFileSync(staleB, '[GENESIS] 2k tok session | 2k tok wk');
  const staleTime = (Date.now() - ut.WEEK_MS - 60_000) / 1000;
  fs.utimesSync(staleA, staleTime, staleTime);
  fs.utimesSync(staleB, staleTime, staleTime);

  // A fresh pre-existing per-session line file that must survive the reap.
  const fresh = path.join(configDir, `${ut.LINE_BASENAME_PREFIX}fresh-session`);
  fs.writeFileSync(fresh, '[GENESIS] 3k tok session | 3k tok wk');

  const transcript = writeTranscript(configDir, [
    assistantMsg({ input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
  ]);
  const r = runHook(configDir, { session_id: 'current-session', transcript_path: transcript, cwd: configDir });
  assert.equal(r.status, 0);

  assert.equal(fs.existsSync(staleA), false, 'stale session-a line file must be reaped');
  assert.equal(fs.existsSync(staleB), false, 'stale session-b line file must be reaped');
  assert.equal(fs.existsSync(fresh), true, 'fresh pre-existing line file must survive the reap');
  assert.equal(fs.existsSync(sessionLinePath(configDir, 'current-session')), true, 'the newly-written current-session line file must exist');
});
