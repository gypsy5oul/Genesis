# Code Graph Protocol (all stages that touch code)

Single source of truth for `docs/sdlc/graph.json` — spec:
`docs/superpowers/specs/2026-07-09-codegraph-design.md`.

## What it is

A structural index of the target project's own code: functions, classes,
imports, same-file calls. Not a semantic/concept graph — "where is X" and
"what calls Y", not "how does auth work".

## Lifecycle

- **Baseline**: built once at `/genesis:init` (`init/SKILL.md`) via a full
  scan of the existing tree.
- **Incremental**: a PostToolUse hook (`hooks/graph-index.js`) re-parses a
  single file every time it's Edited/Written/MultiEdited in the main
  session. Automatic — no stage needs to think about this.
- **Reconciliation**: files written by a spawned sub-agent (a `develop`
  task, a `maintain` fix) don't go through the main session's own tool
  calls, so the PostToolUse hook never sees them. `develop`/SKILL.md and
  `maintain`/SKILL.md each run `node hooks/graph-index.js --files <paths>`
  over every file their sub-agents reported changing, right after those
  changes land — same "whatever gets added, the graph has it" guarantee,
  just triggered explicitly instead of via hook.

## Querying (any stage, any agent — zero model tokens)

```
node <plugin root>/hooks/graph-query.js where <name>       # file:line-line
node <plugin root>/hooks/graph-query.js callers <name>     # who calls it
node <plugin root>/hooks/graph-query.js imports <relFile>  # what it imports
node <plugin root>/hooks/graph-query.js impact <relFile>   # who imports it
```

Run via Bash from the target project's root (or pass `--cwd <dir>`). Output
is plain text, one result per line, or a `no data`/`no <x> found` message.
Never invent a location the query didn't return.

## Scope (v1)

- Languages: JavaScript, TypeScript, TSX only.
- `imports` edges: relative specifiers only (`./x`, `../x`). Bare package
  imports (`react`) aren't resolved to a file and don't appear. Extensionless
  specifiers (`./b`) are resolved against the real filesystem — exact match,
  then `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`, then `/index.*` — and dropped
  entirely if no candidate exists on disk (silence, not a wrong answer).
  Only ES `import` statements are recognized — re-exports (`export ... from
  './x'`) and CommonJS `require('./x')` produce no edge (silence, not wrong).
- `calls` edges: same-file only, and only to a plain top-level
  function/const-arrow referenced by its bare name. Method-target calls
  (`obj.m()`, `this.m()`) are never resolved, even within the same file
  and even when the target method exists — silence, not a wrong answer,
  when unresolved. Cross-file calls, dynamic dispatch, and reflection
  aren't resolved either.
