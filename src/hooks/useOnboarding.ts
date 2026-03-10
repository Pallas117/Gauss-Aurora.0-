import { useCallback, useEffect, useState } from "react";
import { fetchOnboarding, patchOnboarding, type OnboardingState } from "@/lib/api/onboarding";

export interface UseOnboardingResult extends OnboardingState {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<OnboardingState>;
  setDeviceStepDone: (done: boolean) => Promise<void>;
  setPlanStepDone: (done: boolean) => Promise<void>;
  complete: () => Promise<void>;
}

export function useOnboarding(): UseOnboardingResult {
  const [state, setState] = useState<OnboardingState>({
    deviceStepDone: false,
    planStepDone: false,
    completed: false,
    completedAt: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<OnboardingState> => {
    setError(null);
    setLoading(true);
    try {
      const next = await fetchOnboarding();
      setState(next);
      return next;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load onboarding";
      setError(message);
      const fallback: OnboardingState = {
        deviceStepDone: false,
        planStepDone: false,
        completed: false,
        completedAt: null,
      };
      return fallback;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, []);

  const setDeviceStepDone = useCallback(async (done: boolean) => {
    setError(null);
    try {
      const next = await patchOnboarding({ deviceStepDone: done });
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update onboarding");
    }
  }, []);

  const setPlanStepDone = useCallback(async (done: boolean) => {
    setError(null);
    try {
      const next = await patchOnboarding({ planStepDone: done });
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update onboarding");
    }
  }, []);

  const complete = useCallback(async () => {
    setError(null);
    try {
      const next = await patchOnboarding({ complete: true });
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to complete onboarding");
    }
  }, []);

  return {
    ...state,
    loading,
    error,
    refresh,
    setDeviceStepDone,
    setPlanStepDone,
    complete,
  };
}
