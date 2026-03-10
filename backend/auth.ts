import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { getSupabaseAdminClient } from "./supabase.js";

export type AuthRole = "viewer" | "operator" | "admin";
export type AuthClearance = "public" | "mission" | "restricted";

export interface AuthContext {
  userId: string;
  email: string | null;
  role: AuthRole;
  clearance: AuthClearance;
  rawRoles: string[];
  rawClearances: string[];
  emailVerified: boolean;
  token: string;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };

const ROLE_RANK: Record<AuthRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

const CLEARANCE_RANK: Record<AuthClearance, number> = {
  public: 1,
  mission: 2,
  restricted: 3,
};

function authRequired(): boolean {
  const value = (process.env.AUTH_REQUIRED ?? "true").toLowerCase();
  return value !== "false";
}

function requireVerifiedEmail(): boolean {
  const value = (process.env.AUTH_REQUIRE_EMAIL_VERIFIED ?? "true").toLowerCase();
  return value !== "false";
}

export function isAuthRequired(): boolean {
  return authRequired();
}

export function isVerifiedEmailRequired(): boolean {
  return requireVerifiedEmail();
}

/** Session feature flags: heliophysics ops and space debris (by role or staff-by-email). */
export interface SessionFeatures {
  heliophysics: boolean;
  debris: boolean;
}

function parseStaffEmailDomains(): string[] {
  const raw = (process.env.STAFF_EMAIL_DOMAINS ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function parseStaffEmails(): string[] {
  const raw = (process.env.STAFF_EMAILS ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/** True if email domain is in STAFF_EMAIL_DOMAINS or email is in STAFF_EMAILS. */
export function isStaffByEmail(email: string | null): boolean {
  if (!email || typeof email !== "string") return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const domains = parseStaffEmailDomains();
  const allowedEmails = parseStaffEmails();
  if (allowedEmails.includes(normalized)) return true;
  const at = normalized.indexOf("@");
  if (at === -1) return false;
  const domain = normalized.slice(at); // e.g. "@company.com"
  const domainNoAt = normalized.slice(at + 1); // e.g. "company.com"
  return domains.some(
    (d) => d === domain || d === domainNoAt || domain === `@${d}` || domainNoAt === d,
  );
}

/** Heliophysics + debris enabled when role is operator/admin or staff-by-email. */
export function getSessionFeatures(
  role: AuthRole | null,
  email: string | null,
): SessionFeatures {
  const staffByRole = role === "operator" || role === "admin";
  const staffByEmail = isStaffByEmail(email);
  const active = staffByRole || staffByEmail;
  return {
    heliophysics: active,
    debris: active,
  };
}

function parseAuthorization(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return trimmed.slice(7).trim() || null;
}

export function getTokenFromRequest(req: Request): string | null {
  const authHeader = parseAuthorization(req.header("authorization") ?? undefined);
  if (authHeader) {
    return authHeader;
  }
  const queryToken = typeof req.query.token === "string" ? req.query.token.trim() : "";
  return queryToken || null;
}

function normalizeRole(value: unknown): AuthRole | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.toLowerCase();
  if (normalized === "viewer" || normalized === "operator" || normalized === "admin") {
    return normalized;
  }
  return null;
}

function normalizeClearance(value: unknown): AuthClearance | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.toLowerCase().trim();
  if (normalized === "public" || normalized === "mission" || normalized === "restricted") {
    return normalized;
  }
  if (normalized === "1") return "public";
  if (normalized === "2") return "mission";
  if (normalized === "3") return "restricted";
  return null;
}

export function resolveAuthRoleFromMetadata(
  user: {
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  },
): AuthRole {
  return highestRole(extractRoles(user));
}

function defaultClearanceForRole(role: AuthRole): AuthClearance {
  if (role === "admin") return "restricted";
  if (role === "operator") return "mission";
  return "public";
}

export function resolveAuthClearanceFromMetadata(
  user: {
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  },
): AuthClearance {
  const rawRoles = extractRoles(user);
  const role = highestRole(rawRoles);
  const clearances = extractClearances(user);
  return highestClearance(clearances, role);
}

function extractRoles(user: {
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}): string[] {
  const roles = new Set<string>();

  const appRole = normalizeRole(user.app_metadata?.role);
  if (appRole) roles.add(appRole);

  const appRoles = user.app_metadata?.roles;
  if (Array.isArray(appRoles)) {
    for (const role of appRoles) {
      const mapped = normalizeRole(role);
      if (mapped) roles.add(mapped);
    }
  }

  const userRole = normalizeRole(user.user_metadata?.role);
  if (userRole) roles.add(userRole);

  if (roles.size === 0) {
    roles.add("viewer");
  }

  return Array.from(roles);
}

function extractClearances(user: {
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}): string[] {
  const clearances = new Set<string>();

  const appClearance =
    normalizeClearance(user.app_metadata?.clearance) ??
    normalizeClearance(user.app_metadata?.clearance_level);
  if (appClearance) clearances.add(appClearance);

  const appClearances = user.app_metadata?.clearances;
  if (Array.isArray(appClearances)) {
    for (const clearance of appClearances) {
      const mapped = normalizeClearance(clearance);
      if (mapped) clearances.add(mapped);
    }
  }

  const userClearance =
    normalizeClearance(user.user_metadata?.clearance) ??
    normalizeClearance(user.user_metadata?.clearance_level);
  if (userClearance) clearances.add(userClearance);

  return Array.from(clearances);
}

function highestRole(rawRoles: string[]): AuthRole {
  let current: AuthRole = "viewer";
  for (const role of rawRoles) {
    const mapped = normalizeRole(role);
    if (!mapped) continue;
    if (ROLE_RANK[mapped] > ROLE_RANK[current]) {
      current = mapped;
    }
  }
  return current;
}

function highestClearance(rawClearances: string[], role: AuthRole): AuthClearance {
  let current = defaultClearanceForRole(role);
  for (const clearance of rawClearances) {
    const mapped = normalizeClearance(clearance);
    if (!mapped) continue;
    if (CLEARANCE_RANK[mapped] > CLEARANCE_RANK[current]) {
      current = mapped;
    }
  }
  return current;
}

export function roleSatisfies(current: AuthRole, required: AuthRole): boolean {
  return ROLE_RANK[current] >= ROLE_RANK[required];
}

export function clearanceSatisfies(current: AuthClearance, required: AuthClearance): boolean {
  return CLEARANCE_RANK[current] >= CLEARANCE_RANK[required];
}

export async function authenticateRequest() {
  throw new Error("authenticateRequest has been moved to backend/middleware/auth.ts");
}

export function requireRole() {
  throw new Error("requireRole has been moved to backend/middleware/auth.ts");
}

export function requireClearance() {
  throw new Error("requireClearance has been moved to backend/middleware/auth.ts");
}

export async function authenticateSocket() {
  throw new Error("authenticateSocket has been moved to backend/middleware/auth.ts");
}

export function withAsyncMiddleware() {
  throw new Error("withAsyncMiddleware has been moved to backend/middleware/async.ts");
}
