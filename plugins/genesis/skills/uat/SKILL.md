---
name: uat
description: SDLC stage 7 — user acceptance testing. Product-manager + qa-engineer walk every acceptance criterion against the built system, produce docs/sdlc/07-uat.md with a traceability matrix. Use on /genesis:uat. Also use when the user says "acceptance testing", "UAT", "does it meet the requirements", or asks for final sign-off checks.
---

# Stage 7: UAT

Follow `../_shared/gate-protocol.md`, `../_shared/review-loop.md`, `../_shared/output-contracts.md`.

**Prior stage:** `test` approved. **Artifact:** `docs/sdlc/07-uat.md`.

## Playbook
1. Gate entry; mark `in-progress`.
2. **Scenario walk** — spawn `product-manager`: for every acceptance criterion in `01-requirements.md`, drive the real system (run the app, hit the endpoint, click the flow per project type) and record `pass|fail|blocked` with evidence (command output, screenshot path, response body). Gate on artifacts, never on the test stage's claims — re-verify independently.
3. **Traceability matrix** — spawn `qa-engineer`: table criterion → implementing code path → covering test → UAT verdict. Unlinked criterion = fail row. Validate matrix completeness yourself ($0): every must-have criterion appears.
4. Failures → route defects to dev agents (max 1 round), re-walk failed scenarios only.
5. Write artifact: matrix, scenario evidence, sign-off list (which criteria the human is being asked to accept, incl. any waived).
6. Chores; gate exit.

## Exit criteria
- Traceability matrix covers 100% of must-have criteria.
- Zero must-have criterion in `fail` (else NO-GO note with the list).
- Every `blocked` row names the blocker and owner.
