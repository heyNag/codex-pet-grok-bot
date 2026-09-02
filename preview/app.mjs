import { SOURCE_EFFECTS, SOURCE_STATES } from "./source-states.mjs";
import {
  runtimeSpriteOriginIsIntegral,
  runtimeSpriteOriginSnap,
} from "./runtime-geometry.mjs";

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;

const petThemes = new Map([
  [
    "dark",
    {
      id: "dark",
      label: "Dark Codex",
      packageId: "grok-bot-dark",
      appearance: "white bot on a dark surface",
      spritesheet: "../pet/grok-bot-dark/spritesheet.webp",
      authoringAtlas: "../qa/authoring-atlas-dark.webp",
      sourceAtlas: "./source-lab/state-atlas-dark.webp",
    },
  ],
  [
    "light",
    {
      id: "light",
      label: "Light Codex",
      packageId: "grok-bot-light",
      appearance: "black bot on a light surface",
      spritesheet: "../pet/grok-bot-light/spritesheet.webp",
      authoringAtlas: "../qa/authoring-atlas-light.webp",
      sourceAtlas: "./source-lab/state-atlas-light.webp",
    },
  ],
]);

const behaviors = [
  {
    id: "idle",
    row: 0,
    label: "Idle",
    shortLabel: "Idle",
    frames: 6,
    durations: [280, 110, 110, 140, 140, 320],
    event: "Resting terminal",
  },
  {
    id: "travel-right",
    row: 1,
    label: "Travel right",
    shortLabel: "Right",
    frames: 8,
    durations: [120, 120, 120, 120, 120, 120, 120, 220],
    event: "Dragged right",
  },
  {
    id: "travel-left",
    row: 2,
    label: "Travel left",
    shortLabel: "Left",
    frames: 8,
    durations: [120, 120, 120, 120, 120, 120, 120, 220],
    event: "Dragged left",
  },
  {
    id: "wave",
    row: 3,
    label: "Wave",
    shortLabel: "Wave",
    frames: 4,
    durations: [140, 140, 140, 280],
    event: "Greeting",
  },
  {
    id: "jump",
    row: 4,
    label: "Jump",
    shortLabel: "Jump",
    frames: 5,
    durations: [140, 140, 140, 140, 280],
    event: "Pointer hover",
  },
  {
    id: "failed",
    row: 5,
    label: "Failed / blocked",
    shortLabel: "Failed",
    frames: 8,
    durations: [140, 140, 140, 140, 140, 140, 140, 240],
    event: "Task blocked",
  },
  {
    id: "waiting",
    row: 6,
    label: "Waiting for input",
    shortLabel: "Waiting",
    frames: 6,
    durations: [150, 150, 150, 150, 150, 260],
    event: "Needs input",
  },
  {
    id: "working",
    row: 7,
    label: "Active work",
    shortLabel: "Working",
    frames: 6,
    durations: [120, 120, 120, 120, 120, 220],
    event: "Task running",
  },
  {
    id: "review",
    row: 8,
    label: "Ready for review",
    shortLabel: "Review",
    frames: 6,
    durations: [150, 150, 150, 150, 150, 280],
    event: "Task ready",
  },
];

const directionNames = [
  "up",
  "up-right shallow",
  "up-right",
  "right-up shallow",
  "right",
  "right-down shallow",
  "down-right",
  "down-right steep",
  "down",
  "down-left steep",
  "down-left",
  "left-down shallow",
  "left",
  "left-up shallow",
  "up-left",
  "up-left steep",
];

const elements = {
  runtimeState: document.querySelector("#runtime-state"),
  cellReadout: document.querySelector("#cell-readout"),
  framePill: document.querySelector("#frame-pill"),
  behaviorList: document.querySelector("#behavior-list"),
  stateSelect: document.querySelector("#source-state"),
  stateExplanation: document.querySelector("#state-explanation"),
  timingReadout: document.querySelector("#timing-readout"),
  timingTrack: document.querySelector("#timing-track"),
  playPause: document.querySelector("#play-pause"),
  playIcon: document.querySelector("#play-icon"),
  playLabel: document.querySelector("#play-label"),
  previousFrame: document.querySelector("#previous-frame"),
  nextFrame: document.querySelector("#next-frame"),
  hostSettle: document.querySelector("#host-settle"),
  runtimePetSize: document.querySelector("#runtime-pet-size"),
  smoothRenderer: document.querySelector("#smooth-renderer"),
  rendererReadout: document.querySelector("#renderer-readout"),
  gazeField: document.querySelector("#gaze-field"),
  gazePointer: document.querySelector("#gaze-pointer"),
  angleReadout: document.querySelector("#angle-readout"),
  directionReadout: document.querySelector("#direction-readout"),
  sheetToggle: document.querySelector("#sheet-toggle"),
  sheetClose: document.querySelector("#sheet-close"),
  atlasPanel: document.querySelector("#atlas-panel"),
  atlasLegend: document.querySelector("#atlas-legend"),
  atlasTitle: document.querySelector("#atlas-title"),
  atlasDescription: document.querySelector("#atlas-description"),
  atlasVariant: document.querySelector("#atlas-variant"),
  previewModeButtons: document.querySelectorAll("[data-preview-mode-button]"),
  themeDescription: document.querySelector("#theme-description"),
  motionList: document.querySelector("#source-effect-list"),
  motionReadout: document.querySelector("#source-motion-readout"),
};

const themeElements = new Map(
  [...petThemes.keys()].map((themeId) => [
    themeId,
    {
      stage: document.querySelector(`#pet-stage-${themeId}`),
      sprite: document.querySelector(`[data-pet-sprite="${themeId}"]`),
      atlasMissing: document.querySelector(`[data-atlas-missing="${themeId}"]`),
      motionStage: document.querySelector(`#source-motion-previews [data-theme-pane="${themeId}"]`),
      motionImage: document.querySelector(`[data-source-motion-image="${themeId}"]`),
      motionMissing: document.querySelector(`[data-motion-missing="${themeId}"]`),
      atlasView: document.querySelector(`#atlas-views [data-theme-pane="${themeId}"]`),
      atlasFrame: document.querySelector(`[data-atlas-frame="${themeId}"]`),
      atlasImage: document.querySelector(`[data-atlas-image="${themeId}"]`),
      atlasFocus: document.querySelector(`[data-atlas-focus="${themeId}"]`),
    },
  ]),
);

let behavior = behaviors[0];
let frame = 0;
let playing = true;
let activeAtlasRows = 11;
let timer = null;
let completedCycles = 0;
let idleMultiplier = 6;
let gazeActive = false;
let gazeDirectionIndex = 0;
let previewMode = "both";
let viewMode = "behavior";
let currentSourceState = null;
let currentSourceEffect = SOURCE_EFFECTS.find(({ effect }) => effect === "whirl");
const atlasProbeVersions = new Map([...petThemes.keys()].map((themeId) => [themeId, 0]));
const motionImageListeners = new Map();
let runtimeSpriteSnapRequest = null;
let runtimeSpriteSnapGeneration = 0;

function visibleRuntimeSpriteWraps() {
  return [...themeElements.values()]
    .map(({ sprite }) => sprite.closest(".sprite-wrap"))
    .filter((wrap) => wrap && !wrap.closest("[hidden]"));
}

function snapRuntimeSpriteOrigins() {
  const wraps = visibleRuntimeSpriteWraps();
  wraps.forEach((wrap) => {
    const rect = wrap.getBoundingClientRect();
    const currentX = Number.parseFloat(wrap.style.getPropertyValue("--runtime-snap-x")) || 0;
    const currentY = Number.parseFloat(wrap.style.getPropertyValue("--runtime-snap-y")) || 0;
    const offset = runtimeSpriteOriginSnap({
      x: rect.x - currentX,
      y: rect.y - currentY,
    });
    wrap.style.setProperty("--runtime-snap-x", `${offset.x}px`);
    wrap.style.setProperty("--runtime-snap-y", `${offset.y}px`);
  });

  return wraps.every((wrap) => runtimeSpriteOriginIsIntegral(wrap.getBoundingClientRect()));
}

function scheduleRuntimeSpriteOriginSnap() {
  runtimeSpriteSnapGeneration += 1;
  const generation = runtimeSpriteSnapGeneration;
  if (runtimeSpriteSnapRequest !== null) {
    window.cancelAnimationFrame(runtimeSpriteSnapRequest);
  }
  let settlingFrames = 4;
  const settle = () => {
    if (generation !== runtimeSpriteSnapGeneration) return;
    snapRuntimeSpriteOrigins();
    settlingFrames -= 1;
    if (settlingFrames > 0) runtimeSpriteSnapRequest = window.requestAnimationFrame(settle);
    else runtimeSpriteSnapRequest = null;
  };
  runtimeSpriteSnapRequest = window.requestAnimationFrame(settle);
}

function renderAtlasLegend(kind) {
  elements.atlasLegend.replaceChildren();
  elements.atlasLegend.dataset.atlasKind = kind;

  if (kind === "source") {
    for (let row = 0; row < 5; row += 1) {
      const first = row * 8;
      const states = SOURCE_STATES.slice(first, first + 8);
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `<code>ROW ${row}</code><span>${states.map(({ state }) => state).join(" · ")}</span>`;
      elements.atlasLegend.append(item);
    }
    return;
  }

  for (let row = 0; row < 11; row += 1) {
    const item = document.createElement("div");
    item.className = "legend-item";
    const name = row < 9 ? behaviors[row].label : row === 9 ? "Gaze 0°–157.5°" : "Gaze 180°–337.5°";
    item.innerHTML = `<code>ROW ${row}</code><span>${name}</span>`;
    elements.atlasLegend.append(item);
  }
}

function setAtlasMode(kind) {
  const sourceMode = kind === "source";
  const rows = sourceMode ? 5 : 11;
  activeAtlasRows = rows;
  const height = rows * CELL_HEIGHT;

  for (const [themeId, theme] of petThemes) {
    const targets = themeElements.get(themeId);
    const atlasSource = sourceMode ? theme.sourceAtlas : theme.spritesheet;
    const spriteSource = sourceMode
      ? theme.sourceAtlas
      : !playing && viewMode === "behavior"
        ? theme.authoringAtlas
        : theme.spritesheet;
    targets.sprite.style.backgroundImage = `url("${spriteSource}")`;
    targets.sprite.style.backgroundSize = `${8 * 100}% ${rows * 100}%`;
    targets.atlasImage.src = atlasSource;
    targets.atlasFrame.style.setProperty("--atlas-rows", String(rows));
    targets.atlasFrame.style.setProperty("--atlas-height", String(height));
    targets.atlasFrame.dataset.atlasKind = kind;
    targets.atlasImage.alt = sourceMode
      ? `Five-row Grok Bot Character Lab state atlas for ${theme.label}, the ${theme.appearance}`
      : `Complete 8 by 11 Grok Bot sprite atlas for ${theme.label}, the ${theme.appearance}`;
    checkAtlas(themeId, spriteSource);
  }

  if (sourceMode) {
    elements.atlasTitle.textContent = "1536 × 1040 Character Lab atlas";
    elements.atlasDescription.textContent = "39 character-state snapshots · eight columns, five rows · inspection views, not an installable Codex row set.";
  } else {
    elements.atlasTitle.textContent = "1536 × 2288 transparent atlas";
    elements.atlasDescription.textContent = "Eight columns, eleven rows, 192 × 208 pixels per cell.";
  }

  if (previewMode === "both") {
    elements.atlasVariant.textContent = sourceMode
      ? "Dark Codex + Light Codex · synchronized Character Lab comparison"
      : "Dark Codex + Light Codex · synchronized installable comparison";
    elements.themeDescription.innerHTML = sourceMode
      ? `Comparing both Character Lab atlases. Their installable choreography remains split across <code>grok-bot-dark</code> and <code>grok-bot-light</code>.`
      : `Comparing <code>grok-bot-dark</code> and <code>grok-bot-light</code> with one synchronized controller.`;
  } else {
    const theme = petThemes.get(previewMode);
    elements.atlasVariant.textContent = sourceMode
      ? `${theme.label} · Character Lab`
      : `${theme.label} · ${theme.packageId}`;
    elements.themeDescription.innerHTML = sourceMode
      ? `Showing the ${theme.label} Character Lab. Its installable choreography remains the independent <code>${theme.packageId}</code> package.`
      : `Showing ${theme.label} from the independently installable <code>${theme.packageId}</code> package.`;
  }

  renderAtlasLegend(kind);
  scheduleRuntimeSpriteOriginSnap();
}

function setSpriteCell(row, column, label = behavior.label) {
  for (const [themeId, theme] of petThemes) {
    const targets = themeElements.get(themeId);
    targets.sprite.style.backgroundPosition = `${column / 7 * 100}% ${row / (activeAtlasRows - 1) * 100}%`;
    targets.sprite.setAttribute("aria-label", `${theme.label} Grok Bot: ${label}, row ${row}, column ${column}`);
    targets.atlasFocus.style.transform = `translate(${column * 100}%, ${row * 100}%)`;
  }
  elements.cellReadout.textContent = `${viewMode === "source" ? "character · " : ""}r${row} · c${column}`;
}

function renderFrame() {
  if (viewMode !== "behavior" || gazeActive) return;
  setSpriteCell(behavior.row, frame);
  document.querySelectorAll(".timing-segment").forEach((segment, index) => {
    segment.classList.toggle("is-active", index === frame);
  });
}

function clearPlaybackTimer() {
  if (timer) {
    window.clearTimeout(timer);
    timer = null;
  }
}

function scheduleNextFrame() {
  clearPlaybackTimer();
  if (!playing || viewMode !== "behavior" || gazeActive) return;

  const duration = behavior.durations[frame] * idleMultiplier;
  timer = window.setTimeout(() => {
    frame += 1;
    if (frame >= behavior.frames) {
      frame = 0;
      completedCycles += 1;

      if (elements.hostSettle.checked && behavior.id !== "idle" && completedCycles >= 3) {
        behavior = behaviors[0];
        idleMultiplier = 6;
        completedCycles = 0;
        elements.runtimeState.textContent = "Slow idle · awaiting state change";
        updateBehaviorUI({ preserveRuntimeLabel: true });
      }
    }
    renderFrame();
    scheduleNextFrame();
  }, duration);
}

function renderTimingTrack() {
  elements.timingTrack.replaceChildren();
  for (const duration of behavior.durations) {
    const segment = document.createElement("span");
    segment.className = "timing-segment";
    segment.style.setProperty("--duration", String(duration));
    elements.timingTrack.append(segment);
  }
}

function updateBehaviorUI(options = {}) {
  for (const button of elements.behaviorList.querySelectorAll("button")) {
    button.classList.toggle("is-active", button.dataset.behavior === behavior.id);
    button.setAttribute("aria-pressed", String(button.dataset.behavior === behavior.id));
  }

  if (!options.preserveRuntimeLabel) {
    elements.runtimeState.textContent = `${behavior.label} · ${behavior.event}`;
  }
  elements.framePill.textContent = `${behavior.frames} host cells`;
  elements.timingReadout.textContent = `${behavior.durations.join(" · ")} ms${idleMultiplier === 6 ? " · 6× settle" : ""}`;
  renderTimingTrack();
  renderFrame();
}

function selectBehavior(id, options = {}) {
  const nextBehavior = behaviors.find((candidate) => candidate.id === id);
  if (!nextBehavior) return;

  viewMode = "behavior";
  currentSourceState = null;
  gazeActive = false;
  elements.gazeField.classList.remove("is-tracking");
  elements.stateSelect.value = "";
  if (options.play === true) playing = true;
  setAtlasMode("install");
  behavior = nextBehavior;
  frame = 0;
  completedCycles = 0;
  idleMultiplier = behavior.id === "idle" ? 6 : 1;
  updateBehaviorUI();
  updateTransportUI();

  if (options.restart !== false) scheduleNextFrame();
}

function createControls() {
  for (const item of behaviors) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "behavior-button";
    button.dataset.behavior = item.id;
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `<span class="row-number">ROW ${item.row}</span><strong>${item.shortLabel}</strong>`;
    button.addEventListener("click", () => selectBehavior(item.id, { play: true }));
    elements.behaviorList.append(button);
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a character state…";
  placeholder.disabled = true;
  placeholder.selected = true;
  elements.stateSelect.append(placeholder);

  for (const { state } of SOURCE_STATES) {
    const option = document.createElement("option");
    option.value = state;
    option.textContent = state;
    elements.stateSelect.append(option);
  }

  for (const sourceEffect of SOURCE_EFFECTS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "source-effect-button";
    button.dataset.sourceEffect = sourceEffect.effect;
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `<strong>${sourceEffect.effect}</strong><span>${sourceEffect.state}</span>`;
    button.addEventListener("click", () => selectSourceEffect(sourceEffect.effect));
    elements.motionList.append(button);
  }
}

function selectSourceEffect(effect) {
  const sourceEffect = SOURCE_EFFECTS.find((candidate) => candidate.effect === effect);
  if (!sourceEffect) return;
  currentSourceEffect = sourceEffect;
  for (const button of elements.motionList.querySelectorAll("button")) {
    const selected = button.dataset.sourceEffect === sourceEffect.effect;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  for (const [themeId, theme] of petThemes) {
    if (previewMode !== "both" && previewMode !== themeId) continue;
    const source = `./source-lab/motion/${theme.id}/${sourceEffect.effect}.webp`;
    const targets = themeElements.get(themeId);
    targets.motionImage.alt = `${sourceEffect.label} for the Grok Bot ${sourceEffect.state} state, rendered at 60 frames per second for ${theme.label}`;
    checkMotion(themeId, source);
  }
  elements.motionReadout.innerHTML = `<strong>${sourceEffect.label}</strong><span><code>${sourceEffect.effect}</code> · ${sourceEffect.state} · exact spring onset, sustained sample, and spring release</span>`;
}

function updateSourceState() {
  const sourceState = SOURCE_STATES.find(({ state }) => state === elements.stateSelect.value);
  if (!sourceState) return;

  clearPlaybackTimer();
  playing = false;
  gazeActive = false;
  viewMode = "source";
  currentSourceState = sourceState;
  elements.gazeField.classList.remove("is-tracking");
  setAtlasMode("source");

  const sourceRow = Math.floor(sourceState.index / 8);
  const sourceColumn = sourceState.index % 8;
  setSpriteCell(sourceRow, sourceColumn, `character state ${sourceState.state}`);

  for (const button of elements.behaviorList.querySelectorAll("button")) {
    button.classList.remove("is-active");
    button.setAttribute("aria-pressed", "false");
  }

  elements.framePill.textContent = `State ${sourceState.index + 1} / ${SOURCE_STATES.length}`;
  elements.timingReadout.textContent = "Paused Character Lab snapshot · no Codex timing";
  elements.timingTrack.replaceChildren();
  elements.stateExplanation.textContent = `${sourceState.description} Character Lab cell: r${sourceRow} · c${sourceColumn}. This is a paused character-state snapshot; the installable Codex choreography maps the state to ${sourceState.behavior.label}, r${sourceState.behavior.row} · c${sourceState.behavior.column}.`;
  elements.runtimeState.textContent = `Character Lab · ${sourceState.state} · snapshot ${sourceState.index + 1} of ${SOURCE_STATES.length}`;
  updateTransportUI();
}

function updateTransportUI() {
  if (viewMode === "source") {
    elements.playIcon.textContent = "▶";
    elements.playLabel.textContent = "Play mapped row";
    elements.playPause.setAttribute("aria-label", `Play the installed ${currentSourceState?.behavior.label ?? "mapped"} choreography`);
    elements.previousFrame.setAttribute("aria-label", "Previous character state");
    elements.nextFrame.setAttribute("aria-label", "Next character state");
    return;
  }

  elements.playIcon.textContent = playing ? "Ⅱ" : "▶";
  elements.playLabel.textContent = playing ? "Inspect frame" : "Play fluid";
  elements.playPause.setAttribute(
    "aria-label",
    playing ? "Pause on the current authored cell" : "Resume the fluid runtime preview",
  );
  elements.previousFrame.setAttribute("aria-label", "Previous frame");
  elements.nextFrame.setAttribute("aria-label", "Next frame");
}

function setPlaying(nextPlaying) {
  playing = nextPlaying;
  if (viewMode === "behavior") setAtlasMode("install");
  updateTransportUI();
  if (playing) scheduleNextFrame();
  else clearPlaybackTimer();
}

function stepFrame(amount) {
  if (viewMode === "source" && currentSourceState) {
    const nextIndex = (currentSourceState.index + amount + SOURCE_STATES.length) % SOURCE_STATES.length;
    elements.stateSelect.value = SOURCE_STATES[nextIndex].state;
    updateSourceState();
    return;
  }

  setPlaying(false);
  frame = (frame + amount + behavior.frames) % behavior.frames;
  renderFrame();
}

function beginGaze(event) {
  viewMode = "gaze";
  currentSourceState = null;
  elements.stateSelect.value = "";
  gazeActive = true;
  clearPlaybackTimer();
  setAtlasMode("install");
  updateTransportUI();
  elements.gazeField.classList.add("is-tracking");
  updateGaze(event);
}

function showGazeDirection(directionIndex) {
  gazeDirectionIndex = (directionIndex + 16) % 16;
  const snappedAngle = gazeDirectionIndex * 22.5;
  const row = gazeDirectionIndex < 8 ? 9 : 10;
  const column = gazeDirectionIndex % 8;

  elements.angleReadout.textContent = `${snappedAngle}°`;
  elements.directionReadout.textContent = directionNames[gazeDirectionIndex];
  elements.runtimeState.textContent = `Pointer gaze · ${directionNames[gazeDirectionIndex]}`;
  setSpriteCell(row, column, `pointer gaze ${directionNames[gazeDirectionIndex]}`);
}

function updateGaze(event) {
  if (!gazeActive) return;
  const bounds = elements.gazeField.getBoundingClientRect();
  const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
  const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
  const dx = x - bounds.width / 2;
  const dy = bounds.height / 2 - y;
  const rawAngle = (Math.atan2(dx, dy) * 180) / Math.PI;
  const angle = (rawAngle + 360) % 360;
  const directionIndex = Math.round(angle / 22.5) % 16;

  elements.gazeField.style.setProperty("--gaze-x", `${(x / bounds.width) * 100}%`);
  elements.gazeField.style.setProperty("--gaze-y", `${(y / bounds.height) * 100}%`);
  elements.gazePointer.style.left = `${x}px`;
  elements.gazePointer.style.top = `${y}px`;
  showGazeDirection(directionIndex);
}

function beginKeyboardGaze() {
  viewMode = "gaze";
  currentSourceState = null;
  elements.stateSelect.value = "";
  gazeActive = true;
  clearPlaybackTimer();
  setAtlasMode("install");
  updateTransportUI();
  showGazeDirection(gazeDirectionIndex);
}

function handleGazeKeydown(event) {
  const directionByKey = {
    ArrowUp: 0,
    ArrowRight: 4,
    ArrowDown: 8,
    ArrowLeft: 12,
  };
  if (!(event.key in directionByKey)) return;
  event.preventDefault();
  viewMode = "gaze";
  currentSourceState = null;
  elements.stateSelect.value = "";
  gazeActive = true;
  clearPlaybackTimer();
  setAtlasMode("install");
  showGazeDirection(directionByKey[event.key]);
}

function endGaze() {
  gazeActive = false;
  viewMode = "behavior";
  elements.gazeField.classList.remove("is-tracking");
  setAtlasMode("install");
  elements.runtimeState.textContent = `${behavior.label} · ${behavior.event}`;
  updateBehaviorUI({ preserveRuntimeLabel: true });
  updateTransportUI();
  scheduleNextFrame();
}

function setAtlasVisibility(visible) {
  elements.atlasPanel.hidden = !visible;
  elements.sheetToggle.setAttribute("aria-expanded", String(visible));
  elements.sheetToggle.textContent = visible ? "Hide atlas" : "View atlas";
  if (visible) {
    elements.atlasPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function checkAtlas(themeId, source) {
  const targets = themeElements.get(themeId);
  const probeVersion = (atlasProbeVersions.get(themeId) ?? 0) + 1;
  atlasProbeVersions.set(themeId, probeVersion);
  const probe = new Image();
  probe.addEventListener("error", () => {
    if (probeVersion !== atlasProbeVersions.get(themeId)) return;
    targets.atlasMissing.hidden = false;
  });
  probe.addEventListener("load", () => {
    if (probeVersion !== atlasProbeVersions.get(themeId)) return;
    targets.atlasMissing.hidden = true;
  });
  probe.src = `${source}?preview=${Date.now()}`;
}

function checkMotion(themeId, source) {
  const targets = themeElements.get(themeId);
  const previous = motionImageListeners.get(themeId);
  if (previous) {
    targets.motionImage.removeEventListener("error", previous.onError);
    targets.motionImage.removeEventListener("load", previous.onLoad);
  }
  const onError = () => {
    targets.motionMissing.hidden = false;
    targets.motionImage.hidden = true;
  };
  const onLoad = () => {
    targets.motionMissing.hidden = true;
    targets.motionImage.hidden = false;
  };
  motionImageListeners.set(themeId, { onError, onLoad });
  targets.motionImage.addEventListener("error", onError, { once: true });
  targets.motionImage.addEventListener("load", onLoad, { once: true });
  targets.motionImage.src = source;
}

function setPreviewMode(mode) {
  if (mode !== "both" && !petThemes.has(mode)) return;

  previewMode = mode;
  document.body.dataset.previewMode = mode;
  document.body.dataset.petTheme = mode === "light" ? "light" : "dark";

  for (const [themeId, targets] of themeElements) {
    const hidden = mode !== "both" && themeId !== mode;
    targets.stage.hidden = hidden;
    targets.motionStage.hidden = hidden;
    targets.atlasView.hidden = hidden;
    if (hidden) {
      const listeners = motionImageListeners.get(themeId);
      if (listeners) {
        targets.motionImage.removeEventListener("error", listeners.onError);
        targets.motionImage.removeEventListener("load", listeners.onLoad);
        motionImageListeners.delete(themeId);
      }
      targets.motionImage.removeAttribute("src");
      targets.motionImage.hidden = true;
    }
  }

  setAtlasMode(viewMode === "source" ? "source" : "install");

  for (const button of elements.previewModeButtons) {
    const selected = button.dataset.previewModeButton === mode;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  selectSourceEffect(currentSourceEffect.effect);
  scheduleRuntimeSpriteOriginSnap();
}

function updateRendererSimulation() {
  const selection = elements.runtimePetSize.value;
  const defaultFallback = selection === "default";
  const smooth = elements.smoothRenderer.checked;
  if (defaultFallback) document.documentElement.style.removeProperty("--runtime-pet-width");
  else document.documentElement.style.setProperty("--runtime-pet-width", `${Number(selection)}px`);
  document.body.dataset.rendererFilter = smooth ? "smooth" : "pixelated";
  const rect = visibleRuntimeSpriteWraps()[0]?.getBoundingClientRect();
  const size = defaultFallback
    ? `7.04rem default · ${rect?.width.toFixed(6)} × ${rect?.height.toFixed(6)} CSS px`
    : `${Number(selection)} px`;
  elements.rendererReadout.textContent = `${smooth ? "Smooth inspection" : "Pixelated"} · ${size}`;
  scheduleRuntimeSpriteOriginSnap();
}

createControls();
updateRendererSimulation();
setPreviewMode(previewMode);
selectBehavior("idle", { play: true });
setPlaying(true);

for (const button of elements.previewModeButtons) {
  button.addEventListener("click", () => setPreviewMode(button.dataset.previewModeButton));
}
elements.stateSelect.addEventListener("change", updateSourceState);
elements.playPause.addEventListener("click", () => {
  if (viewMode === "source" && currentSourceState) {
    selectBehavior(currentSourceState.behavior.id, { play: true });
    return;
  }
  setPlaying(!playing);
});
elements.previousFrame.addEventListener("click", () => stepFrame(-1));
elements.nextFrame.addEventListener("click", () => stepFrame(1));
elements.hostSettle.addEventListener("change", () => {
  completedCycles = 0;
  idleMultiplier = behavior.id === "idle" ? 6 : 1;
  if (viewMode === "source") return;
  updateBehaviorUI();
  scheduleNextFrame();
});
elements.runtimePetSize.addEventListener("change", updateRendererSimulation);
elements.smoothRenderer.addEventListener("change", updateRendererSimulation);
window.addEventListener("resize", scheduleRuntimeSpriteOriginSnap);
window.addEventListener("scroll", scheduleRuntimeSpriteOriginSnap, { passive: true });
const runtimeSpriteResizeObserver = new ResizeObserver(scheduleRuntimeSpriteOriginSnap);
runtimeSpriteResizeObserver.observe(document.documentElement);
runtimeSpriteResizeObserver.observe(document.body);
runtimeSpriteResizeObserver.observe(document.querySelector(".stage-panel"));
runtimeSpriteResizeObserver.observe(document.querySelector("#pet-stages"));
for (const { stage } of themeElements.values()) runtimeSpriteResizeObserver.observe(stage);
document.fonts?.ready.then(scheduleRuntimeSpriteOriginSnap);
if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes("layout-shift")) {
  const runtimeLayoutShiftObserver = new PerformanceObserver((entries) => {
    if (entries.getEntries().some(({ hadRecentInput }) => !hadRecentInput)) {
      scheduleRuntimeSpriteOriginSnap();
    }
  });
  runtimeLayoutShiftObserver.observe({ type: "layout-shift", buffered: true });
}
elements.gazeField.addEventListener("pointerenter", beginGaze);
elements.gazeField.addEventListener("pointermove", updateGaze);
elements.gazeField.addEventListener("pointerleave", endGaze);
elements.gazeField.addEventListener("focus", beginKeyboardGaze);
elements.gazeField.addEventListener("keydown", handleGazeKeydown);
elements.gazeField.addEventListener("blur", endGaze);
elements.sheetToggle.addEventListener("click", () => setAtlasVisibility(elements.atlasPanel.hidden));
elements.sheetClose.addEventListener("click", () => setAtlasVisibility(false));
