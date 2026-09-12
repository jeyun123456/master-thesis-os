#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEST="$ROOT/gradle/wrapper/gradle-wrapper.jar"
URL="https://services.gradle.org/distributions/gradle-8.13-wrapper.jar"
EXPECTED="81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f"
TMP="$DEST.tmp"

mkdir -p "$(dirname "$DEST")"
curl --fail --location "$URL" --output "$TMP"
ACTUAL=$(sha256sum "$TMP" | awk '{print $1}')
if [ "$ACTUAL" != "$EXPECTED" ]; then
  rm -f "$TMP"
  echo "Gradle wrapper JAR checksum mismatch." >&2
  echo "Expected: $EXPECTED" >&2
  echo "Actual:   $ACTUAL" >&2
  exit 1
fi
mv "$TMP" "$DEST"
echo "Installed verified Gradle 8.13 wrapper JAR."
