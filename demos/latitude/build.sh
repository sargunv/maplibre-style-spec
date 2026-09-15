#!/usr/bin/env bash
set -euo pipefail

# Rebuild the experiment from this style-spec checkout and a pinned renderer.
spec_root="$(cd "$(dirname "$0")/../.." && pwd)"
demo_dir="$spec_root/demos/latitude"
renderer_commit=dda75ad45d7e9d19f56af30da37780e28bc43a33
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/latitude-build.XXXXXX")"
trap 'rm -rf "$build_dir"' EXIT

cd "$spec_root"
npm ci
npm run build
npm pack --pack-destination "$build_dir"
git init -q "$build_dir/renderer"
cd "$build_dir/renderer"
git remote add origin https://github.com/maplibre/maplibre-gl-js.git
git fetch --depth 1 origin "$renderer_commit"
git checkout -q --detach FETCH_HEAD
git apply "$demo_dir/renderer.patch"
npm ci
# Install the packed patch without re-resolving or upgrading the renderer's lockfile.
rm -rf node_modules/@maplibre/maplibre-gl-style-spec
mkdir -p node_modules/@maplibre/maplibre-gl-style-spec
tar -xzf "$build_dir"/*.tgz -C node_modules/@maplibre/maplibre-gl-style-spec --strip-components=1
npm run codegen
npm run build-dist
mkdir -p "$demo_dir/assets"
cp dist/maplibre-gl{,-worker,-shared}.mjs dist/maplibre-gl.css "$demo_dir/assets/"
cp LICENSE.txt "$demo_dir/assets/MAPLIBRE-LICENSE.txt"
cd "$spec_root"
node demos/latitude/write-build-info.mjs "$renderer_commit"
