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
// Group 1 captures which prefix matched — needed by scanMarkers to decide
// whether a following comment-continuation line uses the SAME comment style.
const MARKER_RE = /(#|\/\/|--)\s*genesis:\s*(.*)$/;

// Pragmatic bound on how many continuation lines scanMarkers will merge into
// a single marker's body. Not derived from any spec — just enough to cover a
// realistic hand-written multi-line explanation without risking swallowing an
// entire unrelated trailing block of same-style comments.
const MAX_CONTINUATION_LINES = 10;

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
// marker (1-indexed on its STARTING line, matching graph-parse.js's own node
// `lines` convention). Pure text scan — deliberately not tied to tree-sitter
// or any language's grammar, so it works on any file type a builder might
// touch, including ones the code graph itself skips (YAML, Go, etc.).
//
// A marker's body can span multiple physical comment lines — a builder
// writing a longer ceiling/trigger explanation naturally wraps it across a
// few continuation lines with no `genesis:` prefix of their own. Immediately
// following lines are merged (space-joined) into the marker's body as long as
// each one is non-blank, uses the EXACT SAME comment prefix as the marker
// itself, and doesn't start a new `genesis:` marker of its own. The first
// line that fails any of those checks ends the body right there.
//
// Guard against fabricating a trigger: if merging a continuation line would
// flip noTrigger from true to false (i.e. the ONLY reason the merged body now
// parses as having a trigger is that candidate line), only accept the merge
// when the marker's own accumulated text so far still reads as mid-sentence
// (doesn't already end with terminal punctuation `.` or `:`). A marker line
// that already reads as a complete, standalone thought must not have a
// trigger fabricated onto it by an unrelated same-prefix comment that merely
// happens to contain a comma — that would mask the exact "incomplete
// genesis: marker" signal this scanner exists to surface. When the merge
// doesn't change noTrigger at all (the common case — most of a real
// multi-line explanation), it's always accepted.
function scanMarkers(source) {
  const found = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MARKER_RE);
    if (!m) continue;
    const prefix = m[1];
    const bodyParts = [m[2]];
    let j = i + 1;
    let mergedCount = 0;
    while (j < lines.length && mergedCount < MAX_CONTINUATION_LINES) {
      const line = lines[j];
      if (line.trim() === '') break; // blank line ends the body
      const trimmed = line.replace(/^\s+/, '');
      if (!trimmed.startsWith(prefix)) break; // different/no comment prefix
      if (MARKER_RE.test(line)) break; // a new genesis: marker starts fresh

      const candidateText = trimmed.slice(prefix.length).trim();
      const bodySoFar = bodyParts.join(' ');
      const beforeMerge = parseMarkerBody(bodySoFar);
      const afterMerge = parseMarkerBody(`${bodySoFar} ${candidateText}`);
      if (beforeMerge.noTrigger && !afterMerge.noTrigger) {
        const trimmedSoFar = bodySoFar.trim();
        const looksMidSentence = !!trimmedSoFar && !/[.:]$/.test(trimmedSoFar);
        if (!looksMidSentence) break; // body reads complete on its own — don't fabricate a trigger from an unrelated line
      }

      bodyParts.push(candidateText);
      mergedCount++;
      j++;
    }
    found.push({ line: i + 1, ...parseMarkerBody(bodyParts.join(' ')) });
    i = j - 1; // skip past merged continuation lines, already consumed
  }
  return found;
}

module.exports = { scanMarkers, parseMarkerBody };
