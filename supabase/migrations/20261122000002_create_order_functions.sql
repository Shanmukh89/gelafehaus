-- ============================================================
-- Migration: place_order() and update_order_status() functions
-- ============================================================

-- ------------------------------------------------------------
-- 1. Function: public.place_order()
-- Callable by anon & authenticated
-- Security definer: runs with elevated privileges to insert order,
-- validating all business rules, prices, and availability internally.
-- ------------------------------------------------------------
create or replace function public.place_order(
  p_table text,
  p_customer_name text,
  p_items jsonb,
  p_idempotency_key uuid
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
  v_order_number int;
  v_order_id uuid;
  v_order_total int := 0;

  v_line jsonb;
  v_qty int;
  v_notes text;
  v_item_id uuid;
  v_item_rec record;

  v_opt_id_json jsonb;
  v_opt_id uuid;
  v_opt_ids uuid[];
  v_opt_rec record;

  v_group record;
  v_selected_count int;
  v_distinct_count int;

  v_line_unit_price int;
  v_line_total int;
  v_order_item_id uuid;
begin
  -- 1. Idempotency Check
  -- If order with this idempotency key already exists, return it immediately
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

  -- 3. Validate Customer Name (1-60 chars, trimmed)
  v_trimmed_name := trim(p_customer_name);
  if v_trimmed_name is null or length(v_trimmed_name) = 0 then
    raise exception 'INVALID_CUSTOMER_NAME: Customer name is required';
  end if;

  if length(v_trimmed_name) > 60 then
    raise exception 'INVALID_CUSTOMER_NAME: Customer name cannot exceed 60 characters';
  end if;

  -- 4. Validate Items Array (1-30 lines)
  if p_items is null or jsonb_typeof(p_items) != 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'INVALID_ITEMS: Order must contain at least 1 item';
  end if;

  if jsonb_array_length(p_items) > 30 then
    raise exception 'INVALID_ITEMS: Order cannot exceed 30 items';
  end if;

  -- Pre-validate all lines and calculate total price
  for v_line in select * from jsonb_array_elements(p_items)
  loop
    -- Quantity check (1-20)
    v_qty := (v_line->>'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'INVALID_QUANTITY: Quantity must be between 1 and 20';
    end if;

    -- Notes check (<= 140 chars)
    v_notes := trim(v_line->>'notes');
    if v_notes is not null and length(v_notes) > 140 then
      raise exception 'INVALID_NOTES: Notes cannot exceed 140 characters';
    end if;

    -- Menu Item existence and availability
    v_item_id := (v_line->>'menu_item_id')::uuid;
    if v_item_id is null then
      raise exception 'INVALID_ITEMS: menu_item_id is required for each line';
    end if;

    select id, name, price_paise, is_available
    into v_item_rec
    from public.menu_items
    where id = v_item_id;

    if not found then
      raise exception 'ITEM_NOT_FOUND: Menu item % not found', v_item_id;
    end if;

    if not v_item_rec.is_available then
      raise exception 'ITEM_UNAVAILABLE: % is sold out', v_item_rec.name;
    end if;

    -- Parse option IDs for this line
    v_opt_ids := array[]::uuid[];
    if v_line->'option_ids' is not null and jsonb_typeof(v_line->'option_ids') = 'array' then
      for v_opt_id_json in select * from jsonb_array_elements(v_line->'option_ids')
      loop
        v_opt_id := (v_opt_id_json#>>'{}')::uuid;
        v_opt_ids := array_append(v_opt_ids, v_opt_id);
      end loop;
    end if;

    -- Validate each selected option
    if array_length(v_opt_ids, 1) > 0 then
      foreach v_opt_id in array v_opt_ids
      loop
        select o.id, o.name, o.price_paise, o.is_available, og.menu_item_id, og.name as group_name
        into v_opt_rec
        from public.options o
        join public.option_groups og on og.id = o.option_group_id
        where o.id = v_opt_id;

        if not found or v_opt_rec.menu_item_id != v_item_rec.id then
          raise exception 'INVALID_OPTION: Option % does not belong to %', v_opt_id, v_item_rec.name;
        end if;

        if not v_opt_rec.is_available then
          raise exception 'OPTION_UNAVAILABLE: % is unavailable', v_opt_rec.name;
        end if;
      end loop;
    end if;

    -- Validate Option Groups rules (required, single vs multi, max_select)
    for v_group in select * from public.option_groups where menu_item_id = v_item_rec.id
    loop
      if array_length(v_opt_ids, 1) > 0 then
        select
          count(*),
          count(distinct opt_id)
        into v_selected_count, v_distinct_count
        from unnest(v_opt_ids) as opt_id
        join public.options o on o.id = opt_id
        where o.option_group_id = v_group.id;
      else
        v_selected_count := 0;
        v_distinct_count := 0;
      end if;

      if v_selected_count != v_distinct_count then
        raise exception 'DUPLICATE_OPTION: Duplicate options selected for %', v_group.name;
      end if;

      if v_group.is_required and v_selected_count = 0 then
        raise exception 'REQUIRED_OPTION_MISSING: % is required for %', v_group.name, v_item_rec.name;
      end if;

      if v_group.type = 'single' and v_selected_count > 1 then
        raise exception 'INVALID_OPTION_SELECTION: Only one option allowed for % on %', v_group.name, v_item_rec.name;
      end if;

      if v_group.max_select is not null and v_selected_count > v_group.max_select then
        raise exception 'MAX_OPTIONS_EXCEEDED: Maximum % option(s) allowed for % on %', v_group.max_select, v_group.name, v_item_rec.name;
      end if;
    end loop;

    -- Calculate line total
    v_line_unit_price := v_item_rec.price_paise;
    if array_length(v_opt_ids, 1) > 0 then
      v_line_unit_price := v_line_unit_price + coalesce((
        select sum(price_paise)::int
        from public.options
        where id = any(v_opt_ids)
      ), 0);
    end if;

    v_order_total := v_order_total + (v_line_unit_price * v_qty);
  end loop;

  -- 5. Safe Concurrent Order Number Assignment (Daily Reset)
  -- Uses advisory xact lock hashed by date to prevent race conditions
  perform pg_advisory_xact_lock(hashtext('gelafehaus_order_num_' || current_date::text));

  select coalesce(max(order_number), 0) + 1
  into v_order_number
  from public.orders
  where order_date = current_date;

  -- 6. Insert Order
  insert into public.orders (
    order_number,
    order_date,
    table_id,
    customer_name,
    status,
    total_paise,
    idempotency_key
  ) values (
    v_order_number,
    current_date,
    v_table_id,
    v_trimmed_name,
    'received',
    v_order_total,
    p_idempotency_key
  )
  returning id into v_order_id;

  -- 7. Insert Order Items & Item Options with snapshots
  for v_line in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_line->>'quantity')::int;
    v_notes := trim(v_line->>'notes');
    v_item_id := (v_line->>'menu_item_id')::uuid;

    select id, name, price_paise
    into v_item_rec
    from public.menu_items
    where id = v_item_id;

    -- Re-fetch options for line
    v_opt_ids := array[]::uuid[];
    if v_line->'option_ids' is not null and jsonb_typeof(v_line->'option_ids') = 'array' then
      for v_opt_id_json in select * from jsonb_array_elements(v_line->'option_ids')
      loop
        v_opt_id := (v_opt_id_json#>>'{}')::uuid;
        v_opt_ids := array_append(v_opt_ids, v_opt_id);
      end loop;
    end if;

    -- Compute unit price snapshot (item base price + options)
    v_line_unit_price := v_item_rec.price_paise;
    if array_length(v_opt_ids, 1) > 0 then
      v_line_unit_price := v_line_unit_price + coalesce((
        select sum(price_paise)::int
        from public.options
        where id = any(v_opt_ids)
      ), 0);
    end if;

    -- Insert order_item
    insert into public.order_items (
      order_id,
      menu_item_id,
      name_snapshot,
      unit_price_paise,
      quantity,
      notes
    ) values (
      v_order_id,
      v_item_rec.id,
      v_item_rec.name,
      v_line_unit_price,
      v_qty,
      v_notes
    )
    returning id into v_order_item_id;

    -- Insert order_item_options
    if array_length(v_opt_ids, 1) > 0 then
      insert into public.order_item_options (
        order_item_id,
        option_id,
        name_snapshot,
        price_paise
      )
      select
        v_order_item_id,
        o.id,
        o.name,
        o.price_paise
      from public.options o
      where o.id = any(v_opt_ids);
    end if;
  end loop;

  -- 8. Return response object
  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total_paise', v_order_total,
    'status', 'received'
  );
end;
$$;

grant execute on function public.place_order(text, text, jsonb, uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 2. Function: public.update_order_status()
-- Admin only (verified via public.is_admin())
-- Enforces allowed transitions:
--   received -> preparing | rejected
--   preparing -> ready
--   ready -> completed
-- Rejection requires a reason.
-- ------------------------------------------------------------
create or replace function public.update_order_status(
  p_order_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status text;
  v_trimmed_reason text := trim(p_reason);
begin
  -- 1. Admin Authentication Check
  if not public.is_admin() then
    raise exception 'UNAUTHORIZED: Admin access required';
  end if;

  -- 2. Validate Order Existence
  select status into v_current_status
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND: Order % not found', p_order_id;
  end if;

  -- 3. Enforce Allowed Transitions
  if v_current_status = 'received' and p_status not in ('preparing', 'rejected') then
    raise exception 'INVALID_STATUS_TRANSITION: Cannot transition order from % to %', v_current_status, p_status;
  elsif v_current_status = 'preparing' and p_status != 'ready' then
    raise exception 'INVALID_STATUS_TRANSITION: Cannot transition order from % to %', v_current_status, p_status;
  elsif v_current_status = 'ready' and p_status != 'completed' then
    raise exception 'INVALID_STATUS_TRANSITION: Cannot transition order from % to %', v_current_status, p_status;
  elsif v_current_status in ('completed', 'rejected') then
    raise exception 'INVALID_STATUS_TRANSITION: Order is already % and cannot be updated', v_current_status;
  end if;

  -- 4. Rejection requires a non-empty reason
  if p_status = 'rejected' then
    if v_trimmed_reason is null or length(v_trimmed_reason) = 0 then
      raise exception 'REJECTION_REASON_REQUIRED: A reason is required when rejecting an order';
    end if;
  else
    v_trimmed_reason := null;
  end if;

  -- 5. Perform Update
  update public.orders
  set
    status = p_status,
    reject_reason = v_trimmed_reason,
    updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'status', p_status,
    'reject_reason', v_trimmed_reason
  );
end;
$$;

grant execute on function public.update_order_status(uuid, text, text) to authenticated;
