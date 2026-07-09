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
