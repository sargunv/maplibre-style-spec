# Design Proposal: Add a camera input for ground-scale styling

## Motivation

Zoom expressions allow styles to scale line widths, circle radii, and other dimensions as the map zooms. However, maintaining an approximate real-world size in Mercator also requires latitude: at the same zoom, the number of pixels per ground meter increases toward the poles.

For example, a road drawn with a width representing 10 meters near the equator should become twice as wide in pixels when the map center moves to 60° latitude at the same zoom. Base-2 zoom interpolation handles the zoom dependence, but expressions have no built-in input for the current map center latitude.

Applications can supply latitude themselves, or data producers can attach a representative latitude to every feature. A camera scale or latitude input would let a portable style express this behavior without application camera listeners or changes to source data.

## Proposed Change

The prototype implements two inputs so their authoring and renderer costs can be compared. The choice of which input to propose upstream remains open; `scale` is the more direct fit for ground-sized styling.

### Preferred alternative to evaluate: scale

```json
["scale"]
```

Define scale as nominal ground resolution at the map center, in **meters per CSS pixel** (logical pixels on Native), not a device-pixel ratio or an unspecified zoom multiplier. Smaller numbers mean a closer view. For an unpitched Mercator view:

```text
scale = 2 × π × R × cos(latitude) / (512 × 2^zoom)
```

A 10-meter line width becomes:

```json
{"line-width": ["/", 10, ["scale"]]}
```

For an area `A` in square meters, a circle radius is `sqrt(A / π) / scale`. Existing style curves can also be made scale-based: if `S0` is meters per pixel at zoom 0 at a chosen reference latitude, substitute `log2(S0 / scale)` for their zoom input. This evaluates the original curve at the equivalent ground scale. Multiplying its outputs by a latitude factor is not equivalent for a general nonlinear curve.

Changing cities while preserving scale means adjusting camera zoom by `log2(cos(newLatitude) / cos(oldLatitude))`. The demo now does this, subject to camera zoom limits. Equal-scale views then retain equal pixel widths in the enhanced map, while the standard style still follows its original zoom rules.

`scale` must be usable in arithmetic and as an interpolation input. Giving it the existing top-level-only restriction of `zoom` would prevent the simple division example. It must invalidate dependent expressions on zoom or latitude changes. Like latitude, source-dependent paint and layout require additional renderer work; the prototype rebuilds affected tiles asynchronously. Camera-only paint uses uniforms.

The prototype computes **nominal Mercator scale**, independent of pitch, bearing and terrain. Before accepting projection-independent semantics, the proposal must define the reference surface and behavior for globe, pitch and terrain: actual screen-space ground resolution can vary by direction and need not be one scalar. A more explicit operator name such as `meters-per-pixel` is also worth considering.

This alternative exposes one derived camera input; it does not require changing property units. It avoids embedding Earth radius and projection math in every style. It also avoids the zoom-expression restriction that prevents composing `zoom` and latitude into an arbitrary scale-based interpolation today.

### Original alternative: latitude

Add a zero-argument numeric expression:

```json
["latitude"]
```

It returns the geographic latitude of the current map center in degrees, positive north and negative south, in the range −90 to 90. “Map center” means the geographic center exposed by the renderer's camera API, including its padding semantics; it does not mean the position of the camera above the ground, a feature location, or a tile center.

The value is shared by all features in a render frame and reflects the renderer's actual constrained camera state. Its meaning is the same for Mercator and globe projections. The expression itself does not clamp latitude to Mercator's supported range.

### Expression use and updates

Allow `latitude` in paint and layout properties that support camera expressions through `zoom`. It can appear in arithmetic, conditions, interpolation inputs, and interpolation outputs, including outputs of a zoom interpolation. It has no top-level interpolation restriction of its own. Existing restrictions on `zoom` remain unchanged.

Expressions depending on latitude must update when the map center latitude changes, including during a pan or animation at constant zoom. Latitude is continuous and is not rounded to integer degrees. Layout properties must also be invalidated by latitude changes; their existing integer-zoom evaluation rules still apply to the zoom input.

Camera latitude dependencies must not be constant-folded or retained in caches that only invalidate when zoom changes. This also applies to expressions combining latitude with feature properties.

This proposal does not enable latitude in filters, cluster aggregation, or other source-processing expressions.

### Example: approximately 10-meter road width

For an unpitched Mercator map, using a spherical Earth radius `R`, the local conversion at the map center is:

```text
width_pixels = width_meters × 512 × 2^zoom / (2 × π × R × cos(latitude))
```

The following proposed expression uses `R = 6371008.8` meters and base-2 interpolation over zooms 0–24:

```json
{
  "line-width": [
    "let", "width-at-zero",
    ["/", 5120,
      ["*", 2, ["pi"], 6371008.8,
        ["cos", ["*", ["/", ["pi"], 180],
          ["max", -85.05112878, ["min", 85.05112878, ["latitude"]]]
        ]]
      ]
    ],
    ["interpolate", ["exponential", 2], ["zoom"],
      0, ["var", "width-at-zero"],
      24, ["*", 16777216, ["var", "width-at-zero"]]
    ]
  ]
}
```

The latitude clamp belongs to this Mercator-specific example and prevents the conversion from becoming singular at the poles. Values outside the interpolation's zoom range remain clamped to its endpoint outputs.

The same conversion can be used for circle radii. To represent an area `A` in square meters, first calculate a ground radius of `sqrt(A / π)`, then convert that length to pixels.

### Accuracy and scope

Using map center latitude approximates ground dimensions near the center. It does not account for latitude varying across the viewport or along a feature. In particular, the same feature can change pixel width when the map pans north or south at constant zoom.

The example's conversion does not guarantee ground dimensions under pitch, globe projection, or terrain. The proposed input exposes camera state; it does not change property units or rendering geometry.

## API Modifications

- Add the selected input (`scale` or `latitude`) to the expression specification, documentation, validation, and generated expression APIs. The experimental fork currently includes both for comparison.
- Add the corresponding camera value to expression evaluation globals and track its dependencies independently of the existing zoom/feature classification.
- Have GL JS and Native supply the selected value and invalidate dependent paint and layout evaluations when it changes. Scale depends on both zoom and latitude in the Mercator prototype.
- Record SDK support separately as implementations become available. Tests should cover signed degrees, constant-zoom panning, zoom/latitude/feature combinations, and the equator-to-60° width ratio.

No new public camera setter or change to existing style property units is required. Standalone expression evaluators must supply the selected input when evaluating an expression that uses it. Missing values must produce an evaluation error; scale must be finite and positive.

## Migration Plan and Compatibility

This is an additive expression. Existing styles retain their current behavior and require no migration. Styles using the new input require a renderer version that supports it; older renderers will reject the unknown expression.

Applications currently injecting camera latitude may replace that input with `["latitude"]`. Feature-provided latitude remains useful when the intended reference is a feature's location rather than the map center.

## Rejected Alternatives

- **Application-supplied camera latitude:** Works, but requires each application to maintain camera listeners and inject state or rewrite expressions. The proposed input makes this behavior part of the style.
- **Latitude or a scale factor in feature properties:** Useful for local sizing, but requires control over the data and a representative location for each feature. It does not expose camera latitude.
- **A feature or per-vertex latitude expression:** Addresses a different evaluation context. Lines and polygons do not have one unambiguous latitude, and per-vertex evaluation needs additional renderer support.
- **Explicit meter units:** Could provide stronger ground-sizing semantics, but requires decisions about local scale, projection, perspective, and terrain. Those capabilities can be considered separately from exposing this camera input.
- **Buffering lines into polygons:** Appropriate when the physical footprint must be represented by geometry, but requires generating and maintaining different source data for a styling use case.
