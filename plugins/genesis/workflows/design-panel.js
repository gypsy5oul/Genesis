export const meta = {
  name: 'sdlc-design-panel',
  description: 'Three independent architecture proposals from different angles, judged and ranked',
  phases: [{ title: 'Propose' }, { title: 'Judge' }],
}
// args: { designBrief: string, requirementsPath: string }
const ANGLES = [
  'MVP-first: smallest architecture that ships every must-have requirement',
  'scale-first: architecture that survives 100x load without rewrite',
  'operability-first: architecture optimized for cheap deploys, debugging, and small-team maintenance',
]
const PROPOSAL = {
  type: 'object', required: ['summary', 'components', 'stack', 'risks'],
  properties: {
    summary: { type: 'string' }, components: { type: 'array', items: { type: 'string' } },
    stack: { type: 'string' }, risks: { type: 'array', items: { type: 'string' } },
  },
}
const VERDICT_FOR = (n) => ({
  type: 'object', required: ['scores', 'rationale'],
  properties: {
    scores: { type: 'array', items: { type: 'number' }, minItems: n, maxItems: n },
    rationale: { type: 'string' },
  },
})
const proposals = await parallel(ANGLES.map((angle, i) => () =>
  agent(`You are a solution architect. Read ${args.requirementsPath}. Design brief: ${args.designBrief}\nPropose an architecture from this angle: ${angle}. Terse.`,
    { label: `propose:${i}`, phase: 'Propose', schema: PROPOSAL, model: 'opus' })))
const valid = proposals.map((p, i) => ({ ...p, angle: ANGLES[i] })).filter(p => p.summary)
if (valid.length < 2) return { error: 'fewer than 2 proposals survived', proposals: valid }
const judges = await parallel([0, 1].map(j => () =>
  agent(`Judge these ${valid.length} architecture proposals against the requirements in ${args.requirementsPath}. Score each 1-10 (fit, simplicity, risk). Proposals: ${JSON.stringify(valid)}`,
    { label: `judge:${j}`, phase: 'Judge', schema: VERDICT_FOR(valid.length) })))
const totals = valid.map((_, i) =>
  judges.filter(Boolean).reduce((sum, v) => sum + (v.scores[i] || 0), 0))
const winnerIndex = totals.indexOf(Math.max(...totals))
return { proposals: valid.map((p, i) => ({ angle: p.angle, summary: p.summary, score: totals[i] })), winnerIndex }
