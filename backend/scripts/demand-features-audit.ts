import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type ControlStatus = "pass" | "warn" | "fail";

type Control = {
  id: string;
  title: string;
  status: ControlStatus;
  details: string;
};

function repoRoot(): string {
  const currentFile = decodeURIComponent(new URL(import.meta.url).pathname);
  return path.resolve(path.dirname(currentFile), "..", "..");
}

function hasFile(relativePath: string): boolean {
  return existsSync(path.join(repoRoot(), relativePath));
}

function fileContains(relativePath: string, pattern: RegExp): boolean {
  const full = path.join(repoRoot(), relativePath);
  if (!existsSync(full)) return false;
  return pattern.test(readFileSync(full, "utf8"));
}

function runChecks(): Control[] {
  const controls: Control[] = [];

  const hasConjunctionModule =
    hasFile("backend/ssa/conjunction-interop.ts") &&
    fileContains("backend/ssa/conjunction-interop.ts", /cdm_kvn|omm_json|oem_json|ocm_json/) &&
    fileContains("backend/ssa/conjunction-interop.ts", /ALLOWED_CONJUNCTION_PURPOSES/) &&
    fileContains("backend/ssa/conjunction-interop.ts", /blocked_keyword|purpose_blocked/i);
  const hasConjunctionRoutes =
    hasFile("backend/routes/conjunction-interop.ts") &&
    fileContains("backend/routes/conjunction-interop.ts", /\/api\/ssa\/conjunctions\/ingest/) &&
    fileContains("backend/routes/conjunction-interop.ts", /\/api\/ssa\/conjunctions\/latest/);
  const mounted = fileContains("backend/server.ts", /mountConjunctionInteropRoutes/);

  controls.push({
    id: "DEMAND-1",
    title: "Conjunction interoperability + ethical purpose gating",
    status: hasConjunctionModule && hasConjunctionRoutes && mounted ? "pass" : "fail",
    details:
      hasConjunctionModule && hasConjunctionRoutes && mounted
        ? "CDM/OMM/OEM/OCM ingest module and SSA conjunction routes are present and mounted with policy checks."
        : "Missing conjunction interop module/route mount or ethical-purpose policy checks.",
  });

  const hasAlertEscalationRoute =
    fileContains("backend/server.ts", /\/api\/alerts\//) ||
    hasFile("backend/routes/alerts.ts") ||
    fileContains("backend/routes/feedback.ts", /webhook|slack|pagerduty|opsgenie|email/i);
  controls.push({
    id: "DEMAND-2",
    title: "Multi-channel alert delivery and escalation",
    status: hasAlertEscalationRoute ? "pass" : "warn",
    details: hasAlertEscalationRoute
      ? "Alert delivery/escalation route(s) detected."
      : "No dedicated alerts subscriptions/webhooks/escalation route detected (Slack/PagerDuty/webhook/email).",
  });

  const hasNetworkTransitionInSweep = fileContains(
    "backend/scripts/orchestrate-tests.ts",
    /network-transition\.spec\.ts/,
  );
  controls.push({
    id: "DEMAND-3",
    title: "Hotspot/offline handover included in full sweep",
    status: hasNetworkTransitionInSweep ? "pass" : "fail",
    details: hasNetworkTransitionInSweep
      ? "Full sweep includes Playwright network transition scenario."
      : "Full sweep is missing tests/e2e/network-transition.spec.ts.",
  });

  const hasOutageFallbackCoverage =
    hasFile("backend/offline-resilience.test.ts") &&
    fileContains("backend/offline-resilience.test.ts", /degrade gracefully|offline|stale/i) &&
    hasFile("tests/e2e/network-transition.spec.ts");
  controls.push({
    id: "DEMAND-4",
    title: "Source outage fallback behavior coverage",
    status: hasOutageFallbackCoverage ? "pass" : "warn",
    details: hasOutageFallbackCoverage
      ? "Offline resilience and network transition tests are present."
      : "Need stronger outage SLO checks and stale-data thresholds in release gates.",
  });

  const hasEnterpriseAssuranceGate =
    fileContains("backend/scripts/full-adherence-audit.ts", /sbom|supply-chain|provenance|key rotation|incident response/i) ||
    fileContains("docs/CYBERTIGER_COMPLIANCE_BASELINE.md", /SBOM|key rotation|Incident response runbooks/i);
  controls.push({
    id: "DEMAND-5",
    title: "Enterprise assurance controls in release gates",
    status: hasEnterpriseAssuranceGate ? "warn" : "warn",
    details:
      "Assurance gaps are documented, but key-rotation/SBOM/signed-artifact checks are not yet hard release gates.",
  });

  const hasBillingAndEntitlementCoverage =
    fileContains("backend/server.ts", /\/api\/stripe\/create-checkout-session/) &&
    fileContains("src/components/onboarding/PlanSelector.tsx", /create-checkout-session/) &&
    fileContains("tests/backend-ai-granular.test.ts", /stripe|onboarding/i);
  controls.push({
    id: "DEMAND-6",
    title: "Billing + entitlement path coverage",
    status: hasBillingAndEntitlementCoverage ? "pass" : "warn",
    details: hasBillingAndEntitlementCoverage
      ? "Checkout + onboarding flow and granular coverage detected."
      : "Billing/entitlement exists but does not yet have full granular runtime coverage.",
  });

  const hasEthicsDoc = hasFile("docs/ETHICAL_GUARDRAILS.md");
  controls.push({
    id: "DEMAND-7",
    title: "Documented ethical guardrails",
    status: hasEthicsDoc ? "pass" : "warn",
    details: hasEthicsDoc
      ? "Ethical guardrails document is present."
      : "No dedicated ethics guardrails document found.",
  });

  return controls;
}

function main(): void {
  const controls = runChecks();
  let pass = 0;
  let warn = 0;
  let fail = 0;

  console.log("Demand Features Audit");
  console.log("=====================");

  for (const control of controls) {
    if (control.status === "pass") pass += 1;
    if (control.status === "warn") warn += 1;
    if (control.status === "fail") fail += 1;
    console.log(`[${control.status.toUpperCase().padEnd(4, " ")}] ${control.id} - ${control.title}`);
    console.log(`       ${control.details}`);
  }

  console.log("");
  console.log(`Summary: ${controls.length} checks, ${pass} pass, ${warn} warn, ${fail} fail`);

  if (fail > 0) {
    process.exit(1);
  }
}

main();
