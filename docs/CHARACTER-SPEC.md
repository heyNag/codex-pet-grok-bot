# Character reference specification

This document records the geometry, state vocabulary, effect model, and motion
equations implemented by this repository. It complements the code with a
human-readable description of the character system used to build the Codex
atlases and preview studies.

## Character model at a glance

| Property | Repository model |
| --- | --- |
| Canonical body | Persistent `blob` silhouette |
| Body vocabulary | 18 named shapes |
| Eye vocabulary | 25 two-eye topologies |
| Character states | 39 named states |
| Body-morph effects | 14 named modes |
| Theme variants | Dark-surface and light-surface packages |
| Accent palette | Six shared motion colors |

## Body geometry

The canonical hero uses a 259-unit `blob` path centered at `114.2705`. The
repository also defines 18 named avatar body choices, each represented as a
96-point ring with face anchors:

`blob`, `pebble`, `bean`, `egg`, `squircle`, `tablet`, `capsule`, `cylinder`,
`hex`, `gem`, `crystal`, `wedge`, `shield`, `dome`, `arch`, `cloud`,
`teardrop`, and `leaf`.

The registry metadata and geometry live in
[`../src/grok-body-registry.mjs`](../src/grok-body-registry.mjs). These shapes
are avatar-level customization choices, not emotional frames. The shipping pet
keeps the default `blob` as one persistent character and uses elastic
transforms for acting. The hero path and theme palette are defined in
[`../src/grok-art.mjs`](../src/grok-art.mjs).

## Eye geometry

The repository includes 25 eye topologies. Each topology contains two eyes,
and each eye contains 48 points:

| Field | Value |
| --- | --- |
| Pose count | 25 (`0`–`24`) |
| Eyes per pose | 2 |
| Points per eye | 48 |

The dataset is in
[`../src/grok-eye-topologies.mjs`](../src/grok-eye-topologies.mjs).
State-specific spacing, scale, position, slant, asymmetry, gaze, and blink
behavior act on those forms to produce emotion without pupils or a mouth.

## State and timing model

The character vocabulary contains 39 states, a topology sequence for every
state, a pose-change interval for every state, and a blink interval or `null`
for every state. The complete values are listed in
[STATE-MAP.md](STATE-MAP.md) and implemented in
[`../src/spec.mjs`](../src/spec.mjs).

## Effect registry

The 14 body-morph effects and their character-state relationships are:

| Effect | State | Visual structure |
| --- | --- | --- |
| `dots` | `thinking` | thought dots |
| `orbit` | `orbit` | five monochrome body-color satellites |
| `radar` | `radar` | three rings |
| `progress` | `progress` | progress motion |
| `gather` | `spawning` | five-dot spiral |
| `wave` | `dictating` | dictation wave |
| `send` | `sending` | upper-right outbound motion plus shock |
| `receive` | `receiving` | inbound arc plus ripple |
| `dock` | `uploading` | bottom entry |
| `ball` | `bouncing` | body bounce rather than a separate ball prop |
| `whirl` | `loading` | loading whirl |
| `pencil` | `writing` | writing cue |
| `bang` | `alerting` | alert impact |
| `standby` | `powering-down` | center dot, ring, and fade |

The six-color accent palette is documented in
[COLOR-SYSTEM.md](COLOR-SYSTEM.md).

All 14 modes participate in the same body-morph system, including `ball` and
`whirl`. `ball` bounces the morphed body rather than introducing a detached
prop. `whirl` drives the compact body and emitted ribbon motion rather than a
detached loading icon. The `orbit` dots remain monochrome even though other
effects can use the accent palette.

## Activation and morph dynamics

Let `A` be effect activation and `v` its velocity. The character advances a
critically damped spring in substeps no larger than `1/120 s` toward target
`T`:

```text
v = v + (-28v - 196(A - T)) dt
A = A + v dt
```

For a clean onset from `A = 0`, `v = 0`, `T = 1`, the numerical landmarks are:

| Activation | Time from onset |
| ---: | ---: |
| `0.25` | `68.66 ms` |
| `0.50` | `119.88 ms` |
| `0.62` | `149.89 ms` |
| `0.90` | `277.84 ms` |

Eyes remain at full opacity and local scale through `A = 0.36`. Across the
short interval from `A = 0.36` to `A = 0.64`, let
`H = clamp((A - 0.36) / 0.28, 0, 1)` and apply smoothstep easing:

```text
D(H) = H^2(3 - 2H)
eye opacity = 1 - D(H)
eye local scale = 1 - 0.16D(H)
```

The eyes therefore dissolve symmetrically while drawing toward the body center:
at `A = 0.50` opacity is `0.50` and local scale is `0.92`; at `A = 0.64`
opacity is zero. The surrounding body transform continues its own shrink during
the same interval, so the visible eye motion does not need a second aggressive
scale collapse.

For the body-ring morph, `G = clamp(A / 0.62, 0, 1)` and the ring interpolation
uses cubic-in-out easing:

```text
E(G) = 4G^3                              when G < 0.5
E(G) = 1 - (-2G + 2)^3 / 2              otherwise
```

Thus `A = 0.50` is the eye-dissolve midpoint, `A = 0.62` is the general
morph-complete snapshot, and `A = 0.64` is the fully eye-hidden point. The target is a 96-point circle for every mode except
`pencil`, which targets a pi-rotated teardrop ring. Target radii in character
coordinate units are:

| Effect | Radius | Effect | Radius |
| --- | ---: | --- | ---: |
| `dots` | `22` | `orbit` | `19` |
| `radar` | `19` | `progress` | `19` |
| `gather` | `19` | `wave` | `16` |
| `send` | `20` | `receive` | `20` |
| `dock` | `20` | `ball` | `18` |
| `whirl` | `15` | `pencil` | `17` |
| `bang` | `13` | `standby` | `13` |

The generated transition sheets sample every effect at `A = 0.25`, `0.50`,
`0.62`, and `0.90` so full eyes, the dissolve midpoint, morph completion, and late
activation can be compared without forcing those 56 samples into the installed
Codex row vocabulary. The separate 39-state library uses more informative
landmarks for special cases: `ball` at first impact (`A = 0.893166`), `whirl`
at ribbon emission (`A ~= 0.91518`), `standby` at the eye-dissolve midpoint
(`A = 0.50`), and the other morph modes at completion (`A = 0.62`).

The non-installable motion bench renders every effect at 60 fps through spring
onset, a sustained interval, and spring release. Its 156 samples use
cumulative-rounded 16/17 ms WebP delays for an exact `2600 ms` presentation
instead of rounding every frame to `17 ms`. Each active effect receives a
continuous clock; deterministic QA rejects any encoded active-frame hold above
`34 ms`. Finite or stochastic trails use deterministic sampling so the studies
remain reproducible.

## Ball, whirl, and humming motion

`ball` uses period `P = 0.62 s`, height `H = 52`, and
`g = 8H/P^2 = 1082.206035`. Its initial fall time is
`t_f = sqrt(80/g) = 0.271887986 s`. With time `t` in seconds:

```text
h(t) = 40 - 0.5 g t^2                              for t < t_f
p(t) = fract((t - t_f) / P)                        for t >= t_f
h(t) = 4 H p(t) (1 - p(t))                         for t >= t_f
bodyY(t) = (40 - h(t)) A^2
```

The first impact occurs at approximately `A = 0.893166`; the first rebound apex
lands near `A = 0.99735`. These landmarks preserve the body-driven bounce.

`whirl` applies the following compact-body drift:

```text
bodyX(t) = (2 sin(0.9t) + 0.8 sin(1.7t)) A^2
bodyY(t) = (2.4 sin(1.3t) + 1.2 sin(0.6t)) A^2
```

Ribbon emission begins around `A = 0.915` (`t ~= 0.2925 s` on a clean onset);
a mature reference is `A ~= 0.9927` at `0.5 s`. The expression lab
progressively reveals each belt between `A = 0.915` and `A = 0.993`, treating
the threshold as emission onset rather than revealing a mature full-length
trail in one frame.

The separate two-satellite `humming` track sits outside the 14 morph modes. For
satellite index `i` in `{0, 1}`, spin phase `phi`, body radius `r`, center
`(cx, cy)`, and satellite activation `S`:

```text
theta = 0.85 phi + i pi
track = 1.3 r
x = cx + track sin(theta)
y = cy - 0.38 track cos(theta) - 8
depth = 0.55 + 0.45 clamp((cos(theta) + 1) / 2, 0, 1)
radius = 7.5 depth S
opacity = (0.3 + 0.7 depth) S
```

The two satellites remain opposed and exchange side, depth, radius, opacity,
and front/back order. Because an unlabeled opposed pair has a visible period of
`pi`, inspection samples can advance it at `pi / 6` increments without a
visually static identity swap. This track remains available in the Character
Lab; the installed timed idle row instead uses subtle breathing, gaze, and eye
in-betweens to protect its continuous silhouette under host playback.

## Expression and motion range

The face choreography moves among open round discs, one-eye and full blinks,
tiny opposed pills, tall lower-set brush forms, asymmetric surprise eyes, and
directional gaze. Face placement shifts with topology so transitions feel
acted rather than swapped.

The installed ambient performance combines subtle body breathing, small gaze
changes, and interpolated eye shapes. The Character Lab retains the opposed
satellite exchange as part of the wider expression range. High-energy
completion grows from sparse color flecks into thick rainbow ribbons crossing
at multiple angles, with rear and front layers wrapping the stable body before
it returns to idle.

## Codex format boundary

The Codex atlas is a fixed-format performance. It compresses continuous
behavior into an `8 × 11` grid with 73 populated cells and a phase-safe
animated timeline, preserves one canonical blob identity, and emits separate
dark/light packages.

The installed atlas prioritizes coherent actions, stable visible mass, and
repeat boundaries. Its runtime rows use interpolated eye topologies and
attached gestures rather than the compact-body effect morphs. A separate,
non-installable expression lab presents one snapshot for all 39 states, four
activation samples for all 14 morph modes, and full motion studies. Continuous
host-controlled timing, arbitrary event logic, randomized pose choice, and
every possible trail history cannot fit into a sprite atlas, so phase selection
and Codex-specific sequencing remain intentional design decisions.

The repository contains project-authored code and generated Codex assets. See
[NOTICE.md](../NOTICE.md) for the unofficial-project, rights, and redistribution
boundary.
