# Login and activation guide (staff and users)

One sign-in flow for everyone. After login, **staff** (by role or email) get **Heliophysics Ops** and **Space Debris** features activated automatically.

---

## Overview

- **Same flow:** Staff and regular users both sign in with **email + password** (or SSO if configured) via the mission shell.
- **Detection:** The backend treats you as **staff** if either:
  - Your Supabase **role** is **operator** or **admin** (set in Supabase Auth or via RBAC bootstrap), or
  - Your **email** is matched by **staff-by-email** (domain or address list in backend env).
- **Activation:** When you are staff, the session returns `features: { heliophysics: true, debris: true }`. The app then:
  - Unlocks **Heliophysics Ops** (dashboard, feeds, nowcast, threat summary).
  - Enables **Space Debris** (risk zones on SDA and heliophysics) without needing `VITE_FEATURE_DEBRIS_3D=true`.

---

## Step-by-step for staff and users

### 1. One-time setup (admin / DevOps)

1. **Supabase**
   - Create a project at [supabase.com](https://supabase.com).
   - In **Project Settings > API** copy:
     - Project URL → `SUPABASE_URL` and `VITE_SUPABASE_URL`
     - anon public key → `VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_ANON_KEY`
     - service_role key → `SUPABASE_SERVICE_ROLE_KEY` (backend only; never expose in frontend).
   - In **Authentication > URL Configuration** set:
     - **Site URL** to your app origin (e.g. `http://localhost:8080`).
     - **Redirect URLs** to include that origin and e.g. `http://localhost:8080/heliophysics`.

2. **Backend `.env`**
   - Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.
   - Optional **staff-by-email** (so staff are detected by email even if not yet operator/admin):
     - `STAFF_EMAIL_DOMAINS=@yourcompany.com,lightbound.io` (comma-separated domains)
     - and/or `STAFF_EMAILS=ops@example.com,admin@example.com` (comma-separated full addresses)
   - Restart the backend after changes.

3. **Frontend `.env`**
   - Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_HELIO_PROXY_URL` (e.g. `http://localhost:3001`).

4. **Assign staff roles (choose one)**
   - **Option A – RBAC bootstrap:** Set `RBAC_VIEWER_EMAIL`, `RBAC_OPERATOR_EMAIL`, `RBAC_ADMIN_EMAIL` and their passwords, then run `npm run setup:rbac`. This creates/updates users and sets `app_metadata.role` to viewer / operator / admin.
   - **Option B – Supabase Dashboard:** In **Authentication > Users**, open a user, edit **User Metadata** or **App Metadata** and set `role` to `viewer`, `operator`, or `admin`.

Staff are users with role **operator** or **admin**, or users whose email matches `STAFF_EMAIL_DOMAINS` / `STAFF_EMAILS`.

---

### 2. Signing in (everyone – one flow)

1. Open the app (e.g. `http://localhost:8080`).
2. In the shell, go to **Heliophysics** (or use **Open Login Portal** from Command if shown).
3. Enter your **email** and **password** (the same credentials you use for Supabase Auth).
4. Click **Sign in**.
5. If required, **confirm your email** (Supabase confirmation link) then sign in again.

After a successful sign-in:

- The session is stored and the backend returns your **role** and **features**.
- **Regular users (viewer):** Can access public mission data where allowed; Heliophysics and debris are not activated unless they are staff-by-email.
- **Staff (operator/admin or staff-by-email):** **Heliophysics Ops** and **Space Debris** are activated:
  - Feed and dashboard data load.
  - SDA visualization uses live data and can show debris/risk zones (if backend serves them).
  - Staff portal (operator/admin only) appears in the nav when applicable.

---

### 3. Verifying activation (staff)

1. After sign-in, check **Security posture** in the shell: you should see your **role** (e.g. operator, admin) instead of “signed out”.
2. Go to **Heliophysics Ops**: dashboard, charts, and threat summary should load (no “Sign in required”).
3. Go to **SDA**: in **Feed State**, **live data** should show a source (e.g. dashboard or ops/command); **debris points** may show a number if risk zones are configured.
4. If **Space Debris** is enabled for your session, the **Radiation / Debris** layer toggle on SDA is enabled and risk zones can appear in the 3D view.

---

### 4. Troubleshooting

| Issue | What to check |
|-------|----------------|
| “Sign in required” after login | Email not confirmed; confirm via Supabase email link or set `AUTH_REQUIRE_EMAIL_VERIFIED=false` (dev only). |
| Heliophysics / debris not active for staff | Backend `.env`: `STAFF_EMAIL_DOMAINS` or `STAFF_EMAILS`, or set user role to operator/admin in Supabase. Restart backend. |
| Session returns 500 | Backend missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`. See [AUTH_TROUBLESHOOTING.md](AUTH_TROUBLESHOOTING.md). |
| No live data on SDA | Sign in; ensure backend and ingest are running so `/api/feed/dashboard/latest` or ops/command returns data. |
| No debris points | Backend must serve risk zones (`GET /api/ssa/risk-zones`). Configure Privateer or TLE catalog; see [DEBRIS_RISK_3D.md](DEBRIS_RISK_3D.md). |

---

## Summary

- **One login flow** for staff and users (email + password or SSO).
- **Staff** = operator/admin role in Supabase **or** email in `STAFF_EMAIL_DOMAINS` / `STAFF_EMAILS`.
- **Activation:** Staff get `features.heliophysics` and `features.debris` in the session; the app uses these to enable Heliophysics Ops and Space Debris (no extra env flag required for staff).
