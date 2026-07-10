#!/usr/bin/env node
'use strict';
// PreToolUse hook (Edit|Write|MultiEdit|Bash).
// gate-protocol.md says only the human's "approve <stage>" may set a stage's
// status to "approved" — but that rule lives in prompt text only. Nothing
// stops the model from writing status: "approved" straight into
// docs/sdlc/state.json via Edit/Write, or via a Bash command. This hook
// denies any direct Edit/Write/MultiEdit that would set a stage status to
// "approved" outright, and heuristically denies Bash commands that look
// like they'd do the same (see looksLikeStateJsonTamperingCommand) — a
// best-effort net, not an absolute guarantee, since Bash is
// Turing-complete and a sufficiently determined bypass (piping through an
// interpreter, etc.) isn't caught. Legitimate approvals never go through
// any of these tools — approveStage() (in sdlc-state.js, invoked by the
// UserPromptSubmit hook) writes via fs directly, so this guard never
// blocks the real approval path.
// Contract: never block session on a hook bug; always exit 0.
const path = require('path');
const { statePath } = require('./sdlc-state');

const APPROVED_STATUS_RE = /"status"\s*:\s*"approved"/;

// Best-effort heuristic for a Bash command that plausibly mutates
// state.json to set an approved status directly (e.g. `sed -i
// 's/awaiting-approval/approved/' docs/sdlc/state.json`), bypassing the
// Edit/Write/MultiEdit guard below entirely. Bash is Turing-complete —
// this cannot catch every possible bypass (piping through an interpreter,
// base64, etc.) and will have false positives on some legitimate commands
// mentioning both words; it raises the bar for the common case, it does
// not make tampering impossible.
const STATE_JSON_RE = /state\.json/;
const APPROVED_WORD_RE = /approved/;
const WRITE_LIKE_RE = /(>|>>|sed\s+-i|perl\s+-i|tee\b|\bcp\b|\bmv\b|\bdd\s+of=)/;

function looksLikeStateJsonTamperingCommand(command) {
  if (typeof command !== 'string' || !command) return false;
  return STATE_JSON_RE.test(command) && APPROVED_WORD_RE.test(command) && WRITE_LIKE_RE.test(command);
}

function resolvesToStateFile(cwd, filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  return path.resolve(cwd, filePath) === path.resolve(statePath(cwd));
}

function newContentStrings(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  if (toolName === 'Write') return [String(toolInput.content || '')];
  if (toolName === 'Edit') return [String(toolInput.new_string || '')];
  if (toolName === 'MultiEdit' && Array.isArray(toolInput.edits)) {
    return toolInput.edits.map(e => String((e && e.new_string) || ''));
  }
  return [];
}

function deny(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  });
}

let input = '';
process.stdin.on('data', c => { input += c; });
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const cwd = (data && typeof data.cwd === 'string') ? data.cwd : process.cwd();
    const toolName = data && data.tool_name;
    const toolInput = data && data.tool_input;
    if (['Edit', 'Write', 'MultiEdit'].includes(toolName) &&
        resolvesToStateFile(cwd, toolInput && toolInput.file_path)) {
      const strings = newContentStrings(toolName, toolInput);
      if (strings.some(s => APPROVED_STATUS_RE.test(s))) {
        process.stdout.write(deny(
          'Only the human\'s "approve <stage>" (handled by the UserPromptSubmit hook) may set a stage to "approved". Direct edits to docs/sdlc/state.json cannot set that status — say "approve <stage>" instead.'
        ));
        return process.exit(0);
      }
    }
    if (toolName === 'Bash' && looksLikeStateJsonTamperingCommand(toolInput && toolInput.command)) {
      process.stdout.write(deny(
        'This Bash command looks like it could set docs/sdlc/state.json\'s status to "approved" directly. Only the human\'s "approve <stage>" (handled by the UserPromptSubmit hook) may do that — say "approve <stage>" instead.'
      ));
      return process.exit(0);
    }
  } catch { /* silent — never block the tool call on a hook bug */ }
  process.exit(0);
});

module.exports = { resolvesToStateFile, newContentStrings, APPROVED_STATUS_RE, looksLikeStateJsonTamperingCommand };
