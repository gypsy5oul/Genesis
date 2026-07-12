#!/usr/bin/env node
'use strict';
// PreToolUse hook (Edit|Write|MultiEdit|Bash).
// gate-protocol.md says only the human's "approve <stage>" may set a stage's
// status to "approved" — but that rule lives in prompt text only. Nothing
// stops the model from writing status: "approved" straight into
// docs/sdlc/state.json via Edit/Write, or via a Bash command. This hook
// denies any direct Edit/Write/MultiEdit that would introduce a NEW
// approved status (a stage that was not already "approved" on disk becoming
// "approved" in the prospective new content), and heuristically denies Bash
// commands that look like they'd do the same (see
// looksLikeStateJsonTamperingCommand) — a best-effort net, not an absolute
// guarantee, since Bash is Turing-complete and a sufficiently determined
// bypass (piping through an interpreter, etc.) isn't caught. Legitimate
// approvals never go through any of these tools — approveStage() (in
// sdlc-state.js, invoked by the UserPromptSubmit hook) writes via fs
// directly, so this guard never blocks the real approval path.
//
// The transition check (not a blunt "does the new content contain the
// string approved anywhere") matters: a legitimate full-file Write that
// sets the CURRENT stage to "in-progress" per gate-protocol.md necessarily
// re-serializes every already-approved PRIOR stage, so its content contains
// "status": "approved" for those unchanged entries. The old blunt substring
// check denied that legitimate write. We now compare the prospective new
// state against the on-disk state and only deny when some stage's status
// actually transitions from non-approved to "approved". When we cannot
// cleanly determine "no new approval" (content doesn't parse as the
// expected state shape, an Edit's old_string isn't found, etc.) we fall
// back to the old conservative substring check — never fail open on
// ambiguity.
// Contract: never block session on a hook bug; always exit 0.
const fs = require('fs');
const path = require('path');
const { statePath, readState, STAGES, MAX_STATE_BYTES } = require('./sdlc-state');

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

// Set of stage names whose status is "approved" in a parsed state object.
// Iterates every present stage key (not just STAGES) so a would-be tamper
// on an unexpected key still counts. Tolerant of any shape.
function approvedStageSet(state) {
  const set = new Set();
  const stages = state && typeof state === 'object' ? state.stages : null;
  if (!stages || typeof stages !== 'object') return set;
  for (const k of Object.keys(stages)) {
    const e = stages[k];
    if (e && typeof e === 'object' && e.status === 'approved') set.add(k);
  }
  return set;
}

// Given the OLD on-disk state (from readState, may be null) and a prospective
// NEW full-file content string, returns:
//   { decided: true, introduced: <stageName|null> } when the new content
//     parses cleanly as the expected state shape — introduced is the first
//     stage that becomes "approved" without having been "approved" before,
//     or null if no such new approval exists.
//   { decided: false } when the content does not parse as the expected shape,
//     so the caller must fall back to the conservative substring check.
function newApprovalFromContent(oldState, content) {
  let parsed;
  try { parsed = JSON.parse(content); } catch { return { decided: false }; }
  if (!parsed || typeof parsed !== 'object' || !parsed.stages || typeof parsed.stages !== 'object') {
    return { decided: false };
  }
  const oldApproved = approvedStageSet(oldState);
  for (const k of Object.keys(parsed.stages)) {
    const e = parsed.stages[k];
    if (e && typeof e === 'object' && e.status === 'approved' && !oldApproved.has(k)) {
      return { decided: true, introduced: k };
    }
  }
  return { decided: true, introduced: null };
}

// Reads the raw on-disk state.json text with the same size-cap / symlink
// guards the rest of this hook family uses (see readState in sdlc-state.js),
// so an Edit/MultiEdit can be simulated against the real current file text.
// Returns null when the file is missing, a symlink, oversized, or unreadable.
function readStateText(cwd) {
  try {
    const p = statePath(cwd);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_STATE_BYTES) return null;
    return fs.readFileSync(p, 'utf8');
  } catch { return null; }
}

// Applies a list of {old_string,new_string} replacements to `text` in order,
// mirroring what the real Edit/MultiEdit tool would produce. Each replacement
// must find its old_string (single replace of the first occurrence, as the
// Edit tool requires a unique match); returns null if any old_string is
// absent, so the caller falls back to the conservative check.
function applyEdits(text, edits) {
  let out = text;
  for (const ed of edits) {
    const oldStr = ed && ed.old_string != null ? String(ed.old_string) : '';
    const newStr = ed && ed.new_string != null ? String(ed.new_string) : '';
    const idx = out.indexOf(oldStr);
    if (oldStr === '' || idx === -1) return null;
    out = out.slice(0, idx) + newStr + out.slice(idx + oldStr.length);
  }
  return out;
}

// Builds the prospective new full-file content for a file tool, or returns
// null when it can't be reconstructed (so the caller falls back). For Write
// it's the content verbatim; for Edit/MultiEdit it's the on-disk text with
// the replacement(s) applied in order.
function prospectiveContent(cwd, toolName, toolInput) {
  if (toolName === 'Write') {
    return typeof toolInput.content === 'string' ? toolInput.content : null;
  }
  const base = readStateText(cwd);
  if (base == null) return null;
  if (toolName === 'Edit') {
    return applyEdits(base, [{ old_string: toolInput.old_string, new_string: toolInput.new_string }]);
  }
  if (toolName === 'MultiEdit' && Array.isArray(toolInput.edits)) {
    return applyEdits(base, toolInput.edits);
  }
  return null;
}

// The transition-based decision for an Edit/Write/MultiEdit targeting
// state.json. Returns true to DENY. Deny when a real non-approved -> approved
// transition is detected in the prospective new content; when the prospective
// content can't be cleanly reconstructed/parsed, fall back to the old
// conservative substring check over the raw new-content strings.
function fileEditIntroducesApproval(cwd, toolName, toolInput) {
  const content = prospectiveContent(cwd, toolName, toolInput);
  if (content != null) {
    const result = newApprovalFromContent(readState(cwd), content);
    if (result.decided) return result.introduced != null;
  }
  // Fallback: conservative substring check on the raw new-content string(s).
  return newContentStrings(toolName, toolInput).some(s => APPROVED_STATUS_RE.test(s));
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
        resolvesToStateFile(cwd, toolInput && toolInput.file_path) &&
        toolInput && typeof toolInput === 'object') {
      if (fileEditIntroducesApproval(cwd, toolName, toolInput)) {
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

module.exports = {
  resolvesToStateFile, newContentStrings, APPROVED_STATUS_RE, looksLikeStateJsonTamperingCommand,
  approvedStageSet, newApprovalFromContent, readStateText, applyEdits, prospectiveContent,
  fileEditIntroducesApproval
};
