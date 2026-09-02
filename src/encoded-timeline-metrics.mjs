function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function assertFiniteScalar(value, label) {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

// Animated WebP/APNG clocks are encoded as integer millisecond durations. Keep
// the duration array authoritative: a 60-frame second necessarily alternates
// 16 ms and 17 ms intervals, so a single nominal delay cannot describe it.
export function encodedTimelineFromDelays(delaysMs) {
  if (!Array.isArray(delaysMs) || delaysMs.length < 1) {
    throw new RangeError("delaysMs must contain at least one encoded duration");
  }
  delaysMs.forEach((durationMs, index) => {
    assertPositiveInteger(durationMs, `delaysMs[${index}]`);
  });

  const loopMs = delaysMs.reduce((total, durationMs) => total + durationMs, 0);
  assertPositiveInteger(loopMs, "encoded loop duration");
  let startMs = 0;
  const frames = delaysMs.map((durationMs, index) => {
    const frame = Object.freeze({
      index,
      startMs,
      endMs: startMs + durationMs,
      durationMs,
      phase: startMs / loopMs,
    });
    startMs += durationMs;
    return frame;
  });
  return Object.freeze({
    frameCount: frames.length,
    loopMs,
    frames: Object.freeze(frames),
  });
}

// The sample at `current` lies previousIntervalMs after `previous` and
// nextIntervalMs before `next`. This is zero for constant-velocity motion even
// when the encoded intervals differ (for example, 17 ms then 16 ms).
export function timeWeightedLinearResidual(
  previous,
  current,
  next,
  previousIntervalMs,
  nextIntervalMs,
) {
  [previous, current, next].forEach((value, index) => {
    assertFiniteScalar(value, ["previous", "current", "next"][index]);
  });
  assertPositiveInteger(previousIntervalMs, "previousIntervalMs");
  assertPositiveInteger(nextIntervalMs, "nextIntervalMs");
  const predicted = (
    previous * nextIntervalMs + next * previousIntervalMs
  ) / (previousIntervalMs + nextIntervalMs);
  return current - predicted;
}

// This is the non-uniform-grid three-point second derivative. It is expressed
// per ms^2 so a cadence change can be compared without mistaking shorter frame
// intervals for harsher choreography.
export function timeWeightedAcceleration(
  previous,
  current,
  next,
  previousIntervalMs,
  nextIntervalMs,
) {
  [previous, current, next].forEach((value, index) => {
    assertFiniteScalar(value, ["previous", "current", "next"][index]);
  });
  assertPositiveInteger(previousIntervalMs, "previousIntervalMs");
  assertPositiveInteger(nextIntervalMs, "nextIntervalMs");
  const incomingSpeed = (current - previous) / previousIntervalMs;
  const outgoingSpeed = (next - current) / nextIntervalMs;
  return 2 * (outgoingSpeed - incomingSpeed)
    / (previousIntervalMs + nextIntervalMs);
}

export function cyclicScalarTemporalMetrics(values, delaysMs) {
  if (!Array.isArray(values) || values.length < 3) {
    throw new RangeError("values must contain at least three cyclic samples");
  }
  values.forEach((value, index) => assertFiniteScalar(value, `values[${index}]`));
  const timeline = encodedTimelineFromDelays(delaysMs);
  if (values.length !== timeline.frameCount) {
    throw new RangeError("values and delaysMs must have the same length");
  }

  let maximumAbsoluteStep = 0;
  let maximumAbsoluteSpeedPerMs = 0;
  let maximumAbsoluteTimeWeightedResidual = 0;
  let maximumAbsoluteAccelerationPerMs2 = 0;
  let weightedSquaredSpeed = 0;
  let weightedSquaredAcceleration = 0;

  const samples = values.map((current, index) => {
    const previousIndex = (index - 1 + values.length) % values.length;
    const nextIndex = (index + 1) % values.length;
    const previousIntervalMs = delaysMs[previousIndex];
    const nextIntervalMs = delaysMs[index];
    const stepToNext = values[nextIndex] - current;
    const speedToNextPerMs = stepToNext / nextIntervalMs;
    const timeWeightedResidual = timeWeightedLinearResidual(
      values[previousIndex],
      current,
      values[nextIndex],
      previousIntervalMs,
      nextIntervalMs,
    );
    const accelerationPerMs2 = timeWeightedAcceleration(
      values[previousIndex],
      current,
      values[nextIndex],
      previousIntervalMs,
      nextIntervalMs,
    );

    maximumAbsoluteStep = Math.max(maximumAbsoluteStep, Math.abs(stepToNext));
    maximumAbsoluteSpeedPerMs = Math.max(
      maximumAbsoluteSpeedPerMs,
      Math.abs(speedToNextPerMs),
    );
    maximumAbsoluteTimeWeightedResidual = Math.max(
      maximumAbsoluteTimeWeightedResidual,
      Math.abs(timeWeightedResidual),
    );
    maximumAbsoluteAccelerationPerMs2 = Math.max(
      maximumAbsoluteAccelerationPerMs2,
      Math.abs(accelerationPerMs2),
    );
    weightedSquaredSpeed += speedToNextPerMs ** 2 * nextIntervalMs;
    weightedSquaredAcceleration += accelerationPerMs2 ** 2 * nextIntervalMs;

    return Object.freeze({
      index,
      previousIndex,
      nextIndex,
      previousIntervalMs,
      nextIntervalMs,
      stepToNext,
      speedToNextPerMs,
      timeWeightedResidual,
      accelerationPerMs2,
    });
  });

  return Object.freeze({
    frameCount: timeline.frameCount,
    loopMs: timeline.loopMs,
    maximumAbsoluteStep,
    maximumAbsoluteSpeedPerMs,
    maximumAbsoluteTimeWeightedResidual,
    maximumAbsoluteAccelerationPerMs2,
    durationWeightedRmsSpeedPerMs: Math.sqrt(weightedSquaredSpeed / timeline.loopMs),
    durationWeightedRmsAccelerationPerMs2: Math.sqrt(
      weightedSquaredAcceleration / timeline.loopMs,
    ),
    samples: Object.freeze(samples),
  });
}
