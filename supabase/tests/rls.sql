-- ============================================================
-- Gelafehaus RLS Security Verification Tests
-- ============================================================
-- Proves the 4 required security guarantees:
-- 1. anon cannot select orders (returns 0 rows / denied)
-- 2. anon cannot update menu prices (0 rows affected / denied)
-- 3. anon cannot insert into orders directly (denied by RLS)
-- 4. anon can call get_order_status with a valid UUID
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Test Setup (run as superuser/postgres)
-- ------------------------------------------------------------
create temp table if not exists test_results (
  test_name text not null,
  passed boolean not null,
  details text
);

do $$
declare
  v_test_order_id uuid := 'f0000000-0000-0000-0000-000000000001';
  v_test_item_id uuid := 'b0000000-0000-0000-0000-000000000001';
  v_order_count int;
  v_rows_affected int;
  v_original_price int;
  v_current_price int;
  v_insert_blocked boolean := false;
  v_status_order_number int;
  v_status_customer text;
  v_status_items json;
begin
  -- 1. Create a known test order under superuser
  delete from public.orders where id = v_test_order_id;
  insert into public.orders (
    id, order_number, order_date, table_id, customer_name,
    status, total_paise, idempotency_key
  ) values (
    v_test_order_id, 999, current_date, 'd0000000-0000-0000-0000-000000000001',
    'Test Customer', 'received', 24900, 'e0000000-0000-0000-0000-000000000099'
  );

  insert into public.order_items (
    order_id, menu_item_id, name_snapshot, unit_price_paise, quantity
  ) values (
    v_test_order_id, v_test_item_id, 'The Classic Smash', 24900, 1
  );

  -- Get original price of item 1
  select price_paise into v_original_price from public.menu_items where id = v_test_item_id;

  -- ----------------------------------------------------------
  -- Switch session to 'anon' role
  -- ----------------------------------------------------------
  set local role anon;

  -- ----------------------------------------------------------
  -- Proof 1: anon cannot select orders directly
  -- ----------------------------------------------------------
  select count(*) into v_order_count from public.orders;
  if v_order_count = 0 then
    insert into test_results values (
      'Proof 1: anon cannot select orders',
      true,
      format('RLS filtered all orders (returned %s rows out of seeded orders)', v_order_count)
    );
  else
    insert into test_results values (
      'Proof 1: anon cannot select orders',
      false,
      format('LEAK: anon was able to select %s orders', v_order_count)
    );
  end if;

  -- ----------------------------------------------------------
  -- Proof 2: anon cannot update menu prices
  -- ----------------------------------------------------------
  update public.menu_items
  set price_paise = 1
  where id = v_test_item_id;
  get diagnostics v_rows_affected = row_count;

  -- Switch back to verify data integrity
  reset role;
  select price_paise into v_current_price from public.menu_items where id = v_test_item_id;
  set local role anon;

  if v_rows_affected = 0 and v_current_price = v_original_price then
    insert into test_results values (
      'Proof 2: anon cannot update menu prices',
      true,
      format('Update blocked by RLS (0 rows updated, price remained %s paise)', v_current_price)
    );
  else
    insert into test_results values (
      'Proof 2: anon cannot update menu prices',
      false,
      format('BREACH: anon updated %s rows, price changed to %s', v_rows_affected, v_current_price)
    );
  end if;

  -- ----------------------------------------------------------
  -- Proof 3: anon cannot insert into orders directly
  -- ----------------------------------------------------------
  begin
    insert into public.orders (
      order_number, table_id, customer_name, total_paise, idempotency_key
    ) values (
      888, 'd0000000-0000-0000-0000-000000000001', 'Attacker', 100, gen_random_uuid()
    );
    v_insert_blocked := false;
  exception
    when insufficient_privilege or others then
      v_insert_blocked := true;
  end;

  -- Also check if row was inserted if no exception was raised
  if not v_insert_blocked then
    reset role;
    select not exists(select 1 from public.orders where customer_name = 'Attacker') into v_insert_blocked;
    set local role anon;
  end if;

  if v_insert_blocked then
    insert into test_results values (
      'Proof 3: anon cannot insert into orders directly',
      true,
      'Direct order insertion blocked by RLS policies'
    );
  else
    insert into test_results values (
      'Proof 3: anon cannot insert into orders directly',
      false,
      'BREACH: anon successfully inserted an order directly'
    );
  end if;

  -- ----------------------------------------------------------
  -- Proof 4: anon CAN call get_order_status with valid UUID
  -- ----------------------------------------------------------
  select order_number, customer_name, items
  into v_status_order_number, v_status_customer, v_status_items
  from public.get_order_status(v_test_order_id);

  if v_status_order_number = 999 and v_status_customer = 'Test Customer' and v_status_items is not null then
    insert into test_results values (
      'Proof 4: anon can call get_order_status with valid id',
      true,
      format('Order #%s (%s) returned with items JSON: %s', v_status_order_number, v_status_customer, substr(v_status_items::text, 1, 40) || '...')
    );
  else
    insert into test_results values (
      'Proof 4: anon can call get_order_status with valid id',
      false,
      'Failed to retrieve order status via security definer RPC'
    );
  end if;

  reset role;
end $$;

-- ------------------------------------------------------------
-- Display Test Results
-- ------------------------------------------------------------
select
  case when passed then '✅ PASS' else '❌ FAIL' end as status,
  test_name,
  details
from test_results;

-- Ensure transaction leaves no trace
rollback;
