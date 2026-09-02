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
    sourceState: "idle",
    scaleX: 0.615,
    scaleY: 0.625,
    anchorY: 187,
  }),
  frame("ambient-orbit-a", ["humming"], {
    expression: "soft",
    topology: 0,
    sourceState: "idle",
    rotation: -0.4,
    gazeX: 0.04,
    scaleX: 0.613,
    scaleY: 0.627,
    anchorY: 187,
  }),
  frame("shy-glance", ["shy"], {
    expression: "shy",
    topology: 0,
    topologyTo: 8,
    topologyMix: 0.12,
    sourceState: "idle",
    rotation: -0.6,
    gazeX: -0.035,
    gazeY: 0.025,
    scaleX: 0.611,
    scaleY: 0.629,
    anchorY: 187,
  }),
  frame("idle-blink", ["sleeping"], {
    expression: "sleep",
    topology: 0,
    topologyTo: 8,
    topologyMix: 0.55,
    sourceState: "idle",
    rotation: 0.5,
    gazeX: -0.04,
    gazeY: 0.03,
    scaleX: 0.61,
    scaleY: 0.63,
    anchorY: 187,
  }),
  frame("ambient-orbit-b", ["idle", "humming"], {
    expression: "soft",
    topology: 0,
    topologyTo: 8,
    topologyMix: 0.16,
    sourceState: "idle",
    rotation: 0.3,
    gazeX: -0.02,
    scaleX: 0.612,
    scaleY: 0.628,
    anchorY: 187,
  }),
  frame("idle-reopen", ["idle"], {
    expression: "soft",
    topology: 0,
    sourceState: "idle",
    rotation: 0.1,
    gazeX: 0.02,
    scaleX: 0.614,
    scaleY: 0.626,
    anchorY: 187,
  }),
];

const runRightFrames = [
  frame("right-search", ["searching"], { expression: "search", topology: 15, sourceState: "searching", effect: "trail-right", effectPhase: 0, effectOpacity: 0.34, gazeX: 0.28, leanX: 3, rotation: 0, scaleX: 0.622, scaleY: 0.618, anchorY: 186 }),
  frame("right-receive-entry", ["searching"], { expression: "search", topology: 15, sourceState: "searching", effect: "trail-right", effectPhase: 0, effectOpacity: 0.34, gazeX: 0.3, leanX: 3.6, rotation: 0.6, scaleX: 0.618, scaleY: 0.622, anchorY: 185.5 }),
  frame("right-receive-open", ["listening", "receiving"], { expression: "search", topology: 15, sourceState: "searching", effect: "trail-right", effectPhase: 0, effectOpacity: 0.34, gazeX: 0.31, leanX: 4.2, rotation: 1, scaleX: 0.614, scaleY: 0.626, anchorY: 185 }),
  frame("right-receive-contact", ["receiving"], { expression: "search", topology: 15, sourceState: "searching", effect: "trail-right", effectPhase: 0, effectOpacity: 0.34, gazeX: 0.3, leanX: 3.6, rotation: 0.5, scaleX: 0.618, scaleY: 0.622, anchorY: 185.5 }),
  frame("right-receive-release", ["receiving"], { expression: "search", topology: 15, sourceState: "searching", effect: "trail-right", effectPhase: 0, effectOpacity: 0.34, gazeX: 0.275, leanX: 3.1, rotation: 0.1, scaleX: 0.621, scaleY: 0.619, anchorY: 186 }),
  frame("right-scan-release", ["searching"], { expression: "search", topology: 15, sourceState: "searching", effect: "trail-right", effectPhase: 0, effectOpacity: 0.34, gazeX: 0.26, leanX: 2.4, rotation: -0.6, scaleX: 0.618, scaleY: 0.622, anchorY: 185.5 }),
  frame("right-drag", ["dragging"], { expression: "search", topology: 15, sourceState: "searching", effect: "trail-right", effectPhase: 0, effectOpacity: 0.34, gazeX: 0.25, leanX: 1.8, rotation: -1, scaleX: 0.614, scaleY: 0.626, anchorY: 185 }),
  frame("right-settle", ["idle"], { expression: "search", topology: 15, sourceState: "searching", effect: "trail-right", effectPhase: 0, effectOpacity: 0.34, gazeX: 0.26, leanX: 2.4, rotation: -0.5, scaleX: 0.618, scaleY: 0.622, anchorY: 185.5 }),
];

const runLeftFrames = [
  frame("left-compose", ["writing"], { expression: "work", topology: 9, sourceState: "writing", effect: "trail-left", effectPhase: 0, effectOpacity: 0.34, gazeX: -0.28, leanX: -3, rotation: 0, scaleX: 0.622, scaleY: 0.618, anchorY: 186 }),
  frame("left-pencil-entry", ["writing"], { expression: "work", topology: 9, sourceState: "writing", effect: "trail-left", effectPhase: 0, effectOpacity: 0.34, gazeX: -0.3, leanX: -3.6, rotation: -0.6, scaleX: 0.618, scaleY: 0.622, anchorY: 185.5 }),
  frame("left-pencil-write", ["writing"], { expression: "work", topology: 9, sourceState: "writing", effect: "trail-left", effectPhase: 0, effectOpacity: 0.34, gazeX: -0.31, leanX: -4.2, rotation: -1, scaleX: 0.614, scaleY: 0.626, anchorY: 185 }),
  frame("left-pencil-lift", ["writing"], { expression: "work", topology: 9, sourceState: "writing", effect: "trail-left", effectPhase: 0, effectOpacity: 0.34, gazeX: -0.3, leanX: -3.6, rotation: -0.5, scaleX: 0.618, scaleY: 0.622, anchorY: 185.5 }),
  frame("left-send", ["sending"], { expression: "work", topology: 9, sourceState: "writing", effect: "trail-left", effectPhase: 0, effectOpacity: 0.34, gazeX: -0.275, leanX: -3.1, rotation: -0.1, scaleX: 0.621, scaleY: 0.619, anchorY: 186 }),
  frame("left-dock", ["uploading"], { expression: "work", topology: 9, sourceState: "writing", effect: "trail-left", effectPhase: 0, effectOpacity: 0.34, gazeX: -0.26, leanX: -2.4, rotation: 0.6, scaleX: 0.618, scaleY: 0.622, anchorY: 185.5 }),
  frame("left-dock-release", ["uploading"], { expression: "work", topology: 9, sourceState: "writing", effect: "trail-left", effectPhase: 0, effectOpacity: 0.34, gazeX: -0.25, leanX: -1.8, rotation: 1, scaleX: 0.614, scaleY: 0.626, anchorY: 185 }),
  frame("left-settle", ["idle"], { expression: "work", topology: 9, sourceState: "writing", effect: "trail-left", effectPhase: 0, effectOpacity: 0.34, gazeX: -0.26, leanX: -2.4, rotation: 0.5, scaleX: 0.618, scaleY: 0.622, anchorY: 185.5 }),
];

const waveFrames = [
  frame("wave-rise", ["waking"], { expression: "happy", topology: 2, sourceState: "happy", arm: "wave-rise", rotation: -1, scaleX: 0.614, scaleY: 0.626, anchorY: 187 }),
  frame("wave-dictate-entry", ["dictating", "listening"], { expression: "happy", topology: 2, sourceState: "happy", arm: "wave-open", rotation: 0.8, scaleX: 0.612, scaleY: 0.628, anchorY: 186 }),
  frame("wave-dictate-open", ["dictating"], { expression: "happy", topology: 2, sourceState: "happy", arm: "wave-sweep", rotation: -0.8, scaleX: 0.614, scaleY: 0.626, anchorY: 187 }),
  frame("wave-settle", ["happy", "proud"], { expression: "happy", topology: 2, sourceState: "happy", arm: "wave-rest", rotation: 0, scaleX: 0.616, scaleY: 0.624, anchorY: 187 }),
];

const jumpFrames = [
  frame("jump-crouch", ["excited"], { expression: "happy", topology: 17, sourceState: "happy", scaleX: 0.64, scaleY: 0.60, anchorY: 187 }),
  frame("jump-ball-rise", ["bouncing"], { expression: "happy", topology: 17, sourceState: "happy", rotation: -0.7, scaleX: 0.605, scaleY: 0.635, anchorY: 181 }),
  frame("jump-ball-impact", ["bouncing"], { expression: "happy", topology: 17, sourceState: "happy", rotation: 0.7, scaleX: 0.61, scaleY: 0.63, anchorY: 176 }),
  frame("jump-ball-rebound", ["laughing", "playful"], { expression: "happy", topology: 17, sourceState: "happy", rotation: 0.4, scaleX: 0.605, scaleY: 0.635, anchorY: 181 }),
  frame("jump-land", ["bouncing", "happy", "celebrate"], { expression: "happy", topology: 17, sourceState: "happy", scaleX: 0.65, scaleY: 0.59, anchorY: 187 }),
];

const failedFrames = [
  frame("blocked-suspicious", ["suspicious"], { expression: "mixed", topology: 5, sourceState: "confused", rotation: -2, gazeX: -0.08, scaleX: 0.612, scaleY: 0.628, anchorY: 186 }),
  frame("blocked-bang-entry", ["scared", "alerting"], { expression: "mixed", topology: 5, topologyTo: 4, topologyMix: 0.25, sourceState: "confused", rotation: -1, gazeX: -0.04, scaleX: 0.616, scaleY: 0.624, anchorY: 187 }),
  frame("blocked-bang-open", ["alerting"], { expression: "sad", topology: 5, topologyTo: 4, topologyMix: 0.5, sourceState: "confused", rotation: 0, scaleX: 0.62, scaleY: 0.62, anchorY: 187 }),
  frame("blocked-bang-impact", ["alerting"], { expression: "sad", topology: 5, topologyTo: 4, topologyMix: 0.75, sourceState: "confused", rotation: 1, gazeY: 0.04, scaleX: 0.616, scaleY: 0.624, anchorY: 187 }),
  frame("blocked-standby", ["powering-down"], { expression: "sad", topology: 4, sourceState: "confused", rotation: 2, gazeY: 0.08, scaleX: 0.612, scaleY: 0.628, anchorY: 186 }),
  frame("blocked-sad-drift", ["drowsy", "bored", "sad"], { expression: "sad", topology: 4, topologyTo: 5, topologyMix: 0.5, sourceState: "confused", rotation: 1, gazeY: 0.06, scaleX: 0.61, scaleY: 0.63, anchorY: 185 }),
  frame("blocked-shy-recover", ["shy"], { expression: "mixed", topology: 4, topologyTo: 5, topologyMix: 0.8, sourceState: "confused", rotation: 0, gazeX: -0.04, scaleX: 0.61, scaleY: 0.63, anchorY: 185 }),
  frame("blocked-confused-settle", ["confused"], { expression: "mixed", topology: 5, sourceState: "confused", rotation: -1, gazeX: -0.08, scaleX: 0.612, scaleY: 0.628, anchorY: 186 }),
];

const waitingFrames = [
  frame("wait-attentive", ["listening"], { expression: "listen", topology: 10, sourceState: "listening", arm: "ask-soft", rotation: -0.8, gazeX: -0.08, scaleX: 0.613, scaleY: 0.627, anchorY: 187 }),
  frame("wait-orbit-entry", ["curious", "orbit"], { expression: "listen", topology: 10, topologyTo: 0, topologyMix: 0.3, sourceState: "listening", arm: "ask-soft", rotation: -0.3, gazeX: -0.03, gazeY: -0.03, scaleX: 0.615, scaleY: 0.625, anchorY: 186 }),
  frame("wait-orbit", ["orbit"], { expression: "curious", topology: 10, topologyTo: 0, topologyMix: 0.65, sourceState: "listening", arm: "ask-soft", rotation: 0.4, gazeX: 0.04, gazeY: -0.05, scaleX: 0.617, scaleY: 0.623, anchorY: 186 }),
  frame("wait-progress", ["progress"], { expression: "curious", topology: 0, sourceState: "listening", arm: "ask-soft", rotation: 0.8, gazeX: 0.08, gazeY: -0.03, scaleX: 0.616, scaleY: 0.624, anchorY: 187 }),
  frame("wait-progress-release", ["progress"], { expression: "listen", topology: 0, topologyTo: 10, topologyMix: 0.5, sourceState: "listening", arm: "ask-soft", rotation: 0.3, gazeX: 0.03, scaleX: 0.614, scaleY: 0.626, anchorY: 187 }),
  frame("wait-uncertain-settle", ["confused"], { expression: "listen", topology: 10, sourceState: "listening", arm: "ask-soft", rotation: -0.4, gazeX: -0.04, scaleX: 0.613, scaleY: 0.627, anchorY: 187 }),
];

const workingFrames = [
  frame("work-focus", ["working", "angry"], { expression: "focused", topology: 7, sourceState: "working", rotation: -0.5, gazeX: -0.05, scaleX: 0.613, scaleY: 0.627, anchorY: 187 }),
  frame("work-gather", ["spawning"], { expression: "focused", topology: 7, topologyTo: 16, topologyMix: 0.3, sourceState: "working", rotation: 0, gazeX: 0.02, gazeY: -0.03, scaleX: 0.615, scaleY: 0.625, anchorY: 186 }),
  frame("work-think", ["thinking"], { expression: "focused", topology: 7, topologyTo: 16, topologyMix: 0.65, sourceState: "working", rotation: 0.6, gazeX: 0.08, gazeY: -0.06, scaleX: 0.617, scaleY: 0.623, anchorY: 186 }),
  frame("work-radar", ["radar"], { expression: "focused", topology: 16, sourceState: "working", rotation: 0.3, gazeX: 0.05, gazeY: -0.05, scaleX: 0.616, scaleY: 0.624, anchorY: 187 }),
  frame("work-whirl-release", ["loading", "thinking"], { expression: "focused", topology: 16, topologyTo: 7, topologyMix: 0.55, sourceState: "working", rotation: -0.3, gazeX: -0.01, gazeY: -0.02, scaleX: 0.614, scaleY: 0.626, anchorY: 187 }),
  frame("work-settle", ["working"], { expression: "focused", topology: 7, sourceState: "working", rotation: -0.6, gazeX: -0.05, scaleX: 0.613, scaleY: 0.627, anchorY: 187 }),
];

const reviewFrames = [
  frame("review-ready", ["proud", "curious"], { expression: "proud", topology: 15, sourceState: "proud", effect: "celebrate", effectPhase: 0, effectOpacity: 0.16, rotation: -0.5, scaleX: 0.614, scaleY: 0.626, anchorY: 187 }),
  frame("review-surprise", ["surprised", "spawning"], { expression: "happy", topology: 15, topologyTo: 2, topologyMix: 0.3, sourceState: "proud", effect: "celebrate", effectPhase: 0, effectOpacity: 0.3, rotation: 0, scaleX: 0.616, scaleY: 0.624, anchorY: 186 }),
  frame("review-ribbon-entry", ["notifying"], { expression: "happy", topology: 15, topologyTo: 2, topologyMix: 0.65, sourceState: "proud", effect: "celebrate", effectPhase: 0, effectOpacity: 0.5, rotation: 0.8, scaleX: 0.618, scaleY: 0.622, anchorY: 185 }),
  frame("review-ribbon-crest", ["happy"], { expression: "happy", topology: 2, sourceState: "proud", effect: "celebrate", effectPhase: 0, effectOpacity: 0.66, rotation: 0.4, scaleX: 0.62, scaleY: 0.62, anchorY: 185 }),
  frame("review-ribbon-storm", ["celebrate"], { expression: "happy", topology: 2, topologyTo: 15, topologyMix: 0.55, sourceState: "proud", effect: "celebrate", effectPhase: 0, effectOpacity: 0.44, rotation: -0.2, scaleX: 0.617, scaleY: 0.623, anchorY: 186 }),
  frame("review-ribbon-exit", ["proud", "curious"], { expression: "proud", topology: 15, sourceState: "proud", effect: "celebrate", effectPhase: 0, effectOpacity: 0.24, rotation: -0.6, scaleX: 0.614, scaleY: 0.626, anchorY: 187 }),
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
    // The body follows the discrete eye target just enough to keep the full
    // 16-direction gaze readable after the host's pixelated downscale.
    leanX: horizontal * 10.4,
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
