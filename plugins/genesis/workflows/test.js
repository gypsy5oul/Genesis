export const meta = {
  name: 'sdlc-test',
  description: 'Per-module test writing, execution, and one defect-fix round',
  phases: [{ title: 'Write+Run' }, { title: 'Fix' }, { title: 'Verify' }],
}
// args: { modules: [{name, paths: string[], testCommand: string, discipline?: string}] }
const RESULT = {
  type: 'object', required: ['passed', 'failed', 'defects'],
  properties: {
    passed: { type: 'number' }, failed: { type: 'number' },
    defects: {
      type: 'array',
      items: {
        type: 'object', required: ['severity', 'location', 'problem', 'failingTest'],
        properties: {
          severity: { type: 'string', enum: ['Critical', 'Required', 'Nit', 'FYI'] },
          location: { type: 'string' }, problem: { type: 'string' }, failingTest: { type: 'string' },
        },
      },
    },
  },
}
const MODULES = (args && args.modules) || []
if (!MODULES.length) return { error: 'no modules passed' }
const results = await pipeline(
  MODULES,
  (m) => agent(
    `QA module "${m.name}" (paths: ${m.paths.join(', ')}). Read acceptance criteria in docs/sdlc/01-requirements.md relevant to this module. Write/extend tests (DAMP, pyramid), run with: ${m.testCommand}. Prove-It: every product defect gets a failing test. You may fix TEST code only.`,
    { label: `qa:${m.name}`, phase: 'Write+Run', agentType: 'genesis:qa-engineer', schema: RESULT }),
  async (result, m) => {
    if (!result) return { module: m.name, passed: 0, failed: 0, defects: [], fixedRound: false, testRunFailed: true }
    const blocking = (result.defects || []).filter(d => d.severity === 'Critical' || d.severity === 'Required')
    if (!blocking.length) return { module: m.name, ...result, fixedRound: false }
    const fixPrompt = `Fix product defects in module "${m.name}" (paths: ${m.paths.join(', ')}). Each has a failing test proving it — make them pass without weakening the tests:\n${blocking.map(d => `${d.severity} | ${d.location} | ${d.problem} | test: ${d.failingTest}`).join('\n')}\nRead docs/sdlc/04-design.md first — ADRs binding. Builder report back.`
    let fixResult = await agent(fixPrompt, { label: `fix:${m.name}`, phase: 'Fix', agentType: 'genesis:' + (m.discipline || 'backend-dev') })
    if (!fixResult) {
      fixResult = await agent(fixPrompt, { label: `fix:${m.name}`, phase: 'Fix', agentType: 'genesis:' + (m.discipline || 'backend-dev'), model: 'opus' })
    }
    const verify = await agent(
      `Re-run tests for module "${m.name}" with: ${m.testCommand}. Report pass/fail counts and remaining defects.`,
      { label: `verify:${m.name}`, phase: 'Verify', agentType: 'genesis:qa-engineer', schema: RESULT })
    return { module: m.name, ...(verify || result), fixedRound: Boolean(fixResult) }
  }
)
return { modules: results.filter(Boolean) }
