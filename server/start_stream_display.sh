#!/usr/bin/env bash
set -e

echo "=== Starting Virtual Display :99 ==="
# Kill existing Xvfb on :99 if any
killall Xvfb 2>/dev/null || true
sleep 1

# Start Xvfb in 1080p 24-bit with GLX
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
export DISPLAY=:99
sleep 2

echo "=== Starting Chromium in Kiosk Stream Mode ==="
killall chromium-browser 2>/dev/null || true
sleep 1

chromium-browser \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu-sandbox \
  --no-first-run \
  --no-default-browser-check \
  --disable-fre \
  --disable-search-engine-choice-screen \
  --disable-features=Translate \
  --enable-webgl \
  --ignore-gpu-blocklist \
  --window-size=1920,1080 \
  --window-position=0,0 \
  --kiosk \
  --autoplay-policy=no-user-gesture-required \
  "http://127.0.0.1:3000/?broadcast=1" &

echo "=== Stream Display Ready on :99 ==="
