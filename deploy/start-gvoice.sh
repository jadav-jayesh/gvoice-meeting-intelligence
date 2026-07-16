#!/usr/bin/bash
# start-gvoice.sh — launch the virtual display + PulseAudio, then the gVoice
# API+worker process. Invoked by the gvoice.service systemd unit, which supplies
# DISPLAY=:99, XDG_RUNTIME_DIR=/run/user/1000, APP_DIR and the .env EnvironmentFile.
#
# Reconstructed 2026-07-14 after the original was removed by a deploy
# `rsync --delete` (the file is not tracked in git). Keep a copy in git next time.
set -u

APP_DIR="${APP_DIR:-/home/azureuser/gvoice}"
export DISPLAY="${DISPLAY:-:99}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"

cd "$APP_DIR"

# PulseAudio needs a writable per-user runtime dir.
mkdir -p "$XDG_RUNTIME_DIR" 2>/dev/null || true

# 1) Virtual display for the headed Chromium meeting bots.
if ! pgrep -f "Xvfb ${DISPLAY}" >/dev/null 2>&1; then
  Xvfb "$DISPLAY" -screen 0 1920x1080x24 -nolisten tcp &
  # Wait (best-effort) for the display to accept connections.
  for _ in $(seq 1 20); do
    if command -v xdpyinfo >/dev/null 2>&1; then
      xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
    else
      sleep 0.5; break
    fi
    sleep 0.5
  done
fi

# 2) PulseAudio daemon. Per-session null sinks are created by the app itself
#    (AUDIO_CAPTURE_PER_SESSION_SINK) via pactl, so we only need the daemon up.
if ! pactl info >/dev/null 2>&1; then
  pulseaudio --start --exit-idle-time=-1 >/dev/null 2>&1 || true
  sleep 1
fi

# 3) Run the API + in-process worker. exec so systemd tracks node as the main PID.
exec node dist/index.js
