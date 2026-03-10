/// <reference types="vite/client" />
import { Suspense, lazy, type ComponentType } from "react";
import type { RouteObject } from "react-router-dom";
import { Navigate, createBrowserRouter } from "react-router-dom";
import Layout from "@/app/Layout";

const CommandPage = lazy(() => import("@/pages/CommandPage"));
const SDAPage = lazy(() => import("@/pages/SDAPage"));
const IntelPage = lazy(() => import("@/pages/IntelPage"));
const SystemsPage = lazy(() => import("@/pages/SystemsPage"));
const AutomationPage = lazy(() => import("@/pages/AutomationPage"));
const ChronosPage = lazy(() => import("@/pages/ChronosPage"));
const OperatorSourcesPage = lazy(() => import("@/pages/OperatorSourcesPage"));
const TuringDevicesPage = lazy(() => import("@/pages/TuringDevicesPage"));
const HeliophysicsDashboard = lazy(() => import("@/pages/HeliophysicsDashboard"));
const Signup = lazy(() => import("@/pages/Signup"));
const LandingPage = lazy(() => import("@/pages/LandingPage"));
const OnboardingPage = lazy(() => import("@/pages/OnboardingPage"));
const AdminUsersPage = lazy(() => import("@/pages/AdminUsersPage"));
const StaffPortalPage = lazy(() => import("@/pages/StaffPortalPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const OrbitLab = lazy(() => import("@/pages/OrbitLab"));
const DevHud = lazy(() => import("@/pages/DevHud"));

const RouteFallback = () => (
  <div className="flex min-h-[30vh] items-center justify-center text-xs text-muted-foreground">
    Awaiting Node...
  </div>
);

function lazyRoute(Component: ComponentType) {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Component />
    </Suspense>
  );
}

const gaussShellEnabled = String((import.meta.env?.VITE_ENABLE_GAUSS_UI_SHELL ?? (typeof process !== "undefined" ? process.env?.VITE_ENABLE_GAUSS_UI_SHELL : undefined) ?? "true")).toLowerCase() !== "false";

const commandSubsystemRoutes: RouteObject[] = [
  { path: "command", element: lazyRoute(CommandPage) },
];

const spaceSubsystemRoutes: RouteObject[] = [
  { path: "sda", element: lazyRoute(SDAPage) },
  { path: "heliophysics", element: lazyRoute(HeliophysicsDashboard) },
  { path: "orbit", element: lazyRoute(OrbitLab) },
  { path: "space/sda", element: lazyRoute(SDAPage) },
  { path: "space/heliophysics", element: lazyRoute(HeliophysicsDashboard) },
  { path: "space/orbit", element: lazyRoute(OrbitLab) },
];

const operationsSubsystemRoutes: RouteObject[] = [
  { path: "systems", element: lazyRoute(SystemsPage) },
  { path: "intel", element: lazyRoute(IntelPage) },
  { path: "ops/automation", element: lazyRoute(AutomationPage) },
  { path: "ops/chronos", element: lazyRoute(ChronosPage) },
  { path: "ops/turing", element: lazyRoute(TuringDevicesPage) },
  { path: "ops/sources", element: lazyRoute(OperatorSourcesPage) },
  { path: "dev-hud", element: lazyRoute(DevHud) },
  { path: "ops/dev-hud", element: lazyRoute(DevHud) },
];

const governanceSubsystemRoutes: RouteObject[] = [
  { path: "admin/users", element: lazyRoute(AdminUsersPage) },
  { path: "staff/portal", element: lazyRoute(StaffPortalPage) },
];

export const appRoutes: RouteObject[] = [
  {
    path: "/",
    element: <Layout />,
    children: [
      {
        index: true,
        element: gaussShellEnabled ? lazyRoute(LandingPage) : <Navigate to="/heliophysics" replace />,
      },
      ...commandSubsystemRoutes,
      ...spaceSubsystemRoutes,
      ...operationsSubsystemRoutes,
      ...governanceSubsystemRoutes,
    ],
  },
  {
    path: "/signup",
    element: lazyRoute(Signup),
  },
  {
    path: "/onboarding",
    element: lazyRoute(OnboardingPage),
  },
  {
    path: "/portal",
    element: lazyRoute(LandingPage),
  },
  {
    path: "/landing",
    element: lazyRoute(LandingPage),
  },
  {
    path: "*",
    element: lazyRoute(NotFound),
  },
];

export const appRouter = createBrowserRouter(appRoutes);
