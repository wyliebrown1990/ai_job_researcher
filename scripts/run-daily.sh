#!/bin/bash
# Daily runner for the AI industry research loop. Invoked by launchd (see
# deploy/com.ajr.daily.plist) at 7:00 AM local, or run manually.
# Self-contained: sets PATH (launchd has a minimal env), cd's to the repo, loads
# .env via bun, runs the loop, and appends output to logs/daily.log.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# launchd runs with a bare PATH — add common bun/homebrew locations.
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

mkdir -p logs
STAMP="$(date '+%Y-%m-%d %H:%M:%S')"
{
  echo "===== $STAMP — daily run ====="
  bun run scan run
  echo
} >> logs/daily.log 2>&1
