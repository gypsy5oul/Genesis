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
4. Answer from the query's actual output only. Cite `file:line`. Never
   present a location the query didn't return, and never silently swap in a
   guess from memory or a bare `grep` as if the graph had produced it. Two
   kinds of empty result are NOT the same, though:
   - A **definitive empty answer** about a symbol/file the graph DOES track —
     `no callers found for "X"`, `no imports found for "<file>"`,
     `no importers found for "<file>"` — is a real, trustworthy negative.
     Report it plainly as fact; do not go re-grepping to "double-check" it.
   - A **`no data for "X"`** result means the graph has literally never seen
     X. That can mean X doesn't exist — or that X was created outside the main
     session's own `Edit`/`Write`/`MultiEdit` calls (a Bash heredoc, a
     `git checkout`, a codemod) and so never went through the indexing hook.
     Here you MAY fall back to a `grep`/`Grep` search, but only if you label
     it explicitly as NOT coming from the code graph, e.g.: "the code graph
     has no record of `X` — it may not exist, or it may have been created
     outside an Edit/Write/MultiEdit call and never indexed; checking with
     grep instead: …". Keep the graph's own answer and the grep result
     visibly separate — never blur the grep hit into "the graph found it".
5. Remind the reader of the scope limits from `graph-protocol.md` only when
   relevant (e.g. they ask about a Python file and the project graph is
   JS/TS-only — say plainly that language isn't graphed yet, don't stay silent;
   or a `callers` query comes back empty for a class method — method calls like
   `this.foo()`/`obj.foo()` aren't tracked, only calls to plain functions by name,
   so say that rather than implying the method truly has no callers).
