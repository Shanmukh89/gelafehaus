import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Rate Limiting (In-Memory Sliding Window) ───
// Rules: Max 5 orders per IP per 10 minutes, Max 2 orders per table per minute
const IP_LIMIT = 5;
const IP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const ipHistory = new Map<string, number[]>();

const TABLE_LIMIT = 2;
const TABLE_WINDOW_MS = 60 * 1000; // 1 minute
const tableHistory = new Map<string, number[]>();

function checkRateLimit(key: string, limit: number, windowMs: number, map: Map<string, number[]>): boolean {
  const now = Date.now();
  const timestamps = (map.get(key) || []).filter(ts => now - ts < windowMs);
  if (timestamps.length >= limit) {
    map.set(key, timestamps);
    return true; // Exceeded limit
  }
  timestamps.push(now);
  map.set(key, timestamps);
  return false;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const clientIp =
      req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      '127.0.0.1';

    const body = await req.json();
    const { tableNumber, customerName, customerPhone, items, idempotencyKey, turnstileToken } = body;

    // ─── 1. Rate Limiting Checks ───
    if (checkRateLimit(clientIp, IP_LIMIT, IP_WINDOW_MS, ipHistory)) {
      return new Response(
        JSON.stringify({
          error: 'RATE_LIMIT_EXCEEDED: Too many order attempts from your network. Please wait a few minutes before trying again.',
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tableKey = `table_${String(tableNumber || '').trim()}`;
    if (checkRateLimit(tableKey, TABLE_LIMIT, TABLE_WINDOW_MS, tableHistory)) {
      return new Response(
        JSON.stringify({
          error: 'RATE_LIMIT_EXCEEDED: Maximum 2 orders per table per minute reached. Please wait a moment.',
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── 2. Cloudflare Turnstile Verification ───
    const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');

    if (turnstileSecret) {
      if (!turnstileToken) {
        return new Response(
          JSON.stringify({
            error: 'BOT_VERIFICATION_FAILED: Security verification token is missing. Please try again.',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const formData = new FormData();
      formData.append('secret', turnstileSecret);
      formData.append('response', turnstileToken);
      if (clientIp !== '127.0.0.1') {
        formData.append('remoteip', clientIp);
      }

      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: formData,
      });

      const verifyResult = await verifyRes.json();
      if (!verifyResult.success) {
        return new Response(
          JSON.stringify({
            error: 'BOT_VERIFICATION_FAILED: Bot protection check failed. Please refresh and try again.',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ─── 3. Call place_order RPC with Service Role ───
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'SERVER_CONFIG_ERROR: Supabase credentials missing in Edge Function environment.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    // Format items for the RPC
    const formattedItems = (items || []).map((i: any) => ({
      menuItemId: i.menuItemId,
      quantity: i.quantity,
      notes: i.notes || '',
      optionIds: i.optionIds || [],
      offerId: i.offerId || null,
    }));

    const { data, error } = await supabaseAdmin.rpc('place_order', {
      p_table: tableNumber,
      p_customer_name: customerName,
      p_items: formattedItems,
      p_idempotency_key: idempotencyKey,
      p_customer_phone: customerPhone || null,
    });

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal Server Error';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
