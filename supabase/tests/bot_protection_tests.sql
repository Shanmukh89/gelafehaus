-- ============================================================
-- Gelafehaus Bot & Spam Protection SQL Verification
-- ============================================================
-- Tests:
-- 1. Calling public.place_order() directly as 'anon' FAILS with permission denied.
-- 2. Calling public.place_order() as 'service_role' SUCCEEDS.
-- ============================================================

begin;

create temp table if not exists test_results (
  test_name text not null,
  passed boolean not null,
  details text
);

do $$
declare
  v_caught boolean := false;
  v_err_msg text := '';
  v_res jsonb;
  v_item_smash uuid := 'b0000000-0000-0000-0000-000000000001';
  v_opt_beef uuid := 'e0000000-0000-0000-0000-000000000001';
begin
  -- ----------------------------------------------------------
  -- Test 1: Direct call as 'anon' must FAIL (permission denied)
  -- ----------------------------------------------------------
  set local role anon;

  begin
    perform public.place_order(
      '07',
      'Anon Hacker',
      jsonb_build_array(
        jsonb_build_object(
          'menu_item_id', v_item_smash,
          'quantity', 1,
          'option_ids', jsonb_build_array(v_opt_beef)
        )
      ),
      gen_random_uuid()
    );
  exception
    when insufficient_privilege or others then
      v_caught := true;
      v_err_msg := sqlerrm;
  end;

  if v_caught and (v_err_msg like '%permission denied%' or v_err_msg like '%insufficient_privilege%') then
    insert into test_results values (
      'Test 1: direct place_order() call by anon is rejected',
      true,
      format('Correctly blocked with error: %s', v_err_msg)
    );
  else
    insert into test_results values (
      'Test 1: direct place_order() call by anon is rejected',
      false,
      format('SECURITY BREACH: anon was able to execute place_order() or unexpected error: %s (caught=%s)', v_err_msg, v_caught)
    );
  end if;

  -- ----------------------------------------------------------
  -- Test 2: Call as 'service_role' must SUCCEED
  -- ----------------------------------------------------------
  reset role;
  set local role service_role;

  v_caught := false;
  begin
    v_res := public.place_order(
      '07',
      'Edge Function Service',
      jsonb_build_array(
        jsonb_build_object(
          'menu_item_id', v_item_smash,
          'quantity', 1,
          'option_ids', jsonb_build_array(v_opt_beef)
        )
      ),
      gen_random_uuid()
    );
  exception
    when others then
      v_caught := true;
      v_err_msg := sqlerrm;
  end;

  if not v_caught and (v_res->>'order_id') is not null then
    insert into test_results values (
      'Test 2: service_role can execute place_order() via Edge Function',
      true,
      format('Order placed successfully: #%s (ID: %s)', v_res->>'order_number', v_res->>'order_id')
    );
  else
    insert into test_results values (
      'Test 2: service_role can execute place_order() via Edge Function',
      false,
      format('Failed to execute as service_role: %s', v_err_msg)
    );
  end if;

  reset role;
end $$;

select
  case when passed then '✅ PASS' else '❌ FAIL' end as status,
  test_name,
  details
from test_results;

rollback;
