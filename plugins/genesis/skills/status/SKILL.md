---
name: status
description: Show the SDLC stage board. Normally intercepted by the plugin's zero-token hook; this skill is the fallback when hooks are disabled. Use when the user runs /genesis:status and no hook answered.
---

# SDLC Status (fallback)

The UserPromptSubmit hook renders this for free. If you are reading this, the hook did not fire.

1. Read `docs/sdlc/state.json`. Missing → say: no SDLC project, run `/genesis:init`.
2. Print: project, idea, then one line per stage in order (requirements → maintain): `stage — status — artifact path or -`.
3. If any stage is `awaiting-approval`: remind `Say "approve <stage>" after reviewing <artifact>`. If hooks are off, "approve" must be handled manually: edit state.json, set that stage's status to "approved" with an approvedAt ISO timestamp — only with the user's explicit confirmation.
4. Suggest the next command: first stage in order whose status is `pending` while all prior are `approved`.
