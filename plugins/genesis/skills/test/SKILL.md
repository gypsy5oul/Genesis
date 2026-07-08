---
name: test
description: SDLC stage 6 — testing. QA-engineer team writes and runs the test suite per module via workflow; devs fix defects. Produces docs/sdlc/06-testing.md. Use on /genesis:test.
---

# Stage 6: Testing

Follow `../_shared/gate-protocol.md`, `../_shared/review-loop.md`, `../_shared/output-contracts.md`.

**Prior stage:** `develop` approved. **Artifact:** test suite + `docs/sdlc/06-testing.md`.

## Playbook
1. Gate entry; mark `in-progress`.
2. **Module map** ($0 tier — do it yourself): from the design doc's component list, build `modules: [{name, paths, testCommand}]`. Project has one test command → one module per component, same command.
3. **Fan-out** — run Workflow scriptPath `<this skill's base dir>/../../workflows/test.js` with `{modules}`. Per module: qa-engineer writes/extends tests against acceptance criteria → runs → dev agent fixes product defects (Prove-It: failing test exists before any fix).
4. **Full run** — main session: full suite + coverage if available. Paste evidence.
5. Write `06-testing.md`: per-module results, defect log (found/fixed/open with severity), coverage, acceptance criteria WITHOUT covering tests (explicit list).
6. Chores; gate exit.

## Exit criteria
- Full suite passes; command + counts in artifact.
- Every open defect has severity + owner; zero open Critical (else NO-GO note).
- Every must-have acceptance criterion has a named covering test, or is listed as uncovered.
