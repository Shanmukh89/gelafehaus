-- ============================================================
-- SQL Test: Payments Double-Count Guard, Method Totals & Undo
-- Run inside a rolled-back transaction against local/staging DB.
-- ============================================================
begin;

do $$
declare
  v_table_id uuid;
  v_admin_id uuid;
  v_o1 uuid;
  v_o2 uuid;
  v_o3 uuid;
  v_stats jsonb;
  v_insights jsonb;
  v_pay_count int;
begin
  -- Ensure an active table exists
  select id into v_table_id from public.tables where is_active = true limit 1;
  if v_table_id is null then
    insert into public.tables (number, is_active) values ('99', true) returning id into v_table_id;
  end if;

  -- Simulate an admin user in auth context
  select user_id into v_admin_id from public.admins limit 1;
  if v_admin_id is null then
    v_admin_id := gen_random_uuid();
    insert into public.admins (user_id) values (v_admin_id);
  end if;
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Create 3 orders for today
  insert into public.orders (order_number, order_date, table_id, customer_name, customer_phone, status, payment_status, total_paise, idempotency_key)
  values
    (901, (now() at time zone 'Asia/Kolkata')::date, v_table_id, 'SQL Cash', '+919876543210', 'completed', 'unpaid', 20000, gen_random_uuid()),
    (902, (now() at time zone 'Asia/Kolkata')::date, v_table_id, 'SQL UPI', '+919876543211', 'completed', 'unpaid', 35000, gen_random_uuid()),
    (903, (now() at time zone 'Asia/Kolkata')::date, v_table_id, 'SQL Settle', '+919876543212', 'completed', 'unpaid', 15000, gen_random_uuid());

  select id into v_o1 from public.orders where order_number = 901 and order_date = (now() at time zone 'Asia/Kolkata')::date;
  select id into v_o2 from public.orders where order_number = 902 and order_date = (now() at time zone 'Asia/Kolkata')::date;
  select id into v_o3 from public.orders where order_number = 903 and order_date = (now() at time zone 'Asia/Kolkata')::date;

  -- Pay 1 by cash, 1 by UPI, 1 via settle (card)
  perform public.mark_order_paid(v_o1, 'cash');
  perform public.mark_order_paid(v_o2, 'upi');
  perform public.mark_order_paid(v_o3, 'card');

  -- Double-pay guard: calling mark_order_paid again must NOT create a second confirmed payment
  perform public.mark_order_paid(v_o1, 'cash');
  select count(*) into v_pay_count from public.payments where order_id = v_o1 and status = 'confirmed';
  assert v_pay_count = 1, 'Expected exactly 1 confirmed payment for order 1';

  -- Check get_day_stats()
  v_stats := public.get_day_stats();
  assert (v_stats->>'cashRevenue')::bigint >= 20000, 'Cash revenue mismatch';
  assert (v_stats->>'upiRevenue')::bigint >= 35000, 'UPI revenue mismatch';
  assert (v_stats->>'cardRevenue')::bigint >= 15000, 'Card revenue mismatch';
  assert (v_stats->>'revenue')::bigint =
    (v_stats->>'cashRevenue')::bigint + (v_stats->>'upiRevenue')::bigint + (v_stats->>'cardRevenue')::bigint,
    'Split must equal total revenue';

  -- Check get_insights('day') reconciles with get_day_stats()
  v_insights := public.get_insights('day');
  assert (v_insights->'kpis'->>'revenue')::bigint = (v_stats->>'revenue')::bigint, 'Insights day revenue must match Today';
  assert (v_insights->'kpis'->>'orders')::int = (v_stats->>'totalOrders')::int, 'Insights day orders must match Today';

  -- Undo payment on order 2 (UPI) -> totals must revert by 35000 and 1 order
  perform public.undo_order_paid(v_o2);
  v_stats := public.get_day_stats();
  assert (v_stats->>'upiRevenue')::bigint = ((v_insights->'methods'->'upi'->>'revenue')::bigint - 35000),
    'Undo did not revert UPI revenue';

  raise notice 'ALL PAYMENTS & INSIGHTS ASSERTIONS PASSED';
end $$;

rollback;
