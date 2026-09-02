import assert from "node:assert/strict";
import test from "node:test";
import { animationTimeline } from "../src/animation-timeline.mjs";
import { createComparisonImageLoader, pageAtTime } from "../preview/quality-lab/timeline.mjs";

test("quality inspection selects exact encoded boundaries and wraps each clock", () => {
  const checkpoint = Array(30).fill(33);
  const control = animationTimeline(60, 990).map(({ durationMs }) => durationMs);
  const native = animationTimeline(60, 1000).map(({ durationMs }) => durationMs);
  assert.equal(pageAtTime(control, 16), 0);
  assert.equal(pageAtTime(control, 17), 1);
  assert.equal(pageAtTime(control, 32), 1);
  assert.equal(pageAtTime(control, 33), 2);
  for (let phase = 0; phase < 30; phase += 1) {
    assert.equal(pageAtTime(checkpoint, phase * 33), phase);
    assert.equal(pageAtTime(control, phase * 33), phase * 2);
  }
  assert.equal(pageAtTime(checkpoint, 990), 0);
  assert.equal(pageAtTime(control, 990), 0);
  assert.equal(pageAtTime(native, 990), 59);
  assert.equal(pageAtTime(native, 1000), 0);
  assert.equal(pageAtTime(control, -1), 59);
});

test("quality inspection rejects invalid timing metadata", () => {
  for (const delays of [[], [0], [-1], [1.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER, 1]]) {
    assert.throws(() => pageAtTime(delays, 0), RangeError);
  }
  assert.throws(() => pageAtTime([33], NaN), RangeError);
  assert.throws(() => pageAtTime([33], Infinity), RangeError);
});

function imageHarness() {
  const images = [];
  const createImage = () => {
    let resolve;
    let reject;
    const decoded = new Promise((yes, no) => { resolve = yes; reject = no; });
    const image = { src: "", decode: () => decoded, resolve, reject };
    images.push(image);
    return image;
  };
  return { images, loader: createComparisonImageLoader({ createImage }) };
}

test("comparison is ready only after all images decode and repeated URLs are shared", async () => {
  const { images, loader } = imageHarness();
  let completed = false;
  const request = loader.load(["a", "b", "c", "d", "a"]).then((result) => {
    completed = true;
    return result;
  });
  assert.equal(images.length, 4);
  images.slice(0, 3).forEach((image) => image.resolve());
  await Promise.resolve();
  assert.equal(completed, false);
  images[3].resolve();
  assert.equal((await request).status, "ready");
  assert.equal((await loader.load(["d", "c", "b", "a"])).status, "ready");
  assert.equal(images.length, 4, "a cell/behavior change can reuse the same decoded atlas");
});

test("rapid selection cancels superseded loads and obsolete completion cannot commit", async () => {
  const { images, loader } = imageHarness();
  const first = loader.load(["old-a", "old-b"]);
  const second = loader.load(["new-a", "new-b"]);
  assert.deepEqual(images.slice(0, 2).map(({ src }) => src), ["", ""]);
  images.slice(2).forEach((image) => image.resolve());
  assert.equal((await second).status, "ready");
  images.slice(0, 2).forEach((image) => image.resolve());
  assert.equal((await first).status, "stale");
  assert.equal((await loader.load(["new-a", "new-b"])).status, "ready");
  assert.equal(images.length, 4, "late completion did not overwrite the displayed-image cache");
});

test("decode failure preserves the prior comparison and an obsolete failure is ignored", async () => {
  const { images, loader } = imageHarness();
  const initial = loader.load(["shown"]);
  images[0].resolve();
  assert.equal((await initial).status, "ready");
  const failed = loader.load(["broken", "pending"]);
  images[1].reject(new Error("fixture decode failed"));
  const failure = await failed;
  assert.equal(failure.status, "error");
  assert.match(failure.error.message, /fixture decode failed/);
  assert.deepEqual(images.slice(1).map(({ src }) => src), ["", ""]);
  assert.equal((await loader.load(["shown"])).status, "ready");
  assert.equal(images.length, 3, "failed images never replaced the prior decoded comparison");
  const obsolete = loader.load(["obsolete"]);
  const current = loader.load(["shown"]);
  images[3].reject(new Error("obsolete failure"));
  assert.equal((await current).status, "ready");
  assert.equal((await obsolete).status, "stale");
});

test("disposing invalidates an in-flight comparison", async () => {
  const { images, loader } = imageHarness();
  const request = loader.load(["pending"]);
  loader.dispose();
  assert.equal(images[0].src, "");
  images[0].resolve();
  assert.equal((await request).status, "stale");
});
