'use strict';

// Recognizes a genesis: debt marker after a `#`, `//`, or `--` comment
// introducer, anywhere in the line (covers an end-of-line inline comment,
// not just a marker that starts the line). v1 scope only — three prefixes
// cover every builder role this feature ships for today (Python/shell,
// JS/TS, SQL); add another prefix here if a project's marker goes
// unrecognized, don't build a general comment-syntax parser for it.
// Known limitation (accepted, not fixed here): this regex can false-
// positive-match a `genesis:` substring inside a URL in a comment (e.g. a
// comment containing "genesis:8080") as if it were a real marker — the same
// limitation the ponytail project's own grep-based marker convention has.
const MARKER_RE = /(?:#|\/\/|--)\s*genesis:\s*(.*)$/;

// A marker's body is `<ceiling>, <upgrade trigger>` (ponytail's own
// convention: the ceiling names the corner cut, the trigger names when to
// revisit it). Splits on the FIRST comma only, since a trigger description
// may itself contain a comma. No comma, an empty ceiling, or an empty
// trigger all mean the marker names no real upgrade trigger —
// `noTrigger: true`, surfaced instead of silently treated as complete.
function parseMarkerBody(body) {
  const trimmed = body.trim();
  if (!trimmed) return { ceiling: null, trigger: null, noTrigger: true };
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx === -1) return { ceiling: trimmed, trigger: null, noTrigger: true };
  const ceiling = trimmed.slice(0, commaIdx).trim();
  const trigger = trimmed.slice(commaIdx + 1).trim();
  if (!ceiling || !trigger) return { ceiling: ceiling || null, trigger: trigger || null, noTrigger: true };
  return { ceiling, trigger, noTrigger: false };
}

// Scans raw file text for genesis: debt markers, one result per matching
// line (1-indexed, matching graph-parse.js's own node `lines` convention).
// Pure text scan — deliberately not tied to tree-sitter or any language's
// grammar, so it works on any file type a builder might touch, including
// ones the code graph itself skips (YAML, Go, etc.).
function scanMarkers(source) {
  const found = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MARKER_RE);
    if (!m) continue;
    found.push({ line: i + 1, ...parseMarkerBody(m[1]) });
  }
  return found;
}

module.exports = { scanMarkers, parseMarkerBody };
