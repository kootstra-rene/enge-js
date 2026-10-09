#!/bin/sh
set -eu

BUNDLER_URL="${BUNDLER_URL:-https://localhost:8443}"

build_bundle() {
  unit="$1"
  output="$2"
  temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/enge-bundle.XXXXXX")
  trap 'rm -rf "$temp_dir"' EXIT INT TERM

  curl --insecure --fail --silent --show-error \
    "$BUNDLER_URL/bundler/node?unit=$unit" \
    -o "$temp_dir/bundle.gz"
  gzip -t "$temp_dir/bundle.gz"
  gzip -dc "$temp_dir/bundle.gz" > "$temp_dir/bundle.js"
  test -s "$temp_dir/bundle.js"
  mv "$temp_dir/bundle.js" "$output"

  trap - EXIT INT TERM
  rm -rf "$temp_dir"
}

build_bundle 'enge:psx:webgl2' docs/index-webgl2.js
build_bundle 'enge:psx:webgl' docs/index.js
