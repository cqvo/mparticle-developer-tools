#!/usr/bin/env bash
# usage: scripts/release-notes.sh <tag> <sha> [previous-tag]
set -euo pipefail
gh api 'repos/{owner}/{repo}/releases/generate-notes' -f tag_name="$1" -f target_commitish="$2" \
  ${3:+-f previous_tag_name="$3"} --jq .body
