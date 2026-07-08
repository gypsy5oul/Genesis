export const meta = {
  name: 'sdlc-develop',
  description: 'Parallel task implementation with adversarial per-task review and fix round',
  phases: [{ title: 'Build' }, { title: 'Review' }, { title: 'Fix' }],
}
// args: { tasks: [{id,title,spec,files,discipline,complexity}], specPath, adrPath }
// Tasks MUST have disjoint file sets (architect contract) — agents share one tree, no worktrees in v1.
const FINDINGS = {
  type: 'object', required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', required: ['severity', 'location', 'problem', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['Critical', 'Required', 'Nit', 'FYI'] },
          location: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' },
        },
      },
    },
  },
}
const TASKS = (args && args.tasks) || []
if (!TASKS.length) return { error: 'no tasks passed' }
const modelFor = (t) => t.complexity === 'high' ? 'opus' : t.complexity === 'low' ? 'haiku' : undefined
const results = await pipeline(
  TASKS,
  (t) => agent(
    `Implement task ${t.id}: ${t.title}.\nSPEC (WHAT): read ${args.specPath}. ADRs (HOW, binding): read ${args.adrPath}. ADR wins architecture, SPEC wins scope.\nTask spec: ${t.spec}\nTouch ONLY: ${t.files.join(', ')}. Every changed line traces to this task. Run relevant tests before returning. Builder report: files / tests (command + counts) / notes.`,
    { label: `build:${t.id}`, phase: 'Build', agentType: t.discipline, model: modelFor(t) }),
  (report, t) => agent(
    `Adversarial review of task ${t.id} (${t.title}). Allowed files: ${t.files.join(', ')}. Builder report:\n${report}\nRun the stated tests yourself. Check contract fidelity vs ${args.adrPath}. Findings only.`,
    { label: `review:${t.id}`, phase: 'Review', agentType: 'code-reviewer', schema: FINDINGS }
  ).then(r => ({ report, review: r })),
  async (acc, t) => {
    const blocking = (acc.review?.findings || []).filter(f => f.severity === 'Critical' || f.severity === 'Required')
    if (!blocking.length) return { id: t.id, report: acc.report, findings: acc.review?.findings || [], fixed: true }
    const fixReport = await agent(
      `Fix these review findings on task ${t.id}. Touch only: ${t.files.join(', ')}. Findings:\n${blocking.map(f => `${f.severity} | ${f.location} | ${f.problem} | ${f.fix}`).join('\n')}\nRe-run tests. Builder report back.`,
      { label: `fix:${t.id}`, phase: 'Fix', agentType: t.discipline })
    return { id: t.id, report: fixReport, findings: acc.review?.findings || [], fixed: Boolean(fixReport) }
  }
)
return { tasks: results.filter(Boolean) }
