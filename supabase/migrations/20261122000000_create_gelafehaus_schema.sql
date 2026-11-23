-- ============================================================
-- Gelafehaus Schema Migration
-- ============================================================

-- 1. Categories
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0
);

-- 2. Menu Items
create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  name text not null,
  description text,
  image_url text,
  price_paise int not null check (price_paise >= 0),
  is_available boolean not null default true,
  sort_order int not null default 0
);

-- 3. Option Groups
create table if not exists public.option_groups (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  name text not null,
  type text not null check (type in ('single', 'multi')),
  is_required boolean not null default false,
  max_select int null check (max_select is null or max_select > 0)
);

-- 4. Options
create table if not exists public.options (
  id uuid primary key default gen_random_uuid(),
  option_group_id uuid not null references public.option_groups(id) on delete cascade,
  name text not null,
  price_paise int not null default 0 check (price_paise >= 0),
  is_available boolean not null default true
);

-- 5. Tables
create table if not exists public.tables (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  is_active boolean not null default true
);

-- 6. Orders
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number int not null,
  order_date date not null default current_date,
  table_id uuid not null references public.tables(id) on delete restrict,
  customer_name text not null,
  status text not null check (status in ('received', 'preparing', 'ready', 'completed', 'rejected')) default 'received',
  reject_reason text null,
  total_paise int not null check (total_paise >= 0),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_order_date_order_number_key unique (order_date, order_number)
);

-- 7. Order Items (snapshots name and base price)
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name_snapshot text not null,
  unit_price_paise int not null check (unit_price_paise >= 0),
  quantity int not null check (quantity > 0),
  notes text null
);

-- 8. Order Item Options (snapshots option name and option price)
create table if not exists public.order_item_options (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  option_id uuid references public.options(id) on delete set null,
  name_snapshot text not null,
  price_paise int not null default 0 check (price_paise >= 0)
);

-- 9. Admins
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_orders_status_created_at on public.orders (status, created_at desc);
create index if not exists idx_orders_order_date on public.orders (order_date);
create index if not exists idx_order_items_order_id on public.order_items (order_id);
create index if not exists idx_menu_items_category_id on public.menu_items (category_id);

create index if not exists idx_option_groups_menu_item_id on public.option_groups (menu_item_id);
create index if not exists idx_options_option_group_id on public.options (option_group_id);
create index if not exists idx_order_item_options_order_item_id on public.order_item_options (order_item_id);

-- ============================================================
-- Updated At Trigger on Orders
-- ============================================================
create or replace function public.set_orders_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_orders_updated_at on public.orders;

create trigger trigger_orders_updated_at
before update on public.orders
for each row
execute function public.set_orders_updated_at();
