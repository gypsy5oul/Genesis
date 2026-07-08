# Genesis

**From idea to production — your AI software company.**

Genesis is a Claude Code plugin that turns a session into a full virtual software company. Give it a business idea and it walks the complete SDLC — requirements, feasibility, planning, design, development, testing, UAT, deployment, monitoring, maintenance — with a dedicated AI team for every stage and **you as the approval gate between stages**.

```
/genesis:init  →  "a URL shortener for internal links"
/genesis:requirements   → 01-requirements.md   → you review → "approve requirements"
/genesis:feasibility    → 02-feasibility.md    → "approve feasibility"
/genesis:plan           → 03-plan.md           → "approve plan"
/genesis:design         → 04-design.md (ADRs)  → "approve design"
/genesis:develop        → real code + reviews  → "approve develop"
/genesis:test           → test suite + report  → ...through deploy, monitor, maintain
```

## Install

```
/plugin marketplace add https://github.com/gypsy5oul/Genesis
/plugin install genesis@claude-skills
```

Then in any project: `/genesis:init` and follow the stages.

## Features

### A real org chart, not one chatbot
11 role agents with strict charters and stay-in-lane rules, tiered by model like seniority:

| Tier | Roles |
|---|---|
| **Opus** (architect brains) | business-analyst, product-manager, solution-architect |
| **Sonnet** (senior engineers) | frontend-dev, backend-dev, devops-engineer, qa-engineer, code-reviewer, security-reviewer, sre |
| **Haiku** (junior) | junior-assistant — formatting, changelogs, chores |

### Human gates, enforced by code
Every stage ends `awaiting-approval`. You review the artifact, then say `approve <stage>` — a deterministic hook flips the state. Questions ("should I approve design?") are never treated as approvals. Stages never auto-chain. Trying `/genesis:develop` before design is approved gets refused.

### Quality is adversarial, not assumed
Every artifact and every code task goes through draft → adversarial review (Critical/Required/Nit/FYI, no praise) → fix. Reviewers re-run tests themselves — builder claims are not evidence. Any unresolved Critical means a NO-GO recommendation at the gate. Deploys get a GO/NO-GO verdict with a mandatory rollback plan.

### Architecture that survives parallel agents
The design stage produces binding ADRs. Every builder reads the spec (WHAT) and the ADRs (HOW); conflict rule: **ADR wins architecture, SPEC wins scope**. Development fans out in parallel over disjoint file sets, each task independently reviewed. UAT produces a traceability matrix: every acceptance criterion → code → passing test.

### Token-efficient by design
- **$0 tier below Haiku:** status board, approvals, and state updates are pure Node hooks — zero model tokens, zero hallucinated status.
- **Compressed agent-to-agent traffic:** strict output contracts (~60% smaller); human-facing documents stay normal prose.
- **Progressive disclosure:** later stages get an index of earlier artifacts and pull detail only when needed.
- **Compaction-proof memory:** project state re-injects after `/clear` and auto-compaction; any teammate in any session picks up exactly where the last one stopped via `docs/sdlc/state.json` in your project.

### Team-ready
State lives in *your* repo, not the session. Different people can run different stages on different days. A session-start hook briefs every new session on where the project stands.

## Commands

| Command | Stage | Output |
|---|---|---|
| `/genesis:init` | kickoff | `docs/sdlc/state.json`, `00-business-idea.md` |
| `/genesis:requirements` | 1 | BRD, user stories, MoSCoW priorities |
| `/genesis:feasibility` | 2 | tech/cost/risk analysis, go/no-go |
| `/genesis:plan` | 3 | milestones, backlog with verification steps |
| `/genesis:design` | 4 | architecture, API contracts, ADRs (`--panel` = 3-proposal judge panel) |
| `/genesis:develop` | 5 | working code, per-task adversarial review |
| `/genesis:test` | 6 | test suite, coverage, defect log |
| `/genesis:uat` | 7 | traceability matrix, sign-off list |
| `/genesis:deploy` | 8 | pipeline/manifests, GO/NO-GO, guided execution |
| `/genesis:monitor` | 9 | monitoring config, runbooks, read-only watch loop |
| `/genesis:maintain` | 10 | triage → routed fixes, running change log |
| `/genesis:status` | any | zero-token stage board |

## Cost guide

Thinking stages (1–4) are cheap: a few opus/sonnet calls each. Development and testing are the expensive stages: one builder + one reviewer (plus fix round) per task or module, run in parallel. Status, approvals, and init cost nothing.

## Safety rails

- Deploy commands run only in the main session under your permission prompts — never inside background agents.
- Monitoring loops are read-only; anomalies become triage notes, never automatic production changes.
- Security findings and destructive-operation instructions are always written in full plain English.
- State file reads are size-capped, symlink-safe, and sanitized before entering model context.

## Development

```
node --test plugins/genesis/tests/          # 32 unit tests (hooks + state)
node plugins/genesis/evals/validate-structure.js   # structural validation
plugins/genesis/evals/smoke.sh              # end-to-end deterministic-layer smoke
```

Plugin layout: `plugins/genesis/` — `agents/` (11 roles) · `skills/` (12 stages + `_shared` protocols) · `hooks/` (zero-token state machine) · `workflows/` (parallel develop/test/design-panel) · `evals/` + `tests/`.

## License

MIT
