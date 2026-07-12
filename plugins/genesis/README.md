# Genesis

**Build production-ready software in Claude Code — from idea to deployment, one reviewed stage at a time.**

A gated 10-stage software lifecycle for developing real applications: 11 specialized role agents draft, adversarially review, and fix every artifact and every code change; you approve each stage before the next begins. Opus thinks, sonnet builds and reviews, haiku does chores, scripts do everything deterministic for $0.

## Install

/plugin marketplace add https://github.com/gypsy5oul/Genesis
/plugin install genesis@claude-skills

**Code graph (optional, one command).** The structural code graph relies on native `tree-sitter` parsers that a marketplace install can't build automatically. Enable it once, then restart the session:

    npm install --prefix "$CLAUDE_PLUGIN_ROOT"

Everything else — stage gates, approvals, the review loop, and the `genesis:` debt-marker ledger — works without it. A one-time SessionStart notice reminds you if the code graph is off.

Local dev: clone this repo, run `npm install` at the repo root (a `postinstall` step installs the plugin's own native deps), then run Claude Code with `--plugin-dir <path-to-your-clone>/plugins/genesis`.

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
- Usage/cost tracking: opt-in statusline showing per-session + rolling-7-day token totals and estimated USD, recomputed each turn by a Stop hook — $0 model tokens.

## Health metrics (is it working?)

- Gate refusal: `/genesis:develop` before design approval must refuse.
- Artifacts match contracts: exit criteria listed and checked in each gate summary.
- Diffs stay small: every changed line traces to a task; review findings trend down per cycle.
- `node plugins/genesis/evals/validate-structure.js` passes in CI.

## Layout

agents/ (11 roles) · skills/ (12 stages + _shared protocols) · hooks/ (state machine, code graph, debt ledger, usage tracking — all zero model tokens) · workflows/ (develop, test, design-panel) · evals/ (structural validator) · tests/ (node --test)
