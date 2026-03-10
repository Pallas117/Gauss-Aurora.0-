# Auth troubleshooting

If you cannot log in or the app shows "not logged in" after signing in, check the following.

## 1. Supabase env (required)

- **Frontend**: Set real values in `.env` (or `.env.local`):
  - `VITE_SUPABASE_URL` — your project URL from Supabase **Project Settings > API**
  - `VITE_SUPABASE_PUBLISHABLE_KEY` — the **anon public** key (not the service role key)
- Do **not** leave these as `https://your-project.supabase.co` or `your-anon-key`; auth will fail.

- **Backend**: The backend needs the same project URL and the **service role** key (never expose this in the frontend):
  - `SUPABASE_URL` — same as project URL
  - `SUPABASE_SERVICE_ROLE_KEY` — from **Project Settings > API**
- Restart the backend after changing these. If they are missing, `/api/auth/session` returns 500 with "Supabase admin credentials not configured"; the UI will show a short message asking the admin to set these.

## 2. Confirm email

The backend treats you as **not authenticated** until your email is confirmed. After signing up:

1. Check your inbox for the Supabase confirmation email.
2. Click the confirmation link.
3. Then sign in again; the app should show you as logged in.

For **local development only**, you can skip email verification by setting in `.env`:

- `AUTH_REQUIRE_EMAIL_VERIFIED=false`

Do not use this in production.

## 3. Redirect URLs

In the Supabase dashboard, go to **Authentication > URL Configuration**:

- **Site URL**: your app origin (e.g. `http://localhost:8080`, or your production URL).
- **Redirect URLs**: add your app origin and any paths used after sign-in (e.g. `http://localhost:8080/heliophysics`).

Without these, OAuth (Google, GitHub, Azure) may redirect to the wrong place or fail.

## 4. SSO providers

To use Google, GitHub, or Azure sign-in, enable and configure each provider under **Authentication > Providers** in the Supabase dashboard (client ID and secret per provider).

## 5. Quick checklist

1. Supabase project created; frontend has real `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. Backend has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; backend restarted after changes.
3. Redirect URLs and (if needed) SSO providers configured in Supabase.
4. User has confirmed email (or `AUTH_REQUIRE_EMAIL_VERIFIED=false` in dev).
5. Frontend points to the backend via `VITE_HELIO_PROXY_URL` (e.g. `http://localhost:3001`).

If login still fails, check the browser console for Supabase/auth errors and the Network tab for `/api/auth/session` (status and response body).
