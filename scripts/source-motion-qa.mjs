#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import {
  SOURCE_MOTION_ACTIVE_SECONDS,
  SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX,
  SOURCE_MOTION_FRAME_HEIGHT,
  SOURCE_MOTION_FRAME_RATE,
  SOURCE_MOTION_FRAME_WIDTH,
  SOURCE_MOTION_MAX_ACTIVE_HOLD_MS,
  SOURCE_MOTION_RASTER_SCALE,
  SOURCE_MOTION_RELEASE_SECONDS,
  maximumTimelineHoldOverlapMs,
} from "../src/source-motion-timing.mjs";
import { SOURCE_EFFECT_TRANSITIONS } from "../src/spec.mjs";
import {
  SOURCE_MOTION_TEMPORAL_GATE,
  analyzeSourceMotionTemporalAsset,
  buildSourceMotionAllFrameSheet,
  buildSourceMotionWorstCaseSheet,
} from "./source-motion-temporal-qa.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "preview", "source-lab", "motion", "manifest.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export async function inspectSourceMotionStudies(options = {}) {
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const errors = [];
  const expectedEffects = new Set(SOURCE_EFFECT_TRANSITIONS.map(({ effect }) => effect));
  const expectedThemes = new Set(["dark", "light"]);
  const expectedAssetKeys = new Set(
    [...expectedThemes].flatMap((theme) => [...expectedEffects].map((effect) => `${theme}/${effect}`)),
  );

  const expect = (condition, message) => {
    if (!condition) errors.push(message);
  };

  expect(manifest.frameRate === SOURCE_MOTION_FRAME_RATE, "manifest frame rate differs from the source-motion contract");
  expect(manifest.activeSeconds === SOURCE_MOTION_ACTIVE_SECONDS, "manifest active duration differs from the source-motion contract");
  expect(manifest.releaseSeconds === SOURCE_MOTION_RELEASE_SECONDS, "manifest release duration differs from the source-motion contract");
  expect(manifest.maximumAllowedActiveHoldMs === SOURCE_MOTION_MAX_ACTIVE_HOLD_MS, "manifest active-hold limit differs from the source-motion contract");
  expect(manifest.rasterScale === SOURCE_MOTION_RASTER_SCALE, "manifest raster scale differs from the source-motion contract");
  expect(manifest.frameWidth === SOURCE_MOTION_FRAME_WIDTH, "manifest frame width differs from the source-motion contract");
  expect(manifest.frameHeight === SOURCE_MOTION_FRAME_HEIGHT, "manifest frame height differs from the source-motion contract");
  expect(manifest.displayWidthCssPx === SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX, "manifest display width differs from the source-motion contract");
  expect(Array.isArray(manifest.assets), "manifest assets must be an array");

  const assets = [];
  const temporalWorstCases = [];
  for (const asset of manifest.assets ?? []) {
    const key = `${asset.theme}/${asset.effect}`;
    const absolutePath = path.join(root, asset.path);
    const bytes = await readFile(absolutePath);
    const metadata = await sharp(bytes, { animated: true, failOn: "error" }).metadata();
    const maximumActiveHoldMs = maximumTimelineHoldOverlapMs(
      metadata.delay,
      0,
      SOURCE_MOTION_ACTIVE_SECONDS * 1000,
    );
    const durationMs = metadata.delay.reduce((total, delay) => total + delay, 0);
    expect(expectedAssetKeys.has(key), `${key} is not an expected source-motion study`);
    expect(asset.sha256 === sha256(bytes), `${key} bytes differ from the manifest SHA`);
    expect(metadata.width === SOURCE_MOTION_FRAME_WIDTH, `${key} width is ${metadata.width}, expected ${SOURCE_MOTION_FRAME_WIDTH}`);
    expect(metadata.pageHeight === SOURCE_MOTION_FRAME_HEIGHT, `${key} page height is ${metadata.pageHeight}, expected ${SOURCE_MOTION_FRAME_HEIGHT}`);
    expect(metadata.pages === asset.pages, `${key} encoded page count differs from the manifest`);
    expect(metadata.loop === 0, `${key} is not configured to loop continuously`);
    expect(durationMs === manifest.presentationDurationMs, `${key} duration is ${durationMs}ms, expected ${manifest.presentationDurationMs}ms`);
    expect(asset.durationMs === durationMs, `${key} duration differs from the manifest`);
    expect(asset.maximumActiveHoldMs === maximumActiveHoldMs, `${key} active-hold measurement differs from the manifest`);
    expect(
      maximumActiveHoldMs <= SOURCE_MOTION_MAX_ACTIVE_HOLD_MS,
      `${key} contains a ${maximumActiveHoldMs}ms active-frame hold (limit ${SOURCE_MOTION_MAX_ACTIVE_HOLD_MS}ms)`,
    );
    const temporal = await analyzeSourceMotionTemporalAsset({
      bytes,
      delays: metadata.delay,
      effect: asset.effect,
      theme: asset.theme,
    });
    temporalWorstCases.push(temporal.worstCase);
    if (temporal.report.failingTransitionCount > 0) {
      const firstFailures = temporal.report.transitions
        .filter(({ flags }) => flags.length > 0)
        .slice(0, 4)
        .map(({ fromPage, toPage, flags }) => `f${fromPage}->f${toPage} ${flags.join("+")}`)
        .join(", ");
      errors.push(
        `${key} has ${temporal.report.failingTransitionCount} temporal transition(s) outside the motion gate: ${firstFailures}`,
      );
    }
    assets.push({
      key,
      path: asset.path,
      sha256: sha256(bytes),
      pages: metadata.pages,
      durationMs,
      maximumActiveHoldMs,
      bytes: bytes.length,
      temporal: temporal.report,
    });
  }

  const actualAssetKeys = assets.map(({ key }) => key);
  expect(actualAssetKeys.length === expectedAssetKeys.size, `found ${actualAssetKeys.length} studies, expected ${expectedAssetKeys.size}`);
  expect(new Set(actualAssetKeys).size === actualAssetKeys.length, "source-motion study identities are not unique");
  expect([...expectedAssetKeys].every((key) => actualAssetKeys.includes(key)), "one or more effect/theme studies are missing");

  const worstCaseSheet = await buildSourceMotionWorstCaseSheet(temporalWorstCases);
  const allFrameSheet = await buildSourceMotionAllFrameSheet(temporalWorstCases);
  const temporalPairs = assets.reduce((total, asset) => total + asset.temporal.transitions.length, 0);
  const adjacentTransitions = assets.reduce((total, asset) => total + asset.temporal.adjacentTransitions, 0);
  const loopSeams = assets.reduce((total, asset) => total + asset.temporal.loopSeams, 0);
  const eyeTransitionLandmarks = assets.flatMap((asset) => asset.temporal.eyeTransitionLandmarks.map((landmark) => ({
    key: asset.key,
    ...landmark,
  })));
  const report = {
    schemaVersion: 1,
    kind: "source-motion-temporal-qa",
    sourceManifest: {
      path: path.relative(root, manifestPath),
      sha256: sha256(manifestBytes),
    },
    decoder: {
      sharp: sharp.versions.sharp,
      libvips: sharp.versions.vips,
      webp: sharp.versions.webp,
    },
    ok: errors.length === 0,
    errors,
    contract: {
      frameRate: SOURCE_MOTION_FRAME_RATE,
      activeSeconds: SOURCE_MOTION_ACTIVE_SECONDS,
      releaseSeconds: SOURCE_MOTION_RELEASE_SECONDS,
      maximumAllowedActiveHoldMs: SOURCE_MOTION_MAX_ACTIVE_HOLD_MS,
      rasterScale: SOURCE_MOTION_RASTER_SCALE,
      frameWidth: SOURCE_MOTION_FRAME_WIDTH,
      frameHeight: SOURCE_MOTION_FRAME_HEIGHT,
      displayWidthCssPx: SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX,
      temporal: SOURCE_MOTION_TEMPORAL_GATE,
    },
    summary: {
      effects: expectedEffects.size,
      themes: expectedThemes.size,
      assets: assets.length,
      maximumActiveHoldMs: Math.max(0, ...assets.map(({ maximumActiveHoldMs }) => maximumActiveHoldMs)),
      bytes: assets.reduce((total, asset) => total + asset.bytes, 0),
      displayedFrames: temporalPairs,
      adjacentTransitions,
      loopSeams,
      eyeTransitionLandmarks: eyeTransitionLandmarks.length,
      failingTemporalTransitions: assets.reduce(
        (total, asset) => total + asset.temporal.failingTransitionCount,
        0,
      ),
      maximumEyeInkStepFraction: Math.max(
        0,
        ...assets.map((asset) => asset.temporal.maxima.normalizedEyeInkStep.value),
      ),
    },
    eyeTransition: {
      ruleUnderTest: "eye treatment remains temporally continuous while activation crosses A = 0.50 in either direction",
      maximumAllowedEyeInkStepFraction: SOURCE_MOTION_TEMPORAL_GATE.maximumEyeInkStepFraction,
      landmarks: eyeTransitionLandmarks,
      passes: eyeTransitionLandmarks.length === expectedAssetKeys.size * 2
        && eyeTransitionLandmarks.every(({ passes }) => passes),
    },
    artifacts: {
      report: "qa/source-motion-temporal.json",
      allFrameSheet: "qa/source-motion-temporal-all-frames.png",
      allFrameSheetSha256: sha256(allFrameSheet),
      worstCaseSheet: "qa/source-motion-temporal-worst-cases.png",
      worstCaseSheetSha256: sha256(worstCaseSheet),
      worstCaseSheetRows: temporalWorstCases.map(({ theme, effect, transition }) => ({
        key: `${theme}/${effect}`,
        fromPage: transition.fromPage,
        toPage: transition.toPage,
        flags: transition.flags,
      })),
    },
    assets,
  };

  if (options.writeArtifacts === true) {
    const qaRoot = path.join(root, "qa");
    await mkdir(qaRoot, { recursive: true });
    await writeFile(path.join(qaRoot, "source-motion-temporal-all-frames.png"), allFrameSheet);
    await writeFile(path.join(qaRoot, "source-motion-temporal-worst-cases.png"), worstCaseSheet);
    await writeFile(
      path.join(qaRoot, "source-motion-temporal.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  }
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const report = await inspectSourceMotionStudies({ writeArtifacts: true });
  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    errors: report.errors,
    contract: report.contract,
    summary: report.summary,
    eyeTransition: {
      ruleUnderTest: report.eyeTransition.ruleUnderTest,
      maximumAllowedEyeInkStepFraction: report.eyeTransition.maximumAllowedEyeInkStepFraction,
      measuredMaximumEyeInkStepFraction: report.summary.maximumEyeInkStepFraction,
      failedLandmarks: report.eyeTransition.landmarks.filter(({ passes }) => !passes).length,
      totalLandmarks: report.eyeTransition.landmarks.length,
      passes: report.eyeTransition.passes,
    },
    artifacts: report.artifacts,
  }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
