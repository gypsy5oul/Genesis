---
name: design
description: SDLC stage 4 — system design. Solution-architect + security-reviewer produce docs/sdlc/04-design.md (architecture, data model, API contracts, numbered ADRs). Optional --panel flag runs a 3-proposal judge panel. Use on /genesis:design. Also use when the user says "design the system", "architecture", "ADRs", "API contracts", or asks how the app should be structured.
---

# Stage 4: System Design

Follow `../_shared/gate-protocol.md`, `../_shared/review-loop.md`, `../_shared/output-contracts.md`.

**Prior stage:** `plan` approved. **Artifact:** `docs/sdlc/04-design.md`.

## Playbook
1. Gate entry; mark `in-progress`.
2. **(Optional, only if user passed `--panel`)** — run Workflow with scriptPath `<this skill's base dir>/../../workflows/design-panel.js`, args `{designBrief: <one-paragraph brief from requirements+plan>, requirementsPath: "docs/sdlc/01-requirements.md"}`. Use the winning proposal as the draft skeleton. Costs ~5 opus calls — say so before running.
3. **Draft** — spawn `solution-architect` with requirements + plan paths: architecture (components, boundaries, data flow), data model, exact API contracts, tech stack with rationale, error-handling strategy, numbered ADRs (context/decision/consequences/alternatives). ADRs are binding on development.
4. **Security review** — spawn `security-reviewer`: threat-model the data flows (trust boundaries, validation points); findings in review contract, full English.
5. **Adversarial review** — spawn `code-reviewer`: internal contradictions, contracts that don't satisfy acceptance criteria, overcomplication. Fix per review loop.
6. Chores; gate exit.

## Exit criteria
- Every plan-stage backlog task maps to a component in the design.
- ≥3 numbered ADRs (stack choice, data storage, deployment shape at minimum).
- Every API contract names request/response types exactly.
- Security section addresses every trust boundary the threat model found.
