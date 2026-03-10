# API Endpoints & Service Integration Analysis
**Generated:** March 7, 2026  
**Scope:** src/ directory analysis

---

## 1. CORE API INFRASTRUCTURE

### Base URL Resolution
**File:** [src/lib/api/base-url.ts](src/lib/api/base-url.ts)

- **Resolution Logic:**
  - Reads `VITE_HELIO_PROXY_URL` environment variable
  - Falls back to loopback detection and current host inference
  - Handles localhost → current-host routing for LAN/Tailscale scenarios
  - Default port: **3001** (backend proxy)

- **Key Function:** `resolveHostAwareBaseUrl()`
  - Returns URL with trailing slash stripped
  - Handles hotspot/LAN/Tailscale bridging when frontend on different host than env config

**Critical Config:** `VITE_HELIO_PROXY_URL=http://localhost:3001` (currently set in .env)

---

## 2. SUPABASE INTEGRATION

### Authentication
**File:** [src/integrations/supabase/client.ts](src/integrations/supabase/client.ts)

```typescript
SUPABASE_URL = ...env?.VITE_SUPABASE_URL || "http://localhost:54321"
SUPABASE_PUBLISHABLE_KEY = ...env?.VITE_SUPABASE_PUBLISHABLE_KEY || "dummy-key"
```

**Current Config (.env):**
- `VITE_SUPABASE_URL=https://qmlanlazhbhiwcaxgzxt.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...` (JWT token)

**⚠️ POTENTIAL ISSUE:**
- Placeholder detection checks for `/your-project\.supabase\.co/i` and `/your-anon-key/i`
- Current values are production Supabase — should work
- Dev mode warns if still using placeholders
- **Demo Note:** Must have working Supabase instance or will fall back to localhost:54321

---

## 3. API AUTHENTICATION

### Token Management
**File:** [src/lib/api/auth.ts](src/lib/api/auth.ts)

- `getAccessToken()` — retrieves session token from Supabase
- `getAuthHeaders()` — returns `{ Authorization: "Bearer {token}" }`

**Used by:** All authenticated endpoints require `await getAuthHeaders()` in fetch init

**⚠️ CRITICAL FOR DEMO:**
- If Supabase auth fails → `getAccessToken()` returns null
- Most API calls will fail with 401 if token unavailable
- Need valid Supabase session or stubbed token flow

---

## 4. HELIOPHYSICS DATA ENDPOINTS

### 1. Space Weather Feed
**Endpoint:** `GET /api/feed/space-weather/5s?lookback=PT24H&limit=17280`  
**Source:** [src/lib/api/heliophysics-proxy.ts](src/lib/api/heliophysics-proxy.ts#L31)  
**Function:** `fetchSpaceWeather5s(lookback, limit)`

```typescript
const response = await fetchWithResilience(
  `${BASE_URL}/api/feed/space-weather/5s?...`,
  { headers: await getAuthHeaders() }
)
```

### 2. Space Weather Latest
**Endpoint:** `GET /api/feed/space-weather/latest`  
**Function:** `fetchSpaceWeatherLatest()`

### 3. MMS (Magnetospheric Multiscale Mission) Reconnection
**Endpoint:** `GET /api/feed/mms/reconnection?lookback=PT2H&limit=1440`  
**Function:** `fetchMmsReconnection(lookback, limit)`

### 4. MMS Reconnection Latest
**Endpoint:** `GET /api/feed/mms/reconnection/latest`  
**Function:** `fetchMmsReconnectionLatest()`

### 5. Aurora Map
**Endpoint:** `GET /api/feed/aurora/map?projection=gsm`  
**Function:** `fetchAuroraMap()`

### 6. Source Health Status
**Endpoint:** `GET /api/feed/sources/status`  
**Function:** `fetchSourceStatus()`  
**Response:** Array of `{ source, lastSeen, latencySeconds, healthy, message }`

### 7. Threat Summary
**Endpoint:** `GET /api/feed/threats/summary?lookback=PT30M&limit=96&horizonMinutes=30`  
**Function:** `fetchThreatSummary(lookback, limit, horizonMinutes)`

**Error Handling in heliophysics-proxy.ts:**
```
401 → "Sign in required"
403 → "Insufficient role"
Other → "HTTP {status}"
```

---

## 5. WEBSOCKET CONNECTION

**File:** [src/hooks/useSolarWind5s.ts](src/hooks/useSolarWind5s.ts)

### WebSocket Feed
- **Enabled by:** `VITE_HELIO_WS_ENABLED=false` (currently disabled)
- **Endpoint:** `ws://{BASE_URL}/ws/feed/space-weather?token={token}`
  - Converts `http://localhost:3001` → `ws://localhost:3001`
  - Token required in query param (from Supabase session)
- **Message Format:**
  ```json
  {
    "topic": "space-weather",
    "payload": { ...CanonicalSpaceWeatherPoint }
  }
  ```
- **Reconnection Strategy:**
  - Exponential backoff: 3s → 6s → 12s → 24s → 30s (max)
  - Falls back to polling if WebSocket unavailable
  - Triggers reconnect on network online event

**⚠️ ISSUE FOR DEMO:**
- WebSocket disabled by default (`VITE_HELIO_WS_ENABLED=false`)
- If backend doesn't have `/ws/feed/space-weather`, will fail
- Falls back to HTTP polling automatically

---

## 6. OPERATOR/OPS ENDPOINTS

### Data Sources Management
**File:** [src/lib/api/operator-sources.ts](src/lib/api/operator-sources.ts)

**GET Endpoints:**
- `GET /api/ops/data-sources` — fetch all data sources
- `GET /api/ops/satellite-hardware` — fetch hardware

**POST/PATCH/DELETE Endpoints:**
- `POST /api/ops/data-sources` — create source
- `PATCH /api/ops/data-sources/{id}` — update source
- `DELETE /api/ops/data-sources/{id}` — delete source
- `POST /api/ops/satellite-hardware` — create hardware
- `PATCH /api/ops/satellite-hardware/{id}` — update hardware
- `DELETE /api/ops/satellite-hardware/{id}` — delete hardware

**Header:** Always includes `"Content-Type": "application/json"`

**Auth Requirements:** 403 if not "operator" or "admin" role

**Source Override:**
- `PATCH /api/ops/source-health/{source}/override`
- Body: `{ overrideDecision?, overrideTargetCadenceMs?, overrideReason? }`

---

## 7. TURING DEVICE POOL ENDPOINTS

**File:** [src/lib/api/turing.ts](src/lib/api/turing.ts)

### Read Operations
- `GET /api/turing/devices` — list devices
- `GET /api/turing/devices/summary` — summary view
- `GET /api/turing/devices/{deviceId}/health` — device health check

### Write Operations
- `POST /api/turing/join-code` — generate join code (operator only)
- `POST /api/turing/devices/{deviceId}/approve` — approve device
- `POST /api/turing/devices/{deviceId}/revoke` — revoke device
- `DELETE /api/turing/devices/{deviceId}` — remove device
- `POST /api/turing/devices/{deviceId}/heal` — trigger device heal

**Timeout:** 8s per request  
**Retries:** 1 retry  
**Status Codes:**
- 401 → "Sign in required"
- 403 → "Operator role required"
- 502 → "Device unreachable"
- 503 → "Turing pool disabled"

---

## 8. ONBOARDING FLOW

**File:** [src/lib/api/onboarding.ts](src/lib/api/onboarding.ts)

- `GET /api/auth/onboarding` — fetch onboarding state
- `PATCH /api/auth/onboarding` — update onboarding progress
  - Body: `{ deviceStepDone?, planStepDone?, complete? }`

**Auth:** 401 if not signed in

---

## 9. AI INFERENCE ENDPOINTS

### Nowcast Inference
**Used in:** [src/pages/IntelPage.tsx](src/pages/IntelPage.tsx#L45), [src/pages/CeresMobileNodePage.tsx](src/pages/CeresMobileNodePage.tsx#L60)

**Endpoint:** `POST /api/ai/nowcast/infer`

```typescript
fetch(`${BASE_URL}/api/ai/nowcast/infer`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(await getAuthHeaders())
  },
  body: JSON.stringify({
    horizonMinutes: 30,
    sequence: [latest]
  })
})
```

**Response:** `{ predictions?: unknown[] }`

**Error Handling:**
- 401/403 → "Insufficient permissions"
- Other → `Inference HTTP {status}`

---

## 10. CYBERTIGER SECURITY ENDPOINT

**File:** [src/pages/AutomationPage.tsx](src/pages/AutomationPage.tsx#L141)

**Endpoint:** `GET /api/security/cybertiger/status`

```typescript
const response = await fetch(`${BASE_URL}/api/security/cybertiger/status`, {
  headers: await getAuthHeaders()
})
```

**Backend Config:** `CYBERTIGER_ENABLED=true` (in .env)

---

## 11. HEALTH CHECK

**File:** [src/pages/ChronosPage.tsx](src/pages/ChronosPage.tsx#L26)

**Endpoint:** `GET /health` (at base URL, not under /api)

```typescript
const response = await fetch(`${BASE_URL}/health`);
```

**Simple status check** — likely returns 200 OK if backend running

---

## 12. RADIATION DATA SOURCES

### NASA OMNI
**File:** [src/lib/api/nasa-omni.ts](src/lib/api/nasa-omni.ts)

**External Endpoint:** `https://omniweb.gsfc.nasa.gov/cgi/nx1.cgi`

```typescript
const baseUrl = 'https://omniweb.gsfc.nasa.gov/cgi/nx1.cgi';
const queryParams = new URLSearchParams({
  activity: 'retrieve',
  res: 'hourly',
  spacecraft: 'omni',
  start_date: 'YYYYMMDD',
  end_date: 'YYYYMMDD',
  vars: '...',
  fmt: 'json'
});
```

**⚠️ CRITICAL:** External API call — may fail if:
- Request blocked by CORS
- OMNI service down
- Network filtering in demo environment

### SPENVIS
**File:** [src/lib/api/spenvis.ts](src/lib/api/spenvis.ts)

**External Endpoint:** `https://www.spenvis.oma.be/api/v1/radiation`

**⚠️ PLACEHOLDER:** Comments indicate this is example API — actual SPENVIS interaction may vary (web interface vs API)

### Clients (CSV Static Data)
- [src/services/nasa-client.ts](src/services/nasa-client.ts) — uses `fetchOMNIData()`
- [src/services/cses-client.ts](src/services/cses-client.ts) — CSV client
- [src/services/erg-client.ts](src/services/erg-client.ts) — CSV client

**Caching:** All use React Query with:
```
refetchOnWindowFocus: false
refetchOnReconnect: false
```

---

## 13. NETWORK RESILIENCE

**File:** [src/lib/network/resilient-fetch.ts](src/lib/network/resilient-fetch.ts)

### Default Settings
```typescript
DEFAULT_TIMEOUT_MS = 8_000
DEFAULT_RETRIES = 2
DEFAULT_RETRY_BASE_MS = 350
DEFAULT_RETRY_MAX_MS = 2_500
DEFAULT_TRANSITION_GRACE_MS = 1_500
DEFAULT_RETRIABLE_STATUSES = [408, 425, 429, 500, 502, 503, 504]
```

### Retry Backoff
- Exponential with jitter
- Formula: `min(maxMs, baseMs * 2^attempt) + jitter(0-25%)`

### Network Detection
- Listens for `online`/`offline` events
- Fails fast if `navigator.onLine === false`
- Includes 1.5s transition grace period after network change

---

## 14. STRIPE INTEGRATION

**File:** [src/pages/Signup.tsx](src/pages/Signup.tsx#L16)

**Checkout URL:** `VITE_STRIPE_CHECKOUT_URL` (currently empty in .env)

**⚠️ ISSUE:** If Stripe URL not configured, checkout button disabled

---

## 15. RAG (RETRIEVAL-AUGMENTED GENERATION)

**File:** Components reference `VITE_GAUSS_RAG_URL`

**Endpoint:** `http://localhost:3002` (in .env config)

**⚠️ NOTE:** RAG service must be running separately or demo will lack LLM augmentation

---

## 16. ENVIRONMENT VARIABLE SUMMARY

| Variable | Current Value | Purpose | Missing? |
|----------|---------------|---------|----------|
| `VITE_HELIO_PROXY_URL` | `http://localhost:3001` | Backend proxy | ❌ |
| `VITE_SUPABASE_URL` | Production URL | Auth service | ❌ |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Production key | Auth token | ❌ |
| `VITE_HELIO_WS_ENABLED` | `false` | WebSocket feed | Disabled (polling fallback) |
| `VITE_STRIPE_CHECKOUT_URL` | (empty) | Billing link | ⚠️ Causes UI warning |
| `VITE_GAUSS_RAG_URL` | `http://localhost:3002` | RAG service | ⚠️ Must run separately |
| `VITE_DEFAULT_LANDING` | (not set) | Landing page (sda/default) | Optional |
| `VITE_FEATURE_DEBRIS_3D` | (not set) | 3D debris visualization | Optional |
| `VITE_ENABLE_ORBIT_LAB` | (not set) | OrbitLab feature | Optional |

---

## 17. DEMO READINESS CHECKLIST

### ✅ Ready
- [x] Supabase auth configured
- [x] Base URL resolution logic is intelligent (handles localhost/LAN)
- [x] Resilient fetch with retry/timeout built-in
- [x] Auth headers automatically added to requests

### ⚠️ Needs Backend
- [ ] Backend server running on `http://localhost:3001`
- [ ] `/api/feed/*` endpoints returning data
- [ ] `/api/turing/*` endpoints for device management
- [ ] `/api/ops/*` endpoints for operator features
- [ ] `/api/ai/nowcast/infer` for ML inference
- [ ] `/api/security/cybertiger/status` for security

### ⚠️ Optional Services
- [ ] RAG service on `:3002` (for natural language features)
- [ ] WebSocket support if `VITE_HELIO_WS_ENABLED=true`
- [ ] External OMNI/SPENVIS APIs (radiation data) — disabled by `GAUSS_AIR_GAP=true`

### ⚠️ Configuration Issues
- [ ] Stripe URL missing — billing features blocked
- [ ] CORS — if backend on different origin, may need CORS headers
- [ ] ALLOWED_ORIGINS — verify `http://localhost:8080` is in backend allow list

---

## 18. POTENTIAL WIRING ISSUES FOR DEMO

### Issue 1: Backend Not Running
**Symptom:** All API calls timeout or return connection refused  
**Check:** `curl http://localhost:3001/health`  
**Fix:** Ensure backend proxy server started

### Issue 2: Authentication Failing
**Symptom:** 401 Unauthorized on all API calls  
**Check:** 
- Verify Supabase `VITE_SUPABASE_URL` is reachable
- Check `VITE_SUPABASE_PUBLISHABLE_KEY` validity
- Confirm user session exists in browser

**Fix:** Delete Supabase session and re-authenticate

### Issue 3: WebSocket Connection Refused
**Symptom:** Falls back to polling, but polling also fails  
**Check:** If `VITE_HELIO_WS_ENABLED=true`, backend must have `/ws/feed/space-weather`  
**Fix:** Either enable WebSocket in backend or keep polling-only (`VITE_HELIO_WS_ENABLED=false`)

### Issue 4: CORS Blocking API Calls
**Symptom:** Browser console shows CORS errors  
**Check:** Backend's `ALLOWED_ORIGINS` and `ALLOW_PRIVATE_NETWORK_ORIGINS`  
**Fix:** Ensure `http://localhost:8080` is in `ALLOWED_ORIGINS` (currently set in .env)

### Issue 5: Radiation Data Not Loading
**Symptom:** External endpoints (OMNI/SPENVIS) fail  
**Check:** `GAUSS_AIR_GAP=true` disables external APIs  
**Fix:** For demo with no internet, keep `GAUSS_AIR_GAP=true` (uses stubs)

### Issue 6: RAG Service Unreachable
**Symptom:** LLM-augmented features missing  
**Check:** RAG service running on `:3002`  
**Fix:** Start RAG service or disable RAG-dependent features

---

## 19. PORT SUMMARY

| Port | Service | Config Variable |
|------|---------|-----------------|
| **3001** | Backend Proxy | `VITE_HELIO_PROXY_URL` |
| **3002** | RAG Service | `VITE_GAUSS_RAG_URL` |
| **54321** | Supabase (local) | Fallback only |
| **8000** | Local Inference (MLX/Surya) | `LOCAL_INFER_URL` |
| **8080** | Frontend Vite Dev | Default |
| **8088** | Gauss Brain (LLM) | `GAUSS_BRAIN_URL` |
| **8089** | Backend Chat (stub) | `ORCHESTRATOR_LOCAL_ENGINE_URL` |
| **8091** | Orchestrator Pass API | `ORCHESTRATOR_PASS_API_BIND` |

---

## 20. CORS & PROXY CONFIGURATION

**Frontend ALLOWED_ORIGINS (.env):**
```
ALLOWED_ORIGINS=http://localhost:8080
ALLOW_PRIVATE_NETWORK_ORIGINS=true
```

- Frontend on `:8080` must match `ALLOWED_ORIGINS` at backend
- `ALLOW_PRIVATE_NETWORK_ORIGINS=true` allows hotspot/LAN/Tailscale IPs
- Backend automatically includes CORS headers in responses

**Resolution in base-url.ts:**
If frontend on non-loopback (e.g., `192.168.2.1:8080`) but env points to `localhost:3001`:
- Automatically bridges to `192.168.2.1:3001` (same host, different port)
- Prevents CORS issues in LAN scenarios

---

## SUMMARY & RECOMMENDATIONS

### For Local Demo
1. **Backend must be running** on `:3001` with implemented endpoints
2. **Supabase auth working** (current creds in .env appear valid)
3. **Resilience layer handles timeouts/retries** — built-in, no changes needed
4. **WebSocket optional** — polling fallback is automatic
5. **RAG service optional** for LLM features

### For Production/Hardened Demo
1. Set `ALLOW_PRIVATE_NETWORK_ORIGINS=false`
2. Explicitly configure `VITE_HELIO_PROXY_URL` to production backend
3. Ensure all external APIs (OMNI, SPENVIS) are accessible or disable `GAUSS_AIR_GAP=true`
4. Add Stripe `VITE_STRIPE_CHECKOUT_URL` for billing
5. Consider enabling `VITE_HELIO_WS_ENABLED=true` for real-time data

### File Cross-References
- Auth errors → see [docs/AUTH_TROUBLESHOOTING.md](docs/AUTH_TROUBLESHOOTING.md)
- Debris 3D → see [docs/DEBRIS_RISK_3D.md](docs/DEBRIS_RISK_3D.md)
- UI/UX Scaling → see [docs/UI_UX_SCALING_AND_PRESENTATION.md](docs/UI_UX_SCALING_AND_PRESENTATION.md)
