import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(root, "scripts/serve.mjs");

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const outgoing = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: options.method ?? "GET",
      headers: options.headers,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

async function startServer(context) {
  const child = spawn(process.execPath, [serverScript], {
    cwd: root,
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => child.kill("SIGTERM"));
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("exit", (code) => reject(new Error(`Preview server exited ${code}: ${stderr}`)));
    child.stdout.on("data", (chunk) => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    });
  });
}

test("preview server serves docs safely and blocks escaped paths", async (context) => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "grok-preview-outside-"));
  const outsideFile = path.join(outside, "outside.txt");
  const linkName = `.server-escape-${process.pid}`;
  const linkPath = path.join(root, "qa", linkName);
  await writeFile(outsideFile, "outside\n");
  await symlink(outsideFile, linkPath);
  context.after(() => rm(outside, { recursive: true, force: true }));
  context.after(() => rm(linkPath, { force: true }));

  const base = await startServer(context);
  const markdown = await request(`${base}/README.md`);
  assert.equal(markdown.status, 200);
  assert.match(markdown.headers["content-type"], /^text\/markdown/);
  assert.equal(markdown.headers["x-content-type-options"], "nosniff");

  const preview = await request(`${base}/preview/index.html`);
  assert.equal(preview.status, 200);
  const previewHtml = preview.body.toString("utf8");
  assert.match(previewHtml, /<body data-pet-theme="dark" data-preview-mode="both">/);
  assert.match(previewHtml, /data-preview-mode-button="both"/);
  assert.match(previewHtml, /data-preview-mode-button="dark"/);
  assert.match(previewHtml, /data-preview-mode-button="light"/);
  assert.match(previewHtml, /id="pet-stage-dark"/);
  assert.match(previewHtml, /id="pet-stage-light"/);
  assert.match(previewHtml, /data-source-motion-image="dark"/);
  assert.match(previewHtml, /data-source-motion-image="light"/);
  assert.match(previewHtml, /data-atlas-image="dark"/);
  assert.match(previewHtml, /data-atlas-image="light"/);
  assert.match(previewHtml, /grok-bot-dark/);
  assert.match(previewHtml, /grok-bot-light/);

  assert.equal((await request(`${base}/.git/config`)).status, 404);
  assert.equal((await request(`${base}/qa/${linkName}`)).status, 403);
  assert.equal((await request(`${base}/preview/index.html`, { method: "POST" })).status, 405);
  assert.equal((await request(`${base}/preview/index.html`, { headers: { Host: "example.invalid" } })).status, 403);

  const servedPetIds = [];
  for (const petId of ["grok-bot-dark", "grok-bot-light"]) {
    const manifest = await request(`${base}/pet/${petId}/pet.json`);
    assert.equal(manifest.status, 200);
    const servedPetId = JSON.parse(manifest.body.toString("utf8")).id;
    assert.equal(servedPetId, petId);
    servedPetIds.push(servedPetId);

    const head = await request(`${base}/pet/${petId}/spritesheet.webp`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers["content-type"], "image/webp");
    assert.equal(head.body.length, 0);
  }
  assert.equal(new Set(servedPetIds).size, 2, "theme packages must keep unique pet IDs");
});
