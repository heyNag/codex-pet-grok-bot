// Image formats encode integer millisecond durations. Round cumulative time,
// never each duration independently, to avoid accumulating playback drift.
export function animationTimeline(frameCount, loopMs) {
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new RangeError("frameCount must be a positive integer");
  }
  if (!Number.isInteger(loopMs) || loopMs < frameCount) {
    throw new RangeError("loopMs must be an integer with at least one millisecond per frame");
  }
  return Object.freeze(Array.from({ length: frameCount }, (_, index) => {
    const startMs = Math.round(index * loopMs / frameCount);
    const endMs = Math.round((index + 1) * loopMs / frameCount);
    return Object.freeze({ index, startMs, durationMs: endMs - startMs, phase: startMs / loopMs });
  }));
}
