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
test('approveStage refuses stage not awaiting', () => {
  const r = lib.approveStage(tmpProject(base()), 'design');
  assert.equal(r.ok, false);
  assert.match(r.msg, /not awaiting-approval/);
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
