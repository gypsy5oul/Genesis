---
name: codegraph
description: Answer structural questions about the current project's own code — "where is X defined", "what calls Y", "what does this file import", "what would break if I change Z" — using the project's code graph instead of re-reading the tree. Use whenever the user asks something in this shape about their own codebase. Not for questions about how a feature conceptually works, only where things are and what connects to what.
---

# Codegraph

Read `../_shared/graph-protocol.md` first.

## Process

1. `docs/sdlc/graph.json` missing → check for `docs/sdlc/state.json`. Present
   → tell the user the graph hasn't been built yet (should have happened at
   `/genesis:init`; suggest running `node hooks/graph-index.js --files <paths>`
   over the tree manually, or re-running init, to bootstrap it). Absent → tell
   the user codegraph only works inside a Genesis-managed project.
2. Map the question to a query verb:
   - "where is X (defined)" / "what is X" (a named function/class) → `where`
   - "what calls X" / "who uses X" → `callers`
   - "what does <file> import" → `imports`
   - "what would break if I change <file>" / "what depends on <file>" → `impact`
3. Run the query via Bash: `node ${CLAUDE_PLUGIN_ROOT}/hooks/graph-query.js <verb> <target>`.
   Multiple candidates (e.g. the question names something ambiguous) →
   run more than one query rather than guessing.
4. Answer from the query's actual output only. Cite `file:line`. A `no data`/
   `no <x> found` result means say so plainly — don't fall back to guessing
   from memory or re-grepping the tree as a silent substitute.
5. Remind the reader of the scope limits from `graph-protocol.md` only when
   relevant (e.g. they ask about a Python file and the project graph is
   JS/TS-only — say plainly that language isn't graphed yet, don't stay silent;
   or a `callers` query comes back empty for a class method — method calls like
   `this.foo()`/`obj.foo()` aren't tracked, only calls to plain functions by name,
   so say that rather than implying the method truly has no callers).
