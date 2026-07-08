---
name: monitor
description: SDLC stage 9 — production monitoring. SRE generates monitoring config + runbooks; a read-only self-paced loop watches health endpoints/logs the user points at. Produces docs/sdlc/09-monitoring.md. Use on /genesis:monitor.
---

# Stage 9: Production Monitoring

Follow `../_shared/gate-protocol.md`, `../_shared/review-loop.md`, `../_shared/output-contracts.md`.

**Prior stage:** `deploy` approved. **Artifact:** monitoring config + `docs/sdlc/09-monitoring.md`.

## Playbook
1. Gate entry; mark `in-progress`. Ask user: health endpoints/log locations to watch, alerting stack if any.
2. **Generate** — spawn `sre`: monitoring config (golden signals where stack allows), alert thresholds with WHY comments, runbook per alert (full English), dashboard config if the stack has one.
3. **Review** — `code-reviewer`: thresholds without rationale, alerts without runbooks, happy-path-only watches. Fix per review loop.
4. **Watch loop** (only if user wants it now): set up a read-only self-paced loop polling the named endpoints/tailing logs. Filters must match failure signatures, not only success markers — silence is not success. Anomaly → append triage note to `docs/sdlc/10-maintenance.md` + notify user. NEVER mutate production from the loop.
5. Write artifact: what is watched, thresholds, runbook index, loop status.
6. Chores; gate exit.

## Exit criteria
- Every alert has a runbook entry with check commands and escalation.
- Watch filters cover failure signatures (error/crash/timeout), not just success.
- Loop (if armed) is read-only — no mutating commands anywhere in it.
