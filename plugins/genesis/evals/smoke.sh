#!/usr/bin/env bash
# Smoke test for the deterministic layer: state + hooks end-to-end.
set -euo pipefail
PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }

# 1. simulate init
mkdir -p "$DIR/docs/sdlc"
cat > "$DIR/docs/sdlc/state.json" <<'EOF'
{
  "project": "smoke", "idea": "url shortener", "createdAt": "2026-07-08",
  "currentStage": "requirements",
  "stages": {
    "requirements": { "status": "awaiting-approval", "artifact": "docs/sdlc/01-requirements.md" },
    "feasibility": { "status": "pending" }, "plan": { "status": "pending" },
    "design": { "status": "pending" }, "develop": { "status": "pending" },
    "test": { "status": "pending" }, "uat": { "status": "pending" },
    "deploy": { "status": "pending" }, "monitor": { "status": "pending" },
    "maintain": { "status": "pending" }
  },
  "decisions": []
}
EOF

hook() { echo "{\"cwd\":\"$DIR\",\"prompt\":\"$1\"}" | node "$PLUGIN/hooks/sdlc-prompt-hook.js"; }

# 2. status renders board
hook "/genesis:status" | grep -q "awaiting-approval" || fail "status board missing pending stage"
# 3. question is not approval
hook "should I approve requirements?" >/dev/null
grep -q '"status": "awaiting-approval"' "$DIR/docs/sdlc/state.json" || fail "question mutated state"
# 4. ordinary prompt gets reminder
hook "hello" | grep -q "awaiting approval" || fail "no gate reminder"
# 5. approve flips state
hook "approve requirements" | grep -q "approved" || fail "approval not confirmed"
grep -q '"status": "approved"' "$DIR/docs/sdlc/state.json" || fail "approval did not mutate state"
# 6. approving non-awaiting stage refuses without mutation
hook "approve design" | grep -q "not awaiting-approval" || fail "wrong-stage approval not refused"
# 7. session-start injects summary
echo "{\"cwd\":\"$DIR\"}" | node "$PLUGIN/hooks/sdlc-session-start.js" | grep -q "smoke" || fail "session summary missing"

echo "SMOKE OK"
