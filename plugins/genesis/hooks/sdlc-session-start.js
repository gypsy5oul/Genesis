#!/usr/bin/env node
'use strict';
// SessionStart hook (matcher startup|clear|compact — spec §11.5).
// Injects a one-paragraph SDLC summary from the target project's state.json.
// Contract: never block session start; env/parse errors → silent exit 0.
const { readState, summaryLine } = require('./sdlc-state');

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
    const state = readState(cwd);
    if (state) {
      process.stdout.write(summaryLine(state) +
        '\nStatus board: /genesis:status (hook-rendered, zero tokens). Stages never auto-chain; each needs human approval.');
    }
  } catch { /* silent */ }
  process.exit(0);
});
