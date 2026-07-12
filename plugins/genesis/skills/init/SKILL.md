---
name: init
description: Start an SDLC project — capture the business idea, create docs/sdlc/state.json and 00-business-idea.md. Use when the user runs /genesis:init or says "start a new SDLC project".
---

# SDLC Init

Read `../_shared/gate-protocol.md` first.

## Process
1. `docs/sdlc/state.json` already exists → show its summary, ask whether to continue that project or re-init (re-init requires explicit confirmation — it does not delete artifacts, only resets state).
2. Ask the user for: business idea (one paragraph), project name, target directory if not cwd. One question at a time if unclear.
3. Create `docs/sdlc/00-business-idea.md`: the idea verbatim, date, who asked.
4. Create `docs/sdlc/state.json` exactly:

```json
{
  "version": 1,
  "project": "<name>",
  "idea": "<one-liner>",
  "createdAt": "<ISO date>",
  "currentStage": "requirements",
  "stages": {
    "requirements": { "status": "pending" }, "feasibility": { "status": "pending" },
    "plan": { "status": "pending" }, "design": { "status": "pending" },
    "develop": { "status": "pending" }, "test": { "status": "pending" },
    "uat": { "status": "pending" }, "deploy": { "status": "pending" },
    "monitor": { "status": "pending" }, "maintain": { "status": "pending" }
  },
  "decisions": []
}
```

5. Build the baseline code graph: run `node ${CLAUDE_PLUGIN_ROOT}/hooks/graph-index.js --files <every file under the project root, respecting .gitignore>` (empty file list for a greenfield project — the graph starts empty and the incremental hook takes over from here). For a large existing codebase, pipe the newline-delimited file list into `--files-stdin` instead (e.g. `git ls-files | node ${CLAUDE_PLUGIN_ROOT}/hooks/graph-index.js --files-stdin --cwd .`) — same batched single-pass indexing, but with no `ARG_MAX` argv-length limit. See `../_shared/graph-protocol.md`.
6. Tell the user: next command `/genesis:requirements`; status any time via `/genesis:status`; approvals by saying `approve <stage>`.

No agents spawned. No cost. Deterministic.
