# Local validation — 2026-09-15

- Style spec: 650 unit tests, 2,226 integration tests, 15 packaging tests; typecheck and lint passed.
- GL JS: 3,346 unit tests and 730 packaging tests; typecheck and lint on changed files passed.
- A clean build using `build.sh` succeeded from the pinned upstream renderer and packed style-spec patch.
- Chrome 153: both OFM comparison modes loaded without page or map errors; cameras stayed synchronized in both directions, including zoom, bearing and pitch; the left map's layers matched the original Bright snapshot; the 390 px mobile layout had no horizontal overflow.
- Actual canvas pixels, at fixed zoom: a camera-sized 10 px line measured 10 px at 0°, 20 px at 60°, 20 px at −60°, and 10 px after returning to 0°. Feature-driven widths passed the same sequence. A feature-state increment at 60° produced 28 px as expected. Latitude-dependent symbol layout measured 10, 20, 20 and 10 px over the same camera sequence.
- Relative to the renderer's recorded bundle-size fixture, main + shared bundles grow by 2,276 bytes raw / 732 bytes gzip. Worker entry size is unchanged.

These are local source, package and browser results, not upstream CI or Native validation. Layout and feature-paint changes rebuild tiles asynchronously; this experiment does not establish their performance during continuous panning over a large dataset. It also does not claim exact ground dimensions under pitch, globe or terrain.
