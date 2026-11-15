#!/usr/bin/env bash
# Lunar Site Planner: set up (first time) and start. Run from this folder: bash start.sh
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
    echo "Creating Python environment (.venv)..."
    python3 -m venv .venv
fi
PY=.venv/bin/python
echo "Installing packages..."
"$PY" -m pip install --quiet --disable-pip-version-check -r requirements.txt
if [ ! -f lunar_keys.json ]; then
    cp lunar_keys.example.json lunar_keys.json
    echo "Made lunar_keys.json. Add your Cesium ion token and Google Maps key there (optional)."
fi
if [ ! -f data/ldem_16.npy ]; then
    echo "Downloading NASA LOLA terrain once (66 MB)..."
    "$PY" build_terrain.py
fi
if [ ! -f ../data/raw/lola-south-80s-80m/ldem_80s_80m.img ]; then
    echo "Downloading the NASA LOLA 80 m south-pole grid once (115 MB), for the landing-site finder..."
    "$PY" fetch_data.py lola-south-80s-80m || echo "That download failed. The app still runs on the 1.9 km whole-Moon data."
fi
# Live sync: pull the team's newest main from GitHub every minute; open pages reload themselves.
# Run with NOSYNC=1 ./start.sh to leave it out.
if [ -z "$NOSYNC" ] && command -v git >/dev/null; then
    bash ./sync.sh >/tmp/lunar-sync.log 2>&1 &
    SYNC_PID=$!
    trap 'kill $SYNC_PID 2>/dev/null' EXIT
    echo "Live sync is on (log: /tmp/lunar-sync.log)."
fi
( sleep 2; (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:8002) || (command -v open >/dev/null && open http://127.0.0.1:8002) || true ) &
"$PY" lunar_server.py
