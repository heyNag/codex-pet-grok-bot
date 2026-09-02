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
| 0 — idle | Quiet breath → soft eye in-between → gentle glance → blink → reopen across c0–c5. |
| 1 — travel right | Directional search gaze with a gentle repeating gait and a low-opacity attached trail. |
| 2 — travel left | The exact mirrored cadence, gaze, gait, and attached trail of travel right. |
| 3 — wave | Four connected attached-arm poses rise, open, sweep, and settle around one warm expression. |
| 4 — jump | Anticipation crouch → rise → apex → fall → squash landing, with body volume held steady. |
| 5 — failed | Suspicious/confused eyes morph toward a sad read, then recover without collapsing the body. |
| 6 — waiting | Attentive eyes open toward curiosity and return while a soft attached asking gesture holds the pose together. |
| 7 — active work | Focused eyes morph into a thinking topology and back while the body stays anchored. |
| 8 — review | Proud eyes open into a happy topology as one celebration treatment fades in, crests, and fades out. |
| 9–10 — gaze | Sixteen independently selected 22.5° pointer directions, clockwise from up. |

Every installed performance frame keeps the canonical `blob` body identity and
a nearly constant visible mass. The 18 body shapes are avatar-level options and
may inform deformation studies, but the state mapping does not swap avatar
silhouettes as emotional roulette. Intermediate eye topologies, small elastic
body changes, and attached gestures are interpolated inside the animated WebP;
same-phase timed columns, including idle c0–c5, make the host's discrete sprite
switches invisible.
Travel trails and review color stay subordinate to that continuous silhouette.

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

The installed rows do not use the compact-body effect morphs from the full
effect library. Keeping those transformations in the Character Lab preserves
the complete expressive system for inspection while allowing the runtime rows
to hold one stable silhouette through repeats and handoffs.

The state library uses effect-specific landmarks where the generic `A = 0.62`
snapshot would hide the defining action: first impact for `ball`, ribbon onset
for `whirl`, and the eye-dissolve midpoint for `standby`.

The effect system keeps eyes fully visible through `A = 0.36`, dissolves and
draws them inward through the `A = 0.50` midpoint, reaches the general body-morph
target at `A = 0.62`, and makes the eyes fully invisible at `A = 0.64`. These
landmarks make the behavior inspectable without turning mutually exclusive
modes into a single installed frame.

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
| A supported caret or cursor target is active | One of 16 directional cells |

The preview can drive a mapped row by character-state name for coverage review;
the installed Codex pet itself receives only the host's smaller state
vocabulary.

In the desktop runtime, idle c0–c5 is slowed `6×` (`1.10 s` raw,
`6.60 s` played); c6–c7 are unused. Each non-idle row plays three complete
cycles, then hands off from its last frame to idle c0; ordinary repeats return
to the same row's c0. The installed choreography is designed around both
boundaries at every possible embedded animation phase.

The repository authors one timing choreography with no custom reduced-motion
atlas or branch. The host may still freeze the pet on c0
when reduced motion is active; the manifest cannot disable that behavior, and
the embedded WebP continues independently.
