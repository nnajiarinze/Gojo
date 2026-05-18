#!/bin/bash
# Auto-start Metro if not already running.
# Added as a pre-action in Xcode scheme.

export RCT_METRO_PORT="${RCT_METRO_PORT:=8081}"

# Check if Metro is already running
if nc -z localhost "$RCT_METRO_PORT" 2>/dev/null; then
  echo "Metro already running on port $RCT_METRO_PORT"
  exit 0
fi

# Resolve mobile directory (script is at ios/scripts/start-metro.sh)
MOBILE_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"

echo "Metro not running. Starting in Terminal.app from $MOBILE_DIR..."

# Open a real Terminal window with full user environment (nvm, homebrew, etc.)
osascript -e "
tell application \"Terminal\"
  activate
  do script \"cd $MOBILE_DIR && npx expo start --port $RCT_METRO_PORT --host lan\"
end tell
"

# Wait up to 30s for Metro to be ready
for i in $(seq 1 60); do
  if nc -z localhost "$RCT_METRO_PORT" 2>/dev/null; then
    echo "Metro started successfully on port $RCT_METRO_PORT"
    exit 0
  fi
  sleep 0.5
done

echo "Warning: Metro may not have started in time, but continuing build..."
exit 0
