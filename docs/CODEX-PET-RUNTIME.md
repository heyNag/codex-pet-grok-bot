# Codex pet runtime contract

This document describes the behavior a custom Codex pet can rely on at runtime.
It separates the package format from the host-controlled state machine, timing,
interaction, visibility, and raster-rendering rules. It also records how an
animated WebP atlas can add fluid motion without fighting the host's cell
selection.

The host owns state selection and atlas coordinates. A pet package supplies a
manifest and pixels; it cannot supply JavaScript, CSS, transition settings, or
its own event handlers.

## Discovery, identity, and safe updates

Codex discovers current pet bundles under:

```text
$CODEX_HOME/pets/<bundle-name>/pet.json
```

When `CODEX_HOME` is unset, it normally resolves to `~/.codex`. A legacy
discovery root is also supported:

```text
$CODEX_HOME/avatars/<bundle-name>/avatar.json
```

Current pet bundles are loaded after legacy avatar bundles. If both roots
contain the same derived ID, the current pet bundle wins in the combined
inventory. The picker is sorted by display name.

The runtime identity is derived from the enclosing directory basename, not
from the manifest's `id` field:

```text
<bundle-name>        -> custom:<bundle-name>
grok-bot-dark        -> custom:grok-bot-dark
grok-bot-light       -> custom:grok-bot-light
```

The manifest `id` should still match the directory for clarity, validation,
and portable tooling. Distinct directory basenames allow the dark and light
variants to remain installed simultaneously.

The host manifest schema accepts these fields:

| Field | Runtime contract |
| --- | --- |
| `id` | Optional metadata; the folder basename remains authoritative at runtime |
| `displayName` | Optional display label; provide it for predictable picker presentation |
| `description` | Optional and nullable |
| `spriteVersionNumber` | `1` or `2`; defaults to `1` when omitted |
| `spritesheetPath` | Relative asset path; defaults to `spritesheet.webp` |

The resolved sprite path must stay inside its bundle directory. Paths that
escape the bundle are rejected.

An update should replace the existing owned directory in place. Installing a
new release under a numbered or suffixed directory creates a new runtime ID and
therefore a duplicate picker entry. A safe updater should:

1. download or copy into a staging directory outside the active pet ID;
2. validate the manifest, exact asset bytes, dimensions, and checksums;
3. refuse symlinked, modified, unmanaged, or otherwise ambiguous targets;
4. rename the previous owned directory to a temporary transaction backup;
5. place and verify the replacement at the original basename;
6. restore the previous directory if placement or verification fails; and
7. remove the transaction backup only after the replacement is committed.

Inventory refresh or an asynchronous custom-pet reload may temporarily clear
the selected asset. If the renderer unmounts during that interval, the next
mount begins at the first selected frame; an updater must not depend on
preserving playback phase across replacement.

## Atlas versions and geometry

Both accepted atlas versions use eight columns of `192 x 208` pixel cells.

| Property | v1 | v2 |
| --- | ---: | ---: |
| Atlas width | 1536 px | 1536 px |
| Atlas height | 1872 px | 2288 px |
| Columns | 8 | 8 |
| Rows | 9 | 11 |
| Total cells | 72 | 88 |
| Runtime-required cells | 57 | 73 |
| Unused transparent cells | 15 | 15 |
| Gaze directions | none | 16 |

Coordinates are zero based. Cell `(column, row)` begins at:

```text
x = column * 192
y = row * 208
```

The host renders the selected cell by changing CSS background position. For an
eight-column atlas:

```text
x-position = column / 7 * 100%
```

For the row axis:

```text
y-position = row / (rowCount - 1) * 100%
```

The resulting background sizes are `800% 900%` for v1 and `800% 1100%` for
v2. Normal v1 and v2 manifests provide the row count. A low-level legacy
fallback can position rows by negative frame height when row metadata is
absent, but new packages should not target that path.

### Reachable rows and cells

Rows 0–8 have the same state contract in v1 and v2. Version 2 adds the two
gaze rows.

| Row | Meaning | Reachable columns | Raw durations per cycle |
| ---: | --- | --- | --- |
| 0 | Idle | 0–5 | `280, 110, 110, 140, 140, 320` ms |
| 1 | Drag right | 0–7 | `120, 120, 120, 120, 120, 120, 120, 220` ms |
| 2 | Drag left | 0–7 | `120, 120, 120, 120, 120, 120, 120, 220` ms |
| 3 | Waving | 0–3 | `140, 140, 140, 280` ms |
| 4 | Jumping | 0–4 | `140, 140, 140, 140, 280` ms |
| 5 | Failed | 0–7 | `140, 140, 140, 140, 140, 140, 140, 240` ms |
| 6 | Waiting | 0–5 | `150, 150, 150, 150, 150, 260` ms |
| 7 | Running | 0–5 | `120, 120, 120, 120, 120, 220` ms |
| 8 | Review | 0–5 | `150, 150, 150, 150, 150, 280` ms |
| 9 | Gaze sectors 0–7 | 0–7 | Direct cell selection |
| 10 | Gaze sectors 8–15 | 0–7 | Direct cell selection |

Idle column 6 is not selected by the runtime. The 15 unused cells in either
atlas layout are:

- row 0, columns 6–7;
- row 3, columns 4–7;
- row 4, columns 5–7; and
- rows 6, 7, and 8, columns 6–7.

In v2, all 16 cells in rows 9 and 10 are reachable when the host has a
supported look target. Every unused cell should remain fully transparent,
including zero RGB beneath zero alpha, and no visible art should cross a cell
boundary.

## Renderer timing

The renderer advances cells with recursively chained `setTimeout` callbacks.
Each timeout changes `background-position` atomically. There is no
`requestAnimationFrame` timeline, tweening, easing, crossfade, interpolation,
or elapsed-clock catch-up.

Idle is deliberately slowed by multiplying every raw row-0 duration by six:

```text
1680, 660, 660, 840, 840, 1920 ms
```

That produces a `6600 ms` idle loop.

Every non-idle behavior row plays exactly three complete cycles. The renderer
then switches to row 0, column 0 and loops the slow idle sequence indefinitely,
even if the external state still says `running`, `waiting`, `failed`, or
another action. A state attribute therefore describes the requested state, not
necessarily the cell currently visible after its three-cycle burst.

| State | One cycle | Three-cycle visible burst | Then |
| --- | ---: | ---: | --- |
| `running-right` | 1.06 s | 3.18 s | slow idle |
| `running-left` | 1.06 s | 3.18 s | slow idle |
| `waving` | 0.70 s | 2.10 s | slow idle |
| `jumping` | 0.84 s | 2.52 s | slow idle |
| `failed` | 1.22 s | 3.66 s | slow idle |
| `waiting` | 1.01 s | 3.03 s | slow idle |
| `running` | 0.82 s | 2.46 s | slow idle |
| `review` | 1.03 s | 3.09 s | slow idle |

A change in effective state, selected gaze cell, atlas row count, or captured
reduced-motion mode resets playback to the first selected cell. Replacing one
notification with another notification that maps to the same state does not
restart the row. The image source URL itself is not a playback-effect
dependency, so a same-state, same-row-count source change can preserve the
host cell timer until a remount or another dependency changes.

Timeouts are chained from callback completion rather than from a stable master
clock. If the browser delays a callback, playback drifts; it does not skip
ahead to catch up.

## Base state producers

The floating pet's base state comes from the top notification. Notification
properties map to rows in this order:

| Notification condition | Base state |
| --- | --- |
| No notification or ordinary `info` | `idle` |
| First-awake event | `waving` |
| `isLoading: true` at any level | `running` |
| `warning` | `waiting` |
| `danger` | `failed` |
| `success` | `review` |

The loading check precedes the level check. A loading notification therefore
selects `running` even if it also has a warning, danger, or success level.

### Local task translation

For a local task, conditions are evaluated in this order:

1. approval or permission required, explicit user input required, incomplete
   plan, option/setup picker, or supported elicitation request -> `waiting`;
2. system or turn failure -> `failed`;
3. active, resuming, or in-progress work -> `running`;
4. unread result -> `review`; and
5. otherwise -> `idle`.

Idle task notifications are omitted rather than inserted as explicit idle
entries.

### Cloud task translation

For a cloud task:

1. archived -> `idle`;
2. failed or cancelled -> `failed`;
3. in progress or pending -> `running`;
4. unread result -> `review`; and
5. otherwise -> `idle`.

### Ephemeral producers and expiry

- A first-awake event remains eligible for 8 seconds and maps to `waving`.
  The avatar is recorded as seen immediately, so another notification can
  suppress the only wave opportunity.
- A multi-agent update remains eligible for 5 seconds. Completion maps to
  `review`; failure or not-found maps to `failed`; pending/running informational
  updates map to `idle` because they are not marked loading.
- A failed session notification expires after 1 hour.
- A waiting session notification expires after 1 day.
- A review notification expires after 7 days.
- A running notification has no time-based expiry while its task remains in
  that condition.

### Which notification wins

The active floating overlay uses latest-activity-first aggregation. Every
session notification is assigned the same overlay priority and session entries
are then sorted by newest activity time. As a result, the newest session—not
the most severe session—normally controls the pet. A recent running task can
visually outrank an older failed or waiting task.

Dedicated attention/activity entries can retain higher overlay priority. The
first-awake and multi-agent entries have lower priority than any session entry.
All winning entries still pass through the same loading/level mapping above;
they do not introduce additional sprite rows.

## Interaction precedence

The visible interaction state is resolved as:

```text
drag direction ?? (hovering ? jumping : base notification state)
```

That gives drag precedence over hover and hover precedence over task status.

### Hover

On surfaces using the interactive mascot wrapper, pointer hover replaces any
base state—including `failed`, `waiting`, and `review`—with `jumping`.
Jumping plays for 2.52 seconds and then falls into slow idle even while the
pointer remains over the pet. Leaving and entering again retriggers it.

The low-level renderer exposes a hover option, but normal call sites do not use
that option directly. Hover behavior usually comes from the wrapper, while a
profile surface implements its own idle/jump switch.

### Drag direction

Drag movement is sampled against the previously accepted pointer position. A
sample is accepted when either axis has moved at least four CSS pixels:

```text
abs(deltaX) >= 4 OR abs(deltaY) >= 4
```

- `deltaX >= 4` selects `running-right`.
- `deltaX <= -4` selects `running-left`.
- A vertical-only accepted sample preserves the prior direction and cannot
  establish an initial direction.
- Repeated samples in the same direction do not restart playback.
- A direction flip restarts the opposite row at column 0.
- Pointer up, cancel, or lost capture clears the drag state. If the pointer is
  still hovering, `jumping` becomes effective.
- Directional drag rows are suppressed while the orb physics presentation is
  active.

Continuous dragging does not make the travel row loop forever. Each direction
still receives only its 3.18-second burst before the renderer shows slow idle.
The generic `running` row represents active task work; it is not a locomotion
row.

## Gaze selection

Gaze is available only with a v2 atlas. The host measures the vector from the
mascot center to the active target. A vector of one CSS pixel or less is a
deadzone and produces no gaze cell.

The angle is computed clockwise from up and rounded to the nearest 22.5-degree
sector:

```text
angle = atan2(deltaX, -deltaY)
sector = nearest(angle / 22.5 degrees), wrapped to 0...15
```

| Sector | Cell | Direction |
| ---: | --- | --- |
| 0 | r9 c0 | Up |
| 1 | r9 c1 | Up-right, shallow |
| 2 | r9 c2 | Up-right |
| 3 | r9 c3 | Right-up, shallow |
| 4 | r9 c4 | Right |
| 5 | r9 c5 | Right-down, shallow |
| 6 | r9 c6 | Down-right |
| 7 | r9 c7 | Down-right, steep |
| 8 | r10 c0 | Down |
| 9 | r10 c1 | Down-left, steep |
| 10 | r10 c2 | Down-left |
| 11 | r10 c3 | Left-down, shallow |
| 12 | r10 c4 | Left |
| 13 | r10 c5 | Left-up, shallow |
| 14 | r10 c6 | Up-left |
| 15 | r10 c7 | Up-left, steep |

Ordinary pointer movement does not drive gaze. Supported targets are selected
in this order:

1. an eligible active Quick Chat caret;
2. the follow-up editor caret; and
3. a computer-use cursor event.

The interactive wrapper forwards a gaze cell only while its effective state is
`idle`, `running`, or `waving`. Drag direction, jumping, waiting, failed, and
review disable it. When present, the gaze cell fully replaces the state row;
running and waving do not receive state-specific gaze art.

Target updates are not interpolated and have no sector hysteresis. Losing the
target restarts the underlying state row at its first cell. Neighboring gaze
sectors should therefore differ incrementally, share a stable body pose, and
remain convincing around 22.5-degree boundaries.

## Surface reachability

Not every surface exercises the complete state machine:

| Surface | Reachable behavior |
| --- | --- |
| Floating pet overlay | All base states, hover jump, left/right drag, and v2 gaze |
| Pet picker list row | Direct idle renderer; no interactive hover state |
| Large picker preview | Idle wrapper with pointer interaction disabled |
| Profile surface | Direct idle renderer with a manually controlled jump on hover |
| Installation preview | Idle wrapper; hover can select jumping |

Only the floating overlay supplies live gaze targets. QA must cover the full
overlay and the smaller static/hover previews because the same atlas is shown
at different sizes and through different wrappers.

## Mounting, visibility, and timer lifetime

Every renderer mount starts at the first cell selected by its current state or
gaze target. Common causes of unmount and restart include:

- asynchronous loading of a selected custom or cloud pet;
- switching among pet, voice-orb, hidden, and Quick Chat presentations;
- changing to a path that renders only a mascot-sized placeholder; and
- refreshing inventory during an install or update.

Not every visually hidden state unmounts the renderer. A native fade can keep
the pet mounted at zero opacity, and an invisible root state can leave its
timer running. A Quick Chat-only placeholder, by contrast, may occupy the
space without mounting the sprite at all.

The sprite timer has no document-visibility or intersection-observer pause.
While mounted, hidden or backgrounded pets continue scheduling callbacks,
subject to browser timer throttling. Because the timer has no elapsed-time
catch-up, throttling changes phase by accumulating drift.

An animated image has its own decoder clock. If its element remains mounted,
the image animation may continue while the host's CSS cell timer is hidden,
frozen by reduced-motion handling, or delayed in the background.

## Host reduced-motion behavior

The host reads the operating system's `prefers-reduced-motion` setting. When
reduced motion is captured as true for a sprite renderer, the host displays the
first cell of the effective state and does not schedule its normal cell timer.
Gaze selection is evaluated first, so a supported target can still choose a
different static gaze cell.

The renderer captures this preference when it mounts. A later system setting
change may not affect that already-mounted instance until it remounts. The
manifest has no field that disables or customizes this host behavior.

This repository does not maintain a separate reduced-motion atlas or custom
motion branch. Animated WebP or APNG decoding is independent of the host's CSS
cell timer, so animation embedded inside the image can continue even when the
host freezes cell switching.

## Raster size, device pixels, and filtering

The host applies `image-rendering: pixelated` to the sprite. The manifest
cannot request smooth filtering or override that CSS.

The floating pet width setting accepts integer CSS-pixel values from 80 to 224.
When no explicit size variable is emitted, the authoritative CSS fallback is
`7.04rem`. In the current renderer at a 16px root size, its measured element is
`112.6328125 x 122.015625` CSS pixels and its DPR2 screenshot footprint is
exactly `225 x 244` device pixels. Non-default settings are emitted as rounded
pixel values.

There is no device-pixel-ratio-specific asset selection. The physical width is:

```text
physical pixels = CSS width * devicePixelRatio
source scale = physical pixels / 192
```

At DPR2, 96 CSS pixels maps the 192-pixel source cell exactly 1:1, and 192 CSS
pixels maps it exactly 2:1. The default fallback requires pixelated resampling.
Its release oracle records the full two-dimensional source-coordinate map for
all 88 cells from eight binary renderer screenshots. It deliberately does not
derive the map from a separable resize helper: Chromium texture-coordinate
seams make 2,276 target x samples depend on target y, while the y map remains
separable.

The packaged overlay code bound by the recorded application-resource digest
rounds the mascot's local left/top and the native window bounds to integer CSS
pixels before each application. Dragging moves that native window rather than
changing the mascot's renderer-local origin. This manual code-audit premise
implies that normal state, timer, and drag paths retain one integer device-pixel
origin phase at DPR2. The screenshot independently proves the observed live
host element and the fixture maps; it does not by itself prove every future
layout. Outer presentation scaling is a post-raster compositor transform, not
a different atlas sampling map.
Picker and profile surfaces can apply additional fixed sizing or transforms,
including small thumbnail scaling, so a clean floating overlay does not
guarantee a clean picker thumbnail.

Atlas art should compensate for the fixed filter:

- keep the character's mass and centroid stable between neighboring frames;
- preserve the natural supersampled one-pixel alpha transition around curves;
- keep transparent gutters around every cell;
- avoid single-pixel details that alternate position between frames;
- avoid art touching a cell edge; and
- inspect both light and dark palettes for alpha halos.

Embedded image animation can add temporal in-betweens, but it cannot remove
the host's pixelated spatial scaling.

## URL-based image intake

The runtime's URL-based image intake applies a stricter network boundary than
ordinary local discovery:

- the display name must remain non-empty after trimming;
- description may be null;
- the image URL must use HTTPS;
- localhost is rejected even over HTTPS;
- HTTP redirects (`301`, `302`, `303`, `307`, and `308`) are rejected rather
  than followed;
- the final response must be successful and contain a body;
- the response's base content type must be exactly `image/png` or
  `image/webp`;
- a declared `Content-Length` above 20 MiB is rejected;
- streamed bytes are stopped when they exceed 20 MiB; and
- decoded header dimensions must exactly match the selected v1 or v2 atlas.

The file format is inferred from the bytes, not from the URL extension. A
validated image is stored with the matching PNG or WebP extension beside the
generated manifest.

Direct local bundle discovery does not apply the same network stream limit,
but a distributable atlas should remain at or below 20 MiB so it works through
all supported intake paths.

## Animated WebP architecture

The WebP dimension validator checks the RIFF/WEBP container and obtains canvas
dimensions from the relevant WebP image chunks. It does not reject `ANIM` or
`ANMF` chunks. A correctly sized animated WebP is therefore a valid atlas and
is decoded by Chromium as an animated CSS background image. PNG validation is
similarly based on its signature and IHDR dimensions, so an APNG can be
structurally accepted, although WebP normally offers a better chance of
staying under the distribution size limit.

### Two independent clocks

An animated atlas introduces two clocks:

1. the host clock chooses a semantic cell using the state tables and
   `setTimeout` durations; and
2. the image decoder advances the full animated atlas on its own timeline.

Changing CSS background position does not restart the image animation. The
decoder keeps one global phase for the atlas while the host switches which
cell is visible. A state transition can therefore expose any phase of the
destination cell, not necessarily its first embedded animation frame.

This is the central design constraint. The atlas must be phase-safe rather
than assuming the two clocks will synchronize.

### Phase-safe authoring model

At embedded animation time `t`, every cell should contain a pose that is safe
to reveal at `t`:

- Give all columns of a timed behavior row the same continuous performance at
  the same WebP phase. Host changes among columns then become visually
  invisible instead of creating stitched jumps.
- Synchronize the core body silhouette, centroid, breathing, and bobbing phase
  across every state row. Vary eyes, arms, and state effects without moving
  the character's entire mass onto an incompatible phase.
- Make row 0 and every behavior row compatible at arbitrary phase. The forced
  three-cycle action-to-idle handoff can occur at any decoder phase.
- Preserve global phase across left/right drag rows so a direction flip does
  not teleport the body.
- Keep gaze sectors direction-specific, but use the same global body phase and
  small neighbor-to-neighbor eye changes.
- Treat target appearance and disappearance as arbitrary-phase row switches;
  never require a hidden setup frame.

This model turns the host's columns into redundant semantic selectors while
the animated image supplies the smooth in-betweens. It cannot make a status row
remain visible beyond the host's fixed three-cycle burst.

### Resource tradeoffs

A v2 animation frame covers a `1536 x 2288` canvas. Uncompressed RGBA for one
full canvas is about 13.4 MiB before decoder overhead. Even when WebP stores
delta rectangles efficiently, the browser decodes and composites a large
animated image.

Cost increases with:

- embedded frame rate and frame count;
- global loop duration;
- alpha complexity and changing edge pixels;
- lossless or near-lossless quality settings;
- the bounding rectangle of changes between frames; and
- the number of simultaneously mounted picker, profile, preview, and overlay
  instances.

Repeated body motion in distant atlas cells can enlarge a delta rectangle to a
substantial part of the canvas. Conversely, deliberately duplicated columns
can compress well when the encoder recognizes their shared changes. Actual
encoded size and decode cost must be measured; visual similarity alone is not
a reliable predictor.

The production pet uses a short, infinitely looping global period with 60
phases across exactly one second. Integer image timing alternates 16 ms and
17 ms durations using cumulative rounding, so the complete delay array—not a
single nominal delay—is the timing contract. The final atlas must remain within
20 MiB, and sustained Chromium CPU, memory, energy, and dropped-frame behavior
must remain acceptable. Frame rate is refinement, not a substitute for
phase-safe choreography. Prefer a shorter well-authored cycle over a long
sequence that multiplies decode work without adding visible expression.

Every surface that references the animated atlas can animate it, including
small picker thumbnails. Testing only one floating pet underestimates the
resource cost when both theme variants are installed and visible in settings.

## Runtime QA matrix

### Package and alpha validation

- Confirm exact v1 or v2 canvas dimensions and the declared sprite version.
- Confirm the byte signature, MIME type, alpha channel, and file size.
- Confirm all 57 v1 or 73 v2 required cells contain visible pixels.
- Confirm all 15 unused cells are RGBA zero throughout.
- Confirm no frame paints across a cell boundary or leaves disposal trails.
- For animated WebP, confirm `ANIM`/`ANMF` presence, infinite looping, stable
  alpha, and expected embedded frame cadence.

### Host timeline validation

- Capture every timed row through all three action cycles and the forced
  transition to slow idle.
- Hold hover beyond 2.52 seconds and drag beyond 3.18 seconds.
- Hold running, waiting, failed, and review states beyond their visible bursts;
  verify the state remains externally requested while the art is idle.
- Replace a notification with another notification mapping to the same state;
  verify there is no unintended assumed restart.
- Switch source assets with the same row count and state, then repeat with a
  full remount.
- Background and restore the window long enough to expose timer throttling and
  drift.

### Animated-atlas phase validation

- Change CSS background position in the middle of an embedded image cycle and
  confirm the image clock does not restart.
- Evaluate all 60x60 decoder-phase combinations for every reachable changed-cell
  edge, plus every ordered `p != q` pair within all 73 reachable cells.
- Seal each cell's own full-cycle topology/perceptual profile and each host
  edge's own all-phase metric trace. A single calm-cell or family-wide floor
  cannot prove that a higher-motion cell retained its authored range.
- Treat continuity aliases and semantic switches separately: source aliases
  require same-phase decoded-byte identity, browser-sampled aliases bind their
  60 same-phase seam metrics, and semantic switches retain every authored
  nonzero same-phase perceptual distance. Cross-phase maxima are not evidence
  that two semantic states remain distinct.
- Measure silhouette intersection-over-union, centroid displacement, bounding
  box changes, edge-alpha changes, and eye/gesture displacement across those
  switches.
- Inspect the third-cycle action-to-idle boundary at many decoder phases.
- Check that repeated semantic columns are identical at equal time `t` when
  seamless host switching is intended.
- Keep long skips on full-cycle topology and intended-surface perceptual bounds;
  do not apply adjacent-step velocity, acceleration, local-energy, or frame-drop
  ratios to an arbitrary `p -> q` jump.

### Gaze and interaction validation

- Exercise all 16 gaze sectors, the center deadzone, and every sector boundary.
- Jitter a target around a 22.5-degree boundary and inspect for eye chatter.
- Add and remove the target during idle, running, and waving.
- Verify that jumping, drag direction, waiting, failed, and review suppress
  gaze.
- Test vertical-only drag samples, direction flips, pointer cancellation, lost
  capture, and the transition from drag back to hover.

### Size and visual validation

- Inspect the exact `7.04rem` fallback through its captured `225 x 244` DPR2
  coordinate map; keep 96px/DPR2 only as a one-to-one source-detail reference.
- Inspect the floating overlay, list thumbnail, large preview, profile surface,
  and installation preview separately.
- Check both theme variants against their intended and opposite surfaces.
- Check transparent gutters, curved-edge stability, cell seams, and halos.

### Lifecycle and accessibility validation

- Test first mount, inventory refresh, pet switch, temporary missing asset,
  hidden-but-mounted presentation, full unmount, and remount.
- Test the host with reduced motion already enabled before mount.
- Change the operating-system preference while mounted, then remount and
  compare behavior.
- Confirm the chosen embedded image motion policy explicitly, because animated
  image playback is independent of the host's frozen CSS cell timer.

### Distribution and performance validation

- Test a direct HTTPS response with no redirect, the exact supported content
  type, and both declared and streamed size enforcement.
- Run install, no-op reinstall, update, interrupted update, and rollback in a
  disposable `CODEX_HOME`.
- Confirm updates leave one active directory for each owned ID and never create
  duplicate picker entries.
- Measure sustained CPU, memory, energy impact, and dropped frames during idle,
  action bursts, gaze changes, backgrounding, and settings views containing
  multiple animated instances.

## Hard constraints and future opportunities

The current package cannot change these host rules:

- only atlas versions 1 and 2 are accepted;
- cell size, row mapping, durations, idle slowdown, and three-cycle action
  repeat are fixed;
- status art falls back to idle even while the status remains active;
- gaze has 16 discrete directions and no interpolation or hysteresis;
- ordinary pointer movement is not a gaze source;
- gaze is generic rather than state-specific;
- the renderer uses pixelated raster filtering with no DPR-specific asset;
- the manifest cannot set frame rate, duration, repeat policy, transitions,
  filtering, event handlers, or theme handling;
- each theme needs its own bundle ID and assets;
- there is no manifest opt-out from host reduced-motion behavior; and
- an animated atlas uses one global decoder clock and a large full-canvas
  resource.

If the runtime contract expands in the future, the highest-value opportunities
would be configurable loop policy and timing, a smooth-filtering option,
DPR-aware source selection, visibility-aware playback, dynamically responsive
reduced-motion policy, state-specific gaze, ordinary pointer gaze, gaze
interpolation and hysteresis, and per-state animated or vector/canvas assets.
Until then, the highest-fidelity implementation is a carefully compressed,
phase-safe animated atlas designed around the fixed host state machine rather
than against it.
