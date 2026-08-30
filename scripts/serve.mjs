import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalRoot = await realpath(root);
const requestedPort = Number.parseInt(process.env.PORT ?? "4173", 10);
const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);

function routeToFile(pathname) {
  const relative = pathname.slice(1);
  if (
    relative === "README.md" ||
    relative.startsWith("docs/") ||
    relative.startsWith("preview/") ||
    relative.startsWith("pet/grok-bot-dark/") ||
    relative.startsWith("pet/grok-bot-light/") ||
    relative.startsWith("qa/")
  ) {
    return relative;
  }
  return null;
}

const server = createServer(async (request, response) => {
  try {
    const host = request.headers.host?.toLowerCase() ?? "";
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) {
      response.writeHead(403).end("Local preview only");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
      return;
    }
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (requestUrl.pathname === "/") {
      response.writeHead(302, { Location: "/preview/index.html" }).end();
      return;
    }
    const relative = routeToFile(requestUrl.pathname);
    if (!relative) {
      response.writeHead(404).end("Not found");
      return;
    }
    const candidate = path.resolve(root, relative);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const canonicalCandidate = await realpath(candidate);
    if (canonicalCandidate !== canonicalRoot && !canonicalCandidate.startsWith(`${canonicalRoot}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const file = await stat(canonicalCandidate);
    if (!file.isFile()) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
    response.writeHead(200, {
      "Content-Type": types.get(path.extname(canonicalCandidate)) ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(canonicalCandidate).pipe(response);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500).end(error?.code === "ENOENT" ? "Not found" : "Server error");
  }
});

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  console.log(`Grok Bot preview: http://127.0.0.1:${port}`);
});
