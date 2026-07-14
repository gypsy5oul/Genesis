#!/bin/bash
# Genesis — statusline reader. Prints the pre-rendered usage line written by
# hooks/usage-tracker.js after every turn. Never computes anything itself —
# no Node spawn per keystroke.
#
# Claude Code invokes the statusLine command with a JSON payload on stdin
# that includes a session_id "stable for the lifetime of a session and
# unique per session" (per https://code.claude.com/docs/en/statusline).
# The line file is scoped by that session_id so concurrent sessions never
# read/show each other's usage. Extraction below is a minimal grep/sed
# single-field pull (no jq dependency — jq isn't otherwise assumed anywhere
# in this codebase's bash scripts, and this script deliberately avoids
# spawning anything heavier than necessary).
#
# Usage in ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "bash /path/to/usage-statusline.sh" }

INPUT=$(cat)

# Pull the session_id value out of the top-level JSON payload without a jq
# dependency: match `"session_id"` followed by `:` then a quoted string,
# capture the string body. Restrict the captured value to a safe
# filename-component charset (alphanumeric, hyphen, underscore) — it came
# from an external payload and is about to be interpolated into a path.
RAW_SESSION_ID=$(printf '%s' "$INPUT" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')
SESSION_ID=$(printf '%s' "$RAW_SESSION_ID" | tr -cd 'A-Za-z0-9_-')

[ -z "$SESSION_ID" ] && exit 0

LINE_FILE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.genesis-usage-line.$SESSION_ID"

# Refuse symlinks — a local attacker could point this at an arbitrary file
# and have its bytes (including ANSI escapes) rendered to the terminal.
[ -L "$LINE_FILE" ] && exit 0
[ ! -f "$LINE_FILE" ] && exit 0

# Hard-cap the read and strip control/escape bytes — blocks terminal-escape
# injection via the line file's contents.
CONTENT=$(head -c 256 "$LINE_FILE" 2>/dev/null | tr -d '\000-\037')

if [ -n "$CONTENT" ]; then
  printf '%s' "$CONTENT"
fi
exit 0
