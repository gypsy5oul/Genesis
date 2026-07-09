---
name: deploy
description: SDLC stage 8 — deployment. Devops-engineer generates pipeline, manifests, rollback plan; execution is guided and permission-gated in the main session. Produces docs/sdlc/08-deployment.md. Use on /genesis:deploy. Also use when the user says "deploy this", "ship it", "set up CI/CD", "create the Dockerfile", or asks to release the app.
---

# Stage 8: Deployment

Follow `../_shared/gate-protocol.md`, `../_shared/review-loop.md`, `../_shared/output-contracts.md`.

**Prior stage:** `uat` approved. **Artifact:** deploy configs + `docs/sdlc/08-deployment.md`.

## Playbook
1. Gate entry; mark `in-progress`. Ask the user: target environment(s), existing infra, credential situation. No target → generate for the design doc's deployment ADR and say so.
2. **Generate** — spawn `devops-engineer`: Dockerfile/CI pipeline/manifests per design ADRs, environment config templates (no secret values), smoke-check script, and a rollback plan with exact undo commands.
3. **Ship review** (skip when trivial: ≤2 files, <50 lines, no auth/payments) — parallel: `code-reviewer` (config correctness) + `security-reviewer` (secrets, exposure, supply chain). Merge → **GO / NO-GO**: any Critical → default NO-GO unless the human explicitly accepts the risk.
4. **Guided execute** — main session ONLY, normal permission prompts, one command at a time with its purpose stated; verify each step's output before the next. This section is written in full normal English — deploy steps are irreversible-adjacent. Never run deploy commands inside agents or workflows.
5. Write artifact: what was generated, review verdict, execution log (or "not executed — configs ready"), rollback plan verbatim.
6. Chores; gate exit.

## Exit criteria
- Rollback plan exists with exact commands.
- GO/NO-GO verdict recorded with reviewer findings attached.
- Smoke-check script exists and passes against the deployed target (or artifact states deploy not executed).
