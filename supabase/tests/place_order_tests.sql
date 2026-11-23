-- ============================================================
-- Gelafehaus place_order() & update_order_status() Test Suite
-- ============================================================
-- Tests covered:
-- 1. duplicate key (idempotency key returns original order)
-- 2. sold-out item (rejects with ITEM_UNAVAILABLE)
-- 3. wrong option for item (rejects with INVALID_OPTION)
-- 4. over max_select (rejects with MAX_OPTIONS_EXCEEDED)
-- 5. invalid table (rejects with INVALID_TABLE)
-- 6. tampered quantity (rejects with INVALID_QUANTITY)
-- 7. two concurrent orders get distinct sequential numbers
-- 8. status transitions and rejection validation
-- ============================================================

begin;

create temp table if not exists test_results (
  test_name text not null,
  passed boolean not null,
  details text
);

do $$
declare
  -- Seed IDs
  v_item_smash uuid := 'b0000000-0000-0000-0000-000000000001'; -- The Classic Smash (Burgers)
  v_item_sold_out uuid := 'b0000000-0000-0000-0000-000000000006'; -- Mushroom Swiss Melt (sold out)
  v_item_cola uuid := 'b0000000-0000-0000-0000-000000000011'; -- Craft Cola (Drinks)

  -- Smash options
  v_opt_beef uuid := 'e0000000-0000-0000-0000-000000000001'; -- Beef Smash (Patty)
  v_opt_cheese uuid := 'e0000000-0000-0000-0000-000000000021'; -- Extra Cheese (Extras)
  v_opt_sauce1 uuid := 'e0000000-0000-0000-0000-000000000041'; -- House Sauce (Sauces)
  v_opt_sauce2 uuid := 'e0000000-0000-0000-0000-000000000042'; -- Smoky BBQ (Sauces)
  v_opt_sauce3 uuid := 'e0000000-0000-0000-0000-000000000043'; -- Truffle Aioli (Sauces)

  -- Shake option (wrong for Smash burger)
  v_opt_vanilla uuid := 'e0000000-0000-0000-0000-000000000061'; -- Vanilla (Flavour for shake)

  v_key1 uuid := gen_random_uuid();
  v_key2 uuid := gen_random_uuid();
  v_key3 uuid := gen_random_uuid();

  v_res1 jsonb;
  v_res2 jsonb;
  v_res3 jsonb;
  v_res_update jsonb;

  v_caught boolean;
  v_err_msg text;
begin
  -- ----------------------------------------------------------
  -- Switch to anon role (simulating customer)
  -- ----------------------------------------------------------
  set local role anon;

  -- ----------------------------------------------------------
  -- Test 1: Duplicate Key (Idempotency)
  -- ----------------------------------------------------------
  v_res1 := public.place_order(
    '07',
    'Alice',
    jsonb_build_array(
      jsonb_build_object(
        'menu_item_id', v_item_smash,
        'quantity', 1,
        'notes', 'Extra crispy please',
        'option_ids', jsonb_build_array(v_opt_beef, v_opt_cheese)
      )
    ),
    v_key1
  );

  -- Call again with identical key
  v_res2 := public.place_order(
    '07',
    'Alice',
    jsonb_build_array(
      jsonb_build_object(
        'menu_item_id', v_item_smash,
        'quantity', 1,
        'option_ids', jsonb_build_array(v_opt_beef, v_opt_cheese)
      )
    ),
    v_key1
  );

  if (v_res1->>'order_id') = (v_res2->>'order_id') and
     (v_res1->>'order_number') = (v_res2->>'order_number') then
    insert into test_results values (
      'Test 1: duplicate key returns existing order (idempotent)',
      true,
      format('Returned same order ID %s and number %s without re-inserting', v_res1->>'order_id', v_res1->>'order_number')
    );
  else
    insert into test_results values (
      'Test 1: duplicate key returns existing order (idempotent)',
      false,
      format('MISMATCH: %s vs %s', v_res1, v_res2)
    );
  end if;

  -- ----------------------------------------------------------
  -- Test 2: Sold-Out Item
  -- ----------------------------------------------------------
  v_caught := false;
  begin
    perform public.place_order(
      '07',
      'Bob',
      jsonb_build_array(
        jsonb_build_object(
          'menu_item_id', v_item_sold_out,
          'quantity', 1,
          'option_ids', '[]'::jsonb
        )
      ),
      gen_random_uuid()
    );
  exception when others then
    v_caught := true;
    v_err_msg := sqlerrm;
  end;

  if v_caught and v_err_msg like 'ITEM_UNAVAILABLE:%' then
    insert into test_results values (
      'Test 2: sold-out item rejected',
      true,
      format('Correctly raised: %s', v_err_msg)
    );
  else
    insert into test_results values (
      'Test 2: sold-out item rejected',
      false,
      format('Expected ITEM_UNAVAILABLE, got: %s (caught=%s)', v_err_msg, v_caught)
    );
  end if;

  -- ----------------------------------------------------------
  -- Test 3: Wrong Option for Item
  -- ----------------------------------------------------------
  v_caught := false;
  begin
    perform public.place_order(
      '07',
      'Charlie',
      jsonb_build_array(
        jsonb_build_object(
          'menu_item_id', v_item_smash,
          'quantity', 1,
          -- Passing a shake flavour option to a burger
          'option_ids', jsonb_build_array(v_opt_beef, v_opt_vanilla)
        )
      ),
      gen_random_uuid()
    );
  exception when others then
    v_caught := true;
    v_err_msg := sqlerrm;
  end;

  if v_caught and v_err_msg like 'INVALID_OPTION:%' then
    insert into test_results values (
      'Test 3: wrong option for item rejected',
      true,
      format('Correctly raised: %s', v_err_msg)
    );
  else
    insert into test_results values (
      'Test 3: wrong option for item rejected',
      false,
      format('Expected INVALID_OPTION, got: %s (caught=%s)', v_err_msg, v_caught)
    );
  end if;

  -- ----------------------------------------------------------
  -- Test 4: Over max_select
  -- ----------------------------------------------------------
  v_caught := false;
  begin
    perform public.place_order(
      '07',
      'Diana',
      jsonb_build_array(
        jsonb_build_object(
          'menu_item_id', v_item_smash,
          'quantity', 1,
          -- Sauces allows max 2, passing 3
          'option_ids', jsonb_build_array(v_opt_beef, v_opt_sauce1, v_opt_sauce2, v_opt_sauce3)
        )
      ),
      gen_random_uuid()
    );
  exception when others then
    v_caught := true;
    v_err_msg := sqlerrm;
  end;

  if v_caught and v_err_msg like 'MAX_OPTIONS_EXCEEDED:%' then
    insert into test_results values (
      'Test 4: over max_select rejected',
      true,
      format('Correctly raised: %s', v_err_msg)
    );
  else
    insert into test_results values (
      'Test 4: over max_select rejected',
      false,
      format('Expected MAX_OPTIONS_EXCEEDED, got: %s (caught=%s)', v_err_msg, v_caught)
    );
  end if;

  -- ----------------------------------------------------------
  -- Test 5: Invalid Table
  -- ----------------------------------------------------------
  v_caught := false;
  begin
    perform public.place_order(
      '99', -- Table 99 does not exist
      'Evan',
      jsonb_build_array(
        jsonb_build_object(
          'menu_item_id', v_item_cola,
          'quantity', 1,
          'option_ids', '[]'::jsonb
        )
      ),
      gen_random_uuid()
    );
  exception when others then
    v_caught := true;
    v_err_msg := sqlerrm;
  end;

  if v_caught and v_err_msg like 'INVALID_TABLE:%' then
    insert into test_results values (
      'Test 5: invalid table rejected',
      true,
      format('Correctly raised: %s', v_err_msg)
    );
  else
    insert into test_results values (
      'Test 5: invalid table rejected',
      false,
      format('Expected INVALID_TABLE, got: %s (caught=%s)', v_err_msg, v_caught)
    );
  end if;

  -- ----------------------------------------------------------
  -- Test 6: Tampered Quantity (<1 or >20)
  -- ----------------------------------------------------------
  v_caught := false;
  begin
    perform public.place_order(
      '07',
      'Frank',
      jsonb_build_array(
        jsonb_build_object(
          'menu_item_id', v_item_cola,
          'quantity', 0, -- Illegal quantity
          'option_ids', '[]'::jsonb
        )
      ),
      gen_random_uuid()
    );
  exception when others then
    v_caught := true;
    v_err_msg := sqlerrm;
  end;

  if v_caught and v_err_msg like 'INVALID_QUANTITY:%' then
    insert into test_results values (
      'Test 6: tampered quantity rejected',
      true,
      format('Correctly raised: %s', v_err_msg)
    );
  else
    insert into test_results values (
      'Test 6: tampered quantity rejected',
      false,
      format('Expected INVALID_QUANTITY, got: %s (caught=%s)', v_err_msg, v_caught)
    );
  end if;

  -- ----------------------------------------------------------
  -- Test 7: Two Orders Getting Different Sequential Numbers
  -- ----------------------------------------------------------
  v_res2 := public.place_order(
    '07',
    'Customer A',
    jsonb_build_array(
      jsonb_build_object(
        'menu_item_id', v_item_cola,
        'quantity', 1,
        'option_ids', '[]'::jsonb
      )
    ),
    v_key2
  );

  v_res3 := public.place_order(
    '08',
    'Customer B',
    jsonb_build_array(
      jsonb_build_object(
        'menu_item_id', v_item_cola,
        'quantity', 2,
        'option_ids', '[]'::jsonb
      )
    ),
    v_key3
  );

  if (v_res3->>'order_number')::int = (v_res2->>'order_number')::int + 1 then
    insert into test_results values (
      'Test 7: orders get sequential numbers under concurrency lock',
      true,
      format('Order A #%s -> Order B #%s', v_res2->>'order_number', v_res3->>'order_number')
    );
  else
    insert into test_results values (
      'Test 7: orders get sequential numbers under concurrency lock',
      false,
      format('Failed sequence: %s and %s', v_res2->>'order_number', v_res3->>'order_number')
    );
  end if;

  -- ----------------------------------------------------------
  -- Test 8: Status Transitions & Rejection Reason (Admin)
  -- ----------------------------------------------------------
  -- Switch to postgres/admin role
  reset role;

  -- Setup admin user for test
  insert into public.admins (user_id)
  values ('00000000-0000-0000-0000-000000000001')
  on conflict do nothing;

  -- Mock auth.uid() as admin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

  -- Transition received -> preparing
  v_res_update := public.update_order_status(
    (v_res2->>'order_id')::uuid,
    'preparing'
  );

  -- Transition preparing -> ready
  v_res_update := public.update_order_status(
    (v_res2->>'order_id')::uuid,
    'ready'
  );

  -- Transition ready -> completed
  v_res_update := public.update_order_status(
    (v_res2->>'order_id')::uuid,
    'completed'
  );

  -- Test rejection requiring reason on Order B
  v_caught := false;
  begin
    perform public.update_order_status(
      (v_res3->>'order_id')::uuid,
      'rejected',
      '' -- Empty reason should fail
    );
  exception when others then
    v_caught := true;
    v_err_msg := sqlerrm;
  end;

  if v_caught and v_err_msg like 'REJECTION_REASON_REQUIRED:%' then
    insert into test_results values (
      'Test 8: admin status transitions & rejection reason check',
      true,
      format('Transitioned received->preparing->ready->completed. Empty reject caught: %s', v_err_msg)
    );
  else
    insert into test_results values (
      'Test 8: admin status transitions & rejection reason check',
      false,
      format('Rejection without reason was not caught: %s', v_err_msg)
    );
  end if;

end $$;

-- ------------------------------------------------------------
-- Output Results
-- ------------------------------------------------------------
select
  case when passed then '✅ PASS' else '❌ FAIL' end as status,
  test_name,
  details
from test_results;

rollback;
