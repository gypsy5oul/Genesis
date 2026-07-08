---
name: develop
description: SDLC stage 5 — development. Solution-architect breaks the design into disjoint tasks; dev agents build in parallel via workflow; code-reviewer gates each task. Use on /genesis:develop.
---

# Stage 5: Development

Follow `../_shared/gate-protocol.md`, `../_shared/review-loop.md`, `../_shared/output-contracts.md`.

**Prior stage:** `design` approved. **Artifact:** code + `docs/sdlc/05-development.md`.

## Playbook
1. Gate entry; mark `in-progress`. Verify clean git baseline in the target repo (uncommitted changes → ask user first).
2. **Breakdown** — spawn `solution-architect` with design + plan paths: emit the task list as JSON per the planner contract. Validate yourself ($0 tier): file sets disjoint, every backlog task covered, complexity ∈ low|medium|high. Invalid → one retry with the errors quoted, then surface to user.
3. **Build** — run Workflow with scriptPath `<this skill's base dir>/../../workflows/develop.js`, args `{tasks, specPath: "docs/sdlc/01-requirements.md", adrPath: "docs/sdlc/04-design.md"}`. Cost note to user first: roughly one sonnet builder + one sonnet review per task. Workflow interrupted → resume with the same scriptPath + `resumeFromRunId` from the original tool result; completed tasks return cached.
4. **Integrate** — after workflow returns: run the full project test suite yourself in the main session. Failures → route to the owning discipline agent (max 2 rounds), then surface.
5. **Commit** — one commit per completed task where the workflow hasn't already; conventional messages.
6. Write `05-development.md`: task table (id, title, files, review verdict, test evidence), unresolved findings, deviations from design (each needs an ADR note).
7. Chores; gate exit.

## Exit criteria
- Full test suite passes (paste command + counts into artifact).
- Every task's Critical and Required findings resolved or listed unresolved with NO-GO note.
- No file changed outside the union of task file lists.
- Every deviation from an ADR has an explicit note the human sees at the gate.

| Excuse | Rebuttal |
|---|---|
| "Suite mostly passes, two flakes" | Flake or failure, evidence at the gate. Investigate first. |
| "Task file lists too strict, one extra util" | Extra file = breakdown bug. Re-run breakdown or get user OK. |
