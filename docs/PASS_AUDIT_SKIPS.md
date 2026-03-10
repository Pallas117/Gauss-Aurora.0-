# How to Pass the Audit SKIPs

The full adherence audit (`npm run audit:adherence` or `audit:adherence:record`) can **SKIP** five steps when required environment variables are missing. To turn those into **PASS**, do the following.

---

## Steps 1 & 2: RBAC Environment Preflight + RBAC Runtime Smoke Test

**What’s required:** Real Supabase Auth users with viewer and operator roles, and their credentials in env.

### 1. Set in `.env` (or export before the audit)

```bash
# Supabase (you likely have these)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# RBAC test users (must exist in Supabase Auth with app_metadata.role)
RBAC_VIEWER_EMAIL=viewer@example.com
RBAC_VIEWER_PASSWORD=your-viewer-password
RBAC_OPERATOR_EMAIL=operator@example.com
RBAC_OPERATOR_PASSWORD=your-operator-password
```

### 2. Create/update users and roles in Supabase

```bash
npm run setup:rbac
```

This uses `SUPABASE_SERVICE_ROLE_KEY` to create or update the viewer and operator users and set `app_metadata.role`. Use real emails and passwords; after the first run you can reuse the same credentials.

### 3. Run the audit

With those four RBAC variables set (and Supabase URL/keys), Step 1 passes and Step 2 runs `npm run test:rbac` (login as viewer and operator against the backend). Backend must accept Supabase (e.g. `AUTH_REQUIRED=true` and correct Supabase config).

**Optional:** To also include admin in RBAC tests, set `RBAC_TEST_TRAIN=true` and add `RBAC_ADMIN_EMAIL` and `RBAC_ADMIN_PASSWORD`, then run `npm run setup:rbac` again.

---

## Steps 6 & 7: Orchestrator ingest E2E + Orchestrator live ingest

**What’s required:** A shared secret that the backend and the audit scripts use for the ingest API.

### 1. Choose a secret token

Use any non-empty secret (e.g. from `openssl rand -hex 24`). Same value must be used by the **backend** and by the **audit/test** process.

### 2. Set in `.env` (for both backend and audit)

```bash
# Backend checks this for x-gauss-service-token on ingest requests
ORCHESTRATOR_INGEST_API_TOKEN=your-secret-token-here
```

- If you run the backend with `npm run dev:proxy` or similar, it loads `.env` and will accept requests that send this value as `x-gauss-service-token` (or `Authorization: Bearer <token>`).
- The audit runs in the same repo and uses `--env-file-if-exists=.env`, so it will see the same variable.

### 3. Backend must be running for Step 7

- **Step 6** (Orchestrator ingest E2E) only needs the token; it POSTs to `BACKEND_BASE_URL` (default `http://127.0.0.1:3001`). Start the backend (e.g. `npm run dev:proxy`) before the audit if you want this to pass.
- **Step 7** (Orchestrator live ingest) runs the Rust orchestrator with one fixture file and POSTs to the backend; the backend must be up and `ORCHESTRATOR_INGEST_API_TOKEN` must match.

So: set `ORCHESTRATOR_INGEST_API_TOKEN` in `.env`, start the backend, then run the audit.

---

## Step 11: Supabase RLS Smoke

**What’s required:** Supabase URL + anon key **and** a way to act as a “viewer” (either a token or email+password).

### 1. Supabase URL and anon key

At least one of these pairs must be set:

- `SUPABASE_URL` or `VITE_SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`

(You almost certainly have these if the app uses Supabase.)

### 2. Viewer credentials (one of)

- **Option A:** Set a pre-obtained JWT for a viewer user:
  ```bash
  RBAC_VIEWER_TOKEN=eyJhbGc...
  ```
- **Option B:** Set the same viewer credentials you use for RBAC (Steps 1–2):
  ```bash
  RBAC_VIEWER_EMAIL=viewer@example.com
  RBAC_VIEWER_PASSWORD=your-viewer-password
  ```

The RLS smoke script signs in (or uses the token), then runs a minimal query against a table protected by RLS to confirm the viewer role is enforced.

So: if you’ve already set RBAC viewer email/password for Steps 1–2, Step 11 will run as long as Supabase URL and anon key are set. If you use only a token, set `RBAC_VIEWER_TOKEN`.

---

## Quick reference

| Step | What to set | Then |
|------|----------------|------|
| **1 & 2** | `RBAC_VIEWER_EMAIL`, `RBAC_VIEWER_PASSWORD`, `RBAC_OPERATOR_EMAIL`, `RBAC_OPERATOR_PASSWORD` + Supabase URL/keys | `npm run setup:rbac` → run audit |
| **6 & 7** | `ORCHESTRATOR_INGEST_API_TOKEN` (same in backend and audit); backend running for 6 & 7 | Run audit |
| **11** | Supabase URL + anon key (or VITE_ equivalents); and `RBAC_VIEWER_TOKEN` **or** `RBAC_VIEWER_EMAIL` + `RBAC_VIEWER_PASSWORD` | Run audit |

After setting the right variables and (where needed) running `npm run setup:rbac` and starting the backend, run:

```bash
npm run audit:adherence:record
```

All five steps should report **PASS** instead of **SKIP** (assuming backend and Supabase are up and correct).
