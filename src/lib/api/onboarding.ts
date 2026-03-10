import { getAuthHeaders } from "@/lib/api/auth";
import { getApiBaseUrl } from "@/lib/api/base-url";

const BASE_URL = getApiBaseUrl();

export interface OnboardingState {
  deviceStepDone: boolean;
  planStepDone: boolean;
  completed: boolean;
  completedAt: string | null;
}

export async function fetchOnboarding(): Promise<OnboardingState> {
  const response = await fetch(`${BASE_URL}/api/auth/onboarding`, {
    headers: await getAuthHeaders(),
  });
  if (response.status === 401) {
    throw new Error("Sign in required");
  }
  if (!response.ok) {
    throw new Error(`Onboarding HTTP ${response.status}`);
  }
  const json = (await response.json()) as {
    deviceStepDone?: boolean;
    planStepDone?: boolean;
    completed?: boolean;
    completedAt?: string | null;
  };
  return {
    deviceStepDone: Boolean(json.deviceStepDone),
    planStepDone: Boolean(json.planStepDone),
    completed: Boolean(json.completed),
    completedAt: json.completedAt ?? null,
  };
}

export async function patchOnboarding(update: {
  deviceStepDone?: boolean;
  planStepDone?: boolean;
  complete?: boolean;
}): Promise<OnboardingState> {
  const response = await fetch(`${BASE_URL}/api/auth/onboarding`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(update),
  });
  if (response.status === 401) {
    throw new Error("Sign in required");
  }
  if (!response.ok) {
    throw new Error(`Onboarding HTTP ${response.status}`);
  }
  const json = (await response.json()) as {
    deviceStepDone?: boolean;
    planStepDone?: boolean;
    completed?: boolean;
    completedAt?: string | null;
  };
  return {
    deviceStepDone: Boolean(json.deviceStepDone),
    planStepDone: Boolean(json.planStepDone),
    completed: Boolean(json.completed),
    completedAt: json.completedAt ?? null,
  };
}
