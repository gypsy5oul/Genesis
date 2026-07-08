---
name: plan
description: SDLC stage 3 — project planning. Product-manager turns approved requirements + feasibility into docs/sdlc/03-plan.md (milestones, backlog, estimates). Use on /genesis:plan.
---

# Stage 3: Project Planning

Follow `../_shared/gate-protocol.md`, `../_shared/review-loop.md`, `../_shared/output-contracts.md`.

**Prior stage:** `feasibility` approved. **Artifact:** `docs/sdlc/03-plan.md`.

## Playbook
1. Gate entry; mark `in-progress`.
2. **Draft** — spawn `product-manager` with requirements + feasibility artifact paths: milestones (vertical slices), backlog per the planner contract (acceptance criteria, verification command, dependencies, files-touched estimate, XS–L size — XL must split), spike tasks from feasibility, checkpoint markers every 2-3 tasks, `step → verify:` format throughout.
3. **Review** — spawn `solution-architect` adversarially: dependency order errors, hidden coupling, missing spikes, sizes that smell XL. Fix per review loop (max 2 rounds).
4. Chores; gate exit.

## Exit criteria
- Every backlog task has acceptance criteria + a verification command.
- No task sized XL.
- Dependencies form a valid order (no cycles, no forward references).
- Milestones each end in demonstrable working software.
