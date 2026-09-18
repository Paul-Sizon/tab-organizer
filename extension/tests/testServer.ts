import http from "http";
import type { AddressInfo } from "net";

const PAGES: Record<string, string> = {
  "/react-docs": "<title>React Docs</title><p>Learn React</p>",
  "/amazon-cart": "<title>Cart - Amazon.com</title><p>Your cart</p>",
  "/bbc-news": "<title>BBC News - Top Stories</title><p>Headlines</p>",
};

export async function startTestServer() {
  const server = http.createServer((req, res) => {
    const body = PAGES[req.url ?? ""] ?? "<title>Not Found</title>";
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html><head>${body}</html>`);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    urls: Object.keys(PAGES).map((path) => `${baseUrl}${path}`),
    close: () =>
      new Promise<void>((resolve) => {
        // Chromium keeps the keep-alive socket open, which would otherwise
        // make server.close() hang waiting for connections to end.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
