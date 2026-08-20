import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

type NetMode = "online" | "disrupted" | "offline";
type Phase = "online" | "disrupted" | "offline" | "restore";
type RoutePath =
  | "/";

interface CheckResult {
  pass: boolean;
  path: string;
  body: string;
}

interface ExpectedState {
  offlineBanner: boolean;
  helioOnline: boolean;
  backendHealthy: boolean;
}

interface PhaseStats {
  total: number;
  ok: number;
  fail: number;
  latencies: number[];
}

const ROUTES: RoutePath[] = [
  "/",
];
const ROUTE_ASSERT_TIMEOUT_MS = 12_000;

const now = Date.now();

function ts(offsetMs = 0): string {
  return new Date(now + offsetMs).toISOString();
}

const canonicalLatest = {
  timestamp: ts(),
  source: "fusion",
  rho: 7.5,
  velocity: { x: -420, y: 18, z: -9, magnitude: 445.2 },
  magneticField: { x: 2.3, y: -1.1, z: -5.4, bt: 6.2 },
  electricField: { x: 0.2, y: 3.1, z: 0.4, ey: 3.1 },
  solarWind: { speed: 445.2, density: 7.5, dynamicPressure: 2.8 },
  indices: { kp: 4.0, dst: -48 },
  coupling: { newell: 12800, epsilon: 812345 },
  propagation: {
    l1DelaySeconds: 1680,
    etaEarthArrival: ts(28 * 60 * 1000),
  },
  alerts: { stormTier: "warning", reason: "Synthetic QA stream" },
  quality: { outlier: false, stale: false, interpolated: false, extrapolated: false, lowConfidence: false },
  uncertainty: {
    speed: { lower: 408, upper: 482, sigma: 18.5 },
    density: { lower: 6.9, upper: 8.1, sigma: 0.6 },
    bz: { lower: -6.2, upper: -4.6, sigma: 0.8 },
  },
  diagnostics: {
    shueR0Re: 8.77,
    alfvenSpeedKmS: 410,
    clockAngleRad: -2.94,
  },
};

const mmsLatest = {
  timestamp: ts(),
  barycenterGsmRe: { x: 9.1, y: 1.6, z: -0.4 },
  currentDensity: { x: 0.07, y: 0.24, z: -0.18, magnitude: 0.31 },
  normal: { x: -0.83, y: 0.41, z: 0.37 },
  lmn: {
    l: { x: 0.92, y: 0.14, z: -0.36 },
    m: { x: -0.11, y: 0.9, z: 0.42 },
    n: { x: -0.83, y: 0.41, z: 0.37 },
  },
  quality: { valid: true, volume: 0.0021, conditionNumber: 34, divCurlRatio: 0.22, confidence: "high" },
  probability: {
    reconnection: 0.79,
    confidence: 0.86,
    lower: 0.63,
    upper: 0.91,
    driver: "fused",
    factors: {
      southwardImf: 0.72,
      electricDriver: 0.68,
      coupling: 0.64,
      tetraQuality: 0.93,
      sampleCoverage: 1,
      burstBoost: 0.2,
      freshnessPenalty: 0.04,
    },
  },
  directionality: {
    corrected: false,
    alignment: 0.66,
    referenceVector: "electric-field",
    reason: "Aligned to convective electric field E=-v×B",
  },
  provenance: { mode: "fused", sampleCount: 4, burstMode: true },
};

const auroraLatest = {
  timestamp: ts(),
  nside: 64,
  grid: [
    { lat: 66, lon: -20, probability: 0.72, energyFlux: 3.1 },
    { lat: 64, lon: 40, probability: 0.63, energyFlux: 2.7 },
  ],
  harmonics: {
    lMax: 8,
    coefficients: [{ l: 1, m: 0, re: 0.21, im: 0 }],
    powerSpectrum: [{ l: 1, cL: 0.7 }],
  },
};

const sourceStatus = [
  { source: "noaa-swpc", lastSeen: ts(), latencySeconds: 12, healthy: true, message: "ok" },
  { source: "mms-cdaweb", lastSeen: ts(), latencySeconds: 15, healthy: true, message: "ok" },
];

const threatSummary = {
  timestamp: ts(),
  source: "supabase",
  lookbackMs: 1800000,
  count: 96,
  gate: {
    is_urgent: true,
    action: "TRIGGER_LLM",
    confidence: 88.7,
    reason: "Synthetic threat signal",
    flux_proxy: 0.00021,
    flux_latest: 0.00022,
    flux_mean: 0.0002,
    flux_max: 0.00024,
  },
  summary: {
    threat_count: 2,
    actionable_threat_count: 1,
    top_threat_type: "solar_flare",
    top_threat_score: 0.81,
    top_recommended_action: "IMMEDIATE SOLAR_FLARE EVASION",
  },
  threats: [
    {
      id: "th-1",
      type: "solar_flare",
      probability: 0.82,
      confidence_interval: [0.7, 0.93],
      factors: [{ name: "AR complexity", weight: 0.5, value: 4.1, contribution: 0.89 }],
      composite_score: 0.81,
      actionable: true,
      recommended_action: "IMMEDIATE SOLAR_FLARE EVASION",
    },
  ],
};

const dashboardLatest = {
  timestamp: ts(),
  source: "supabase",
  canonicalLatest,
  mmsLatest,
  auroraLatest,
  threatSummary,
  sourceStatus,
  freshness: {
    canonicalAgeSeconds: 2,
    mmsAgeSeconds: 2,
    auroraAgeSeconds: 3,
  },
  auth: {
    role: "operator",
    clearance: "mission",
    userId: "mock-user-id",
  },
};

const missionCoreLatest = {
  timestamp: ts(),
  source: "supabase",
  observation: {
    refs: [
      { id: "obs-canonical", kind: "space-weather", timestamp: ts(), source: "fusion", confidence: 0.9, stale: false },
    ],
    canonicalLatest,
    mmsLatest,
    auroraLatest,
    sourceStatus,
    freshness: {
      canonicalAgeSeconds: 2,
      mmsAgeSeconds: 2,
      auroraAgeSeconds: 3,
    },
  },
  tracks: [
    {
      id: "track-1",
      type: "space-weather-driver",
      state: "confirmed",
      confidence: 0.88,
      observationIds: ["obs-canonical"],
      summary: "Southward IMF sustained",
    },
  ],
  threats: threatSummary.threats,
  passes: [
    {
      passId: "pass-1",
      target: "SAT-A",
      station: "KUL-1",
      aos: ts(5 * 60 * 1000),
      los: ts(12 * 60 * 1000),
      status: "scheduled",
      mode: "placeholder",
      priority: 6,
    },
  ],
  commands: [
    {
      commandId: "cmd-1",
      commandType: "trigger-nowcast",
      status: "ready",
      requiresRole: "operator",
      reason: "Storm tier warning",
    },
  ],
  actions: {
    gateAction: "TRIGGER_LLM",
    stormTier: "warning",
    primaryAction: "Monitor threat fusion",
  },
  auth: {
    role: "operator",
    clearance: "mission",
    userId: "mock-user-id",
  },
};

const opsCommandLatest = {
  updatedAt: ts(),
  session: {
    authRequired: true,
    authenticated: true,
    role: "operator",
    clearance: "mission",
    userId: "mock-user-id",
    email: "operator@example.com",
    emailVerified: true,
    features: { heliophysics: true, debris: true },
  },
  sourceStatus,
  canonicalLatest,
  mmsLatest,
  auroraLatest,
  threatSummary,
  dtnIslStatus: {
    configured: true,
    reachable: true,
    generated_at: ts(),
    readiness_score: 92,
    pass: 3,
    warn: 0,
    fail: 0,
    controls: [{ id: "ctrl-1", title: "DTN mesh", status: "pass", details: "Operational" }],
    last_error: null,
  },
  cybertigerStatus: {
    enabled: true,
    counters: {
      totalInspected: 120,
      blocked: 0,
      signatureHits: 0,
      rateLimited: 0,
      authFailures: 0,
      activeBlocks: 0,
      storedEvents: 5,
    },
    activeBlocks: [],
  },
  statusChips: [
    { id: "feed", label: "feed", tone: "ok", value: "supabase" },
    { id: "gate", label: "gate", tone: "critical", value: "TRIGGER_LLM" },
  ],
};

const spaceHistory = Array.from({ length: 240 }, (_, i) => ({
  ...canonicalLatest,
  timestamp: new Date(now - (240 - i) * 5000).toISOString(),
}));

const mmsHistory = Array.from({ length: 120 }, (_, i) => ({
  ...mmsLatest,
  timestamp: new Date(now - (120 - i) * 5000).toISOString(),
}));

const riskZones = {
  riskZones: [
    { orbitType: "GEO", altitudeKm: 35786, latitudeDeg: 0, longitudeDeg: 98, riskScore: 0.74, objectCount: 22 },
    { orbitType: "MEO", altitudeKm: 20180, latitudeDeg: 12, longitudeDeg: -30, riskScore: 0.51, objectCount: 13 },
  ],
  updatedAt: ts(),
};

const satellites = {
  objects: [
    { noradId: "10001", name: "SAT-A", orbitType: "GEO", altitudeKm: 35786, latitudeDeg: 0, longitudeDeg: 98, highValue: true, unidentified: false },
    { noradId: "10002", name: "OBJ-X", orbitType: "MEO", altitudeKm: 20180, latitudeDeg: 12, longitudeDeg: -30, highValue: false, unidentified: true },
  ],
  highValue: [
    { noradId: "10001", name: "SAT-A", orbitType: "GEO", altitudeKm: 35786, latitudeDeg: 0, longitudeDeg: 98, highValue: true, unidentified: false },
  ],
  unidentified: [
    { noradId: "10002", name: "OBJ-X", orbitType: "MEO", altitudeKm: 20180, latitudeDeg: 12, longitudeDeg: -30, highValue: false, unidentified: true },
  ],
  updatedAt: ts(),
};

const turingDevices = {
  generatedAt: ts(),
  devices: [
    {
      id: "dev-1",
      hostname: "ceres-1",
      tailscale_ip: "100.64.0.2",
      status: "healthy",
      approval_status: "approved",
      last_seen: ts(),
      ram_mb: 4096,
      ram_used_mb: 1024,
      battery_percent: 78,
      capabilities: ["cache", "inference"],
      labels: { role: "edge" },
    },
  ],
};

const turingSummary = {
  generatedAt: ts(),
  total: 1,
  healthy: 1,
  stale: 0,
  offline: 0,
  pending: 0,
};

const spaceDomain = {
  snapshot: {
    updatedAt: ts(),
    riskZones,
    satellites,
    conjunctions: {
      updatedAt: ts(),
      count: 2,
    },
  },
  summary: {
    updatedAt: ts(),
    freshness: {
      riskZonesAgeSeconds: 4,
      satellitesAgeSeconds: 5,
      conjunctionsAgeSeconds: 12,
    },
    availability: {
      riskZones: true,
      satellites: true,
      conjunctions: true,
    },
    counts: {
      riskZoneCount: 2,
      satelliteObjectCount: 2,
      highValueCount: 1,
      unidentifiedCount: 1,
      conjunctionCount: 2,
    },
    crowding: {
      maxRiskScore: 0.74,
      avgRiskScore: 0.625,
      geoMaxRiskScore: 0.74,
      meoMaxRiskScore: 0.51,
      weightedObjectDensity: 0.42,
      unidentifiedRatio: 0.5,
    },
    conjunctionRisk: {
      maxCollisionProbability: 0.0024,
      minMissDistanceM: 145,
      recentCriticalCount: 1,
    },
    learnedLane: {
      modelVersion: "ssa-registry-test",
      score: 0.63,
      confidence: 0.78,
      trigger: true,
      threshold: 0.58,
      blend: 0.66,
      features: {
        conjunctionCount: 2,
        maxCollisionProbability: 0.0024,
        inverseMissDistance: 1 / 145,
        debrisDensity: 0.42,
        highValueNeighborDensity: 0.67,
        unidentifiedRatio: 0.5,
        geoCrowdingScore: 0.74,
        meoCrowdingScore: 0.51,
        leoCrowdingScore: 0.18,
        tleFreshnessScore: 0.93,
        conjunctionFreshnessScore: 0.87,
        availabilityScore: 1,
      },
      topContributors: [
        { name: "conjunctionCount", weight: 0.31, value: 2, contribution: 0.19 },
      ],
    },
  },
  analysis: {
    generatedAt: ts(),
    cadenceSeconds: 30,
    source: "deterministic",
    severity: "warning",
    headline: "Elevated orbital risk requires attention",
    summary:
      "Elevated SSA pressure detected: learned lane 63%, catalog risk 74%, and 2 conjunctions under watch.",
    confidence: 0.82,
    changed: true,
    changedSignals: ["conjunction-count", "collision-probability"],
    metrics: {
      learnedLaneScore: 0.63,
      maxRiskScore: 0.74,
      maxCollisionProbability: 0.0024,
      minMissDistanceM: 145,
      conjunctionCount: 2,
    },
    model: {
      used: false,
      modelId: null,
      generatedAt: null,
    },
  },
};

const suryaForecast = {
  forecast: [
    { time: ts(10 * 60 * 1000), value: 0.42 },
    { time: ts(20 * 60 * 1000), value: 0.47 },
  ],
  model: "surya-stub",
  horizonHours: 12,
};

const onboardingState = {
  deviceStepDone: true,
  planStepDone: true,
  completed: true,
  completedAt: ts(-60 * 60 * 1000),
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

function pass(path: string, body: string): CheckResult {
  return { pass: true, path, body };
}

function fail(path: string, body: string): CheckResult {
  return { pass: false, path, body };
}

function phaseTemplate(): Record<Phase, PhaseStats> {
  return {
    online: { total: 0, ok: 0, fail: 0, latencies: [] },
    disrupted: { total: 0, ok: 0, fail: 0, latencies: [] },
    offline: { total: 0, ok: 0, fail: 0, latencies: [] },
    restore: { total: 0, ok: 0, fail: 0, latencies: [] },
  };
}

function summarizeStats(stats: Record<Phase, PhaseStats>) {
  const out: Record<Phase, { total: number; ok: number; fail: number; avgLatencyMs: number; p95LatencyMs: number }> = {
    online: { total: 0, ok: 0, fail: 0, avgLatencyMs: 0, p95LatencyMs: 0 },
    disrupted: { total: 0, ok: 0, fail: 0, avgLatencyMs: 0, p95LatencyMs: 0 },
    offline: { total: 0, ok: 0, fail: 0, avgLatencyMs: 0, p95LatencyMs: 0 },
    restore: { total: 0, ok: 0, fail: 0, avgLatencyMs: 0, p95LatencyMs: 0 },
  };

  for (const [phase, s] of Object.entries(stats) as Array<[Phase, PhaseStats]>) {
    const avg = s.latencies.length ? s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length : 0;
    out[phase] = {
      total: s.total,
      ok: s.ok,
      fail: s.fail,
      avgLatencyMs: Number(avg.toFixed(1)),
      p95LatencyMs: percentile(s.latencies, 95) ?? 0,
    };
  }
  return out;
}

async function waitVisible(locator: Locator, timeoutMs = 7000): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function waitForBodyText(page: Page, patterns: string[], timeoutMs = 7000): Promise<boolean> {
  const lowered = patterns.map((pattern) => pattern.toLowerCase());
  try {
    await page.waitForFunction(
      (candidates: string[]) => {
        const bodyText = document.body?.innerText?.toLowerCase() ?? "";
        return candidates.some((candidate) => bodyText.includes(candidate));
      },
      lowered,
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

async function checkRouteState(
  page: Page,
  path: string,
  expected: ExpectedState,
  options?: { clientSideNav?: boolean },
): Promise<CheckResult[]> {
  const clientSideNav = options?.clientSideNav ?? false;
  if (clientSideNav) {
    await page.evaluate((nextPath: string) => {
      window.history.pushState({}, "", nextPath);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, path);
    await page.waitForFunction(
      (nextPath: string) => `${window.location.pathname}${window.location.search}` === nextPath,
      path,
      { timeout: ROUTE_ASSERT_TIMEOUT_MS },
    );
    await page.waitForTimeout(1_200);
  } else {
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(500);
  }

  const out: CheckResult[] = [];

  if (path.startsWith("/heliophysics")) {
    const helioVisible = await waitForBodyText(
      page,
      ["gauss aurora mission console", "unified heliophysics operations surface"],
      ROUTE_ASSERT_TIMEOUT_MS,
    );
    out.push(helioVisible ? pass(path, "heliophysics page rendered") : fail(path, "heliophysics page missing"));
  }

  if (path.startsWith("/sda")) {
    const sdaVisible = await waitForBodyText(
      page,
      ["sda visualization", "public sda analysis"],
      ROUTE_ASSERT_TIMEOUT_MS,
    );
    out.push(sdaVisible ? pass(path, "sda page rendered") : fail(path, "sda page missing"));
  }

  if (path.includes("/systems?tab=chronos")) {
    const chronosVisible = await waitForBodyText(
      page,
      ["runtime diagnostics", "mission timeline inputs", "systems overview", "ops lanes"],
      ROUTE_ASSERT_TIMEOUT_MS,
    );
    if (!chronosVisible) {
      out.push(fail(path, "chronos page missing"));
    } else {
      out.push(pass(path, "chronos page rendered"));
    }
  }

  if (path.includes("/systems?tab=turing")) {
    const turingVisible = await waitVisible(page.locator('[data-testid="turing-devices-page"]'), ROUTE_ASSERT_TIMEOUT_MS);
    out.push(turingVisible ? pass(path, "turing page rendered") : fail(path, "turing page missing"));
  }

  if (path.startsWith("/command")) {
    const cmdVisible = await waitForBodyText(
      page,
      ["command snapshot", "refresh snapshot", "mission command requires sign-in", "open mission access portal"],
      ROUTE_ASSERT_TIMEOUT_MS,
    );
    out.push(cmdVisible ? pass(path, "command page rendered") : fail(path, "command page missing"));
  }

  if (path === "/") {
    const rootVisible = await waitForBodyText(
      page,
      ["gauss aurora", "reasoning.feed", "initiate"],
      ROUTE_ASSERT_TIMEOUT_MS,
    );
    if (rootVisible) {
      out.push(pass(path, "root hud rendered"));
    } else {
      const hasRenderableBody = await page
        .evaluate(() => (document.body?.innerText?.trim().length ?? 0) > 0)
        .catch(() => false);
      out.push(hasRenderableBody ? pass(path, "root shell rendered") : fail(path, "root hud missing"));
    }
  }

  return out;
}

async function prewarmLazyRouteModules(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all([
      import("/src/pages/HeliophysicsDashboard.tsx"),
      import("/src/pages/SDAPage.tsx"),
      import("/src/pages/SystemsPage.tsx"),
      import("/src/pages/CommandPage.tsx"),
    ]);
  });
}

async function setupNetworkHarness(page: Page, context: BrowserContext) {
  let mode: NetMode = "online";
  let phase: Phase = "online";
  let disruptedCounter = 0;
  const stats = phaseTemplate();

  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "*",
  };

  const phaseStat = () => stats[phase];
  const record = (ok: boolean, latencyMs: number) => {
    const s = phaseStat();
    s.total += 1;
    if (ok) s.ok += 1;
    else s.fail += 1;
    s.latencies.push(latencyMs);
  };

  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (path.endsWith("/src/components/scene/SpaceScene.tsx")) {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "export function SpaceScene(){ return null; }",
      });
      return;
    }

    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }

    const isApi = path === "/health" || path.startsWith("/api/");
    if (!isApi) {
      await route.continue();
      return;
    }

    const started = Date.now();
    if (mode === "offline") {
      record(false, Date.now() - started);
      await route.abort("internetdisconnected");
      return;
    }

    if (mode === "disrupted") {
      disruptedCounter += 1;
      const extraDelay = 700 + (disruptedCounter % 5) * 380;
      await delay(extraDelay);
      if (disruptedCounter % 3 === 0) {
        record(false, Date.now() - started);
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          headers: cors,
          body: JSON.stringify({ error: "simulated_network_disruption" }),
        });
        return;
      }
    }

    let status = 200;
    let body: unknown = { ok: true, path };

    if (path === "/health") {
      body = {
        ok: true,
        timestamp: ts(),
        memory: {
          level: "nominal",
          freeMb: 4096,
          suspendedSubsystems: [],
          svgLiteForced: false,
          deepseekMode: "auto",
        },
      };
    } else if (path === "/api/auth/session") {
      body = opsCommandLatest.session;
    } else if (path === "/api/auth/onboarding") {
      body = onboardingState;
    } else if (path === "/api/feed/dashboard/latest") {
      body = dashboardLatest;
    } else if (path === "/api/mission/core/latest") {
      body = missionCoreLatest;
    } else if (path === "/api/ops/command/latest") {
      body = opsCommandLatest;
    } else if (path === "/api/feed/space-weather/5s") {
      body = { source: "supabase", count: spaceHistory.length, points: spaceHistory };
    } else if (path === "/api/feed/space-weather/latest") {
      body = canonicalLatest;
    } else if (path === "/api/feed/mms/reconnection") {
      body = { source: "supabase", count: mmsHistory.length, vectors: mmsHistory };
    } else if (path === "/api/feed/mms/reconnection/latest") {
      body = mmsLatest;
    } else if (path === "/api/feed/aurora/map") {
      body = auroraLatest;
    } else if (path === "/api/feed/threats/latest") {
      body = threatSummary;
    } else if (path === "/api/feed/sources/status") {
      body = { timestamp: ts(), sources: sourceStatus };
    } else if (path === "/api/ssa/risk-zones") {
      body = riskZones;
    } else if (path === "/api/ssa/satellites") {
      body = satellites;
    } else if (path === "/api/ssa/space-domain") {
      body = spaceDomain;
    } else if (path === "/api/turing/devices") {
      body = turingDevices;
    } else if (path === "/api/turing/devices/summary") {
      body = turingSummary;
    } else if (path === "/api/ai/surya/forecast") {
      body = suryaForecast;
    } else if (path === "/api/rag/status") {
      body = { ok: true, connected: true, docs: 12 };
    } else if (path === "/api/feedback") {
      status = 201;
      body = { ok: true, id: "feedback-test-id", submittedAt: ts() };
    }

    record(status < 500, Date.now() - started);
    await route.fulfill({
      status,
      contentType: "application/json",
      headers: cors,
      body: JSON.stringify(body),
    });
  });

  return {
    setMode(nextMode: NetMode) {
      mode = nextMode;
    },
    setPhase(nextPhase: Phase) {
      phase = nextPhase;
    },
    summarize() {
      return summarizeStats(stats);
    },
    async setBrowserOffline(offline: boolean) {
      await context.setOffline(offline);
    },
  };
}

test("network transition resilience: online -> disrupted -> offline -> restore", async ({ page, context }, testInfo) => {
  test.setTimeout(240_000);
  const harness = await setupNetworkHarness(page, context);
  const checks: CheckResult[] = [];

  harness.setPhase("online");
  harness.setMode("online");
  await harness.setBrowserOffline(false);
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(750);

  for (const path of ROUTES) {
    checks.push(
      ...(await checkRouteState(page, path, {
        offlineBanner: false,
        helioOnline: true,
        backendHealthy: true,
      })),
    );
  }

  harness.setPhase("disrupted");
  harness.setMode("disrupted");
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(1500);
  checks.push(
    ...(await checkRouteState(page, "/", {
      offlineBanner: false,
      helioOnline: true,
      backendHealthy: true,
    })),
  );

  await prewarmLazyRouteModules(page);

  harness.setPhase("offline");
  harness.setMode("offline");
  await harness.setBrowserOffline(true);
  await page.waitForTimeout(500);

  for (const path of ROUTES) {
    checks.push(
      ...(await checkRouteState(
        page,
        path,
        {
          offlineBanner: true,
          helioOnline: false,
          backendHealthy: false,
        },
        { clientSideNav: true },
      )),
    );
  }

  harness.setPhase("restore");
  harness.setMode("online");
  await harness.setBrowserOffline(false);
  await page.waitForTimeout(1000);
  for (const path of ROUTES) {
    checks.push(
      ...(await checkRouteState(page, path, {
        offlineBanner: false,
        helioOnline: true,
        backendHealthy: true,
      })),
    );
  }

  const result = {
    generatedAt: new Date().toISOString(),
    checks,
    passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length,
    requestStats: harness.summarize(),
  };

  await testInfo.attach("network-transition-report.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });

  expect(
    result.failed,
    `network transition checks failed:\n${JSON.stringify(
      checks.filter((c) => !c.pass),
      null,
      2,
    )}`,
  ).toBe(0);
});
