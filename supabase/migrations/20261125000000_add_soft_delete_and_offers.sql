-- ============================================================
-- Migration: Add Soft Delete (deleted_at) and Limited-Time Offers
-- ============================================================

-- 1. Soft Delete on Menu Items
alter table public.menu_items
  add column if not exists deleted_at timestamptz default null;

-- Update RLS for menu_items: customer queries ignore soft-deleted items, admins see all
drop policy if exists "menu_items_select_public" on public.menu_items;
create policy "menu_items_select_public"
  on public.menu_items for select
  to anon, authenticated
  using (deleted_at is null or public.is_admin());

-- 2. Limited-Time Offers Table
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  label text not null,
  offer_price_paise int not null check (offer_price_paise >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint offers_ends_after_starts check (ends_at > starts_at)
);

-- Constraint via trigger: offer price must be strictly less than base price
create or replace function public.check_offer_price()
returns trigger
language plpgsql
as $$
declare
  v_base_price int;
begin
  select price_paise into v_base_price from public.menu_items where id = new.menu_item_id;
  if v_base_price is not null and new.offer_price_paise >= v_base_price then
    raise exception 'OFFER_PRICE_INVALID: Offer price must be strictly less than base price (% >= %)', new.offer_price_paise, v_base_price;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_offer_price on public.offers;
create trigger trg_check_offer_price
  before insert or update on public.offers
  for each row execute function public.check_offer_price();

-- RLS on offers: anon select only active offers within their window; admin full access
alter table public.offers enable row level security;

drop policy if exists "offers_select_public" on public.offers;
create policy "offers_select_public"
  on public.offers for select
  to anon, authenticated
  using (
    public.is_admin() or (
      is_active = true and
      starts_at <= now() and
      ends_at > now()
    )
  );

drop policy if exists "offers_insert_admin" on public.offers;
create policy "offers_insert_admin"
  on public.offers for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "offers_update_admin" on public.offers;
create policy "offers_update_admin"
  on public.offers for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "offers_delete_admin" on public.offers;
create policy "offers_delete_admin"
  on public.offers for delete
  to authenticated
  using (public.is_admin());

create index if not exists idx_offers_menu_item_id on public.offers (menu_item_id);
create index if not exists idx_offers_active_window on public.offers (is_active, starts_at, ends_at);

-- 3. Update place_order() to support soft-deleted menu_items & limited-time offers
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

  v_line_base_price int;
  v_line_unit_price int;
  v_order_item_id uuid;

  v_offer_id_claimed uuid;
  v_offer_rec record;
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

  -- 4. Validate Items Array
  if p_items is null or jsonb_typeof(p_items) != 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'INVALID_ITEMS: Order must contain at least 1 item';
  end if;

  if jsonb_array_length(p_items) > 30 then
    raise exception 'INVALID_ITEMS: Order cannot exceed 30 items';
  end if;

  -- Pre-validate all lines and calculate total price
  for v_line in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_line->>'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'INVALID_QUANTITY: Quantity must be between 1 and 20';
    end if;

    v_notes := trim(v_line->>'notes');
    if v_notes is not null and length(v_notes) > 140 then
      raise exception 'INVALID_NOTES: Notes cannot exceed 140 characters';
    end if;

    v_item_id := (v_line->>'menu_item_id')::uuid;
    if v_item_id is null then
      raise exception 'INVALID_ITEMS: menu_item_id is required for each line';
    end if;

    -- Ignore soft-deleted menu items
    select id, name, price_paise, is_available, deleted_at
    into v_item_rec
    from public.menu_items
    where id = v_item_id and deleted_at is null;

    if not found then
      raise exception 'ITEM_NOT_FOUND: Menu item % not found', v_item_id;
    end if;

    if not v_item_rec.is_available then
      raise exception 'ITEM_UNAVAILABLE: % is sold out', v_item_rec.name;
    end if;

    -- Check if client claimed an offer or if an active offer is live
    v_offer_id_claimed := null;
    if v_line->>'offer_id' is not null and trim(v_line->>'offer_id') != '' then
      v_offer_id_claimed := (v_line->>'offer_id')::uuid;
    end if;

    if v_offer_id_claimed is not null then
      select id, offer_price_paise, starts_at, ends_at, is_active
      into v_offer_rec
      from public.offers
      where id = v_offer_id_claimed and menu_item_id = v_item_rec.id;

      if not found or not v_offer_rec.is_active or v_offer_rec.ends_at <= now() or v_offer_rec.starts_at > now() then
        raise exception 'OFFER_EXPIRED: The offer for % has expired', v_item_rec.name;
      end if;

      v_line_base_price := v_offer_rec.offer_price_paise;
    else
      -- Check if an active offer currently exists for this item
      select id, offer_price_paise
      into v_offer_rec
      from public.offers
      where menu_item_id = v_item_rec.id
        and is_active = true
        and starts_at <= now()
        and ends_at > now()
      order by offer_price_paise asc
      limit 1;

      if found then
        v_line_base_price := v_offer_rec.offer_price_paise;
      else
        v_line_base_price := v_item_rec.price_paise;
      end if;
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

    v_line_unit_price := v_line_base_price;
    if array_length(v_opt_ids, 1) > 0 then
      v_line_unit_price := v_line_unit_price + coalesce((
        select sum(price_paise)::int
        from public.options
        where id = any(v_opt_ids)
      ), 0);
    end if;

    v_order_total := v_order_total + (v_line_unit_price * v_qty);
  end loop;

  -- 5. Concurrent Order Number Assignment
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
    where id = v_item_id and deleted_at is null;

    -- Check offer
    v_offer_id_claimed := null;
    if v_line->>'offer_id' is not null and trim(v_line->>'offer_id') != '' then
      v_offer_id_claimed := (v_line->>'offer_id')::uuid;
    end if;

    if v_offer_id_claimed is not null then
      select offer_price_paise
      into v_offer_rec
      from public.offers
      where id = v_offer_id_claimed;

      v_line_base_price := v_offer_rec.offer_price_paise;
    else
      select offer_price_paise
      into v_offer_rec
      from public.offers
      where menu_item_id = v_item_rec.id
        and is_active = true
        and starts_at <= now()
        and ends_at > now()
      order by offer_price_paise asc
      limit 1;

      if found then
        v_line_base_price := v_offer_rec.offer_price_paise;
      else
        v_line_base_price := v_item_rec.price_paise;
      end if;
    end if;

    v_opt_ids := array[]::uuid[];
    if v_line->'option_ids' is not null and jsonb_typeof(v_line->'option_ids') = 'array' then
      for v_opt_id_json in select * from jsonb_array_elements(v_line->'option_ids')
      loop
        v_opt_id := (v_opt_id_json#>>'{}')::uuid;
        v_opt_ids := array_append(v_opt_ids, v_opt_id);
      end loop;
    end if;

    v_line_unit_price := v_line_base_price;
    if array_length(v_opt_ids, 1) > 0 then
      v_line_unit_price := v_line_unit_price + coalesce((
        select sum(price_paise)::int
        from public.options
        where id = any(v_opt_ids)
      ), 0);
    end if;

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

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total_paise', v_order_total,
    'status', 'received'
  );
end;
$$;
