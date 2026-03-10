#!/usr/bin/env python3
"""
Minimal Turing device cache server. Run on a mesh device (e.g. Dell XPS 9570) so the
Gauss backend can distribute cache work. Implements PUT/GET/DELETE /cache/<key>,
optional stub POST /compute/job, GET /health (device health), and POST /heal (self-heal).
Port defaults to 8090 (TURING_DEVICE_PORT). All devices that connect should run this
with the device-agent.sh for health reporting and healing.
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
import time
import urllib.parse

PORT = int(os.environ.get("TURING_DEVICE_PORT", "8090"))
CACHE: dict[str, tuple[object, float | None]] = {}  # key -> (value, expiry_ts or None)


def get_system_health() -> dict:
    """Return device health for backend/UI. Uses /proc on Linux."""
    out: dict = {"ok": True, "ram_used_mb": None, "load": None}
    try:
        if os.path.exists("/proc/meminfo"):
            data: dict[str, int] = {}
            with open("/proc/meminfo") as f:
                for line in f:
                    parts = line.strip().split(None, 1)
                    if len(parts) >= 2 and parts[0].endswith(":"):
                        try:
                            data[parts[0]] = int(parts[1].split()[0])
                        except (ValueError, IndexError):
                            pass
            total = data.get("MemTotal:", 0)
            avail = data.get("MemAvailable:", data.get("MemFree:", 0))
            if total and avail is not None:
                out["ram_used_mb"] = max(0, (total - avail) // 1024)
        if os.path.exists("/proc/loadavg"):
            with open("/proc/loadavg") as f:
                parts = f.read().split()
            if parts:
                try:
                    out["load"] = float(parts[0])
                except ValueError:
                    pass
    except Exception:
        pass
    return out


def run_heal() -> dict:
    """Self-heal: clear expired cache entries, return status."""
    now = time.time()
    expired = [k for k, v in CACHE.items() if v[1] is not None and v[1] <= now]
    for k in expired:
        del CACHE[k]
    return {"ok": True, "message": "heal completed", "expired_cleared": len(expired)}


def get_key(path: str) -> str | None:
    if path.startswith("/cache/"):
        return urllib.parse.unquote(path[7:].rstrip("/") or "")
    return None


def get_compute_job_id(path: str) -> str | None:
    if path.startswith("/compute/job/") and path != "/compute/job":
        return urllib.parse.unquote(path[13:].rstrip("/"))
    return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[cache-server] {self.address_string()} {format % args}")

    def send_json(self, data: object, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_PUT(self):
        key = get_key(self.path)
        if key is None:
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body) if body else {}
            value = data.get("value")
            ttl_sec = data.get("ttl_sec")
            expiry = time.time() + ttl_sec if isinstance(ttl_sec, (int, float)) and ttl_sec > 0 else None
            CACHE[key] = (value, expiry)
            self.send_response(204)
            self.end_headers()
        except Exception as e:
            self.send_json({"error": str(e)}, 400)

    def do_GET(self):
        if self.path == "/health" or self.path == "/health/":
            self.send_json(get_system_health())
            return
        key = get_key(self.path)
        if key is not None:
            if key not in CACHE:
                self.send_error(404)
                return
            value, expiry = CACHE[key]
            if expiry is not None and time.time() > expiry:
                del CACHE[key]
                self.send_error(404)
                return
            self.send_json(value)
            return
        job_id = get_compute_job_id(self.path)
        if job_id is not None:
            self.send_json({"job_id": job_id, "status": "completed", "result": None})
            return
        self.send_error(404)

    def do_DELETE(self):
        key = get_key(self.path)
        if key is None:
            self.send_error(404)
            return
        CACHE.pop(key, None)
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        if self.path == "/compute/job" or self.path == "/compute/job/":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                data = json.loads(body) if body else {}
                job_id = data.get("job_id", "unknown")
                self.send_json({"job_id": job_id, "status": "accepted"})
            except Exception as e:
                self.send_json({"error": str(e), "status": "failed"}, 400)
            return
        if self.path == "/heal" or self.path == "/heal/":
            try:
                result = run_heal()
                self.send_json(result)
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}, 500)
            return
        self.send_error(404)


def main():
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[cache-server] Listening on 0.0.0.0:{PORT} (cache + compute + /health + /heal)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
