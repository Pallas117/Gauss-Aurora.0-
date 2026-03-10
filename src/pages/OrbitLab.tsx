import { Suspense, lazy } from "react";

const ORBIT_LAB_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_ORBIT_LAB === "true";
const OrbitTemplate = ORBIT_LAB_ENABLED
  ? lazy(() => import("@/components/orbit/ORBITTemplate"))
  : null;

function OrbitLabDisabled() {
  return (
    <main className="min-h-screen bg-background text-foreground p-6">
      <section className="mx-auto max-w-2xl rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Orbit Lab Disabled in Production Build</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The experimental ORBIT lab is excluded by default to keep operational bundle size and
          startup latency lower.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          To enable it: set <code>VITE_ENABLE_ORBIT_LAB=true</code> and rebuild.
        </p>
      </section>
    </main>
  );
}

const OrbitLab = () => {
  if (!ORBIT_LAB_ENABLED || !OrbitTemplate) {
    return <OrbitLabDisabled />;
  }
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Orbit Lab…</div>}>
      <OrbitTemplate />
    </Suspense>
  );
};

export default OrbitLab;
