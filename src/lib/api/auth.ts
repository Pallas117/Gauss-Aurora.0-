import { supabase } from "@/integrations/supabase/client";
import { getApiBaseUrl } from "./base-url";

type OAuthProvider = "google" | "github" | "azure";

const API_BASE = getApiBaseUrl();

export interface SignUpWithPasswordResult {
  signedIn: boolean;
  emailVerificationRequired: boolean;
}

export async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  if (!token) {
    return {};
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Sign in failed");
  }

  // Store the session tokens in the browser
  if (data.session?.access_token) {
    // Use Supabase client to set session
    await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token || "",
    });
  }
}

export async function signUpWithPassword(input: {
  email: string;
  password: string;
  fullName?: string;
  company?: string;
  requestedRole?: "viewer" | "operator";
}): Promise<SignUpWithPasswordResult> {
  const { email, password, fullName, company, requestedRole } = input;
  
  const signupResponse = await fetch(`${API_BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      data: {
        full_name: fullName ?? null,
        company: company ?? null,
        requested_role: requestedRole ?? "viewer",
      },
    }),
  });

  const signupData = await signupResponse.json();
  if (!signupResponse.ok) {
    throw new Error(signupData.error || "Sign up failed");
  }

  const emailVerified = Boolean(signupData.user?.email_confirmed_at);
  if (!emailVerified) {
    return {
      signedIn: false,
      emailVerificationRequired: true,
    };
  }

  await signInWithPassword(email, password);
  return {
    signedIn: true,
    emailVerificationRequired: false,
  };
}

export async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/onboarding`,
    },
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function signOutSession(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(error.message);
  }
}

export async function hasActiveSession(): Promise<boolean> {
  const token = await getAccessToken();
  return Boolean(token);
}
