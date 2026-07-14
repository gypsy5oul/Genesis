#!/bin/bash
# Genesis — statusline reader. Prints live Claude subscription rate-limit
# usage (5-hour and 7-day window percentages, as text progress bars) plus
# the current model name, straight out of the JSON payload Claude Code
# already pipes to the statusLine command on every render. No file I/O, no
# Node spawn — pure stdin parsing.
#
# Output format:
#   [GENESIS] <model_name> | 5h Usage [<bar>] <pct>% | Weekly Usage [<bar>] <pct>%
# (the "<model_name> | " prefix is omitted entirely if model.display_name is
# absent/unparseable — see extract_model_name).
#
# Claude Code's statusline payload includes a `rate_limits` object shaped
# like:
#   { "rate_limits": {
#       "five_hour": { "used_percentage": 42, "resets_at": "..." },
#       "seven_day": { "used_percentage": 18, "resets_at": "..." }
#   },
#   "model": { "id": "claude-sonnet-5", "display_name": "Sonnet 5" } }
# (per https://code.claude.com/docs/en/statusline). Only used_percentage and
# model.display_name are read here — resets_at is deliberately left
# unparsed to avoid unportable `date -d` differences between GNU and BSD
# date.
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

# Isolate the compact single-line `"model": { ... }` sub-object, then pull
# display_name's string value out of it. Same two-stage pattern as
# extract_used_pct, but display_name is a JSON string, not a number, so the
# inner match captures a quoted string body instead of a bare number.
# Prints the raw string on stdout and returns 0 on success; returns 1
# (prints nothing) if the object, field, or a non-empty string value is
# absent.
extract_model_name() {
  local sub name
  sub=$(printf '%s' "$INPUT" | grep -o '"model"[[:space:]]*:[[:space:]]*{[^}]*}' | head -n1)
  [ -z "$sub" ] && return 1
  # The value char class excludes backslash as well as the closing quote,
  # so any backslash-escape sequence inside the string (an escaped quote
  # \", an escaped backslash \\, or any other JSON escape) prevents the
  # match entirely rather than truncating at the first escaped char —
  # same fail-safe posture as extract_used_pct's numeric boundary check.
  name=$(printf '%s' "$sub" | grep -o '"display_name"[[:space:]]*:[[:space:]]*"[^"\\]*"' | head -n1 | sed -E 's/.*:[[:space:]]*"//; s/"$//')
  [ -z "$name" ] && return 1
  printf '%s' "$name"
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

# Render a `pct` (whole 0-100 integer) as a `width`-character text bar of
# filled block (█) and empty block (░) characters. The filled segment count
# is rounded to the nearest whole character via integer arithmetic
# (pct*width + 50) / 100 — e.g. 45% at width 10 -> (450+50)/100 = 5 filled,
# not 4, so half-character-and-above rounds up. Clamped to [0, width] so
# out-of-range pct can't over/under-fill.
render_bar() {
  local pct="$1" width="$2" filled empty i bar
  filled=$(( (pct * width + 50) / 100 ))
  [ "$filled" -lt 0 ] && filled=0
  [ "$filled" -gt "$width" ] && filled=$width
  empty=$((width - filled))
  bar=""
  for ((i = 0; i < filled; i++)); do bar+="█"; done
  for ((i = 0; i < empty; i++)); do bar+="░"; done
  printf '%s' "$bar"
}

FIVE_HOUR_RAW=$(extract_used_pct "five_hour") || exit 0
SEVEN_DAY_RAW=$(extract_used_pct "seven_day") || exit 0

FIVE_HOUR_PCT=$(round_pct "$FIVE_HOUR_RAW") || exit 0
SEVEN_DAY_PCT=$(round_pct "$SEVEN_DAY_RAW") || exit 0

MODEL_NAME=$(extract_model_name)
MODEL_PREFIX=""
[ -n "$MODEL_NAME" ] && MODEL_PREFIX="$MODEL_NAME | "

FIVE_HOUR_BAR=$(render_bar "$FIVE_HOUR_PCT" 10)
SEVEN_DAY_BAR=$(render_bar "$SEVEN_DAY_PCT" 10)

printf '[GENESIS] %s5h Usage [%s] %s%% | Weekly Usage [%s] %s%%' \
  "$MODEL_PREFIX" "$FIVE_HOUR_BAR" "$FIVE_HOUR_PCT" "$SEVEN_DAY_BAR" "$SEVEN_DAY_PCT"
exit 0
