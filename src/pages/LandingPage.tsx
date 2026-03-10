/**
 * Root landing: viz first, then redirect authenticated users to onboarding or dashboard.
 * Renders Index (SpaceScene + CTAs) when unauthenticated; redirects when authenticated.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Index from "@/pages/Index";
import { useMissionSnapshot } from "@/hooks/useMissionSnapshot";
import { fetchOnboarding } from "@/lib/api/onboarding";

const defaultLandingSda =
  String(
    (import.meta.env?.VITE_DEFAULT_LANDING ??
      (typeof process !== "undefined" ? process.env?.VITE_DEFAULT_LANDING : undefined) ??
      ""
    ).toLowerCase()
  ) === "sda";

export default function LandingPage() {
  const navigate = useNavigate();
  const mission = useMissionSnapshot();
  const [onboardingChecked, setOnboardingChecked] = useState(false);

  useEffect(() => {
    const session = mission.session;
    if (!session || mission.loading || !session.authRequired || !session.authenticated) {
      if (!mission.loading) setOnboardingChecked(true);
      return;
    }
    let cancelled = false;
    fetchOnboarding()
      .then((state) => {
        if (cancelled) return;
        setOnboardingChecked(true);
        if (!state.completed) {
          navigate("/onboarding", { replace: true });
          return;
        }
        navigate(defaultLandingSda ? "/sda" : "/command", { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        setOnboardingChecked(true);
        navigate(defaultLandingSda ? "/sda" : "/command", { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [mission.session, mission.loading, navigate]);

  return <Index />;
}
