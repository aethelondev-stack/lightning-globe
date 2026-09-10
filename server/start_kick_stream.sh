#!/usr/bin/env bash
set -e

# Kick RTMP Stream Key & Endpoint
KICK_RTMP_URL="rtmps://fa723fc1b171.global-contribute.live-video.net:443/app/sk_us-west-2_UXPHD15MmntC_fidkxCfWIkGrTA1gU1pAftvvaay94p"

echo "=== Starting 24/7 Live Stream to Kick ==="
echo "Display: :99.0 (1920x1080 @ 30fps)"
echo "Target: ${KICK_RTMP_URL}"

export DISPLAY=:99

# Capture X11 screen + silent stereo audio, encode H.264 high quality, stream via RTMP
ffmpeg -y \
  -f x11grab -draw_mouse 0 -s 1920x1080 -r 30 -i :99.0 \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
  -c:v libx264 -preset veryfast -tune zerolatency -b:v 4500k -maxrate 4500k -bufsize 9000k \
  -pix_fmt yuv420p -g 60 -keyint_min 60 \
  -c:a aac -b:a 128k -ar 44100 \
  -f flv "${KICK_RTMP_URL}"
