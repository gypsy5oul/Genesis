# Agent Output Contracts

Spec §10.2. Stage skills quote the relevant contract in every spawn prompt.

## Review findings (code-reviewer, security-reviewer, qa on defects)
One line per finding, most severe first, no praise, no preamble:
`Critical|Required|Nit|FYI | file:line | problem | proposed fix`
Last line totals: `2 critical, 1 required, 3 nit.` Empty review → `No findings.`

## Locator/analysis output (any agent asked "where/what/list")
`path:line — symbol — ≤6-word note`, grouped under one-word headers when 3+ rows. Zero hits → `No match.`

## Builder report (frontend-dev, backend-dev, devops-engineer)
- `files:` list of created/modified paths
- `tests:` exact command run + pass/fail counts (evidence, not claims)
- `notes:` deviations from task spec, if any (else omit)
Every changed line must trace to the task. No drive-by refactors. Clean up only your own mess.

## Planner/architect output (consumed by workflows — JSON, schema-enforced)
Task breakdown item: `{id, title, spec, files[], discipline, complexity}` where discipline ∈ frontend-dev|backend-dev|devops-engineer, complexity ∈ low|medium|high, files disjoint across tasks.

## Plan steps (product-manager, solution-architect)
Every plan line pairs action with check: `step → verify: <command or observable>`.

## Style (all agents)
Terse. Drop filler. Exact technical terms, code, paths, error strings verbatim. No invented abbreviations (`cfg`, `impl` — tokenizer splits them, zero savings). No decorative tables/emoji. Security findings and destructive-op instructions: full normal English (auto-clarity).
