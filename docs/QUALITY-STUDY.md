# Motion and edge comparison

This is a development study, not an installable release. Its generated files
stay outside the pet bundles and are ignored by Git. Building or viewing the
study does not install pets, change Codex settings, or update existing pets.

## Run the comparison

From the repository root:

```sh
npm ci
node scripts/build-quality-lab.mjs
npm run preview
```

Open [the quality comparison](http://127.0.0.1:4173/preview/quality-lab/index.html).
Both themes appear together. Stop the preview with Control-C when finished.
Building all candidate frames and lossless animations can take several minutes.

For one experiment at a time:

```sh
node scripts/build-quality-lab.mjs --control
node scripts/build-quality-lab.mjs --exact-60hz
node scripts/build-quality-lab.mjs --coverage
```

To regenerate the complete four-way comparison from scratch, run:

```sh
node scripts/build-quality-lab.mjs
node scripts/build-quality-lab.mjs --coverage
node scripts/build-quality-lab.mjs --catalog-only
```

The default build includes the first two experiments. The coverage experiment
is separate so changes to motion and rasterization can be assessed independently.
Refresh the comparison page after a build. To refresh its catalog without
rendering again, use `node scripts/build-quality-lab.mjs --catalog-only`.

## What each candidate changes

| Candidate | Timeline | Raster | Purpose |
| --- | --- | --- | --- |
| Checkpoint | 30 phases, 990 ms | Legacy renderer | Frozen comparison reference |
| Same-loop control | 60 phases, 990 ms | Legacy renderer | Adds intermediate poses while preserving every frozen pose at even phases |
| Exact one-second loop | 60 phases, 1,000 ms | Legacy renderer | Separates display cadence from the original loop length |
| Area coverage | 60 phases, 1,000 ms | Materialized supersampling | Tests edge coverage without negative-lobed filter ringing |

Integer-millisecond frame durations are derived from cumulative timestamps,
not individually rounded. A 60-phase, 990 ms loop is about 60.61 phases per
second; it must not be described as exactly 60 fps. The one-second experiment
uses forty 17 ms frames and twenty 16 ms frames.

The frozen checkpoint is generated deterministically from the continuous pose samplers and
legacy renderer; it is never copied from the current pet bundles. Its ordered
decoded-frame hashes are sealed in code, so changing the shipping frame count
or renderer cannot silently redefine the reference. Generation stops if any of
the sixty theme/frame reference hashes changes.

## How to judge it

1. Start with native playback and inspect idle, working, travel, and eye changes
   on both surfaces. Native animations have independent image clocks.
2. Choose **Pause and inspect** to compare the same encoded timeline time. All
   four inspection images must decode before the displayed comparison changes.
3. Compare the default size and 96 px. At a device-pixel ratio of two, 96 px maps
   one atlas cell to its native 192 × 208 device pixels. This is a supported
   host-size comparison, not a size setting the pet package can enforce.
4. Check the silhouette, eyes, solid colors, semi-transparent edges, and any
   effect that approaches a cell boundary. More softness is not automatically
   better: reject halos, grey fringes, lost detail, or new shimmer.
5. Inspect every behavior and all sixteen gaze cells, including loop seams.
   A few attractive frames are not release validation.

For single-image performance checks, open
[isolated playback](http://127.0.0.1:4173/preview/quality-lab/playback.html?candidate=native-60&theme=dark).
Its query parameters accept `candidate`, `theme`, `size`, `row`, and `column`.
This matters because the four-card comparison runs multiple animated atlases;
it is not representative of the cost of one installed pet. A screenshot stream
can itself reduce frame rate. Distinguish capture throughput from actual image
phase advancement, and do not treat animation-frame callback counts as proof
that image frames were presented.

The preview uses the whole atlas, the host's background sizing and pixelated
filtering, and integral CSS origins. It adds no drop shadow. It deliberately
does not add easing between cells: that would conceal the host's instantaneous
state changes.

## Rendering findings

Combining SVG density and resize in one image-library pipeline does not prove
that supersampling occurred. The loader can shrink the SVG before rasterizing.
For a true coverage experiment, rasterize to explicit high-resolution pixels
first, then reduce the materialized RGBA buffer.

Area reduction must average premultiplied color and alpha, then recover straight
color. Averaging straight RGB across transparent pixels introduces dark edges.
Fully transparent output must have zero hidden RGB. These properties have
focused regression tests.

Calibrating source pixels against one nearest-neighbor display footprint can
reduce error at that exact size but damage the native-size result. That is not
a general-purpose improvement and is not used by the coverage candidate.

## Evidence and release use

The catalog rejects incomplete candidates, changed encoded assets, and stale
source or frozen-checkpoint bindings. Candidate JSON records contain exact
delays, source hashes, encoded hashes, and per-frame pixel hashes. Inspection
pages must agree with the composited frames of the encoded animation.

A higher frame count alone is not sufficient. Before using a comparison result
in shipping, independently check decoding, colors and alpha, all reachable
cells, arbitrary-phase state transitions, browser playback, and both themes.
Sampling metrics for unequal frame durations must account for elapsed time
rather than assume equal spacing. Do not simply loosen the existing gates or
reuse the checkpoint's approval seal.

The package cannot override the host's nearest-neighbor filtering, force a pet
size, or interpolate its state changes. Higher embedded cadence addresses
within-cell motion; it does not remove those separate constraints.
