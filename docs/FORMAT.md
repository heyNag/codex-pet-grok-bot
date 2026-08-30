# Codex pet format contract

This project targets the Codex desktop custom-pet **v2** static atlas. Because
a WebP cannot inspect the host theme at runtime, the build emits two complete
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
| Populated cells | 74 |
| Transparent unused cells | 14 |
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

## Static row layout

| Row | Meaning | Populated columns | Durations (ms) |
| ---: | --- | --- | --- |
| 0 | Idle | 0–6 | `280, 110, 110, 140, 140, 320` for c0–c5; c6 is neutral/rest |
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

Row 0 contains seven visible cells but six animation durations: c0–c5 form the
idle cycle and c6 is the host-selected neutral/rest pose. The host's `running`
row means active task work, not literal locomotion. Rows 1 and 2 are the
left/right travel cycles used while the pet is dragged.

## Desktop playback semantics

The duration values above are necessary but not sufficient to reproduce the
current desktop host. In the Codex desktop runtime:

- every idle c0–c5 duration is multiplied by `6`, so the raw `1100 ms` sequence
  becomes a `6600 ms` loop;
- c6 is the required `neutralLookFrame`, populated but excluded from the timed
  idle loop; c7 is transparent;
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
in the frames themselves.

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

The 14 unused cells are row 0 column 7; row 3 columns 4–7; row 4 columns 5–7;
and rows 6–8 columns 6–7. They must be RGBA `(0, 0, 0, 0)` throughout—not
merely visually transparent pixels with colored RGB data under zero alpha.

The validator also requires:

- exact atlas and cell dimensions;
- an alpha channel and transparent background;
- visible content in every required cell;
- no visible content in unused cells;
- non-identical animation frames;
- clockwise gaze ordering and meaningful directional eye displacement;
- a valid v2 manifest whose sprite path resolves inside its bundle; and
- an atlas at or below the 20 MiB limit.

## Theme and motion branches

Theme cannot be chosen inside a single static atlas, so the two bundle IDs are
the supported theme branch. The exact fills and effect colors are in
[COLOR-SYSTEM.md](COLOR-SYSTEM.md).

By the project owner's explicit choice, this repository does not generate a
separate reduced-motion atlas, manifest, timing table, or custom code branch.
Both theme variants use the same single choreography. That choice cannot
disable host accessibility behavior: Codex may freeze a pet on c0 when its own
reduced-motion setting is active, and the v2 manifest has no opt-out field.

## Local activation boundary

No build, test, preview, or validation command writes to Codex. No mutating
installer is shipped. The validated, reviewable generated bundles remain under
`pet/grok-bot-dark` and `pet/grok-bot-light`. Machine-local activation is
deliberately deferred: when requested, use the then-current official Codex
import path and review the exact destination and collision behavior before any
copy. This keeps generation and validation separate from activation and avoids
granting a repository helper write authority over `CODEX_HOME`.
