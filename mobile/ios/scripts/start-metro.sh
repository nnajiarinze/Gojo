#!/bin/bash
# Auto-start Metro if not already running.
# Added as a pre-action in Xcode Build scheme.

export RCT_METRO_PORT="${RCT_METRO_PORT:=8081}"

# Check if Metro is already running
if nc -z localhost "$RCT_METRO_PORT" 2>/dev/null; then
  echo "Metro already running on port $RCT_METRO_PORT"
  exit 0
fi

# Resolve paths
MOBILE_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"

# Source nvm/fnm/node so we have the right node binary
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$HOME/.fnm/fnm" ] && eval "$(fnm env)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "Starting Metro in background from $MOBILE_DIR..."

# Start Metro in background, detached from Xcode
cd "$MOBILE_DIR" && npx expo start --port "$RCT_METRO_PORT" &>/dev/null &

# Wait up to 15s for Metro to be ready
for i in $(seq 1 30); do
  if nc -z localhost "$RCT_METRO_PORT" 2>/dev/null; then
    echo "Metro started successfully on port $RCT_METRO_PORT"
    exit 0
  fi
  sleep 0.5
done

echo "Warning: Metro may not have started in time, but continuing build..."
exit 0
