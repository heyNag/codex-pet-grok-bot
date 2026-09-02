export const CODEX_DEFAULT_PET_GEOMETRY = Object.freeze({
  cssWidthExpression: "7.04rem",
  aspectRatioWidth: 192,
  aspectRatioHeight: 208,
});

export function runtimeSpriteOriginSnap(rect) {
  if (!Number.isFinite(rect?.x) || !Number.isFinite(rect?.y)) {
    throw new TypeError("runtime sprite origin requires finite x/y coordinates");
  }
  return Object.freeze({
    x: Math.round(rect.x) - rect.x,
    y: Math.round(rect.y) - rect.y,
  });
}

export function runtimeSpriteOriginIsIntegral(rect, tolerance = 1e-7) {
  if (!Number.isFinite(rect?.x) || !Number.isFinite(rect?.y)) return false;
  return Math.abs(rect.x - Math.round(rect.x)) <= tolerance
    && Math.abs(rect.y - Math.round(rect.y)) <= tolerance;
}
