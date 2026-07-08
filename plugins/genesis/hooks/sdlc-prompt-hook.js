#!/usr/bin/env node
'use strict';
// UserPromptSubmit hook (spec §10.1):
//  1. /genesis:status (also /sdlc:status, /status-sdlc variants) → block, render board. Zero model tokens.
//  2. "approve <stage>" → deterministic state mutation, block with result. Question guard.
//  3. Pending gate → one-line additionalContext reminder (survives compaction).
// Contract: always exit 0; never inject unvalidated file bytes.
const { STAGES, readState, pendingGate, renderStatus, approveStage, stageEntry } = require('./sdlc-state');

let input = '';
process.stdin.on('data', c => { input += c; });
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const cwd = (data && typeof data.cwd === 'string') ? data.cwd : process.cwd();
    const prompt = String((data && data.prompt) || '').trim().toLowerCase().replace(/\s+/g, ' ');

    // 1. status command — accept namespaced and bare forms
    if (/^\/(?:genesis:)?(?:sdlc[-:])?status\b/.test(prompt)) {
      const state = readState(cwd);
      const reason = state ? renderStatus(state) : 'No SDLC project here. Run /genesis:init first.';
      process.stdout.write(JSON.stringify({ decision: 'block', reason }));
      return process.exit(0);
    }

    // 2. approvals — questions about approving are not approvals
    const isQuestion = /\?\s*$/.test(prompt) ||
      /^(what|whats|what's|why|how|when|where|who|should|shall|can|could|would|do|does|did|is|are)\b/.test(prompt);
    const m = new RegExp('^(?:please )?approve (' + STAGES.join('|') + ')\\b').exec(prompt);
    if (m && !isQuestion) {
      const res = approveStage(cwd, m[1]);
      process.stdout.write(JSON.stringify({ decision: 'block', reason: res.msg }));
      return process.exit(0);
    }

    // 3. per-turn gate reminder
    const state = readState(cwd);
    if (state) {
      const gate = pendingGate(state);
      if (gate) {
        const artifact = stageEntry(state, gate).artifact || 'the stage artifact';
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: `SDLC: stage "${gate}" awaiting approval — review ${artifact}, then say "approve ${gate}". No stage auto-chains.`
          }
        }));
      }
    }
  } catch { /* silent */ }
  process.exit(0);
});
