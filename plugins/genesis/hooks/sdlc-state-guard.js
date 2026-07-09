#!/usr/bin/env node
'use strict';
// PreToolUse hook (Edit|Write|MultiEdit).
// gate-protocol.md says only the human's "approve <stage>" may set a stage's
// status to "approved" — but that rule lives in prompt text only. Nothing
// stops the model from writing status: "approved" straight into
// docs/sdlc/state.json via Edit/Write. This hook is the actual enforcement:
// it denies any direct write that would set a stage status to "approved".
// Legitimate approvals never go through Edit/Write — approveStage() (in
// sdlc-state.js, invoked by the UserPromptSubmit hook) writes via fs
// directly, so this guard never blocks the real approval path.
// Contract: never block session on a hook bug; always exit 0.
const path = require('path');
const { statePath } = require('./sdlc-state');

const APPROVED_STATUS_RE = /"status"\s*:\s*"approved"/;

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
  } catch { /* silent — never block the tool call on a hook bug */ }
  process.exit(0);
});

module.exports = { resolvesToStateFile, newContentStrings, APPROVED_STATUS_RE };
