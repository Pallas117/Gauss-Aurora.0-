Deno.serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return new Response('missing env', { status: 500 });
    const invokeUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ops-jobs-health-check`;
    await fetch(invokeUrl, { method: 'POST', headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger: 'scheduled:18:00' }) });
    return new Response('invoked', { status: 200 });
  } catch (e) { return new Response(String(e), { status: 500 }); }
});