---
name: requirements
description: SDLC stage 1 — requirement gathering. Business-analyst + product-manager produce docs/sdlc/01-requirements.md (BRD, user stories, MoSCoW). Use on /genesis:requirements. Also use when the user says "gather requirements", "write user stories", "start stage 1", or asks to define what the app should do.
---

# Stage 1: Requirement Gathering

Follow `../_shared/gate-protocol.md` (entry/exit), `../_shared/review-loop.md`, `../_shared/output-contracts.md`.

**Prior stage:** none (init must have run). **Artifact:** `docs/sdlc/01-requirements.md`.

## Playbook
1. Gate entry per protocol; mark `in-progress`.
2. **Draft** — spawn `business-analyst`: prompt includes path to `00-business-idea.md` + state file; ask for BRD (problem, goals, non-goals, stakeholders), user stories with acceptance criteria (`verify:` phrasing), MoSCoW table, open questions. Quote the plan-steps output contract.
3. **Review** — spawn `product-manager` adversarially: gaps, untestable criteria, scope creep, missing stakeholders. Review-findings contract.
4. **Fix** — business-analyst addresses Critical+Required (max 2 rounds).
5. Write the artifact (normal prose). **Chores** — `junior-assistant`: ToC + formatting only.
6. Present OPEN QUESTIONS to the user directly — requirements with unanswered blocking questions stay unresolved in the gate summary.
7. Gate exit per protocol with exit criteria below.

## Exit criteria
- Every user story has ≥1 acceptance criterion phrased as a verifiable check.
- Every story has a MoSCoW priority.
- Non-goals section exists and is non-empty.
- Open questions listed with owner (user) — none silently resolved.

| Excuse | Rebuttal |
|---|---|
| "Idea simple, skip stories, prose enough" | Stories carry the acceptance criteria stage 6 tests. Write them. |
