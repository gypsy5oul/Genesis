# Genesis

**From idea to production — your AI software company.**

Virtual software company for Claude Code: a gated 10-stage SDLC driven by 11 role agents. Opus thinks, sonnet builds and reviews, haiku does chores, scripts do everything deterministic for $0.

## Install

/plugin marketplace add <this-repo-url>
/plugin install genesis@claude-skills

Local dev: clone this repo, run Claude Code with `--plugin-dir /opt/claude-skills/plugins/genesis`.

## Usage

| Command | Stage | Artifact |
|---|---|---|
| `/genesis:init` | kickoff | `docs/sdlc/state.json`, `00-business-idea.md` |
| `/genesis:requirements` | 1 | `01-requirements.md` |
| `/genesis:feasibility` | 2 | `02-feasibility.md` |
| `/genesis:plan` | 3 | `03-plan.md` |
| `/genesis:design` | 4 (`--panel` for judge panel) | `04-design.md` (ADRs) |
| `/genesis:develop` | 5 | code + `05-development.md` |
| `/genesis:test` | 6 | tests + `06-testing.md` |
| `/genesis:uat` | 7 | `07-uat.md` (traceability matrix) |
| `/genesis:deploy` | 8 | configs + `08-deployment.md` |
| `/genesis:monitor` | 9 | `09-monitoring.md` + read-only watch loop |
| `/genesis:maintain` | 10 | `10-maintenance.md` (running log) |
| `/genesis:status` | any | zero-token board (hook-rendered) |

**Gates:** every stage ends `awaiting-approval`. Review the artifact, then say `approve <stage>` — a hook flips the state deterministically, no tokens. Questions ("should I approve X?") are not approvals. Stages never auto-chain.

**State:** `docs/sdlc/state.json` in YOUR project is the only cross-stage memory. Different sessions and teammates pick up from it — a SessionStart hook injects the summary (survives `/clear` and compaction).

## Cost notes (rough)

- Thinking stages (1–4): cheap — 2-4 opus/sonnet calls each. `--panel` on design adds ~5 opus calls.
- develop/test: expensive — one builder + one reviewer (+ fix round) per task/module, parallel.
- status/approvals/state: $0 (hooks). init: $0 (no agents).

## Health metrics (is it working?)

- Gate refusal: `/genesis:develop` before design approval must refuse.
- Artifacts match contracts: exit criteria listed and checked in each gate summary.
- Diffs stay small: every changed line traces to a task; review findings trend down per cycle.
- `node plugins/genesis/evals/validate-structure.js` passes in CI.

## Layout

agents/ (11 roles) · skills/ (12 stages + _shared protocols) · hooks/ (2 zero-token hooks + state lib) · workflows/ (develop, test, design-panel) · evals/ (structural validator) · tests/ (node --test)
