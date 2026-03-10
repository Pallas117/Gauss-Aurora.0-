# QA Test Plan - Space Weather Monitor

## Overview

This document outlines the comprehensive quality assurance strategy for the Space Weather Monitor application, covering functional, performance, security, and reliability testing.

**Vision / Roadmap:** QA supports operator readiness and the M1/8GB constraint; tests align with first-customer and demo use. See [VISION_AND_ROADMAP.md](VISION_AND_ROADMAP.md) for product vision and roadmap.

---

## 1. Functional Tests

### 1.1 Backend Data Handling

| Test ID | Description | Expected Result | Priority |
|---------|-------------|-----------------|----------|
| BE-001 | Backend returns valid JSON | Response matches schema | Critical |
| BE-002 | Backend handles NOAA timeout | Returns cached/fallback data | Critical |
| BE-003 | Backend handles NASA timeout | Returns cached/fallback data | Critical |
| BE-004 | Backend handles partial API failure | Returns available data with flags | High |
| BE-005 | Backend marks stale data correctly | `flags.stale = true` when cache > 5min | High |
| BE-006 | Backend validates incoming data | Rejects malformed API responses | Critical |
| BE-007 | Backend spike rejection works | Outliers > ±4σ filtered | High |

### 1.2 Frontend Rendering

| Test ID | Description | Expected Result | Priority |
|---------|-------------|-----------------|----------|
| FE-001 | Earth renders correctly | Sphere with atmosphere visible | Critical |
| FE-002 | Van Allen belts render | Toroidal glow visible | Critical |
| FE-003 | Magnetosphere renders | Parametric surface visible | Critical |
| FE-004 | Layer toggles work | Each layer hides/shows independently | High |
| FE-005 | HUD displays data | All metrics shown with correct units | Critical |
| FE-006 | Stale indicator appears | Visual cue when data is stale | High |
| FE-007 | Screenshot captures scene | PNG downloaded with visible content | Medium |

### 1.3 Data Flow

| Test ID | Description | Expected Result | Priority |
|---------|-------------|-----------------|----------|
| DF-001 | Data interpolates smoothly | No visible snapping between updates | Critical |
| DF-002 | Magnetopause compression responds | Shrinks with high solar wind | High |
| DF-003 | Belt intensity responds | Brightens with high flux | High |
| DF-004 | Reconnection visual responds | Effect visible with southward Bz | High |
| DF-005 | 8-12 second transition | Smooth EMA interpolation | High |

---

## 2. Performance Tests

### 2.1 Frame Rate

| Test ID | Description | Target | Minimum |
|---------|-------------|--------|---------|
| PERF-001 | Desktop Chrome FPS | 60fps | 30fps |
| PERF-002 | Desktop Firefox FPS | 60fps | 30fps |
| PERF-003 | Desktop Safari FPS | 60fps | 30fps |
| PERF-004 | Integrated GPU FPS | 30fps | 24fps |

### 2.2 Load Times

| Test ID | Description | Target | Maximum |
|---------|-------------|--------|---------|
| PERF-010 | Initial page load | < 2s | 4s |
| PERF-011 | 3D scene ready | < 3s | 5s |
| PERF-012 | First data display | < 4s | 6s |

### 2.3 Shader Performance

| Test ID | Description | Target | Maximum |
|---------|-------------|--------|---------|
| PERF-020 | Earth shader time | < 1ms | 2ms |
| PERF-021 | Van Allen belts time | < 5ms | 8ms |
| PERF-022 | Magnetosphere time | < 2ms | 4ms |
| PERF-023 | Field lines time | < 1ms | 2ms |
| PERF-024 | Total shader time | < 8ms | 12ms |

### 2.4 Memory

| Test ID | Description | Target | Maximum |
|---------|-------------|--------|---------|
| PERF-030 | Initial memory | < 100MB | 200MB |
| PERF-031 | After 1 hour | < 150MB | 250MB |
| PERF-032 | No memory leaks | Stable over time | - |

### Performance Test Procedure

```javascript
// Frame time measurement
const times = [];
function measureFrame() {
  const start = performance.now();
  renderer.render(scene, camera);
  times.push(performance.now() - start);
  
  if (times.length >= 100) {
    const avg = times.reduce((a, b) => a + b) / times.length;
    const max = Math.max(...times);
    console.log(`Avg: ${avg.toFixed(2)}ms, Max: ${max.toFixed(2)}ms`);
    times.length = 0;
  }
  requestAnimationFrame(measureFrame);
}
```

---

## 3. Security Tests

### 3.1 Transport Security

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| SEC-001 | HTTPS enforcement | HTTP redirects to HTTPS |
| SEC-002 | TLS version | TLS 1.2+ only |
| SEC-003 | Certificate valid | No warnings |

### 3.2 CORS Configuration

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| SEC-010 | CORS headers present | `Access-Control-Allow-Origin` set |
| SEC-011 | Preflight handled | OPTIONS returns 200 |
| SEC-012 | Unauthorized origin blocked | Request fails from unknown origin |

### 3.3 Content Security Policy

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| SEC-020 | CSP header present | `Content-Security-Policy` set |
| SEC-021 | Inline scripts blocked | CSP violation reported |
| SEC-022 | External scripts blocked | Only whitelisted sources |

### 3.4 Input Validation

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| SEC-030 | Malformed JSON rejected | 400 response |
| SEC-031 | Oversized payload rejected | 413 response |
| SEC-032 | SQL injection safe | No database errors |
| SEC-033 | XSS in data safe | Data escaped properly |

### 3.5 Rate Limiting

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| SEC-040 | Rate limit enforced | 429 after 60 req/min |
| SEC-041 | Rate limit resets | Requests allowed after window |

---

## 4. Data Reliability Tests

### 4.1 Outage Simulation

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| REL-001 | NOAA outage (5 min) | Cache serves data, stale flag set |
| REL-002 | NOAA outage (30 min) | Fallback values, clear indicator |
| REL-003 | NASA outage (5 min) | Partial data returned |
| REL-004 | Complete outage | Graceful degradation, no crash |

### 4.2 Spike Injection

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| REL-010 | Solar wind spike 10x | Spike filtered, smooth transition |
| REL-011 | Bz spike to -100 nT | Spike filtered |
| REL-012 | Kp spike to 15 | Value clamped to 9 |
| REL-013 | Negative flux values | Clamped to 0 |

### 4.3 Decay Logic

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| REL-020 | Values decay toward baseline | Exponential decay visible |
| REL-021 | Decay rate correct | Half-life ~5 minutes |
| REL-022 | Decay stops at baseline | Values stabilize |

### 4.4 Retention / cleanup (smoke)

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| REL-030 | Full-stack mission Phase 4 | Ingest and cleanup run without error |
| REL-031 | Supabase raw tables after clean_raw_window | Row counts for `sw_raw_samples` (and related raw tables) stay within configured time window |

**Procedure:** Run full-stack mission (e.g. `npm run test:fullstack` or equivalent Phase 4); inspect Supabase row counts for raw tables before and after. After `clean_raw_window`, counts should be bounded. See [DATA_ANALYSIS_MODELS.md](DATA_ANALYSIS_MODELS.md).

### Outage Simulation Procedure

```javascript
// Mock API failure in tests
const mockFetch = (shouldFail) => {
  if (shouldFail) {
    return Promise.reject(new Error('Network error'));
  }
  return originalFetch();
};

// Test decay behavior
async function testDecay() {
  // Record initial value
  const initial = getCurrentData();
  
  // Simulate outage
  enableOutageSimulation();
  
  // Check decay over time
  for (let i = 0; i < 10; i++) {
    await sleep(60000); // 1 minute
    const current = getCurrentData();
    assert(current < initial, 'Value should decay');
  }
}
```

---

## 5. Cross-Browser Tests

### 5.1 Browser Matrix

| Browser | Version | Priority |
|---------|---------|----------|
| Chrome | Latest, Latest-1 | Critical |
| Firefox | Latest, Latest-1 | Critical |
| Safari | Latest | High |
| Edge | Latest | Medium |

### 5.2 GPU Compatibility

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| GPU-001 | NVIDIA discrete | Full quality, 60fps |
| GPU-002 | AMD discrete | Full quality, 60fps |
| GPU-003 | Intel integrated | Reduced quality, 30fps |
| GPU-004 | Apple M1/M2 | Full quality, 60fps |
| GPU-005 | WebGL blacklisted | Graceful fallback message |

### 5.3 Fallback Modes

| Test ID | Description | Expected Result |
|---------|-------------|-----------------|
| FALL-001 | WebGL disabled | Informative error message |
| FALL-002 | WebGL 1 only | Degraded but functional |
| FALL-003 | Low-end device detected | Reduced particle count |
| FALL-004 | FPS drops below 24 | Auto quality reduction |

---

## 6. Test Automation

### 6.1 Unit Tests (Vitest)

```typescript
describe('useSpaceWeather', () => {
  it('interpolates smoothly', () => {
    const { result } = renderHook(() => useSpaceWeather());
    // Test interpolation logic
  });
  
  it('handles stale data', () => {
    // Mock stale response
  });
  
  it('rejects spikes', () => {
    // Inject spike values
  });
});
```

### 6.2 Integration Tests

```typescript
describe('Data Flow', () => {
  it('fetches and displays data', async () => {
    render(<CommandPage />);
    await waitFor(() => {
      expect(screen.getByText(/Solar wind speed/i)).toBeInTheDocument();
    });
  });
});
```

### 6.3 Visual Regression Tests

```typescript
describe('Visual Regression', () => {
  it('matches Earth snapshot', async () => {
    const screenshot = await page.screenshot();
    expect(screenshot).toMatchImageSnapshot();
  });
});
```

### 6.4 Test ID → automation mapping (coverage tracking)

Map QA test IDs to automated specs where they exist. Gaps are tracked here so automation can be added over time.

| Category | Test IDs | Automated spec / command | Coverage |
|----------|----------|---------------------------|----------|
| **Backend** | BE-001, BE-006 | `backend/contracts/*.test.ts` (mission-core, heliophysics, packet-ingest, source status contracts) | Partial: schema/validation |
| **Backend** | BE-002–BE-005, BE-007 | `backend/offline-resilience.test.ts`, feed/state logic | Partial / manual |
| **Frontend** | FE-001–FE-007 | — | Manual; granular suite covers routes, not 3D/HUD |
| **Frontend routes** | (SDA, Command, Heliophysics, Intel, Systems) | `tests/e2e/ui-ux-granular.spec.ts` (`npm run test:ui` or `test:ui:granular`) | Route load + key headings |
| **Auth/portal** | (login, staff portal) | `tests/e2e/auth-portal.spec.ts` | Auth and portal flows |
| **Smoke** | (app load, nav) | `tests/e2e/ui-smoke.spec.ts` | High-level smoke |
| **Performance** | PERF-001–PERF-032 | — | Manual |
| **Security** | SEC-* | `npm run check:security-compliance` (NIST/CSF mapping) | Partial: compliance mapping; SEC-001–SEC-041 manual |
| **Reliability** | REL-030, REL-031 | `npm run test:fullstack` (Phase 4 ingest + cleanup) | Full-stack mission |
| **Reliability** | REL-001–REL-022 | — | Manual |
| **RBAC** | (auth gates) | `npm run test:rbac` (requires RBAC_* env) | RBAC smoke |
| **RLS** | (Supabase RLS) | `npm run test:supabase-rls` (requires env) | RLS smoke |

**How to use:** Run `npm test` for backend; `npm run test:ui` for Playwright (granular + smoke + auth). Before release, run `npm run audit:adherence` and optional `npm run test:rbac` / `npm run test:supabase-rls` when credentials are set. Add new rows or spec paths as new tests are added.

---

## 7. Backend, Supabase, and Orchestrator Test Matrix

This section covers the test matrix for the Node backend, Supabase (auth, RLS, pipelines), and the gauss-orchestrator. See the **Backend and Supabase Testing Plan** (`.cursor/plans/` or project docs) for full implementation details.

### 7.1 Backend tests

| Command / Job | What it does |
|---------------|----------------|
| `npm test` | Node `node --test` for `backend/**/*.test.ts` (unit and contract tests). |
| `npm run check:backend-env` | Validates required env (e.g. Supabase URL/keys). Run before or with backend tests in CI so missing env fails fast. |
| `npm run check:security-compliance` | Optional security/compliance checks. |

Backend auth uses Supabase JWT and optional `x-gauss-service-token` for orchestrator ingest. Feed routes use `getSupabaseAnonClient(accessToken)` for read-only access.

### 7.2 Supabase tests

| Command / Job | What it does |
|---------------|----------------|
| `npm run test:rbac` | RBAC smoke: viewer/operator/admin tokens, backend role gating, Supabase Auth. Requires `SUPABASE_*` and `RBAC_*` credentials. |
| `npm run test:supabase-rls` | RLS smoke: as authenticated user, SELECT from published tables (expect OK), INSERT into raw table (expect denial). |
| `npm run test:fullstack` | Full-stack mission: Phase 4 runs controlled Supabase write/cleanup (service_role `ingest_raw_sample`, verify rows). |

Migrations live under `supabase/migrations/`. RLS is defined in `20260218234500_space_weather_rbac.sql`: service_role full access; authenticated read-only on `sw_nowcast_5s`, `mms_recon_vectors_5s`, `aurora_healpix_maps`, `source_health`; raw/clean tables service_role only. Use `supabase db reset` or `supabase migration up` to validate migrations.

### 7.3 Orchestrator integration

| Command / Job | What it does |
|---------------|----------------|
| `npm run test:orchestrator` | Rust orchestrator tests (CCSDS, XTCE, packet ingest contract vs mock backend). |
| Full-stack Phase 4 (when `ORCHESTRATOR_INGEST_API_TOKEN` set) | E2E: POST `/api/ingest/telemetry/packets` with `x-gauss-service-token`; assert 200 and `accepted_count`/`rejected_count`. |
| Full adherence audit (when `ORCHESTRATOR_INGEST_API_TOKEN` set) | Ingest E2E: POST one canonical packet; assert 200 and `accepted_count`/`rejected_count`. Live ingest: run orchestrator with `--process-file tests/fixtures/ccsds_valid.bin`; binary decodes and POSTs to backend (backend must be running). If token unset, audit reports WARN for both steps. |

The orchestrator does not talk to Supabase directly; it calls the backend ingest API with a service token. Backend grants admin role when `ORCHESTRATOR_INGEST_API_TOKEN` matches.

### 7.4 Supabase agent prompts (RLS policy generation)

When using Supabase’s AI prompt for RLS policies (e.g. [Database: Create RLS policies](https://supabase.com/docs/guides/getting-started/ai-prompts/database-rls-policies)) or any agent that generates RLS:

- **Schema context**: `public` schema; tables `sw_raw_samples`, `sw_clean_samples`, `sw_nowcast_5s`, `mms_raw_fgm`, `mms_raw_mec`, `mms_recon_vectors_5s`, `aurora_healpix_maps`, `source_health`. Backend uses **service_role** for ingestion and RPCs; **authenticated** for read-only consumers; **anon** must not read space-weather or telemetry.
- **Suggested prompts** (paste into the Supabase agent):
  1. *"For the public schema tables sw_nowcast_5s, mms_recon_vectors_5s, aurora_healpix_maps, and source_health: create RLS policies so that the authenticated role can only run SELECT. Use USING (true). Do not allow anon or any write. Prefer one policy per table, named descriptively (e.g. 'authenticated_read_sw_nowcast_5s')."*
  2. *"For tables sw_raw_samples, sw_clean_samples, mms_raw_fgm, mms_raw_mec: ensure RLS is enabled and that only the service_role can SELECT, INSERT, UPDATE, DELETE. Do not create any policy that grants anon or authenticated access to these tables."*
  3. *"We have RPCs: ingest_raw_sample(text, text, timestamptz, jsonb), clean_raw_window(timestamptz, timestamptz), generate_nowcast_5s, compute_mms_recon_vectors_5s, build_aurora_healpix_map. Only service_role should execute these. get_feed_5s and get_mms_recon_feed should be executable by authenticated and service_role. Generate the appropriate GRANT/REVOKE statements (no CREATE POLICY for functions)."*
  4. *"When writing RLS policies for our Supabase project, always use (select auth.uid()) in USING/WITH CHECK where we need the current user, specify TO authenticated or anon explicitly, use separate policies for SELECT/INSERT/UPDATE/DELETE, and avoid FOR ALL. Prefer PERMISSIVE policies. Policy names should be short descriptive strings in double quotes."*

After generating or changing policies, run full-stack Phase 4 and `test:rbac` (and optionally the orchestrator ingest E2E step) to validate.

---

## 8. Test Schedule

| Phase | Tests | Trigger |
|-------|-------|---------|
| Pre-commit | Unit tests | Git hook |
| PR | Unit + Integration | CI pipeline |
| Nightly | Full suite | Scheduled |
| Release | Full + Manual | Before deploy |

---

## 9. Acceptance Criteria

### Must Pass (Critical)
- All BE-00x tests
- All FE-00x tests
- All SEC-00x tests
- PERF-001 ≥ 30fps

### Should Pass (High)
- All DF-00x tests
- All PERF-02x within maximum
- All REL-00x tests

### May Fail (Medium)
- PERF targets (can meet minimum)
- Some GPU-00x on edge cases
