import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ChevronRight,
  Shield,
  TerminalSquare,
  Waves,
} from "lucide-react";
import { SignUpModal } from "@/components/SignUpModal";
import { MissionSurfaceLinks } from "@/components/MissionSurfaceLinks";
import { SovereignOverviewSvg } from "@/components/scene/SovereignOverviewSvg";
import { useBackendHealth } from "@/hooks/useBackendHealth";

const Index = () => {
  const navigate = useNavigate();
  const { health, error } = useBackendHealth();
  const [signUpOpen, setSignUpOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-6 lg:px-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.42em] text-white/45">
              Project Gauss
            </p>
            <h1 className="mt-2 text-4xl font-semibold uppercase tracking-[0.08em]">
              Gauss <span className="text-[#CCFF00]">Sovereign</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-white/68">
              Split mission operations into dedicated route lanes instead of forcing every operator through one heavy surface.
              This entry stays SVG-first so Judith can keep DeepSeek, ingest, and the operator shell alive together.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="rounded-full border border-white/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.24em] text-white/65">
              RAM {health?.memory?.level ?? "checking"}
            </div>
            <div className="rounded-full border border-white/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.24em] text-white/65">
              {health?.ok ? "Backend linked" : "Offline aware"}
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <div className="space-y-6">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/45">
                Sovereign intelligence v0.6
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">
                Human-led, local-first, RAM-aware mission command
              </h2>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onMouseEnter={() => setIsHovering(true)}
                  onMouseLeave={() => setIsHovering(false)}
                  onClick={() => setSignUpOpen(true)}
                  className="flex items-center justify-center gap-3 rounded-2xl bg-[#CCFF00] px-6 py-4 text-[11px] font-black uppercase tracking-[0.24em] text-black transition-opacity hover:opacity-90"
                >
                  Access Mission Control
                  <ChevronRight
                    size={18}
                    strokeWidth={3}
                    className={isHovering ? "translate-x-0.5 transition-transform" : "transition-transform"}
                  />
                </button>
                <Link
                  to="/space/heliophysics"
                  className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 px-5 py-4 text-[11px] font-bold uppercase tracking-[0.24em] text-white/80 transition-colors hover:bg-white/5"
                >
                  Open mission surface
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                  <Shield className="h-4 w-4 text-[#CCFF00]" />
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-white/45">Auth posture</p>
                  <p className="mt-1 text-sm text-white/85">Role-gated ops, onboarding, and protected feeds.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                  <Waves className="h-4 w-4 text-[#CCFF00]" />
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-white/45">Heliophysics</p>
                  <p className="mt-1 text-sm text-white/85">MHD + MMS + SSA fusion without waiting on cloud UI paths.</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                  <TerminalSquare className="h-4 w-4 text-[#CCFF00]" />
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-white/45">Operator TTY</p>
                  <p className="mt-1 text-sm text-white/85">Fallback command lane for manual plan, simulate, and execute.</p>
                </div>
              </div>
            </div>

            <MissionSurfaceLinks />

            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/45">Runtime note</p>
              <p className="mt-2 text-sm text-white/72">
                {error
                  ? error
                  : health?.memory?.level === "critical"
                    ? "Backend RAM is critical. Keep operators on SVG and terminal lanes until memory headroom recovers."
                    : health?.memory?.level === "constrained"
                      ? "Backend RAM is constrained. Prefer split route lanes and lightweight surfaces."
                      : "Backend headroom is nominal. Split route lanes remain available to keep scrolling and GPU churn low."}
              </p>
            </div>
          </div>

          <SovereignOverviewSvg
            className="min-h-[520px]"
            memoryLevel={health?.memory?.level ?? "nominal"}
            stormTier="quiet"
          />
        </section>
      </div>

      <SignUpModal
        open={signUpOpen}
        onOpenChange={setSignUpOpen}
        onSuccess={() => {
          setSignUpOpen(false);
          navigate("/onboarding");
        }}
      />
    </main>
  );
};

export default Index;
