// The character's activation spring drives the continuous effect studies and
// provides deterministic landmarks for authored character poses.
export const ACTIVATION_SPRING = Object.freeze({
  damping: 28,
  stiffness: 196,
  maximumStepSeconds: 1 / 120,
});

export function advanceActivationSpring(spring, target, elapsedSeconds) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    throw new TypeError("elapsedSeconds must be a finite non-negative number");
  }
  let remaining = elapsedSeconds;
  while (remaining > 0) {
    const delta = Math.min(remaining, ACTIVATION_SPRING.maximumStepSeconds);
    spring.velocity += (
      -ACTIVATION_SPRING.damping * spring.velocity
      - ACTIVATION_SPRING.stiffness * (spring.position - target)
    ) * delta;
    spring.position += spring.velocity * delta;
    spring.position = Math.max(0, Math.min(1, spring.position));
    remaining -= delta;
  }
  return spring;
}

export function sampleActivationOnset(elapsedSeconds, integrationStepSeconds = 0.001) {
  const spring = { position: 0, velocity: 0 };
  let elapsed = 0;
  while (elapsed < elapsedSeconds) {
    const delta = Math.min(integrationStepSeconds, elapsedSeconds - elapsed);
    advanceActivationSpring(spring, 1, delta);
    elapsed += delta;
  }
  return spring.position;
}
