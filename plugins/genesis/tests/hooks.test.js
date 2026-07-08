'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const lib = require('../hooks/sdlc-state');

function tmpProject(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-'));
  if (state) lib.writeState(dir, state);
  return dir;
}
const base = () => ({
  project: 'demo', idea: 'url shortener', currentStage: 'requirements',
  stages: { requirements: { status: 'awaiting-approval', artifact: 'docs/sdlc/01-requirements.md' } },
  decisions: []
});
function runHook(script, payload) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', script)], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', timeout: 5000
  });
}

test('session-start: silent + exit 0 without state', () => {
  const r = runHook('sdlc-session-start.js', { cwd: tmpProject(null) });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
test('session-start: injects summary with state', () => {
  const r = runHook('sdlc-session-start.js', { cwd: tmpProject(base()) });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /demo/);
  assert.match(r.stdout, /approve requirements/);
});
test('session-start: exit 0 on garbage stdin', () => {
  const r = runHook('sdlc-session-start.js', 'not json at all');
  assert.equal(r.status, 0);
});
test('prompt: blocks /genesis:status with rendered board', () => {
  const out = JSON.parse(runHook('sdlc-prompt-hook.js', { cwd: tmpProject(base()), prompt: '/genesis:status' }).stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /requirements/);
  assert.match(out.reason, /awaiting-approval/);
});
test('prompt: /genesis:status without state says run init', () => {
  const out = JSON.parse(runHook('sdlc-prompt-hook.js', { cwd: tmpProject(null), prompt: '/genesis:status' }).stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /init/);
});
test('prompt: approve flips state and blocks', () => {
  const d = tmpProject(base());
  const out = JSON.parse(runHook('sdlc-prompt-hook.js', { cwd: d, prompt: 'approve requirements' }).stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /approved/);
  assert.equal(lib.readState(d).stages.requirements.status, 'approved');
});
test('prompt: question is NOT approval', () => {
  const d = tmpProject(base());
  const r = runHook('sdlc-prompt-hook.js', { cwd: d, prompt: 'should I approve requirements?' });
  assert.equal(lib.readState(d).stages.requirements.status, 'awaiting-approval');
  if (r.stdout.trim()) assert.equal(JSON.parse(r.stdout).decision, undefined);
});
test('prompt: "approve requirements later" is not an approval (no end anchor bypass)', () => {
  const d = tmpProject(base());
  const r = runHook('sdlc-prompt-hook.js', { cwd: d, prompt: 'approve requirements later' });
  assert.equal(lib.readState(d).stages.requirements.status, 'awaiting-approval');
  if (r.stdout.trim()) {
    const out = JSON.parse(r.stdout);
    assert.notEqual(out.decision, 'block');
  }
});
test('prompt: approve of non-awaiting stage blocks with explanation, no mutation', () => {
  const d = tmpProject(base());
  const out = JSON.parse(runHook('sdlc-prompt-hook.js', { cwd: d, prompt: 'approve design' }).stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /not awaiting-approval/);
});
test('prompt: ordinary prompt gets gate reminder', () => {
  const out = JSON.parse(runHook('sdlc-prompt-hook.js', { cwd: tmpProject(base()), prompt: 'hello, what next?' }).stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /awaiting approval/);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
});
test('prompt: no state, ordinary prompt → empty stdout, exit 0', () => {
  const r = runHook('sdlc-prompt-hook.js', { cwd: tmpProject(null), prompt: 'hello' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
test('prompt: exit 0 on garbage stdin', () => {
  const r = runHook('sdlc-prompt-hook.js', '{{{');
  assert.equal(r.status, 0);
});
test('prompt: gate reminder sanitizes an oversized, escape-laden artifact field', () => {
  const st = base();
  st.stages.requirements.artifact = 'a'.repeat(5000) + '\x1b[2J\x07';
  const out = JSON.parse(runHook('sdlc-prompt-hook.js', { cwd: tmpProject(st), prompt: 'hello' }).stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(ctx.length < 500, `expected <500 chars, got ${ctx.length}`);
  assert.ok(!ctx.includes('\x1b'), 'additionalContext must contain no escape char');
});
