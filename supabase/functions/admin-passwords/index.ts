import { createClient } from "npm:@supabase/supabase-js@2.32.0";

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });

    const url = new URL(req.url);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return new Response(JSON.stringify({ error: 'Supabase env not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: { 'Content-Type': 'application/json' } });

    // Verify caller is admin by calling a simple RPC that uses auth context
    const adminCheckRes = await fetch(`${supabaseUrl}/rest/v1/rpc/is_admin_user`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'tx=read-only'
      }
    });

    if (!adminCheckRes.ok) {
      return new Response(JSON.stringify({ error: 'Failed to verify admin status' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const adminCheck = await adminCheckRes.json();
    // RPC returns boolean as [{is_admin_user:true}] or just true depending on setup; handle both
    const isAdmin = (Array.isArray(adminCheck) && adminCheck[0] && (adminCheck[0].is_admin_user === true || adminCheck[0] === true)) || adminCheck === true || adminCheck === false ? (Array.isArray(adminCheck) ? (adminCheck[0] && (adminCheck[0].is_admin_user === true || adminCheck[0] === true)) : adminCheck === true) : false;

    if (!isAdmin) return new Response(JSON.stringify({ error: 'Forbidden: admin only' }), { status: 403, headers: { 'Content-Type': 'application/json' } });

    const body = await req.json().catch(() => null);
    if (!body || body.action !== 'send_reset_email' || !body.email) return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    // Use admin API to send password reset email
    const client = createClient(supabaseUrl, serviceKey);
    const { error } = await client.auth.admin.resetPasswordForEmail(body.email);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ status: 'ok', message: 'Password reset email sent' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});