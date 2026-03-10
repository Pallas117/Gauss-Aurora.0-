/**
 * When rendered inside shell Layout: if user is authenticated and onboarding
 * is not complete, redirect to /onboarding so they complete the flow first.
 */

import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { fetchOnboarding } from "@/lib/api/onboarding";

const ONBOARDING_PATH = "/onboarding";
const SIGNUP_PATH = "/signup";

export function OnboardingGuard() {
  const navigate = useNavigate();
  const location = useLocation();
  const checked = useRef(false);

  useEffect(() => {
    if (location.pathname === ONBOARDING_PATH || location.pathname === SIGNUP_PATH) return;
    if (checked.current) return;
    checked.current = true;
    fetchOnboarding()
      .then((state) => {
        if (!state.completed) {
          navigate(ONBOARDING_PATH, { replace: true });
        }
      })
      .catch(() => {
        checked.current = false;
      });
  }, [location.pathname, navigate]);

  return null;
}
