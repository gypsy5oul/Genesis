#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeFileSafe, appendFileSafe } = require('./safe-fs');

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

const HISTORY_BASENAME = '.genesis-usage-history.jsonl';
const LINE_BASENAME = '.genesis-usage-line';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// USD per million tokens. Cache write/read priced as multiples of the base
// input price per Anthropic's published cache-pricing structure (write
// ~1.25x input, read ~0.1x input) — approximate, will need updates when
// Anthropic changes rates. https://www.anthropic.com/pricing
// Most-specific prefixes MUST come first — priceFor returns the first match.
const MODEL_PRICING = [
  ['claude-opus-4-5',     5.00, 25.00],
  ['claude-opus-4-1',    15.00, 75.00],
  ['claude-opus-4-0',    15.00, 75.00],
  ['claude-opus-4',      15.00, 75.00], // fallback: bare dated 4.0 IDs (e.g. claude-opus-4-20250514)
  ['claude-sonnet-4-5',   3.00, 15.00],
  ['claude-sonnet-4',     3.00, 15.00],
  ['claude-haiku-4-5',    1.00,  5.00],
  ['claude-haiku-4',      1.00,  5.00],
  ['claude-3-7-sonnet',   3.00, 15.00],
  ['claude-3-5-sonnet',   3.00, 15.00],
  ['claude-3-5-haiku',    0.80,  4.00],
  ['claude-3-opus',      15.00, 75.00],
  ['claude-3-haiku',      0.25,  1.25],
];
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

// A malformed/adversarial transcript line or a hand-edited history entry
// can carry a non-numeric token count (e.g. a string "1e9"). `v || 0`
// doesn't catch this — a non-empty string is truthy, so `total += "1e9"`
// silently becomes string concatenation instead of arithmetic, corrupting
// the running total (and, for transcript data, everything written
// permanently into the history log from that point on). Coerce anything
// that isn't a finite number to 0 instead.
function safeNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function priceFor(model) {
  if (!model) return null;
  for (const [prefix, input, output] of MODEL_PRICING) {
    if (model.startsWith(prefix)) {
      return { input, output, cacheWrite: input * CACHE_WRITE_MULTIPLIER, cacheRead: input * CACHE_READ_MULTIPLIER };
    }
  }
  return null;
}

function estimateCost(usage, pricing) {
  if (!pricing) return null;
  return (usage.inputTokens / 1e6) * pricing.input +
         (usage.outputTokens / 1e6) * pricing.output +
         (usage.cacheCreationTokens / 1e6) * pricing.cacheWrite +
         (usage.cacheReadTokens / 1e6) * pricing.cacheRead;
}

function computeSessionUsage(transcriptPath) {
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); }
  catch { return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, model: null, turns: 0 }; }

  let inputTokens = 0, outputTokens = 0, cacheCreationTokens = 0, cacheReadTokens = 0, turns = 0, model = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'assistant' || !entry.message) continue;
    const usage = entry.message.usage;
    if (!usage) continue;
    inputTokens         += safeNum(usage.input_tokens);
    outputTokens        += safeNum(usage.output_tokens);
    cacheCreationTokens += safeNum(usage.cache_creation_input_tokens);
    cacheReadTokens      += safeNum(usage.cache_read_input_tokens);
    turns++;
    if (!model && entry.message.model) model = entry.message.model;
  }
  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, model, turns };
}

function humanizeTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) {
    // Rounding to one decimal in the k-tier (e.g. 999_999 -> 999.999k) can
    // round UP to 1000.0 — that must promote to the M tier ("1M"), not
    // render as the "1000k" boundary artifact.
    const rounded = Math.round((n / 1e3) * 10) / 10;
    if (rounded >= 1000) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    return rounded.toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return String(Math.round(n));
}

function formatUsd(amount) {
  if (amount == null) return null;
  if (amount >= 0.1) return `$${amount.toFixed(2)}`;
  if (amount >= 0.01) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(4)}`;
}

function totalTokens(u) {
  return (u.inputTokens || 0) + (u.outputTokens || 0) + (u.cacheCreationTokens || 0) + (u.cacheReadTokens || 0);
}

function readHistory(historyPath) {
  try {
    const st = fs.lstatSync(historyPath);
    if (st.isSymbolicLink() || !st.isFile()) return [];
    const raw = fs.readFileSync(historyPath, 'utf8');
    const entries = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && typeof e === 'object' && typeof e.ts === 'number' && typeof e.session_id === 'string') entries.push(e);
      } catch { /* skip malformed line */ }
    }
    return entries;
  } catch {
    return [];
  }
}

// Latest entry per session_id, filtered to the trailing `windowMs`. Each
// history line is a session's cumulative running total as of that Stop
// event, not a delta — summing every line would double-count, so only the
// newest line per session counts (mirrors caveman's aggregateHistory).
function aggregateWeekly(entries, windowMs, nowMs) {
  const cutoff = nowMs - windowMs;
  const latestPerSession = new Map();
  for (const e of entries) {
    if (e.ts < cutoff) continue;
    const prev = latestPerSession.get(e.session_id);
    if (!prev || e.ts >= prev.ts) latestPerSession.set(e.session_id, e);
  }
  let inputTokens = 0, outputTokens = 0, cacheCreationTokens = 0, cacheReadTokens = 0, estUsd = 0, hasCost = false;
  for (const e of latestPerSession.values()) {
    inputTokens += safeNum(e.input_tokens);
    outputTokens += safeNum(e.output_tokens);
    cacheCreationTokens += safeNum(e.cache_creation_tokens);
    cacheReadTokens += safeNum(e.cache_read_tokens);
    if (typeof e.est_usd === 'number') { estUsd += e.est_usd; hasCost = true; }
  }
  return {
    sessions: latestPerSession.size,
    inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
    estUsd: hasCost ? estUsd : null,
  };
}

function renderLine(session, weekly) {
  const sessionTotal = totalTokens(session);
  const weeklyTotal = totalTokens(weekly);
  if (sessionTotal <= 0 && weeklyTotal <= 0) return '';
  const sessionCost = session.estUsd != null ? ` ~${formatUsd(session.estUsd)}` : '';
  const weeklyCost = weekly.estUsd != null ? ` ~${formatUsd(weekly.estUsd)}` : '';
  return `[GENESIS] ${humanizeTokens(sessionTotal)} tok${sessionCost} today | ${humanizeTokens(weeklyTotal)} tok${weeklyCost} wk`;
}

function main() {
  let input = '';
  process.stdin.on('data', c => { input += c; });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const transcriptPath = data && data.transcript_path;
      if (typeof transcriptPath === 'string') {
        const sessionId = (data && data.session_id) || path.basename(transcriptPath, '.jsonl');
        const usage = computeSessionUsage(transcriptPath);
        const pricing = priceFor(usage.model);
        const estUsd = estimateCost(usage, pricing);
        const claudeDir = claudeConfigDir();
        const historyPath = path.join(claudeDir, HISTORY_BASENAME);
        const linePath = path.join(claudeDir, LINE_BASENAME);

        if (usage.turns > 0) {
          appendFileSafe(claudeDir, historyPath, JSON.stringify({
            ts: Date.now(),
            session_id: sessionId,
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            cache_creation_tokens: usage.cacheCreationTokens,
            cache_read_tokens: usage.cacheReadTokens,
            est_usd: estUsd,
            model: usage.model,
          }));
        }

        const entries = readHistory(historyPath);
        const weekly = aggregateWeekly(entries, WEEK_MS, Date.now());
        const line = renderLine({ ...usage, estUsd }, weekly);
        if (line) writeFileSafe(claudeDir, linePath, line, { backup: false });
      }
    } catch { /* silent — never block the session on a hook bug */ }
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = {
  computeSessionUsage, priceFor, estimateCost, humanizeTokens, formatUsd,
  totalTokens, readHistory, aggregateWeekly, renderLine, claudeConfigDir, safeNum,
  MODEL_PRICING, CACHE_WRITE_MULTIPLIER, CACHE_READ_MULTIPLIER,
  HISTORY_BASENAME, LINE_BASENAME, WEEK_MS,
};
