// One image, one decoder workload. This intentionally has no UI animation or
// requestAnimationFrame driver: all character movement comes from the WebP.
const query = new URLSearchParams(location.search);
const id = query.get("candidate") ?? "native-60";
const theme = query.get("theme") ?? "dark";
const size = query.get("size") ?? "default";
const row = Number(query.get("row") ?? 0);
const column = Number(query.get("column") ?? 0);
const pet = document.getElementById("pet");
const status = document.getElementById("status");
try {
  if (!["dark", "light"].includes(theme) || !["default", "96", "144"].includes(size)
    || !Number.isInteger(row) || row < 0 || row > 10
    || !Number.isInteger(column) || column < 0 || column > 7) throw new Error("Invalid playback parameters");
  const catalog = (await import("./generated/catalog.mjs")).default;
  const entry = catalog.find((candidate) => candidate.id === id);
  if (!entry) throw new Error("Candidate is not present in the current verified catalog");
  const asset = new URL(`./generated/${id}-${theme}.webp`, import.meta.url).href;
  const image = new Image();
  image.src = asset;
  await image.decode();
  if (theme === "light") {
    document.documentElement.style.background = "#f3f1e9";
    document.documentElement.style.color = "#555";
  }
  if (size !== "default") pet.style.width = `${size}px`;
  pet.style.backgroundImage = `url(${JSON.stringify(asset)})`;
  pet.style.backgroundPosition = `${column / 7 * 100}% ${row / 10 * 100}%`;
  status.textContent = `${entry.label} · ${theme} · cell ${row}:${column}`;
  pet.dataset.ready = "true";
} catch (error) {
  status.textContent = `Playback unavailable: ${error.message}`;
}
