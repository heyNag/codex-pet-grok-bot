import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ATLAS, PET_VARIANT_NAMES, validatePets } from "../scripts/validate.mjs";
import { BODY_REGISTRY_LAYOUT, GROK_BODY_SHAPES } from "../src/grok-body-registry.mjs";
import { renderFrameSvg, THEME_PALETTES } from "../src/grok-art.mjs";
import { EYE_TOPOLOGY_LAYOUT, GROK_EYE_TOPOLOGIES } from "../src/grok-eye-topologies.mjs";
import { ACTIVATION_SPRING, sampleActivationOnset } from "../src/grok-motion.mjs";
import { SOURCE_EFFECTS, SOURCE_STATES } from "../preview/source-states.mjs";
import {
  GROK_STATES,
  GROK_STATE_BLINK_INTERVAL_MS,
  GROK_STATE_BEHAVIOR_CELLS,
  GROK_STATE_EFFECT_MODES,
  GROK_STATE_EYE_TOPOLOGIES,
  GROK_STATE_POSE_INTERVAL_MS,
  POPULATED_FRAME_COUNT,
  ROWS,
  SOURCE_EFFECT_TRANSITIONS,
  SOURCE_STATE_LIBRARY,
  UNUSED_CELLS,
  CANONICAL_BODY_SHAPE,
  coveredStates,
} from "../src/spec.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const SOURCE_MOTION_INPUTS = Object.freeze([
  ".node-version",
  "src/grok-art.mjs",
  "src/grok-body-registry.mjs",
  "src/grok-eye-topologies.mjs",
  "src/grok-motion.mjs",
  "src/spec.mjs",
  "scripts/build-source-motion.mjs",
  "package.json",
  "package-lock.json",
]);
const SOURCE_MOTION_ENCODER = Object.freeze({
  node: "v26.8.1",
  sharp: "0.35.4",
  libvips: "8.18.6",
  webp: "1.6.0",
});

const behaviorFrame = (state) => {
  const mapping = GROK_STATE_BEHAVIOR_CELLS[state];
  const row = ROWS.find((entry) => entry.id === mapping?.row);
  return row?.frames.find((frame) => frame.name === mapping.frame);
};

test("packaged manifests use distinct Codex pet IDs", async () => {
  const manifests = await Promise.all(PET_VARIANT_NAMES.map(async (variant) =>
    JSON.parse(await readFile(path.join(root, `pet/grok-bot-${variant}/pet.json`), "utf8"))));
  assert.deepEqual(manifests.map((manifest) => manifest.id), ["grok-bot-dark", "grok-bot-light"]);
  assert.deepEqual(manifests.map((manifest) => manifest.displayName), ["Grok Bot Dark", "Grok Bot Light"]);
  for (const manifest of manifests) {
    assert.equal(manifest.spriteVersionNumber, 2);
    assert.equal(manifest.spritesheetPath, "spritesheet.webp");
  }
});

test("v2 layout defines all 74 expressive cells", () => {
  assert.deepEqual(ROWS.map((row) => row.frames.length), [7, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]);
  assert.equal(ATLAS.populated.reduce((sum, count) => sum + count, 0), POPULATED_FRAME_COUNT);
  assert.equal(POPULATED_FRAME_COUNT, 74);
  assert.equal(ATLAS.columns * ATLAS.rows, 88);
  assert.equal(UNUSED_CELLS.length, 14);
});

test("row indices, identifiers, frame counts, and host timings are exact", () => {
  const expected = [
    [0, "idle", 7, [280, 110, 110, 140, 140, 320]],
    [1, "running-right", 8, [120, 120, 120, 120, 120, 120, 120, 220]],
    [2, "running-left", 8, [120, 120, 120, 120, 120, 120, 120, 220]],
    [3, "waving", 4, [140, 140, 140, 280]],
    [4, "jumping", 5, [140, 140, 140, 140, 280]],
    [5, "failed", 8, [140, 140, 140, 140, 140, 140, 140, 240]],
    [6, "waiting", 6, [150, 150, 150, 150, 150, 260]],
    [7, "running", 6, [120, 120, 120, 120, 120, 220]],
    [8, "review", 6, [150, 150, 150, 150, 150, 280]],
    [9, "gaze-000-157", 8, Array(8).fill(180)],
    [10, "gaze-180-337", 8, Array(8).fill(180)],
  ];
  assert.deepEqual(
    ROWS.map((row) => [row.index, row.id, row.frames.length, row.durations]),
    expected,
  );
});

test("all 39 Grok Bot states have an immutable truthful behavior-cell mapping", () => {
  assert.equal(GROK_STATES.length, 39);
  assert.deepEqual([...coveredStates()].sort(), [...GROK_STATES].sort());
  assert.deepEqual(Object.keys(GROK_STATE_BEHAVIOR_CELLS).sort(), [...GROK_STATES].sort());
  assert.equal(Object.isFrozen(GROK_STATE_BEHAVIOR_CELLS), true);
  for (const state of GROK_STATES) {
    const mapping = GROK_STATE_BEHAVIOR_CELLS[state];
    const frame = behaviorFrame(state);
    assert.equal(Object.isFrozen(mapping), true, `${state} behavior mapping must be immutable`);
    assert.ok(frame, `${state} must resolve to an authored cell`);
    assert.ok(frame.states.includes(state), `${state} behavior cell must name the behavior it represents`);
    assert.ok(
      GROK_STATE_EYE_TOPOLOGIES[state].includes(frame.topology),
      `${state} behavior cell must use one of that state's allowed character topologies`,
    );
    assert.ok(mapping.behavior.length > 0, `${state} behavior mapping must explain the reused motion`);
  }
});

test("the preview state inspector resolves the 39-state Character Lab atlas and its Codex mappings", () => {
  const previewBehaviorId = {
    idle: "idle",
    "running-right": "travel-right",
    "running-left": "travel-left",
    waving: "wave",
    jumping: "jump",
    failed: "failed",
    waiting: "waiting",
    running: "working",
    review: "review",
  };
  assert.equal(Object.isFrozen(SOURCE_STATES), true);
  assert.equal(SOURCE_STATES.length, GROK_STATES.length);
  assert.deepEqual(SOURCE_STATES.map(([state]) => state), GROK_STATES);
  for (const sourceEntry of SOURCE_STATES) {
    const [state, previewBehavior, column, explanation] = sourceEntry;
    const mapping = GROK_STATE_BEHAVIOR_CELLS[state];
    const row = ROWS.find((entry) => entry.id === mapping.row);
    const sourceSnapshot = SOURCE_STATE_LIBRARY[sourceEntry.index];
    assert.ok(row, `${state} preview mapping must resolve to a real row`);
    assert.equal(previewBehavior, previewBehaviorId[mapping.row], `${state} preview behavior drifted`);
    assert.equal(row.frames[column]?.name, mapping.frame, `${state} preview cell drifted`);
    assert.equal(sourceEntry.state, state);
    assert.equal(sourceEntry.index, GROK_STATES.indexOf(state));
    assert.equal(sourceSnapshot.sourceState, state, `${state} Character Lab atlas order drifted`);
    assert.equal(Math.floor(sourceEntry.index / 8), Math.floor(GROK_STATES.indexOf(state) / 8));
    assert.equal(sourceEntry.index % 8, GROK_STATES.indexOf(state) % 8);
    assert.equal(sourceEntry.behavior.row, row.index);
    assert.equal(sourceEntry.behavior.column, column);
    assert.ok(explanation.length >= 20, `${state} preview explanation is too terse`);
  }
});

test("the four formerly masked states now drive legal character poses", () => {
  for (const state of ["drowsy", "playful", "radar", "notifying"]) {
    const frame = behaviorFrame(state);
    assert.equal(frame.sourceState ?? frame.states[0], state, `${state} must drive renderer state tuning`);
    assert.ok(GROK_STATE_EYE_TOPOLOGIES[state].includes(frame.topology));
  }
});

test("character-linked eye and gesture families remain in the authored frames", () => {
  const surprise = SOURCE_STATE_LIBRARY.find((frame) => frame.sourceState === "surprised");
  const roundSurprise = renderFrameSvg(surprise);
  assert.match(roundSurprise, /data-eye-topology="3"/, "surprise must use its canonical round-eye topology");
  assert.equal((roundSurprise.match(/<path d=/g) ?? []).length >= 3, true, "the body plus both exact eyes must render as paths");

  const humming = SOURCE_STATE_LIBRARY.find((frame) => frame.sourceState === "humming");
  const orbit = renderFrameSvg(humming);
  assert.equal((orbit.match(/<circle /g) ?? []).length, 2, "humming must retain the exact opposed satellite pair");

  const installedOrbitSignatures = ROWS[0].frames.slice(0, 6).map((idleFrame) => {
    const svg = renderFrameSvg(idleFrame);
    const satellites = [...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)" fill="[^"]+" opacity="([^"]+)"\/>/g)]
      .map((match) => match.slice(1).join(","))
      .sort();
    assert.equal(satellites.length, 2, `${idleFrame.name} must contain both humming satellites`);
    return satellites.join("|");
  });
  assert.equal(
    new Set(installedOrbitSignatures).size,
    6,
    "the six timed idle cells must visibly advance through six unique satellite positions",
  );

  const wave = renderFrameSvg(ROWS[3].frames[0]);
  assert.equal(ROWS[3].frames[0].arm, "wave-rise");
  assert.equal((wave.match(/stroke-width="17"/g) ?? []).length, 1, "the notification wave must retain its attached arm");
});

test("morphed effect bodies suppress incompatible full-size Codex attachments", () => {
  const accentPattern = /#(?:F9705C|5B95F0|3FBE86|F5B13F|9A72EE|35C3BD)/;
  for (const transition of SOURCE_EFFECT_TRANSITIONS) {
    const beforeBoundary = renderFrameSvg(transition.frames[0]);
    const atBoundary = renderFrameSvg(transition.frames[1]);
    assert.match(beforeBoundary, /data-source-eyes-hidden="false"/, `${transition.effect} hid eyes before A=.50`);
    assert.match(atBoundary, /data-source-eyes-hidden="true"/, `${transition.effect} did not hide eyes at A=.50`);
  }

  const hybrid = {
    ...ROWS[6].frames[0],
    name: "attachment-suppression-proof",
    sourceEffect: "receive",
    sourceEffectActivation: 0.50,
    effect: "celebrate-storm",
    arm: "ask-open",
  };
  const svg = renderFrameSvg(hybrid);
  assert.match(svg, /data-source-eyes-hidden="true"/);
  assert.doesNotMatch(svg, /stroke-width="17"/, "the collapsed body retained a floating full-size arm");
  assert.doesNotMatch(svg, accentPattern, "the active mode retained an incompatible generic ribbon effect");
});

test("all eye topologies and body rings are available to the choreography", () => {
  assert.equal(EYE_TOPOLOGY_LAYOUT.poseCount, 25);
  assert.equal(GROK_EYE_TOPOLOGIES.length, 25);
  assert.ok(GROK_EYE_TOPOLOGIES.every((pair) => pair.length === 2 && pair.every((eye) => eye.length === 48)));
  const usedTopologies = new Set(ROWS.slice(0, 9).flatMap((row) => row.frames.map((frame) => frame.topology)));
  assert.deepEqual([...usedTopologies].sort((left, right) => left - right), Array.from({ length: 25 }, (_, index) => index));
  let compressedTransitionCount = 0;
  for (const row of ROWS) {
    for (const frame of row.frames) {
      if (frame.sourceState === "compressed-transition") {
        compressedTransitionCount += 1;
        assert.equal(frame.topology, 6);
        continue;
      }
      assert.ok(frame.states.length > 0, `${row.id}/${frame.name} must name its rendered character state`);
      for (const state of frame.states) {
        assert.ok(
          GROK_STATE_EYE_TOPOLOGIES[state].includes(frame.topology),
          `${row.id}/${frame.name} topology ${frame.topology} is not legal for ${state}`,
        );
      }
    }
  }
  assert.equal(compressedTransitionCount, 1, "topology 6 is the sole uncatalogued compressed in-between");
  assert.deepEqual(Object.keys(GROK_STATE_POSE_INTERVAL_MS).sort(), [...GROK_STATES].sort());
  assert.deepEqual(Object.keys(GROK_STATE_BLINK_INTERVAL_MS).sort(), [...GROK_STATES].sort());

  assert.equal(BODY_REGISTRY_LAYOUT.shapeCount, 18);
  assert.equal(Object.keys(GROK_BODY_SHAPES).length, 18);
  assert.ok(Object.values(GROK_BODY_SHAPES).every((shape) => shape.ring.length === 96 && shape.path.endsWith("Z")));

  assert.equal(sha256(JSON.stringify(GROK_BODY_SHAPES)), BODY_REGISTRY_LAYOUT.payloadSha256);
  assert.equal(sha256(JSON.stringify(GROK_EYE_TOPOLOGIES)), EYE_TOPOLOGY_LAYOUT.jsonSha256);
  const quantizedEyes = Buffer.alloc(EYE_TOPOLOGY_LAYOUT.poseCount * 2 * 48 * 2 * 2);
  let offset = 0;
  for (const pose of GROK_EYE_TOPOLOGIES) {
    for (const eye of pose) {
      for (const [x, y] of eye) {
        quantizedEyes.writeUInt16LE(Math.round(x * 100), offset);
        quantizedEyes.writeUInt16LE(Math.round(y * 100), offset + 2);
        offset += 4;
      }
    }
  }
  assert.equal(sha256(quantizedEyes), EYE_TOPOLOGY_LAYOUT.packedSha256);
});

test("all 14 effect modes have one truthful behavior cell", () => {
  const expected = {
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
  };
  assert.deepEqual(GROK_STATE_EFFECT_MODES, expected);
  assert.deepEqual(
    Object.fromEntries(SOURCE_EFFECTS.map(({ state, effect }) => [state, effect])),
    expected,
  );
  assert.equal(new Set(Object.values(GROK_STATE_EFFECT_MODES)).size, 14);
  assert.equal(SOURCE_EFFECT_TRANSITIONS.length, 14);
  for (const [state, effect] of Object.entries(GROK_STATE_EFFECT_MODES)) {
    assert.equal(behaviorFrame(state).sourceEffect, effect, `${state} must render only its ${effect} mode`);
    const sourceSnapshot = SOURCE_STATE_LIBRARY.find((frame) => frame.sourceState === state);
    assert.equal(sourceSnapshot.sourceEffect, effect, `${state} Character Lab snapshot must retain ${effect}`);
    const transition = SOURCE_EFFECT_TRANSITIONS.find((entry) => entry.state === state);
    assert.equal(transition.effect, effect);
    assert.deepEqual(transition.frames.map((frame) => frame.sourceEffectActivation), [0.25, 0.5, 0.62, 0.9]);
  }

  for (const row of ROWS.slice(0, 9)) {
    for (const frame of row.frames) {
      assert.equal(frame.sourceEffects, undefined, `${row.id}/${frame.name} must not combine effect modes`);
      if (frame.sourceEffect != null) assert.equal(typeof frame.sourceEffect, "string");
    }
  }
});

test("motion studies reproduce the activation spring landmarks", () => {
  assert.deepEqual(ACTIVATION_SPRING, {
    damping: 28,
    stiffness: 196,
    maximumStepSeconds: 1 / 120,
  });
  for (const [seconds, activation] of [
    [0.06866, 0.25],
    [0.11988, 0.50],
    [0.14989, 0.62],
    [0.27784, 0.90],
  ]) {
    assert.ok(
      Math.abs(sampleActivationOnset(seconds) - activation) < 0.005,
      `activation A=${activation} drifted from its motion landmark`,
    );
  }
});

test("whirl ribbons reveal progressively after the emission threshold", () => {
  const whirl = SOURCE_EFFECT_TRANSITIONS.find(({ effect }) => effect === "whirl").frames[0];
  const atThreshold = renderFrameSvg({ ...whirl, sourceEffectActivation: 0.915, sourceSampleTimeMs: 292.5 });
  assert.doesNotMatch(atThreshold, /data-source-whirl=/, "whirl ribbons must not pop in at the threshold frame");

  const entering = renderFrameSvg({ ...whirl, sourceEffectActivation: 0.92, sourceSampleTimeMs: 300 });
  const entryReveal = Number(entering.match(/data-source-whirl-reveal="([^"]+)"/)?.[1]);
  assert.ok(entryReveal > 0 && entryReveal < 0.5, "early whirl ribbons must be only partially revealed");
  assert.match(entering, /stroke-dasharray="1"/);
  assert.doesNotMatch(entering, /stroke-dashoffset="0"/, "early whirl paths must not be full length");

  const mature = renderFrameSvg({ ...whirl, sourceEffectActivation: 0.993, sourceSampleTimeMs: 500 });
  assert.match(mature, /data-source-whirl-reveal="1"/);
  assert.match(mature, /stroke-dashoffset="0"/);
});

test("all 28 lossless motion studies are sealed to their generator inputs", async () => {
  const manifestPath = path.join(root, "preview/source-lab/motion/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, "grok-bot-motion-studies");
  assert.equal(manifest.frameRate, 60);
  assert.equal(manifest.nominalFrameCount, 156);
  assert.equal(manifest.presentationDurationMs, 2600);
  assert.deepEqual(manifest.encoder, SOURCE_MOTION_ENCODER);
  assert.deepEqual(manifest.spring, ACTIVATION_SPRING);
  assert.deepEqual(Object.keys(manifest.inputs), SOURCE_MOTION_INPUTS);
  for (const [relative, expectedHash] of Object.entries(manifest.inputs)) {
    assert.equal(sha256(await readFile(path.join(root, relative))), expectedHash, `${relative} changed after motion generation`);
  }
  assert.equal(manifest.assets.length, 28);
  assert.deepEqual(new Set(manifest.assets.map(({ theme }) => theme)), new Set(["dark", "light"]));
  assert.deepEqual(
    new Set(manifest.assets.map(({ effect }) => effect)),
    new Set(Object.values(GROK_STATE_EFFECT_MODES)),
  );
  for (const asset of manifest.assets) {
    const bytes = await readFile(path.join(root, asset.path));
    const metadata = await sharp(bytes, { animated: true }).metadata();
    assert.equal(sha256(bytes), asset.sha256, `${asset.path} bytes drifted`);
    assert.equal(metadata.width, 192);
    assert.equal(metadata.pageHeight, 208);
    assert.equal(metadata.pages, asset.pages);
    assert.equal(metadata.loop, 0);
    // libwebp merges byte-identical adjacent samples while preserving their
    // combined delay; slower auxiliary phases therefore have fewer pages than
    // the 156 nominal samples without losing timeline duration.
    assert.ok(metadata.pages >= 75, `${asset.path} lost too many distinct motion samples`);
    assert.equal(metadata.delay.reduce((total, delay) => total + delay, 0), asset.durationMs);
    assert.equal(asset.durationMs, 2600);
  }
});

test("standby uses the exact eye-hide landmark and a materially collapsed inner body", () => {
  const standby = behaviorFrame("powering-down");
  assert.equal(standby.sourceEffect, "standby");
  assert.equal(standby.sourceEffectActivation, 0.5);
  assert.ok(standby.bodyOpacity >= 0.7 && standby.bodyOpacity <= 0.75);
  const svg = renderFrameSvg(standby);
  assert.match(svg, /data-source-eyes-hidden="true"/);
  assert.match(svg, /scale\(0\.557\)/, "standby must retain the radius-13 collapse at A=.50");
});

test("the default blob remains one persistent avatar across every frame", () => {
  assert.equal(CANONICAL_BODY_SHAPE, "blob");
  for (const row of ROWS) {
    for (const frame of row.frames) {
      assert.equal(frame.shape, CANONICAL_BODY_SHAPE, `${row.id}/${frame.name} changed avatar identity`);
      assert.equal(typeof frame.sourceShapeReference, "string");
    }
  }
});

test("theme variants use only the exact inverse and accent colors", () => {
  const accents = {
    coral: "#F9705C",
    blue: "#5B95F0",
    green: "#3FBE86",
    gold: "#F5B13F",
    violet: "#9A72EE",
    teal: "#35C3BD",
  };
  assert.deepEqual(THEME_PALETTES["dark-codex"], {
    ...accents,
    body: "#FFFFFF",
    eye: "#000000",
    keyline: "#000000",
  });
  assert.deepEqual(THEME_PALETTES["light-codex"], {
    ...accents,
    body: "#000000",
    eye: "#FFFFFF",
    keyline: "#FFFFFF",
  });
});

test("preview intentionally has no reduced-motion branch", async () => {
  const css = await readFile(path.join(root, "preview/styles.css"), "utf8");
  const app = await readFile(path.join(root, "preview/app.mjs"), "utf8");
  assert.doesNotMatch(`${css}\n${app}`, /prefers-reduced-motion|reduceMotion|reducedMotion/);
});

test("gaze cells advance clockwise with the exact pointer clamp", () => {
  const gazeFrames = ROWS.slice(9).flatMap((row) => row.frames);
  const angles = gazeFrames.map((frame) => frame.gazeAngle);
  assert.deepEqual(angles, Array.from({ length: 16 }, (_, index) => index * 22.5));
  assert.equal(new Set(gazeFrames.map((frame) => `${frame.gazeX.toFixed(6)},${frame.gazeY.toFixed(6)}`)).size, 16);
  for (const frame of gazeFrames) {
    assert.ok(Math.abs(frame.gazeX) <= 0.6 + Number.EPSILON);
    assert.ok(Math.abs(frame.gazeY) <= 0.6 + Number.EPSILON);
    assert.ok(
      Math.abs(Math.abs(frame.gazeX) - 0.6) < 1e-12 || Math.abs(Math.abs(frame.gazeY) - 0.6) < 1e-12,
      "the character model clamps each pointer axis independently",
    );
    assert.ok(Math.abs(frame.leanX - frame.gazeX * 3.1) < 1e-12);
    assert.ok(Math.abs(frame.leanY - frame.gazeY * 3.6) < 1e-12);
  }
});

test("both built pets pass deterministic validation", async () => {
  const aggregate = await validatePets({ root, writeReport: false });
  assert.deepEqual(aggregate.errors, []);
  assert.deepEqual(aggregate.warnings, []);
  assert.equal(aggregate.ok, true);
  for (const variant of PET_VARIANT_NAMES) {
    const report = aggregate.variants[variant];
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.warnings, []);
    assert.equal(report.ok, true);
    assert.equal(report.spritesheet.width, 1536);
    assert.equal(report.spritesheet.height, 2288);
    assert.equal(report.spritesheet.expectedUnusedCells, 14);
  }
});
