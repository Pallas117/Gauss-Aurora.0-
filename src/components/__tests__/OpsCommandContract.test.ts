import { parseOpsCommandSnapshotResponse } from "@/lib/contracts/ops-command";

describe("ops command contract", () => {
  it("parses aggregate payload shape", () => {
    const now = new Date().toISOString();
    const parsed = parseOpsCommandSnapshotResponse({
      updatedAt: now,
      session: {
        authRequired: true,
        authenticated: true,
        role: "operator",
        clearance: "mission",
        userId: "u1",
        email: "operator@example.com",
        emailVerified: true,
      },
      sourceStatus: [
        {
          source: "noaa-swpc",
          lastSeen: now,
          latencySeconds: 12,
          healthy: true,
        },
      ],
      canonicalLatest: {
        timestamp: now,
        source: "fusion",
        rho: 7.2,
        velocity: { x: -420, y: 18, z: -9, magnitude: 445.2 },
        magneticField: { x: 2.3, y: -1.1, z: -5.4, bt: 6.2 },
        electricField: { x: 0.2, y: 3.1, z: 0.4, ey: 3.1 },
        solarWind: { speed: 445.2, density: 7.5, dynamicPressure: 2.8 },
        indices: { kp: 4, dst: -48 },
        coupling: { newell: 12800, epsilon: 812345 },
        propagation: { l1DelaySeconds: 1680, etaEarthArrival: now },
        alerts: { stormTier: "warning", reason: "mock" },
        quality: {
          outlier: false,
          stale: false,
          interpolated: false,
          extrapolated: false,
          lowConfidence: false,
        },
        uncertainty: {
          speed: { lower: 408, upper: 482, sigma: 18.5 },
          density: { lower: 6.9, upper: 8.1, sigma: 0.6 },
          bz: { lower: -6.2, upper: -4.6, sigma: 0.8 },
        },
      },
      mmsLatest: null,
      auroraLatest: null,
      threatSummary: {
        timestamp: now,
        source: "memory",
        lookbackMs: 1800000,
        count: 24,
        gate: {
          is_urgent: true,
          action: "TRIGGER_LLM",
          confidence: 89.3,
          reason: "mock",
          flux_proxy: 0.1,
          flux_latest: 0.1,
          flux_mean: 0.1,
          flux_max: 0.1,
        },
        summary: {
          threat_count: 1,
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
            factors: [
              { name: "Active Region Complexity", weight: 0.5, value: 4.1, contribution: 0.89 },
            ],
            composite_score: 0.81,
            actionable: true,
            recommended_action: "IMMEDIATE SOLAR_FLARE EVASION",
          },
        ],
      },
      dtnIslStatus: {
        configured: true,
        reachable: true,
        generated_at: now,
        readiness_score: 80,
        pass: 3,
        warn: 0,
        fail: 0,
        controls: [
          { id: "c1", title: "DTN", status: "pass", details: "OK" },
        ],
        last_error: null,
      },
      cybertigerStatus: {
        enabled: true,
      },
      statusChips: [
        { id: "feed", label: "feed", tone: "ok", value: "supabase" },
      ],
      workers: [
        {
          id: "command-planner",
          lane: "runtime",
          enabled: true,
          approval: "operator-gate",
          state: "idle",
          lastRunAt: now,
          lastResult: {
            workerId: "command-planner",
            status: "completed",
            summary: "Planner held steady.",
            autoExecuted: false,
            queuedApproval: false,
            touchedSystems: ["planner"],
            nextTasks: [],
            artifacts: [],
          },
        },
      ],
      queuedApprovals: [],
      brokerPolicy: {
        memoryLevel: "nominal",
        deepseekMode: "auto",
        autoSafeOps: true,
      },
    });

    expect(parsed.session.role).toBe("operator");
    expect(parsed.statusChips?.[0]?.id).toBe("feed");
  });
});
