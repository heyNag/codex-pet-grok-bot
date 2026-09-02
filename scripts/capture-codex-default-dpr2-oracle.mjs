#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ATLAS_WIDTH = 1536;
const ATLAS_HEIGHT = 2288;
const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const COLUMNS = 8;
const ROWS = 11;
const CSS_WIDTH_EXPRESSION = "7.04rem";
const ROOT_FONT_SIZE_PX = 16;
const DEVICE_PIXEL_RATIO = 2;
const ELEMENT_DEVICE_WIDTH = 225;
const ELEMENT_DEVICE_HEIGHT = 244;
const SLOT_COLUMNS = COLUMNS;
const SLOT_STEP_X_CSS = 120;
const SLOT_STEP_Y_CSS = 130;
const VIEWPORT_CSS_WIDTH = SLOT_COLUMNS * SLOT_STEP_X_CSS;
const VIEWPORT_CSS_HEIGHT = ROWS * SLOT_STEP_Y_CSS;
const LINEAR_INDEX_BITS = Math.ceil(Math.log2(ATLAS_WIDTH * ATLAS_HEIGHT));
const PROBE_PASSES = Math.ceil(LINEAR_INDEX_BITS / 3);
const DEFAULT_APP = "/Applications/ChatGPT.app";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value) {
  return sha256(Buffer.from(JSON.stringify(value)));
}

function isAtlasGridBackgroundPosition(value) {
  const match = /^(-?[\d.]+)%\s+(-?[\d.]+)%$/u.exec(value);
  if (!match) return false;
  const [x, y] = match.slice(1).map(Number);
  return Array.from({ length: COLUMNS }, (_, column) => column / (COLUMNS - 1) * 100)
    .some((candidate) => Math.abs(candidate - x) <= 0.001)
    && Array.from({ length: ROWS }, (_, row) => row / (ROWS - 1) * 100)
      .some((candidate) => Math.abs(candidate - y) <= 0.001);
}

function parseArguments(argv) {
  const result = { connect: null, app: process.env.CODEX_APP_PATH ?? DEFAULT_APP };
  for (const argument of argv) {
    if (argument.startsWith("--connect=")) result.connect = argument.slice("--connect=".length);
    else if (argument.startsWith("--app=")) result.app = argument.slice("--app=".length);
    else throw new Error(`Unknown argument ${argument}`);
  }
  return result;
}

async function fileSha256(filePath) {
  return sha256(await readFile(filePath));
}

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForJson(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Renderer debugging endpoint did not become ready: ${lastError?.message ?? "timeout"}`);
}

async function launchRenderer(appBundle) {
  const executable = path.join(appBundle, "Contents/MacOS/ChatGPT");
  const profile = await mkdtemp(path.join(os.tmpdir(), "codex-default-dpr2-oracle-"));
  const port = await reservePort();
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--disable-extensions",
    "--no-first-run",
  ], { stdio: "ignore" });
  child.unref();
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForJson(`${baseUrl}/json/version`);
  return { appBundle, baseUrl, child, profile };
}

async function stopRenderer(runtime) {
  if (!runtime) return;
  runtime.child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (runtime.child.exitCode == null) runtime.child.kill("SIGKILL");
  await rm(runtime.profile, { recursive: true, force: true });
}

class CdpSession {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id == null) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    });
    return this;
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    this.socket?.close();
  }
}

function probeCells() {
  return Array.from({ length: ROWS }, (_, row) => (
    Array.from({ length: COLUMNS }, (_, column) => ({
      id: `r${row}c${column}`,
      row,
      column,
    }))
  )).flat().map((probe, index) => ({
    ...probe,
    slot: index,
    cssX: (index % SLOT_COLUMNS) * SLOT_STEP_X_CSS,
    cssY: Math.floor(index / SLOT_COLUMNS) * SLOT_STEP_Y_CSS,
  }));
}

function fixtureHtml(probes) {
  const elements = probes.map((probe) => (
    `<div class="pet" data-probe="${probe.id}" style="left:${probe.cssX}px;top:${probe.cssY}px;`
    + `background-position:${probe.column / (COLUMNS - 1) * 100}% ${probe.row / (ROWS - 1) * 100}%"></div>`
  )).join("");
  return `<!doctype html><meta charset="utf-8"><style>
html{font-size:${ROOT_FONT_SIZE_PX}px}html,body{margin:0;padding:0;width:${VIEWPORT_CSS_WIDTH}px;height:${VIEWPORT_CSS_HEIGHT}px;overflow:hidden;background:#010203}
.pet{position:absolute;--codex-pet-frame-height:calc(var(--codex-pet-width,${CSS_WIDTH_EXPRESSION}) * 208 / 192);width:var(--codex-pet-width,${CSS_WIDTH_EXPRESSION});aspect-ratio:192/208;image-rendering:pixelated;background-repeat:no-repeat;background-size:800% 1100%;background-image:url('/atlas.png?pass=0')}
</style>${elements}`;
}

async function bitplanePng(pass) {
  const pixels = Buffer.allocUnsafe(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  for (let index = 0, offset = 0; index < ATLAS_WIDTH * ATLAS_HEIGHT; index += 1, offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const bit = pass * 3 + channel;
      pixels[offset + channel] = bit < LINEAR_INDEX_BITS && ((index >>> bit) & 1) === 1 ? 255 : 0;
    }
    pixels[offset + 3] = 255;
  }
  return sharp(pixels, {
    raw: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, channels: 4 },
  }).png({ compressionLevel: 9, palette: false }).toBuffer();
}

async function startFixtureServer(probes) {
  let atlas = await bitplanePng(0);
  const html = fixtureHtml(probes);
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/atlas.png")) {
      response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      response.end(atlas);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    async setPass(pass) { atlas = await bitplanePng(pass); },
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
}

async function selectTarget(baseUrl) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const targets = await waitForJson(`${baseUrl}/json/list`, 2_000);
    const target = targets.find((candidate) => (
      candidate.type === "page" && candidate.url.includes("avatar-overlay")
    )) ?? targets.find((candidate) => candidate.type === "page");
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("No renderer page target became available");
}

async function evaluate(session, expression) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails || result.result?.subtype === "error") {
    throw new Error(result.result?.description ?? result.exceptionDetails?.text ?? "renderer evaluation failed");
  }
  return result.result?.value;
}

function extractProbePixels(decoded, probe) {
  const originX = probe.cssX * DEVICE_PIXEL_RATIO;
  const originY = probe.cssY * DEVICE_PIXEL_RATIO;
  const output = Buffer.allocUnsafe(ELEMENT_DEVICE_WIDTH * ELEMENT_DEVICE_HEIGHT * 3);
  let target = 0;
  for (let y = 0; y < ELEMENT_DEVICE_HEIGHT; y += 1) {
    const source = ((originY + y) * decoded.info.width + originX) * decoded.info.channels;
    decoded.data.copy(output, target, source, source + ELEMENT_DEVICE_WIDTH * 3);
    target += ELEMENT_DEVICE_WIDTH * 3;
  }
  return output;
}

function encodeCellMap(indices, probe) {
  const encoded = Buffer.allocUnsafe(indices.length * 2);
  let xNonSeparablePixels = 0;
  let yNonSeparablePixels = 0;
  const xReference = Array.from({ length: ELEMENT_DEVICE_WIDTH }, (_, x) => (
    indices[x] % ATLAS_WIDTH
  ));
  const yReference = Array.from({ length: ELEMENT_DEVICE_HEIGHT }, (_, y) => (
    Math.floor(indices[y * ELEMENT_DEVICE_WIDTH] / ATLAS_WIDTH)
  ));
  const errors = [];
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    const targetX = pixel % ELEMENT_DEVICE_WIDTH;
    const targetY = Math.floor(pixel / ELEMENT_DEVICE_WIDTH);
    const sourceX = indices[pixel] % ATLAS_WIDTH;
    const sourceY = Math.floor(indices[pixel] / ATLAS_WIDTH);
    if (
      sourceX < probe.column * CELL_WIDTH
      || sourceX >= (probe.column + 1) * CELL_WIDTH
      || sourceY < probe.row * CELL_HEIGHT
      || sourceY >= (probe.row + 1) * CELL_HEIGHT
    ) {
      errors.push(`${probe.id} target ${targetX},${targetY} samples outside its source cell`);
      continue;
    }
    encoded[pixel * 2] = sourceX - probe.column * CELL_WIDTH;
    encoded[pixel * 2 + 1] = sourceY - probe.row * CELL_HEIGHT;
    if (sourceX !== xReference[targetX]) xNonSeparablePixels += 1;
    if (sourceY !== yReference[targetY]) yNonSeparablePixels += 1;
  }
  return { encoded, errors, xNonSeparablePixels, yNonSeparablePixels };
}

function compactCellMaps(maps) {
  const chunks = [Buffer.from("CDP2MAP1", "ascii")];
  const header = Buffer.allocUnsafe(10);
  header.writeUInt16LE(ELEMENT_DEVICE_WIDTH, 0);
  header.writeUInt16LE(ELEMENT_DEVICE_HEIGHT, 2);
  header.writeUInt16LE(COLUMNS, 4);
  header.writeUInt16LE(ROWS, 6);
  header.writeUInt16LE(maps.length, 8);
  chunks.push(header);
  for (const { encoded } of maps) {
    const baseX = Buffer.allocUnsafe(ELEMENT_DEVICE_WIDTH);
    const baseY = Buffer.allocUnsafe(ELEMENT_DEVICE_HEIGHT);
    for (let x = 0; x < ELEMENT_DEVICE_WIDTH; x += 1) baseX[x] = encoded[x * 2];
    for (let y = 0; y < ELEMENT_DEVICE_HEIGHT; y += 1) {
      baseY[y] = encoded[y * ELEMENT_DEVICE_WIDTH * 2 + 1];
    }
    const overrides = [];
    for (let pixel = 0; pixel < ELEMENT_DEVICE_WIDTH * ELEMENT_DEVICE_HEIGHT; pixel += 1) {
      const x = pixel % ELEMENT_DEVICE_WIDTH;
      const y = Math.floor(pixel / ELEMENT_DEVICE_WIDTH);
      if (encoded[pixel * 2] === baseX[x] && encoded[pixel * 2 + 1] === baseY[y]) continue;
      const override = Buffer.allocUnsafe(4);
      override.writeUInt16LE(pixel, 0);
      override[2] = encoded[pixel * 2];
      override[3] = encoded[pixel * 2 + 1];
      overrides.push(override);
    }
    const count = Buffer.allocUnsafe(4);
    count.writeUInt32LE(overrides.length, 0);
    chunks.push(baseX, baseY, count, ...overrides);
  }
  return Buffer.concat(chunks);
}

function expandCompactCellMaps(compact) {
  if (compact.subarray(0, 8).toString("ascii") !== "CDP2MAP1") {
    throw new Error("browser-oracle map has an invalid magic header");
  }
  const width = compact.readUInt16LE(8);
  const height = compact.readUInt16LE(10);
  const columns = compact.readUInt16LE(12);
  const rows = compact.readUInt16LE(14);
  const cellCount = compact.readUInt16LE(16);
  if (
    width !== ELEMENT_DEVICE_WIDTH
    || height !== ELEMENT_DEVICE_HEIGHT
    || columns !== COLUMNS
    || rows !== ROWS
    || cellCount !== COLUMNS * ROWS
  ) throw new Error("browser-oracle map header geometry is invalid");
  const cells = [];
  let offset = 18;
  for (let cell = 0; cell < cellCount; cell += 1) {
    const baseX = compact.subarray(offset, offset + width);
    offset += width;
    const baseY = compact.subarray(offset, offset + height);
    offset += height;
    const overrideCount = compact.readUInt32LE(offset);
    offset += 4;
    const expanded = Buffer.allocUnsafe(width * height * 2);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      expanded[pixel * 2] = baseX[pixel % width];
      expanded[pixel * 2 + 1] = baseY[Math.floor(pixel / width)];
    }
    for (let index = 0; index < overrideCount; index += 1) {
      const pixel = compact.readUInt16LE(offset);
      expanded[pixel * 2] = compact[offset + 2];
      expanded[pixel * 2 + 1] = compact[offset + 3];
      offset += 4;
    }
    cells.push(expanded);
  }
  if (offset !== compact.length) throw new Error("browser-oracle map has trailing bytes");
  return Buffer.concat(cells);
}

async function captureOracle(baseUrl, appBundle) {
  const browserVersion = await waitForJson(`${baseUrl}/json/version`);
  const target = await selectTarget(baseUrl);
  const originalUrl = target.url;
  const session = await new CdpSession(target.webSocketDebuggerUrl).open();
  const probes = probeCells();
  const fixture = await startFixtureServer(probes);
  const indices = new Map(probes.map(({ id }) => [id, new Uint32Array(
    ELEMENT_DEVICE_WIDTH * ELEMENT_DEVICE_HEIGHT,
  )]));
  let diagnosticPng = null;
  const channelTrace = Array.from({ length: PROBE_PASSES }, () => ({
    ambiguousChannelSamples: 0,
    maximumZeroChannel: 0,
    minimumOneChannel: 255,
  }));
  try {
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    const capturedHostElements = await evaluate(session, `(()=>[...document.querySelectorAll('[data-codex-pet-id]')].map(e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {id:e.dataset.codexPetId,state:e.dataset.codexPetState,rect:{x:r.x,y:r.y,width:r.width,height:r.height},deviceOrigin:{x:r.x*devicePixelRatio,y:r.y*devicePixelRatio},backgroundPosition:c.backgroundPosition,backgroundSize:c.backgroundSize,imageRendering:c.imageRendering,dpr:devicePixelRatio}}))()`);
    const actualHostOriginErrors = capturedHostElements.length === 0
      ? ["no live host pet element was captured before the fixture navigation"]
      : capturedHostElements.flatMap(({ id, rect, deviceOrigin, dpr, backgroundPosition, backgroundSize, imageRendering }) => (
        dpr === DEVICE_PIXEL_RATIO
        && Number.isInteger(rect.x)
        && Number.isInteger(rect.y)
        && rect.width === 112.6328125
        && rect.height === 122.015625
        && deviceOrigin.x === rect.x * dpr
        && deviceOrigin.y === rect.y * dpr
        && Number.isInteger(deviceOrigin.x)
        && Number.isInteger(deviceOrigin.y)
        && backgroundSize === "800% 1100%"
        && imageRendering === "pixelated"
        && isAtlasGridBackgroundPosition(backgroundPosition)
          ? []
          : [`${id} live host geometry/style does not match the exact default DPR2 fixture contract`]
      ));
    const actualHostElements = capturedHostElements.map(({ backgroundPosition, ...element }) => ({
      ...element,
      backgroundPositionUsesAtlasGrid: isAtlasGridBackgroundPosition(backgroundPosition),
    }));
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT_CSS_WIDTH,
      height: VIEWPORT_CSS_HEIGHT,
      deviceScaleFactor: DEVICE_PIXEL_RATIO,
      mobile: false,
    });
    await session.send("Page.navigate", { url: fixture.url });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const geometry = await evaluate(session, `(()=>({dpr:devicePixelRatio,rootFontSize:getComputedStyle(document.documentElement).fontSize,visualViewportScale:visualViewport?.scale??null,bodyZoom:getComputedStyle(document.body).zoom,viewport:{width:innerWidth,height:innerHeight},elements:[...document.querySelectorAll('.pet')].map(e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {id:e.dataset.probe,rect:{x:r.x,y:r.y,width:r.width,height:r.height},backgroundPosition:c.backgroundPosition,backgroundSize:c.backgroundSize,imageRendering:c.imageRendering}})}))()`);
    const fixtureOriginErrors = geometry.elements.flatMap(({ id, rect }) => {
      const values = [rect.x, rect.y, rect.x * DEVICE_PIXEL_RATIO, rect.y * DEVICE_PIXEL_RATIO];
      return values.every(Number.isInteger) ? [] : [`${id} fixture origin is not integer-aligned at DPR2`];
    });
    for (let pass = 0; pass < PROBE_PASSES; pass += 1) {
      await fixture.setPass(pass);
      await evaluate(session, `(async()=>{const url='/atlas.png?pass=${pass}&nonce=${Date.now()}';const image=new Image();image.src=url;await image.decode();for(const e of document.querySelectorAll('.pet'))e.style.backgroundImage='url("'+url+'")';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()`);
      const screenshot = await session.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const png = Buffer.from(screenshot.data, "base64");
      if (pass === 0) diagnosticPng = png;
      const decoded = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      if (
        decoded.info.width !== VIEWPORT_CSS_WIDTH * DEVICE_PIXEL_RATIO
        || decoded.info.height !== VIEWPORT_CSS_HEIGHT * DEVICE_PIXEL_RATIO
        || decoded.info.channels !== 3
      ) throw new Error(`Screenshot pass ${pass} decoded to unexpected geometry`);
      for (const probe of probes) {
        const crop = extractProbePixels(decoded, probe);
        const output = indices.get(probe.id);
        for (let pixel = 0; pixel < output.length; pixel += 1) {
          for (let channel = 0; channel < 3; channel += 1) {
            const bit = pass * 3 + channel;
            if (bit >= LINEAR_INDEX_BITS) continue;
            const value = crop[pixel * 3 + channel];
            if (value > 96 && value < 160) channelTrace[pass].ambiguousChannelSamples += 1;
            if (value >= 128) {
              output[pixel] |= 1 << bit;
              channelTrace[pass].minimumOneChannel = Math.min(channelTrace[pass].minimumOneChannel, value);
            } else {
              channelTrace[pass].maximumZeroChannel = Math.max(channelTrace[pass].maximumZeroChannel, value);
            }
          }
        }
      }
    }

    const maps = probes.map((probe) => ({ probe, ...encodeCellMap(indices.get(probe.id), probe) }));
    const errors = [
      ...actualHostOriginErrors,
      ...fixtureOriginErrors,
      ...maps.flatMap((map) => map.errors),
    ];
    if (geometry.dpr !== DEVICE_PIXEL_RATIO) errors.push(`fixture DPR is ${geometry.dpr}`);
    if (geometry.rootFontSize !== `${ROOT_FONT_SIZE_PX}px`) errors.push(`fixture root font size is ${geometry.rootFontSize}`);
    if (geometry.visualViewportScale !== 1 || geometry.bodyZoom !== "1") {
      errors.push(`fixture zoom contract is visualViewport=${geometry.visualViewportScale}, body=${geometry.bodyZoom}`);
    }
    if (channelTrace.some(({ ambiguousChannelSamples }) => ambiguousChannelSamples !== 0)) {
      errors.push("binary screenshot trace contains ambiguous color-managed channel samples");
    }
    const rawMap = Buffer.concat(maps.map(({ encoded }) => encoded));
    const compactMap = compactCellMaps(maps);
    const expandedRoundTrip = expandCompactCellMaps(compactMap);
    if (!expandedRoundTrip.equals(rawMap)) {
      errors.push("compact browser-oracle map does not losslessly round-trip to the screenshot trace");
    }
    const compressedMap = deflateSync(compactMap, { level: 9 });
    const cellTrace = maps.map(({ probe, encoded, xNonSeparablePixels, yNonSeparablePixels }) => ({
      key: probe.id,
      sourceCoordinateMapSha256: sha256(encoded),
      xNonSeparablePixels,
      yNonSeparablePixels,
    }));
    const executable = path.join(appBundle, "Contents/MacOS/ChatGPT");
    const framework = path.join(
      appBundle,
      "Contents/Frameworks/Codex Framework.framework/Versions",
      browserVersion.Browser.split("/")[1],
      "Codex Framework",
    );
    const runtimeHashes = {
      mainExecutableSha256: await fileSha256(executable),
      frameworkSha256: await fileSha256(framework),
      applicationResourcesSha256: await fileSha256(path.join(appBundle, "Contents/Resources/app.asar")),
    };
    const report = {
      schemaVersion: 1,
      kind: "codex-default-dpr2-browser-oracle",
      ok: errors.length === 0,
      target: {
        cssWidthExpression: CSS_WIDTH_EXPRESSION,
        rootFontSizePx: ROOT_FONT_SIZE_PX,
        aspectRatio: "192 / 208",
        backgroundSize: "800% 1100%",
        backgroundPosition: "column / 7 * 100%; row / 10 * 100%",
        imageRendering: "pixelated",
        devicePixelRatio: DEVICE_PIXEL_RATIO,
        measuredCssRect: geometry.elements[0].rect,
        measuredDeviceFootprint: {
          width: ELEMENT_DEVICE_WIDTH,
          height: ELEMENT_DEVICE_HEIGHT,
        },
        capturedZoomContract: {
          visualViewportScale: geometry.visualViewportScale,
          bodyZoom: geometry.bodyZoom,
        },
        originContract: {
          fixtureCssOriginsAreIntegers: fixtureOriginErrors.length === 0,
          fixtureDeviceOriginsAreIntegers: fixtureOriginErrors.length === 0,
          capturedHostOriginsAreIntegers: capturedHostElements.length > 0 && actualHostOriginErrors.length === 0,
          hostLayoutEvidence: "manual code-audit premise: the packaged overlay bound by renderer.applicationResourcesSha256 rounds mascot left/top and window content bounds to integer CSS pixels before each layout application",
          implicationAtDpr2: "under that app-resource-bound layout premise, each normal renderer-local mascot origin lands on an even integer device pixel; the screenshot itself proves only the captured live element and integer-origin fixture maps",
        },
        actualHostElements,
      },
      renderer: {
        browser: browserVersion.Browser,
        protocolVersion: browserVersion["Protocol-Version"],
        userAgent: browserVersion["User-Agent"],
        v8Version: browserVersion["V8-Version"],
        webkitVersion: browserVersion["WebKit-Version"],
        ...runtimeHashes,
      },
      screenshotProbe: {
        method: "exact renderer Page.captureScreenshot; eight 3-bit binary source-coordinate passes",
        passCount: PROBE_PASSES,
        encodedLinearIndexBits: LINEAR_INDEX_BITS,
        viewportCss: geometry.viewport,
        screenshotDevice: {
          width: VIEWPORT_CSS_WIDTH * DEVICE_PIXEL_RATIO,
          height: VIEWPORT_CSS_HEIGHT * DEVICE_PIXEL_RATIO,
        },
        channelTrace,
        diagnosticPath: "qa/codex-default-dpr2-browser-oracle.png",
        diagnosticSha256: sha256(diagnosticPng),
      },
      sourceMaps: {
        outputDeviceWidth: ELEMENT_DEVICE_WIDTH,
        outputDeviceHeight: ELEMENT_DEVICE_HEIGHT,
        encoding: "CDP2MAP1; row-major r0c0..r10c7; per-cell base x[225] + y[244] with uint16 target-index/uint8 x/uint8 y sparse overrides; zlib-deflate",
        compressedPath: "qa/codex-default-dpr2-browser-oracle-map.bin",
        compressedBytes: compressedMap.length,
        compressedSha256: sha256(compressedMap),
        compactBytes: compactMap.length,
        compactSha256: sha256(compactMap),
        rawBytes: rawMap.length,
        rawSha256: sha256(rawMap),
        roundTripRawSha256: sha256(expandedRoundTrip),
        allCellCount: cellTrace.length,
        orderedCellTraceSha256: sha256Json(cellTrace),
        nonSeparablePixels: {
          x: cellTrace.reduce((total, cell) => total + cell.xNonSeparablePixels, 0),
          y: cellTrace.reduce((total, cell) => total + cell.yNonSeparablePixels, 0),
        },
        cellTrace,
      },
      errors,
    };
    await writeFile(path.join(root, "qa/codex-default-dpr2-browser-oracle.png"), diagnosticPng);
    await writeFile(path.join(root, "qa/codex-default-dpr2-browser-oracle-map.bin"), compressedMap);
    await writeFile(
      path.join(root, "qa/codex-default-dpr2-browser-oracle.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    return report;
  } finally {
    if (originalUrl.startsWith("app:")) {
      await session.send("Page.navigate", { url: originalUrl }).catch(() => {});
    }
    session.close();
    await fixture.close();
  }
}

async function main() {
  if (process.platform !== "darwin") throw new Error("The capture oracle is macOS-only");
  const options = parseArguments(process.argv.slice(2));
  let runtime = null;
  const baseUrl = options.connect ?? (runtime = await launchRenderer(options.app)).baseUrl;
  try {
    const report = await captureOracle(baseUrl, options.app);
    console.log(
      `${report.ok ? "PASS" : "FAIL"}: exact Codex default DPR2 browser oracle; `
      + `${report.renderer.browser}, ${report.target.measuredDeviceFootprint.width}x`
      + `${report.target.measuredDeviceFootprint.height} device px, ${report.errors.length} errors`,
    );
    for (const error of report.errors) console.error(`error: ${error}`);
    if (!report.ok) process.exitCode = 1;
  } finally {
    await stopRenderer(runtime);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
