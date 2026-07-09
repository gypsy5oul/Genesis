#!/bin/bash
# Genesis — statusline reader. Prints the pre-rendered usage line written by
# hooks/usage-tracker.js after every turn. Never computes anything itself —
# no Node spawn per keystroke.
#
# Usage in ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "bash /path/to/usage-statusline.sh" }

LINE_FILE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.genesis-usage-line"

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
