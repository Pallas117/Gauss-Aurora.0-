import type { Page } from "@playwright/test";

const NOW = new Date().toISOString();

const MOCK_CANONICAL = {
  timestamp: NOW,
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
    etaEarthArrival: new Date(Date.now() + 28 * 60 * 1000).toISOString(),
  },
  alerts: { stormTier: "warning", reason: "Sustained southward IMF with elevated coupling; r0=8.77 Re" },
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

const MOCK_MMS = {
  timestamp: NOW,
  barycenterGsmRe: { x: 9.1, y: 1.6, z: -0.4 },
  currentDensity: { x: 0.07, y: 0.24, z: -0.18, magnitude: 0.31 },
  normal: { x: -0.83, y: 0.41, z: 0.37 },
  lmn: {
    l: { x: 0.92, y: 0.14, z: -0.36 },
    m: { x: -0.11, y: 0.90, z: 0.42 },
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

const MOCK_AURORA = {
  timestamp: NOW,
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

const MOCK_THREATS = {
  timestamp: NOW,
  source: "supabase",
  lookbackMs: 1800000,
  count: 96,
  gate: {
    is_urgent: true,
    action: "TRIGGER_LLM",
    confidence: 89.3,
    reason: "Threat fusion triggered",
    flux_proxy: 0.00021,
    flux_latest: 0.00022,
    flux_mean: 0.0002,
    flux_max: 0.00024,
  },
  summary: {
    threat_count: 4,
    actionable_threat_count: 2,
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
      factors: [
        { name: "Active Region Complexity", weight: 0.5, value: 4.1, contribution: 0.89 },
      ],
      composite_score: 0.81,
      actionable: true,
      recommended_action: "IMMEDIATE SOLAR_FLARE EVASION",
    },
    {
      id: "th-2",
      type: "collision",
      probability: 0.58,
      confidence_interval: [0.43, 0.72],
      factors: [
        { name: "Distance", weight: 0.3, value: 4.8, contribution: 0.62 },
      ],
      composite_score: 0.58,
      actionable: false,
      recommended_action: "MONITOR COLLISION CLOSELY",
    },
  ],
};

const MOCK_SOURCE_STATUS = [
  {
    source: "noaa-swpc",
    lastSeen: NOW,
    latencySeconds: 14,
    healthy: true,
    message: "NOAA SWPC OK",
  },
  {
    source: "mms-cdaweb",
    lastSeen: NOW,
    latencySeconds: 21,
    healthy: true,
    message: "Fetched 4/4 MMS spacecraft",
  },
];

const MOCK_DASHBOARD = {
  timestamp: NOW,
  source: "supabase",
  canonicalLatest: MOCK_CANONICAL,
  mmsLatest: MOCK_MMS,
  auroraLatest: MOCK_AURORA,
  threatSummary: MOCK_THREATS,
  sourceStatus: MOCK_SOURCE_STATUS,
  freshness: {
    canonicalAgeSeconds: 2.1,
    mmsAgeSeconds: 1.5,
    auroraAgeSeconds: 3.7,
  },
  auth: {
    role: "operator",
    clearance: "mission",
    userId: "mock-user-id",
  },
};

const MOCK_ONBOARDING = {
  deviceStepDone: true,
  planStepDone: true,
  completed: true,
  completedAt: NOW,
};

const MOCK_RISK_ZONES = {
  riskZones: [
    {
      orbitType: "GEO",
      altitudeKm: 35786,
      latitudeDeg: 0,
      longitudeDeg: 98,
      riskScore: 0.74,
      objectCount: 22,
    },
    {
      orbitType: "MEO",
      altitudeKm: 20180,
      latitudeDeg: 12,
      longitudeDeg: -30,
      riskScore: 0.51,
      objectCount: 13,
    },
  ],
  updatedAt: NOW,
};

const MOCK_SATELLITE_A = {
  noradId: "10001",
  name: "SAT-A",
  orbitType: "GEO",
  altitudeKm: 35786,
  latitudeDeg: 0,
  longitudeDeg: 98,
  highValue: true,
  unidentified: false,
} as const;

const MOCK_SATELLITE_B = {
  noradId: "10002",
  name: "OBJ-X",
  orbitType: "MEO",
  altitudeKm: 20180,
  latitudeDeg: 12,
  longitudeDeg: -30,
  highValue: false,
  unidentified: true,
} as const;

const MOCK_SATELLITES = {
  objects: [MOCK_SATELLITE_A, MOCK_SATELLITE_B],
  highValue: [MOCK_SATELLITE_A],
  unidentified: [MOCK_SATELLITE_B],
  updatedAt: NOW,
};

const MOCK_SPACE_DOMAIN = {
  snapshot: {
    updatedAt: NOW,
    riskZones: MOCK_RISK_ZONES,
    satellites: MOCK_SATELLITES,
    conjunctions: {
      updatedAt: NOW,
      count: 3,
    },
  },
  summary: {
    updatedAt: NOW,
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
      conjunctionCount: 3,
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
        conjunctionCount: 3,
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
        { name: "conjunctionCount", weight: 0.31, value: 3, contribution: 0.19 },
        { name: "geoCrowdingScore", weight: 0.22, value: 0.74, contribution: 0.16 },
      ],
    },
  },
  analysis: {
    generatedAt: NOW,
    cadenceSeconds: 30,
    source: "deterministic",
    severity: "warning",
    headline: "Elevated orbital risk requires attention",
    summary:
      "Elevated SSA pressure detected: learned lane 63%, catalog risk 74%, and 3 conjunctions under watch.",
    confidence: 0.82,
    changed: true,
    changedSignals: ["conjunction-count", "collision-probability"],
    metrics: {
      learnedLaneScore: 0.63,
      maxRiskScore: 0.74,
      maxCollisionProbability: 0.0024,
      minMissDistanceM: 145,
      conjunctionCount: 3,
    },
    model: {
      used: false,
      modelId: null,
      generatedAt: null,
    },
  },
};

const MOCK_TURING_SUMMARY = {
  total: 1,
  healthy: 1,
  stale: 0,
  offline: 0,
  pending: 0,
  generated_at: NOW,
};

const MOCK_SURYA_FORECAST = {
  forecast: [
    { time: NOW, value: 0.42 },
    { time: new Date(Date.now() + 10 * 60 * 1000).toISOString(), value: 0.47 },
  ],
  model: "surya-stub",
  horizonHours: 12,
};

const MOCK_RAG_STATUS = {
  ok: true,
  chunkCount: 12,
};

const MOCK_RAG_QUERY = {
  ok: true,
  answer: "Synthetic answer from Playwright mock.",
  sources: [{ filePath: "/tmp/mock-source.pdf", score: 0.98 }],
};

const MOCK_OPS_COMMAND = {
  updatedAt: NOW,
  session: {
    authRequired: true,
    authenticated: true,
    role: "operator",
    clearance: "mission",
    userId: "mock-user-id",
    email: "operator@example.com",
    emailVerified: true,
  },
  sourceStatus: MOCK_SOURCE_STATUS,
  canonicalLatest: MOCK_CANONICAL,
  mmsLatest: MOCK_MMS,
  auroraLatest: MOCK_AURORA,
  threatSummary: MOCK_THREATS,
  cybertigerStatus: {
    enabled: true,
    counters: {
      totalInspected: 812,
      blocked: 6,
      signatureHits: 2,
      rateLimited: 4,
      authFailures: 3,
      activeBlocks: 1,
      storedEvents: 75,
    },
    activeBlocks: [
      {
        ip: "127.0.0.1",
        until: NOW,
        reason: "rate-limit",
      },
    ],
  },
  statusChips: [
    { id: "feed", label: "feed", tone: "ok", value: "supabase" },
    { id: "gate", label: "gate", tone: "critical", value: "TRIGGER_LLM" },
  ],
};

const MOCK_OPS_COMMAND_METRICS = {
  metrics: {
    queue_depth: 2,
    planner_latency_avg_ms: 184,
    execution_total: 12,
    execution_succeeded_total: 11,
    battery_throttle_hits_total: 0,
  },
  planner_circuit: {
    open: false,
    open_until: null,
    consecutive_failures: 0,
  },
};

export async function mockUiApis(page: Page): Promise<void> {
  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "*",
  };

  const fulfillCorsJson = async (
    route: Parameters<Parameters<Page["route"]>[1]>[0],
    body: unknown,
    status = 200,
  ) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: corsHeaders,
      });
      return;
    }

    await route.fulfill({
      status,
      contentType: "application/json",
      headers: corsHeaders,
      body: JSON.stringify(body),
    });
  };

  // Register catch-all first; Playwright applies the most recently added matching route.
  // This allows specific endpoint mocks below to override this fallback.
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    console.warn("Unmocked API request intercepted:", route.request().url());
    await fulfillCorsJson(route, { mocked: "catch-all" }, 200);
  });

  await page.route(/\/api\/auth\/session/, async (route) => {
    await fulfillCorsJson(route, MOCK_OPS_COMMAND.session);
  });

  await page.route(/\/api\/auth\/onboarding/, async (route) => {
    await fulfillCorsJson(route, MOCK_ONBOARDING);
  });

  await page.route(/\/api\/ssa\/risk-zones/, async (route) => {
    await fulfillCorsJson(route, MOCK_RISK_ZONES);
  });

  await page.route(/\/api\/ssa\/satellites/, async (route) => {
    await fulfillCorsJson(route, MOCK_SATELLITES);
  });

  await page.route(/\/api\/ssa\/space-domain/, async (route) => {
    await fulfillCorsJson(route, MOCK_SPACE_DOMAIN);
  });

  await page.route(/\/api\/turing\/devices\/summary/, async (route) => {
    await fulfillCorsJson(route, MOCK_TURING_SUMMARY);
  });

  await page.route(/\/api\/ai\/surya\/forecast/, async (route) => {
    await fulfillCorsJson(route, MOCK_SURYA_FORECAST);
  });

  await page.route(/\/api\/rag\/status/, async (route) => {
    await fulfillCorsJson(route, MOCK_RAG_STATUS);
  });

  await page.route(/\/api\/rag\/index/, async (route) => {
    await fulfillCorsJson(route, { ok: true });
  });

  await page.route(/\/api\/rag\/query/, async (route) => {
    await fulfillCorsJson(route, MOCK_RAG_QUERY);
  });

  await page.route(/\/api\/ops\/command\/latest/, async (route) => {
    await fulfillCorsJson(route, MOCK_OPS_COMMAND);
  });

  await page.route(/\/api\/ops\/command\/metrics/, async (route) => {
    await fulfillCorsJson(route, MOCK_OPS_COMMAND_METRICS);
  });

  const MOCK_MISSION_CORE = {
    timestamp: NOW,
    source: "supabase",
    observation: {
      refs: [],
      canonicalLatest: MOCK_CANONICAL,
      mmsLatest: MOCK_MMS,
      auroraLatest: MOCK_AURORA,
      sourceStatus: MOCK_SOURCE_STATUS,
      freshness: {
        canonicalAgeSeconds: 2.1,
        mmsAgeSeconds: 1.5,
        auroraAgeSeconds: 3.7,
      },
    },
    tracks: [],
    threats: MOCK_THREATS.threats,
    passes: [],
    commands: [],
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

  await page.route(/\/api\/mission\/core\/latest/, async (route) => {
    await fulfillCorsJson(route, MOCK_MISSION_CORE);
  });

  await page.route(/\/api\/feed\/dashboard\/latest/, async (route) => {
    await fulfillCorsJson(route, MOCK_DASHBOARD);
  });

  await page.route(/\/api\/feed\/threats\/latest/, async (route) => {
    await fulfillCorsJson(route, MOCK_THREATS);
  });

  await page.route(/\/api\/feed\/space-weather\/5s/, async (route) => {
    await fulfillCorsJson(route, {
      source: "supabase",
      count: 1,
      points: [MOCK_CANONICAL],
    });
  });

  await page.route(/\/api\/feed\/mms\/reconnection/, async (route) => {
    await fulfillCorsJson(route, {
      source: "supabase",
      count: 1,
      vectors: [MOCK_MMS],
    });
  });

  await page.route(/\/api\/feed\/aurora\/map/, async (route) => {
    await fulfillCorsJson(route, MOCK_AURORA);
  });

  await page.route(/\/api\/security\/cybertiger\/status/, async (route) => {
    await fulfillCorsJson(route, {
      timestamp: NOW,
      status: MOCK_OPS_COMMAND.cybertigerStatus,
    });
  });

  await page.route(/\/health/, async (route) => {
    await fulfillCorsJson(route, {
      ok: true,
      timestamp: NOW,
      memory: {
        level: "nominal",
        freeMb: 4096,
        suspendedSubsystems: [],
        svgLiteForced: false,
        deepseekMode: "auto",
      },
    });
  });

  await page.route(/\/api\/ai\/nowcast\/infer/, async (route) => {
    await fulfillCorsJson(route, {
      modelVersion: "test",
      generatedAt: NOW,
      horizonMinutes: 30,
      predictions: [
        {
          timestamp: NOW,
          geomagneticPerturbation: 44,
          auroraIntensity: 0.61,
          confidence: 0.84,
        },
      ],
    });
  });

  await page.route(/\/api\/feedback/, async (route) => {
    await fulfillCorsJson(
      route,
      {
        ok: true,
        id: "feedback-test-id",
        submittedAt: NOW,
      },
      201,
    );
  });

}
