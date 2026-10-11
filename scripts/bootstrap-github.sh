#!/usr/bin/env bash
# Creates labels, milestones and issues on GitHub from the files in ./issues.
#
# Prerequisites:
#   - GitHub CLI installed and authenticated:  gh auth login
#   - Run from the repo root, inside a repo that already has a GitHub remote
#   - Use a FRESH repo (no prior issues or PRs) so issue numbers match the file numbers
#
# Usage:
#   scripts/bootstrap-github.sh            # dry run (prints what it would do)
#   scripts/bootstrap-github.sh --apply    # actually create everything

set -euo pipefail

APPLY=0
if [[ "${1:-}" == "--apply" ]]; then APPLY=1; fi

run() {
  if [[ $APPLY -eq 1 ]]; then
    "$@"
  else
    printf '[dry-run] '; printf '%q ' "$@"; printf '\n'
  fi
}

# --- labels -----------------------------------------------------------------
LABELS=(
  "phase:0|ededed|Foundation"
  "phase:1|ededed|Domain kernel"
  "phase:2|ededed|Ledger"
  "phase:3|ededed|Passkeys"
  "phase:4|ededed|Agent"
  "phase:5|ededed|Settlement"
  "phase:6|ededed|Webhooks and spike"
  "phase:7|ededed|Intent mandates"
  "phase:8|ededed|Lab"
  "phase:9|ededed|Console"
  "phase:10|ededed|Evidence"
  "phase:11|ededed|Operator"
  "phase:12|ededed|MCP"
  "phase:13|ededed|Ship"
  "type:feature|0e8a16|New capability"
  "type:chore|c5def5|Maintenance and setup"
  "type:spike|fbca04|Time-boxed investigation"
  "area:domain|1d76db|Pure domain logic"
  "area:db|1d76db|Persistence"
  "area:paypal|0052cc|PayPal integration"
  "area:ai|5319e7|LLM and agents"
  "area:ui|d4c5f9|Interface"
  "area:infra|bfdadc|Tooling, CI, deploy"
  "area:security|b60205|Security-critical"
  "priority:P0|b60205|Must ship"
  "priority:P1|d93f0b|Differentiator"
  "priority:P2|fbca04|Stretch"
  "invariant-change|000000|Changes a documented invariant"
)

for entry in "${LABELS[@]}"; do
  IFS='|' read -r name color desc <<<"$entry"
  run gh label create "$name" --color "$color" --description "$desc" --force
done

# --- milestones -------------------------------------------------------------
create_milestone() {
  local title="$1" due="$2"
  run gh api "repos/{owner}/{repo}/milestones" -f title="$title" -f due_on="$due" >/dev/null || true
}
create_milestone "M1 Foundation"       "2026-10-16T23:59:00Z"
create_milestone "M2 Consent"          "2026-10-23T23:59:00Z"
create_milestone "M3 Settlement"       "2026-10-29T23:59:00Z"
create_milestone "M4 Differentiators" "2026-11-06T23:59:00Z"
create_milestone "M5 Ship"             "2026-11-10T23:59:00Z"

# --- issues -----------------------------------------------------------------
front() { # front <file> <key>
  awk -v key="$2" '
    c<2 && /^---$/ { c++; next }
    c==1 && index($0, key ":")==1 {
      sub("^" key ": *", ""); gsub(/^"|"$/, ""); print; exit
    }' "$1"
}
body() { awk 'c<2 && /^---$/ { c++; next } c>=2 { print }' "$1"; }

shopt -s nullglob
for f in issues/[0-9][0-9]-*.md; do
  num="$(basename "$f" | cut -d- -f1)"
  title="$(front "$f" title)"
  labels="$(front "$f" labels | tr -d ' ')"
  milestone="$(front "$f" milestone)"
  echo "== #$((10#$num)) $title  [$labels]  ($milestone)"
  if [[ $APPLY -eq 1 ]]; then
    body "$f" | gh issue create --title "$title" --label "$labels" --milestone "$milestone" --body-file -
  fi
done

echo
if [[ $APPLY -eq 0 ]]; then
  echo "Dry run complete. Re-run with --apply to create everything."
else
  echo "Done. Create a GitHub Project (Board) and add these issues to it."
fi
