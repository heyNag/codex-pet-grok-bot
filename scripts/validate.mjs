import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const ATLAS = Object.freeze({
  width: 1536,
  height: 2288,
  columns: 8,
  rows: 11,
  cellWidth: 192,
  cellHeight: 208,
  maxBytes: 20 * 1024 * 1024,
  populated: Object.freeze([7, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]),
});

export const PET_VARIANTS = Object.freeze({
  dark: Object.freeze({
    id: "grok-bot-dark",
    displayName: "Grok Bot Dark",
    directory: "grok-bot-dark",
  }),
  light: Object.freeze({
    id: "grok-bot-light",
    displayName: "Grok Bot Light",
    directory: "grok-bot-light",
  }),
});

export const PET_VARIANT_NAMES = Object.freeze(Object.keys(PET_VARIANTS));

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function cellOffset(x, y, width, channels) {
  return (y * width + x) * channels;
}

function inspectCell(pixels, info, column, row, featureTone) {
  let visiblePixels = 0;
  let hiddenRgbPixels = 0;
  let faceFeaturePixels = 0;
  let faceFeatureX = 0;
  let faceFeatureY = 0;
  let minX = ATLAS.cellWidth;
  let minY = ATLAS.cellHeight;
  let maxX = -1;
  let maxY = -1;
  const digest = createHash("sha256");
  const cellBytes = Buffer.alloc(ATLAS.cellWidth * ATLAS.cellHeight * 4);
  let target = 0;

  for (let y = 0; y < ATLAS.cellHeight; y += 1) {
    for (let x = 0; x < ATLAS.cellWidth; x += 1) {
      const source = cellOffset(
        column * ATLAS.cellWidth + x,
        row * ATLAS.cellHeight + y,
        info.width,
        info.channels,
      );
      const red = pixels[source];
      const green = pixels[source + 1];
      const blue = pixels[source + 2];
      const alpha = pixels[source + 3];
      cellBytes[target++] = red;
      cellBytes[target++] = green;
      cellBytes[target++] = blue;
      cellBytes[target++] = alpha;

      if (alpha > 0) {
        visiblePixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        const inFaceWindow = x >= 35 && x < 157 && y >= 25 && y < 145;
        const isFeaturePixel = featureTone === "light"
          ? red > 180 && green > 180 && blue > 180
          : red < 75 && green < 75 && blue < 75;
        if (inFaceWindow && alpha > 180 && isFeaturePixel) {
          faceFeaturePixels += 1;
          faceFeatureX += x;
          faceFeatureY += y;
        }
      } else if (red !== 0 || green !== 0 || blue !== 0) {
        hiddenRgbPixels += 1;
      }
    }
  }

  digest.update(cellBytes);
  const coverage = visiblePixels / (ATLAS.cellWidth * ATLAS.cellHeight);
  return {
    column,
    row,
    visiblePixels,
    hiddenRgbPixels,
    coverage: Number(coverage.toFixed(5)),
    bounds: visiblePixels ? { minX, minY, maxX, maxY } : null,
    faceFeaturePixels,
    featureCenter: faceFeaturePixels
      ? {
          x: Number((faceFeatureX / faceFeaturePixels).toFixed(3)),
          y: Number((faceFeatureY / faceFeaturePixels).toFixed(3)),
        }
      : null,
    sha256: digest.digest("hex"),
  };
}

export async function validatePet({
  root = projectRoot,
  variant = "dark",
  writeReport = true,
} = {}) {
  const pet = PET_VARIANTS[variant];
  if (!pet) {
    throw new Error(`Unknown pet variant ${JSON.stringify(variant)}; expected ${PET_VARIANT_NAMES.join(" or ")}`);
  }
  const requiredManifest = {
    id: pet.id,
    displayName: pet.displayName,
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp",
  };
  const petDir = path.join(root, "pet", pet.directory);
  const manifestPath = path.join(petDir, "pet.json");
  const errors = [];
  const warnings = [];
  let manifest = {};
  let spritesheetPath = null;
  let fileBytes = null;
  let atlasSha256 = null;
  let metadata = {};
  let info = {};
  let cells = [];

  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    errors.push(`pet.json is missing or invalid: ${error.message}`);
  }

  for (const [key, expected] of Object.entries(requiredManifest)) {
    if (manifest[key] !== expected) {
      errors.push(`pet.json ${key} must be ${JSON.stringify(expected)}`);
    }
  }
  if (typeof manifest.description !== "string" || manifest.description.trim().length < 20) {
    errors.push("pet.json description must be a meaningful sentence");
  }
  if (typeof manifest.spritesheetPath !== "string" || manifest.spritesheetPath.length === 0) {
    errors.push("pet.json spritesheetPath must be a non-empty string");
  } else {
    const candidate = path.resolve(petDir, manifest.spritesheetPath);
    if (candidate !== path.join(petDir, "spritesheet.webp")) {
      errors.push(`spritesheetPath must resolve to pet/${pet.directory}/spritesheet.webp`);
    } else {
      spritesheetPath = candidate;
    }
  }

  if (spritesheetPath) {
    try {
      const file = await stat(spritesheetPath);
      fileBytes = file.size;
      atlasSha256 = createHash("sha256").update(await readFile(spritesheetPath)).digest("hex");
      if (file.size > ATLAS.maxBytes) {
        errors.push(`spritesheet exceeds 20 MiB (${file.size} bytes)`);
      }

      const image = sharp(spritesheetPath, { failOn: "error" });
      metadata = await image.metadata();
      if (metadata.format !== "webp") errors.push("spritesheet must be WebP");
      if (metadata.width !== ATLAS.width || metadata.height !== ATLAS.height) {
        errors.push(`spritesheet must be ${ATLAS.width}x${ATLAS.height}`);
      }
      if (!metadata.hasAlpha) errors.push("spritesheet must have an alpha channel");

      if (metadata.width === ATLAS.width && metadata.height === ATLAS.height) {
        const decoded = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const pixels = decoded.data;
        info = decoded.info;
        for (let row = 0; row < ATLAS.rows; row += 1) {
          for (let column = 0; column < ATLAS.columns; column += 1) {
            const cell = inspectCell(pixels, info, column, row, variant === "light" ? "light" : "dark");
            const shouldBeVisible = column < ATLAS.populated[row];
            if (shouldBeVisible && cell.visiblePixels === 0) {
              errors.push(`required cell r${row}c${column} is blank`);
            }
            if (!shouldBeVisible && cell.visiblePixels !== 0) {
              errors.push(`unused cell r${row}c${column} is not transparent`);
            }
            if (!shouldBeVisible && cell.hiddenRgbPixels !== 0) {
              errors.push(`unused cell r${row}c${column} has hidden RGB residue`);
            }
            if (shouldBeVisible && cell.coverage < 0.06) {
              warnings.push(`cell r${row}c${column} has low visible coverage (${cell.coverage})`);
            }
            if (shouldBeVisible && cell.bounds) {
              const { minX, minY, maxX, maxY } = cell.bounds;
              if (minX < 2 || minY < 2 || maxX > ATLAS.cellWidth - 3 || maxY > ATLAS.cellHeight - 3) {
                errors.push(`cell r${row}c${column} touches the two-pixel safety edge`);
              }
            }
            cells.push(cell);
          }
        }
      }
    } catch (error) {
      errors.push(`spritesheet is missing or unreadable: ${error.message}`);
    }
  }

  for (let row = 0; row <= 8 && cells.length > 0; row += 1) {
    const authoredCount = row === 0 ? 6 : ATLAS.populated[row];
    const hashes = cells
      .filter((cell) => cell.row === row && cell.column < authoredCount)
      .map((cell) => cell.sha256);
    if (new Set(hashes).size !== authoredCount) {
      errors.push(`animation row ${row} must contain ${authoredCount} distinct authored frames`);
    }
  }

  const hiddenRgbPixels = cells.reduce((sum, cell) => sum + cell.hiddenRgbPixels, 0);
  if (hiddenRgbPixels > 0) {
    errors.push(`${hiddenRgbPixels} fully transparent pixels retain RGB`);
  }
  if (cells.length > 0) {
    const gazeCells = cells.filter((cell) => cell.row >= 9);
    const gazeHashes = gazeCells.map((cell) => cell.sha256);
    if (new Set(gazeHashes).size !== 16) {
      errors.push("all 16 gaze cells must be visually distinct");
    }
    const neutral = cells.find((cell) => cell.row === 0 && cell.column === 6);
    if (!neutral?.featureCenter || neutral.faceFeaturePixels < 120 || gazeCells.some((cell) => !cell.featureCenter || cell.faceFeaturePixels < 120)) {
      errors.push(`neutral and gaze cells must expose readable ${variant === "light" ? "light" : "dark"} eye features`);
    } else {
      const gazeCenter = {
        x: gazeCells.reduce((sum, cell) => sum + cell.featureCenter.x, 0) / gazeCells.length,
        y: gazeCells.reduce((sum, cell) => sum + cell.featureCenter.y, 0) / gazeCells.length,
      };
      for (let index = 0; index < gazeCells.length; index += 1) {
        const angle = index * 22.5;
        const radians = angle * Math.PI / 180;
        const expectedX = Math.sin(radians);
        const expectedY = -Math.cos(radians);
        const dx = gazeCells[index].featureCenter.x - gazeCenter.x;
        const dy = gazeCells[index].featureCenter.y - gazeCenter.y;
        const forward = dx * expectedX + dy * expectedY;
        const sideways = Math.abs(dx * expectedY - dy * expectedX);
        if (forward < 7) {
          errors.push(`gaze ${angle}° facial features are not displaced strongly enough`);
        }
        if (sideways > 6.5) {
          errors.push(`gaze ${angle}° facial features drift too far off the intended axis`);
        }
        if (Math.abs(expectedX) > 0.25 && Math.sign(dx) !== Math.sign(expectedX)) {
          errors.push(`gaze ${angle}° facial features move along the wrong horizontal axis`);
        }
        if (Math.abs(expectedY) > 0.25 && Math.sign(dy) !== Math.sign(expectedY)) {
          errors.push(`gaze ${angle}° facial features move along the wrong vertical axis`);
        }
        const next = gazeCells[(index + 1) % gazeCells.length].featureCenter;
        if (Math.hypot(next.x - gazeCells[index].featureCenter.x, next.y - gazeCells[index].featureCenter.y) > 8) {
          errors.push(`gaze loop jumps between ${angle}° and ${((index + 1) % 16) * 22.5}°`);
        }
      }
      const cardinals = [
        { index: 0, axis: "y", limit: gazeCenter.y - 4, compare: (value, limit) => value < limit, label: "up" },
        { index: 4, axis: "x", limit: gazeCenter.x + 8, compare: (value, limit) => value > limit, label: "right" },
        { index: 8, axis: "y", limit: gazeCenter.y + 2, compare: (value, limit) => value > limit, label: "down" },
        { index: 12, axis: "x", limit: gazeCenter.x - 8, compare: (value, limit) => value < limit, label: "left" },
      ];
      for (const cardinal of cardinals) {
        const value = gazeCells[cardinal.index].featureCenter[cardinal.axis];
        if (!cardinal.compare(value, cardinal.limit)) {
          errors.push(`cardinal gaze ${cardinal.label} is not displaced strongly enough from the gaze-family center`);
        }
      }
    }
  }

  const report = {
    schemaVersion: 1,
    variant,
    petId: pet.id,
    ok: errors.length === 0 && warnings.length === 0,
    atlasSha256,
    manifest,
    spritesheet: {
      path: spritesheetPath ? path.relative(root, spritesheetPath) : null,
      bytes: fileBytes,
      format: metadata.format ?? null,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      channels: info.channels ?? metadata.channels ?? null,
      hasAlpha: metadata.hasAlpha ?? false,
      expectedPopulatedCells: ATLAS.populated.reduce((total, count) => total + count, 0),
      expectedUnusedCells: ATLAS.columns * ATLAS.rows - ATLAS.populated.reduce((total, count) => total + count, 0),
      hiddenRgbPixels,
    },
    errors,
    warnings,
    cells,
  };

  if (writeReport) {
    const reportPath = path.join(root, "qa", `validation-${variant}.json`);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

export async function validatePets({
  root = projectRoot,
  writeReport = true,
} = {}) {
  const variants = {};
  for (const variant of PET_VARIANT_NAMES) {
    variants[variant] = await validatePet({ root, variant, writeReport });
  }
  return {
    schemaVersion: 1,
    ok: Object.values(variants).every((report) => report.ok),
    variants,
    errors: Object.entries(variants).flatMap(([variant, report]) =>
      report.errors.map((error) => `${variant}: ${error}`)),
    warnings: Object.entries(variants).flatMap(([variant, report]) =>
      report.warnings.map((warning) => `${variant}: ${warning}`)),
  };
}

async function main() {
  const requested = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (requested.length > 1 || (requested[0] && !PET_VARIANTS[requested[0]])) {
    throw new Error(`Usage: node scripts/validate.mjs [${PET_VARIANT_NAMES.join("|")}]`);
  }
  const report = requested[0]
    ? await validatePet({ variant: requested[0] })
    : await validatePets();
  const variantCount = report.variants ? Object.keys(report.variants).length : 1;
  const summary = `${report.ok ? "PASS" : "FAIL"}: ${variantCount} pet variant${variantCount === 1 ? "" : "s"}, ${report.errors.length} errors, ${report.warnings.length} warnings`;
  console.log(summary);
  for (const warning of report.warnings) console.warn(`warning: ${warning}`);
  for (const error of report.errors) console.error(`error: ${error}`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
