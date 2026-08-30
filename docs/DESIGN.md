# Character and motion design

## Design goals

The character is built around a stable silhouette, expressive eye topology,
elastic body acting, attached effects, and clear motion at desktop-pet scale.
The full design vocabulary includes 18 body shapes, 25 eye topologies, 39 named
states, and 14 body-morph effects. The shipping Codex atlas keeps that richness
while selecting short performances that fit the host's fixed row contract.

The geometry, state vocabulary, and motion equations are documented in
[CHARACTER-SPEC.md](CHARACTER-SPEC.md).

## One character, two surface variants

Grok Bot is a theme-inverting elastic character. This repository encodes that
behavior as two static pets because a WebP atlas cannot read the host theme:

- `grok-bot-dark`: white body, black eyes, for dark Codex surfaces;
- `grok-bot-light`: black body, white eyes, for light Codex surfaces.

The variants share all geometry, timings, state coverage, and effect hues.
Only the monochrome body/eye/keyline values invert. Exact values are in
[COLOR-SYSTEM.md](COLOR-SYSTEM.md).

## Persistent body identity

The repository contains an 18-shape avatar registry:

`blob`, `pebble`, `bean`, `egg`, `squircle`, `tablet`, `capsule`, `cylinder`,
`hex`, `gem`, `crystal`, `wedge`, `shield`, `dome`, `arch`, `cloud`,
`teardrop`, and `leaf`.

These are avatar-level customization choices, not emotional frames. The Codex
pet's canonical and persistent body is the default `blob`, using the 259-unit
hero geometry centered at `114.2705`. Every action keeps that identity and acts
through scale, squash, stretch, skew, rotation, lean, body placement, and
attached limbs/effects. Randomly rotating among registry shapes would make the
frames read as different avatars and is explicitly outside the design.

The full registry remains available in
[`../src/grok-body-registry.mjs`](../src/grok-body-registry.mjs) for
collision/face anchors and possible future whole-pet variants. The canonical
rule is enforced in [`../src/spec.mjs`](../src/spec.mjs).

## Eye identity and emotion

The eye dataset contains 25 topologies, each with two 48-point eyes. The face
has no pupils or mouth; emotion comes from topology, spacing, slant, scale,
vertical placement, asymmetry, and gaze. The important transition families at
small size are:

- open round discs;
- one-eye and full horizontal blinks;
- tiny opposed/slanted pills;
- tall lower-set brush forms;
- large asymmetric surprise eyes; and
- directional translation layered over topology changes.

Eyes lead the action. Gaze and lids establish intent, the face placement
follows, and the body settles last. The state-to-topology and pose/blink
timings are in [STATE-MAP.md](STATE-MAP.md); the geometry is described in
[CHARACTER-SPEC.md](CHARACTER-SPEC.md).

## Effect vocabulary

The character model exposes 14 named effect modes with explicit state
ownership:

| Effect | Character state | Design read |
| --- | --- | --- |
| `dots` | `thinking` | restrained thought particles |
| `orbit` | `orbit` | five monochrome body-color satellites |
| `radar` | `radar` | three expanding rings |
| `progress` | `progress` | progress motion |
| `gather` | `spawning` | five-dot inward spiral |
| `wave` | `dictating` | voice/dictation wave |
| `send` | `sending` | upper-right outbound move plus shock |
| `receive` | `receiving` | inbound arc plus ripple |
| `dock` | `uploading` | bottom entry/docking cue |
| `ball` | `bouncing` | the body itself bounces |
| `whirl` | `loading` | loading whirl |
| `pencil` | `writing` | writing cue |
| `bang` | `alerting` | alert impact |
| `standby` | `powering-down` | center dot, ring, and fade |

Every one of these 14 modes morphs the canonical body toward its compact effect
body; `ball` and `whirl` are included. Most target a small circle. `pencil`
targets a rotated teardrop form. Eyes disappear when activation
reaches `A = 0.50`, while the general shape morph reaches its exact target at
`A = 0.62`. Effects stay attached to the character's action. They are not
generic badges, floating UI status icons, floor shadows, or ambient scenery.

## Ambient and celebration motion

Two treatments extend the core body acting:

- two small satellites orbit in opposition during the long ambient `humming`
  read, exchanging side, depth, radius, opacity, and front/back order; and
- celebration grows from sparse color flecks into thick rainbow ribbons at
  multiple angles, with rear and front layers wrapping the body.

The idle sequence samples the humming equations across a full visible period,
while the celebration treatment enriches a few high-energy Codex frames.
Neither changes the 14-mode effect list, 18-shape registry, eye dataset, or
39-state timing maps. `humming` remains distinct from the five-dot monochrome
`orbit` effect.

## Acting rules

1. **Silhouette first.** Wave, jump, travel, failure, and attention remain
   legible if interior detail is ignored.
2. **Eyes lead.** Intent begins in topology and gaze before the body responds.
3. **Persistent avatar.** The canonical blob deforms but never swaps into a
   different registry identity mid-animation.
4. **Effects belong to action.** Trails, ribbons, satellites, and marks either
   emerge from, orbit, or pass in front of/behind the body.
5. **Emotion without hostility.** Failure may read startled, suspicious,
   confused, flustered, sad, scared, or tired; it never blames the user.
6. **Work is cognitive.** Active work communicates concentration and progress
   while the body remains anchored.
7. **Small-scale clarity.** Every pose is judged at pet scale and clipped
   safely inside one atlas cell.

## Motion under the Codex atlas constraint

Codex v2 is an `8 × 11` grid of fixed `192 × 208` cells: nine short behavior
rows, two gaze rows, 74 populated frames, and 14 transparent cells. It cannot
carry continuous procedural motion or expose all 39 character states as host
events. The adaptation therefore selects clear
anticipation, action, overshoot, recovery, and settle phases. Volume is
approximately conserved: squash widens, stretch narrows, and tilt redistributes
mass.

The shipping rows are deliberately coherent temporal performances rather than
a museum grid of unrelated effects. Left and right travel share cadence
but are separately authored. Receive/release drives right travel; the
pencil/send/dock sequence drives left travel. Work progresses through gather,
thought, radar, and whirl samples. Failure uses bang and standby as one readable
alert-to-recovery arc. Review grows from surprise into the layered ribbon
celebration. Gaze frames move the eyes most, face placement slightly,
and body balance least. Celebration reserves the largest eye and ribbon
contrast so ordinary work does not look constantly excited.

The generated expression lab is the complementary inspection view:

- [`../preview/source-lab/state-contact-dark.png`](../preview/source-lab/state-contact-dark.png)
  and its light counterpart show one explicit snapshot for each of 39 states;
- [`../preview/source-lab/effect-transitions-dark.png`](../preview/source-lab/effect-transitions-dark.png)
  and its light counterpart show every effect at `A = 0.25, 0.50, 0.62, 0.90`.

Those images are inspection artifacts, not installable Codex atlases. They keep
the full character and effect vocabulary visible without damaging the temporal
continuity required by the host.

The desktop runtime slows idle c0–c5 by `6×`, repeats a non-idle row
three times, and then hands off to idle c0. Idle c6 is a separate neutral-look
cell. Consequently, c0 is a universal entry pose and every row must survive
both its own repeat boundary and its third-cycle transition to idle.

By the project owner's explicit choice there is one authored choreography, not
a second reduced-motion atlas or timing branch. This does not override the host:
Codex may still freeze c0 when its reduced-motion setting is active.

## Rendering and distribution boundary

The build renders code-native vector poses to transparent `192 × 208` cells,
normalizes hidden RGB under zero alpha, and composes deterministic lossless
WebP atlases. Validation checks both variants against the same geometry,
populated-cell, direction, continuity, manifest, and file-size contract.

The generated frames are a Codex-specific performance. The design vocabulary
and equations can be preserved while finite frame selection, phase choice,
compositing, and Codex transitions remain intentional adaptations. All artwork
in the shipped bundles is generated by project code; [NOTICE.md](../NOTICE.md)
records the unofficial-project, rights, and redistribution boundary.
