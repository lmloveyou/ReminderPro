const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { extname, join, normalize } = require("node:path");

const port = Number(process.env.PORT || 3000);
const publicDir = __dirname;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    send(response, 200, "ok", "text/plain; charset=utf-8");
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(publicDir, pathname));

  if (!filePath.startsWith(publicDir)) {
    send(response, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  try {
    const file = await readFile(filePath);
    send(response, 200, file, contentTypes[extname(filePath)] || "application/octet-stream");
  } catch {
    const index = await readFile(join(publicDir, "index.html"));
    send(response, 200, index, contentTypes[".html"]);
  }
});

server.listen(port, () => {
  console.log(`ReminderPro is running on port ${port}`);
});

function send(response, statusCode, body, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": statusCode === 200 ? "public, max-age=300" : "no-store"
  });
  response.end(body);
}
