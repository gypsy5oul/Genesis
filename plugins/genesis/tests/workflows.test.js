'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { runWorkflow } = require('./workflow-harness');

const DEVELOP = path.join(__dirname, '..', 'workflows', 'develop.js');
const TEST_WF = path.join(__dirname, '..', 'workflows', 'test.js');
const DESIGN_PANEL = path.join(__dirname, '..', 'workflows', 'design-panel.js');

test('develop: a failed review (agent returns null) is NOT silently treated as a pass', async () => {
  const args = {
    tasks: [{ id: 't1', title: 'thing', spec: 'x', files: ['a.js'], discipline: 'backend-dev', complexity: 'low' }],
    specPath: 'docs/sdlc/01-requirements.md', adrPath: 'docs/sdlc/04-design.md'
  };
  async function agent(prompt, opts) {
    if (opts.phase === 'Build') return 'built a.js, tests: 3 passed';
    if (opts.phase === 'Review') return null; // review agent died
    throw new Error('unexpected phase ' + opts.phase);
  }
  const result = await runWorkflow(DEVELOP, { agent, args });
  const task = result.tasks[0];
  assert.notEqual(task.fixed, true, 'a task with no real review must not be marked fixed:true');
  assert.equal(task.reviewFailed, true);
});

test('develop: a review that legitimately found nothing still marks fixed:true', async () => {
  const args = {
    tasks: [{ id: 't1', title: 'thing', spec: 'x', files: ['a.js'], discipline: 'backend-dev', complexity: 'low' }],
    specPath: 'docs/sdlc/01-requirements.md', adrPath: 'docs/sdlc/04-design.md'
  };
  async function agent(prompt, opts) {
    if (opts.phase === 'Build') return 'built a.js';
    if (opts.phase === 'Review') return { findings: [] };
    throw new Error('unexpected phase ' + opts.phase);
  }
  const result = await runWorkflow(DEVELOP, { agent, args });
  assert.equal(result.tasks[0].fixed, true);
  assert.equal(result.tasks[0].reviewFailed, undefined);
});

test('develop: a fix round re-verifies with a fresh review and marks fixed:true only when the re-review finds no more blocking findings', async () => {
  const args = {
    tasks: [{ id: 't1', title: 'thing', spec: 'x', files: ['a.js'], discipline: 'backend-dev', complexity: 'low' }],
    specPath: 'docs/sdlc/01-requirements.md', adrPath: 'docs/sdlc/04-design.md'
  };
  let verifyCalled = false;
  async function agent(prompt, opts) {
    if (opts.phase === 'Build') return 'built a.js';
    if (opts.phase === 'Review') return { findings: [{ severity: 'Critical', location: 'a.js:1', problem: 'bug', fix: 'do x' }] };
    if (opts.phase === 'Fix') return 'fixer report: patched a.js';
    if (opts.phase === 'Verify') { verifyCalled = true; return { findings: [] }; }
    throw new Error('unexpected phase ' + opts.phase);
  }
  const result = await runWorkflow(DEVELOP, { agent, args });
  const task = result.tasks[0];
  assert.equal(verifyCalled, true, 'the fix round must dispatch a re-review, not trust the fixer\'s self-report');
  assert.equal(task.fixed, true);
  assert.equal(task.report, 'fixer report: patched a.js');
  assert.deepEqual(task.findings, []);
});

test('develop: a fix round marks fixed:false when the re-review still finds blocking findings', async () => {
  const args = {
    tasks: [{ id: 't1', title: 'thing', spec: 'x', files: ['a.js'], discipline: 'backend-dev', complexity: 'low' }],
    specPath: 'docs/sdlc/01-requirements.md', adrPath: 'docs/sdlc/04-design.md'
  };
  async function agent(prompt, opts) {
    if (opts.phase === 'Build') return 'built a.js';
    if (opts.phase === 'Review') return { findings: [{ severity: 'Required', location: 'a.js:1', problem: 'bug', fix: 'do x' }] };
    if (opts.phase === 'Fix') return 'fixer report: tried to patch a.js';
    if (opts.phase === 'Verify') return { findings: [{ severity: 'Required', location: 'a.js:1', problem: 'still broken', fix: 'do x again' }] };
    throw new Error('unexpected phase ' + opts.phase);
  }
  const result = await runWorkflow(DEVELOP, { agent, args });
  const task = result.tasks[0];
  assert.equal(task.fixed, false, 'a fix must not be marked fixed:true just because the fixer returned a report');
  assert.equal(task.findings.length, 1);
});

test('develop: if the fix agent fails entirely (both attempts null), fixed:false and no re-review is dispatched', async () => {
  const args = {
    tasks: [{ id: 't1', title: 'thing', spec: 'x', files: ['a.js'], discipline: 'backend-dev', complexity: 'low' }],
    specPath: 'docs/sdlc/01-requirements.md', adrPath: 'docs/sdlc/04-design.md'
  };
  async function agent(prompt, opts) {
    if (opts.phase === 'Build') return 'built a.js';
    if (opts.phase === 'Review') return { findings: [{ severity: 'Critical', location: 'a.js:1', problem: 'bug', fix: 'do x' }] };
    if (opts.phase === 'Fix') return null; // both the normal and opus-retry attempts die
    if (opts.phase === 'Verify') throw new Error('must not re-review when no fix was ever obtained');
    throw new Error('unexpected phase ' + opts.phase);
  }
  const result = await runWorkflow(DEVELOP, { agent, args });
  const task = result.tasks[0];
  assert.equal(task.fixed, false);
  assert.equal(task.report, 'built a.js');
});

test('develop: meta.phases includes a Verify phase', () => {
  const src = require('fs').readFileSync(DEVELOP, 'utf8');
  const metaMatch = /export const meta = (\{[\s\S]*?\n\})\n/.exec(src);
  assert.ok(metaMatch, 'develop.js must start with export const meta = {...}');
  // eslint-disable-next-line no-eval
  const meta = eval('(' + metaMatch[1] + ')');
  assert.ok(meta.phases.some(p => p.title === 'Verify'), 'meta.phases must list the new Verify phase');
});

test('develop: every agent dispatch uses plugin-namespaced agentTypes (genesis:<role>), not bare role names', async () => {
  const args = {
    tasks: [{ id: 't1', title: 'thing', spec: 'x', files: ['a.js'], discipline: 'backend-dev', complexity: 'low' }],
    specPath: 'docs/sdlc/01-requirements.md', adrPath: 'docs/sdlc/04-design.md'
  };
  const seen = {};
  async function agent(prompt, opts) {
    seen[opts.phase] = opts.agentType;
    if (opts.phase === 'Build') return 'built a.js';
    if (opts.phase === 'Review') return { findings: [{ severity: 'Critical', location: 'a.js:1', problem: 'bug', fix: 'do x' }] };
    if (opts.phase === 'Fix') return 'fixer report: patched a.js';
    if (opts.phase === 'Verify') return { findings: [] };
    throw new Error('unexpected phase ' + opts.phase);
  }
  await runWorkflow(DEVELOP, { agent, args });
  // discipline-derived builder/fixer must be namespaced from the bare 'backend-dev' contract value
  assert.equal(seen.Build, 'genesis:backend-dev', 'builder agentType must be namespaced');
  assert.equal(seen.Fix, 'genesis:backend-dev', 'fixer agentType must be namespaced');
  // literal reviewer roles must be namespaced too
  assert.equal(seen.Review, 'genesis:code-reviewer', 'reviewer agentType must be namespaced');
  assert.equal(seen.Verify, 'genesis:code-reviewer', 're-reviewer agentType must be namespaced');
});

test('test workflow: every agent dispatch uses plugin-namespaced agentTypes (genesis:<role>), not bare role names', async () => {
  const args = { modules: [{ name: 'auth', paths: ['src/auth.js'], testCommand: 'npm test' }] };
  const seen = {};
  async function agent(prompt, opts) {
    seen[opts.phase] = opts.agentType;
    if (opts.phase === 'Write+Run') {
      return { passed: 1, failed: 1, defects: [{ severity: 'Critical', location: 'src/auth.js:1', problem: 'bug', failingTest: 'auth.test.js' }] };
    }
    if (opts.phase === 'Fix') return 'fixer report: patched src/auth.js';
    if (opts.phase === 'Verify') return { passed: 2, failed: 0, defects: [] };
    throw new Error('unexpected phase ' + opts.phase);
  }
  await runWorkflow(TEST_WF, { agent, args });
  assert.equal(seen['Write+Run'], 'genesis:qa-engineer', 'QA agentType must be namespaced');
  // no module.discipline supplied → default 'backend-dev' must still be namespaced
  assert.equal(seen.Fix, 'genesis:backend-dev', 'fixer default agentType must be namespaced');
  assert.equal(seen.Verify, 'genesis:qa-engineer', 'verify QA agentType must be namespaced');
});

test('test workflow: a failed QA run (agent returns null) is NOT silently treated as passing', async () => {
  const args = { modules: [{ name: 'auth', paths: ['src/auth.js'], testCommand: 'npm test' }] };
  async function agent(prompt, opts) {
    if (opts.phase === 'Write+Run') return null; // QA agent died
    throw new Error('unexpected phase ' + opts.phase);
  }
  const result = await runWorkflow(TEST_WF, { agent, args });
  const mod = result.modules[0];
  assert.equal(mod.testRunFailed, true);
  assert.equal(mod.defects.length, 0, 'no real defect data exists to report');
});

test('test workflow: fixedRound reflects whether a fix was actually obtained, not just that a fix round was entered', async () => {
  const args = { modules: [{ name: 'auth', paths: ['src/auth.js'], testCommand: 'npm test' }] };
  async function agent(prompt, opts) {
    if (opts.phase === 'Write+Run') {
      return { passed: 1, failed: 1, defects: [{ severity: 'Critical', location: 'src/auth.js:1', problem: 'bug', failingTest: 'auth.test.js' }] };
    }
    if (opts.phase === 'Fix') return null; // both the normal and opus-retry attempts die
    if (opts.phase === 'Verify') return { passed: 2, failed: 0, defects: [] };
    throw new Error('unexpected phase ' + opts.phase);
  }
  const result = await runWorkflow(TEST_WF, { agent, args });
  const mod = result.modules[0];
  assert.equal(mod.fixedRound, false, 'no fix report was ever obtained — fixedRound must not be true');
});

test('test workflow: fixedRound is true when a fix report was actually obtained', async () => {
  const args = { modules: [{ name: 'auth', paths: ['src/auth.js'], testCommand: 'npm test' }] };
  async function agent(prompt, opts) {
    if (opts.phase === 'Write+Run') {
      return { passed: 1, failed: 1, defects: [{ severity: 'Critical', location: 'src/auth.js:1', problem: 'bug', failingTest: 'auth.test.js' }] };
    }
    if (opts.phase === 'Fix') return 'fixer report: patched src/auth.js';
    if (opts.phase === 'Verify') return { passed: 2, failed: 0, defects: [] };
    throw new Error('unexpected phase ' + opts.phase);
  }
  const result = await runWorkflow(TEST_WF, { agent, args });
  const mod = result.modules[0];
  assert.equal(mod.fixedRound, true);
});

test('design-panel: if every judge fails, returns an error instead of a fabricated winner', async () => {
  const args = { designBrief: 'a url shortener', requirementsPath: 'docs/sdlc/01-requirements.md' };
  async function agent(prompt, opts) {
    if (opts.phase === 'Propose') return { summary: 's', components: ['c'], stack: 'node', risks: [] };
    if (opts.phase === 'Judge') return null; // all judges die
    throw new Error('unexpected phase ' + opts.phase);
  }
  const result = await runWorkflow(DESIGN_PANEL, { agent, args });
  assert.ok(result.error, 'expected an error field when no judge produced a verdict');
  assert.equal(result.winnerIndex, undefined);
});
