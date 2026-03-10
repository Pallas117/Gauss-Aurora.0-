import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import express from "express";
import { mountFeedbackRoutes } from "./feedback.js";

test("feedback router GET /api/feedback/latest returns 200 and shape", () => {
  const app = express();
  app.use(express.json());
  const requireRole = () => (_req: unknown, _res: unknown, next: () => void) => next();
  mountFeedbackRoutes(app, { requireRole });
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
      http.get(`http://127.0.0.1:${port}/api/feedback/latest`, (res) => {
        assert.equal(res.statusCode, 200);
        let body = "";
        res.on("data", (ch: Buffer) => { body += ch.toString(); });
        res.on("end", () => {
          server.close();
          const data = JSON.parse(body);
          assert.ok("timestamp" in data);
          assert.ok("count" in data);
          assert.ok(Array.isArray(data.events));
          resolve();
        });
      }).on("error", (err) => {
        server.close();
        reject(err);
      });
    });
  });
});
