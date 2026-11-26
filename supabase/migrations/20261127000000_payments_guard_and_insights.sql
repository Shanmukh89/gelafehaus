-- ============================================================
-- Migration: Payments Double-Count Guard, Today Breakdown & Insights RPC
-- ============================================================

-- 1. Enforce at most one confirmed payment per order (prevents double-counting)
create unique index if not exists idx_payments_one_confirmed_per_order
  on public.payments (order_id)
  where status = 'confirmed';

-- Ensure Realtime covers public.payments
do $$
begin
  alter publication supabase_realtime add table public.payments;
exception when duplicate_object or undefined_object then null;
end $$;

-- 2. Idempotent mark_order_paid: never double-counts or inserts a second confirmed payment
create or replace function public.mark_order_paid(
  p_order_id uuid,
  p_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_now timestamptz := now();
  v_history jsonb;
begin
  if not public.is_admin() then
    raise exception 'UNAUTHORIZED: Admin access required';
  end if;

  if p_method not in ('cash', 'upi', 'card') then
    raise exception 'INVALID_METHOD: Payment method must be cash, upi, or card';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND: Order not found';
  end if;

  -- Guard: if already paid or already has a confirmed payment, return idempotently without double-counting
  if v_order.payment_status = 'paid' or exists (
    select 1 from public.payments where order_id = p_order_id and status = 'confirmed'
  ) then
    return jsonb_build_object(
      'order_id', p_order_id,
      'payment_status', 'paid',
      'method', coalesce(v_order.payment_method, p_method),
      'paid_at', coalesce(v_order.paid_at, v_now),
      'already_paid', true
    );
  end if;

  v_history := coalesce(v_order.payment_history, '[]'::jsonb) || jsonb_build_object(
    'action', 'paid',
    'method', p_method,
    'timestamp', v_now
  );

  update public.orders
  set payment_status = 'paid',
      paid_at = v_now,
      payment_method = p_method,
      payment_history = v_history,
      updated_at = v_now
  where id = p_order_id;

  insert into public.payments (order_id, amount_paise, method, status, recorded_at)
  values (p_order_id, v_order.total_paise, p_method, 'confirmed', v_now)
  on conflict (order_id) where status = 'confirmed' do nothing;

  return jsonb_build_object(
    'order_id', p_order_id,
    'payment_status', 'paid',
    'method', p_method,
    'paid_at', v_now,
    'already_paid', false
  );
end;
$$;

grant execute on function public.mark_order_paid(uuid, text) to authenticated;

-- 3. Admin-only Today Stats RPC (Asia/Kolkata, backed by confirmed payments)
create or replace function public.get_day_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today_ist date := (now() at time zone 'Asia/Kolkata')::date;
  v_start_utc timestamptz := (v_today_ist::timestamp at time zone 'Asia/Kolkata');
  v_end_utc timestamptz := ((v_today_ist + 1)::timestamp at time zone 'Asia/Kolkata');

  v_total_orders int := 0;
  v_revenue bigint := 0;
  v_cash_revenue bigint := 0;
  v_cash_orders int := 0;
  v_upi_revenue bigint := 0;
  v_upi_orders int := 0;
  v_card_revenue bigint := 0;
  v_card_orders int := 0;
  v_unpaid_orders int := 0;
  v_unpaid_amount bigint := 0;
  v_avg_prep int := 0;
begin
  if not public.is_admin() then
    raise exception 'UNAUTHORIZED: Admin access required';
  end if;

  select
    count(distinct p.order_id)::int,
    coalesce(sum(p.amount_paise), 0)::bigint,
    coalesce(sum(case when p.method = 'cash' then p.amount_paise else 0 end), 0)::bigint,
    count(distinct case when p.method = 'cash' then p.order_id end)::int,
    coalesce(sum(case when p.method = 'upi' then p.amount_paise else 0 end), 0)::bigint,
    count(distinct case when p.method = 'upi' then p.order_id end)::int,
    coalesce(sum(case when p.method = 'card' then p.amount_paise else 0 end), 0)::bigint,
    count(distinct case when p.method = 'card' then p.order_id end)::int
  into
    v_total_orders,
    v_revenue,
    v_cash_revenue,
    v_cash_orders,
    v_upi_revenue,
    v_upi_orders,
    v_card_revenue,
    v_card_orders
  from public.payments p
  where p.status = 'confirmed'
    and p.recorded_at >= v_start_utc
    and p.recorded_at < v_end_utc;

  select
    count(*)::int,
    coalesce(sum(o.total_paise), 0)::bigint
  into v_unpaid_orders, v_unpaid_amount
  from public.orders o
  where o.created_at >= v_start_utc
    and o.created_at < v_end_utc
    and o.status = 'completed'
    and o.payment_status != 'paid';

  select
    coalesce(round(avg(extract(epoch from (o.updated_at - o.created_at)) / 60.0)), 0)::int
  into v_avg_prep
  from public.orders o
  where o.created_at >= v_start_utc
    and o.created_at < v_end_utc
    and o.status = 'completed';

  return jsonb_build_object(
    'totalOrders', v_total_orders,
    'revenue', v_revenue,
    'cashRevenue', v_cash_revenue,
    'cashOrders', v_cash_orders,
    'upiRevenue', v_upi_revenue,
    'upiOrders', v_upi_orders,
    'cardRevenue', v_card_revenue,
    'cardOrders', v_card_orders,
    'unpaidOrders', v_unpaid_orders,
    'unpaidAmount', v_unpaid_amount,
    'avgPrepTime', v_avg_prep
  );
end;
$$;

grant execute on function public.get_day_stats() to authenticated;

-- 4. Admin-only Insights RPC (Asia/Kolkata, PAID orders by paid_at / recorded_at)
create or replace function public.get_insights(p_range text default 'day')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_range text := lower(trim(coalesce(p_range, 'day')));
  v_today_ist date := (now() at time zone 'Asia/Kolkata')::date;

  v_curr_start_date date;
  v_curr_end_date date;
  v_prev_start_date date;
  v_prev_end_date date;

  v_curr_start_utc timestamptz;
  v_curr_end_utc timestamptz;
  v_prev_start_utc timestamptz;
  v_prev_end_utc timestamptz;

  v_rev bigint := 0;
  v_orders int := 0;
  v_uniq int := 0;
  v_aov bigint := 0;

  v_prev_rev bigint := 0;
  v_prev_orders int := 0;
  v_prev_uniq int := 0;
  v_prev_aov bigint := 0;

  v_cash_rev bigint := 0;
  v_cash_orders int := 0;
  v_upi_rev bigint := 0;
  v_upi_orders int := 0;
  v_card_rev bigint := 0;
  v_card_orders int := 0;

  v_series jsonb := '[]'::jsonb;
  v_top_items jsonb := '[]'::jsonb;
  v_method_split jsonb := '[]'::jsonb;
  v_new_cust int := 0;
  v_ret_cust int := 0;
begin
  if not public.is_admin() then
    raise exception 'UNAUTHORIZED: Admin access required';
  end if;

  if v_range not in ('day', 'week', 'month') then
    raise exception 'INVALID_RANGE: Range must be day, week, or month';
  end if;

  if v_range = 'day' then
    v_curr_start_date := v_today_ist;
    v_curr_end_date := v_today_ist + 1;
    v_prev_start_date := v_today_ist - 1;
    v_prev_end_date := v_today_ist;
  elsif v_range = 'week' then
    v_curr_start_date := v_today_ist - 6;
    v_curr_end_date := v_today_ist + 1;
    v_prev_start_date := v_today_ist - 13;
    v_prev_end_date := v_today_ist - 6;
  else
    v_curr_start_date := v_today_ist - 29;
    v_curr_end_date := v_today_ist + 1;
    v_prev_start_date := v_today_ist - 59;
    v_prev_end_date := v_today_ist - 29;
  end if;

  v_curr_start_utc := v_curr_start_date::timestamp at time zone 'Asia/Kolkata';
  v_curr_end_utc := v_curr_end_date::timestamp at time zone 'Asia/Kolkata';
  v_prev_start_utc := v_prev_start_date::timestamp at time zone 'Asia/Kolkata';
  v_prev_end_utc := v_prev_end_date::timestamp at time zone 'Asia/Kolkata';

  -- Current period KPIs & method breakdown
  select
    coalesce(sum(p.amount_paise), 0)::bigint,
    count(distinct p.order_id)::int,
    count(distinct nullif(trim(o.customer_phone), ''))::int,
    coalesce(sum(case when p.method = 'cash' then p.amount_paise else 0 end), 0)::bigint,
    count(distinct case when p.method = 'cash' then p.order_id end)::int,
    coalesce(sum(case when p.method = 'upi' then p.amount_paise else 0 end), 0)::bigint,
    count(distinct case when p.method = 'upi' then p.order_id end)::int,
    coalesce(sum(case when p.method = 'card' then p.amount_paise else 0 end), 0)::bigint,
    count(distinct case when p.method = 'card' then p.order_id end)::int
  into
    v_rev, v_orders, v_uniq,
    v_cash_rev, v_cash_orders,
    v_upi_rev, v_upi_orders,
    v_card_rev, v_card_orders
  from public.payments p
  join public.orders o on o.id = p.order_id
  where p.status = 'confirmed'
    and p.recorded_at >= v_curr_start_utc
    and p.recorded_at < v_curr_end_utc;

  if v_orders > 0 then
    v_aov := round(v_rev::numeric / v_orders)::bigint;
  end if;

  -- Previous period KPIs
  select
    coalesce(sum(p.amount_paise), 0)::bigint,
    count(distinct p.order_id)::int,
    count(distinct nullif(trim(o.customer_phone), ''))::int
  into v_prev_rev, v_prev_orders, v_prev_uniq
  from public.payments p
  join public.orders o on o.id = p.order_id
  where p.status = 'confirmed'
    and p.recorded_at >= v_prev_start_utc
    and p.recorded_at < v_prev_end_utc;

  if v_prev_orders > 0 then
    v_prev_aov := round(v_prev_rev::numeric / v_prev_orders)::bigint;
  end if;

  -- Chart series
  if v_range = 'day' then
    select coalesce(jsonb_agg(row_obj order by h), '[]'::jsonb)
    into v_series
    from (
      select
        gs.h,
        jsonb_build_object(
          'label', lpad(gs.h::text, 2, '0') || ':00',
          'cashRevenue', coalesce(sum(case when p.method = 'cash' then p.amount_paise else 0 end), 0)::bigint,
          'upiRevenue', coalesce(sum(case when p.method = 'upi' then p.amount_paise else 0 end), 0)::bigint,
          'cardRevenue', coalesce(sum(case when p.method = 'card' then p.amount_paise else 0 end), 0)::bigint,
          'totalRevenue', coalesce(sum(p.amount_paise), 0)::bigint,
          'cashOrders', count(distinct case when p.method = 'cash' then p.order_id end)::int,
          'upiOrders', count(distinct case when p.method = 'upi' then p.order_id end)::int,
          'cardOrders', count(distinct case when p.method = 'card' then p.order_id end)::int,
          'totalOrders', count(distinct p.order_id)::int
        ) as row_obj
      from generate_series(0, 23) as gs(h)
      left join public.payments p
        on p.status = 'confirmed'
        and p.recorded_at >= v_curr_start_utc
        and p.recorded_at < v_curr_end_utc
        and extract(hour from (p.recorded_at at time zone 'Asia/Kolkata'))::int = gs.h
      group by gs.h
    ) s;
  elsif v_range = 'week' then
    select coalesce(jsonb_agg(row_obj order by d), '[]'::jsonb)
    into v_series
    from (
      select
        gs.d::date as d,
        jsonb_build_object(
          'label', to_char(gs.d::date, 'Dy'),
          'subLabel', to_char(gs.d::date, 'DD Mon'),
          'cashRevenue', coalesce(sum(case when p.method = 'cash' then p.amount_paise else 0 end), 0)::bigint,
          'upiRevenue', coalesce(sum(case when p.method = 'upi' then p.amount_paise else 0 end), 0)::bigint,
          'cardRevenue', coalesce(sum(case when p.method = 'card' then p.amount_paise else 0 end), 0)::bigint,
          'totalRevenue', coalesce(sum(p.amount_paise), 0)::bigint,
          'cashOrders', count(distinct case when p.method = 'cash' then p.order_id end)::int,
          'upiOrders', count(distinct case when p.method = 'upi' then p.order_id end)::int,
          'cardOrders', count(distinct case when p.method = 'card' then p.order_id end)::int,
          'totalOrders', count(distinct p.order_id)::int
        ) as row_obj
      from generate_series(v_curr_start_date, v_today_ist, interval '1 day') as gs(d)
      left join public.payments p
        on p.status = 'confirmed'
        and p.recorded_at >= v_curr_start_utc
        and p.recorded_at < v_curr_end_utc
        and (p.recorded_at at time zone 'Asia/Kolkata')::date = gs.d::date
      group by gs.d::date
    ) s;
  else
    -- Month: 5 weekly buckets across the last 30 days
    select coalesce(jsonb_agg(row_obj order by w_idx), '[]'::jsonb)
    into v_series
    from (
      select
        b.w_idx,
        jsonb_build_object(
          'label', 'W' || b.w_idx || ' (' || to_char(b.w_start, 'DD Mon') || '–' || to_char(b.w_end, 'DD Mon') || ')',
          'shortLabel', 'W' || b.w_idx,
          'subLabel', to_char(b.w_start, 'DD Mon') || ' – ' || to_char(b.w_end, 'DD Mon'),
          'cashRevenue', coalesce(sum(case when p.method = 'cash' then p.amount_paise else 0 end), 0)::bigint,
          'upiRevenue', coalesce(sum(case when p.method = 'upi' then p.amount_paise else 0 end), 0)::bigint,
          'cardRevenue', coalesce(sum(case when p.method = 'card' then p.amount_paise else 0 end), 0)::bigint,
          'totalRevenue', coalesce(sum(p.amount_paise), 0)::bigint,
          'cashOrders', count(distinct case when p.method = 'cash' then p.order_id end)::int,
          'upiOrders', count(distinct case when p.method = 'upi' then p.order_id end)::int,
          'cardOrders', count(distinct case when p.method = 'card' then p.order_id end)::int,
          'totalOrders', count(distinct p.order_id)::int
        ) as row_obj
      from (
        select
          idx as w_idx,
          (v_curr_start_date + ((idx - 1) * 7))::date as w_start,
          least(v_today_ist, (v_curr_start_date + (idx * 7) - 1)::date) as w_end
        from generate_series(1, 5) as idx
        where (v_curr_start_date + ((idx - 1) * 7))::date <= v_today_ist
      ) b
      left join public.payments p
        on p.status = 'confirmed'
        and p.recorded_at >= v_curr_start_utc
        and p.recorded_at < v_curr_end_utc
        and (p.recorded_at at time zone 'Asia/Kolkata')::date between b.w_start and b.w_end
      group by b.w_idx, b.w_start, b.w_end
    ) s;
  end if;

  -- Top 5 items by quantity from paid orders in window
  select coalesce(jsonb_agg(item_obj), '[]'::jsonb)
  into v_top_items
  from (
    select jsonb_build_object(
      'name', oi.name_snapshot,
      'quantity', sum(oi.quantity)::int,
      'revenue', sum(oi.unit_price_paise * oi.quantity)::bigint
    ) as item_obj
    from public.payments p
    join public.order_items oi on oi.order_id = p.order_id
    where p.status = 'confirmed'
      and p.recorded_at >= v_curr_start_utc
      and p.recorded_at < v_curr_end_utc
    group by oi.name_snapshot
    order by sum(oi.quantity) desc, sum(oi.unit_price_paise * oi.quantity) desc
    limit 5
  ) t;

  -- Payment method split
  v_method_split := jsonb_build_array(
    jsonb_build_object('method', 'cash', 'revenue', v_cash_rev, 'orders', v_cash_orders),
    jsonb_build_object('method', 'upi', 'revenue', v_upi_rev, 'orders', v_upi_orders),
    jsonb_build_object('method', 'card', 'revenue', v_card_rev, 'orders', v_card_orders)
  );

  -- New vs returning customers (by phone among paid orders in window)
  select
    count(*) filter (where had_prior = false)::int,
    count(*) filter (where had_prior = true)::int
  into v_new_cust, v_ret_cust
  from (
    select
      trim(o.customer_phone) as phone,
      exists (
        select 1
        from public.payments p2
        join public.orders o2 on o2.id = p2.order_id
        where p2.status = 'confirmed'
          and p2.recorded_at < v_curr_start_utc
          and trim(o2.customer_phone) = trim(o.customer_phone)
      ) as had_prior
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'confirmed'
      and p.recorded_at >= v_curr_start_utc
      and p.recorded_at < v_curr_end_utc
      and nullif(trim(o.customer_phone), '') is not null
    group by trim(o.customer_phone)
  ) c;

  return jsonb_build_object(
    'range', v_range,
    'kpis', jsonb_build_object(
      'revenue', v_rev,
      'prevRevenue', v_prev_rev,
      'orders', v_orders,
      'prevOrders', v_prev_orders,
      'uniqueCustomers', v_uniq,
      'prevUniqueCustomers', v_prev_uniq,
      'avgOrderValue', v_aov,
      'prevAvgOrderValue', v_prev_aov
    ),
    'methods', jsonb_build_object(
      'cash', jsonb_build_object('revenue', v_cash_rev, 'orders', v_cash_orders),
      'upi', jsonb_build_object('revenue', v_upi_rev, 'orders', v_upi_orders),
      'card', jsonb_build_object('revenue', v_card_rev, 'orders', v_card_orders)
    ),
    'series', v_series,
    'topItems', v_top_items,
    'methodSplit', v_method_split,
    'customerSplit', jsonb_build_object(
      'newCustomers', v_new_cust,
      'returningCustomers', v_ret_cust
    )
  );
end;
$$;

grant execute on function public.get_insights(text) to authenticated;
