# Review Loop (all stage skills)

Spec §4. Applies to every stage artifact and every code change.

1. **Draft** — lead agent produces the artifact. Opus persona for thinking stages (requirements→design), sonnet for build stages (develop→maintain).
2. **Senior review** — spawn `code-reviewer` (code) or the stage's second discipline agent (documents), prompted adversarially: find gaps, contradictions, missing cases. Severity per finding: **Critical / Required / Nit / FYI** — one line each: `severity | location | problem | fix`. No praise.
3. **Fix** — drafter addresses Critical + Required. Max 2 rounds; unresolved items go verbatim into the gate summary.
4. **Chores** — `junior-assistant` (haiku): formatting, ToC, changelog line. Anything scriptable (state edits, indexes) is done by the main session directly — $0 tier before haiku (spec §11.9).

Gate rule: any unresolved **Critical** → gate summary says `NO-GO recommended` and why. Human can still approve — their risk to accept.

Agent-to-agent traffic: terse, exact technical terms, no invented abbreviations, no praise. Passing long artifacts to agents: pass the path, not the content; if excerpting >200 lines, keep head 60% + tail 30% and mark the cut with `<elided lines=N/>`.
