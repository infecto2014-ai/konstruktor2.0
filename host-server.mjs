import http from "node:http";
import { readFile } from "node:fs/promises";

const host = "127.0.0.1";
const port = 5174;
const htmlPath = new URL("./public/host.html", import.meta.url);
const server = http.createServer(async (req, res) => {
  if (
    req.method !== "GET" ||
    !["/", "/host.html"].includes(
      new URL(req.url ?? "/", `http://${host}:${port}`).pathname,
    )
  ) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  try {
    const html = await readFile(htmlPath);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(html);
  } catch {
    res.writeHead(500);
    res.end("Host page unavailable");
  }
});
server.listen(port, host, () =>
  console.log(`Host demo: http://${host}:${port}`),
);
