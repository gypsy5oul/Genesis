'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const lib = require('../hooks/sdlc-state');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-guard-'));
}
// Write a real docs/sdlc/state.json to disk so the transition check has an
// OLD state to compare against. Returns the serialized text (handy when a
// test needs to build an Edit whose old_string matches the on-disk bytes).
function seedState(d, state) {
  const p = lib.statePath(d);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const text = JSON.stringify(state, null, 2) + '\n';
  fs.writeFileSync(p, text);
  return text;
}
function stateWith(stages) {
  return { project: 'demo', currentStage: 'feasibility', stages };
}
function runGuard(payload) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'sdlc-state-guard.js')], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', timeout: 5000
  });
}
function deny(r) {
  const out = r.stdout.trim();
  if (!out) return null;
  const parsed = JSON.parse(out);
  return parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecision === 'deny' ? parsed.hookSpecificOutput : null;
}

test('guard: denies Write that sets a stage status to "approved" in state.json', () => {
  const d = tmpProject();
  const r = runGuard({
    cwd: d, tool_name: 'Write',
    tool_input: { file_path: lib.statePath(d), content: '{"stages":{"requirements":{"status":"approved"}}}' }
  });
  assert.equal(r.status, 0);
  assert.ok(deny(r), 'expected a deny decision');
});

test('guard: denies Edit whose new_string sets status to "approved" in state.json', () => {
  const d = tmpProject();
  const r = runGuard({
    cwd: d, tool_name: 'Edit',
    tool_input: { file_path: lib.statePath(d), old_string: '"status": "awaiting-approval"', new_string: '"status": "approved"' }
  });
  assert.equal(r.status, 0);
  assert.ok(deny(r), 'expected a deny decision');
});

test('guard: denies MultiEdit with one offending edit among several', () => {
  const d = tmpProject();
  const r = runGuard({
    cwd: d, tool_name: 'MultiEdit',
    tool_input: {
      file_path: lib.statePath(d),
      edits: [
        { old_string: 'x', new_string: 'y' },
        { old_string: '"status": "in-progress"', new_string: '"status": "approved"' }
      ]
    }
  });
  assert.equal(r.status, 0);
  assert.ok(deny(r), 'expected a deny decision');
});

test('guard: allows Edit on state.json that only sets "in-progress" or "awaiting-approval"', () => {
  const d = tmpProject();
  const r = runGuard({
    cwd: d, tool_name: 'Edit',
    tool_input: { file_path: lib.statePath(d), old_string: '"status": "pending"', new_string: '"status": "in-progress"' }
  });
  assert.equal(r.status, 0);
  assert.equal(deny(r), null);
});

test('guard: allows edits to files other than state.json even if they mention "approved"', () => {
  const d = tmpProject();
  const r = runGuard({
    cwd: d, tool_name: 'Write',
    tool_input: { file_path: path.join(d, 'docs', 'sdlc', '05-development.md'), content: 'status: "approved" in prose is fine here' }
  });
  assert.equal(r.status, 0);
  assert.equal(deny(r), null);
});

test('guard: allows non-Edit/Write/MultiEdit/Bash tools untouched', () => {
  const d = tmpProject();
  const r = runGuard({ cwd: d, tool_name: 'SomeOtherTool', tool_input: { command: 'echo "status": "approved" >> ' + lib.statePath(d) } });
  assert.equal(r.status, 0);
  assert.equal(deny(r), null);
});

test('guard: denies a Bash sed -i command that mentions state.json and approved (write heuristic)', () => {
  const d = tmpProject();
  const r = runGuard({
    cwd: d, tool_name: 'Bash',
    tool_input: { command: "sed -i 's/awaiting-approval/approved/' docs/sdlc/state.json" }
  });
  assert.equal(r.status, 0);
  assert.ok(deny(r), 'expected a deny decision');
});

test('guard: denies a Bash perl -i command that mentions state.json and approved (write heuristic)', () => {
  const d = tmpProject();
  const r = runGuard({
    cwd: d, tool_name: 'Bash',
    tool_input: { command: "perl -i -pe 's/awaiting-approval/approved/' docs/sdlc/state.json" }
  });
  assert.equal(r.status, 0);
  assert.ok(deny(r), 'expected a deny decision');
});

test('guard: denies a Bash dd of= command that mentions state.json and approved (write heuristic)', () => {
  const d = tmpProject();
  const r = runGuard({
    cwd: d, tool_name: 'Bash',
    // Note: the spec's literal example (`dd if=fake.json of=docs/sdlc/state.json`)
    // never mentions "approved", so it can't trip the existing
    // STATE_JSON_RE && APPROVED_WORD_RE && WRITE_LIKE_RE heuristic even with
    // dd\s+of= added — verified against the pre-fix guard, it returns false
    // for that exact string regardless. Using a realistic dd-based
    // tampering command that DOES set an approved status so this test
    // actually exercises the new dd\s+of= regex addition.
    tool_input: { command: "echo '{\"status\":\"approved\"}' | dd of=docs/sdlc/state.json" }
  });
  assert.equal(r.status, 0);
  assert.ok(deny(r), 'expected a deny decision');
});

test('guard: allows a read-only Bash command that references state.json and approved (no false positive)', () => {
  const d = tmpProject();
  const r = runGuard({
    cwd: d, tool_name: 'Bash',
    tool_input: { command: 'grep approved docs/sdlc/state.json' }
  });
  assert.equal(r.status, 0);
  assert.equal(deny(r), null);
});

test('guard: allows a Bash command unrelated to state.json', () => {
  const d = tmpProject();
  const r = runGuard({ cwd: d, tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(r.status, 0);
  assert.equal(deny(r), null);
});

// ---------------------------------------------------------------------------
// Transition check (bug fix): a full-file rewrite that merely re-serializes an
// already-approved PRIOR stage must NOT be denied; only a real
// non-approved -> approved transition may be denied.
// ---------------------------------------------------------------------------

test('guard: ALLOWS full-file Write that keeps an already-approved prior stage and moves an unrelated stage to in-progress', () => {
  const d = tmpProject();
  seedState(d, stateWith({ requirements: { status: 'approved' }, feasibility: { status: 'pending' } }));
  const newState = stateWith({ requirements: { status: 'approved' }, feasibility: { status: 'in-progress' } });
  const r = runGuard({
    cwd: d, tool_name: 'Write',
    tool_input: { file_path: lib.statePath(d), content: JSON.stringify(newState, null, 2) + '\n' }
  });
  assert.equal(r.status, 0);
  assert.equal(deny(r), null, 'unchanged already-approved prior stage must not trigger a deny');
});

test('guard: DENIES full-file Write that flips a stage from awaiting-approval to approved (genuine tamper)', () => {
  const d = tmpProject();
  seedState(d, stateWith({ requirements: { status: 'approved' }, feasibility: { status: 'awaiting-approval' } }));
  const newState = stateWith({ requirements: { status: 'approved' }, feasibility: { status: 'approved' } });
  const r = runGuard({
    cwd: d, tool_name: 'Write',
    tool_input: { file_path: lib.statePath(d), content: JSON.stringify(newState, null, 2) + '\n' }
  });
  assert.equal(r.status, 0);
  assert.ok(deny(r), 'a real new approval must still be denied');
});

test('guard: ALLOWS Edit that moves an unrelated stage to in-progress while a prior stage stays approved', () => {
  const d = tmpProject();
  seedState(d, stateWith({ requirements: { status: 'approved' }, feasibility: { status: 'pending' } }));
  const r = runGuard({
    cwd: d, tool_name: 'Edit',
    tool_input: { file_path: lib.statePath(d), old_string: '"status": "pending"', new_string: '"status": "in-progress"' }
  });
  assert.equal(r.status, 0);
  assert.equal(deny(r), null, 'the already-approved requirements entry left in place must not deny the edit');
});

test('guard: DENIES Edit that flips a stage from awaiting-approval to approved on disk (genuine tamper)', () => {
  const d = tmpProject();
  seedState(d, stateWith({ requirements: { status: 'approved' }, feasibility: { status: 'awaiting-approval' } }));
  const r = runGuard({
    cwd: d, tool_name: 'Edit',
    tool_input: { file_path: lib.statePath(d), old_string: '"status": "awaiting-approval"', new_string: '"status": "approved"' }
  });
  assert.equal(r.status, 0);
  assert.ok(deny(r), 'a real new approval via Edit must still be denied');
});

test('guard: ALLOWS MultiEdit of only non-approval transitions while a prior stage stays approved', () => {
  const d = tmpProject();
  seedState(d, stateWith({ requirements: { status: 'approved' }, feasibility: { status: 'pending' } }));
  const r = runGuard({
    cwd: d, tool_name: 'MultiEdit',
    tool_input: {
      file_path: lib.statePath(d),
      edits: [
        { old_string: '"status": "pending"', new_string: '"status": "in-progress"' },
        { old_string: '"currentStage": "feasibility"', new_string: '"currentStage": "feasibility"' }
      ]
    }
  });
  assert.equal(r.status, 0);
  assert.equal(deny(r), null, 'no stage newly becomes approved, so allow');
});

test('guard: DENIES MultiEdit whose replacements flip a stage to approved on disk (genuine tamper)', () => {
  const d = tmpProject();
  seedState(d, stateWith({ requirements: { status: 'approved' }, feasibility: { status: 'awaiting-approval' } }));
  const r = runGuard({
    cwd: d, tool_name: 'MultiEdit',
    tool_input: {
      file_path: lib.statePath(d),
      edits: [
        { old_string: '"currentStage": "feasibility"', new_string: '"currentStage": "plan"' },
        { old_string: '"status": "awaiting-approval"', new_string: '"status": "approved"' }
      ]
    }
  });
  assert.equal(r.status, 0);
  assert.ok(deny(r), 'a real new approval via MultiEdit must still be denied');
});

test('guard: DENIES Edit with replace_all that flips awaiting-approval stages to approved via a multi-occurrence match (simulation must honor replace_all)', () => {
  const d = tmpProject();
  // The real Edit tool with replace_all: true replaces EVERY occurrence of
  // old_string. If the guard's simulation replaced only the FIRST occurrence
  // it would diverge from what the real tool writes to disk. Here two stages
  // are "awaiting-approval" and an earlier decoy occurrence of the search
  // substring (in currentStage) is what a first-only simulation would consume
  // — leaving both stage statuses unchanged in the simulated result, seeing no
  // new approval, and wrongly ALLOWING the call. A replace_all-aware
  // simulation flips both real statuses to "approved" and correctly denies.
  const onDisk = {
    project: 'demo', currentStage: 'awaiting-approval-marker',
    stages: { requirements: { status: 'awaiting-approval' }, feasibility: { status: 'awaiting-approval' } }
  };
  seedState(d, onDisk);
  const r = runGuard({
    cwd: d, tool_name: 'Edit',
    tool_input: {
      file_path: lib.statePath(d),
      old_string: 'awaiting-approval',
      new_string: 'approved',
      replace_all: true
    }
  });
  assert.equal(r.status, 0);
  assert.ok(deny(r), 'replace_all flipping stage statuses to approved (past a decoy first match) must be denied');
});

test('guard: falls back to conservative check and DENIES a Write whose content is not valid JSON but contains an approved status', () => {
  const d = tmpProject();
  seedState(d, stateWith({ requirements: { status: 'approved' }, feasibility: { status: 'pending' } }));
  const r = runGuard({
    cwd: d, tool_name: 'Write',
    // truncated / non-JSON content — cannot be parsed as the state shape, so
    // the guard must not fail open: the conservative substring check applies.
    tool_input: { file_path: lib.statePath(d), content: 'garbage not json {"status": "approved" ' }
  });
  assert.equal(r.status, 0);
  assert.ok(deny(r), 'unparseable content mentioning an approved status must be denied conservatively');
});

test('guard: falls back to conservative check when an Edit old_string is absent from the on-disk file', () => {
  const d = tmpProject();
  seedState(d, stateWith({ requirements: { status: 'approved' }, feasibility: { status: 'pending' } }));
  const r = runGuard({
    cwd: d, tool_name: 'Edit',
    // old_string does not exist on disk, so the edit can't be simulated —
    // conservative check on new_string denies because it sets approved.
    tool_input: { file_path: lib.statePath(d), old_string: 'THIS TEXT IS NOT PRESENT', new_string: '"status": "approved"' }
  });
  assert.equal(r.status, 0);
  assert.ok(deny(r), 'unsimulatable edit introducing approved must be denied conservatively');
});

test('guard: exit 0 on garbage stdin', () => {
  const r = runGuard('not json at all');
  assert.equal(r.status, 0);
});

test('guard: exit 0 with no stdin fields at all', () => {
  const r = runGuard({});
  assert.equal(r.status, 0);
});
