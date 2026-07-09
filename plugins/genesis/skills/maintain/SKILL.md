---
name: maintain
description: SDLC stage 10 — maintenance and enhancements. Triage incoming issues/requests, route to dev/qa/devops agents, log every change in docs/sdlc/10-maintenance.md. Use on /genesis:maintain. Also use when the user says "fix this bug", "add an enhancement", "triage this issue" on a project with completed SDLC stages.
---

# Stage 10: Maintenance & Enhancements

Follow `../_shared/gate-protocol.md`, `../_shared/review-loop.md`, `../_shared/output-contracts.md`.

**Prior stage:** `monitor` approved. **Artifact:** `docs/sdlc/10-maintenance.md` (running log — this stage stays `in-progress` by design; the gate applies per-change, not per-stage).

## Playbook (per incoming item)
1. **Triage** ($0/main session): classify bug|enhancement|incident, severity, owning discipline. Bugs get the Prove-It rule: `qa-engineer` reproduces with a failing test BEFORE any fix.
2. **Route** — spawn the owning agent (`frontend-dev`/`backend-dev`/`devops-engineer`) with: triage note, failing test path, SPEC + ADR paths (still binding — drift dies here too).
3. **Review** — `code-reviewer` on every change, review-findings contract. Enhancement touching architecture → needs an ADR addition via `solution-architect` first.
4. **Reconcile** — `node <plugin root>/hooks/graph-index.js --files <files the routed agent's builder report listed>` (same reason as `develop`: the graph only sees the main session's own tool calls automatically). See `../_shared/graph-protocol.md`.
5. **Log** — append to `10-maintenance.md`: date, item, classification, changes, evidence, reviewer verdict.
6. Large enhancement (new feature area, >1 milestone of work) → recommend a fresh SDLC cycle (`/genesis:init` in a feature scope) instead of maintenance-mode creep.

## Exit criteria (per item, not per stage)
- Bug fixes: failing test now passes; suite green; log entry with evidence.
- Enhancements: acceptance criterion stated and verified; ADR updated when architecture moved.
