-- ============================================================
-- Migration: Revoke anon execute on place_order()
-- Enforces that place_order() can only be called by the
-- backend Edge Function using the service_role key.
-- ============================================================

revoke execute on function public.place_order(text, text, jsonb, uuid) from public;
revoke execute on function public.place_order(text, text, jsonb, uuid) from anon;

grant execute on function public.place_order(text, text, jsonb, uuid) to service_role;
