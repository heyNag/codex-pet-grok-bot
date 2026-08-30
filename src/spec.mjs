export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const COLUMNS = 8;
export const ROW_COUNT = 11;
export const ATLAS_WIDTH = CELL_WIDTH * COLUMNS;
export const ATLAS_HEIGHT = CELL_HEIGHT * ROW_COUNT;

export const GROK_STATES = Object.freeze([
  "sleeping",
  "waking",
  "idle",
  "listening",
  "thinking",
  "searching",
  "working",
  "excited",
  "surprised",
  "suspicious",
  "angry",
  "drowsy",
  "happy",
  "curious",
  "confused",
  "bored",
  "proud",
  "shy",
  "sad",
  "laughing",
  "scared",
  "playful",
  "celebrate",
  "orbit",
  "radar",
  "progress",
  "spawning",
  "humming",
  "loading",
  "dictating",
  "writing",
  "sending",
  "receiving",
  "uploading",
  "notifying",
  "alerting",
  "dragging",
  "bouncing",
  "powering-down",
]);

const freezeRecordOfArrays = (record) => Object.freeze(
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value == null ? null : Object.freeze(value)])),
);

// State-to-eye vocabulary for the complete character model. Topology 6 is an
// authored in-between and the sole literal pose not named by this state catalog.
export const GROK_STATE_EYE_TOPOLOGIES = freezeRecordOfArrays({
  sleeping: [13, 22, 4], waking: [13], idle: [0, 8], listening: [10, 1, 19],
  thinking: [8, 16, 14, 17, 5], searching: [15, 9, 3, 20, 12, 18], working: [7, 16, 11, 10],
  excited: [2, 17, 21, 3, 11], surprised: [3, 21], suspicious: [14, 5, 23], angry: [7, 16],
  drowsy: [4, 22, 13], happy: [2, 11, 17, 19], curious: [3, 21, 0, 15], confused: [14, 5, 8],
  bored: [4, 22, 0], proud: [15, 8, 2], shy: [0, 24, 13], sad: [4, 13, 22],
  laughing: [2, 11, 17], scared: [3, 21], playful: [2, 17, 11, 8], celebrate: [2, 8, 17],
  orbit: [0, 8], radar: [0, 8], progress: [0, 8], spawning: [3, 0], humming: [0, 8],
  loading: [0, 8], dictating: [10, 1, 19], sending: [0, 8], receiving: [19, 0, 8],
  uploading: [15, 9, 8], writing: [15, 9], notifying: [3, 21, 0], alerting: [3, 21],
  bouncing: [2, 17], dragging: [3, 15, 0], "powering-down": [13, 22],
});

export const GROK_STATE_POSE_INTERVAL_MS = freezeRecordOfArrays({
  sleeping: [6000, 10000], waking: [800, 800], idle: [9000, 16000], listening: [2800, 5000],
  thinking: [2000, 3600], searching: [1000, 1800], working: [1800, 3200], excited: [1100, 2000],
  surprised: [2500, 4000], suspicious: [2600, 4500], angry: [2200, 3800], drowsy: [4000, 8000],
  happy: [2500, 4500], curious: [1800, 3200], confused: [2200, 3800], bored: [3500, 6000],
  proud: [3500, 6000], shy: [3000, 5500], sad: [4000, 7000], laughing: [1200, 2400],
  scared: [900, 1800], playful: [1500, 3000], celebrate: [1400, 2600], orbit: [4000, 8000],
  radar: [4000, 8000], progress: [4000, 8000], spawning: [1200, 1200], humming: [5000, 9000],
  loading: [6000, 10000], dictating: [4000, 8000], sending: [4000, 8000], receiving: [4000, 8000],
  uploading: [4000, 8000], writing: [4000, 8000], notifying: [1500, 2600], alerting: [2000, 3600],
  bouncing: [3000, 6000], dragging: [1600, 3000], "powering-down": [6000, 9000],
});

export const GROK_STATE_BLINK_INTERVAL_MS = freezeRecordOfArrays({
  sleeping: null, waking: null, idle: [6000, 14000], listening: [3000, 7000], thinking: [3500, 7000],
  searching: [1600, 4000], working: [2800, 5500], excited: [2000, 4000], surprised: [1800, 3500],
  suspicious: [4500, 8000], angry: [3500, 7000], drowsy: null, happy: [2500, 5000],
  curious: [2500, 5500], confused: [2800, 5500], bored: [4000, 8000], proud: [3500, 7000],
  shy: [3000, 6000], sad: [4000, 8000], laughing: [2500, 5000], scared: [1200, 3000],
  playful: [2000, 4500], celebrate: [2200, 4500], orbit: null, radar: null, progress: null,
  spawning: null, humming: [4000, 8000], loading: null, dictating: null, sending: null,
  receiving: null, uploading: null, writing: null, notifying: [2000, 4000], alerting: null,
  bouncing: null, dragging: [2200, 4500], "powering-down": null,
});

// Each state selects at most one auxiliary effect mode. Keeping this separate
// from the Codex row choreography prevents a cell from combining mutually
// exclusive effect modes.
export const GROK_STATE_EFFECT_MODES = Object.freeze({
  thinking: "dots",
  orbit: "orbit",
  radar: "radar",
  progress: "progress",
  spawning: "gather",
  dictating: "wave",
  sending: "send",
  receiving: "receive",
  uploading: "dock",
  bouncing: "ball",
  loading: "whirl",
  "powering-down": "standby",
  writing: "pencil",
  alerting: "bang",
});

// Grok Bot's body shape is an avatar-level choice, not an emotion or animation
// frame. Keeping the `blob` identity stable while its scale, lean, skew, and
// rotation change makes the atlas read as one elastic character instead of a
// sequence of different avatars. Alternate acting-study shapes remain available
// for future whole-pet variants but never replace the installed pet mid-animation.
export const CANONICAL_BODY_SHAPE = "blob";
const frame = (name, states, pose = {}) => ({
  name,
  states,
  ...pose,
  sourceShapeReference: pose.shape ?? CANONICAL_BODY_SHAPE,
  shape: CANONICAL_BODY_SHAPE,
});

const idleFrames = [
  frame("quiet-breath", ["idle"], {
    expression: "soft",
    topology: 0,
    shape: "blob",
    sourceEffect: "humming",
    effectPhase: 0,
    scaleX: 0.612,
    scaleY: 0.629,
  }),
  frame("ambient-orbit-a", ["humming"], {
    expression: "soft",
    topology: 0,
    sourceEffect: "humming",
    effectPhase: 1,
    rotation: -1,
    gazeX: 0.08,
    scaleX: 0.615,
    scaleY: 0.625,
  }),
  frame("shy-glance", ["shy"], {
    expression: "shy",
    topology: 24,
    sourceEffect: "humming",
    effectPhase: 2,
    rotation: -2,
    gazeX: -0.2,
    gazeY: 0.12,
    scaleX: 0.616,
    scaleY: 0.624,
  }),
  frame("idle-blink", ["sleeping"], {
    expression: "sleep",
    topology: 22,
    sourceEffect: "humming",
    effectPhase: 3,
    scaleX: 0.619,
    scaleY: 0.621,
  }),
  frame("ambient-orbit-b", ["idle", "humming"], {
    expression: "soft",
    topology: 8,
    sourceEffect: "humming",
    effectPhase: 4,
    rotation: 1,
    gazeX: -0.08,
    scaleX: 0.616,
    scaleY: 0.624,
  }),
  frame("idle-reopen", ["idle"], {
    expression: "soft",
    topology: 8,
    sourceEffect: "humming",
    effectPhase: 5,
    scaleX: 0.613,
    scaleY: 0.628,
  }),
  frame("neutral-look", ["idle"], {
    expression: "normal",
    topology: 0,
    shape: "blob",
    scaleX: 0.615,
    scaleY: 0.625,
  }),
];

const runRightFrames = [
  frame("right-search", ["searching"], { expression: "search", topology: 20, leanX: 2, skewX: 3, scaleX: 0.64, scaleY: 0.60, anchorY: 187 }),
  frame("right-receive-entry", ["searching"], { expression: "search", topology: 12, sourceEffect: "receive", sourceEffectActivation: 0.20, effectPhase: 0, leanX: 5, rotation: 2, scaleX: 0.615, scaleY: 0.625, anchorY: 184 }),
  frame("right-receive-open", ["listening", "receiving"], { expression: "roundAsym", topology: 19, sourceEffect: "receive", sourceEffectActivation: 0.35, effectPhase: 1, leanX: 7, rotation: 3, scaleX: 0.615, scaleY: 0.625, anchorY: 183 }),
  frame("right-receive-contact", ["receiving"], { expression: "roundAsym", topology: 0, sourceEffect: "receive", sourceEffectActivation: 0.50, effectPhase: 2, leanX: 8, rotation: 3, scaleX: 0.615, scaleY: 0.625, anchorY: 183 }),
  frame("right-receive-release", ["receiving"], { expression: "roundAsym", topology: 8, sourceEffect: "receive", sourceEffectActivation: 0.35, effectPhase: 3, leanX: 6, rotation: 2, scaleX: 0.615, scaleY: 0.625, anchorY: 184 }),
  frame("right-scan-release", ["searching"], { expression: "search", topology: 18, sourceEffect: "receive", sourceEffectActivation: 0.20, effectPhase: 4, leanX: 4, rotation: 1, scaleX: 0.615, scaleY: 0.625, anchorY: 185 }),
  frame("right-drag", ["dragging"], { expression: "effort-right", topology: 15, arm: "right-pull", leanX: 4, rotation: -2, scaleX: 0.635, scaleY: 0.605, anchorY: 187 }),
  frame("right-settle", ["idle"], { expression: "soft", topology: 0, leanX: 0, scaleX: 0.617, scaleY: 0.623, anchorY: 187 }),
];

const runLeftFrames = [
  frame("left-compose", ["writing"], { expression: "work", topology: 6, sourceState: "compressed-transition", leanX: -2, skewX: -2, scaleX: 0.635, scaleY: 0.605, anchorY: 187 }),
  frame("left-pencil-entry", ["writing"], { expression: "work", topology: 9, sourceEffect: "pencil", sourceEffectActivation: 0.28, effectPhase: 0, leanX: -4, rotation: -2, scaleX: 0.615, scaleY: 0.625, anchorY: 185 }),
  frame("left-pencil-write", ["writing"], { expression: "work", topology: 15, sourceEffect: "pencil", sourceEffectActivation: 0.46, effectPhase: 1, leanX: -6, rotation: -3, scaleX: 0.615, scaleY: 0.625, anchorY: 184 }),
  frame("left-pencil-lift", ["writing"], { expression: "work", topology: 9, sourceEffect: "pencil", sourceEffectActivation: 0.46, effectPhase: 3, leanX: -7, rotation: -3, scaleX: 0.615, scaleY: 0.625, anchorY: 184 }),
  frame("left-send", ["sending"], { expression: "side-left", topology: 0, sourceEffect: "send", sourceEffectActivation: 0.46, effectPhase: 2, leanX: -7, rotation: -3, scaleX: 0.615, scaleY: 0.625, anchorY: 184 }),
  frame("left-dock", ["uploading"], { expression: "alert", topology: 9, sourceEffect: "dock", sourceEffectActivation: 0.46, effectPhase: 3, leanX: -6, rotation: -2, scaleX: 0.615, scaleY: 0.625, anchorY: 185 }),
  frame("left-dock-release", ["uploading"], { expression: "alert", topology: 8, sourceEffect: "dock", sourceEffectActivation: 0.28, effectPhase: 4, leanX: -4, rotation: -1, scaleX: 0.615, scaleY: 0.625, anchorY: 186 }),
  frame("left-settle", ["idle"], { expression: "soft", topology: 0, leanX: 0, scaleX: 0.617, scaleY: 0.623, anchorY: 187 }),
];

const waveFrames = [
  frame("wave-rise", ["waking"], { expression: "wide", topology: 13, arm: "wave-rise", rotation: -2, scaleX: 0.615, scaleY: 0.625 }),
  frame("wave-dictate-entry", ["dictating", "listening"], { expression: "listen", topology: 1, sourceEffect: "wave", sourceEffectActivation: 0.18, effectPhase: 0, rotation: -1, scaleX: 0.615, scaleY: 0.625 }),
  frame("wave-dictate-open", ["dictating"], { expression: "roundAsym", topology: 19, sourceEffect: "wave", sourceEffectActivation: 0.28, effectPhase: 1, rotation: 1, scaleX: 0.615, scaleY: 0.625 }),
  frame("wave-settle", ["happy", "proud"], { expression: "happy", topology: 2, effect: "notify", arm: "wave-rest", rotation: 2, scaleX: 0.62, scaleY: 0.62 }),
];

const jumpFrames = [
  frame("jump-crouch", ["excited"], { expression: "wide", topology: 2, scaleX: 0.67, scaleY: 0.57, anchorY: 187 }),
  frame("jump-ball-rise", ["bouncing"], { expression: "happy", topology: 17, sourceEffect: "ball", sourceEffectActivation: 0.28, sourceSampleTimeMs: 150, effectPhase: 0, scaleX: 0.615, scaleY: 0.625, anchorY: 174 }),
  frame("jump-ball-impact", ["bouncing"], { expression: "wide", topology: 2, sourceEffect: "ball", sourceEffectActivation: 0.50, sourceSampleTimeMs: 271.887986, effectPhase: 1, scaleX: 0.615, scaleY: 0.625, anchorY: 178 }),
  frame("jump-ball-rebound", ["laughing", "playful"], { expression: "deepTall", topology: 11, sourceState: "playful", sourceEffect: "ball", sourceEffectActivation: 0.28, sourceSampleTimeMs: 581.887986, effectPhase: 2, rotation: 3, scaleX: 0.615, scaleY: 0.625, anchorY: 169 }),
  frame("jump-land", ["bouncing", "happy", "celebrate"], { expression: "happy", topology: 17, scaleX: 0.66, scaleY: 0.58, anchorY: 187 }),
];

const failedFrames = [
  frame("blocked-suspicious", ["suspicious"], { expression: "mixed", topology: 23, rotation: 4, scaleX: 0.61, scaleY: 0.63 }),
  frame("blocked-bang-entry", ["scared", "alerting"], { expression: "scared", topology: 21, sourceEffect: "bang", sourceEffectActivation: 0.28, effectPhase: 0, scaleX: 0.615, scaleY: 0.625 }),
  frame("blocked-bang-open", ["alerting"], { expression: "alert", topology: 3, sourceEffect: "bang", sourceEffectActivation: 0.46, effectPhase: 1, scaleX: 0.615, scaleY: 0.625 }),
  frame("blocked-bang-impact", ["alerting"], { expression: "alert", topology: 3, sourceEffect: "bang", sourceEffectActivation: 0.50, effectPhase: 2, scaleX: 0.615, scaleY: 0.625 }),
  frame("blocked-standby", ["powering-down"], { expression: "sleep", topology: 22, sourceEffect: "standby", sourceEffectActivation: 0.50, bodyOpacity: 0.72, effectPhase: 0, scaleX: 0.615, scaleY: 0.625, anchorY: 183 }),
  frame("blocked-sad-drift", ["drowsy", "bored", "sad"], { expression: "sad", topology: 4, sourceEffect: "standby", sourceEffectActivation: 0.46, bodyOpacity: 0.82, effectPhase: 1, rotation: -2, scaleX: 0.615, scaleY: 0.625, anchorY: 185 }),
  frame("blocked-shy-recover", ["shy"], { expression: "shy", topology: 24, sourceEffect: "standby", sourceEffectActivation: 0.28, bodyOpacity: 0.9, effectPhase: 2, rotation: -2, scaleX: 0.615, scaleY: 0.625, anchorY: 186 }),
  frame("blocked-confused-settle", ["confused"], { expression: "mixed", topology: 5, rotation: -3, scaleX: 0.612, scaleY: 0.628 }),
];

const waitingFrames = [
  frame("wait-attentive", ["listening"], { expression: "listen", topology: 10, arm: "ask-open", scaleX: 0.615, scaleY: 0.625 }),
  frame("wait-orbit-entry", ["curious", "orbit"], { expression: "curious", topology: 0, sourceEffect: "orbit", sourceEffectActivation: 0.28, effectPhase: 0, rotation: 1, gazeY: -0.12, scaleX: 0.615, scaleY: 0.625 }),
  frame("wait-orbit", ["orbit"], { expression: "wide", topology: 0, sourceEffect: "orbit", sourceEffectActivation: 0.50, effectPhase: 1, scaleX: 0.615, scaleY: 0.625 }),
  frame("wait-progress", ["progress"], { expression: "listen", topology: 8, sourceEffect: "progress", sourceEffectActivation: 0.50, effectPhase: 2, scaleX: 0.615, scaleY: 0.625 }),
  frame("wait-progress-release", ["progress"], { expression: "listen", topology: 8, sourceEffect: "progress", sourceEffectActivation: 0.28, effectPhase: 3, gazeX: 0.12, scaleX: 0.615, scaleY: 0.625 }),
  frame("wait-uncertain-settle", ["confused"], { expression: "mixed", topology: 14, arm: "ask-soft", rotation: -2, scaleX: 0.612, scaleY: 0.628 }),
];

const workingFrames = [
  frame("work-focus", ["working", "angry"], { expression: "focused", topology: 7, scaleX: 0.615, scaleY: 0.625 }),
  frame("work-gather", ["spawning"], { expression: "orbiting", topology: 3, sourceEffect: "gather", sourceEffectActivation: 0.32, effectPhase: 0, scaleX: 0.615, scaleY: 0.625 }),
  frame("work-think", ["thinking"], { expression: "mixed", topology: 16, sourceEffect: "dots", sourceEffectActivation: 0.46, effectPhase: 1, rotation: 2, gazeX: 0.14, gazeY: -0.16, scaleX: 0.615, scaleY: 0.625 }),
  frame("work-radar", ["radar"], { expression: "search", topology: 8, sourceEffect: "radar", sourceEffectActivation: 0.50, effectPhase: 2, rotation: -2, scaleX: 0.615, scaleY: 0.625 }),
  frame("work-whirl-release", ["loading", "thinking"], { expression: "lowerTall", topology: 8, sourceEffect: "whirl", sourceEffectActivation: 0.32, sourceSampleTimeMs: 220, effectPhase: 3, rotation: -1, scaleX: 0.615, scaleY: 0.625 }),
  frame("work-settle", ["working"], { expression: "focused", topology: 16, scaleX: 0.617, scaleY: 0.623 }),
];

const reviewFrames = [
  frame("review-ready", ["proud", "curious"], { expression: "proud", topology: 15, rotation: 1, scaleX: 0.618, scaleY: 0.622 }),
  frame("review-surprise", ["surprised", "spawning"], { expression: "burst", topology: 3, sourceEffect: "burst", effectPhase: 0, scaleX: 0.59, scaleY: 0.65 }),
  frame("review-ribbon-entry", ["notifying"], { expression: "wide", topology: 21, effect: "celebrate", effectPhase: 0, effectOpacity: 0.48, scaleX: 0.60, scaleY: 0.64 }),
  frame("review-ribbon-crest", ["happy"], { expression: "deepTall", topology: 11, effect: "celebrate", effectPhase: 1, effectOpacity: 0.78, rotation: -2, scaleX: 0.62, scaleY: 0.62 }),
  frame("review-ribbon-storm", ["celebrate"], { expression: "laugh", topology: 17, effect: "celebrate-storm", effectPhase: 2, effectOpacity: 1, rotation: 2, scaleX: 0.605, scaleY: 0.637 }),
  frame("review-ribbon-exit", ["proud", "curious"], { expression: "proud", topology: 15, effect: "celebrate", effectPhase: 3, effectOpacity: 0.28, scaleX: 0.618, scaleY: 0.622 }),
];

const gazeFrame = (angle) => {
  const radians = angle * Math.PI / 180;
  // The live pointer path clamps each normalized axis to +/-0.6 before applying
  // its 22/14 character-unit offsets. Preserve that reach in the fixed atlas.
  const horizontal = Math.max(-0.6, Math.min(0.6, Math.sin(radians)));
  const vertical = Math.max(-0.6, Math.min(0.6, -Math.cos(radians)));
  const cardinal = angle === 0 ? "up" : angle === 90 ? "right" : angle === 180 ? "down" : angle === 270 ? "left" : "diagonal";
  return frame(`gaze-${String(angle).padStart(3, "0")}`, ["idle"], {
    expression: `gaze-${cardinal}`,
    topology: 0,
    gazeAngle: angle,
    gazeX: horizontal,
    gazeY: vertical,
    leanX: horizontal * 3.1,
    // Vertical body follow-through keeps the smaller independently clamped eye motion
    // above Codex's feature-displacement threshold without enlarging eye reach.
    leanY: vertical * 3.6,
    shape: "blob",
    scaleX: 0.615 + Math.abs(horizontal) * 0.012,
    scaleY: 0.625 + Math.abs(vertical) * 0.01,
    anchorY: 187,
  });
};

export const ROWS = Object.freeze([
  { index: 0, id: "idle", label: "Idle / neutral", durations: [280, 110, 110, 140, 140, 320], frames: idleFrames },
  { index: 1, id: "running-right", label: "Travel right", durations: [120, 120, 120, 120, 120, 120, 120, 220], frames: runRightFrames },
  { index: 2, id: "running-left", label: "Travel left", durations: [120, 120, 120, 120, 120, 120, 120, 220], frames: runLeftFrames },
  { index: 3, id: "waving", label: "Greeting", durations: [140, 140, 140, 280], frames: waveFrames },
  { index: 4, id: "jumping", label: "Hover / jump", durations: [140, 140, 140, 140, 280], frames: jumpFrames },
  { index: 5, id: "failed", label: "Blocked", durations: [140, 140, 140, 140, 140, 140, 140, 240], frames: failedFrames },
  { index: 6, id: "waiting", label: "Needs input", durations: [150, 150, 150, 150, 150, 260], frames: waitingFrames },
  { index: 7, id: "running", label: "Active work", durations: [120, 120, 120, 120, 120, 220], frames: workingFrames },
  { index: 8, id: "review", label: "Ready / review", durations: [150, 150, 150, 150, 150, 280], frames: reviewFrames },
  { index: 9, id: "gaze-000-157", label: "Gaze 000–157.5°", durations: Array(8).fill(180), frames: Array.from({ length: 8 }, (_, index) => gazeFrame(index * 22.5)) },
  { index: 10, id: "gaze-180-337", label: "Gaze 180–337.5°", durations: Array(8).fill(180), frames: Array.from({ length: 8 }, (_, index) => gazeFrame(180 + index * 22.5)) },
]);

const behaviorCell = (row, frameName, behavior) => Object.freeze({ row, frame: frameName, behavior });

// Every character state has one canonical Codex cell. A shared cell means the
// states genuinely share that legal eye pose and physical behavior; it
// does not cause the atlas frame to render several state machines at once.
export const GROK_STATE_BEHAVIOR_CELLS = Object.freeze({
  sleeping: behaviorCell("idle", "idle-blink", "closed rest"),
  waking: behaviorCell("waving", "wave-rise", "wake and rise"),
  idle: behaviorCell("idle", "quiet-breath", "neutral breath"),
  listening: behaviorCell("waiting", "wait-attentive", "attentive hold"),
  thinking: behaviorCell("running", "work-think", "thought dots"),
  searching: behaviorCell("running-right", "right-search", "directional scan"),
  working: behaviorCell("running", "work-focus", "focused work beat"),
  excited: behaviorCell("jumping", "jump-crouch", "anticipation squash"),
  surprised: behaviorCell("review", "review-surprise", "surprise pop"),
  suspicious: behaviorCell("failed", "blocked-suspicious", "side-eye hold"),
  angry: behaviorCell("running", "work-focus", "tense concentration"),
  drowsy: behaviorCell("failed", "blocked-sad-drift", "drowsy deflation"),
  happy: behaviorCell("waving", "wave-settle", "warm greeting"),
  curious: behaviorCell("waiting", "wait-orbit-entry", "curious attention"),
  confused: behaviorCell("failed", "blocked-confused-settle", "uncertain tilt"),
  bored: behaviorCell("failed", "blocked-sad-drift", "long tired hold"),
  proud: behaviorCell("waving", "wave-settle", "proud settle"),
  shy: behaviorCell("idle", "shy-glance", "shy glance"),
  sad: behaviorCell("failed", "blocked-sad-drift", "sad droop"),
  laughing: behaviorCell("jumping", "jump-ball-rebound", "laughing rebound"),
  scared: behaviorCell("failed", "blocked-bang-entry", "fear stretch"),
  playful: behaviorCell("jumping", "jump-ball-rebound", "playful rebound"),
  celebrate: behaviorCell("review", "review-ribbon-storm", "celebration crest"),
  orbit: behaviorCell("waiting", "wait-orbit", "orbit loop"),
  radar: behaviorCell("running", "work-radar", "radar scan"),
  progress: behaviorCell("waiting", "wait-progress", "progress ring"),
  spawning: behaviorCell("running", "work-gather", "particle gather"),
  humming: behaviorCell("idle", "ambient-orbit-a", "humming satellites"),
  loading: behaviorCell("running", "work-whirl-release", "loading whirl"),
  dictating: behaviorCell("waving", "wave-dictate-open", "dictation wave"),
  writing: behaviorCell("running-left", "left-pencil-write", "pencil stroke"),
  sending: behaviorCell("running-left", "left-send", "outbound send"),
  receiving: behaviorCell("running-right", "right-receive-open", "inbound receive"),
  uploading: behaviorCell("running-left", "left-dock", "upload dock"),
  notifying: behaviorCell("review", "review-ribbon-entry", "notification pop"),
  alerting: behaviorCell("failed", "blocked-bang-open", "alert bang"),
  dragging: behaviorCell("running-right", "right-drag", "drag contact"),
  bouncing: behaviorCell("jumping", "jump-ball-impact", "bounce impact"),
  "powering-down": behaviorCell("failed", "blocked-standby", "standby collapse"),
});

const SOURCE_EFFECT_SAMPLE_TIMES_MS = Object.freeze({
  0.25: 68.66,
  0.5: 119.88,
  0.62: 149.89,
  0.9: 277.84,
});

function behaviorFrameForState(state) {
  const mapping = GROK_STATE_BEHAVIOR_CELLS[state];
  const row = ROWS.find((candidate) => candidate.id === mapping.row);
  return row.frames.find((candidate) => candidate.name === mapping.frame);
}

function sourceStateSnapshot(state, index) {
  const base = behaviorFrameForState(state);
  const sourceEffect = GROK_STATE_EFFECT_MODES[state];
  const activation = sourceEffect === "standby"
    ? 0.50
    : sourceEffect === "ball"
      ? 0.893166
      : sourceEffect === "whirl"
        ? 0.91518
        : sourceEffect
          ? 0.62
          : undefined;
  return frame(`source-state-${String(index).padStart(2, "0")}-${state}`, [state], {
    expression: base.expression,
    topology: GROK_STATE_EYE_TOPOLOGIES[state][0],
    sourceState: state,
    sourceEffect: sourceEffect ?? (state === "humming" ? "humming" : state === "surprised" ? "burst" : undefined),
    sourceEffectActivation: activation,
    sourceSampleTimeMs: sourceEffect === "ball" ? 271.887986 : sourceEffect === "whirl" ? 292.543 : undefined,
    effect: state === "celebrate" ? "celebrate-storm" : undefined,
    effectPhase: index % 4,
    rotation: base.rotation,
    gazeX: base.gazeX,
    gazeY: base.gazeY,
    scaleX: 0.615,
    scaleY: 0.625,
    anchorY: 187,
  });
}

// This unconstrained preview atlas preserves one explicit snapshot for every
// character state. It is inspection tooling, not an installable Codex row: the
// shipping atlas above remains organized as timed actions.
export const SOURCE_STATE_LIBRARY = Object.freeze(
  GROK_STATES.map((state, index) => sourceStateSnapshot(state, index)),
);

export const SOURCE_EFFECT_TRANSITIONS = Object.freeze(
  Object.entries(GROK_STATE_EFFECT_MODES).map(([state, effect], rowIndex) => {
    const frames = [0.25, 0.50, 0.62, 0.90].map((activation, columnIndex) => frame(
      `source-effect-${effect}-${String(activation).replace(".", "_")}`,
      [state],
      {
        expression: behaviorFrameForState(state).expression,
        topology: GROK_STATE_EYE_TOPOLOGIES[state][0],
        sourceState: state,
        sourceEffect: effect,
        sourceEffectActivation: activation,
        sourceSampleTimeMs: SOURCE_EFFECT_SAMPLE_TIMES_MS[activation],
        effectPhase: columnIndex,
        scaleX: 0.615,
        scaleY: 0.625,
        anchorY: 187,
      },
    ));

    return Object.freeze({
      state,
      effect,
      frames: Object.freeze(frames),
      rowIndex,
    });
  }),
);

export const POPULATED_FRAME_COUNT = ROWS.reduce((total, row) => total + row.frames.length, 0);

export const UNUSED_CELLS = Object.freeze(
  ROWS.flatMap((row) =>
    Array.from({ length: COLUMNS - row.frames.length }, (_, offset) => ({
      row: row.index,
      column: row.frames.length + offset,
    })),
  ),
);

export function frameAt(row, column) {
  return ROWS[row]?.frames[column] ?? null;
}

export function coveredStates() {
  return new Set(Object.keys(GROK_STATE_BEHAVIOR_CELLS));
}
