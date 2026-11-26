-- ============================================================
-- Migration: Customer Phone Number, Paid Tracking, Daily Counter & Realtime
-- ============================================================

-- 1. Add customer_phone and payment tracking columns to orders
alter table public.orders
  add column if not exists customer_phone text,
  add column if not exists payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  add column if not exists paid_at timestamptz null,
  add column if not exists payment_method text null check (payment_method in ('cash', 'upi', 'card')),
  add column if not exists payment_history jsonb not null default '[]'::jsonb;

-- 2. Create payments table for confirmed payment records
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  amount_paise int not null check (amount_paise >= 0),
  method text not null check (method in ('cash', 'upi', 'card')),
  status text not null default 'confirmed' check (status in ('confirmed', 'voided')),
  recorded_at timestamptz not null default now()
);

alter table public.payments enable row level security;

create policy "Admins full access to payments"
  on public.payments
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3. Concurrency-safe Daily Sequential Order Counter (starts at 101 each day)
create table if not exists public.daily_order_counters (
  order_date date primary key,
  last_number int not null default 100
);

alter table public.daily_order_counters enable row level security;

-- 4. Drop older 4-arg place_order overload so signature is unambiguous
drop function if exists public.place_order(text, text, jsonb, uuid);

create or replace function public.place_order(
  p_table text,
  p_customer_name text,
  p_items jsonb,
  p_idempotency_key uuid,
  p_customer_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_order jsonb;
  v_table_id uuid;
  v_table_is_active boolean;
  v_trimmed_name text;
  v_clean_phone text;
  v_order_number int;
  v_order_id uuid;
  v_order_total int := 0;

  v_line jsonb;
  v_qty int;
  v_notes text;
  v_item_id_text text;
  v_item_id uuid;
  v_offer_id_text text;
  v_offer_id uuid;
  v_item_rec record;
  v_offer_rec record;

  v_opt_json jsonb;
  v_opt_id_json jsonb;
  v_opt_id uuid;
  v_opt_ids uuid[];
  v_opt_rec record;

  v_group record;
  v_selected_count int;
  v_distinct_count int;

  v_line_unit_price int;
  v_base_unit_price int;
  v_line_total int;
  v_order_item_id uuid;
begin
  -- 1. Idempotency Check
  select jsonb_build_object(
    'order_id', id,
    'order_number', order_number,
    'total_paise', total_paise,
    'status', status
  )
  into v_existing_order
  from public.orders
  where idempotency_key = p_idempotency_key;

  if found then
    return v_existing_order;
  end if;

  -- 2. Validate Table
  if p_table is null or trim(p_table) = '' then
    raise exception 'INVALID_TABLE: Table number is required';
  end if;

  select id, is_active
  into v_table_id, v_table_is_active
  from public.tables
  where number = trim(p_table);

  if not found then
    raise exception 'INVALID_TABLE: Table % does not exist', trim(p_table);
  end if;

  if not v_table_is_active then
    raise exception 'INVALID_TABLE: Table % is not active', trim(p_table);
  end if;

  -- 3. Validate Customer Name
  v_trimmed_name := trim(p_customer_name);
  if v_trimmed_name is null or length(v_trimmed_name) = 0 then
    raise exception 'INVALID_CUSTOMER_NAME: Customer name is required';
  end if;

  if length(v_trimmed_name) > 60 then
    raise exception 'INVALID_CUSTOMER_NAME: Customer name cannot exceed 60 characters';
  end if;

  -- 4. Validate Indian 10-digit Phone Number
  if p_customer_phone is null or trim(p_customer_phone) = '' then
    raise exception 'INVALID_PHONE: Mobile number is required';
  end if;

  v_clean_phone := regexp_replace(trim(p_customer_phone), '^(\+91|91)?[\s\-]*', '');
  v_clean_phone := regexp_replace(v_clean_phone, '[\s\-]', '', 'g');

  if v_clean_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'INVALID_PHONE: Enter a valid 10-digit Indian mobile number';
  end if;

  -- 5. Validate Items Array (1-30 lines)
  if p_items is null or jsonb_typeof(p_items) != 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'INVALID_ITEMS: Order must contain at least 1 item';
  end if;

  if jsonb_array_length(p_items) > 30 then
    raise exception 'INVALID_ITEMS: Order cannot exceed 30 items';
  end if;

  -- 6. Concurrency-Safe Daily Sequential Order Number (starts at 101 each day)
  insert into public.daily_order_counters (order_date, last_number)
  values (
    current_date,
    greatest(
      coalesce((select max(order_number) from public.orders where order_date = current_date), 100),
      100
    ) + 1
  )
  on conflict (order_date) do update
    set last_number = greatest(
      public.daily_order_counters.last_number,
      coalesce((select max(order_number) from public.orders where order_date = current_date), 100)
    ) + 1
  returning last_number into v_order_number;

  -- 7. Insert Order Shell
  insert into public.orders (
    order_number,
    order_date,
    table_id,
    customer_name,
    customer_phone,
    status,
    payment_status,
    total_paise,
    idempotency_key
  )
  values (
    v_order_number,
    current_date,
    v_table_id,
    v_trimmed_name,
    '+91' || v_clean_phone,
    'received',
    'unpaid',
    0,
    p_idempotency_key
  )
  returning id into v_order_id;

  -- 8. Process Each Order Line
  for v_line in select * from jsonb_array_elements(p_items)
  loop
    v_item_id_text := coalesce(v_line->>'menuItemId', v_line->>'menu_item_id');
    begin
      v_item_id := v_item_id_text::uuid;
    exception when others then
      raise exception 'INVALID_ITEM_ID: Invalid menuItemId format';
    end;

    if v_item_id is null then
      raise exception 'INVALID_ITEM_ID: menuItemId is required';
    end if;

    v_qty := coalesce((v_line->>'quantity')::int, 0);
    if v_qty < 1 or v_qty > 20 then
      raise exception 'INVALID_QUANTITY: Quantity must be between 1 and 20';
    end if;

    v_notes := left(trim(coalesce(v_line->>'notes', '')), 200);

    select id, name, price_paise, is_available, deleted_at
    into v_item_rec
    from public.menu_items
    where id = v_item_id;

    if not found or v_item_rec.deleted_at is not null then
      raise exception 'ITEM_NOT_FOUND: Menu item does not exist or has been removed';
    end if;

    if not v_item_rec.is_available then
      raise exception 'ITEM_UNAVAILABLE: % is currently sold out', v_item_rec.name;
    end if;

    -- Server-side offer validation & pricing
    v_base_unit_price := v_item_rec.price_paise;
    v_offer_id_text := coalesce(v_line->>'offerId', v_line->>'offer_id');
    v_offer_id := null;
    if v_offer_id_text is not null and trim(v_offer_id_text) != '' then
      begin
        v_offer_id := v_offer_id_text::uuid;
      exception when others then
        raise exception 'OFFER_EXPIRED: Invalid offer reference for %', v_item_rec.name;
      end;

      select id, offer_price_paise, starts_at, ends_at, is_active
      into v_offer_rec
      from public.offers
      where id = v_offer_id and menu_item_id = v_item_id;

      if not found or not v_offer_rec.is_active or now() < v_offer_rec.starts_at or now() >= v_offer_rec.ends_at then
        raise exception 'OFFER_EXPIRED: The offer for % has expired', v_item_rec.name;
      end if;

      v_base_unit_price := v_offer_rec.offer_price_paise;
    else
      select offer_price_paise
      into v_offer_rec
      from public.offers
      where menu_item_id = v_item_id
        and is_active = true
        and now() >= starts_at
        and now() < ends_at
      order by offer_price_paise asc
      limit 1;

      if found then
        v_base_unit_price := v_offer_rec.offer_price_paise;
      end if;
    end if;

    v_opt_ids := array[]::uuid[];
    v_opt_json := coalesce(v_line->'optionIds', v_line->'option_ids');
    if v_opt_json is not null and jsonb_typeof(v_opt_json) = 'array' then
      for v_opt_id_json in select * from jsonb_array_elements(v_opt_json)
      loop
        begin
          v_opt_id := (v_opt_id_json#>>'{}')::uuid;
          v_opt_ids := array_append(v_opt_ids, v_opt_id);
        exception when others then
          raise exception 'INVALID_OPTION_ID: Invalid optionId format';
        end;
      end loop;
    end if;

    if array_length(v_opt_ids, 1) is not null then
      select count(distinct x) into v_distinct_count from unnest(v_opt_ids) as x;
      if v_distinct_count != array_length(v_opt_ids, 1) then
        raise exception 'DUPLICATE_OPTIONS: Duplicate options selected for %', v_item_rec.name;
      end if;
    end if;

    for v_group in
      select id, name, type, is_required, max_select
      from public.option_groups
      where menu_item_id = v_item_id
    loop
      select count(*)
      into v_selected_count
      from public.options
      where option_group_id = v_group.id
        and id = any(v_opt_ids);

      if v_group.is_required and v_selected_count < 1 then
        raise exception 'MISSING_REQUIRED_OPTION: Please select % for %', v_group.name, v_item_rec.name;
      end if;

      if v_group.type = 'single' and v_selected_count > 1 then
        raise exception 'INVALID_OPTION_COUNT: Only one selection allowed for %', v_group.name;
      end if;

      if v_group.type = 'multi' and v_group.max_select is not null and v_selected_count > v_group.max_select then
        raise exception 'MAX_OPTIONS_EXCEEDED: Maximum % selections allowed for %', v_group.max_select, v_group.name;
      end if;
    end loop;

    if array_length(v_opt_ids, 1) is not null then
      select count(*)
      into v_selected_count
      from public.options o
      join public.option_groups og on og.id = o.option_group_id
      where og.menu_item_id = v_item_id
        and o.id = any(v_opt_ids);

      if v_selected_count != array_length(v_opt_ids, 1) then
        raise exception 'INVALID_OPTION_FOR_ITEM: One or more options do not belong to %', v_item_rec.name;
      end if;
    end if;

    v_line_unit_price := v_base_unit_price;

    if array_length(v_opt_ids, 1) is not null then
      select v_line_unit_price + coalesce(sum(price_paise), 0)
      into v_line_unit_price
      from public.options
      where id = any(v_opt_ids);
    end if;

    v_line_total := v_line_unit_price * v_qty;
    v_order_total := v_order_total + v_line_total;

    insert into public.order_items (
      order_id,
      menu_item_id,
      name_snapshot,
      unit_price_paise,
      quantity,
      notes
    )
    values (
      v_order_id,
      v_item_id,
      v_item_rec.name,
      v_line_unit_price,
      v_qty,
      nullif(v_notes, '')
    )
    returning id into v_order_item_id;

    if array_length(v_opt_ids, 1) is not null then
      insert into public.order_item_options (
        order_item_id,
        name_snapshot,
        price_paise
      )
      select
        v_order_item_id,
        name,
        price_paise
      from public.options
      where id = any(v_opt_ids);
    end if;
  end loop;

  update public.orders
  set total_paise = v_order_total
  where id = v_order_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total_paise', v_order_total,
    'status', 'received'
  );
end;
$$;

revoke execute on function public.place_order(text, text, jsonb, uuid, text) from public;
revoke execute on function public.place_order(text, text, jsonb, uuid, text) from anon;
grant execute on function public.place_order(text, text, jsonb, uuid, text) to service_role;

-- 5. Ensure Realtime publication covers orders and order_items
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object or undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.order_items;
exception when duplicate_object or undefined_object then null;
end $$;

-- 6. Admin-only Paid Tracking RPCs
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

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND: Order not found';
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
  values (p_order_id, v_order.total_paise, p_method, 'confirmed', v_now);

  return jsonb_build_object('order_id', p_order_id, 'payment_status', 'paid', 'method', p_method, 'paid_at', v_now);
end;
$$;

grant execute on function public.mark_order_paid(uuid, text) to authenticated;

create or replace function public.undo_order_paid(
  p_order_id uuid
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

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND: Order not found';
  end if;

  v_history := coalesce(v_order.payment_history, '[]'::jsonb) || jsonb_build_object(
    'action', 'undo_paid',
    'previous_method', v_order.payment_method,
    'timestamp', v_now
  );

  update public.orders
  set payment_status = 'unpaid',
      paid_at = null,
      payment_method = null,
      payment_history = v_history,
      updated_at = v_now
  where id = p_order_id;

  update public.payments
  set status = 'voided'
  where order_id = p_order_id and status = 'confirmed';

  return jsonb_build_object('order_id', p_order_id, 'payment_status', 'unpaid');
end;
$$;

grant execute on function public.undo_order_paid(uuid) to authenticated;
