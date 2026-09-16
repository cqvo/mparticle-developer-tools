#!/usr/bin/env bash
# usage: scripts/package.sh <version>   e.g. 0.2.0 or 0.1.1-nightly.20260916
set -euo pipefail
deno task build
jq --arg v "$1" '.version = ($v | split("-")[0]) | .version_name = "v\($v)"' dist/manifest.json > dist/m
mv dist/m dist/manifest.json
rm -f mparticle-developer-tools.zip
(cd dist && zip -r ../mparticle-developer-tools.zip .)
