'use strict';
// Minimal stand-in for the Workflow tool's script runtime, for unit-testing
// the plain decision logic inside workflows/*.js without a real agent fleet.
// Mirrors the documented contract: pipeline() has no barrier between stages,
// parallel() is a barrier, agent() is injected, script body runs async and
// its top-level `return` is the script's result.
const fs = require('fs');

function stripMetaExport(src) {
  return src.replace(/export const meta = \{[\s\S]*?\n\}\n/, '');
}

async function pipeline(items, ...stages) {
  return Promise.all(items.map(async (item, i) => {
    let acc = item;
    for (const stage of stages) {
      acc = await stage(acc, item, i);
    }
    return acc;
  }));
}

async function parallel(thunks) {
  return Promise.all(thunks.map(t => t().catch(() => null)));
}

function loadWorkflowScript(filePath) {
  const body = stripMetaExport(fs.readFileSync(filePath, 'utf8'));
  // eslint-disable-next-line no-new-func
  return new Function('agent', 'pipeline', 'parallel', 'args',
    `return (async () => {\n${body}\n})();`);
}

function runWorkflow(filePath, { agent, args }) {
  const fn = loadWorkflowScript(filePath);
  return fn(agent, pipeline, parallel, args);
}

module.exports = { loadWorkflowScript, runWorkflow, pipeline, parallel };
