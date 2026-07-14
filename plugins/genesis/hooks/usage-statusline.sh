#!/bin/bash
# Genesis — statusline reader. Prints live Claude subscription rate-limit
# usage (5-hour and 7-day window percentages) straight out of the JSON
# payload Claude Code already pipes to the statusLine command on every
# render. No file I/O, no Node spawn — pure stdin parsing.
#
# Claude Code's statusline payload includes a `rate_limits` object shaped
# like:
#   { "rate_limits": {
#       "five_hour": { "used_percentage": 42, "resets_at": "..." },
#       "seven_day": { "used_percentage": 18, "resets_at": "..." }
#   } }
# (per https://code.claude.com/docs/en/statusline). Only used_percentage is
# read here — resets_at is deliberately left unparsed to avoid unportable
# `date -d` differences between GNU and BSD date.
#
# Extraction below is a minimal grep/sed pull (no jq dependency — jq isn't
# otherwise assumed anywhere in this codebase's bash scripts, and this
# script deliberately avoids spawning anything heavier than necessary).
#
# Usage in ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "bash /path/to/usage-statusline.sh" }

INPUT=$(cat)

# Isolate the compact single-line `"<key>": { ... }` sub-object for a given
# top-level rate_limits key, then pull used_percentage's raw value out of
# it. Relies on these sub-objects having no nested braces (true of the
# documented shape). Prints the raw numeric string on stdout and returns 0
# on success; returns 1 (prints nothing) if the key or field is absent.
extract_used_pct() {
  local key="$1" sub val
  # If $INPUT ever contained a duplicate "$key" occurrence, head -n1 means
  # the first one wins (documented behavior, not a bug).
  sub=$(printf '%s' "$INPUT" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*{[^}]*}" | head -n1)
  [ -z "$sub" ] && return 1
  # Require the digits to be immediately followed by a proper JSON number
  # boundary (`,`, `}`, or whitespace) so trailing garbage (e.g. `42xyz`) or
  # unsupported notation (e.g. `4.2e1`) is rejected rather than silently
  # truncated. The boundary char is captured by the match and stripped
  # back off below.
  val=$(printf '%s' "$sub" | grep -o '"used_percentage"[[:space:]]*:[[:space:]]*[0-9.]*[,}[:space:]]' | head -n1 | sed -E 's/.*:[[:space:]]*//; s/[,}[:space:]]$//')
  [ -z "$val" ] && return 1
  printf '%s' "$val"
}

# Round a validated non-negative decimal string to the nearest whole
# number using plain bash integer arithmetic (no bc/awk needed). Returns 1
# (prints nothing) if the input isn't a plain `NN` or `NN.NN` number.
round_pct() {
  local val="$1" int_part frac_part first_frac
  [[ "$val" =~ ^[0-9]+(\.[0-9]+)?$ ]] || return 1
  if [[ "$val" == *.* ]]; then
    int_part="${val%%.*}"
    frac_part="${val#*.}"
    first_frac="${frac_part:0:1}"
    [ "$first_frac" -ge 5 ] && int_part=$((int_part + 1))
  else
    int_part="$val"
  fi
  printf '%s' "$int_part"
}

FIVE_HOUR_RAW=$(extract_used_pct "five_hour") || exit 0
SEVEN_DAY_RAW=$(extract_used_pct "seven_day") || exit 0

FIVE_HOUR_PCT=$(round_pct "$FIVE_HOUR_RAW") || exit 0
SEVEN_DAY_PCT=$(round_pct "$SEVEN_DAY_RAW") || exit 0

printf '[GENESIS] 5h: %s%% | wk: %s%%' "$FIVE_HOUR_PCT" "$SEVEN_DAY_PCT"
exit 0
