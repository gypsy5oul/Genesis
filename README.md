# Genesis

**Build production-ready software in Claude Code — from idea to deployment, one reviewed stage at a time.**

Genesis is a Claude Code plugin for developing and shipping real applications with engineering discipline. It structures the work into the full software lifecycle — requirements, feasibility, planning, design, development, testing, UAT, deployment, monitoring, maintenance — and puts a quality gate you control between every stage. Every artifact is drafted, adversarially reviewed, and fixed before it reaches you.

```
/genesis:init  →  "a URL shortener for internal links"
/genesis:requirements   → 01-requirements.md   → you review → "approve requirements"
/genesis:feasibility    → 02-feasibility.md    → "approve feasibility"
/genesis:plan           → 03-plan.md           → "approve plan"
/genesis:design         → 04-design.md (ADRs)  → "approve design"
/genesis:develop        → working, reviewed code → "approve develop"
/genesis:test           → test suite + report  → ...through deploy, monitor, maintain
```

## Install

```
/plugin marketplace add https://github.com/gypsy5oul/Genesis
/plugin install genesis@claude-skills
```

Then in any project: `/genesis:init` and follow the stages.

## Why Genesis instead of just prompting?

Prompting an agent "build me X" produces code with no requirements trail, no design decisions on record, no independent review, and no way to pick up where you left off. Genesis fixes each of those:

- **Every stage produces a reviewable artifact** — a requirements doc with testable acceptance criteria, a design doc with binding architecture decisions (ADRs), code with review verdicts, a test report with coverage, a traceability matrix proving every requirement is implemented and tested.
- **Nothing advances without your approval.** Stages end `awaiting-approval`; you review the artifact and say `approve <stage>`. The mutation to `approved` is code, not a prompt convention: only the `approve <stage>` hook path can write it, and a PreToolUse guard hook denies any direct `Edit`/`Write` to `state.json` that tries to set that status another way. "should I approve design?" is never treated as an approval. (Stage entry order — refusing `/genesis:develop` before design is approved — is still a skill-level check per `gate-protocol.md`, backed by `approveStage`'s own prior-stage check as defense in depth.)
- **Work survives sessions.** Project state lives in your repo (`docs/sdlc/state.json`). Close the session, come back tomorrow, or hand the next stage to a teammate — a session-start hook briefs every new session on exactly where the build stands. Survives `/clear` and context compaction.

## How the building actually works

### Specialized builders, tiered by difficulty
Each stage is executed by role agents with strict charters — analyst and architect roles on Opus for the thinking-heavy stages, frontend/backend/devops/QA engineers on Sonnet for building, a Haiku junior for chores, and plain scripts (zero tokens) for everything mechanical. You get the right depth where it matters without paying flagship prices for boilerplate.

### Design decisions that bind the code
The design stage produces numbered ADRs (architecture decision records). Every builder must follow them — conflict rule: **ADR wins architecture, SPEC wins scope**. That's what keeps ten parallel coding tasks converging on one coherent system instead of drifting apart.

### Adversarial review on everything
Every document and every code task goes draft → hostile review (Critical/Required/Nit/FYI — no praise, reviewers re-run the tests themselves) → fix. Unresolved Criticals mean a NO-GO recommendation at your gate. Deployments additionally get a GO/NO-GO verdict with a mandatory rollback plan before anything executes.

### Parallel development, safely
Development fans out across disjoint file sets — architect breaks the design into independent tasks, builders implement them concurrently, each task gets its own review-and-fix round, then the full test suite runs before the stage closes. Bugs found in testing follow the Prove-It rule: a failing test reproduces the bug before anyone fixes it.

## Commands

| Command | Stage | What you get |
|---|---|---|
| `/genesis:init` | kickoff | project state + captured idea |
| `/genesis:requirements` | 1 | user stories, acceptance criteria, priorities |
| `/genesis:feasibility` | 2 | tech/cost/risk analysis, go/no-go |
| `/genesis:plan` | 3 | milestones, backlog with verification steps |
| `/genesis:design` | 4 | architecture, API contracts, ADRs (`--panel` = 3 competing designs, judged) |
| `/genesis:develop` | 5 | working code, per-task review |
| `/genesis:test` | 6 | test suite, coverage, defect log |
| `/genesis:uat` | 7 | requirement → code → test traceability matrix |
| `/genesis:deploy` | 8 | CI/CD configs, GO/NO-GO, guided execution |
| `/genesis:monitor` | 9 | monitoring config, runbooks, read-only health watch |
| `/genesis:maintain` | 10 | triaged fixes and enhancements, change log |
| `/genesis:status` | any | stage board — rendered by a hook, costs zero tokens |

## Cost and token efficiency

- Thinking stages (1–4) are cheap: a few model calls each. Development and testing scale with your app: one builder + one reviewer per task, run in parallel.
- Status, approvals, state updates, and session briefings are pure Node hooks — **zero model tokens**, and the status can't be hallucinated.
- Agents talk to each other in compressed, contract-fixed formats (~60% smaller); everything written for *you* is normal prose.
- Later stages read an index of earlier artifacts and pull full documents only when needed.

## Safety rails

- Deploy commands run only in the main session under your permission prompts — never inside background agents.
- Monitoring loops are read-only; anomalies become triage notes, never automatic production changes.
- Security findings and destructive-operation instructions are always written in full plain English.
- State file reads are size-capped, symlink-safe, and sanitized before entering model context.

## Development

```
npm test                                            # 56 unit tests (hooks + state + workflow decision logic)
npm run validate                                    # structural validation
npm run smoke                                       # deterministic-layer smoke test
```

Plugin layout: `plugins/genesis/` — `agents/` (11 roles) · `skills/` (12 stages + `_shared` protocols) · `hooks/` (zero-token state machine) · `workflows/` (parallel develop/test/design-panel) · `evals/` + `tests/`.

## License

MIT
