export function pageAtTime(delays, timeMs) {
  if (!Array.isArray(delays) || delays.length === 0
    || delays.some((delay) => !Number.isInteger(delay) || delay <= 0)) {
    throw new RangeError("Frame delays must be a nonempty list of positive integer milliseconds");
  }
  if (!Number.isFinite(timeMs)) throw new RangeError("Inspection time must be finite");
  const loop = delays.reduce((sum, delay) => sum + delay, 0);
  if (!Number.isSafeInteger(loop)) throw new RangeError("Animation loop duration is out of range");
  let remainder = ((timeMs % loop) + loop) % loop;
  for (let page = 0; page < delays.length; page += 1) {
    if (remainder < delays[page]) return page;
    remainder -= delays[page];
  }
  return delays.length - 1;
}

// Keep only the displayed and newest requested images alive. A full atlas is
// large after decoding; caching every scrub page would distort a motion study.
export function createComparisonImageLoader({ createImage = () => new Image() } = {}) {
  let revision = 0;
  let pending = [];
  let displayed = new Map();

  function cancelPending() {
    for (const image of pending) image.src = "";
    pending = [];
  }

  return {
    async load(urls) {
      const request = ++revision;
      cancelPending();
      const images = new Map();
      try {
        const decodes = [...new Set(urls)].map(async (url) => {
          const existing = displayed.get(url);
          if (existing) {
            images.set(url, existing);
            return;
          }
          const image = createImage();
          pending.push(image);
          images.set(url, image);
          image.decoding = "async";
          image.src = url;
          await image.decode();
        });
        await Promise.all(decodes);
        if (request !== revision) return { status: "stale" };
        pending = [];
        displayed = images;
        return { status: "ready" };
      } catch (error) {
        if (request !== revision) return { status: "stale" };
        cancelPending();
        return { status: "error", error };
      }
    },
    dispose() {
      revision += 1;
      cancelPending();
      displayed.clear();
    },
  };
}
