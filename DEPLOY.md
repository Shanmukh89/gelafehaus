# Gelafehaus — Production & Staging Deployment Guide

This document provides step-by-step instructions to deploy Gelafehaus to **Staging** and **Production** environments using **Supabase** (Postgres database, Auth, Realtime, Edge Functions) and **Cloudflare Pages** (Frontend SPA).

---

## Architecture Overview

```
                      ┌──────────────────────────────────────┐
                      │    Customer Mobile / Tablet Client   │
                      └──────────────────┬───────────────────┘
                                         │ (Scan Table QR: /menu?table=07)
                                         ▼
                      ┌──────────────────────────────────────┐
                      │    Cloudflare Pages (Global CDN)     │
                      │  - SPA Routing: public/_redirects    │
                      │  - Turnstile Invisible Challenge     │
                      └──────────┬───────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
                 ▼ (Edge Functions / RPC)        ▼ (Realtime / Queries)
   ┌───────────────────────────┐   ┌───────────────────────────┐
   │   Supabase Edge Function  │   │  Supabase Postgres DB     │
   │  `place-order`            │   │  - Row Level Security     │
   │  - Turnstile Verification │──▶│  - `place_order()` RPC    │
   │  - IP & Table Rate Limits │   │  - `get_order_status()`   │
   │  - Service Role Execution │   │  - Orders Realtime pub/sub│
   └───────────────────────────┘   └───────────────────────────┘
                                                 ▲
                                                 │
                                   ┌─────────────┴─────────────┐
                                   │   Kitchen Admin Dashboard │
                                   │   (/admin on Tablet)      │
                                   │   - Audio chime on orders │
                                   │   - Menu & Status manager │
                                   └───────────────────────────┘
```

---

## 1. Environments & Separation

Maintain **two completely isolated Supabase projects**:

| Configuration | Staging | Production |
|---|---|---|
| **Purpose** | Pre-release testing, QA, demo data | Live restaurant orders & payments |
| **Frontend Domain** | `https://staging.gelafehaus.pages.dev` | `https://order.gelafehaus.com` |
| **Supabase Project** | `gelafehaus-staging` | `gelafehaus-production` |
| **Turnstile Mode** | Test keys (`1x00000000000000000000AA`) | Live domain-bound Cloudflare keys |
| **Database** | Seed menu & demo orders | Live restaurant menu & tables |

---

## 2. Supabase Backend Deployment

Repeat these steps for both **Staging** and **Production** using their respective project reference IDs.

### Step 2.1: Login and Link Project

1. Login to the Supabase CLI:
   ```bash
   npx supabase login
   ```
2. Link your local codebase to your remote Supabase project:
   ```bash
   # For Staging:
   npx supabase link --project-ref <STAGING_PROJECT_REF>

   # For Production:
   npx supabase link --project-ref <PRODUCTION_PROJECT_REF>
   ```

### Step 2.2: Push Database Schema Migrations

Run `supabase db push` to apply the migrations in `supabase/migrations/`:
- `20261122000000_create_gelafehaus_schema.sql` (Tables, constraints, trigger)
- `20261122000001_enable_rls_and_policies.sql` (RLS policies, `is_admin()`, `get_order_status()`)
- `20261122000002_create_order_functions.sql` (`place_order()`, `update_order_status()`)
- `20261122000003_revoke_anon_place_order.sql` (Revoke direct anon execute)

```bash
npx supabase db push
```

### Step 2.3: Seed Tables and Menu Items

Apply the seed data containing tables `01`–`15`, categories, and 12 baseline items:
```bash
# Push seed.sql via psql or Supabase SQL Editor:
npx supabase db execute --file supabase/seed.sql
```
*(Alternatively, copy and paste the contents of `supabase/seed.sql` into the Supabase Dashboard SQL Editor).*

### Step 2.4: Configure Edge Function Secrets

Set the server-side secrets for the `place-order` Edge Function:

```bash
# For Staging:
npx supabase secrets set TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA

# For Production (retrieve from your Cloudflare Dashboard > Turnstile):
npx supabase secrets set TURNSTILE_SECRET_KEY=0x4AAAAAA...production_secret_key...
```

> [!IMPORTANT]
> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically provided by the Supabase Edge runtime. Never commit them to Git or store them in frontend `.env` files.

### Step 2.5: Deploy Edge Functions

Deploy the `place-order` function to the linked project:

```bash
npx supabase functions deploy place-order --no-verify-jwt
```
*(Flag `--no-verify-jwt` is used because the function is called publicly by customers and enforces its own Turnstile verification and rate limiting).*

### Step 2.6: Create the First Administrator

1. In the Supabase Dashboard, go to **Authentication > Users** and click **Add User > Create User**:
   - Email: `manager@gelafehaus.com`
   - Password: `[STRONG_RESTAURANT_PASSWORD]`
   - Confirm Email: **Check "Auto Confirm"** (so no email confirmation is required).
   - Copy the newly created user's **User UID** (e.g. `c4b12345-6789-abcd-ef01-23456789abcd`).

2. In the Supabase SQL Editor, register the user as an administrator:
   ```sql
   insert into public.admins (user_id)
   values ('c4b12345-6789-abcd-ef01-23456789abcd')
   on conflict do nothing;
   ```

3. Verify admin access:
   ```sql
   select public.is_admin(); -- Returns true when executed in the context of the user
   ```

### Step 2.7: Disable Public Signups

Prevent unauthorized users from registering accounts:
1. In the Supabase Dashboard, navigate to **Authentication > Providers > Email**.
2. **Toggle OFF "Enable Signup"**.
3. Click **Save**.
*(Only existing users created directly by management in the dashboard will be allowed to log in).*

---

## 3. Cloudflare Pages Frontend Deployment

Gelafehaus is deployed as a Single Page Application (SPA) on Cloudflare Pages.

### Step 3.1: Connect GitHub / Git Repository

1. In the Cloudflare Dashboard, go to **Workers & Pages > Create application > Pages > Connect to Git**.
2. Select the `gelafehaus` repository.

### Step 3.2: Configure Build Settings

| Setting | Value |
|---|---|
| **Framework preset** | `Vite` |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Node.js version** | `20` or higher (`NODE_VERSION = 20`) |

### Step 3.3: Set Environment Variables

Configure the environment variables under **Settings > Environment variables**:

#### For Production (`production` branch / environment):
```env
VITE_SUPABASE_URL=https://<PROD_PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI...production_anon_key
VITE_TURNSTILE_SITE_KEY=0x4AAAAAA...production_site_key
```

#### For Staging (`preview` / `staging` branch):
```env
VITE_SUPABASE_URL=https://<STAGING_PROJECT_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI...staging_anon_key
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

### Step 3.4: Verify SPA Fallback

The build bundle contains `public/_redirects` (`/* /index.html 200`). This ensures that client-side routes (such as `/menu?table=07`, `/checkout`, `/admin`, and `/confirmation`) do not return 404 on page refresh.

---

## 4. Table QR Stand Generation

Generate high-resolution vector SVGs and PNGs for tables 01 through 15:

```bash
# Run QR generator with the production domain:
PRODUCTION_DOMAIN="order.gelafehaus.com" npx tsx scripts/generate-qr.ts
```

Output files are stored in `public/qr/`:
- `table-01.svg` to `table-15.svg` (Scalable vector, ideal for print shops & acrylic stands)
- `table-01.png` to `table-15.png` (Crisp 300 DPI raster graphics)

---

## 5. Pre-Launch Verification Checklist

Complete and sign off every item before opening customer table ordering:

- [ ] **Automated Backups & Restore Test**:
  - In Supabase Dashboard > Database > Backups, verify daily backups are active.
  - Perform a test restore on a test branch to ensure zero data loss.
- [ ] **Run RLS Security Verifications**:
  - Execute `supabase/tests/rls.sql` in the production SQL Editor and verify 4/4 tests pass (`PASS`).
  - Execute `supabase/tests/place_order_tests.sql` and verify all business constraints pass.
  - Execute `supabase/tests/bot_protection_tests.sql` and verify direct anon RPC execution is rejected with `permission denied`.
- [ ] **Rate Limiting & Bot Protection Test**:
  - Send 6 rapid order attempts from the same IP using a curl script and verify HTTP `429 RATE_LIMIT_EXCEEDED` is returned on the 6th call.
- [ ] **Real Device Mobile Testing**:
  - **Apple iPhone (iOS Safari)**: Scan table 07 QR code, customize smash burger, enter name, place order, verify confirmation stepper animation.
  - **Android Device (Chrome)**: Test ordering from table 03, verify sticky category scroll-spy and bottom drawer responsiveness.
- [ ] **Kitchen Tablet Verification**:
  - Open `/admin` on the kitchen counter tablet (e.g. iPad / Galaxy Tab).
  - Verify sound alerts are active (tap unmute icon to trigger test audio chime).
  - Enable screen wake lock or set tablet auto-lock to "Never" while plugged into counter power.
  - Place a test customer order from a mobile phone and verify it appears in the "Received" column immediately with sound chime and pulse highlight.
  - Advance the order: Received ➔ Accept & Cook (Preparing) ➔ Mark Ready ➔ Completed.
- [ ] **Physical QR Code Stand Check**:
  - Print and scan Table 01 through Table 15 physical stands with standard camera apps on both iOS and Android to ensure URL parameters (`?table=NN`) are detected without error.
