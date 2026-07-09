'use strict';
const fs = require('fs');
const path = require('path');

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

// Refuses to write through a symlinked directory component between cwd and
// the target path — closes the gap where a malicious cloned repo ships
// docs/ (or docs/sdlc/) as a symlink to write state outside the project.
function assertNoSymlinkInPath(cwd, targetDir) {
  const rel = path.relative(cwd, targetDir);
  let cur = cwd;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur); } catch { return; } // not created yet — fine
    if (st.isSymbolicLink()) {
      throw new Error(`refusing to write through symlinked path: ${cur}`);
    }
  }
}

function writeState(cwd, state) {
  const p = statePath(cwd);
  assertNoSymlinkInPath(cwd, path.dirname(p));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    if (fs.lstatSync(p).isSymbolicLink()) {
      throw new Error(`refusing to write: ${p} is a symlink`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (fs.existsSync(p)) {
    try { fs.copyFileSync(p, p + '.bak'); } catch { /* backup failure must not block the write */ }
  }
  // Unique per call — a fixed temp name lets two concurrent processes
  // clobber each other's in-flight write.
  const tmp = `${p}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

// Advisory lock via O_EXCL so concurrent processes' read-modify-write
// (e.g. two approveStage calls) can't lose an update to a last-writer-wins
// race. Stale locks (LOCK_STALE_MS old) are treated as abandoned.
const LOCK_STALE_MS = 10000;
const LOCK_RETRY_MS = 20;
const LOCK_TIMEOUT_MS = 2000;

function acquireLock(cwd) {
  const lockPath = statePath(cwd) + '.lock';
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return lockPath;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = Infinity;
      try { age = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { /* raced away */ }
      if (age > LOCK_STALE_MS) {
        try { fs.unlinkSync(lockPath); } catch { /* raced away, retry loop handles it */ }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for lock: ${lockPath}`);
      }
      const buf = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(buf, 0, 0, LOCK_RETRY_MS);
    }
  }
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* best-effort */ }
}

function withLock(cwd, fn) {
  const lockPath = acquireLock(cwd);
  try {
    return fn();
  } finally {
    releaseLock(lockPath);
  }
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
    return withLock(cwd, () => {
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
