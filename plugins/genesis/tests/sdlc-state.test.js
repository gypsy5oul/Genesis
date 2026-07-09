'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const lib = require('../hooks/sdlc-state');

function tmpProject(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-'));
  if (state) {
    fs.mkdirSync(path.join(dir, 'docs', 'sdlc'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'sdlc', 'state.json'), JSON.stringify(state));
  }
  return dir;
}
const base = () => ({
  project: 'demo', idea: 'url shortener', currentStage: 'requirements',
  stages: { requirements: { status: 'awaiting-approval', artifact: 'docs/sdlc/01-requirements.md' } },
  decisions: []
});

test('STAGES has the 10 ordered stages', () => {
  assert.deepEqual(lib.STAGES, ['requirements','feasibility','plan','design','develop','test','uat','deploy','monitor','maintain']);
});
test('readState returns null when missing', () => {
  assert.equal(lib.readState(tmpProject(null)), null);
});
test('readState parses valid state', () => {
  assert.equal(lib.readState(tmpProject(base())).project, 'demo');
});
test('readState rejects oversized file', () => {
  const d = tmpProject(null);
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  fs.writeFileSync(path.join(d, 'docs', 'sdlc', 'state.json'), JSON.stringify(base()).padEnd(300000, ' '));
  assert.equal(lib.readState(d), null);
});
test('readState rejects symlinked state file', () => {
  const d = tmpProject(null);
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  const real = path.join(d, 'real.json');
  fs.writeFileSync(real, JSON.stringify(base()));
  fs.symlinkSync(real, path.join(d, 'docs', 'sdlc', 'state.json'));
  assert.equal(lib.readState(d), null);
});
test('writeState then readState round-trips', () => {
  const d = tmpProject(null);
  lib.writeState(d, base());
  assert.equal(lib.readState(d).idea, 'url shortener');
});
test('writeState refuses to write through a symlinked docs directory', () => {
  const d = tmpProject(null);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-outside-'));
  fs.symlinkSync(outside, path.join(d, 'docs'));
  assert.throws(() => lib.writeState(d, base()));
  assert.equal(fs.existsSync(path.join(outside, 'sdlc', 'state.json')), false);
});
test('writeState refuses to overwrite a symlinked state.json file', () => {
  const d = tmpProject(null);
  fs.mkdirSync(path.join(d, 'docs', 'sdlc'), { recursive: true });
  const real = path.join(d, 'real.json');
  fs.writeFileSync(real, JSON.stringify(base()));
  fs.symlinkSync(real, lib.statePath(d));
  assert.throws(() => lib.writeState(d, base()));
  assert.equal(JSON.parse(fs.readFileSync(real, 'utf8')).idea, 'url shortener');
});
test('writeState uses a unique temp filename per call (no fixed-name collision)', () => {
  const d = tmpProject(null);
  const seen = new Set();
  const origWrite = fs.writeFileSync;
  fs.writeFileSync = (p, ...rest) => {
    if (String(p).includes('.tmp')) seen.add(p);
    return origWrite(p, ...rest);
  };
  try {
    lib.writeState(d, base());
    lib.writeState(d, base());
  } finally {
    fs.writeFileSync = origWrite;
  }
  assert.equal(seen.size, 2, `expected 2 distinct temp filenames, got: ${[...seen]}`);
});
test('approveStage returns a clear error (not a throw, not silence) if the lock cannot be acquired', () => {
  const d = tmpProject(base());
  const lockPath = lib.statePath(d) + '.lock';
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, String(Date.now()));
  const r = lib.approveStage(d, 'requirements');
  assert.equal(r.ok, false);
  assert.match(r.msg, /lock/i);
  assert.equal(lib.readState(d).stages.requirements.status, 'awaiting-approval');
});
test('approveStage treats a stale lock file as abandoned and proceeds', () => {
  const d = tmpProject(base());
  const lockPath = lib.statePath(d) + '.lock';
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, String(Date.now()));
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lockPath, old, old);
  const r = lib.approveStage(d, 'requirements');
  assert.ok(r.ok, r.msg);
});
test('approveStage under real concurrent processes racing the SAME stage: exactly one wins, no corruption', async () => {
  const d = tmpProject(base());
  const { spawn } = require('child_process');
  const hookPath = path.join(__dirname, '..', 'hooks', 'sdlc-state.js');
  function approveInChildProcess() {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        '-e',
        `process.stdout.write(JSON.stringify(require(process.argv[1]).approveStage(process.argv[2], process.argv[3])))`,
        hookPath, d, 'requirements'
      ]);
      let stdout = '', stderr = '';
      child.stdout.on('data', c => { stdout += c; });
      child.stderr.on('data', c => { stderr += c; });
      child.on('exit', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error('child exited ' + code + ': ' + stderr)));
      child.on('error', reject);
    });
  }
  const results = await Promise.all([approveInChildProcess(), approveInChildProcess()]);
  const oks = results.filter(r => r.ok);
  assert.equal(oks.length, 1, `expected exactly one approval to win, got: ${JSON.stringify(results)}`);
  const s = lib.readState(d);
  assert.equal(s.stages.requirements.status, 'approved');
  assert.equal(s.decisions.length, 1, `lock must prevent both processes from appending a decision: ${JSON.stringify(s.decisions)}`);
});
test('writeState does not create a .bak file on first write', () => {
  const d = tmpProject(null);
  lib.writeState(d, base());
  assert.equal(fs.existsSync(lib.statePath(d) + '.bak'), false);
});
test('writeState creates a .bak of the prior state when overwriting', () => {
  const d = tmpProject(null);
  const first = base();
  lib.writeState(d, first);
  const second = base();
  second.idea = 'pastebin';
  lib.writeState(d, second);
  const bakPath = lib.statePath(d) + '.bak';
  assert.equal(fs.existsSync(bakPath), true);
  const bak = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
  assert.equal(bak.idea, 'url shortener');
  assert.equal(lib.readState(d).idea, 'pastebin');
});
test('readState returns null when a stage has status "bogus"', () => {
  const st = base();
  st.stages.requirements.status = 'bogus';
  assert.equal(lib.readState(tmpProject(st)), null);
});
test('pendingGate finds awaiting stage', () => {
  assert.equal(lib.pendingGate(base()), 'requirements');
});
test('pendingGate null when nothing awaiting', () => {
  const s = base(); s.stages.requirements.status = 'approved';
  assert.equal(lib.pendingGate(s), null);
});
test('priorStage and nextStage walk the order', () => {
  assert.equal(lib.priorStage('requirements'), null);
  assert.equal(lib.priorStage('design'), 'plan');
  assert.equal(lib.nextStage('maintain'), null);
  assert.equal(lib.nextStage('develop'), 'test');
});
test('approveStage flips awaiting-approval to approved', () => {
  const d = tmpProject(base());
  const r = lib.approveStage(d, 'requirements');
  assert.ok(r.ok);
  const s = lib.readState(d);
  assert.equal(s.stages.requirements.status, 'approved');
  assert.ok(s.stages.requirements.approvedAt);
  assert.equal(s.decisions.length, 1);
});
test('approveStage advances currentStage to the next stage', () => {
  const d = tmpProject(base());
  lib.approveStage(d, 'requirements');
  const s = lib.readState(d);
  assert.equal(s.currentStage, lib.nextStage('requirements'));
});
test('approveStage on last stage keeps currentStage at that stage', () => {
  const st = base();
  st.currentStage = 'maintain';
  st.stages.maintain = { status: 'awaiting-approval', artifact: 'docs/sdlc/10-maintenance.md' };
  const d = tmpProject(st);
  lib.approveStage(d, 'maintain');
  const s = lib.readState(d);
  assert.equal(s.currentStage, 'maintain');
});
test('approveStage refuses a stage whose prior stage is not approved (defense in depth)', () => {
  const st = base();
  st.stages.requirements.status = 'approved';
  st.stages.feasibility = { status: 'awaiting-approval', artifact: 'docs/sdlc/02-feasibility.md' };
  st.stages.plan = { status: 'awaiting-approval', artifact: 'docs/sdlc/03-plan.md' };
  const d = tmpProject(st);
  const r = lib.approveStage(d, 'plan');
  assert.equal(r.ok, false);
  assert.match(r.msg, /feasibility/);
  assert.equal(lib.readState(d).stages.plan.status, 'awaiting-approval');
});
test('approveStage refuses stage not awaiting', () => {
  const r = lib.approveStage(tmpProject(base()), 'design');
  assert.equal(r.ok, false);
  assert.match(r.msg, /not awaiting-approval/);
});
test('approveStage reports a clear error instead of silently swallowing a write failure', () => {
  const d = tmpProject(base());
  const origWrite = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('ENOSPC: no space left on device'); };
  let r;
  try {
    r = lib.approveStage(d, 'requirements');
  } finally {
    fs.writeFileSync = origWrite;
  }
  assert.equal(r.ok, false);
  assert.match(r.msg, /ENOSPC|failed to save|write/i);
  assert.equal(lib.readState(d).stages.requirements.status, 'awaiting-approval');
});
test('approveStage handles missing state', () => {
  const r = lib.approveStage(tmpProject(null), 'requirements');
  assert.equal(r.ok, false);
});
test('summaryLine mentions project and pending gate', () => {
  const line = lib.summaryLine(base());
  assert.match(line, /demo/);
  assert.match(line, /approve requirements/);
});
test('renderStatus lists all stages', () => {
  const out = lib.renderStatus(base());
  for (const s of lib.STAGES) assert.match(out, new RegExp('\\b' + s + '\\b'));
});
test('clean strips control chars and truncates', () => {
  assert.equal(lib.clean('a\x1b[2Jb'), 'a[2Jb');
  assert.equal(lib.clean('x'.repeat(500), 10).length, 10);
  assert.equal(lib.clean(null), '');
});
test('clean strips unicode bidi override and zero-width chars', () => {
  assert.equal(lib.clean('a‮b​c﻿d'), 'abcd');
  assert.equal(lib.clean('safe⁦text⁩here'), 'safetexthere');
});
test('renderStatus sanitizes an oversized, escape-laden idea field (clamped length)', () => {
  const st = base();
  st.idea = 'x'.repeat(10000) + '\x1b[2J';
  const out = lib.renderStatus(st);
  assert.ok(out.length <= 1000, `expected <=1000 chars, got ${out.length}`);
  assert.ok(!/[\x1b\x7f\x00-\x08\x0b\x0c\x0e-\x1f]/.test(out), 'renderStatus must contain no escape/control chars (idea field)');
});
test('renderStatus sanitizes an oversized, escape-laden idea field', () => {
  const st = base();
  st.idea = 'y'.repeat(10000) + '\x1b[2J';
  const out = lib.renderStatus(st);
  // renderStatus is intentionally multi-line, so \n is expected; other control/escape bytes are not.
  assert.ok(!/[\x1b\x7f\x00-\x08\x0b\x0c\x0e-\x1f]/.test(out), 'renderStatus must contain no escape/control chars (newlines excepted)');
});
