export const SOURCE_MOTION_FRAME_RATE = 60;
export const SOURCE_MOTION_ACTIVE_SECONDS = 1.8;
export const SOURCE_MOTION_RELEASE_SECONDS = 0.8;
export const SOURCE_MOTION_MAX_ACTIVE_HOLD_MS = 34;
export const SOURCE_MOTION_RASTER_SCALE = 3;
export const SOURCE_MOTION_RASTER_DENSITY = 72 * SOURCE_MOTION_RASTER_SCALE;
export const SOURCE_MOTION_FRAME_WIDTH = 192 * SOURCE_MOTION_RASTER_SCALE;
export const SOURCE_MOTION_FRAME_HEIGHT = 208 * SOURCE_MOTION_RASTER_SCALE;
export const SOURCE_MOTION_DISPLAY_WIDTH_CSS_PX = SOURCE_MOTION_FRAME_WIDTH / 2;

export function sourceMotionFrameDelaysMs() {
  const totalFrames = Math.round(
    (SOURCE_MOTION_ACTIVE_SECONDS + SOURCE_MOTION_RELEASE_SECONDS) * SOURCE_MOTION_FRAME_RATE,
  );
  return Array.from({ length: totalFrames }, (_, frameIndex) => (
    Math.round((frameIndex + 1) * 1000 / SOURCE_MOTION_FRAME_RATE)
      - Math.round(frameIndex * 1000 / SOURCE_MOTION_FRAME_RATE)
  ));
}

export function maximumTimelineHoldOverlapMs(delays, rangeStartMs, rangeEndMs) {
  if (!Array.isArray(delays) || delays.some((delay) => !Number.isFinite(delay) || delay <= 0)) {
    throw new TypeError("delays must be an array of positive finite milliseconds");
  }
  if (
    !Number.isFinite(rangeStartMs)
    || !Number.isFinite(rangeEndMs)
    || rangeStartMs < 0
    || rangeEndMs < rangeStartMs
  ) {
    throw new TypeError("timeline range must be finite, non-negative, and ordered");
  }

  let timelineMs = 0;
  let maximumOverlapMs = 0;
  for (const delay of delays) {
    const frameEndMs = timelineMs + delay;
    const overlapMs = Math.max(
      0,
      Math.min(frameEndMs, rangeEndMs) - Math.max(timelineMs, rangeStartMs),
    );
    maximumOverlapMs = Math.max(maximumOverlapMs, overlapMs);
    timelineMs = frameEndMs;
  }
  return maximumOverlapMs;
}
