import { CELL_HEIGHT, CELL_WIDTH } from "./spec.mjs";
import { GROK_BODY_SHAPES } from "./grok-body-registry.mjs";
import { GROK_EYE_TOPOLOGIES } from "./grok-eye-topologies.mjs";

export const VIEWBOX = "-15 -15 259 259";
export const CENTER = 114.2705;

// Canonical 259px hero geometry for the resting body.
export const BLOB_PATH = "M228.541 114.228C228.541 130.133 225.184 145.994 218.738 160.534C212.674 174.217 203.904 186.669 193.065 196.988C155.933 232.34 99.497 238.596 55.5255 212.24C45.097 205.99 35.6851 198.072 27.7451 188.866C19.1926 178.953 12.3686 167.569 7.65781 155.351C2.60712 142.264 0 128.257 0 114.228C0 98.3219 3.35751 82.4611 9.80315 67.9215C15.8672 54.2382 24.6377 41.7862 35.4767 31.4668C72.6081 -3.88483 129.044 -10.1413 173.016 16.2153C183.444 22.4653 192.856 30.3829 200.796 39.5896C209.349 49.5018 216.173 60.8859 220.883 73.1037C225.934 86.1906 228.541 100.198 228.541 114.228Z";

const accents = Object.freeze({
  coral: "#F9705C",
  blue: "#5B95F0",
  green: "#3FBE86",
  gold: "#F5B13F",
  violet: "#9A72EE",
  teal: "#35C3BD",
});

// Grok Bot uses exact opposites: #000000 on a light surface and #FFFFFF on a
// dark surface. Each package carries one deterministic surface variant.
export const THEME_PALETTES = Object.freeze({
  "dark-codex": Object.freeze({
    ...accents,
    body: "#FFFFFF",
    eye: "#000000",
    keyline: "#000000",
  }),
  "light-codex": Object.freeze({
    ...accents,
    body: "#000000",
    eye: "#FFFFFF",
    keyline: "#FFFFFF",
  }),
});

const n = (value) => Number(value.toFixed(3));
const TAU = Math.PI * 2;

function smoothClosedPath(points) {
  const commands = [`M${n(points[0][0])} ${n(points[0][1])}`];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const afterNext = points[(index + 2) % points.length];
    commands.push(
      `C${n(current[0] + (next[0] - previous[0]) / 6)} ${n(current[1] + (next[1] - previous[1]) / 6)} ` +
      `${n(next[0] - (afterNext[0] - current[0]) / 6)} ${n(next[1] - (afterNext[1] - current[1]) / 6)} ${n(next[0])} ${n(next[1])}`,
    );
  }
  return `${commands.join("")}Z`;
}

function sampledPath(generator, count = 128) {
  return smoothClosedPath(Array.from({ length: count }, (_, index) => generator(index / count * TAU)));
}

function superellipsePath(width, height, exponent = 4.2) {
  return sampledPath((angle) => {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return [
      CENTER + Math.sign(cosine) * Math.abs(cosine) ** (2 / exponent) * width,
      CENTER + Math.sign(sine) * Math.abs(sine) ** (2 / exponent) * height,
    ];
  });
}

class SourcePath {
  constructor() {
    this.parts = [];
  }

  move(x, y) {
    this.parts.push(`M${n(x)} ${n(y)}`);
    return this;
  }

  line(x, y) {
    this.parts.push(`L${n(x)} ${n(y)}`);
    return this;
  }

  curve(x1, y1, x2, y2, x, y) {
    this.parts.push(`C${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x)} ${n(y)}`);
    return this;
  }

  quadratic(x1, y1, x, y) {
    this.parts.push(`Q${n(x1)} ${n(y1)} ${n(x)} ${n(y)}`);
    return this;
  }

  corner(previous, current, next, radius) {
    const unitFrom = (left, right) => {
      const dx = left[0] - right[0];
      const dy = left[1] - right[1];
      const length = Math.hypot(dx, dy) || 1;
      return [dx / length, dy / length];
    };
    const incoming = unitFrom(previous, current);
    const outgoing = unitFrom(next, current);
    const entry = [current[0] + incoming[0] * radius, current[1] + incoming[1] * radius];
    const exit = [current[0] + outgoing[0] * radius, current[1] + outgoing[1] * radius];
    if (this.parts.length === 0) this.move(entry[0], entry[1]);
    else this.line(entry[0], entry[1]);
    return this.quadratic(current[0], current[1], exit[0], exit[1]);
  }

  arc(cx, cy, rx, ry, start, end) {
    const count = Math.max(1, Math.ceil(Math.abs(end - start) / (Math.PI / 2)));
    const step = (end - start) / count;
    const cubic = 4 / 3 * Math.tan(step / 4);
    let angle = start;
    for (let index = 0; index < count; index += 1) {
      const next = angle + step;
      const startPoint = [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
      const endPoint = [cx + rx * Math.cos(next), cy + ry * Math.sin(next)];
      this.curve(
        startPoint[0] - cubic * rx * Math.sin(angle),
        startPoint[1] + cubic * ry * Math.cos(angle),
        endPoint[0] + cubic * rx * Math.sin(next),
        endPoint[1] - cubic * ry * Math.cos(next),
        endPoint[0],
        endPoint[1],
      );
      angle = next;
    }
    return this;
  }

  close() {
    return `${this.parts.join("")}Z`;
  }
}

function roundedPolygonPath(points, radii) {
  const path = new SourcePath();
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const radius = typeof radii === "number" ? radii : radii[index % radii.length];
    const unitFrom = (left, right) => {
      const dx = left[0] - right[0];
      const dy = left[1] - right[1];
      const length = Math.hypot(dx, dy) || 1;
      return [dx / length, dy / length];
    };
    const incoming = unitFrom(previous, current);
    const outgoing = unitFrom(next, current);
    const entry = [current[0] + incoming[0] * radius, current[1] + incoming[1] * radius];
    const exit = [current[0] + outgoing[0] * radius, current[1] + outgoing[1] * radius];
    if (index === 0) path.move(entry[0], entry[1]);
    else path.line(entry[0], entry[1]);
    path.quadratic(current[0], current[1], exit[0], exit[1]);
  }
  return path.close();
}

function sourceTabletPath(width, radius) {
  return new SourcePath()
    .move(CENTER - width + radius, CENTER - radius)
    .line(CENTER + width - radius, CENTER - radius)
    .arc(CENTER + width - radius, CENTER, radius, radius, -Math.PI / 2, Math.PI / 2)
    .line(CENTER - width + radius, CENTER + radius)
    .arc(CENTER - width + radius, CENTER, radius, radius, Math.PI / 2, Math.PI * 1.5)
    .close();
}

function sourceCapsulePath(radius, halfHeight) {
  return new SourcePath()
    .move(CENTER - radius, CENTER + halfHeight - radius)
    .line(CENTER - radius, CENTER - halfHeight + radius)
    .arc(CENTER, CENTER - halfHeight + radius, radius, radius, Math.PI, TAU)
    .line(CENTER + radius, CENTER + halfHeight - radius)
    .arc(CENTER, CENTER + halfHeight - radius, radius, radius, 0, Math.PI)
    .close();
}

function sourceCylinderPath(halfWidth, halfHeight, capHeight) {
  return new SourcePath()
    .move(CENTER - halfWidth, CENTER - halfHeight + capHeight)
    .arc(CENTER, CENTER - halfHeight + capHeight, halfWidth, capHeight, Math.PI, TAU)
    .line(CENTER + halfWidth, CENTER + halfHeight - capHeight)
    .arc(CENTER, CENTER + halfHeight - capHeight, halfWidth, capHeight, 0, Math.PI)
    .close();
}

function sourceShieldPath(halfWidth, halfHeight, shoulder) {
  const top = CENTER - halfHeight;
  const bottom = CENTER + halfHeight;
  return new SourcePath()
    .move(CENTER - halfWidth, top + shoulder)
    .curve(CENTER - halfWidth, top - 2, CENTER - halfWidth * 0.5, top - 10, CENTER, top - 10)
    .curve(CENTER + halfWidth * 0.5, top - 10, CENTER + halfWidth, top - 2, CENTER + halfWidth, top + shoulder)
    .curve(CENTER + halfWidth, CENTER + halfHeight * 0.42, CENTER + halfWidth * 0.62, bottom, CENTER, bottom)
    .curve(CENTER - halfWidth * 0.62, bottom, CENTER - halfWidth, CENTER + halfHeight * 0.42, CENTER - halfWidth, top + shoulder)
    .close();
}

function sourceDomePath(halfWidth, halfHeight, corner) {
  const bottom = CENTER + halfHeight;
  return new SourcePath()
    .move(CENTER - halfWidth, bottom - corner)
    .arc(CENTER, bottom - corner, halfWidth, 2 * halfHeight - corner, Math.PI, TAU)
    .line(CENTER + halfWidth, bottom - corner)
    .curve(CENTER + halfWidth, bottom, CENTER + halfWidth, bottom, CENTER + halfWidth - corner, bottom)
    .line(CENTER - halfWidth + corner, bottom)
    .curve(CENTER - halfWidth, bottom, CENTER - halfWidth, bottom, CENTER - halfWidth, bottom - corner)
    .close();
}

function sourceArchPath(halfWidth, halfHeight, corner) {
  const bottom = CENTER + halfHeight;
  const crownCenterY = CENTER - halfHeight + halfWidth;
  return new SourcePath()
    .move(CENTER - halfWidth, crownCenterY)
    .arc(CENTER, crownCenterY, halfWidth, halfWidth, Math.PI, TAU)
    .line(CENTER + halfWidth, bottom - corner)
    .curve(CENTER + halfWidth, bottom, CENTER + halfWidth, bottom, CENTER + halfWidth - corner, bottom)
    .line(CENTER - halfWidth + corner, bottom)
    .curve(CENTER - halfWidth, bottom, CENTER - halfWidth, bottom, CENTER - halfWidth, bottom - corner)
    .close();
}

function sourceCloudPath(circles, count = 160) {
  return sampledPath((angle) => {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    let radius = 0;
    for (const [cx, cy, circleRadius] of circles) {
      const offsetX = cx - CENTER;
      const offsetY = cy - CENTER;
      const projection = cosine * offsetX + sine * offsetY;
      const determinant = projection ** 2 - (offsetX ** 2 + offsetY ** 2) + circleRadius ** 2;
      if (determinant <= 0) continue;
      radius = Math.max(radius, projection + Math.sqrt(determinant));
    }
    return [CENTER + cosine * radius, CENTER + sine * radius];
  }, count);
}

function sourceTeardropPath(radius, tipY, circleY, corner) {
  const ratio = Math.max(-1, Math.min(1, radius / (circleY - tipY)));
  const side = Math.sqrt(1 - ratio ** 2);
  const right = [CENTER + radius * side, circleY - radius * ratio];
  const left = [CENTER - radius * side, circleY - radius * ratio];
  const angle = Math.atan2(right[1] - circleY, right[0] - CENTER);
  return new SourcePath()
    .corner(right, [CENTER, tipY], left, corner)
    .line(left[0], left[1])
    .arc(CENTER, circleY, radius, radius, Math.PI - angle, angle)
    .close();
}

// All families are grounded in the shipped vector engine's blob/squircle/tablet/
// teardrop vocabulary. The aliases name the elastic acting role they play here.
export const SOURCE_BODY_SHAPES = Object.freeze([
  "blob",
  "pebble",
  "bean",
  "egg",
  "squircle",
  "tablet",
  "capsule",
  "cylinder",
  "hex",
  "gem",
  "crystal",
  "wedge",
  "shield",
  "dome",
  "arch",
  "cloud",
  "teardrop",
  "leaf",
]);

const GENERATED_BODY_PATHS = Object.freeze({
  blob: BLOB_PATH,
  ball: "M114.271 0C177.379 0 228.541 51.162 228.541 114.271S177.379 228.541 114.271 228.541 0 177.379 0 114.271 51.162 0 114.271 0Z",
  pebble: sampledPath((angle) => {
    const radius = 108 * (1 + 0.075 * (Math.sin(angle * 2 + 1.1) * 0.6 + Math.sin(angle * 3 - 1.1) * 0.4));
    return [CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius * 0.98];
  }),
  bean: sampledPath((angle) => {
    const bump = (offset) => {
      const distance = Math.abs(((angle - offset + Math.PI) % TAU + TAU) % TAU - Math.PI);
      return Math.exp(-(distance ** 2) / 0.4232);
    };
    const radius = 1 - 0.34 * bump(Math.PI) + 0.34 * 0.34 * bump(TAU);
    return [CENTER + Math.cos(angle) * 94 * radius, CENTER + Math.sin(angle) * 112 * radius];
  }),
  egg: sampledPath((angle) => {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const taper = (1 - sine) / 2;
    return [CENTER + cosine * 98 * (1 - 0.22 * taper ** 2), CENTER + sine * 113];
  }),
  squircle: superellipsePath(107, 107, 4.2),
  tablet: sourceTabletPath(114, 74),
  capsule: sourceCapsulePath(72, 113),
  cylinder: sourceCylinderPath(94, 110, 34),
  hex: roundedPolygonPath(Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 6 + index * TAU / 6;
    return [CENTER + Math.cos(angle) * 114, CENTER + Math.sin(angle) * 114];
  }), 20),
  gem: superellipsePath(112, 113, 1.5),
  crystal: roundedPolygonPath([
    [CENTER, 1],
    [CENTER + 76, CENTER - 52],
    [CENTER + 76, CENTER + 52],
    [CENTER, 227.541],
    [CENTER - 76, CENTER + 52],
    [CENTER - 76, CENTER - 52],
  ], [20, 26]),
  wedge: roundedPolygonPath(Array.from({ length: 3 }, (_, index) => {
    const angle = -Math.PI / 2 + index * TAU / 3;
    return [CENTER + Math.cos(angle) * 130, CENTER + Math.sin(angle) * 130];
  }), 60),
  shield: sourceShieldPath(98, 108, 30),
  dome: sourceDomePath(114, 82, 26),
  arch: sourceArchPath(76, 113, 20),
  cloud: sourceCloudPath([
    [CENTER - 62, CENTER + 26, 56],
    [CENTER + 62, CENTER + 26, 54],
    [CENTER, CENTER + 34, 62],
    [CENTER - 24, CENTER - 30, 62],
    [CENTER + 38, CENTER - 26, 54],
  ]),
  teardrop: sourceTeardropPath(88, CENTER - 114, CENTER + 26, 18),
  leaf: sampledPath((angle) => {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return [
      CENTER + cosine * 88 * Math.max(1 - sine ** 2, 0) ** 0.25,
      CENTER + sine * 113,
    ];
  }),
});

// The normalized registry is authoritative. The generated constructors above
// remain readable documentation of the geometry, while rendering consumes the
// normalized character data. `ball` is an auxiliary Codex acting shape; the
// complete 18-shape registry is exposed separately.
export const BODY_PATHS = Object.freeze({
  ...Object.fromEntries(Object.entries(GROK_BODY_SHAPES).map(([id, shape]) => [id, shape.path])),
  ball: GENERATED_BODY_PATHS.ball,
});

const roundSource = (value) => Math.round(value * 100) / 100;
function sourceSmoothRingPath(points) {
  let value = `M${roundSource(points[0][0])} ${roundSource(points[0][1])}`;
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const afterNext = points[(index + 2) % points.length];
    value += `C${roundSource(current[0] + (next[0] - previous[0]) / 6)} ${roundSource(current[1] + (next[1] - previous[1]) / 6)} ${roundSource(next[0] - (afterNext[0] - current[0]) / 6)} ${roundSource(next[1] - (afterNext[1] - current[1]) / 6)} ${roundSource(next[0])} ${roundSource(next[1])}`;
  }
  return `${value}Z`;
}

const SOURCE_EFFECT_BALL_RING = Object.freeze(Array.from({ length: 96 }, (_, index) => {
  const angle = index / 96 * TAU;
  return Object.freeze([CENTER + Math.cos(angle) * CENTER, CENTER + Math.sin(angle) * CENTER]);
}));
const SOURCE_EFFECT_BALL_PATH = sourceSmoothRingPath(SOURCE_EFFECT_BALL_RING);
const SOURCE_PENCIL_BODY_RING = Object.freeze(GROK_BODY_SHAPES.teardrop.ring.map((_, index, ring) => {
  const shiftedIndex = ((index - ring.length / 2) % ring.length + ring.length) % ring.length;
  const [pointX, pointY] = ring[shiftedIndex];
  return Object.freeze([CENTER - (pointX - CENTER), CENTER - (pointY - CENTER)]);
}));

const SOURCE_PENCIL_PATH = `M${CENTER - 15} ${CENTER - 29}A15 15 0 0 1 ${CENTER + 15} ${CENTER - 29}L${CENTER + 15} ${CENTER + 29}A15 15 0 0 1 ${CENTER - 15} ${CENTER + 29}Z`;
const SOURCE_BANG_PATH = `M${CENTER - 15} ${CENTER - 33}A15 15 0 0 1 ${CENTER + 15} ${CENTER - 33}L${CENTER + 8.5} ${CENTER + 39.5}A8.5 8.5 0 0 1 ${CENTER - 8.5} ${CENTER + 39.5}Z`;

const SOURCE_EFFECT_ACTIVATION = 0.62;
const SOURCE_STANDBY_ACTIVATION = 0.50;
export const SOURCE_EFFECT_EYE_ENVELOPE = Object.freeze({
  visibleThroughActivation: 0.36,
  midpointActivation: 0.50,
  hiddenFromActivation: 0.64,
  hiddenScale: 0.84,
});
const SOURCE_MORPH_EFFECTS = Object.freeze([
  "dots",
  "orbit",
  "radar",
  "progress",
  "gather",
  "wave",
  "send",
  "receive",
  "dock",
  "ball",
  "whirl",
  "pencil",
  "bang",
  "standby",
]);
const SOURCE_EFFECT_MODES = new Set(SOURCE_MORPH_EFFECTS);
const SOURCE_EFFECT_BODY_RADIUS = Object.freeze({
  dots: 22,
  orbit: 19,
  radar: 19,
  progress: 19,
  gather: 19,
  wave: 16,
  send: 20,
  receive: 20,
  dock: 20,
  ball: 18,
  whirl: 15,
  pencil: 17,
  bang: 13,
  standby: 13,
});

const sourceCubicOut = (value) => 1 - (1 - value) ** 3;
const sourceBackOut = (value) => 1 + 2.70158 * (value - 1) ** 3 + 1.70158 * (value - 1) ** 2;
const sourceSmoothStep = (value) => value ** 2 * (3 - 2 * value);
const sourceCubicInOut = (value) => value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
const sourceRepresentativeTime = (phase = 0) => 520 + Math.max(0, phase) * 233;

export function sourceEffectEyeEnvelope(activation) {
  if (!Number.isFinite(activation)) {
    throw new TypeError("source effect eye activation must be finite");
  }
  const {
    visibleThroughActivation,
    hiddenFromActivation,
    hiddenScale,
  } = SOURCE_EFFECT_EYE_ENVELOPE;
  const progress = clamp(
    (activation - visibleThroughActivation)
      / (hiddenFromActivation - visibleThroughActivation),
    0,
    1,
  );
  const eased = sourceSmoothStep(progress);
  return {
    opacity: 1 - eased,
    scale: 1 - (1 - hiddenScale) * eased,
    fullyHidden: progress === 1,
  };
}

function sourceMotionCycle(pose, durationMs, offsetMs = 0) {
  if (!Number.isFinite(pose.sourceMotionTimeMs)) return null;
  const cycleMs = ((pose.sourceMotionTimeMs + offsetMs) % durationMs + durationMs) % durationMs;
  return cycleMs / durationMs;
}

function sourceEffectsForPose(pose) {
  return pose.sourceEffects ?? (pose.sourceEffect ? [pose.sourceEffect] : []);
}

function sourceMorphEffectForPose(pose) {
  const effects = sourceEffectsForPose(pose);
  return SOURCE_MORPH_EFFECTS.find((effect) => effects.includes(effect)) ?? null;
}

function sourceEffectActivation(family, pose = {}) {
  const authored = pose.sourceEffectActivation;
  if (Number.isFinite(authored)) return clamp(authored, 0, 1);
  return family === "standby" ? SOURCE_STANDBY_ACTIVATION : SOURCE_EFFECT_ACTIVATION;
}

function sourceEffectBodyPath(family, activation) {
  const target = family === "pencil" ? SOURCE_PENCIL_BODY_RING : SOURCE_EFFECT_BALL_RING;
  const morph = sourceCubicInOut(clamp(activation / SOURCE_EFFECT_ACTIVATION, 0, 1));
  const ring = GROK_BODY_SHAPES.blob.ring.map(([pointX, pointY], index) => [
    pointX + (target[index][0] - pointX) * morph,
    pointY + (target[index][1] - pointY) * morph,
  ]);
  return sourceSmoothRingPath(ring);
}

function sourcePulse(time, slot, weight = 1) {
  const cycle = (((time / 1400 + 0.119) % 1) + 1) % 1;
  let distance = Math.abs(cycle - slot / 3);
  distance = Math.min(distance, 1 - distance);
  const strength = Math.exp(-(distance ** 2) / (2 * 0.15 ** 2));
  return {
    lift: strength * 9 * weight,
    pop: 0.84 + 0.22 * strength,
    tone: 1 - 0.5 * (1 - strength),
  };
}

function sourcePencilPose(position, continuous = false) {
  const rotationWave = continuous
    ? Math.sin(position * TAU)
    : Math.sin(position * 2500 * 0.0006);
  if (position < 0.68) {
    const progress = position / 0.68;
    const travel = sourceSmoothStep(progress);
    const envelope = clamp(progress / 0.08, 0, 1) * clamp((1 - progress) / 0.08, 0, 1);
    return {
      x: -54 + 118 * travel,
      y: 26,
      wiggle: Math.sin(progress * 24) * 3.2 * envelope,
      rotation: 17 + rotationWave,
      lifting: false,
    };
  }
  const progress = sourceCubicInOut((position - 0.68) / 0.32);
  return {
    x: 64 - 118 * progress,
    y: 26 - 20 * Math.sin(progress * Math.PI),
    wiggle: 0,
    rotation: 17 - 2 * Math.sin(progress * Math.PI) + rotationWave,
    lifting: true,
  };
}

function sourcePencilCycle(phase = 0) {
  const cycles = [0.42, 0.52, 0.62, 0.78, 0.88];
  return cycles[clamp(Math.round(phase), 0, cycles.length - 1)];
}

function sourcePencilSample(pose, phase = 0) {
  const continuousCycle = sourceMotionCycle(pose, 1600);
  return continuousCycle == null
    ? { cycle: sourcePencilCycle(phase), continuous: false }
    : { cycle: continuousCycle, continuous: true };
}

function sourceBangSample(pose, timeMs) {
  const cycle = sourceMotionCycle(pose, 720);
  if (cycle == null) {
    const timeSeconds = timeMs / 1000;
    const impulse = Math.exp(-(timeSeconds % 2.2) * 5.5);
    return {
      impulse,
      wiggle: Math.sin(timeSeconds * 42) * 2.2 * impulse,
    };
  }

  const impulse = Math.sin(Math.PI * cycle) * Math.exp(-cycle * 2.8);
  return {
    impulse,
    wiggle: 1.6 * Math.sin(cycle * TAU)
      + 3.2 * Math.sin(cycle * TAU * 3) * impulse,
  };
}

function transformFor(pose) {
  // Occupying more of the fixed cell keeps the simple silhouette substantial
  // at compact display sizes. Pose values remain expressed around the source
  // model's canonical base so the authored squash/stretch ratios stay intact.
  const scaleX = (pose.scaleX ?? 0.615) * (0.70 / 0.615);
  const scaleY = (pose.scaleY ?? 0.625) * (0.74 / 0.625);
  const anchorY = (pose.anchorY ?? 187) + 9;
  const centerX = 96 + (pose.leanX ?? 0);
  const centerY = anchorY - CENTER * scaleY + (pose.leanY ?? 0);
  const rotation = pose.rotation ?? 0;
  const skewX = pose.skewX ?? 0;
  return {
    centerX,
    centerY,
    scaleX,
    scaleY,
    radiusX: CENTER * scaleX,
    radiusY: CENTER * scaleY,
    value: `translate(${n(centerX)} ${n(centerY)}) rotate(${n(rotation)}) skewX(${n(skewX)}) scale(${n(scaleX)} ${n(scaleY)}) translate(${-CENTER} ${-CENTER})`,
  };
}

function bodyPath(pose) {
  return BODY_PATHS[pose.shape ?? "blob"] ?? BLOB_PATH;
}

function sourceEffectBodySample(pose) {
  const family = sourceMorphEffectForPose(pose);
  if (!family) return null;

  const activation = sourceEffectActivation(family, pose);
  const phase = pose.effectPhase ?? 0;
  const time = pose.sourceSampleTimeMs ?? sourceRepresentativeTime(phase);
  let motionX = 0;
  let motionY = 0;
  let rotation = 0;
  let pulseScale = 1;
  let opacity = 1;

  if (family === "dots") {
    const beat = sourcePulse(time, 1, activation);
    motionY -= beat.lift * activation;
    pulseScale *= beat.pop;
    opacity *= 1 - (1 - beat.tone) * activation;
  } else if (family === "send") {
    const cycle = sourceMotionCycle(pose, 1165) ?? (0.40 + clamp(phase, 0, 4) * 0.02);
    const compression = cycle < 0.18 ? -0.06 * Math.sin(cycle / 0.18 * Math.PI) : 0;
    const rebound = cycle >= 0.18 && cycle < 0.42 ? 0.05 * Math.sin((cycle - 0.18) / 0.24 * Math.PI) : 0;
    pulseScale *= 1 + (compression + rebound) * activation;
  } else if (family === "receive") {
    const cycle = sourceMotionCycle(pose, 1165) ?? (0.48 + clamp(phase, 0, 4) * 0.07);
    const arrival = clamp((cycle - 0.58) / 0.34, 0, 1);
    pulseScale *= 1 + 0.11 * Math.sin(arrival * Math.PI) * activation;
  } else if (family === "pencil") {
    const pencilSample = sourcePencilSample(pose, phase);
    const pencil = sourcePencilPose(pencilSample.cycle, pencilSample.continuous);
    motionX += pencil.x * activation ** 2;
    motionY += (pencil.y + pencil.wiggle * 0.5) * activation ** 2;
    rotation += pencil.rotation * activation ** 2;
  } else if (family === "bang") {
    const bang = sourceBangSample(pose, time);
    motionY += 58 * activation ** 2;
    pulseScale *= 1 + (0.018 * Math.sin((sourceMotionCycle(pose, 720) ?? 0) * TAU)
      + 0.04 * bang.impulse) * activation;
  } else if (family === "ball") {
    const timeSeconds = time / 1000;
    const period = 0.62;
    const height = 52;
    const gravity = 8 * height / period ** 2;
    const fallTime = Math.sqrt(80 / gravity);
    let bodyHeight;
    if (timeSeconds < fallTime) bodyHeight = 40 - 0.5 * gravity * timeSeconds ** 2;
    else {
      const progress = ((timeSeconds - fallTime) / period) % 1;
      bodyHeight = 4 * height * progress * (1 - progress);
    }
    motionY += (40 - bodyHeight) * activation ** 2;
  } else if (family === "whirl") {
    const timeSeconds = time / 1000;
    motionX += (2 * Math.sin(0.9 * timeSeconds) + 0.8 * Math.sin(1.7 * timeSeconds)) * activation ** 2;
    motionY += (2.4 * Math.sin(1.3 * timeSeconds) + 1.2 * Math.sin(0.6 * timeSeconds)) * activation ** 2;
  } else if (family === "standby") {
    opacity *= 1 - (0.28 + 0.2 * Math.sin(time * 0.0016)) * activation;
  }

  const bodyRadius = SOURCE_EFFECT_BODY_RADIUS[family];
  const scale = 1 - activation + bodyRadius / CENTER * pulseScale * activation;
  const eyeEnvelope = sourceEffectEyeEnvelope(activation);
  return {
    activation,
    eyeOpacity: eyeEnvelope.opacity,
    eyeScale: eyeEnvelope.scale,
    eyesFullyHidden: eyeEnvelope.fullyHidden,
    family,
    opacity,
    path: sourceEffectBodyPath(family, activation),
    transform: `translate(${n(CENTER + motionX)} ${n(CENTER + motionY)}) rotate(${n(rotation)}) scale(${n(scale)}) translate(${-CENTER} ${-CENTER})`,
  };
}

function orbitMarkup(pose, transform, palette) {
  const effect = pose.effect;
  const sourceEffects = new Set(pose.sourceEffects ?? (pose.sourceEffect ? [pose.sourceEffect] : []));
  if (!effect && sourceEffects.size === 0) return { rear: "", front: "" };
  const { centerX: x, centerY: y, radiusX: rx, radiusY: ry } = transform;
  const phase = pose.effectPhase ?? 0;
  const discretePhase = Math.round(phase);
  const fluidAngle = finitePhaseAngle(pose.fluidMotionPhase);
  const fluidWave = Math.sin(fluidAngle);
  const fluidCounterWave = Math.sin(fluidAngle * 2);
  const orbitalEffects = ["orbit", "celebrate", "celebrate-storm", "spawn"];
  const isOrbital = orbitalEffects.includes(effect);
  const isStorm = effect === "celebrate-storm";
  const orbitalTransforms = [
    { angle: 0, scale: 1 },
    { angle: -28, scale: 0.9 },
    { angle: 32, scale: 0.88 },
    { angle: 58, scale: 0.82 },
    { angle: -44, scale: 0.86 },
    { angle: 82, scale: 0.8 },
  ];
  const baseOrbitalTransform = orbitalTransforms[((discretePhase % orbitalTransforms.length) + orbitalTransforms.length) % orbitalTransforms.length];
  const orbitalTransform = {
    angle: baseOrbitalTransform.angle + fluidWave * 4.5,
    scale: baseOrbitalTransform.scale * (1 + fluidCounterWave * 0.008),
  };
  const common = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';
  const colorCycle = [palette.green, palette.violet, palette.gold, palette.coral, palette.blue, palette.teal];
  const color = (index) => colorCycle[(index + discretePhase + colorCycle.length) % colorCycle.length];
  const path = (d, stroke, width = 6, opacity = 1) => `<path d="${d}" ${common} stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`;
  const satellite = (cx, cy, radius = 5) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${radius}" fill="${palette.body}"/>`;
  const disc = (cx, cy, radius, fill = palette.body, opacity = 1) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${radius}" fill="${fill}" opacity="${opacity}"/>`;
  const ring = (cx, cy, radius, stroke = palette.body, width = 2.6, opacity = 0.55, dash = "") => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(radius)}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
  const spark = (cx, cy, radius, fill) => `<path d="M${n(cx)} ${n(cy - radius)}L${n(cx + radius * 0.48)} ${n(cy - radius * 0.48)}L${n(cx + radius)} ${n(cy)}L${n(cx + radius * 0.48)} ${n(cy + radius * 0.48)}L${n(cx)} ${n(cy + radius)}L${n(cx - radius * 0.48)} ${n(cy + radius * 0.48)}L${n(cx - radius)} ${n(cy)}L${n(cx - radius * 0.48)} ${n(cy - radius * 0.48)}Z" fill="${fill}"/>`;
  const sourceLayer = (markup) => `<g data-effect-geometry="character" transform="translate(${n(x)} ${n(y)}) scale(${n(transform.scaleX)} ${n(transform.scaleY)}) translate(${-CENTER} ${-CENTER})">${markup}</g>`;
  const sourceCircle = (cx, cy, radius, opacity = 1, fill = palette.body) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(radius)}" fill="${fill}" opacity="${n(opacity)}"/>`;
  const sourceRing = (radius, width, opacity, dash = "", dashOffset = "", stroke = palette.body) => `<circle cx="${CENTER}" cy="${CENTER}" r="${n(radius)}" fill="none" stroke="${stroke}" stroke-width="${n(width)}" stroke-linecap="round" opacity="${n(opacity)}"${dash ? ` stroke-dasharray="${dash}"` : ""}${dashOffset ? ` stroke-dashoffset="${dashOffset}"` : ""}/>`;
  const sourceMiniBody = (cx, cy, radius, opacity = 1, fill = palette.body) => `<path d="${SOURCE_EFFECT_BALL_PATH}" fill="${fill}" opacity="${n(opacity)}" transform="translate(${n(cx)} ${n(cy)}) scale(${n(radius / CENTER)}) translate(${-CENTER} ${-CENTER})"/>`;
  const effectWeight = sourceEffectActivation(sourceMorphEffectForPose(pose), pose);
  const effectEase = sourceCubicOut(effectWeight);
  // Dense Character Lab simulations can supply a continuous clock while fixed
  // Codex cells retain deterministic phase-based samples.
  const representativeTime = pose.sourceSampleTimeMs ?? sourceRepresentativeTime(phase);
  const rear = [];
  const front = [];

  if (isOrbital) {
    // The long arcs terminate underneath the body, so every colour physically
    // wraps around the character instead of becoming a detached UI symbol.
    rear.push(path(`M${n(x - rx * 1.08)} ${n(y + ry * 0.12)} C${n(x - rx * 0.7)} ${n(y + ry * 0.95)} ${n(x + rx * 0.64)} ${n(y + ry * 1.02)} ${n(x + rx * 1.06)} ${n(y + ry * 0.12)}`, color(0), 7));
    rear.push(path(`M${n(x - rx * 1.04)} ${n(y + ry * 0.28)} C${n(x - rx * 0.48)} ${n(y + ry * 1.11)} ${n(x + rx * 0.76)} ${n(y + ry * 0.9)} ${n(x + rx * 1.02)} ${n(y - ry * 0.02)}`, color(1), 6.5));
    rear.push(path(`M${n(x - rx * 0.98)} ${n(y + ry * 0.42)} C${n(x - rx * 0.28)} ${n(y + ry * 1.18)} ${n(x + rx * 0.82)} ${n(y + ry * 0.74)} ${n(x + rx * 0.93)} ${n(y - ry * 0.16)}`, color(2), 6));
    rear.push(path(`M${n(x - rx * 0.88)} ${n(y + ry * 0.53)} C${n(x - rx * 0.08)} ${n(y + ry * 1.14)} ${n(x + rx * 0.88)} ${n(y + ry * 0.56)} ${n(x + rx * 0.82)} ${n(y - ry * 0.3)}`, color(3), 5.5));
    // The crown is a key celebration signature and intersects the silhouette.
    rear.push(path(`M${n(x - rx * 0.28)} ${n(y - ry * 0.86)} Q${n(x + rx * 0.02)} ${n(y - ry * 1.12)} ${n(x + rx * 0.34)} ${n(y - ry * 0.84)}`, color(4), 7));
    if (effect === "celebrate" || effect === "celebrate-storm" || effect === "spawn") {
      rear.push(path(`M${n(x - rx * 1.04)} ${n(y - ry * 0.08)} C${n(x - rx * 0.6)} ${n(y - ry * 0.76)} ${n(x + rx * 0.56)} ${n(y - ry * 0.76)} ${n(x + rx * 1.03)} ${n(y - ry * 0.02)}`, color(5), 6.5));
    }
    // Two small satellites orbit in opposition. They appear only on energetic
    // beats and invert with the body treatment.
    const satelliteSide = discretePhase % 2 === 0 ? -1 : 1;
    rear.push(satellite(
      x + satelliteSide * rx * (1.04 - 0.035 * fluidCounterWave),
      y - ry * 0.12 + ry * 0.075 * fluidWave,
      5,
    ));
    // The opposed satellite overlaps the silhouette and is deliberately in the
    // foreground. Across adjacent phases the pair trades depth as well as side.
    front.push(satellite(
      x - satelliteSide * rx * (0.96 + 0.03 * fluidCounterWave),
      y + ry * 0.18 - ry * 0.06 * fluidWave,
      3.5,
    ));
    // Short foreground pieces sell a real belt, not decorative rays.
    front.push(path(`M${n(x - rx * 0.84)} ${n(y + ry * 0.51)} Q${n(x - rx * 0.61)} ${n(y + ry * 0.76)} ${n(x - rx * 0.34)} ${n(y + ry * 0.84)}`, color(1), 6.5));
    front.push(path(`M${n(x - rx * 0.74)} ${n(y + ry * 0.61)} Q${n(x - rx * 0.5)} ${n(y + ry * 0.82)} ${n(x - rx * 0.21)} ${n(y + ry * 0.87)}`, color(3), 5.5));
    if (isStorm) {
      // High-energy celebration surges do not stay behind the character: they
      // engulf the face, rebound, and clear. This emphatic Codex frame is
      // the foreground crest of that performance.
      front.push(path(`M${n(x - rx * 1.08)} ${n(y - ry * 0.42)} C${n(x - rx * 0.48)} ${n(y + ry * 0.58)} ${n(x + rx * 0.38)} ${n(y - ry * 0.5)} ${n(x + rx * 1.08)} ${n(y + ry * 0.34)}`, color(0), 9));
      front.push(path(`M${n(x - rx * 1.06)} ${n(y - ry * 0.18)} C${n(x - rx * 0.28)} ${n(y + ry * 0.72)} ${n(x + rx * 0.2)} ${n(y - ry * 0.72)} ${n(x + rx * 1.04)} ${n(y + ry * 0.08)}`, color(2), 8));
      front.push(path(`M${n(x - rx * 1.02)} ${n(y + ry * 0.08)} C${n(x - rx * 0.26)} ${n(y - ry * 0.64)} ${n(x + rx * 0.4)} ${n(y + ry * 0.68)} ${n(x + rx * 1.02)} ${n(y - ry * 0.2)}`, color(4), 7.5));
      front.push(path(`M${n(x - rx * 0.96)} ${n(y + ry * 0.32)} C${n(x - rx * 0.08)} ${n(y - ry * 0.5)} ${n(x + rx * 0.12)} ${n(y + ry * 0.7)} ${n(x + rx * 0.94)} ${n(y - ry * 0.38)}`, color(5), 6.5));
    }
  }

  // Static samples of the auxiliary-effect equations at the A=.62 morph
  // boundary. Standby samples the earlier A=.50 eye-dissolve midpoint so its
  // fading body remains legible in a single Codex cell.
  if (sourceEffects.has("dots")) {
    const glyphs = [CENTER - 62, CENTER + 62].map((sourceX, index) => {
      const entry = clamp((effectWeight - index * 0.12) / (1 - index * 0.12), 0, 1);
      if (entry <= 0.004) return "";
      const opacity = sourceCubicOut(entry);
      const travel = sourceBackOut(entry);
      const beat = sourcePulse(representativeTime, index === 0 ? 0 : 2, effectWeight);
      return sourceMiniBody(
        CENTER + (sourceX - CENTER) * travel,
        CENTER - beat.lift,
        22 * opacity * beat.pop * 1.02,
        opacity * beat.tone,
      );
    });
    rear.push(sourceLayer(glyphs.join("")));
  }
  if (sourceEffects.has("orbit")) {
    const orbitRadius = 52 * sourceBackOut(effectWeight);
    const orbitDots = Array.from({ length: 5 }, (_, index) => {
      const angle = representativeTime * 0.0017 + index * TAU / 5;
      const depth = Math.cos(angle);
      const depthScale = 0.5 + 0.5 * clamp(depth, 0, 1);
      return sourceCircle(
        CENTER + orbitRadius * Math.sin(angle),
        CENTER - orbitRadius * 0.42 * Math.cos(angle),
        Math.max(12 * depthScale * effectEase, 0.3),
        clamp((depth + 0.4) / 0.6, 0.18, 1) * effectEase,
      );
    });
    rear.push(sourceLayer(orbitDots.join("")));
  }
  if (sourceEffects.has("radar")) {
    const radarRings = Array.from({ length: 3 }, (_, index) => {
      const cycle = (representativeTime / 1300 + index / 3) % 1;
      return sourceRing(
        19 + (104 - 19) * cycle,
        3.4 * (1 - cycle * 0.55),
        effectEase * (1 - cycle) * 0.9,
      );
    });
    rear.push(sourceLayer(radarRings.join("")));
  }
  if (sourceEffects.has("progress")) {
    const radius = 62 * sourceBackOut(effectWeight);
    const continuousCycle = sourceMotionCycle(pose, 1165);
    const elapsed = 1250 + Math.max(0, phase) * 190;
    const completion = continuousCycle == null
      ? clamp(clamp(elapsed / 2500, 0, 1) / 0.85, 0, 1)
      : 0.58 + 0.38 * (0.5 - 0.5 * Math.cos(continuousCycle * TAU));
    const progressRotation = continuousCycle == null ? -90 : -90 + continuousCycle * 360;
    const circumference = TAU * radius;
    rear.push(sourceLayer(
      sourceRing(radius, 5, effectEase * 0.16) +
      `<circle cx="${CENTER}" cy="${CENTER}" r="${n(radius)}" fill="none" stroke="${palette.body}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${n(circumference)}" stroke-dashoffset="${n(circumference * (1 - completion))}" transform="rotate(${n(progressRotation)} ${CENTER} ${CENTER})" opacity="${n(effectEase)}"/>`,
    ));
  }
  if (sourceEffects.has("gather")) {
    const continuousCycle = sourceMotionCycle(pose, 1400);
    const elapsed = 850 + Math.max(0, phase) * 150;
    const gather = Array.from({ length: 5 }, (_, index) => {
      if (continuousCycle != null) {
        const progress = ((continuousCycle - index * 0.14) % 1 + 1) % 1;
        const travel = sourceCubicInOut(progress);
        const envelope = Math.sin(progress * Math.PI) ** 0.7;
        const angle = index * 2.4 + travel * 2.2;
        const radius = 96 * (1 - travel);
        return sourceCircle(
          CENTER + radius * Math.cos(angle),
          CENTER + radius * Math.sin(angle) * 0.8,
          9 * (0.5 + 0.5 * travel) * effectEase,
          effectEase * envelope,
        );
      }
      const progress = clamp((elapsed / 2000 - index * 0.09) / 0.62, 0, 1);
      if (progress >= 1) return "";
      const travel = 1 - (1 - progress) ** 3;
      const angle = index * 2.4 + progress * 2.2;
      const radius = 96 * (1 - travel);
      return sourceCircle(
        CENTER + radius * Math.cos(angle),
        CENTER + radius * Math.sin(angle) * 0.8,
        9 * (0.5 + 0.5 * travel) * effectEase,
        effectEase * clamp(progress * 5, 0, 1) * (1 - travel * 0.25),
      );
    });
    rear.push(sourceLayer(gather.join("")));
  }
  if (sourceEffects.has("wave")) {
    const offsets = [-2, -1, 1, 2];
    const breathing = 0.42 + 0.29 * Math.sin(representativeTime * 0.0021) * Math.sin(representativeTime * 0.0034) + 0.29 * Math.sin(representativeTime * 0.0013 + 1.7);
    const waveGlyphs = offsets.map((offset, index) => {
      const entry = clamp((effectWeight - Math.abs(offset) * 0.1) / (1 - Math.abs(offset) * 0.1), 0, 1);
      if (entry <= 0.004) return "";
      const travel = sourceBackOut(entry);
      const opacity = sourceCubicOut(entry);
      const waveStrength = breathing * (0.55 + 0.45 * Math.sin(representativeTime * 0.012 - Math.abs(offset) * 1.05));
      const radius = (7 + 9 * clamp(waveStrength, 0.08, 1)) * opacity;
      const sourceX = CENTER + offset * 44 * travel;
      const sourceY = CENTER - 6 * clamp(waveStrength, 0, 1) * entry;
      return index < 2
        ? sourceMiniBody(sourceX, sourceY, radius * 1.02, entry)
        : sourceCircle(sourceX, sourceY, radius, entry);
    });
    rear.push(sourceLayer(waveGlyphs.join("")));
  }
  if (sourceEffects.has("send")) {
    const continuousCycle = sourceMotionCycle(pose, 1165);
    const cycle = continuousCycle ?? (0.40 + clamp(phase, 0, 4) * 0.02);
    if (continuousCycle != null) {
      const pieces = [0, 0.18].map((offset, index) => {
        const progress = ((cycle - offset) % 1 + 1) % 1;
        const travel = sourceCubicInOut(progress);
        const envelope = Math.sin(progress * Math.PI) ** 0.8;
        return sourceCircle(
          CENTER + 0.74 * 108 * travel,
          CENTER - 0.62 * 108 * travel,
          (index === 0 ? 10 : 5) * (1 - travel * 0.5) * effectEase,
          effectEase * envelope * (index === 0 ? 1 : 0.55),
        );
      });
      const shock = (cycle + 0.16) % 1;
      pieces.push(sourceRing(
        20 + 34 * sourceCubicOut(shock),
        2.8 * (1 - shock),
        effectEase * Math.sin(shock * Math.PI) * 0.45,
      ));
      rear.push(sourceLayer(pieces.join("")));
    } else {
      const firstProgress = clamp((cycle - 0.18) / 0.55, 0, 1);
      const firstTravel = firstProgress ** 2 * (0.4 + 0.6 * firstProgress);
      const pieces = [];
      if (firstProgress > 0 && firstProgress < 1) {
        pieces.push(sourceCircle(CENTER + 0.74 * 108 * firstTravel, CENTER - 0.62 * 108 * firstTravel, 10 * (1 - firstTravel * 0.55) * effectEase, effectEase * (1 - firstTravel ** 2)));
      }
      const secondProgress = clamp((cycle - 0.26) / 0.55, 0, 1);
      const secondTravel = secondProgress ** 2 * (0.4 + 0.6 * secondProgress);
      if (firstProgress > 0 && secondProgress > 0 && secondProgress < 1) {
        pieces.push(sourceCircle(CENTER + 0.74 * 108 * secondTravel, CENTER - 0.62 * 108 * secondTravel, 5 * (1 - secondTravel * 0.6) * effectEase, effectEase * 0.3 * (1 - secondTravel)));
      }
      const shock = clamp((cycle - 0.18) / 0.3, 0, 1);
      if (shock > 0 && shock < 1) pieces.push(sourceRing(20 + 34 * sourceCubicOut(shock), 2.8 * (1 - shock), effectEase * (1 - shock) * 0.8));
      rear.push(sourceLayer(pieces.join("")));
    }
  }
  if (sourceEffects.has("receive")) {
    // The motion model varies this angle once per cycle; effectPhase is the
    // stable atlas seed for the allowed [-1.25pi, .25pi] family.
    const angle = (-148 + phase * 29) * Math.PI / 180;
    const continuousCycle = sourceMotionCycle(pose, 1165);
    const cycle = continuousCycle ?? (0.48 + clamp(phase, 0, 4) * 0.07);
    const progress = continuousCycle == null ? clamp(cycle / 0.6, 0, 1) : cycle;
    const travel = 1 - (1 - progress) ** 3;
    const pieces = [];
    if (progress < 1) {
      const tangent = 18 * Math.sin(progress * Math.PI) * (1 - travel * 0.7);
      const distance = 108 * (1 - travel);
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      pieces.push(sourceCircle(
        CENTER + cosine * distance - sine * tangent,
        CENTER + sine * distance + cosine * tangent,
        (3.5 + 6.5 * travel) * effectEase,
        effectEase * (continuousCycle == null
          ? clamp(progress * 3.5, 0, 1) * (0.3 + 0.7 * travel)
          : Math.sin(progress * Math.PI) ** 0.72),
      ));
    }
    const ripple = continuousCycle == null
      ? clamp((cycle - 0.58) / 0.32, 0, 1)
      : ((cycle + 0.32) % 1);
    if (ripple > 0 && ripple < 1) pieces.push(sourceRing(
      20 + 26 * sourceCubicOut(ripple),
      2.8 * (1 - ripple),
      effectEase * (continuousCycle == null ? (1 - ripple) * 0.8 : Math.sin(ripple * Math.PI) * 0.45),
    ));
    rear.push(sourceLayer(pieces.join("")));
  }
  if (sourceEffects.has("dock")) {
    const continuousCycle = sourceMotionCycle(pose, 1400);
    const elapsedSeconds = continuousCycle == null ? 0.75 + clamp(phase, 0, 4) * 0.35 : continuousCycle * 1.4;
    const time = continuousCycle == null ? elapsedSeconds * 1000 : representativeTime;
    const particles = Array.from({ length: 2 }, (_, index) => {
      const progress = continuousCycle == null
        ? clamp((elapsedSeconds - (0.2 + index * 1.3)) / 0.9, 0, 1)
        : ((continuousCycle - index * 0.5) % 1 + 1) % 1;
      if (progress <= 0) return "";
      const travel = 1 - (1 - progress) ** 3;
      const angle = time * 0.001 * 1.1 + index * Math.PI;
      const targetX = CENTER + 42 * Math.sin(angle);
      const targetY = CENTER + 42 * 0.5 * Math.cos(angle) + Math.sin(time * 0.003 + index) * 2;
      const startX = CENTER - 120 + index * 30;
      const startY = CENTER + 95;
      return sourceCircle(
        startX + (targetX - startX) * travel,
        startY + (targetY - startY) * travel,
        (7 + 3 * travel) * effectEase,
        effectEase * (continuousCycle == null ? clamp(progress * 4, 0, 1) : Math.sin(progress * Math.PI) ** 0.7),
      );
    });
    rear.push(sourceLayer(particles.join("")));
  }
  // `ball` is a body-bounce mode, not a detached ball. Its parabolic body
  // offset is applied by sourceEffectBodySample.
  if (sourceEffects.has("whirl") && effectWeight > 0.915) {
    // Whirl emits sustained front/back ribbon belts only after its spin speed
    // crosses the emission threshold. This deterministic early-belt sample
    // keeps the correct body occlusion and accent-palette gradient grammar.
    const ribbonProgress = clamp((effectWeight - 0.915) / (0.993 - 0.915), 0, 1);
    const ribbonReveal = sourceCubicOut(ribbonProgress);
    const whirlAngle = 18 + representativeTime * (29 / 233);
    const beltPath = (radius, sweep, lift) => `M${n(CENTER - radius)} ${n(CENTER + lift)}C${n(CENTER - radius * 0.42)} ${n(CENTER - sweep)} ${n(CENTER + radius * 0.42)} ${n(CENTER + sweep)} ${n(CENTER + radius)} ${n(CENTER - lift)}`;
    const belt = (radius, sweep, lift, color, width) => `<path d="${beltPath(radius, sweep, lift)}" pathLength="1" stroke="${color}" stroke-width="${width}" stroke-dasharray="1" stroke-dashoffset="${n(1 - ribbonReveal)}" opacity="${n(ribbonReveal)}"/>`;
    // Use separate path elements instead of a detached icon; alternating
    // strokes make the belt read as a moving gradient at pet scale.
    rear.push(sourceLayer(`<g data-character-whirl="true" data-source-whirl-reveal="${n(ribbonReveal)}" fill="none" stroke-linecap="round" transform="rotate(${n(whirlAngle)} ${CENTER} ${CENTER})">${belt(96, 62, 12, palette.blue, 8)}${belt(88, 54, 5, palette.teal, 6)}</g>`));
    front.push(sourceLayer(`<g data-character-whirl="true" data-source-whirl-reveal="${n(ribbonReveal)}" fill="none" stroke-linecap="round" transform="rotate(${n(whirlAngle + 36)} ${CENTER} ${CENTER})">${belt(92, -58, -8, palette.coral, 7)}${belt(82, -49, -2, palette.violet, 5.5)}</g>`));
  }
  if (sourceEffects.has("pencil")) {
    const pencilSample = sourcePencilSample(pose, phase);
    const cycle = pencilSample.cycle;
    const pencil = sourcePencilPose(cycle, pencilSample.continuous);
    const glyphAngle = (pencil.rotation - 90) * Math.PI / 180;
    const glyphX = CENTER + (pencil.x + Math.cos(glyphAngle) * 68) * effectWeight;
    const glyphY = CENTER + (pencil.y + pencil.wiggle * 0.15 + Math.sin(glyphAngle) * 68) * effectWeight;
    let trail = "";
    if (!pencil.lifting) {
      const trailPoints = Array.from({ length: 15 }, (_, index) => {
        const sampleCycle = Math.max(0.08, cycle - 0.34) + (cycle - Math.max(0.08, cycle - 0.34)) * index / 14;
        const sample = sourcePencilPose(sampleCycle, pencilSample.continuous);
        return [CENTER + sample.x, CENTER + sample.y + sample.wiggle + 19];
      });
      if (trailPoints.length > 1) {
        let trailPath = `M${trailPoints[0][0].toFixed(1)} ${trailPoints[0][1].toFixed(1)}`;
        for (let index = 0; index < trailPoints.length - 1; index += 1) {
          const previous = trailPoints[Math.max(index - 1, 0)];
          const current = trailPoints[index];
          const next = trailPoints[index + 1];
          const afterNext = trailPoints[Math.min(index + 2, trailPoints.length - 1)];
          trailPath += `C${(current[0] + (next[0] - previous[0]) / 6).toFixed(1)} ${(current[1] + (next[1] - previous[1]) / 6).toFixed(1)} ${(next[0] - (afterNext[0] - current[0]) / 6).toFixed(1)} ${(next[1] - (afterNext[1] - current[1]) / 6).toFixed(1)} ${next[0].toFixed(1)} ${next[1].toFixed(1)}`;
        }
        const trailEnvelope = pencilSample.continuous
          ? clamp(cycle / 0.08, 0, 1) * clamp((0.68 - cycle) / 0.08, 0, 1)
          : 1;
        trail = `<path d="${trailPath}" fill="none" stroke="${palette.body}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="${n(clamp(effectWeight * 1.2, 0, 1) * trailEnvelope)}"/>`;
      }
    }
    rear.push(sourceLayer(
      trail + `<path d="${SOURCE_PENCIL_PATH}" fill="${palette.body}" opacity="${n(clamp(effectWeight * 1.6 - 0.3, 0, 1))}" transform="translate(${n(glyphX)} ${n(glyphY)}) rotate(${n(pencil.rotation * effectWeight)}) scale(${n(effectEase)}) translate(${-CENTER} ${-CENTER})"/>`,
    ));
  }
  if (sourceEffects.has("bang")) {
    const bang = sourceBangSample(pose, representativeTime);
    const entry = sourceCubicOut(clamp(effectWeight * 1.1, 0, 1));
    const glyphScale = clamp(effectWeight * 1.2, 0, 1);
    rear.push(sourceLayer(`<path d="${SOURCE_BANG_PATH}" fill="${palette.body}" opacity="${n(clamp(effectWeight * 1.5 - 0.2, 0, 1))}" transform="translate(0 ${n(-26 - (1 - entry) * 70)}) rotate(${n(bang.wiggle)} ${CENTER} ${CENTER - 74}) translate(${CENTER} ${CENTER}) scale(${n(glyphScale)}) translate(${-CENTER} ${-CENTER})"/>`));
  }
  if (sourceEffects.has("standby")) {
    const pulseAmount = 0.5 + 0.5 * Math.sin(representativeTime * 0.0016);
    const pieces = [sourceCircle(CENTER, CENTER, 26 + 7 * pulseAmount, effectEase * (0.06 + 0.1 * pulseAmount))];
    if (effectWeight < 0.995) pieces.push(sourceRing(104 - 88 * effectEase, 2.4, (1 - effectEase) * 0.5));
    rear.push(sourceLayer(pieces.join("")));
  }
  // `whirl` has no detached glyphs; it only drives body/ribbon motion.
  if (sourceEffects.has("humming")) {
    // Two-satellite track. The opposed pair's visible geometry has
    // a PI-period, so the six timed idle cells sample that period in PI/6
    // increments. This produces one continuous visible orbit with an equally
    // spaced c5 -> c0 boundary instead of merely swapping particle identity.
    const satelliteActivation = clamp(pose.hummingActivation ?? 1, 0, 1);
    const thetaBase = Math.PI / 4 + (phase % 6) * Math.PI / 6;
    for (let index = 0; index < 2; index += 1) {
      const theta = thetaBase + index * Math.PI;
      const cosine = Math.cos(theta);
      const depth = 0.55 + 0.45 * clamp((cosine + 1) / 2, 0, 1);
      const markup = sourceCircle(
        CENTER + CENTER * 1.3 * Math.sin(theta),
        CENTER - CENTER * 1.3 * 0.38 * cosine - 8,
        7.5 * depth * satelliteActivation,
        (0.3 + 0.7 * depth) * satelliteActivation,
      );
      (cosine < 0 ? rear : front).push(sourceLayer(markup));
    }
  }
  if (sourceEffects.has("burst")) {
    const pieces = [
      [-0.98, -0.64, 4.5, 0],
      [-0.48, -1.04, 5, 1],
      [0.1, -1.08, 4, 2],
      [0.72, -0.84, 5.5, 3],
      [1.02, -0.35, 4, 4],
      [1.04, 0.34, 5, 5],
      [0.58, 0.88, 4.5, 0],
      [-0.2, 1.02, 4, 2],
      [-0.88, 0.68, 5, 4],
      [-1.08, 0.08, 3.5, 1],
    ];
    pieces.forEach(([cx, cy, cr, ci], index) => {
      const target = index % 3 === 0 ? front : rear;
      const px = x + rx * cx;
      const py = y + ry * cy;
      target.push(index % 2 === 0 ? spark(px, py, cr, color(ci)) : disc(px, py, cr, color(ci)));
    });
  }

  if (effect === "trail-right" || effect === "receive-right" || effect === "drag-right") {
    for (let index = 0; index < 4; index += 1) {
      const offset = (index - 1.5) * 9 + fluidWave * (1.2 + index * 0.18);
      const trailStart = Math.max(13, x - rx - 30 - index * 2 - fluidCounterWave * 1.8);
      // Travel keeps the same wrapped-ribbon grammar as the hero orbit. The
      // ribbon enters with a shallow sweep, then curls behind the silhouette.
      rear.push(path(
        `M${n(trailStart)} ${n(y + offset * 0.5)} ` +
        `C${n(Math.max(9, x - rx - 24))} ${n(y + offset * 0.3 - 8)} ` +
        `${n(Math.max(12, x - rx - 5))} ${n(y + offset + 11)} ` +
        `${n(x - rx * 0.68)} ${n(y + offset * 0.72)}`,
        color(index + 1),
        6.5 - index * 0.22,
      ));
    }
  }
  if (effect === "trail-left" || effect === "send-left" || effect === "drag-left") {
    for (let index = 0; index < 4; index += 1) {
      const offset = (index - 1.5) * 9 + fluidWave * (1.2 + index * 0.18);
      const trailStart = Math.min(CELL_WIDTH - 13, x + rx + 30 + index * 2 + fluidCounterWave * 1.8);
      rear.push(path(
        `M${n(trailStart)} ${n(y + offset * 0.5)} ` +
        `C${n(Math.min(CELL_WIDTH - 9, x + rx + 24))} ${n(y + offset * 0.3 - 8)} ` +
        `${n(Math.min(CELL_WIDTH - 12, x + rx + 5))} ${n(y + offset + 11)} ` +
        `${n(x + rx * 0.68)} ${n(y + offset * 0.72)}`,
        color(index + 1),
        6.5 - index * 0.22,
      ));
    }
  }
  if (effect === "bounce") {
    rear.push(path(`M${n(x - rx * 0.76)} ${n(y + ry * 0.77)} Q${n(x)} ${n(y + ry * 1.06)} ${n(x + rx * 0.76)} ${n(y + ry * 0.77)}`, color(2), 7));
    rear.push(path(`M${n(x - rx * 0.58)} ${n(y + ry * 0.83)} Q${n(x)} ${n(y + ry * 1.01)} ${n(x + rx * 0.58)} ${n(y + ry * 0.83)}`, color(4), 5.5));
  }
  if (effect === "notify") {
    rear.push(path(`M${n(x - rx * 0.42)} ${n(y - ry * 0.8)} Q${n(x)} ${n(y - ry * 1.08)} ${n(x + rx * 0.42)} ${n(y - ry * 0.8)}`, color(0), 7));
    rear.push(path(`M${n(x - rx * 0.28)} ${n(y - ry * 0.88)} Q${n(x)} ${n(y - ry * 1.01)} ${n(x + rx * 0.28)} ${n(y - ry * 0.88)}`, color(2), 5));
  }
  if (effect === "reboot") {
    rear.push(path(`M${n(x - rx * 0.78)} ${n(y + ry * 0.68)} Q${n(x)} ${n(y + ry * 1.02)} ${n(x + rx * 0.78)} ${n(y + ry * 0.68)}`, palette.green, 6.5));
  }

  const orbitTransform = isOrbital && (orbitalTransform.angle !== 0 || orbitalTransform.scale !== 1)
    ? ` transform="translate(${n(x)} ${n(y)}) rotate(${orbitalTransform.angle}) scale(${orbitalTransform.scale}) translate(${n(-x)} ${n(-y)})"`
    : "";
  const effectOpacity = clamp(pose.effectOpacity ?? 1, 0, 1);
  const opacityAttribute = effectOpacity < 0.999 ? ` opacity="${n(effectOpacity)}"` : "";
  return {
    rear: rear.length ? `<g aria-hidden="true"${orbitTransform}${opacityAttribute}>${rear.join("")}</g>` : "",
    front: front.length ? `<g aria-hidden="true"${orbitTransform}${opacityAttribute}>${front.join("")}</g>` : "",
  };
}

function finitePhaseAngle(phase) {
  return Number.isFinite(phase) ? phase * TAU : 0;
}

function armMarkup(pose, transform, palette) {
  const arm = pose.arm;
  if (!arm) return "";
  const { centerX: x, centerY: y, radiusX: rx, radiusY: ry } = transform;
  const right = x + rx * 0.7;
  const left = x - rx * 0.7;
  const upper = y - ry * 0.08;
  const lower = y + ry * 0.26;
  const arms = {
    "right-low": [right - 2, lower, right + 17, lower + 11, right + 27, lower + 1],
    "right-pull": [right - 3, lower, right + 19, lower - 4, right + 25, lower - 19],
    "left-low": [left + 2, lower, left - 17, lower + 11, left - 27, lower + 1],
    "left-pull": [left + 3, lower, left - 19, lower - 4, left - 25, lower - 19],
    "wave-rise": [right - 4, upper, right + 23, upper - 27, right + 18, upper - 49],
    "wave-open": [right - 4, upper, right + 24, upper - 39, right + 18, upper - 57],
    "wave-sweep": [right - 4, upper, right + 23, upper - 28, right + 19, upper - 47],
    "wave-rest": [right - 4, upper, right + 22, upper - 31, right + 15, upper - 48],
  };
  const gestures = {
    "ask-open": [
      [left + 3, lower - 3, left - 17, lower - 13, left - 28, lower - 26],
      [right - 3, lower - 3, right + 17, lower - 13, right + 28, lower - 26],
    ],
    "ask-soft": [
      [left + 3, lower, left - 13, lower - 2, left - 20, lower - 13],
      [right - 3, lower, right + 13, lower - 2, right + 20, lower - 13],
    ],
  };
  const selectionsFor = (name) => gestures[name] ?? (arms[name] == null ? [] : [arms[name]]);
  const baseSelections = selectionsFor(arm);
  const fromSelections = selectionsFor(pose.fluidArmFrom);
  const toSelections = selectionsFor(pose.fluidArmTo);
  const fluidArmMix = clamp(pose.fluidArmMix ?? 0, 0, 1);
  const canInterpolate = fromSelections.length > 0
    && fromSelections.length === toSelections.length
    && fromSelections.every((points, index) => points.length === toSelections[index].length);
  const selections = canInterpolate
    ? fromSelections.map((points, selectionIndex) => points.map((value, pointIndex) => (
        value + (toSelections[selectionIndex][pointIndex] - value) * fluidArmMix
      )))
    : baseSelections;
  if (selections.length === 0) return "";
  const fluidAngle = finitePhaseAngle(pose.fluidMotionPhase);
  const fluidWave = Math.sin(fluidAngle);
  const fluidCounterWave = Math.sin(fluidAngle * 2);
  const paths = selections.map((points) => {
    let [startX, startY, controlX, controlY, endX, endY] = points;
    if (arm.startsWith("wave-")) {
      controlX += fluidWave * 2.2;
      controlY -= fluidCounterWave * 1.8;
      endX += fluidWave * 3;
      endY -= fluidCounterWave * 2.4;
    } else if (arm.startsWith("ask-")) {
      const side = endX < x ? -1 : 1;
      controlX += side * fluidWave * 1.2;
      controlY -= fluidCounterWave * 1.2;
      endX += side * fluidWave * 1.8;
      endY -= fluidCounterWave * 1.8;
    }
    return `M${n(startX)} ${n(startY)} Q${n(controlX)} ${n(controlY)} ${n(endX)} ${n(endY)}`;
  });
  return `<g aria-hidden="true">${paths.map((d) => `<path d="${d}" fill="none" stroke="${palette.body}" stroke-linecap="round" stroke-width="17"/>`).join("")}</g>`;
}

function capsulePath(width = 16, height = 39, brush = 0.12) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const pinch = halfWidth * brush;
  return `M${n(-halfWidth + pinch)} ${n(-halfHeight)}C${n(halfWidth * 0.5)} ${n(-halfHeight - 1.5)} ${n(halfWidth)} ${n(-halfHeight * 0.58)} ${n(halfWidth - pinch)} ${n(-halfHeight * 0.16)}L${n(halfWidth * 0.55)} ${n(halfHeight * 0.78)}C${n(halfWidth * 0.3)} ${n(halfHeight + 1.5)} ${n(-halfWidth * 0.55)} ${n(halfHeight + 1)} ${n(-halfWidth)} ${n(halfHeight * 0.63)}L${n(-halfWidth * 0.56)} ${n(-halfHeight * 0.7)}C${n(-halfWidth * 0.45)} ${n(-halfHeight * 0.9)} ${n(-halfWidth * 0.1)} ${n(-halfHeight)} ${n(-halfWidth + pinch)} ${n(-halfHeight)}Z`;
}

const eyeStyles = Object.freeze({
  // The asymmetry and vertical stagger preserve the intended mark: the lead
  // brush eye is larger and lower; its partner is smaller and higher.
  normal: [{ w: 28, h: 54, r: 15, y: 3 }, { w: 21, h: 41, r: 15, y: -7 }],
  round: [{ kind: "round", w: 40, h: 40, r: 0, y: 12 }, { kind: "round", w: 36, h: 36, r: 0, y: 10 }],
  // Topology 18: one open disc and one compact dot, with a deliberately
  // staggered baseline rather than a conventional matched pair.
  roundAsym: [{ kind: "round", w: 48, h: 48, r: 0, x: -4, y: 18 }, { kind: "round", w: 24, h: 25, r: 0, x: 5, y: 30 }],
  // Surprise topologies 3/21: two very large,
  // unequal discs that arrive after a slit and before the ribbon storm.
  burst: [{ kind: "round", w: 47, h: 56, r: 0, x: -4, y: 27 }, { kind: "round", w: 58, h: 58, r: 0, x: 4, y: 18 }],
  // Topologies 2/11/20 place giant brush eyes unusually low in the body.
  deepTall: [{ w: 50, h: 88, r: 13, x: -3, y: 47 }, { w: 48, h: 84, r: 13, x: 5, y: 54 }],
  lowerTall: [{ w: 32, h: 61, r: 10, x: -2, y: 35 }, { w: 31, h: 61, r: 17, x: 4, y: 46 }],
  // Topologies 5/14/23 mix a vertical brush with a horizontal lid.
  mixed: [{ w: 34, h: 61, r: -4, x: -3, y: 30 }, { w: 49, h: 23, r: 74, x: 4, y: 16 }],
  orbiting: [{ w: 28, h: 54, r: 17, y: 3 }, { w: 23, h: 46, r: -25, y: -2 }],
  soft: [{ w: 26, h: 46, r: 15, y: 4 }, { w: 20, h: 37, r: 15, y: -4 }],
  listen: [{ w: 22, h: 50, r: 10, y: 2 }, { w: 21, h: 55, r: 17, y: -5 }],
  curious: [{ w: 24, h: 56, r: 10, y: -6 }, { w: 18, h: 44, r: 19, y: 3 }],
  shy: [{ w: 22, h: 35, r: 24, x: 2, y: 7 }, { w: 20, h: 32, r: 6, x: -2, y: 3 }],
  drowsy: [{ w: 22, h: 14, r: 72, y: 9 }, { w: 19, h: 12, r: 72, y: 4 }],
  sleep: [{ w: 27, h: 11, r: 82, y: 11 }, { w: 23, h: 9, r: 82, y: 5 }],
  focused: [{ w: 24, h: 38, r: 22, y: 4 }, { w: 20, h: 32, r: 8, y: -1 }],
  search: [{ w: 21, h: 50, r: 18, x: 5, y: 2 }, { w: 24, h: 56, r: 19, x: 6, y: -5 }],
  work: [{ w: 23, h: 43, r: 22, y: 3 }, { w: 20, h: 37, r: 7, y: -2 }],
  think: [{ w: 20, h: 37, r: 8, y: -5 }, { w: 18, h: 43, r: 20, y: 1 }],
  wide: [{ w: 23, h: 57, r: 13, y: -3 }, { w: 20, h: 49, r: 13, y: -7 }],
  surprised: [{ w: 23, h: 59, r: 5, y: -4 }, { w: 21, h: 55, r: 5, y: -7 }],
  suspicious: [{ w: 27, h: 24, r: 62, y: 4 }, { w: 20, h: 31, r: 48, y: 2 }],
  confused: [{ w: 18, h: 34, r: -5, y: 3 }, { w: 22, h: 43, r: 27, y: -4 }],
  alert: [{ w: 21, h: 53, r: 10, y: -1 }, { w: 19, h: 46, r: 10, y: -6 }],
  proud: [{ w: 26, h: 33, r: 34, y: 3 }, { w: 22, h: 28, r: -4, y: -1 }],
  happy: [{ w: 28, h: 23, r: 48, y: 5 }, { w: 24, h: 20, r: -18, y: 1 }],
  laugh: [{ w: 30, h: 18, r: 53, y: 5 }, { w: 26, h: 16, r: -23, y: 1 }],
  scared: [{ w: 18, h: 60, r: 4, x: -2, y: -3 }, { w: 16, h: 52, r: 4, x: 2, y: -8 }],
  angry: [{ w: 28, h: 26, r: 55, y: 3 }, { w: 24, h: 23, r: -25, y: -1 }],
  sad: [{ w: 24, h: 36, r: -18, y: 6 }, { w: 20, h: 31, r: 48, y: 2 }],
  wink: [{ w: 29, h: 11, r: 75, y: 5 }, { w: 21, h: 47, r: 14, y: -5 }],
  effortRight: [{ w: 21, h: 33, r: 24, x: 3, y: 2 }, { w: 26, h: 47, r: 17, x: 5, y: -4 }],
  effortLeft: [{ w: 26, h: 47, r: 13, x: -5, y: 2 }, { w: 21, h: 33, r: 6, x: -3, y: -4 }],
});

// These face parameters apply after selecting one of the 25 eye pairs. The
// Character Lab sets uniformEyes=true: gap, height, eyeWidth and eyeHeight still
// apply, while faceTune.size is deliberately bypassed in favour of the animated
// eye-size target.
const SOURCE_FACE_TUNE = Object.freeze({
  size: 0.86,
  gap: 1.18,
  height: 1,
  eyeWidth: 0.96,
  eyeHeight: 0.92,
});

const SOURCE_STATE_TUNE = Object.freeze({
  angry: Object.freeze({ gap: 1.28, size: 0.78, eyeWidth: 0.88, eyeHeight: 0.84 }),
  suspicious: Object.freeze({ gap: 1.24, size: 0.82, eyeWidth: 0.90 }),
  confused: Object.freeze({ gap: 1.20, size: 0.84, eyeWidth: 0.90 }),
  scared: Object.freeze({ size: 0.80, eyeWidth: 0.90, eyeHeight: 0.88 }),
  surprised: Object.freeze({ size: 0.76, eyeWidth: 0.86, eyeHeight: 0.86 }),
  excited: Object.freeze({ size: 0.78, eyeWidth: 0.88, eyeHeight: 0.88 }),
  celebrate: Object.freeze({ size: 0.74, eyeWidth: 0.84, eyeHeight: 0.84 }),
  happy: Object.freeze({ size: 0.76, eyeWidth: 0.86, eyeHeight: 0.84 }),
  curious: Object.freeze({ size: 0.84 }),
  drowsy: Object.freeze({ size: 0.92, eyeWidth: 0.96 }),
  bored: Object.freeze({ size: 0.92, eyeWidth: 0.96 }),
  sad: Object.freeze({ size: 0.92, eyeWidth: 0.96 }),
  playful: Object.freeze({ size: 0.84, gap: 1.20 }),
});

const SOURCE_SHAPE_EYE_SCALE = Object.freeze({
  blob: Object.freeze({ x: 1, y: 1 }),
  pebble: Object.freeze({ x: 0.92 / 0.96, y: 0.92 / 0.96 }),
  squircle: Object.freeze({ x: 0.92 / 0.84, y: 0.92 / 0.84 }),
  tablet: Object.freeze({ x: 0.92, y: 0.92 }),
  wedge: Object.freeze({ x: 0.92 / 0.94, y: 0.92 / 0.94 }),
  hex: Object.freeze({ x: 0.92 / 0.94, y: 0.92 / 0.94 }),
  cloud: Object.freeze({ x: 0.92, y: 0.92 }),
  teardrop: Object.freeze({ x: 0.92, y: 0.92 }),
});

function sourceTuneFor(state) {
  if (state === "idle") return { ...SOURCE_FACE_TUNE };
  if (state === "working") {
    return {
      ...SOURCE_FACE_TUNE,
      size: SOURCE_FACE_TUNE.size * 1.05,
      eyeWidth: SOURCE_FACE_TUNE.eyeWidth * 1.12,
      eyeHeight: SOURCE_FACE_TUNE.eyeHeight * 1.02,
    };
  }
  const stateTune = SOURCE_STATE_TUNE[state];
  return {
    size: Math.min(stateTune?.size ?? SOURCE_FACE_TUNE.size, 0.92),
    gap: Math.max(stateTune?.gap ?? SOURCE_FACE_TUNE.gap, 1.14),
    height: stateTune?.height ?? SOURCE_FACE_TUNE.height,
    eyeWidth: Math.min(stateTune?.eyeWidth ?? SOURCE_FACE_TUNE.eyeWidth, 1),
    eyeHeight: Math.min(stateTune?.eyeHeight ?? SOURCE_FACE_TUNE.eyeHeight, 1),
  };
}

// Static representatives of the character's animated eye-size targets.
// These are intentionally separate from faceTune.size: uniformEyes=true makes
// the latter a no-op in the shipped wrapper.
const SOURCE_STATE_EYE_SCALE = Object.freeze({
  excited: 1.06,
  surprised: 1.07,
  happy: 1.05,
  curious: 1.08,
  bored: 0.98,
  proud: 1.02,
  shy: 0.95,
  sad: 0.97,
  scared: 1.12,
  playful: 1.06,
  celebrate: 1.10,
  dragging: 1.06,
  notifying: 1.03,
});

function pointsPath(points) {
  return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${n(x)} ${n(y)}`).join("")}Z`;
}

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

// The path flattener (tolerance 4) and 160-row scanline table provide dense
// static-shape spans; the 96-point collision ring is the geometric fallback
// while a shape is turning or morphing.
function flattenSourcePath(path, tolerance = 4) {
  const tokens = path.match(/[MLCQZmlcqz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const points = [];
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const number = () => Number.parseFloat(tokens[index++]);
  const sample = (at, length) => {
    const count = Math.max(2, Math.ceil(length / tolerance));
    for (let step = 1; step <= count; step += 1) points.push(at(step / count));
  };

  while (index < tokens.length) {
    if (/[a-z]/i.test(tokens[index])) command = tokens[index++].toUpperCase();
    if (command === "Z") {
      if (Math.hypot(startX - x, startY - y) > 0.01) {
        sample((amount) => [x + (startX - x) * amount, y + (startY - y) * amount], Math.hypot(startX - x, startY - y));
      }
      x = startX;
      y = startY;
      continue;
    }
    if (index >= tokens.length) break;
    if (command === "M") {
      x = number();
      y = number();
      startX = x;
      startY = y;
      points.push([x, y]);
      command = "L";
    } else if (command === "L") {
      const targetX = number();
      const targetY = number();
      const fromX = x;
      const fromY = y;
      sample((amount) => [fromX + (targetX - fromX) * amount, fromY + (targetY - fromY) * amount], Math.hypot(targetX - fromX, targetY - fromY));
      x = targetX;
      y = targetY;
    } else if (command === "Q") {
      const controlX = number();
      const controlY = number();
      const targetX = number();
      const targetY = number();
      const fromX = x;
      const fromY = y;
      sample((amount) => {
        const inverse = 1 - amount;
        return [
          inverse ** 2 * fromX + 2 * inverse * amount * controlX + amount ** 2 * targetX,
          inverse ** 2 * fromY + 2 * inverse * amount * controlY + amount ** 2 * targetY,
        ];
      }, Math.hypot(controlX - x, controlY - y) + Math.hypot(targetX - controlX, targetY - controlY));
      x = targetX;
      y = targetY;
    } else if (command === "C") {
      const control1X = number();
      const control1Y = number();
      const control2X = number();
      const control2Y = number();
      const targetX = number();
      const targetY = number();
      const fromX = x;
      const fromY = y;
      sample((amount) => {
        const inverse = 1 - amount;
        return [
          inverse ** 3 * fromX + 3 * inverse ** 2 * amount * control1X + 3 * inverse * amount ** 2 * control2X + amount ** 3 * targetX,
          inverse ** 3 * fromY + 3 * inverse ** 2 * amount * control1Y + 3 * inverse * amount ** 2 * control2Y + amount ** 3 * targetY,
        ];
      }, Math.hypot(control1X - x, control1Y - y) + Math.hypot(control2X - control1X, control2Y - control1Y) + Math.hypot(targetX - control2X, targetY - control2Y));
      x = targetX;
      y = targetY;
    } else {
      index += 1;
    }
  }
  return points;
}

function denseSourceSpan(points, rowCount = 160) {
  let top = Infinity;
  let bottom = -Infinity;
  for (const [, pointY] of points) {
    top = Math.min(top, pointY);
    bottom = Math.max(bottom, pointY);
  }
  const height = bottom - top;
  const left = new Float64Array(rowCount);
  const right = new Float64Array(rowCount);
  for (let row = 0; row < rowCount; row += 1) {
    const scanY = top + height * (row + 0.5) / rowCount;
    let innerLeft = -Infinity;
    let innerRight = Infinity;
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const current = points[pointIndex];
      const next = points[(pointIndex + 1) % points.length];
      if ((current[1] <= scanY) === (next[1] <= scanY)) continue;
      const crossingX = current[0] + (next[0] - current[0]) * (scanY - current[1]) / (next[1] - current[1]);
      if (crossingX <= CENTER) innerLeft = Math.max(innerLeft, crossingX);
      else innerRight = Math.min(innerRight, crossingX);
    }
    left[row] = Number.isFinite(innerLeft) ? innerLeft : CENTER;
    right[row] = Number.isFinite(innerRight) ? innerRight : CENTER;
  }
  return {
    top,
    bottom,
    spanAt(scanY) {
      const position = clamp((scanY - top) / height * rowCount - 0.5, 0, rowCount - 1);
      const lower = Math.floor(position);
      const amount = position - lower;
      const upper = Math.min(lower + 1, rowCount - 1);
      return [
        left[lower] + (left[upper] - left[lower]) * amount,
        right[lower] + (right[upper] - right[lower]) * amount,
      ];
    },
  };
}

const SOURCE_DENSE_SPANS = new Map(Object.entries(GROK_BODY_SHAPES).map(([shapeId, shape]) => [
  shapeId,
  denseSourceSpan(flattenSourcePath(shape.path)),
]));

const SOURCE_BALL_SPAN = Object.freeze({
  top: 0,
  bottom: CENTER * 2,
  spanAt(scanY) {
    const halfWidth = Math.sqrt(Math.max(0, CENTER ** 2 - (scanY - CENTER) ** 2));
    return [CENTER - halfWidth, CENTER + halfWidth];
  },
});

function meanPoint(points) {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
  }
  return [x / points.length, y / points.length];
}

function sourceTopologyMarkup(pose, palette) {
  const topologyFrom = pose.fluidTopology ?? GROK_EYE_TOPOLOGIES[pose.topology];
  if (!topologyFrom) throw new Error(`Unknown Grok Bot eye topology: ${pose.topology}`);
  const topologyTo = pose.fluidTopology == null && Number.isInteger(pose.topologyTo)
    ? GROK_EYE_TOPOLOGIES[pose.topologyTo]
    : null;
  if (Number.isInteger(pose.topologyTo) && !topologyTo) {
    throw new Error(`Unknown Grok Bot eye topology target: ${pose.topologyTo}`);
  }
  const topologyMix = topologyTo == null ? 0 : clamp(pose.topologyMix ?? 0, 0, 1);
  // Every authored topology has the same point ordering, so interpolating the
  // 48 corresponding points produces genuine in-between eye shapes instead of
  // a hard swap between expressions at Codex's low playback cadence.
  const topology = topologyTo == null || topologyMix <= 0
    ? topologyFrom
    : topologyFrom.map((eye, eyeIndex) => eye.map(([x, y], pointIndex) => {
      const [targetX, targetY] = topologyTo[eyeIndex][pointIndex];
      return [
        x + (targetX - x) * topologyMix,
        y + (targetY - y) * topologyMix,
      ];
    }));
  const state = pose.sourceState ?? pose.states?.[0] ?? "idle";
  const tune = sourceTuneFor(state);
  const shapeId = pose.shape ?? "blob";
  const shape = GROK_BODY_SHAPES[shapeId] ?? GROK_BODY_SHAPES.blob;
  const denseGeometry = shapeId === "ball" ? SOURCE_BALL_SPAN : SOURCE_DENSE_SPANS.get(shapeId);
  const face = shape.face;
  const shapeScale = SOURCE_SHAPE_EYE_SCALE[shapeId] ?? { x: 0.92, y: 0.92 };
  const gazeX = pose.gazeX ?? 0;
  const gazeY = pose.gazeY ?? 0;
  const isGaze = Number.isFinite(pose.gazeAngle) || String(pose.expression ?? "").startsWith("gaze-");
  const gazeOffsetX = gazeX * (isGaze ? 22 : 7);
  const gazeOffsetY = gazeY * (isGaze ? 14 : 6);
  const centroids = topology.map(meanPoint);
  let leftHalfWidth = 0;
  let rightHalfWidth = 0;
  for (const [pointX] of topology[0]) leftHalfWidth = Math.max(leftHalfWidth, Math.abs(pointX - centroids[0][0]));
  for (const [pointX] of topology[1]) rightHalfWidth = Math.max(rightHalfWidth, Math.abs(pointX - centroids[1][0]));
  const leftDX = face.leftDX ?? 0;
  const horizontalScale = face.sx * tune.gap;
  const pairGap = Math.abs(centroids[1][0] - (centroids[0][0] + leftDX)) * horizontalScale;
  const pairFit = leftHalfWidth + rightHalfWidth > 0.5
    ? clamp(pairGap / (leftHalfWidth + rightHalfWidth), 0.35, 4)
    : 4;
  const stateScale = SOURCE_STATE_EYE_SCALE[state] ?? 1;
  const baseScale = Math.min(clamp(stateScale * shapeScale.x, 0.2, 2), pairFit);
  const scaleX = Math.min(baseScale * clamp(tune.eyeWidth, 0.2, 3), pairFit);
  const scaleY = baseScale * clamp(tune.eyeHeight, 0.2, 3);

  const eyes = topology.map((points, eyeIndex) => {
    const [centerX, centerY] = centroids[eyeIndex];
    const desiredY = CENTER + face.y + (centerY + gazeOffsetY - CENTER) * face.sy * tune.height;
    const verticalMargin = 21 * scaleY + 2;
    const shapeTop = shapeId === "ball" ? denseGeometry.top : shape.top;
    const shapeBottom = shapeId === "ball" ? denseGeometry.bottom : shape.bottom;
    const targetY = clamp(desiredY, shapeTop + verticalMargin, shapeBottom - verticalMargin);
    let minimumX = -Infinity;
    let maximumX = Infinity;
    for (let index = 0; index < points.length; index += 2) {
      const [pointX, pointY] = points[index];
      const offsetX = (pointX - centerX) * scaleX;
      const [left, right] = denseGeometry.spanAt(targetY + (pointY - centerY) * scaleY);
      minimumX = Math.max(minimumX, left - offsetX);
      maximumX = Math.min(maximumX, right - offsetX);
    }
    const sourceCenterX = centerX + (eyeIndex === 0 ? leftDX : 0);
    const desiredX = CENTER + face.x + (sourceCenterX + gazeOffsetX - CENTER) * horizontalScale;
    const targetX = minimumX <= maximumX
      ? clamp(desiredX, minimumX, maximumX)
      : (minimumX + maximumX) / 2;
    return `<path d="${pointsPath(points)}" fill="${palette.eye}" transform="translate(${n(targetX)} ${n(targetY)}) scale(${n(scaleX)} ${n(scaleY)}) translate(${n(-centerX)} ${n(-centerY)})"/>`;
  });

  const morphData = topologyTo == null
    ? ""
    : ` data-eye-topology-to="${pose.topologyTo}" data-eye-topology-mix="${n(topologyMix)}"`;
  const fluidData = pose.fluidTopology == null ? "" : ` data-eye-fluid="true"`;
  return `<g aria-hidden="true" data-eye-topology="${pose.topology}"${morphData}${fluidData} data-source-state="${state}">${eyes.join("")}</g>`;
}

function eyesMarkup(pose, palette) {
  if (Number.isFinite(pose.gazeAngle) || String(pose.expression ?? "").startsWith("gaze-")) {
    return sourceTopologyMarkup({ ...pose, topology: 0 }, palette);
  }
  if (Number.isInteger(pose.topology)) return sourceTopologyMarkup(pose, palette);
  const expressionAliases = {
    bright: "wide",
    "side-right": "search",
    "side-left": "search",
    "effort-right": "effortRight",
    "effort-left": "effortLeft",
  };
  const expression = expressionAliases[pose.expression] ?? pose.expression ?? "normal";
  const isGaze = false;
  const gazeX = pose.gazeX ?? 0;
  const gazeY = pose.gazeY ?? 0;
  const pairX = isGaze ? gazeX * 17 : gazeX * 7;
  const pairY = isGaze ? gazeY * 14 : gazeY * 6;
  const base = eyeStyles[isGaze ? "normal" : expression] ?? eyeStyles.normal;
  const basePositions = [CENTER - 19, CENTER + 39];
  const eyes = base.map((eye, index) => {
    const nearSide = gazeX > 0 ? 0 : 1;
    const sideCompression = isGaze && Math.abs(gazeX) > 0.01 && index === nearSide ? Math.abs(gazeX) * 3.5 : 0;
    const width = Math.max(11, eye.w - sideCompression);
    const height = eye.h * (isGaze ? 1 - Math.max(0, gazeY) * 0.08 : 1);
    const rotation = eye.r + (isGaze ? gazeX * 8 - gazeY * 2 : 0);
    const x = basePositions[index] + (eye.x ?? 0) + pairX;
    const y = CENTER - 31 + (eye.y ?? 0) + pairY;
    if (eye.kind === "round") {
      return `<ellipse cx="0" cy="0" rx="${n(width / 2)}" ry="${n(height / 2)}" fill="${palette.eye}" transform="translate(${n(x)} ${n(y)})"/>`;
    }
    return `<path d="${capsulePath(width, height, expression === "scared" ? 0.04 : 0.12)}" fill="${palette.eye}" transform="translate(${n(x)} ${n(y)}) rotate(${n(rotation)})"/>`;
  });
  return `<g aria-hidden="true">${eyes.join("")}</g>`;
}

function frontDetailMarkup(pose, palette) {
  if (pose.effect === "tear") {
    return `<g aria-hidden="true" fill="none" stroke="${palette.blue}" stroke-linecap="round" stroke-width="5"><path d="M96 108Q92 123 96 138"/><path d="M153 102Q157 120 153 137"/></g>`;
  }
  return "";
}

export function renderFrameSvg(pose, options = {}) {
  const title = options.title ?? pose.name ?? "Grok Bot";
  const palette = THEME_PALETTES[options.theme ?? "dark-codex"];
  if (!palette) throw new Error(`Unknown Grok Bot theme: ${options.theme}`);
  const transform = transformFor(pose);
  const effectBody = sourceEffectBodySample(pose);
  const path = effectBody?.path ?? bodyPath(pose);
  // Once an effect completes its eye-dissolve boundary, the transformed body
  // is the whole performance. Full-size Codex arms or decorative travel ribbons
  // would float around that smaller body and create an incoherent hybrid pose.
  const suppressCodexAttachments = effectBody?.eyesFullyHidden === true;
  const suppressGenericEffect = SOURCE_EFFECT_MODES.has(pose.sourceEffect);
  const attachmentPose = suppressGenericEffect ? { ...pose, effect: null } : pose;
  const orbit = orbitMarkup(attachmentPose, transform, palette);
  const arm = suppressCodexAttachments ? "" : armMarkup(pose, transform, palette);
  const accessibilityTitle = String(title).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const bodyOpacity = (pose.bodyOpacity ?? 1) * (effectBody?.opacity ?? 1);
  const sourceEffectData = effectBody
    ? ` data-source-effect-family="${effectBody.family}" data-source-effect-activation="${effectBody.activation}" data-source-eye-opacity="${n(effectBody.eyeOpacity)}" data-source-eye-scale="${n(effectBody.eyeScale)}" data-source-eyes-hidden="${effectBody.eyesFullyHidden}"`
    : "";
  const innerTransform = effectBody ? ` transform="${effectBody.transform}"` : "";
  const eyes = eyesMarkup(pose, palette);
  const renderedEyes = effectBody
    ? `<g data-source-effect-eyes="true" opacity="${n(effectBody.eyeOpacity)}" transform="translate(${CENTER} ${CENTER}) scale(${n(effectBody.eyeScale)}) translate(${-CENTER} ${-CENTER})">${eyes}</g>`
    : eyes;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CELL_WIDTH}" height="${CELL_HEIGHT}" viewBox="0 0 ${CELL_WIDTH} ${CELL_HEIGHT}" role="img" aria-label="${accessibilityTitle}">
  <title>${accessibilityTitle}</title>
  ${orbit.rear}
  ${arm}
  <g transform="${transform.value}" opacity="${n(bodyOpacity)}"${sourceEffectData}>
    <g${innerTransform}>
      <path d="${path}" fill="${palette.body}"/>
      ${renderedEyes}
      ${frontDetailMarkup(pose, palette)}
    </g>
  </g>
  ${orbit.front}
</svg>`;
}

export function renderEmptySvg() {
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${CELL_WIDTH}" height="${CELL_HEIGHT}" viewBox="0 0 ${CELL_WIDTH} ${CELL_HEIGHT}"/>`;
}
