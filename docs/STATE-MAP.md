# Grok Bot state choreography

The Grok Bot character vocabulary contains 39 named states. Codex v2 exposes
nine behavior rows plus 16 gaze cells. This project maps every character state
to one primary Codex row, then composes related poses into a coherent short
loop.

## Complete 39-state coverage

| Codex row | Primary Grok Bot states | Count |
| --- | --- | ---: |
| Idle | `sleeping`, `idle`, `shy`, `humming` | 4 |
| Travel right | `searching`, `receiving`, `dragging` | 3 |
| Travel left | `writing`, `sending`, `uploading` | 3 |
| Wave | `waking`, `happy`, `proud`, `dictating` | 4 |
| Jump | `excited`, `laughing`, `playful`, `bouncing` | 4 |
| Failed | `suspicious`, `drowsy`, `confused`, `bored`, `sad`, `scared`, `alerting`, `powering-down` | 8 |
| Waiting | `listening`, `curious`, `orbit`, `progress` | 4 |
| Active work | `thinking`, `working`, `angry`, `radar`, `spawning`, `loading` | 6 |
| Ready for review | `surprised`, `celebrate`, `notifying` | 3 |
| **Total** | **All named character states, each assigned once** | **39** |

This is the canonical inspection-cell assignment currently implemented in
`GROK_STATE_BEHAVIOR_CELLS`. The mapping is semantic rather than
one-state-per-frame: several states can truthfully share a physical beat, while
one installed action can visit multiple related character ideas. It compresses
the larger vocabulary without pretending Codex exposes all 39 names directly.

## Eye and timing maps

Eye topology IDs index the exact 25-pose literal in
[`../src/grok-eye-topologies.mjs`](../src/grok-eye-topologies.mjs). Each pose
contains two eyes and each eye contains 48 points. Pose intervals and blink
intervals are inclusive random ranges in milliseconds. `null` means the
character state has no independent blink scheduler. These values are
represented directly in
[`../src/spec.mjs`](../src/spec.mjs).

| Character state | Eye topology sequence | Pose interval ms `[min, max]` | Blink interval ms `[min, max]` |
| --- | --- | --- | --- |
| `sleeping` | `[13, 22, 4]` | `[6000, 10000]` | `null` |
| `waking` | `[13]` | `[800, 800]` | `null` |
| `idle` | `[0, 8]` | `[9000, 16000]` | `[6000, 14000]` |
| `listening` | `[10, 1, 19]` | `[2800, 5000]` | `[3000, 7000]` |
| `thinking` | `[8, 16, 14, 17, 5]` | `[2000, 3600]` | `[3500, 7000]` |
| `searching` | `[15, 9, 3, 20, 12, 18]` | `[1000, 1800]` | `[1600, 4000]` |
| `working` | `[7, 16, 11, 10]` | `[1800, 3200]` | `[2800, 5500]` |
| `excited` | `[2, 17, 21, 3, 11]` | `[1100, 2000]` | `[2000, 4000]` |
| `surprised` | `[3, 21]` | `[2500, 4000]` | `[1800, 3500]` |
| `suspicious` | `[14, 5, 23]` | `[2600, 4500]` | `[4500, 8000]` |
| `angry` | `[7, 16]` | `[2200, 3800]` | `[3500, 7000]` |
| `drowsy` | `[4, 22, 13]` | `[4000, 8000]` | `null` |
| `happy` | `[2, 11, 17, 19]` | `[2500, 4500]` | `[2500, 5000]` |
| `curious` | `[3, 21, 0, 15]` | `[1800, 3200]` | `[2500, 5500]` |
| `confused` | `[14, 5, 8]` | `[2200, 3800]` | `[2800, 5500]` |
| `bored` | `[4, 22, 0]` | `[3500, 6000]` | `[4000, 8000]` |
| `proud` | `[15, 8, 2]` | `[3500, 6000]` | `[3500, 7000]` |
| `shy` | `[0, 24, 13]` | `[3000, 5500]` | `[3000, 6000]` |
| `sad` | `[4, 13, 22]` | `[4000, 7000]` | `[4000, 8000]` |
| `laughing` | `[2, 11, 17]` | `[1200, 2400]` | `[2500, 5000]` |
| `scared` | `[3, 21]` | `[900, 1800]` | `[1200, 3000]` |
| `playful` | `[2, 17, 11, 8]` | `[1500, 3000]` | `[2000, 4500]` |
| `celebrate` | `[2, 8, 17]` | `[1400, 2600]` | `[2200, 4500]` |
| `orbit` | `[0, 8]` | `[4000, 8000]` | `null` |
| `radar` | `[0, 8]` | `[4000, 8000]` | `null` |
| `progress` | `[0, 8]` | `[4000, 8000]` | `null` |
| `spawning` | `[3, 0]` | `[1200, 1200]` | `null` |
| `humming` | `[0, 8]` | `[5000, 9000]` | `[4000, 8000]` |
| `loading` | `[0, 8]` | `[6000, 10000]` | `null` |
| `dictating` | `[10, 1, 19]` | `[4000, 8000]` | `null` |
| `writing` | `[15, 9]` | `[4000, 8000]` | `null` |
| `sending` | `[0, 8]` | `[4000, 8000]` | `null` |
| `receiving` | `[19, 0, 8]` | `[4000, 8000]` | `null` |
| `uploading` | `[15, 9, 8]` | `[4000, 8000]` | `null` |
| `notifying` | `[3, 21, 0]` | `[1500, 2600]` | `[2000, 4000]` |
| `alerting` | `[3, 21]` | `[2000, 3600]` | `null` |
| `dragging` | `[3, 15, 0]` | `[1600, 3000]` | `[2200, 4500]` |
| `bouncing` | `[2, 17]` | `[3000, 6000]` | `null` |
| `powering-down` | `[13, 22]` | `[6000, 9000]` | `null` |

Topology 6 is the only one of the 25 literal poses not named by the 39-state
map. It is retained as a useful authored in-between for the compressed-eye
transition.

## Codex row performance

| Row | Performance arc |
| ---: | --- |
| 0 — idle | Quiet breath / humming phase → ambient satellite exchange → shy glance → blink → opposed exchange → reopen; c6 is the separate neutral look. |
| 1 — travel right | Search → receive entry → open → contact → release → scan release → drag contact → settle. |
| 2 — travel left | Compressed-eye transition → pencil entry/write/lift → send → dock → dock release → settle; authored rather than mirrored. |
| 3 — wave | Attached blob-arm rise → dictation-wave entry/open → warm happy/proud settle. |
| 4 — jump | Anticipation crouch → exact ball rise → impact → rebound → squash landing. |
| 5 — failed | Suspicious hold → bang entry/open/impact → standby collapse → sad/shy recovery → confused settle. |
| 6 — waiting | Attentive hold → monochrome orbit entry/morph → progress morph/release → uncertain settle. |
| 7 — active work | Focus → gather/spawn → dots/thought → radar → whirl release → focused settle. |
| 8 — review | Ready hold → surprise burst → ribbon entry → crest → foreground storm → proud exit. |
| 9–10 — gaze | Sixteen independently selected 22.5° pointer directions, clockwise from up. |

Every performance frame keeps the canonical `blob` body identity. The 18 body
shapes are avatar-level options and may inform deformation studies, but the
state mapping does not swap avatar silhouettes as emotional roulette.

The two-satellite track uses the `humming` equations for ambient idle. The
layered front/behind rainbow celebration provides the high-energy completion
beat. Neither changes the state, eye, effect, or timing tables.

## Expression lab versus shipping rows

The installed `1536 × 2288` atlases above must follow the host's timed row
contract. They are not the place to serialize 39 unrelated poses or every
effect activation landmark. The build therefore also emits non-installable
inspection artifacts:

- a 39-frame state library, one explicit character snapshot per state;
- 14 effect transition rows at `A = 0.25`, `0.50`, `0.62`, and `0.90`;
- 60 fps dark/light motion studies that run every effect through the activation
  spring, a sustained sample, and spring release; and
- matching dark/light contact sheets under
  [`../preview/source-lab/`](../preview/source-lab/).

The state library uses effect-specific landmarks where the generic `A = 0.62`
snapshot would hide the defining action: first impact for `ball`, ribbon onset
for `whirl`, and the eye-hide crossover for `standby`.

At `A = 0.50` the effect system stops drawing eyes. At `A = 0.62` the general
body morph reaches its target. These landmarks make the behavior inspectable
without turning mutually exclusive modes into a single installed frame.

## Runtime event translation

| Codex condition | Animation |
| --- | --- |
| Resting terminal | Idle |
| Pet dragged right or left beyond the movement threshold | Travel right / left |
| Initial greeting | Wave |
| Pointer hover reaction | Jump |
| Task blocked or failed | Failed |
| Task needs user input | Waiting |
| Task is running | Active work |
| Task is ready for review | Ready for review |
| Pointer is in the gaze field | One of 16 directional cells |

The preview can drive a mapped row by character-state name for coverage review;
the installed Codex pet itself receives only the host's smaller state
vocabulary.

In the desktop runtime, idle c0–c5 is slowed `6×` (`1.10 s` raw,
`6.60 s` played). Idle c6 is a populated neutral-look frame outside that timed
cycle. Each non-idle row plays three complete cycles, then hands off from its
last frame to idle c0; ordinary repeats return to the same row's c0. The
installed choreography is designed around both boundaries.

The project has one timing choreography and, by explicit owner choice, no
custom reduced-motion atlas or branch. The host may still freeze the pet on c0
when reduced motion is active; the manifest cannot disable that behavior.
