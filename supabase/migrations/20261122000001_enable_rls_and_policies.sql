-- ============================================================
-- Migration: Enable Row Level Security (RLS) & Define Policies
-- ============================================================

-- ------------------------------------------------------------
-- 1. Helper function: public.is_admin()
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.admins
    where user_id = auth.uid()
  );
$$;

grant execute on function public.is_admin() to authenticated, anon;

-- ------------------------------------------------------------
-- 2. Enable RLS on every table
-- ------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.option_groups enable row level security;
alter table public.options enable row level security;
alter table public.tables enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_options enable row level security;
alter table public.admins enable row level security;

-- ------------------------------------------------------------
-- 3. Menu & Reference Tables Policies
-- Anonymous & Authenticated: SELECT only (including sold-out items)
-- Admins: INSERT, UPDATE, DELETE
-- ------------------------------------------------------------

-- categories
create policy "categories_select_public"
  on public.categories for select
  to anon, authenticated
  using (true);

create policy "categories_insert_admin"
  on public.categories for insert
  to authenticated
  with check (public.is_admin());

create policy "categories_update_admin"
  on public.categories for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "categories_delete_admin"
  on public.categories for delete
  to authenticated
  using (public.is_admin());

-- menu_items
create policy "menu_items_select_public"
  on public.menu_items for select
  to anon, authenticated
  using (true);

create policy "menu_items_insert_admin"
  on public.menu_items for insert
  to authenticated
  with check (public.is_admin());

create policy "menu_items_update_admin"
  on public.menu_items for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "menu_items_delete_admin"
  on public.menu_items for delete
  to authenticated
  using (public.is_admin());

-- option_groups
create policy "option_groups_select_public"
  on public.option_groups for select
  to anon, authenticated
  using (true);

create policy "option_groups_insert_admin"
  on public.option_groups for insert
  to authenticated
  with check (public.is_admin());

create policy "option_groups_update_admin"
  on public.option_groups for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "option_groups_delete_admin"
  on public.option_groups for delete
  to authenticated
  using (public.is_admin());

-- options
create policy "options_select_public"
  on public.options for select
  to anon, authenticated
  using (true);

create policy "options_insert_admin"
  on public.options for insert
  to authenticated
  with check (public.is_admin());

create policy "options_update_admin"
  on public.options for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "options_delete_admin"
  on public.options for delete
  to authenticated
  using (public.is_admin());

-- tables
create policy "tables_select_public"
  on public.tables for select
  to anon, authenticated
  using (true);

create policy "tables_insert_admin"
  on public.tables for insert
  to authenticated
  with check (public.is_admin());

create policy "tables_update_admin"
  on public.tables for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "tables_delete_admin"
  on public.tables for delete
  to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- 4. Order Tables Policies
-- Anon has NO direct select, insert, update, delete
-- Admins have full access via is_admin()
-- ------------------------------------------------------------

-- orders
create policy "orders_admin_all"
  on public.orders for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- order_items
create policy "order_items_admin_all"
  on public.order_items for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- order_item_options
create policy "order_item_options_admin_all"
  on public.order_item_options for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- 5. Admins Table
-- No policies defined for anon or authenticated (default deny)
-- Only service_role can access
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 6. Helper function: public.get_order_status()
-- Allows customer to read their own order by UUID without table access
-- ------------------------------------------------------------
create or replace function public.get_order_status(p_order_id uuid)
returns table (
  order_number int,
  status text,
  customer_name text,
  total_paise int,
  items json
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return query
  select
    o.order_number,
    o.status,
    o.customer_name,
    o.total_paise,
    coalesce(
      (
        select json_agg(
          json_build_object(
            'id', oi.id,
            'name', oi.name_snapshot,
            'unit_price_paise', oi.unit_price_paise,
            'quantity', oi.quantity,
            'notes', oi.notes,
            'options', coalesce(
              (
                select json_agg(
                  json_build_object(
                    'name', oio.name_snapshot,
                    'price_paise', oio.price_paise
                  )
                  order by oio.name_snapshot
                )
                from public.order_item_options oio
                where oio.order_item_id = oi.id
              ),
              '[]'::json
            )
          )
          order by oi.id
        )
        from public.order_items oi
        where oi.order_id = o.id
      ),
      '[]'::json
    ) as items
  from public.orders o
  where o.id = p_order_id;
end;
$$;

grant execute on function public.get_order_status(uuid) to anon, authenticated;
