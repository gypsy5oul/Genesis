# Gate Protocol (all stage skills)

Single source of truth — spec §3. Every stage skill follows this exactly.

## Entry
1. Read `docs/sdlc/state.json` (target project cwd). Missing → stop; tell user to run `/genesis:init`.
2. Check the prior stage (each SKILL.md names it) has `status: "approved"`. Not approved → refuse with one line: which stage blocks, how to approve. Exception: user explicitly says "run anyway" → proceed AND append `"override: ran <stage> before <prior> approved"` to `decisions`.
3. If own stage status is `in-progress` and a partial artifact exists, resume from it — do not restart.
4. Edit state.json directly (main session, no agent): set own stage `status: "in-progress"`, set `currentStage`, and record `startedAt` (ISO timestamp) on the stage entry.
5. Stage launches a Workflow → record its run id in the stage's `runId` field immediately.

## Exit
1. Write the stage artifact to its numbered path (each SKILL.md names it). Normal prose — a human reviews it.
2. Verify every exit criterion listed in the SKILL.md. Unmet criterion → fix or list it in the gate summary as unresolved.
3. Edit state.json: own stage → `status: "awaiting-approval"`, `artifact`, `exitCriteria` (the list, verbatim), `summary` (one line, for progressive disclosure), `reviewVerdict` (one line: reviewer's verdict + unresolved counts).
4. Print a gate summary: what was produced, open issues, exact artifact path, the sentence `Say "approve <stage>" after review.`
5. STOP. Never invoke the next stage. Never edit `status` to `approved` — only the human's approval (hook) does that. This is enforced, not just documented: a PreToolUse hook (`sdlc-state-guard.js`) denies any `Edit`/`Write`/`MultiEdit` to `state.json` that would set a stage's `status` to `"approved"`.

## Role-scoped writes (spec §11.8)
- Stage skill (main session): stage status (`in-progress`/`awaiting-approval`), `currentStage`, `artifact`, `exitCriteria`, `summary`.
- junior-assistant: formatting/changelog fields only, never `status`.
- Human via hook: `approved` only.

## Rationalizations
| Excuse | Rebuttal |
|---|---|
| "Prior stage obviously fine, skip the check" | Check is one read. Do it. |
| "Small project, chain next stage" | Gate is absolute. Human decides pace. |
| "I'll mark approved myself, user clearly wants it" | Only the hook writes `approved`. |
