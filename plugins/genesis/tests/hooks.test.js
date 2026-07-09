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
  // Pinned to an isolated CLAUDE_CONFIG_DIR whose settings.json already
  // points at genesis's own usage-statusline.sh: the statusline nudge added
  // in Task 3 fires unconditionally (independent of SDLC state) whenever the
  // statusline is unset or set to something else, so without this override
  // the test would depend on whatever statusLine happens to be configured on
  // the machine running it. Assertions are unchanged from before Task 3.
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-cfg-'));
  fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ statusLine: { command: 'bash /some/path/usage-statusline.sh' } }));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'sdlc-session-start.js')], {
    input: JSON.stringify({ cwd: tmpProject(null) }),
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
  });
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
test('session-start: nudges to set up the statusline when unset', () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-cfg-'));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'sdlc-session-start.js')], {
    input: JSON.stringify({ cwd: tmpProject(null) }),
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /offer to set it up/);
});
test('session-start: silent about statusline when already set to genesis\'s own script', () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-cfg-'));
  fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ statusLine: { command: 'bash /some/path/usage-statusline.sh' } }));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'sdlc-session-start.js')], {
    input: JSON.stringify({ cwd: tmpProject(null) }),
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});
test('session-start: warns before replacing a different existing statusline, never overwrites', () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-cfg-'));
  fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ statusLine: { command: 'bash /other/caveman-statusline.sh' } }));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'sdlc-session-start.js')], {
    input: JSON.stringify({ cwd: tmpProject(null) }),
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /different command/);
  assert.match(r.stdout, /caveman-statusline\.sh/);
  const settingsAfter = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
  assert.equal(settingsAfter.statusLine.command, 'bash /other/caveman-statusline.sh');
});
test('session-start: strips control characters from the statusline command before including it in the nudge', () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-cfg-'));
  const evilCommand = 'bash /other/\x1b[31mcaveman\x07-statusline.sh';
  fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({ statusLine: { command: evilCommand } }));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'sdlc-session-start.js')], {
    input: JSON.stringify({ cwd: tmpProject(null) }),
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }
  });
  assert.equal(r.status, 0);
  assert.ok(!/[\x00-\x1f\x7f]/.test(r.stdout), 'control characters must be stripped from stdout');
  assert.match(r.stdout, /caveman-statusline\.sh/);
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
