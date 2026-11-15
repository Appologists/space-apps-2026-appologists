#!/usr/bin/env bash
# Keeps this computer up to date with GitHub: every minute it pulls the team's newest main.
# Open pages (/, /classic, /learn) see the new commit and reload themselves (public/live-sync.js).
# start.sh runs this for you. To run it alone: ./sync.sh
# It never merges or overwrites your own changes: if a pull cannot fast-forward, it says so and waits.
SECONDS_BETWEEN="${1:-60}"
cd "$(dirname "$0")/.." || exit 1
echo "Sync: pulling origin/main into $(pwd) every ${SECONDS_BETWEEN} s. Ctrl+C to stop."
while true; do
    before=$(git rev-parse HEAD 2>/dev/null)
    if git pull --ff-only --quiet origin main >/dev/null 2>&1; then
        after=$(git rev-parse HEAD 2>/dev/null)
        if [ "$after" != "$before" ]; then
            echo "$(date +%H:%M) Sync: updated to ${after:0:7}. Open pages reload by themselves."
        fi
    else
        echo "$(date +%H:%M) Sync: could not fast-forward (you may have local changes). Nothing was changed."
    fi
    sleep "$SECONDS_BETWEEN"
done
