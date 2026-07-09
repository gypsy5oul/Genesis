#!/usr/bin/env node
'use strict';
// SessionStart hook (matcher startup|clear|compact — spec §11.5).
// Injects a one-paragraph SDLC summary from the target project's state.json,
// plus a statusline-setup nudge (independent of whether an SDLC project
// exists — this is a general Genesis capability, not project-scoped).
// Contract: never block session start; env/parse errors → silent exit 0.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readState, summaryLine, clean } = require('./sdlc-state');

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Returns a line of guidance for the assistant, or null if nothing to say.
// Never touches settings.json itself — only the assistant, on the user's
// explicit confirmation, does that.
function statuslineNudge() {
  try {
    const settingsPath = path.join(claudeConfigDir(), 'settings.json');
    let settings = null;
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* unset or unreadable */ }
    const current = settings && settings.statusLine && settings.statusLine.command;
    if (!current) {
      return 'Genesis can show live session/weekly token usage + est. cost in your statusline (currently unset) — offer to set it up.';
    }
    if (current.includes('usage-statusline.sh')) {
      return null;
    }
    // The statusline command string comes straight from the user's own
    // settings.json, but that doesn't make it safe to interpolate verbatim
    // into text that enters model context — same sanitization sdlc-state.js's
    // clean() applies to every other value that does (control/bidi/zero-width
    // chars stripped, length-capped).
    return `Statusline is currently set to a different command ("${clean(current)}"). If the user asks about Genesis's usage-tracking statusline, mention it would replace that — ask before changing it, never overwrite silently.`;
  } catch {
    return null;
  }
}

let input = '';
process.stdin.on('data', c => { input += c; });
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  try {
    let cwd = process.cwd();
    try {
      const data = JSON.parse(input);
      if (data && typeof data.cwd === 'string') cwd = data.cwd;
    } catch { /* fall back to process.cwd() */ }
    const parts = [];
    const state = readState(cwd);
    if (state) {
      parts.push(summaryLine(state) +
        '\nStatus board: /genesis:status (hook-rendered, zero tokens). Stages never auto-chain; each needs human approval.');
    }
    const nudge = statuslineNudge();
    if (nudge) parts.push(nudge);
    if (parts.length) process.stdout.write(parts.join('\n\n'));
  } catch { /* silent */ }
  process.exit(0);
});

module.exports = { statuslineNudge, claudeConfigDir };
