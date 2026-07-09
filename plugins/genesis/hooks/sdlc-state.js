'use strict';
const fs = require('fs');
const path = require('path');
const { writeFileSafe, withLock } = require('./safe-fs');

const STAGES = ['requirements','feasibility','plan','design','develop','test','uat','deploy','monitor','maintain'];
const STATUSES = ['pending','in-progress','awaiting-approval','approved'];
const MAX_STATE_BYTES = 262144;

function statePath(cwd) { return path.join(cwd, 'docs', 'sdlc', 'state.json'); }

function readState(cwd) {
  try {
    const p = statePath(cwd);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_STATE_BYTES) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!data || typeof data !== 'object' || typeof data.project !== 'string' || typeof data.stages !== 'object') return null;
    for (const k of Object.keys(data.stages)) {
      const entry = data.stages[k];
      if (entry && entry.status !== undefined && !STATUSES.includes(entry.status)) return null;
    }
    return data;
  } catch { return null; }
}

function writeState(cwd, state) {
  writeFileSafe(cwd, statePath(cwd), JSON.stringify(state, null, 2) + '\n');
}

// U+200B-U+200F: zero-width space/joiners + LTR/RTL marks.
// U+202A-U+202E: bidi embed/override. U+2066-U+2069: bidi isolates.
// U+FEFF: zero-width no-break space / BOM.
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function clean(s, max = 200) {
  return String(s == null ? '' : s)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(INVISIBLE_CHARS, '')
    .slice(0, max);
}

function stageEntry(state, stage) {
  return (state.stages && state.stages[stage]) || { status: 'pending' };
}

function pendingGate(state) {
  for (const s of STAGES) if (stageEntry(state, s).status === 'awaiting-approval') return s;
  return null;
}

function priorStage(stage) {
  const i = STAGES.indexOf(stage);
  return i > 0 ? STAGES[i - 1] : null;
}

function nextStage(stage) {
  const i = STAGES.indexOf(stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

function summaryLine(state) {
  const done = STAGES.filter(s => stageEntry(state, s).status === 'approved').length;
  const gate = pendingGate(state);
  let line = `SDLC project "${clean(state.project)}" — ${done}/${STAGES.length} stages approved, current stage: ${clean(state.currentStage) || 'not started'}.`;
  if (gate) {
    const artifact = clean(stageEntry(state, gate).artifact) || 'artifact';
    line += ` Stage "${clean(gate)}" awaiting approval — review ${artifact}, then say "approve ${clean(gate)}".`;
  }
  return line;
}

function renderStatus(state) {
  const rows = STAGES.map(s => {
    const e = stageEntry(state, s);
    return `${s.padEnd(14)} ${clean(e.status || 'pending').padEnd(18)} ${clean(e.artifact) || '-'}`;
  });
  const gate = pendingGate(state);
  return [
    `SDLC status — ${clean(state.project)}`,
    `idea: ${clean(state.idea) || '-'}`,
    '',
    `${'stage'.padEnd(14)} ${'status'.padEnd(18)} artifact`,
    ...rows,
    '',
    gate ? `Pending gate: say "approve ${clean(gate)}" to proceed.` : 'No pending gate.'
  ].join('\n');
}

function approveStage(cwd, stage) {
  try {
    return withLock(statePath(cwd) + '.lock', () => {
      const state = readState(cwd);
      if (!state) return { ok: false, msg: 'No docs/sdlc/state.json found. Run /genesis:init first.' };
      const e = stageEntry(state, stage);
      if (e.status !== 'awaiting-approval') {
        return { ok: false, msg: `Stage "${stage}" is "${e.status}", not awaiting-approval. Nothing changed.` };
      }
      const prior = priorStage(stage);
      if (prior && stageEntry(state, prior).status !== 'approved') {
        return { ok: false, msg: `Stage "${stage}" cannot be approved before "${prior}" is approved. Nothing changed.` };
      }
      e.status = 'approved';
      e.approvedAt = new Date().toISOString();
      state.stages[stage] = e;
      state.decisions = Array.isArray(state.decisions) ? state.decisions : [];
      state.decisions.push(`approved ${stage} at ${e.approvedAt}`);
      const next = nextStage(stage);
      state.currentStage = next || stage;
      writeState(cwd, state);
      return { ok: true, msg: `Stage "${stage}" approved.` + (next ? ` Next: /genesis:${next}` : ' All stages done.') };
    });
  } catch (e) {
    // Lock timeout, disk-full, symlink refusal, etc. — surface it instead of
    // letting the caller's catch-all swallow it into total silence.
    return { ok: false, msg: `Failed to save approval: ${e.message}. State not changed.` };
  }
}

module.exports = {
  STAGES, STATUSES, MAX_STATE_BYTES, statePath, readState, writeState, stageEntry, clean,
  pendingGate, priorStage, nextStage, summaryLine, renderStatus, approveStage
};
