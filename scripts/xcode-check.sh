#!/usr/bin/env bash
# Print active Xcode version and path. Optional: require minimum Xcode version (e.g. 16.0).
# Usage: ./scripts/xcode-check.sh [min_version]
#   min_version: optional, e.g. 16.0; exit 1 if xcodebuild -version is below this.

set -e

echo "Active Xcode path: $(xcode-select -p)"
echo "Xcode version:"
xcodebuild -version

if [ -n "${1:-}" ]; then
  min="$1"
  # Parse first line of xcodebuild -version (e.g. "Xcode 16.2")
  actual=$(xcodebuild -version | head -1 | sed -n 's/^Xcode \([0-9]*\.[0-9]*\).*/\1/p')
  if [ -z "$actual" ]; then
    echo "Could not parse Xcode version." >&2
    exit 2
  fi
  # Simple numeric comparison: compare major.minor (e.g. 16.2 >= 16.0)
  if [ "$(printf '%s\n%s\n' "$min" "$actual" | sort -V | head -1)" != "$min" ] && [ "$actual" != "$min" ]; then
    echo "Xcode $actual is below required $min." >&2
    exit 1
  fi
  echo "Xcode $actual meets minimum $min."
fi
