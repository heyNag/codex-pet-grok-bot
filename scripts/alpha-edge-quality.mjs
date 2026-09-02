export const ALPHA_EDGE_THRESHOLDS = Object.freeze({
  // Supersampled vector reduction leaves one natural boundary transition plus
  // occasional semitransparent internal effect overlaps. Four source pixels
  // captures at least 95% of those samples without requiring an added halo.
  fringeDepthPx: 4,
  minimumSemiAlphaWithinFringeFraction: 0.95,
  maximumSemiAlphaDepthP95Px: 4,
  minimumOuterEdgeAlphaMedian: 96,
  maximumOuterEdgeAlphaMedian: 176,
  minimumOpaqueInteriorFraction: 0.995,
  maximumDeepSemiAlphaVisibleFraction: 0.005,
  perCell: Object.freeze({
    minimumSemiAlphaWithinFringeFraction: 0.78,
    minimumOuterEdgeAlphaMedian: 48,
    maximumOuterEdgeAlphaMedian: 192,
    minimumOpaqueInteriorFraction: 0.97,
    maximumDeepSemiAlphaVisibleFraction: 0.025,
  }),
});

const ALPHA_CHANNEL = 3;
const OPAQUE_ALPHA = 255;

export function measureAlphaEdgeCell(rgba, width, height) {
  const pixelCount = width * height;
  if (rgba.length !== pixelCount * 4) {
    throw new Error(`Expected ${pixelCount * 4} RGBA bytes, received ${rgba.length}`);
  }

  const distance = new Int16Array(pixelCount);
  distance.fill(-1);
  const queue = new Int32Array(pixelCount);
  let queueHead = 0;
  let queueTail = 0;

  // An eight-neighbour, multi-source distance transform measures exact
  // Chebyshev depth from every visible sample to the nearest transparent one.
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (rgba[pixel * 4 + ALPHA_CHANNEL] !== 0) continue;
    distance[pixel] = 0;
    queue[queueTail++] = pixel;
  }

  while (queueHead < queueTail) {
    const pixel = queue[queueHead++];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const nextDistance = distance[pixel] + 1;
    for (let neighborY = Math.max(0, y - 1); neighborY <= Math.min(height - 1, y + 1); neighborY += 1) {
      for (let neighborX = Math.max(0, x - 1); neighborX <= Math.min(width - 1, x + 1); neighborX += 1) {
        const neighbor = neighborY * width + neighborX;
        if (distance[neighbor] !== -1) continue;
        distance[neighbor] = nextDistance;
        queue[queueTail++] = neighbor;
      }
    }
  }

  const maximumDepth = Math.max(width, height);
  const semiAlphaDepthHistogram = new Uint32Array(maximumDepth + 1);
  const outerEdgeAlphaHistogram = new Uint32Array(256);
  let visiblePixels = 0;
  let semiAlphaPixels = 0;
  let semiAlphaWithinFringePixels = 0;
  let deepSemiAlphaPixels = 0;
  let interiorPixels = 0;
  let opaqueInteriorPixels = 0;
  let outerEdgePixels = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const alpha = rgba[pixel * 4 + ALPHA_CHANNEL];
    if (alpha === 0) continue;
    visiblePixels += 1;

    // A fully filled cell has no in-cell transparency. Treat its visible
    // samples as maximally deep so the missing outer edge fails closed.
    const depth = distance[pixel] < 0 ? maximumDepth : distance[pixel];

    if (depth === 1) {
      outerEdgePixels += 1;
      outerEdgeAlphaHistogram[alpha] += 1;
    }

    if (depth > ALPHA_EDGE_THRESHOLDS.fringeDepthPx) {
      interiorPixels += 1;
      if (alpha === OPAQUE_ALPHA) opaqueInteriorPixels += 1;
    }

    if (alpha < OPAQUE_ALPHA) {
      semiAlphaPixels += 1;
      semiAlphaDepthHistogram[Math.min(depth, maximumDepth)] += 1;
      if (depth <= ALPHA_EDGE_THRESHOLDS.fringeDepthPx) {
        semiAlphaWithinFringePixels += 1;
      } else {
        deepSemiAlphaPixels += 1;
      }
    }
  }

  return {
    counts: {
      visiblePixels,
      semiAlphaPixels,
      semiAlphaWithinFringePixels,
      deepSemiAlphaPixels,
      interiorPixels,
      opaqueInteriorPixels,
      outerEdgePixels,
    },
    semiAlphaDepthHistogram,
    outerEdgeAlphaHistogram,
  };
}

export function summarizeAlphaEdgeMeasurements(measurements) {
  if (measurements.length === 0) throw new Error("Cannot summarize zero alpha-edge measurements");

  const counts = {
    visiblePixels: 0,
    semiAlphaPixels: 0,
    semiAlphaWithinFringePixels: 0,
    deepSemiAlphaPixels: 0,
    interiorPixels: 0,
    opaqueInteriorPixels: 0,
    outerEdgePixels: 0,
  };
  const maximumDepth = Math.max(...measurements.map((measurement) => measurement.semiAlphaDepthHistogram.length - 1));
  const semiAlphaDepthHistogram = new Uint32Array(maximumDepth + 1);
  const outerEdgeAlphaHistogram = new Uint32Array(256);

  for (const measurement of measurements) {
    for (const key of Object.keys(counts)) counts[key] += measurement.counts[key];
    for (let depth = 0; depth < measurement.semiAlphaDepthHistogram.length; depth += 1) {
      semiAlphaDepthHistogram[depth] += measurement.semiAlphaDepthHistogram[depth];
    }
    for (let alpha = 0; alpha < outerEdgeAlphaHistogram.length; alpha += 1) {
      outerEdgeAlphaHistogram[alpha] += measurement.outerEdgeAlphaHistogram[alpha];
    }
  }

  return finalizeAlphaEdgeMetrics({ counts, semiAlphaDepthHistogram, outerEdgeAlphaHistogram });
}

export function finalizeAlphaEdgeMetrics(measurement) {
  const { counts } = measurement;
  return {
    ...counts,
    semiAlphaWithinFringeFraction: ratio(counts.semiAlphaWithinFringePixels, counts.semiAlphaPixels),
    semiAlphaDepthP95Px: histogramQuantile(
      measurement.semiAlphaDepthHistogram,
      counts.semiAlphaPixels,
      0.95,
    ),
    outerEdgeAlphaMedian: histogramQuantile(
      measurement.outerEdgeAlphaHistogram,
      counts.outerEdgePixels,
      0.5,
    ),
    opaqueInteriorFraction: ratio(counts.opaqueInteriorPixels, counts.interiorPixels),
    deepSemiAlphaVisibleFraction: ratio(counts.deepSemiAlphaPixels, counts.visiblePixels),
  };
}

export function alphaEdgeQualityErrors(summary, cells) {
  const errors = [];
  const thresholds = ALPHA_EDGE_THRESHOLDS;
  const fringeLabel = `${thresholds.fringeDepthPx}px fringe`;

  requireMinimum(errors, summary.semiAlphaWithinFringeFraction, thresholds.minimumSemiAlphaWithinFringeFraction,
    `atlas semi-alpha samples within the ${fringeLabel}`);
  requireMaximum(errors, summary.semiAlphaDepthP95Px, thresholds.maximumSemiAlphaDepthP95Px,
    "atlas semi-alpha depth p95");
  requireRange(errors, summary.outerEdgeAlphaMedian, thresholds.minimumOuterEdgeAlphaMedian,
    thresholds.maximumOuterEdgeAlphaMedian, "atlas outer-edge alpha median");
  requireMinimum(errors, summary.opaqueInteriorFraction, thresholds.minimumOpaqueInteriorFraction,
    "atlas opaque interior fraction");
  requireMaximum(errors, summary.deepSemiAlphaVisibleFraction, thresholds.maximumDeepSemiAlphaVisibleFraction,
    "atlas deep semi-alpha visible fraction");

  for (const cell of cells) {
    const label = `cell r${cell.row}c${cell.column}`;
    requireMinimum(errors, cell.metrics.semiAlphaWithinFringeFraction,
      thresholds.perCell.minimumSemiAlphaWithinFringeFraction, `${label} semi-alpha samples within the ${fringeLabel}`);
    requireRange(errors, cell.metrics.outerEdgeAlphaMedian,
      thresholds.perCell.minimumOuterEdgeAlphaMedian, thresholds.perCell.maximumOuterEdgeAlphaMedian,
      `${label} outer-edge alpha median`);
    requireMinimum(errors, cell.metrics.opaqueInteriorFraction,
      thresholds.perCell.minimumOpaqueInteriorFraction, `${label} opaque interior fraction`);
    requireMaximum(errors, cell.metrics.deepSemiAlphaVisibleFraction,
      thresholds.perCell.maximumDeepSemiAlphaVisibleFraction, `${label} deep semi-alpha visible fraction`);
  }

  return errors;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function histogramQuantile(histogram, count, quantile) {
  if (count === 0) return null;
  const target = Math.max(1, Math.ceil(count * quantile));
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= target) return value;
  }
  return null;
}

function requireMinimum(errors, value, minimum, label) {
  if (value !== null && value >= minimum) return;
  errors.push(`${label} must be at least ${minimum}; received ${formatValue(value)}`);
}

function requireMaximum(errors, value, maximum, label) {
  if (value !== null && value <= maximum) return;
  errors.push(`${label} must be at most ${maximum}; received ${formatValue(value)}`);
}

function requireRange(errors, value, minimum, maximum, label) {
  if (value !== null && value >= minimum && value <= maximum) return;
  errors.push(`${label} must be ${minimum}..${maximum}; received ${formatValue(value)}`);
}

function formatValue(value) {
  return typeof value === "number" ? value : "no measurable samples";
}
