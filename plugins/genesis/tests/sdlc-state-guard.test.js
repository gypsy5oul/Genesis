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

test('guard: exit 0 on garbage stdin', () => {
  const r = runGuard('not json at all');
  assert.equal(r.status, 0);
});

test('guard: exit 0 with no stdin fields at all', () => {
  const r = runGuard({});
  assert.equal(r.status, 0);
});
