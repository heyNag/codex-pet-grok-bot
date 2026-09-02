# Codex pet format contract

This project targets the Codex desktop custom-pet **v2** atlas with a lossless
animated WebP. Because an image cannot inspect the host theme at runtime, the
build emits two complete
bundles rather than one theme-adaptive pet:

```text
pet/
├── grok-bot-dark/
│   ├── pet.json
│   └── spritesheet.webp
└── grok-bot-light/
    ├── pet.json
    └── spritesheet.webp
```

For the product-level feature and installation model, see OpenAI's
[Pets documentation](https://learn.chatgpt.com/docs/pets). This document records
the exact v2 contract exercised by this repository and its validator.

## Manifests and runtime IDs

The dark-surface bundle at
[`../pet/grok-bot-dark/pet.json`](../pet/grok-bot-dark/pet.json) contains:

```json
{
  "id": "grok-bot-dark",
  "displayName": "Grok Bot Dark",
  "description": "A warm, watchful Grok Bot companion tuned for dark Codex surfaces.",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

The light-surface bundle at
[`../pet/grok-bot-light/pet.json`](../pet/grok-bot-light/pet.json) contains:

```json
{
  "id": "grok-bot-light",
  "displayName": "Grok Bot Light",
  "description": "A warm, watchful Grok Bot companion tuned for light Codex surfaces.",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

Codex derives a custom-pet identity from the enclosing folder. The expected
runtime identities are therefore `custom:grok-bot-dark` and
`custom:grok-bot-light`. Folder name, manifest `id`, and installation directory
must agree. Because the two basenames differ, both variants can be installed at
once and selecting or reinstalling one does not replace the other.

## Geometry

| Property | Value |
| --- | ---: |
| Atlas width | 1536 px |
| Atlas height | 2288 px |
| Columns | 8 |
| Rows | 11 |
| Total cells | 88 |
| Populated cells | 73 |
| Transparent unused cells | 15 |
| Cell width | 192 px |
| Cell height | 208 px |
| Maximum file size | 20 MiB |
| Host/tool source formats | Transparent PNG or WebP |
| This repository's packaged format | Lossless WebP only |

Coordinates are zero based. A cell at column `c`, row `r` begins at
`x = c × 192`, `y = r × 208`. Art stays inside its cell; no frame may bleed
into a neighbor. Both variants use the same geometry, frame placement, alpha,
and timing data. Only the theme palette differs.

The broader hatch toolchain can ingest a transparent PNG or WebP. This
repository deliberately fixes `spritesheetPath` to `spritesheet.webp` and its
validator rejects every other packaged format so the shipped and tested
contract has one unambiguous encoder and MIME type.

## Semantic row layout

| Row | Meaning | Populated columns | Durations (ms) |
| ---: | --- | --- | --- |
| 0 | Idle | 0–5 | `280, 110, 110, 140, 140, 320` |
| 1 | Travel right | 0–7 | `120, 120, 120, 120, 120, 120, 120, 220` |
| 2 | Travel left | 0–7 | `120, 120, 120, 120, 120, 120, 120, 220` |
| 3 | Wave / greeting | 0–3 | `140, 140, 140, 280` |
| 4 | Jump / hover reaction | 0–4 | `140, 140, 140, 140, 280` |
| 5 | Failed / blocked | 0–7 | `140, 140, 140, 140, 140, 140, 140, 240` |
| 6 | Waiting / needs input | 0–5 | `150, 150, 150, 150, 150, 260` |
| 7 | Running / active work | 0–5 | `120, 120, 120, 120, 120, 220` |
| 8 | Review / ready | 0–5 | `150, 150, 150, 150, 150, 280` |
| 9 | Gaze: 0° through 157.5° | 0–7 | Direct selection |
| 10 | Gaze: 180° through 337.5° | 0–7 | Direct selection |

Row 0 contains six visible cells: c0–c5 form the idle cycle and c6–c7 stay
transparent. The host's `running` row means active task work, not literal
locomotion. Rows 1 and 2 are the left/right travel cycles used while the pet is
dragged.

## Desktop playback semantics

The duration values above are necessary but not sufficient to reproduce the
current desktop host. In the Codex desktop runtime:

- every idle c0–c5 duration is multiplied by `6`, so the raw `1100 ms` sequence
  becomes a `6600 ms` loop;
- c6 and c7 are unused and must remain transparent;
- each non-idle behavior row plays three complete cycles, then begins the slow
  idle loop at idle c0;
- a row repeat jumps from its last timed frame to that same row's c0, while the
  third-cycle handoff jumps from the row's last frame to idle c0;
- c0 is therefore the universal entry pose for both repeat and handoff QA;
- gaze uses the nearest 22.5° cell and does not interpolate between cells; and
- gaze can override idle, active-work, or greeting display, but it is not a
  replacement timing row.

The manifest has no per-row duration, repeat-count, transition, or idle-speed
field. The preview mirrors these host rules; the atlas must encode continuity
in the image itself.

## Authored poses and the fluid shipping atlas

The build keeps two complementary representations:

- `qa/authoring-atlas-dark.webp` and `qa/authoring-atlas-light.webp` are static
  inspection atlases containing every distinct authored key pose; and
- each installable `pet/*/spritesheet.webp` is the animated atlas the host
  renders.

The authoring atlases are QA inputs, not install fallbacks. In the shipping
animation, every populated column of timed rows 0–8 shows the same continuous
row performance at a given embedded time. A host column jump therefore reveals
the same pose instead of producing a stitched discontinuity. The idle row
continuously passes through its six authored expression landmarks rather than
hard-cutting when the host advances columns. The gaze rows retain all 16
direction-specific cells and add only phase-safe micro-motion.

The embedded WebP clock and the host cell clock are independent. Every image
page and every row transition must therefore be safe at any phase. The complete
two-clock model, lifecycle behavior, performance tradeoffs, and QA matrix are
documented in [CODEX-PET-RUNTIME.md](CODEX-PET-RUNTIME.md).

## Desktop raster rendering

The current desktop host renders each selected cell with pixelated image
filtering and switches atlas positions at the timing boundaries above. It does
not tween, crossfade, or synthesize intermediate poses. The embedded WebP adds
the temporal in-betweens, but the manifest has no field that can request smooth
spatial filtering or change the host playback mechanism.

The authoritative default is the CSS fallback `7.04rem`. At a 16px root size,
the current renderer measures it at `112.6328125 x 122.015625` CSS pixels and
captures a `225 x 244` device-pixel footprint at DPR2. Release acceptance uses
that exact screenshot-derived coordinate map. The preview's `96 px · native
1:1` setting remains a source-detail reference, and **Smooth inspection** is
diagnostic only.

## Direction order

Gaze angles advance clockwise in 22.5° steps. Zero degrees is up.

| Angle | Atlas cell | Direction |
| ---: | --- | --- |
| 0° | r9 c0 | Up |
| 22.5° | r9 c1 | Up-right, shallow |
| 45° | r9 c2 | Up-right |
| 67.5° | r9 c3 | Right-up, shallow |
| 90° | r9 c4 | Right |
| 112.5° | r9 c5 | Right-down, shallow |
| 135° | r9 c6 | Down-right |
| 157.5° | r9 c7 | Down-right, steep |
| 180° | r10 c0 | Down |
| 202.5° | r10 c1 | Down-left, steep |
| 225° | r10 c2 | Down-left |
| 247.5° | r10 c3 | Left-down, shallow |
| 270° | r10 c4 | Left |
| 292.5° | r10 c5 | Left-up, shallow |
| 315° | r10 c6 | Up-left |
| 337.5° | r10 c7 | Up-left, steep |

## Empty-cell and alpha rules

The 15 unused cells are row 0 columns 6–7; row 3 columns 4–7; row 4 columns
5–7; and rows 6–8 columns 6–7. They must be RGBA `(0, 0, 0, 0)` throughout—not
merely visually transparent pixels with colored RGB data under zero alpha.

The validator also requires:

- exact atlas and cell dimensions;
- an alpha channel and transparent background;
- visible content in every required cell;
- no visible content in unused cells;
- distinct key poses in the static authoring atlas and intentional
  same-phase column identity in animated action rows;
- clockwise gaze ordering and meaningful directional eye displacement;
- a valid v2 manifest whose sprite path resolves inside its bundle; and
- an atlas at or below the 20 MiB limit.

## Theme and motion branches

Theme cannot be chosen inside a single image, so the two bundle IDs are
the supported theme branch. The exact fills and effect colors are in
[COLOR-SYSTEM.md](COLOR-SYSTEM.md).

This repository authors one choreography and does not generate a separate
reduced-motion atlas, manifest, timing table, or custom code branch. Both theme
variants use that same choreography. This cannot
disable host accessibility behavior: Codex may freeze its own cell selection
on c0 when reduced motion is active, and the v2 manifest has no opt-out field.
The embedded WebP animation remains independent and continues playing.

## Local activation boundary

Build, test, preview, and validation commands never write to Codex. The sole
activation utility is [`../install.sh`](../install.sh), which is invoked
explicitly with `dark`, `light`, or `both` and installs only the selected bundle
IDs under `$CODEX_HOME/pets` (normally `~/.codex/pets`). Its staging directory,
run lock, and temporary rollback directory live under the same `CODEX_HOME`
boundary but outside the active pet-ID directories.

The installer pins its source assets to an immutable repository commit,
verifies exact byte sizes and SHA-256 hashes in staging, and records ownership
in a receipt inside each managed bundle. A future run may replace only an
unmodified receipt-owned copy; symlinked, unmanaged, modified, or otherwise
conflicting destinations are rejected. Updates temporarily rename the previous
managed directory under `$CODEX_HOME/pet-backups`, restore it on failure, and
remove it after the replacement passes final verification. See
[INSTALL.md](INSTALL.md) for the public command and manual fallback.
