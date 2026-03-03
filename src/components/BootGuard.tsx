/**
 * Boot flow: loading bar while running status checks; toasts on any error.
 * Renders children once checks complete (with or without errors).
 * When path is "/" (landing), renders children immediately so viz shows on boot.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  checkBackendHealth,
  checkAuthConfig,
  checkAuthSession,
  type BootStepResult,
} from "@/lib/boot-checks";

const STEPS: { id: BootStepResult["id"]; label: string }[] = [
  { id: "backend", label: "Backend health" },
  { id: "auth-config", label: "Auth config" },
  { id: "session", label: "Auth session" },
  { id: "ready", label: "Ready" },
];

function getPathname(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  return window.location.pathname;
}

export function BootGuard({ children }: { children: React.ReactNode }) {
  const [bootComplete, setBootComplete] = useState(getPathname() === "/");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BootStepResult[]>([]);
  const [currentStep, setCurrentStep] = useState<string>("Starting…");

  useEffect(() => {
    if (getPathname() === "/") {
      setBootComplete(true);
      return;
    }
    let cancelled = false;

    const run = async () => {
      const out: BootStepResult[] = [];
      const total = STEPS.length - 1;
      let stepIndex = 0;

      const advance = (result: BootStepResult) => {
        if (cancelled) return;
        out.push(result);
        setResults([...out]);
        setProgress(Math.round((out.length / total) * 100));
        if (!result.ok && result.message) {
          toast.error(`Boot: ${result.label}`, {
            description: result.message,
            duration: 8000,
          });
        }
      };

      setCurrentStep("Checking backend…");
      const backend = await checkBackendHealth();
      advance(backend);

      if (cancelled) return;
      setCurrentStep("Checking auth config…");
      const authConfig = checkAuthConfig();
      advance(authConfig);

      if (cancelled) return;
      setCurrentStep("Checking session…");
      const session = await checkAuthSession();
      advance(session);

      if (cancelled) return;
      setCurrentStep("Ready");
      setProgress(100);
      advance({ id: "ready", label: "Ready", ok: true });

      if (!cancelled) {
        setBootComplete(true);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (bootComplete) {
    return <>{children}</>;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background/95 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label="Application boot in progress"
    >
      <div className="w-full max-w-md px-6">
        <p className="text-center text-xs text-muted-foreground mb-2">
          Pre-alpha: This product is in development and is being aligned with the needs of users.
        </p>
        <p className="text-center text-sm font-medium text-foreground">
          {currentStep}
        </p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
        <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
          {STEPS.slice(0, -1).map((step, i) => {
            const result = results.find((r) => r.id === step.id);
            const done = result != null;
            const ok = result?.ok ?? true;
            return (
              <li
                key={step.id}
                className={`flex items-center gap-2 ${done ? (ok ? "text-muted-foreground" : "text-destructive") : "text-muted-foreground/70"}`}
              >
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                {step.label}
                {done && (ok ? " ✓" : " — error")}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
