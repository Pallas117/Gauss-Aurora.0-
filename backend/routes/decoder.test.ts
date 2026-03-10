import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import express from "express";
import { mountDecoderRoutes } from "./decoder.js";

test("decoder router GET /api/ops/decoder/status returns 200 and decoder status shape", () => {
  const app = express();
  const requireRole = () => (_req: unknown, _res: unknown, next: () => void) => next();
  mountDecoderRoutes(app, { requireRole });
  const server = http.createServer(app);

  return new Promise<void>((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err?.code === "EPERM") {
        // Sandbox runtime may disallow binding local sockets; treat as environment skip.
        resolve();
        return;
      }
      reject(err);
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      http.get(`http://127.0.0.1:${port}/api/ops/decoder/status`, (res) => {
        assert.equal(res.statusCode, 200);
        let body = "";
        res.on("data", (ch: Buffer) => { body += ch.toString(); });
        res.on("end", () => {
          server.close();
          const data = JSON.parse(body);
          assert.ok("decode_error_rate_5m" in data);
          assert.ok("last_decode_at" in data);
          assert.ok("dictionary_id" in data);
          resolve();
        });
      }).on("error", (err) => {
        server.close();
        reject(err);
      });
    });
  });
});
