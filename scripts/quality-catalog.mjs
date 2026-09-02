import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateQualityCheckpointManifest } from "./quality-checkpoint.mjs";

export const QUALITY_SOURCE_PATHS = Object.freeze([
  "src/fluid-atlas.mjs", "src/animation-timeline.mjs", "src/sprite-raster.mjs",
  "src/grok-art.mjs", "src/grok-motion.mjs", "src/grok-eye-topologies.mjs", "src/spec.mjs",
  "scripts/quality-checkpoint.mjs", "scripts/build-quality-lab.mjs",
]);
export const QUALITY_IDS = Object.freeze(["checkpoint", "control-60", "native-60", "coverage-60"]);
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function qualitySourceHashes(root, extra = []) {
  return Object.fromEntries(await Promise.all([...QUALITY_SOURCE_PATHS, ...extra].map(async (file) => (
    [file, sha256(await readFile(path.join(root, file)))]
  ))));
}

// A partially rebuilt study must never silently mix a frozen checkpoint with
// candidates from another source tree. Stale entries are omitted, not relabeled.
export async function writeQualityCatalog(root, output) {
  const sources = await qualitySourceHashes(root);
  const catalog = [];
  const omitted = [];
  for (const id of QUALITY_IDS) {
    try {
      const themes = {};
      for (const theme of ["dark", "light"]) {
        const manifest = JSON.parse(await readFile(path.join(output, `${id}-${theme}.json`), "utf8"));
        if (manifest.id !== id || manifest.theme !== theme
          || !Array.isArray(manifest.delays) || manifest.delays.length !== manifest.frames
          || manifest.delays.some((delay) => !Number.isInteger(delay) || delay < 1)
          || manifest.delays.reduce((sum, delay) => sum + delay, 0) !== manifest.loopMs) {
          throw new Error(`Invalid manifest: ${id}/${theme}`);
        }
        if (id === "checkpoint") {
          const validation = validateQualityCheckpointManifest(manifest, theme);
          if (!validation.ok) throw new Error(`Invalid frozen checkpoint: ${theme}: ${validation.errors.join("; ")}`);
        } else {
          const checkpoint = JSON.parse(await readFile(path.join(output, `checkpoint-${theme}.json`), "utf8"));
          const checkpointValidation = validateQualityCheckpointManifest(checkpoint, theme);
          if (!checkpointValidation.ok
            || manifest.checkpointSha256 !== checkpoint.sha256
            || manifest.checkpointDecodedFrameHashSeal !== checkpointValidation.expectedSeal) {
            throw new Error(`Stale frozen-checkpoint binding: ${id}/${theme}`);
          }
          for (const [file, hash] of Object.entries(sources)) {
            if (manifest.sourceHashes?.[file] !== hash) throw new Error(`Stale source binding: ${id}/${theme}: ${file}`);
          }
          for (const [file, hash] of Object.entries(manifest.sourceHashes ?? {})) {
            if (sha256(await readFile(path.join(root, file))) !== hash) throw new Error(`Stale source binding: ${id}/${theme}: ${file}`);
          }
        }
        const bytes = await readFile(path.join(output, `${id}-${theme}.webp`));
        if (sha256(bytes) !== manifest.sha256 || bytes.length !== manifest.bytes) throw new Error(`Asset changed: ${id}/${theme}`);
        for (let phase = 0; phase < manifest.frames; phase += 1) {
          const file = await stat(path.join(output, `${id}-${theme}`, `${phase}.webp`));
          if (!file.isFile() || file.size === 0) throw new Error(`Missing inspection page: ${id}/${theme}/${phase}`);
        }
        themes[theme] = manifest;
      }
      catalog.push({ id, label: themes.dark.label, themes });
    } catch (error) {
      omitted.push({ id, reason: error.code === "ENOENT" ? "Not completely built" : error.message });
    }
  }
  // Without the matching checkpoint no comparison is valid.
  const visible = catalog.some(({ id }) => id === "checkpoint") ? catalog : [];
  await writeFile(path.join(output, "catalog.mjs"), `export default ${JSON.stringify(visible, null, 2)};\n`);
  return { included: visible.map(({ id }) => id), omitted };
}
