import { runtimeSpriteOriginIsIntegral, runtimeSpriteOriginSnap } from "../runtime-geometry.mjs";
import { createComparisonImageLoader, pageAtTime } from "./timeline.mjs";

const $ = (id) => document.getElementById(id);
const cards = [...document.querySelectorAll(".card")];
let catalog = [];
let playing = true;
let renderRevision = 0;
let hasDisplayedComparison = false;
let snapRequest = null;
const imageLoader = createComparisonImageLoader();
const behaviorNames = ["Idle", "Travel right", "Travel left", "Greeting", "Jump / hover", "Blocked", "Needs input", "Working", "Review"];
for (const [row, label] of behaviorNames.entries()) addOption($("behavior"), `${row}:0`, label);
for (let direction = 0; direction < 16; direction += 1) {
  addOption($("behavior"), `${9 + Math.floor(direction / 8)}:${direction % 8}`, `Gaze ${direction * 22.5}°`);
}
try {
  catalog = (await import("./generated/catalog.mjs")).default;
  catalog.filter(({ id }) => id !== "checkpoint").forEach(({ id, label }) => addOption($("candidate"), id, label));
  if (!$("candidate").options.length) throw new Error("No candidate has been built");
  await render();
} catch (error) {
  $("status").textContent = `Candidates are not ready: ${error.message}. Run node scripts/build-quality-lab.mjs, then reload.`;
}
$("candidate").addEventListener("change", render);
$("behavior").addEventListener("change", render);
$("size").addEventListener("change", () => {
  document.documentElement.style.setProperty("--pet-width", $("size").value === "default" ? "7.04rem" : `${$("size").value}px`);
  snapOrigins();
});
$("play").addEventListener("click", () => {
  playing = !playing;
  $("time").disabled = playing;
  $("play").textContent = playing ? "Pause and inspect" : "Play native WebP";
  render();
});
$("time").addEventListener("input", render);
window.addEventListener("resize", snapOrigins);
window.addEventListener("scroll", snapOrigins, { passive: true });
window.addEventListener("pagehide", () => {
  renderRevision += 1;
  imageLoader.dispose();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) render();
});

function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

async function render() {
  if (catalog.length === 0) return;
  const request = ++renderRevision;
  try {
    const [row, column] = $("behavior").value.split(":").map(Number);
    const checkpoint = catalog.find(({ id }) => id === "checkpoint");
    const candidate = catalog.find(({ id }) => id === $("candidate").value);
    if (!checkpoint || !candidate) throw new Error("The selected comparison is missing from the catalog");
    const nativePlayback = playing;
    const timeMs = Number($("time").value);
    const views = cards.map((card) => {
      const variant = card.dataset.kind === "checkpoint" ? checkpoint : candidate;
      const theme = card.dataset.theme;
      const metadata = variant.themes[theme];
      const page = pageAtTime(metadata.delays, timeMs);
      const asset = nativePlayback ? `${variant.id}-${theme}.webp` : `${variant.id}-${theme}/${page}.webp`;
      return { card, metadata, page, url: new URL(`./generated/${asset}`, import.meta.url).href };
    });
    $("comparison").setAttribute("aria-busy", "true");
    $("time-label").textContent = nativePlayback ? "Loading native playback…" : `Loading ${timeMs} ms…`;
    $("status").textContent = `Loading ${candidate.label}.${hasDisplayedComparison ? " The previous comparison remains visible until all four images are ready." : " Waiting for all four images to decode."}`;
    const result = await imageLoader.load(views.map(({ url }) => url));
    if (request !== renderRevision || result.status === "stale") return;
    if (result.status === "error") throw result.error;

    // No await inside this commit: images, cells, page labels, and time become
    // visible together, only after every image for this request has decoded.
    for (const { card, metadata, page, url } of views) {
      const pet = card.querySelector(".pet");
      pet.style.backgroundImage = `url(${JSON.stringify(url)})`;
      pet.style.backgroundPosition = `${column / 7 * 100}% ${row / 10 * 100}%`;
      pet.dataset.phase = nativePlayback ? "native" : String(page);
      card.querySelector(".details").textContent = `${metadata.frames} phases · ${metadata.loopMs} ms · ${(metadata.bytes / 1024 / 1024).toFixed(2)} MiB${nativePlayback ? "" : ` · page ${page}`}`;
    }
    hasDisplayedComparison = true;
    $("comparison").setAttribute("aria-busy", "false");
    $("time-label").textContent = nativePlayback ? "Native playback" : `${timeMs} ms`;
    $("status").textContent = `Comparing ${candidate.label}. ${nativePlayback ? "Independent native image clocks; use pause for matched samples." : "Both atlases are sampled at the same encoded timeline time."}`;
    snapOrigins();
  } catch (error) {
    if (request !== renderRevision) return;
    $("comparison").setAttribute("aria-busy", "false");
    $("time-label").textContent = "Requested view not loaded";
    $("status").textContent = `Could not load the requested comparison: ${error?.message ?? String(error)}.${hasDisplayedComparison ? " The previous images and page labels remain displayed." : " No comparison is displayed."}`;
  }
}

function snapOrigins() {
  if (snapRequest != null) return;
  snapRequest = requestAnimationFrame(() => {
    snapRequest = null;
    for (const card of cards) {
      const pet = card.querySelector(".pet");
      pet.style.setProperty("--snap-x", "0px");
      pet.style.setProperty("--snap-y", "0px");
      const snap = runtimeSpriteOriginSnap(pet.getBoundingClientRect());
      pet.style.setProperty("--snap-x", `${snap.x}px`);
      pet.style.setProperty("--snap-y", `${snap.y}px`);
    }
    const rects = cards.map((card) => card.querySelector(".pet").getBoundingClientRect());
    const rect = rects[0];
    const integral = rects.every((bounds) => runtimeSpriteOriginIsIntegral(bounds));
    $("geometry").textContent = `Current geometry: ${rect.width.toFixed(5)} × ${rect.height.toFixed(5)} CSS px · DPR ${devicePixelRatio} · pixelated filtering · ${integral ? "all four CSS origins are integral" : "fractional origin detected; geometry needs verification"}.`;
  });
}
