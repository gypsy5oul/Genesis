# Genesis

**Build production-ready software in Claude Code — from idea to deployment, one reviewed stage at a time.**

Genesis is a Claude Code plugin for developing and shipping real applications with engineering discipline. It structures the work into the full software lifecycle — requirements, feasibility, planning, design, development, testing, UAT, deployment, monitoring, maintenance — and puts a quality gate you control between every stage. Every artifact is drafted, adversarially reviewed, and fixed before it reaches you. It also keeps a live, queryable map of your codebase and a live read on what the session is costing you — both updated automatically, at zero model-token cost.

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

Prompting an agent "build me X" produces code with no requirements trail, no design decisions on record, no independent review, no map of what already exists, and no way to pick up where you left off. Genesis fixes each of those:

- **Every stage produces a reviewable artifact** — a requirements doc with testable acceptance criteria, a design doc with binding architecture decisions (ADRs), code with review verdicts, a test report with coverage, a traceability matrix proving every requirement is implemented and tested.
- **Nothing advances without your approval.** Stages end `awaiting-approval`; you review the artifact and say `approve <stage>`. The mutation to `approved` is code, not a prompt convention: only the `approve <stage>` hook path can write it. A PreToolUse guard hook denies any direct `Edit`/`Write`/`MultiEdit` to `state.json` that tries to set that status another way, and heuristically denies common `Bash`-based tampering patterns too (`sed -i`, `perl -i`, `dd of=`, redirects, `cp`/`mv` onto `state.json`). This isn't an absolute guarantee — Bash is Turing-complete, and a sufficiently determined bypass (piping through an interpreter, etc.) isn't caught, consistent with any local-file permission model — but it blocks the direct and common cases. "should I approve design?" is never treated as an approval. (Stage entry order — refusing `/genesis:develop` before design is approved — is still a skill-level check per `gate-protocol.md`, backed by `approveStage`'s own prior-stage check as defense in depth.)
- **Work survives sessions.** Project state lives in your repo (`docs/sdlc/state.json`). Close the session, come back tomorrow, or hand the next stage to a teammate — a session-start hook briefs every new session on exactly where the build stands. Survives `/clear` and context compaction.
- **The codebase is mapped, not re-discovered every time.** A structural code graph (below) means "where is this defined" and "what breaks if I change this file" are answered from an index, not a fresh grep-and-read cycle every single time the question comes up.

## How the building actually works

### Specialized builders, tiered by difficulty
Each stage is executed by role agents with strict charters — analyst and architect roles on Opus for the thinking-heavy stages, frontend/backend/devops/QA engineers on Sonnet for building, a Haiku junior for chores, and plain scripts (zero tokens) for everything mechanical. You get the right depth where it matters without paying flagship prices for boilerplate.

### Design decisions that bind the code
The design stage produces numbered ADRs (architecture decision records). Every builder must follow them — conflict rule: **ADR wins architecture, SPEC wins scope**. That's what keeps ten parallel coding tasks converging on one coherent system instead of drifting apart.

### Adversarial review on everything
Every document and every code task goes draft → hostile review (Critical/Required/Nit/FYI — no praise, reviewers re-run the tests themselves) → fix → **re-review** (a fresh check that the fix actually resolved the finding, not just a fixer's own say-so that it did). Unresolved Criticals mean a NO-GO recommendation at your gate. Deployments additionally get a GO/NO-GO verdict with a mandatory rollback plan before anything executes.

### Parallel development, safely
Development fans out across disjoint file sets — architect breaks the design into independent tasks, builders implement them concurrently, each task gets its own review-and-fix round, then the full test suite runs before the stage closes. Bugs found in testing follow the Prove-It rule: a failing test reproduces the bug before anyone fixes it.

## Codegraph — a live structural map of your code

Every Genesis project gets its own structural code graph (`docs/sdlc/graph.json`): functions, classes, imports, and same-file calls, extracted with tree-sitter from your actual JS/TS/TSX source — not guessed from memory.

- **Built once, kept current automatically.** The baseline is scanned at `/genesis:init`. From then on, a `PostToolUse` hook re-parses just the one file you touched after every Edit/Write — no full-repo rescan, cost scales with the edit, not the codebase. Files a sub-agent writes during `/genesis:develop`/`/genesis:maintain` (which bypass your own tool calls) are reconciled explicitly at the end of those stages, so nothing falls out of date.
- **Queried at zero model tokens.** `where is X defined`, `what calls Y`, `what does this file import`, `what would break if I changed this file` are answered by a plain CLI script reading the graph — no LLM call to search the tree. A drift check re-parses a file on the spot if its content ever moves out of sync with what's recorded, so a query is never wrong because the index went stale.
- **Ask in plain English.** A `codegraph` skill triggers automatically on questions shaped like the above — you don't need to remember a command.
- **Scope, honestly stated:** JS/TS/TSX only in v1 (no Python/Go yet); only relative imports resolve to a file (bare package imports like `react` don't); only same-file, plain-function calls resolve (`obj.method()`/`this.method()` calls are out of scope, by design, rather than guessed at and sometimes wrong). Where the graph can't determine an answer, it says so — it never fabricates a location or a caller.

## Live cost & usage tracking

Opt-in statusline (`~/.claude/settings.json`) showing session + rolling-7-day token usage and an estimated USD cost, recomputed automatically after every turn — no command to run, no stale number.

- A `Stop`-event hook reads the turn's own transcript, sums all four token categories (input, output, cache-write, cache-read — not output-only, since input and cache tokens usually dominate an agentic session), and appends a running snapshot to a small local history log.
- Cost is estimated from a per-model price table — approximate, flagged as such, and will need updating as Anthropic's pricing changes; never presented as an exact bill.
- A SessionStart nudge offers to set the statusline up the first time it's unset, and keeps offering each session until you do — Genesis never overwrites an existing statusline (yours, or another plugin's) without asking first.

## Commands

| Command | Stage | What you get |
|---|---|---|
| `/genesis:init` | kickoff | project state + captured idea + baseline code graph |
| `/genesis:requirements` | 1 | user stories, acceptance criteria, priorities |
| `/genesis:feasibility` | 2 | tech/cost/risk analysis, go/no-go |
| `/genesis:plan` | 3 | milestones, backlog with verification steps |
| `/genesis:design` | 4 | architecture, API contracts, ADRs (`--panel` = 3 competing designs, judged) |
| `/genesis:develop` | 5 | working code, per-task review + re-review |
| `/genesis:test` | 6 | test suite, coverage, defect log |
| `/genesis:uat` | 7 | requirement → code → test traceability matrix |
| `/genesis:deploy` | 8 | CI/CD configs, GO/NO-GO, guided execution |
| `/genesis:monitor` | 9 | monitoring config, runbooks, read-only health watch |
| `/genesis:maintain` | 10 | triaged fixes and enhancements, change log |
| `/genesis:status` | any | stage board — rendered by a hook, costs zero tokens |

Codegraph has no dedicated command — ask about your code in plain English and the skill triggers itself.

## Cost and token efficiency

- Thinking stages (1–4) are cheap: a few model calls each. Development and testing scale with your app: one builder + one reviewer per task, run in parallel.
- Status, approvals, state updates, session briefings, the code graph, and usage tracking are all pure Node hooks — **zero model tokens**, and none of them can be hallucinated.
- Agents talk to each other in compressed, contract-fixed formats (~60% smaller); everything written for *you* is normal prose.
- Later stages read an index of earlier artifacts and pull full documents only when needed; code questions read the code graph instead of re-exploring the tree.

## Safety rails

- Deploy commands run only in the main session under your permission prompts — never inside background agents.
- Monitoring loops are read-only; anomalies become triage notes, never automatic production changes.
- Security findings and destructive-operation instructions are always written in full plain English.
- State file, graph, and usage-history reads are size-capped, symlink-safe, and sanitized before entering model context.
- Every state-mutating write (state, graph, usage history) goes through the same atomic write-and-lock primitives, so a crash or a concurrent session can't corrupt the files Genesis depends on.

## Genesis vs. building solo (unstructured prompting)

Honest, mechanism-grounded comparison — not benchmark numbers, since no controlled study exists for either side. Each row states *why*, so you can judge whether it applies to your situation.

| Dimension | Prompting solo | With Genesis | Why |
|---|---|---|---|
| **Correctness of shipped code** | Whatever the one drafting agent produces; a mistake ships unless you personally catch it | Every code task gets a *second*, independent reviewer before it's called done, then a re-review after any fix | Adversarial draft → review → fix → re-review is a structural check a single-pass "just write it" workflow doesn't have |
| **Requirements met vs. requirements *implied*** | Tacit — whatever you happened to say in the prompt | Explicit acceptance criteria, with a traceability matrix proving each one has code and a test | Nothing to trace back to if the requirement was never written down |
| **Architectural consistency at scale** | Drifts as the session gets longer and context gets diluted; two features can quietly contradict each other | ADRs bind every builder; "ADR wins architecture" is an enforced conflict rule, not a suggestion | Ten parallel tasks converging on one design needs a written contract, not shared memory |
| **Continuity across sessions/`/clear`/teammates** | Starts from zero context every time unless you re-explain | State lives in the repo; a hook briefs any new session on exactly where the build stands | Prompting has no persistence layer of its own |
| **Cost of "where is X" / "what calls Y"** | A fresh grep-and-read of the tree, every time, in every session | Answered from a maintained index at zero model tokens, auto-updated after every edit | The index amortizes the one-time cost of understanding the codebase instead of re-paying it per question |
| **Visibility into what a session is costing** | None, unless you're watching token counters yourself | Live session + weekly usage and an estimated cost, updated every turn | Nothing to compare against without a live number |
| **Upfront cost for a small, one-off script** | Lowest — one prompt, one response | Higher — requirements/feasibility/plan/design are real LLM calls even for a tiny task | Genesis's structure is overhead you're paying for whether or not the project is big enough to need it |
| **Cost over a large, multi-week build** | Can be lower per-turn, but rework from missed requirements, re-discovered context, and repeated re-exploration adds up across the whole project | Amortized: the up-front stages, the index, and the review loop are one-time/incremental costs that avoid the larger, harder-to-see cost of rework | This is a bet that avoided rework outweighs the added review/process overhead — true for real applications, not for a 20-line script |

**The honest summary:** Genesis trades some token/time overhead per turn for a lower chance of a costly mistake shipping unnoticed, and for not re-paying the cost of understanding your own codebase every time you ask about it. That trade is a clear win for something you intend to maintain and ship; it's the wrong tool for a disposable one-off script.

## Development

```
npm test                                            # unit tests: hooks, state, workflow decision logic, code graph
npm run validate                                    # structural validation
npm run smoke                                       # deterministic-layer smoke test
```

Plugin layout: `plugins/genesis/` — `agents/` (11 roles) · `skills/` (12 stages + codegraph + `_shared` protocols) · `hooks/` (state machine + code graph + usage tracking — all zero model tokens) · `workflows/` (parallel develop/test/design-panel) · `evals/` + `tests/`.

## License

MIT
