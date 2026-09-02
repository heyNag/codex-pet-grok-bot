const sourceState = (
  state,
  index,
  behaviorId,
  behaviorRow,
  behaviorColumn,
  behaviorLabel,
  description,
) => {
  const behavior = Object.freeze({
    id: behaviorId,
    row: behaviorRow,
    column: behaviorColumn,
    label: behaviorLabel,
  });
  const entry = [state, behaviorId, behaviorColumn, description];
  Object.defineProperties(entry, {
    state: { value: state },
    index: { value: index },
    behavior: { value: behavior },
    description: { value: description },
  });
  return Object.freeze(entry);
};

// Preview-only metadata for the unconstrained Character Lab. The index is the
// canonical order in src/spec.mjs: state atlas coordinates are always
// row=floor(index/8), column=index%8. The behavior object records the separate
// install-atlas cell where that vocabulary is choreographed for Codex.
export const SOURCE_STATES = Object.freeze([
  sourceState("sleeping", 0, "idle", 0, 3, "Idle", "Closed eyes and a settled silhouette hold the lowest-energy state."),
  sourceState("waking", 1, "wave", 3, 0, "Wave", "Opening eyes and a lifted posture mark the transition back to attention."),
  sourceState("idle", 2, "idle", 0, 0, "Idle", "The canonical grounded bot: alert, warm, and deliberately restrained."),
  sourceState("listening", 3, "waiting", 6, 0, "Waiting for input", "Open attention and a slight lean invite the user to continue."),
  sourceState("thinking", 4, "working", 7, 2, "Active work", "Concentrated eye geometry gives deliberation a clear visual center."),
  sourceState("searching", 5, "travel-right", 1, 0, "Travel right", "Forward focus and directional tension turn attention into a scan."),
  sourceState("working", 6, "working", 7, 0, "Active work", "A compact, focused pose carries sustained cognitive effort."),
  sourceState("excited", 7, "jump", 4, 0, "Jump", "Wide attention and stored-up energy read as anticipation."),
  sourceState("surprised", 8, "review", 8, 1, "Ready for review", "An abrupt wide-eyed pop captures the bot's startle response."),
  sourceState("suspicious", 9, "failed", 5, 0, "Failed / blocked", "Asymmetric, narrowed attention creates a questioning side-eye."),
  sourceState("angry", 10, "working", 7, 0, "Active work", "Compressed, forceful eyes communicate intensity without hostility."),
  sourceState("drowsy", 11, "failed", 5, 5, "Failed / blocked", "Heavy lids and low posture reduce the character's visible energy."),
  sourceState("happy", 12, "wave", 3, 3, "Wave", "Open, buoyant eyes give the neutral blob an unmistakably warm affect."),
  sourceState("curious", 13, "waiting", 6, 1, "Waiting for input", "Questioning focus and a small tilt make attention feel exploratory."),
  sourceState("confused", 14, "failed", 5, 7, "Failed / blocked", "Uneven eye geometry makes uncertainty readable without added facial features."),
  sourceState("bored", 15, "failed", 5, 5, "Failed / blocked", "A prolonged low-energy stare expresses patient disengagement."),
  sourceState("proud", 16, "wave", 3, 3, "Wave", "A lifted, composed stance reads as quiet satisfaction."),
  sourceState("shy", 17, "idle", 0, 2, "Idle", "A tucked glance gives the restrained idle vocabulary a playful softness."),
  sourceState("sad", 18, "failed", 5, 5, "Failed / blocked", "Lowered posture and softened eyes carry disappointment without melodrama."),
  sourceState("laughing", 19, "jump", 4, 3, "Jump", "Squeezed joyful eyes turn elastic movement into a laugh."),
  sourceState("scared", 20, "failed", 5, 1, "Failed / blocked", "A compact startle stretches attention toward the perceived interruption."),
  sourceState("playful", 21, "jump", 4, 3, "Jump", "Elastic asymmetry keeps the bot mischievous rather than merely energetic."),
  sourceState("celebrate", 22, "review", 8, 4, "Ready for review", "The completion vocabulary expands into a layered multi-color ribbon flourish."),
  sourceState("orbit", 23, "waiting", 6, 2, "Waiting for input", "The five-satellite orbit morph externalizes patient processing."),
  sourceState("radar", 24, "working", 7, 3, "Active work", "The radar morph turns the body into a directional scan."),
  sourceState("progress", 25, "waiting", 6, 3, "Waiting for input", "The progress morph makes an otherwise static wait visibly active."),
  sourceState("spawning", 26, "working", 7, 1, "Active work", "The gather morph pulls particles into a compact formation beat."),
  sourceState("humming", 27, "idle", 0, 1, "Idle", "Opposed satellites and a soft sway keep ambient presence companionable."),
  sourceState("loading", 28, "working", 7, 4, "Active work", "The whirl morph compresses active processing into a tight kinetic mark."),
  sourceState("dictating", 29, "wave", 3, 2, "Wave", "The wave morph suggests an outward stream of authored input."),
  sourceState("writing", 30, "travel-left", 2, 2, "Travel left", "The pencil morph gives composition an unmistakable tool silhouette."),
  sourceState("sending", 31, "travel-left", 2, 4, "Travel left", "The send morph leans the body toward outbound intent."),
  sourceState("receiving", 32, "travel-right", 1, 2, "Travel right", "The receive morph opens the body toward incoming work."),
  sourceState("uploading", 33, "travel-left", 2, 5, "Travel left", "The dock morph adds contact and effort to outbound transfer."),
  sourceState("notifying", 34, "review", 8, 2, "Ready for review", "The notification vocabulary punctuates the arrival of a new result."),
  sourceState("alerting", 35, "failed", 5, 2, "Failed / blocked", "The bang morph opens into a sharp, attentive signal."),
  sourceState("dragging", 36, "travel-right", 1, 6, "Travel right", "Directional resistance connects the soft silhouette to physical movement."),
  sourceState("bouncing", 37, "jump", 4, 2, "Jump", "The ball morph captures a volume-preserving impact landmark."),
  sourceState("powering-down", 38, "failed", 5, 4, "Failed / blocked", "The standby collapse reaches the eye-dissolve midpoint before recovery."),
]);

export const SOURCE_EFFECTS = Object.freeze([
  Object.freeze({ state: "thinking", effect: "dots", label: "Thought dots" }),
  Object.freeze({ state: "orbit", effect: "orbit", label: "Five-dot orbit" }),
  Object.freeze({ state: "radar", effect: "radar", label: "Radar rings" }),
  Object.freeze({ state: "progress", effect: "progress", label: "Progress ring" }),
  Object.freeze({ state: "spawning", effect: "gather", label: "Particle gather" }),
  Object.freeze({ state: "dictating", effect: "wave", label: "Dictation wave" }),
  Object.freeze({ state: "sending", effect: "send", label: "Outbound send" }),
  Object.freeze({ state: "receiving", effect: "receive", label: "Inbound receive" }),
  Object.freeze({ state: "uploading", effect: "dock", label: "Upload dock" }),
  Object.freeze({ state: "bouncing", effect: "ball", label: "Body bounce" }),
  Object.freeze({ state: "loading", effect: "whirl", label: "Loading whirl" }),
  Object.freeze({ state: "powering-down", effect: "standby", label: "Standby collapse" }),
  Object.freeze({ state: "writing", effect: "pencil", label: "Writing pencil" }),
  Object.freeze({ state: "alerting", effect: "bang", label: "Alert bang" }),
]);
