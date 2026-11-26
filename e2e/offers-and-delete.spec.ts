import { test, expect } from '@playwright/test';

test.describe('Admin Soft-Delete & Limited-Time Offers (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Full verification: delete + undo, create offer, customer view & order, admin verification, and expire revert', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          !text.includes('Failed to load resource') &&
          !text.includes('Supabase Edge Function') &&
          !text.includes('WebSocket connection') &&
          !text.includes('ERR_CONNECTION_REFUSED')
        ) {
          consoleErrors.push(text);
        }
      }
    });

    // ─── 0. Reset storage ───
    await page.goto('/?table=07');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // ─── 1. Sign in as Admin ───
    await page.goto('/admin/login');
    await page.getByRole('button', { name: /Sign in/i }).click();
    await page.waitForURL('**/admin');

    // ─── 2. Admin: Delete then Undo an item in Menu Manager ───
    await page.goto('/admin/menu');
    await expect(page.locator('h1')).toContainText('Menu Manager');

    // Find "Loaded Cheese Fries"
    const targetItemName = 'Loaded Cheese Fries';
    const itemRow = page.locator(`tr:has-text("${targetItemName}")`).first();
    await expect(itemRow).toBeVisible();

    // Click Delete button on the row
    const deleteBtn = itemRow.getByRole('button', { name: `Delete ${targetItemName}` });
    await deleteBtn.click();

    // Confirm dialog appears
    const confirmDialog = page.locator('[role="dialog"]:has-text("Delete Menu Item")');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText(`Delete ${targetItemName}? Past orders are unaffected.`);

    // Click confirm Delete
    const confirmDeleteBtn = confirmDialog.getByRole('button', { name: 'Delete' });
    await confirmDeleteBtn.click();

    // Verify optimistic removal
    await expect(page.locator(`tr:has-text("${targetItemName}")`)).toHaveCount(0);

    // Toast with Undo button appears
    const undoBtn = page.getByRole('button', { name: 'Undo' });
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    // Verify item is restored
    await expect(page.locator(`tr:has-text("${targetItemName}")`).first()).toBeVisible();

    // ─── 2. Admin: Create a Limited-Time Offer ───
    await page.goto('/admin/offers');
    await expect(page.locator('h1')).toContainText('Limited-Time Offers');

    // Click "Create Offer" button
    await page.getByRole('button', { name: 'Create Offer' }).first().click();

    // Fill Offer dialog
    const offerDialog = page.locator('[role="dialog"]:has-text("Create Limited-Time Offer")');
    await expect(offerDialog).toBeVisible();

    // Select "The Classic Smash"
    await offerDialog.locator('select').selectOption({ value: 'item-classic-smash' });

    // Set label
    const labelInput = offerDialog.locator('input[placeholder*="Weekend Deal"]');
    await labelInput.fill('Weekend Deal');

    // Set offer price to ₹199 (base is ₹249)
    const priceInput = offerDialog.getByLabel(/Offer Price/i);
    await priceInput.fill('199');

    // Submit offer
    await offerDialog.getByRole('button', { name: 'Create Offer' }).click();
    await expect(offerDialog).not.toBeVisible();

    // Verify created offer row with "Active" badge
    const createdOfferRow = page.locator('tr:has-text("The Classic Smash")');
    await expect(createdOfferRow).toBeVisible();
    await expect(createdOfferRow).toContainText('Active');
    await expect(createdOfferRow).toContainText('Weekend Deal');
    await expect(createdOfferRow).toContainText('₹199');

    // ─── 3. Customer Menu: Offers chip & Pinned section ───
    await page.goto('/?table=07');
    await page.getByRole('button', { name: /Browse Menu/i }).click();
    await expect(page).toHaveURL(/\/menu/);

    // Verify "Offers" chip is visible first in category chips
    const offersChip = page.locator('button:has-text("Offers")').first();
    await expect(offersChip).toBeVisible();

    // Verify pinned "Limited Time Offers" section
    const offersSection = page.locator('section[data-category="offers"]');
    await expect(offersSection).toBeVisible();
    await expect(offersSection.locator('h2')).toContainText('Limited Time Offers');

    // Verify offer card has label badge, struck-through original price, offer price, and countdown
    const offerCard = offersSection.locator('article:has-text("The Classic Smash")');
    await expect(offerCard).toBeVisible();
    await expect(offerCard).toContainText('Weekend Deal');
    await expect(offerCard).toContainText('₹199');
    await expect(offerCard).toContainText('₹249');
    await expect(offerCard.locator('[data-testid="offer-countdown"]')).toBeVisible();

    // ─── 4. Product Sheet & Cart: Offer price display ───
    await offerCard.click();
    const productSheet = page.locator('[role="dialog"][aria-label]');
    await expect(productSheet).toBeVisible();

    // Verify offer price and struck-through price in ProductSheet
    await expect(productSheet).toContainText('₹199');
    await expect(productSheet).toContainText('₹249');
    await expect(productSheet).toContainText('Weekend Deal');

    // Add to cart
    const addToCartBtn = productSheet.getByRole('button', { name: /Add to cart/i });
    await addToCartBtn.click();
    await expect(productSheet).not.toBeVisible({ timeout: 5000 });

    // Open Cart Drawer
    const cartButton = page.getByRole('button', { name: /Open cart/i });
    await cartButton.click();
    const cartDrawer = page.locator('[role="dialog"][aria-label="Your Cart"]');
    await expect(cartDrawer).toBeVisible();

    // Verify offer price and struck-through price in CartDrawer
    await expect(cartDrawer).toContainText('₹199');
    await expect(cartDrawer).toContainText('₹249');

    // Proceed to Checkout
    const checkoutBtn = cartDrawer.getByRole('button', { name: /Review & Order/i });
    await checkoutBtn.click();
    await expect(page).toHaveURL(/\/checkout/);

    // ─── 5. Checkout & Confirmation ───
    await expect(page.locator('header')).toContainText('Checkout');
    await expect(page.locator('main')).toContainText('₹199');

    // Fill customer name, phone and place order
    await page.getByLabel(/Your Name/i).fill('Sam OfferTest');
    await page.getByLabel(/Mobile Number/i).fill('9876543210');
    await page.getByRole('button', { name: /Place Order/i }).click();

    // Verify confirmation
    await expect(page).toHaveURL(/\/confirmation/);
    await expect(page.getByRole('heading', { name: /Order #/i })).toBeVisible();
    await expect(page.locator('main')).toContainText('₹199');

    // ─── 6. Admin Orders: Verify order shows offer price ───
    await page.goto('/admin');
    await expect(page.locator('h1')).toContainText('Live Orders');

    const samOrderCard = page.locator('article:has-text("Sam OfferTest")').first();
    await expect(samOrderCard).toBeVisible();
    await expect(samOrderCard).toContainText('₹199');

    // ─── 7. Expire the Offer & Verify Menu Reverts ───
    await page.goto('/admin/offers');
    const offerRowToEnd = page.locator('tr:has-text("The Classic Smash")').first();
    const endEarlyBtn = offerRowToEnd.getByRole('button', { name: /End early/i });
    await endEarlyBtn.click();

    // Verify status changed to Expired
    await expect(offerRowToEnd).toContainText('Expired');

    // Return to Customer Menu
    await page.goto('/?table=07');
    await page.getByRole('button', { name: /Browse Menu/i }).click();
    await expect(page).toHaveURL(/\/menu/);

    // "Offers" chip and "Limited Time Offers" section should disappear
    await expect(page.locator('section[data-category="offers"]')).toHaveCount(0);
    await expect(page.locator('button:has-text("Offers")')).toHaveCount(0);

    // "The Classic Smash" in normal Burgers section reverts to ₹249
    const regularBurgerCard = page.locator('article:has-text("The Classic Smash")').first();
    await expect(regularBurgerCard).toBeVisible();
    await expect(regularBurgerCard).toContainText('₹249');
    await expect(regularBurgerCard).not.toContainText('Weekend Deal');

    // Ensure zero console errors
    expect(consoleErrors).toEqual([]);
  });

  test('Server-side place_order validation: live offer, expired offer, and tampered price', async ({
    page,
  }) => {
    await page.goto('/?table=07');

    const results = await page.evaluate(async () => {
      // Dynamic import to access internal API in page context
      const api = await import('/src/lib/api.ts');

      // Setup menu and offers
      const menu = await api.getMenu(true);
      const burger = menu.find(m => m.name === 'The Classic Smash')!;

      // 1. Create a live offer
      const now = new Date();
      const future = new Date(Date.now() + 3600000);
      const past = new Date(Date.now() - 3600000);

      const liveOffer = await api.createOffer({
        menuItemId: burger.id,
        label: 'Test Live Deal',
        offerPrice: 18000, // ₹180
        startsAt: now.toISOString(),
        endsAt: future.toISOString(),
        isActive: true,
      });

      // Test 1: Live offer succeeds at offer price
      const liveOrder = await api.placeOrder({
        customerName: 'Live Offer User',
        customerPhone: '9876543210',
        tableNumber: '07',
        items: [
          {
            menuItemId: burger.id,
            quantity: 1,
            optionIds: [],
            notes: '',
            offerId: liveOffer.id,
          },
        ],
      });

      // Test 2: Expired offer is rejected with readable error
      const expiredOffer = await api.createOffer({
        menuItemId: burger.id,
        label: 'Test Expired Deal',
        offerPrice: 17000,
        startsAt: new Date(Date.now() - 7200000).toISOString(),
        endsAt: past.toISOString(),
        isActive: true,
      });

      let expiredError = '';
      try {
        await api.placeOrder({
          customerName: 'Expired User',
          customerPhone: '9876543210',
          tableNumber: '07',
          items: [
            {
              menuItemId: burger.id,
              quantity: 1,
              optionIds: [],
              notes: '',
              offerId: expiredOffer.id,
            },
          ],
        });
      } catch (err) {
        expiredError = err instanceof Error ? err.message : String(err);
      }

      // Test 3: Tampered client price (client sends non-existent or tampered offer)
      // Even if client attempts to send an invalid offerId or bad data, placeOrder protects prices
      let tamperedError = '';
      try {
        await api.placeOrder({
          customerName: 'Tamperer',
          customerPhone: '9876543210',
          tableNumber: '07',
          items: [
            {
              menuItemId: burger.id,
              quantity: 1,
              optionIds: [],
              notes: '',
              offerId: 'fake-offer-id',
            },
          ],
        });
      } catch (err) {
        tamperedError = err instanceof Error ? err.message : String(err);
      }

      // Clean up test offers
      await api.deleteOffer(liveOffer.id);
      await api.deleteOffer(expiredOffer.id);

      return {
        liveOrderTotal: liveOrder.total,
        liveOrderItemPrice: liveOrder.items[0].lineTotal,
        expiredError,
        tamperedError,
      };
    });

    // Verify results
    expect(results.liveOrderTotal).toBe(18000);
    expect(results.liveOrderItemPrice).toBe(18000);
    expect(results.expiredError).toContain('OFFER_EXPIRED');
    expect(results.tamperedError).toContain('OFFER_EXPIRED');
  });
});
