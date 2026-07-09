---
name: feasibility
description: SDLC stage 2 — feasibility study. BA + solution-architect + devops-engineer assess technical/cost/risk, produce docs/sdlc/02-feasibility.md with go/no-go. Use on /genesis:feasibility. Also use when the user says "is this feasible", "feasibility study", "go or no-go", or asks whether the idea is worth building.
---

# Stage 2: Feasibility Study

Follow `../_shared/gate-protocol.md`, `../_shared/review-loop.md`, `../_shared/output-contracts.md`.

**Prior stage:** `requirements` approved. **Artifact:** `docs/sdlc/02-feasibility.md`.

## Playbook
1. Gate entry; mark `in-progress`.
2. **Parallel assessment** (one message, three Agent calls):
   - `solution-architect`: technical feasibility — candidate stacks, integration risks, unknowns needing spikes.
   - `business-analyst`: business feasibility — cost drivers, timeline realism vs requirements, regulatory/data constraints.
   - `devops-engineer`: operational feasibility — hosting options, CI/CD fit, environment/credential needs, run-cost sketch.
   Each gets the requirements artifact path + state path; terse markdown sections back.
3. **Synthesize** — merge into artifact: findings per dimension, risk register (likelihood × impact), explicit **go / no-go / go-with-conditions** recommendation with rationale.
4. **Review** — `code-reviewer` adversarial pass on the document: unsupported claims, missing risks, numbers without sources. Fix per review loop.
5. Chores; gate exit.

## Exit criteria
- Go/no-go stated with ≥3 supporting reasons.
- Risk register has ≥3 risks, each with likelihood, impact, mitigation.
- Any "needs spike" item has a time-boxed spike task listed for the plan stage.
