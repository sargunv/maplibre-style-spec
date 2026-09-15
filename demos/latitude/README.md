# Camera latitude experiment

Two synchronized maps compare an unchanged snapshot of OpenFreeMap Bright with latitude-aware road styling. Both maps use the same patched GL JS renderer. No application code injects latitude into the style or rewrites widths on camera moves.

- **Constant ground widths:** base-2 zoom interpolation and a cosine latitude correction. Widths are estimates by road class, not measurements from OpenStreetMap: paths 2 m, tracks 3 m, service roads 5 m, local streets and links 7 m, secondary/tertiary roads 12 m, primary/trunk roads 16 m, motorways 22 m. Casings add 2 m.
- **Bright + latitude correction:** preserves each original zoom curve and multiplies width outputs by `cos(45°) / cos(latitude)`. The two styles match at 45°. This mode isolates latitude correction and does not promise constant ground size while zooming.

The change applies to road strokes, casings, bridges, tunnels and paths. Other basemap layers retain Bright's styling. Map-center scale is an approximation for a flat Mercator view, not exact sizing everywhere on a globe or under perspective and terrain.

## Build and run

Use Node 24 and npm 11. From the style-spec repository root:

```sh
./demos/latitude/build.sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open <http://127.0.0.1:8765/demos/latitude/>. The build script packs the current style-spec checkout, fetches GL JS at the exact commit below, applies `renderer.patch`, and builds both main-thread and worker bundles. It preserves the renderer dependency lockfile. Generated assets and build metadata are ignored by the source branch.

Renderer base: `dda75ad45d7e9d19f56af30da37780e28bc43a33` (GL JS 6.9.1). The checked-in patch contains the renderer changes and focused tests; apply it to that commit to inspect or test the implementation independently. `build-info.json` records the spec commit and hashes of the patch, style and built entry bundle.

## Implementation

The spec adds `latitude` to numeric expressions and evaluation globals, prevents constant folding, preserves latitude when global state is merged, and exposes an independent `isLatitudeDependent` flag. The existing expression `kind` continues to describe zoom/feature dependency. Latitude is accepted where camera expressions are supported and rejected in filters and cluster expressions. The SDK support table is intentionally empty: this experimental fork does not claim an upstream release or Native implementation.

GL JS passes the camera's latitude to paint/layout evaluation and schedules reevaluation when it changes, including pans at fixed zoom. The main style retains the original expression. Worker layer snapshots bind latitude to a number, so existing tile-building code can evaluate feature and layout expressions without a new worker-global protocol. Feature-state updates retain the current evaluation latitude.

Camera-only paint values use uniforms and require no tile rebuild. Latitude-dependent layout or feature paint requires rebuilding affected source tiles. That path is asynchronous and may lag during continuous movement; it is functional but more expensive than camera-only paint. The Bright comparison uses camera-only expressions. Per-frame, feature-dependent camera evaluation would warrant a separate renderer optimization before broad production use.

## Verify

From this repository root, after building, with a GL JS checkout containing its installed test dependencies:

```sh
CHROME_BIN=/path/to/chrome node demos/latitude/verify.mjs /path/to/maplibre-gl-js
```

An optional third argument selects a deployed demo URL. The browser test checks both sizing modes, synchronization in both directions, unchanged baseline layers, mobile overflow, and rendered pixel widths at 0°, 60° and −60°. It also exercises feature-driven paint, feature-state changes, cached tile revisits and symbol layout. Screenshots and JSON results are saved in the ignored `test-results/` directory. The small readout evaluator is only for captions; rendered-pixel tests verify the actual patched renderer independently.

## Publish

The fork's existing `gh-pages` root contains inherited style-spec documentation. Preserve those files. Copy `demos/index.html` to `experiments/index.html`, and this directory (including generated `assets/` and `build-info.json`, excluding `test-results/`) to `experiments/latitude/` on `gh-pages`. Configure Pages to publish the root of that branch. Future demos can use sibling directories under `experiments/`.

## Sources and licenses

`bright.json` is the unchanged style returned by <https://tiles.openfreemap.org/styles/bright>, saved on 2026-09-15 UTC. Tiles, fonts and sprites are loaded from OpenFreeMap at runtime; their availability is required. Each map retains the supplied OpenFreeMap, OpenMapTiles and OpenStreetMap attribution. The Bright style derives from the BSD-licensed [OpenMapTiles OSM Bright style](https://github.com/openmaptiles/osm-bright-gl-style). The renderer bundle retains its license banner and includes `assets/MAPLIBRE-LICENSE.txt`.

This experiment and its renderer patch were developed with AI assistance and verified with the checks described above.
