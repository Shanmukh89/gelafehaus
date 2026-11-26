-- ============================================================
-- Migration: Fix get_insights() ungrouped column error using CTEs
-- ============================================================

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

  -- Current period KPIs & method breakdown from paid CTE
  with paid as (
    select
      p.order_id,
      p.amount_paise,
      p.method,
      p.recorded_at,
      nullif(trim(o.customer_phone), '') as customer_phone
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'confirmed'
      and p.recorded_at >= v_curr_start_utc
      and p.recorded_at < v_curr_end_utc
  )
  select
    coalesce(sum(amount_paise), 0)::bigint,
    count(distinct order_id)::int,
    count(distinct customer_phone)::int,
    coalesce(sum(case when method = 'cash' then amount_paise else 0 end), 0)::bigint,
    count(distinct case when method = 'cash' then order_id end)::int,
    coalesce(sum(case when method = 'upi' then amount_paise else 0 end), 0)::bigint,
    count(distinct case when method = 'upi' then order_id end)::int,
    coalesce(sum(case when method = 'card' then amount_paise else 0 end), 0)::bigint,
    count(distinct case when method = 'card' then order_id end)::int
  into
    v_rev, v_orders, v_uniq,
    v_cash_rev, v_cash_orders,
    v_upi_rev, v_upi_orders,
    v_card_rev, v_card_orders
  from paid;

  if v_orders > 0 then
    v_aov := round(v_rev::numeric / v_orders)::bigint;
  end if;

  -- Previous period KPIs
  with prev_paid as (
    select
      p.order_id,
      p.amount_paise,
      nullif(trim(o.customer_phone), '') as customer_phone
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'confirmed'
      and p.recorded_at >= v_prev_start_utc
      and p.recorded_at < v_prev_end_utc
  )
  select
    coalesce(sum(amount_paise), 0)::bigint,
    count(distinct order_id)::int,
    count(distinct customer_phone)::int
  into v_prev_rev, v_prev_orders, v_prev_uniq
  from prev_paid;

  if v_prev_orders > 0 then
    v_prev_aov := round(v_prev_rev::numeric / v_prev_orders)::bigint;
  end if;

  -- Chart series using paid CTE
  if v_range = 'day' then
    with paid as (
      select
        p.order_id,
        p.amount_paise,
        p.method,
        extract(hour from (p.recorded_at at time zone 'Asia/Kolkata'))::int as ist_hour
      from public.payments p
      where p.status = 'confirmed'
        and p.recorded_at >= v_curr_start_utc
        and p.recorded_at < v_curr_end_utc
    )
    select coalesce(jsonb_agg(row_obj order by h), '[]'::jsonb)
    into v_series
    from (
      select
        gs.h,
        jsonb_build_object(
          'label', lpad(gs.h::text, 2, '0') || ':00',
          'cashRevenue', coalesce(sum(case when paid.method = 'cash' then paid.amount_paise else 0 end), 0)::bigint,
          'upiRevenue', coalesce(sum(case when paid.method = 'upi' then paid.amount_paise else 0 end), 0)::bigint,
          'cardRevenue', coalesce(sum(case when paid.method = 'card' then paid.amount_paise else 0 end), 0)::bigint,
          'totalRevenue', coalesce(sum(paid.amount_paise), 0)::bigint,
          'cashOrders', count(distinct case when paid.method = 'cash' then paid.order_id end)::int,
          'upiOrders', count(distinct case when paid.method = 'upi' then paid.order_id end)::int,
          'cardOrders', count(distinct case when paid.method = 'card' then paid.order_id end)::int,
          'totalOrders', count(distinct paid.order_id)::int
        ) as row_obj
      from generate_series(0, 23) as gs(h)
      left join paid on paid.ist_hour = gs.h
      group by gs.h
    ) s;
  elsif v_range = 'week' then
    with paid as (
      select
        p.order_id,
        p.amount_paise,
        p.method,
        (p.recorded_at at time zone 'Asia/Kolkata')::date as ist_date
      from public.payments p
      where p.status = 'confirmed'
        and p.recorded_at >= v_curr_start_utc
        and p.recorded_at < v_curr_end_utc
    )
    select coalesce(jsonb_agg(row_obj order by d), '[]'::jsonb)
    into v_series
    from (
      select
        gs.d::date as d,
        jsonb_build_object(
          'label', to_char(gs.d::date, 'Dy'),
          'subLabel', to_char(gs.d::date, 'DD Mon'),
          'cashRevenue', coalesce(sum(case when paid.method = 'cash' then paid.amount_paise else 0 end), 0)::bigint,
          'upiRevenue', coalesce(sum(case when paid.method = 'upi' then paid.amount_paise else 0 end), 0)::bigint,
          'cardRevenue', coalesce(sum(case when paid.method = 'card' then paid.amount_paise else 0 end), 0)::bigint,
          'totalRevenue', coalesce(sum(paid.amount_paise), 0)::bigint,
          'cashOrders', count(distinct case when paid.method = 'cash' then paid.order_id end)::int,
          'upiOrders', count(distinct case when paid.method = 'upi' then paid.order_id end)::int,
          'cardOrders', count(distinct case when paid.method = 'card' then paid.order_id end)::int,
          'totalOrders', count(distinct paid.order_id)::int
        ) as row_obj
      from generate_series(v_curr_start_date, v_today_ist, interval '1 day') as gs(d)
      left join paid on paid.ist_date = gs.d::date
      group by gs.d::date
    ) s;
  else
    with paid as (
      select
        p.order_id,
        p.amount_paise,
        p.method,
        (p.recorded_at at time zone 'Asia/Kolkata')::date as ist_date
      from public.payments p
      where p.status = 'confirmed'
        and p.recorded_at >= v_curr_start_utc
        and p.recorded_at < v_curr_end_utc
    )
    select coalesce(jsonb_agg(row_obj order by w_idx), '[]'::jsonb)
    into v_series
    from (
      select
        b.w_idx,
        jsonb_build_object(
          'label', 'W' || b.w_idx || ' (' || to_char(b.w_start, 'DD Mon') || '–' || to_char(b.w_end, 'DD Mon') || ')',
          'shortLabel', 'W' || b.w_idx,
          'subLabel', to_char(b.w_start, 'DD Mon') || ' – ' || to_char(b.w_end, 'DD Mon'),
          'cashRevenue', coalesce(sum(case when paid.method = 'cash' then paid.amount_paise else 0 end), 0)::bigint,
          'upiRevenue', coalesce(sum(case when paid.method = 'upi' then paid.amount_paise else 0 end), 0)::bigint,
          'cardRevenue', coalesce(sum(case when paid.method = 'card' then paid.amount_paise else 0 end), 0)::bigint,
          'totalRevenue', coalesce(sum(paid.amount_paise), 0)::bigint,
          'cashOrders', count(distinct case when paid.method = 'cash' then paid.order_id end)::int,
          'upiOrders', count(distinct case when paid.method = 'upi' then paid.order_id end)::int,
          'cardOrders', count(distinct case when paid.method = 'card' then paid.order_id end)::int,
          'totalOrders', count(distinct paid.order_id)::int
        ) as row_obj
      from (
        select
          idx as w_idx,
          (v_curr_start_date + ((idx - 1) * 7))::date as w_start,
          least(v_today_ist, (v_curr_start_date + (idx * 7) - 1)::date) as w_end
        from generate_series(1, 5) as idx
        where (v_curr_start_date + ((idx - 1) * 7))::date <= v_today_ist
      ) b
      left join paid on paid.ist_date between b.w_start and b.w_end
      group by b.w_idx, b.w_start, b.w_end
    ) s;
  end if;

  -- Top 5 items by quantity from paid CTE
  with paid as (
    select p.order_id
    from public.payments p
    where p.status = 'confirmed'
      and p.recorded_at >= v_curr_start_utc
      and p.recorded_at < v_curr_end_utc
  )
  select coalesce(jsonb_agg(item_obj), '[]'::jsonb)
  into v_top_items
  from (
    select jsonb_build_object(
      'name', oi.name_snapshot,
      'quantity', sum(oi.quantity)::int,
      'revenue', sum(oi.unit_price_paise * oi.quantity)::bigint
    ) as item_obj
    from paid
    join public.order_items oi on oi.order_id = paid.order_id
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

  -- New vs returning customers using CTEs (no correlated subquery, null phones excluded)
  with paid as (
    select distinct
      nullif(trim(o.customer_phone), '') as customer_phone
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'confirmed'
      and p.recorded_at >= v_curr_start_utc
      and p.recorded_at < v_curr_end_utc
      and nullif(trim(o.customer_phone), '') is not null
  ),
  first_seen as (
    select
      nullif(trim(o.customer_phone), '') as customer_phone,
      min(p.recorded_at) as first_paid
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status = 'confirmed'
      and nullif(trim(o.customer_phone), '') is not null
    group by nullif(trim(o.customer_phone), '')
  )
  select
    count(distinct paid.customer_phone) filter (
      where first_seen.first_paid >= v_curr_start_utc and first_seen.first_paid < v_curr_end_utc
    )::int,
    count(distinct paid.customer_phone) filter (
      where first_seen.first_paid < v_curr_start_utc
    )::int
  into v_new_cust, v_ret_cust
  from paid
  join first_seen on first_seen.customer_phone = paid.customer_phone;

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
      'newCustomers', coalesce(v_new_cust, 0),
      'returningCustomers', coalesce(v_ret_cust, 0)
    )
  );
end;
$$;

grant execute on function public.get_insights(text) to authenticated;
