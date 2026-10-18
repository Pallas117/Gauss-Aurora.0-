/**
 * Internal staff portal data: next implementations and recent changes.
 * Edit this file to update roadmap and changelog for staff visibility.
 */

export interface NextImplementation {
  id: string;
  title: string;
  description?: string;
  area: string;
  status: "planned" | "in_progress" | "review" | "completed";
  target?: string;
}

export interface RecentChange {
  id: string;
  date: string;
  title: string;
  summary: string;
  area?: string;
}

export const nextImplementations: NextImplementation[] = [
  {
    id: "ui-figma",
    title: "UI/UX improvements from Figma",
    description: "Implement design updates and component refinements from Figma plugin.",
    area: "Frontend",
    status: "planned",
    target: "Q1",
  },
  {
    id: "ui-scaling-sda",
    title: "UI scaling and SDA front and center",
    description: "Fluid scaling for projectors and devices; SDA as default landing option; presentation/cast mode for demos and hackathons.",
    area: "Frontend",
    status: "completed",
    target: "Ongoing",
  },
  {
    id: "staff-portal",
    title: "Internal staff portal",
    description: "Portal for staff to view next implementations and recent changes.",
    area: "Internal",
    status: "completed",
  },
  {
    id: "memory-directive",
    title: "Strict memory and power directive adherence",
    description: "Audit and harden M1/8GB constraints, probability gating, and cache limits.",
    area: "Backend",
    status: "planned",
    target: "Ongoing",
  },
  {
    id: "ssa-confidence-ui",
    title: "SSA confidence and uncertainty in threat/decision UI",
    description: "Wire orchestrator confidence intervals and contributing factors into the threat and decision UI (COMPETITIVE_READINESS_SCORECARD SSA automation gap).",
    area: "Frontend",
    status: "planned",
    target: "Q2",
  },
];

export const recentChanges: RecentChange[] = [
  {
    id: "ch-operator-sources",
    date: "2026-02-28",
    title: "Operator onboarding: data sources and satellite hardware",
    summary: "Systems tab 'Data sources & hardware' for operators to register data sources (feeds, APIs) and onboard satellite hardware (ground stations, antennas). Quick link from staff portal to /systems?tab=sources.",
    area: "Internal",
  },
  {
    id: "ch-audit-portal",
    date: "2026-02-28",
    title: "Staff portal: last full audit summary + login guide",
    summary: "GET /api/ops/audit/summary for operator/admin; staff portal shows PASS/WARN/FAIL/SKIP from npm run audit:adherence:record. Login & activation card points to docs/LOGIN_AND_ACTIVATION_GUIDE.md.",
    area: "Internal",
  },
  {
    id: "ch-1",
    date: "2026-02-28",
    title: "UI scaling and SDA front and center",
    summary: "Fluid CSS scaling for projectors and devices; SDA default landing (VITE_DEFAULT_LANDING=sda); presentation mode (/sda?presentation=1) for cast/full-room demos. Doc: docs/UI_UX_SCALING_AND_PRESENTATION.md.",
    area: "Frontend",
  },
  {
    id: "ch-2-internal",
    date: "2026-02-28",
    title: "Internal staff portal added",
    summary: "New /staff/portal route for staff to see next implementations and recent changes. Admin/operator only.",
    area: "Internal",
  },
  {
    id: "ch-3",
    date: "2026-02-27",
    title: "Mission shell and Command C2",
    summary: "Unified operations surface with security posture, operator timeline, and one-screen decision summary.",
    area: "Frontend",
  },
  {
    id: "ch-4",
    date: "2026-02-27",
    title: "Heliophysics dashboard and auth",
    summary: "Auth gate, session modal, and role-based access for heliophysics ops.",
    area: "Frontend",
  },
];
