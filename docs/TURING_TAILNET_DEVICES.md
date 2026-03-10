# Turing Tailnet Devices

Devices on the Tailscale VPN (the "Turing" pool) can provide **in-memory cache** and **compute** (inference, batch jobs) to the GAUSS backend. The app shows device health at **/turing**.

**No WireGuard conversion needed** — Tailscale already uses WireGuard. Install Tailscale on new hardware (e.g. a Dell XPS), join the same tailnet, then use the automation below to detect and distribute work.

## Join through the web app (anti-botnet validation)

Any device can connect through the **web application** with step-by-step instructions and a validation security check (anti-botnet model):

1. Open **Turing** in the app (sidebar → Turing).
2. Follow the **"Join the network"** steps: install Tailscale, then get a **one-time join code** (operator clicks "Generate join code").
3. On the device, run the agent with `JOIN_CODE=<code>` and `BACKEND_URL=...`; the device registers and is **auto-approved** so it can receive cache/compute work.
4. Alternatively, a device can register with `TURING_REGISTER_SECRET` (or no secret if the backend does not set one); it will appear as **pending**. An operator then clicks **Approve** in the devices table to allow it to receive work.
5. **Revoke** sets a device back to pending (it no longer receives work). **Remove** deletes it from the pool.

Only **approved** devices are selected for cache and compute. Pending devices are visible in the list but do not receive work until approved.

## 1) Joining devices to the tailnet

- Install Tailscale on each device (e.g. old hardware) and join your tailnet.
- Ensure the backend can reach devices over Tailscale IPs (same tailnet or trusted exit nodes).
- Optional: set `TURING_REGISTER_SECRET` in the backend so only agents that know the secret can register.

## 2) Register and heartbeat

Devices (or an agent on each device) must register and send heartbeats so the backend knows they are alive.

**Register (create or update):**

```http
POST /api/turing/register
Content-Type: application/json
X-Turing-Secret: <optional; required if TURING_REGISTER_SECRET is set>

{
  "hostname": "my-pi",
  "tailscale_ip": "100.x.y.z",
  "ram_mb": 2048,
  "capabilities": ["cache", "inference"],
  "join_code": "ABC12XYZ"
}
```

- `hostname`, `tailscale_ip` are required. `ram_mb`, `capabilities`, and `join_code` are optional.
- **Anti-botnet:** Either a valid one-time `join_code` (from the web app) or `X-Turing-Secret` (when `TURING_REGISTER_SECRET` is set) is required. If `join_code` is valid, the device is auto-approved; otherwise it is registered as **pending** until an operator approves it in the app.
- If a device with the same `tailscale_ip` already exists, it is updated.
- Response: `201` with `{ "id": "turing-...", "created": true|false, "approved": true|false }`.

**Heartbeat:**

```http
POST /api/turing/heartbeat
Content-Type: application/json
X-Turing-Secret: <optional>

{
  "device_id": "turing-...",
  "ram_used_mb": 512,
  "load": 0.5,
  "current_jobs": 2
}
```

- Identify the device by `device_id` (from register) or `tailscale_ip`.
- Optional: send `ram_used_mb`, `load`, `current_jobs` so the backend can select the best device for cache/compute.
- Response: `200` with `{ "id": "...", "ok": true }` or `404` if device not found.

## 3) Device health and healing via agent

**All devices that connect to the application should run the device agent** (and optionally the cache server) so they get **device health** and **healing** via the agent.

- **Health reporting:** The device agent (`device-agent.sh`) collects RAM used and load average on each heartbeat and sends them to the backend. The backend derives status (healthy/stale/offline) from last-seen and uses `ram_used_mb` / `load` for device selection and display.
- **On-demand health:** The device cache server exposes **GET /health** (returns `ok`, `ram_used_mb`, `load`). Operators can click **Check health** in the app; the backend proxies to the device and shows the result.
- **Healing:** The device cache server exposes **POST /heal** (clears expired cache entries, returns `ok`, `expired_cleared`). Operators can click **Heal** in the app; the backend proxies to the device so the agent can perform self-heal (e.g. clear expired cache). Extend the device server to run other recovery actions if needed.

**In the app:** `/turing` — table of devices with status, last seen, RAM, capabilities, and actions: **Check health** (stethoscope), **Heal** (heart), Approve/Revoke, Remove. Only devices running the agent and (for health/heal) the cache server will respond to health check and heal.

- **API:** `GET /api/turing/devices/:id/health` (operator) — proxy to device GET /health. `POST /api/turing/devices/:id/heal` (operator) — proxy to device POST /heal.

## 4) Device list in the app

- **Route:** `/turing` — full monitor: table of devices with status (healthy/stale/offline), last seen, RAM, capabilities, load/jobs, and health/heal actions.
- **Shell footer:** "Turing: N devices (M healthy)" with link to `/turing` when the pool is enabled and summary is available.
- **API:** `GET /api/turing/devices` (authenticated) and `GET /api/turing/devices/summary` return the list and counts; `GET /api/ops/turing/devices` (operator) returns the same list.

## 5) Health and heal contract (device API)

All devices that connect should run the cache server (or an equivalent) that exposes:

- **GET /health** — Return device health: `{ "ok": true, "ram_used_mb": number | null, "load": number | null }`. Used by the app "Check health" action.
- **POST /heal** — Run self-heal (e.g. clear expired cache entries). Return `{ "ok": true, "message": "...", "expired_cleared": number }`. Used by the app "Heal" action.

The bundled `scripts/turing/device-cache-server.py` implements both. Port: `TURING_DEVICE_PORT` (default 8090).

## 6) Cache contract (device API)

A Turing device that advertises the `cache` capability should expose:

- **PUT /cache/:key** — Store a value. Body: `{ "value": <any>, "ttl_sec"?: number }`. Port: `TURING_DEVICE_PORT` (default 8090).
- **GET /cache/:key** — Return stored value as JSON; `404` if missing or expired.
- **DELETE /cache/:key** — Evict the key.

The backend proxies cache requests from the app to a healthy cache-capable device (e.g. least `ram_used_mb`). App API:

- `POST /api/turing/cache` — body: `{ "key", "value", "ttl_sec?", "preferred_device_id?" }`.
- `GET /api/turing/cache/:key` — optional query `preferred_device_id`.
- `DELETE /api/turing/cache/:key`.

## 7) Compute contract (device API)

A Turing device that advertises `inference`, `batch`, or `compute` should expose:

- **POST /compute/job** — Body: `{ "job_id", "type": "inference"|"batch", "payload" }`. Run the job and return `{ "job_id", "status", "result?", "error?" }`.
- **GET /compute/job/:job_id** — Return status and result for the job.

Backend selects a healthy device by capability and load, then dispatches:

- `POST /api/turing/compute` (operator) — body: `{ "type": "inference"|"batch", "payload", "preferred_device_id?" }`.
- `GET /api/turing/compute/job/:deviceId/:jobId` (operator) — poll job status.

## 8) Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `TURING_POOL_ENABLED` | `true` | Enable Turing pool routes and discovery. |
| `TURING_REGISTER_SECRET` | (none) | If set, register/heartbeat must send this value in `X-Turing-Secret` (or body `secret`). |
| `TURING_HEARTBEAT_STALE_MIN` | `5` | Minutes without heartbeat before device is "stale"; longer for "offline". |
| `TURING_DEVICE_PORT` | `8090` | Port on which devices expose cache and compute endpoints. |
| `TURING_MIN_BATTERY_PERCENT` | `25` | Per-device battery floor; devices with reported `battery_percent` below this are excluded from cache/compute selection. |

## 9) Using RAM on devices

- **Cache:** Backend routes key-value store requests to a device’s RAM; the device agent implements PUT/GET/DELETE /cache/:key.
- **Compute:** Backend sends job payloads to a device; the device runs inference or batch work and returns results. Future use: run heavier workloads on old hardware over the VPN while keeping the main backend light.

---

## 10) Automated onboarding and mesh detection

### Device-side agent (run on each mesh device)

On the **Dell XPS 9570** (or any Linux/macOS device on the tailnet):

1. **Install Tailscale** and join your tailnet (`tailscale up`).
2. **Run the Turing device agent** so the backend can see and use the device:

   From the repo (or copy `scripts/turing/device-agent.sh` and `scripts/turing/device-cache-server.py` to the device):

   ```bash
   export BACKEND_URL="https://100.x.y.z:3001"
   export TURING_SECRET="<same as TURING_REGISTER_SECRET on backend, if set>"
   export HOSTNAME="dell-xps-9570"
   export TURING_RAM_MB=16384
   export TURING_CAPABILITIES="cache,inference"
   ./scripts/turing/device-agent.sh
   ```

   The agent registers once, then sends heartbeats every 60s. It discovers its own Tailscale IPv4 via `tailscale ip -4`.

3. **Run the cache server** on the same machine so the backend can send cache/compute work:

   ```bash
   python3 scripts/turing/device-cache-server.py
   ```

   Listens on `0.0.0.0:8090` (override with `TURING_DEVICE_PORT`). Implements PUT/GET/DELETE `/cache/:key` and a stub POST `/compute/job`.

4. **Automation:** Run both under systemd (Linux) or launchd (macOS) so they start on boot.

### Backend-side discovery (optional): sync from Tailscale

Run on a machine that has Tailscale and can reach the backend to pre-register all devices visible on the mesh:

```bash
export BACKEND_URL="https://100.x.y.z:3001"
export TURING_SECRET="<if set>"
./scripts/turing/sync-from-tailscale.sh
# Dry run: ./scripts/turing/sync-from-tailscale.sh --dry-run
```

Requires `tailscale` and `jq`. You can cron this (e.g. every 5 minutes) to keep the pool in sync with the mesh.

### How distribution works

- **Detection:** Devices appear when they register (via the device agent or sync script) and send heartbeats (including optional `battery_percent`).
- **Selection:** Backend uses `selectDeviceForCache()` and `selectDeviceForCompute()` in `backend/turing/pool.ts` — healthy, **approved** devices with the right capability, then least `ram_used_mb` / least `current_jobs`, and only devices whose `battery_percent` (when reported) is at or above `TURING_MIN_BATTERY_PERCENT`. Desktops/servers without a battery are always eligible.
- **Dispatch:** Cache goes through `backend/turing/cache-proxy.ts` to `http://<tailscale_ip>:8090`; compute via `backend/turing/compute-dispatcher.ts`.

No WireGuard conversion is needed; Tailscale is WireGuard-based.

---

## 11) Example: Dell XPS 9570 (i5, 16GB RAM)

| Setting | Value |
|--------|--------|
| Hostname | `dell-xps-9570` |
| RAM | 16384 MB |
| Capabilities | `cache`, `inference` |
| Port | 8090 |

On the Dell (Linux): install Tailscale, then run `device-agent.sh` (with BACKEND_URL, TURING_SECRET, HOSTNAME, TURING_RAM_MB, TURING_CAPABILITIES) and `device-cache-server.py`. Run both under systemd to start on boot. The device will show under **/turing** and the backend will distribute cache and compute to it automatically.
