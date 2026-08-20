import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAuthClearanceFromMetadata,
  resolveAuthRoleFromMetadata,
  sanitizeSignupMetadata,
} from "./auth.js";

test("authorization ignores user-controlled role and clearance metadata", () => {
  const role = resolveAuthRoleFromMetadata({
    app_metadata: {},
    user_metadata: { role: "admin", clearance: "restricted" },
  });
  const clearance = resolveAuthClearanceFromMetadata({
    app_metadata: {},
    user_metadata: { role: "admin", clearance: "restricted" },
  });

  assert.equal(role, "viewer");
  assert.equal(clearance, "public");
});

test("authorization accepts only server-controlled app metadata", () => {
  assert.equal(
    resolveAuthRoleFromMetadata({ app_metadata: { role: "operator" }, user_metadata: { role: "admin" } }),
    "operator",
  );
  assert.equal(
    resolveAuthClearanceFromMetadata({ app_metadata: { clearance: "mission" }, user_metadata: { clearance: "restricted" } }),
    "mission",
  );
});

test("signup metadata drops privilege-shaped fields", () => {
  assert.deepEqual(
    sanitizeSignupMetadata({
      display_name: "  Judith  ",
      requested_role: "operator",
      role: "admin",
      clearance: "restricted",
      permissions: ["*"],
    }),
    { display_name: "Judith", requested_role: "operator" },
  );
});
