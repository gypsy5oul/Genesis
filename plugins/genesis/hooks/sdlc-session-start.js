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
const { grammarsAvailable } = require('./graph-parse');

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Marker persisted once per project so the codegraph notice below is a single
// message, not a per-session nag — lives under docs/sdlc/ alongside the graph
// (graph.json) and debt ledger (debt.json) it concerns.
function codegraphNoticePath(cwd) {
  return path.join(cwd, 'docs', 'sdlc', '.codegraph-notice-shown');
}

// One-time nudge, mirroring statuslineNudge's "tell them once, never nag"
// contract. Fires only when BOTH hold:
//   - the project is Genesis-initialized (hasState) — a codegraph notice is
//     pointless noise in a project that never ran /genesis:init;
//   - the native tree-sitter grammars can't be resolved, so the structural
//     code graph is silently disabled (parseFile returns null for everything).
// Everything else — stage gates, the review loop, and the genesis: debt-marker
// ledger — keeps working WITHOUT the grammars (the debt scan is a plain text
// scan, independent of tree-sitter), so the message says so and does not
// overstate what's broken. Returns the message the first time, then drops a
// marker so it never repeats for this project; returns null when silent.
function codegraphNotice(cwd, hasState) {
  try {
    if (!hasState || grammarsAvailable()) return null;
    const marker = codegraphNoticePath(cwd);
    try { if (fs.existsSync(marker)) return null; } catch { /* unreadable — prefer notifying once over crashing */ }
    // ${CLAUDE_PLUGIN_ROOT} is the plugin's own installed directory; never
    // hardcode a path — a marketplace install lives somewhere we can't predict.
    const root = process.env.CLAUDE_PLUGIN_ROOT;
    const target = root ? `"${clean(root)}"` : 'the installed genesis plugin directory (its path is in $CLAUDE_PLUGIN_ROOT)';
    // Persist the marker BEFORE returning so a crash between message and
    // persist can't turn this into a recurring nag; if the write fails we
    // still show it once this session rather than erroring.
    try { fs.writeFileSync(marker, new Date().toISOString() + '\n'); } catch { /* couldn't persist — show once anyway */ }
    return `Genesis code graph is off: its native tree-sitter parsers aren't installed. To turn it on, run this once — \`npm install --prefix ${target}\` — then restart the session. Everything else works without it: stage gates, the review loop, and the genesis: debt-marker ledger all run normally.`;
  } catch {
    return null;
  }
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
      return 'Genesis can show live Claude plan usage (5-hour rolling window % and weekly %, color-coded) plus the current model name in your statusline (currently unset) — offer to set it up.';
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

// Only attach stdin listeners when run as the actual hook. Guarding this the
// same way graph-index.js guards its runHook() keeps `require()` of this file
// side-effect-free: without the guard, requiring it (as the codegraph-notice
// tests and any future consumer do) registers a stdin 'end' listener that
// keeps the event loop alive forever, hanging the requiring process.
if (require.main === module) {
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
      const codegraph = codegraphNotice(cwd, !!state);
      if (codegraph) parts.push(codegraph);
      const nudge = statuslineNudge();
      if (nudge) parts.push(nudge);
      if (parts.length) process.stdout.write(parts.join('\n\n'));
    } catch { /* silent */ }
    process.exit(0);
  });
}

module.exports = { statuslineNudge, claudeConfigDir, codegraphNotice, codegraphNoticePath };
