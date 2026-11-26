import { test, expect } from '@playwright/test';

test.describe('Two-Context Realtime, Phone Capture & Paid Tracking', () => {
  test('Customer (390px) + Admin: <2s realtime arrival, phone validation, paid tracking, Unpaid list & Today totals', async ({
    browser,
  }) => {
    const consoleErrors: string[] = [];
    const filterAndLogError = (source: string, text: string) => {
      if (
        !text.includes('Failed to load resource') &&
        !text.includes('Supabase Edge Function') &&
        !text.includes('WebSocket connection') &&
        !text.includes('ERR_CONNECTION_REFUSED')
      ) {
        consoleErrors.push(`[${source}] ${text}`);
      }
    };

    // Context 1: Admin (Desktop)
    const adminContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const adminPage = await adminContext.newPage();
    adminPage.on('console', msg => {
      if (msg.type() === 'error') filterAndLogError('admin', msg.text());
    });

    // Context 2: Customer (390px Mobile)
    const customerContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const customerPage = await customerContext.newPage();
    customerPage.on('console', msg => {
      if (msg.type() === 'error') filterAndLogError('customer', msg.text());
    });

    try {
      // Reset dev-sync shared orders so Today totals start clean
      await adminPage.request.delete('/_dev_sync/orders');

      // ─── 1. Admin logs in and opens Live Orders Board ───
      await adminPage.goto('/admin/login');
      await adminPage.getByRole('button', { name: /Sign in/i }).click();
      await adminPage.waitForURL('**/admin');
      await expect(adminPage.locator('h1')).toContainText('Live Orders Board');
      await expect(adminPage.locator('[data-testid="realtime-status"]')).toContainText('Live');

      // ─── 2. Customer (390px) adds Loaded Cheese Fries (₹149) and goes to Checkout ───
      await customerPage.goto('/?table=07');
      await customerPage.getByRole('button', { name: /Browse Menu/i }).click();
      await expect(customerPage).toHaveURL(/\/menu/);

      const friesCard = customerPage.locator('article:has-text("Loaded Cheese Fries")').first();
      await friesCard.scrollIntoViewIfNeeded();
      await friesCard.getByRole('button', { name: 'Add' }).click();

      const cartBar = customerPage.getByRole('button', { name: /View cart/i });
      await cartBar.click();
      const drawer = customerPage.locator('[role="dialog"][aria-label="Your Cart"]');
      await drawer.getByRole('button', { name: /Review & Order/i }).click();
      await expect(customerPage).toHaveURL(/\/checkout/);

      // Test invalid phone shows visible error toast
      await customerPage.getByLabel(/Your Name/i).fill('Realtime User 1');
      await customerPage.getByLabel(/Mobile Number/i).fill('12345');
      await customerPage.getByRole('button', { name: /Place order/i }).click();
      await expect(
        customerPage.getByText(/valid 10-digit Indian mobile number/i).first()
      ).toBeVisible();

      // Enter valid 10-digit Indian mobile & place order
      await customerPage.getByLabel(/Mobile Number/i).fill('9876543210');
      await customerPage.getByRole('button', { name: /Place order/i }).click();
      await expect(customerPage).toHaveURL(/\/confirmation/);

      // ─── 3. Verify Admin sees the new order within 2s WITHOUT refresh ───
      const orderCard1 = adminPage.locator('article:visible', { hasText: 'Realtime User 1' }).first();
      await expect(orderCard1).toBeVisible({ timeout: 2000 });
      await expect(orderCard1).toContainText('+919876543210');
      await expect(orderCard1).toContainText('₹149');

      // Tab title counter updated
      const titleWithOrder = await adminPage.title();
      expect(titleWithOrder).toMatch(/^\(\d+\) Live Orders/);

      // Advance Order 1 to Completed
      await orderCard1.getByRole('button', { name: /Accept/i }).click();
      await expect(
        adminPage.locator('article:visible', { hasText: 'Realtime User 1' }).getByRole('button', { name: /Mark Ready/i })
      ).toBeVisible();
      await adminPage
        .locator('article:visible', { hasText: 'Realtime User 1' })
        .getByRole('button', { name: /Mark Ready/i })
        .click();
      await expect(
        adminPage.locator('article:visible', { hasText: 'Realtime User 1' }).getByRole('button', { name: /Complete Order/i })
      ).toBeVisible();
      await adminPage
        .locator('article:visible', { hasText: 'Realtime User 1' })
        .getByRole('button', { name: /Complete Order/i })
        .click();

      // Mark Order 1 Paid via UPI
      const completedCard1 = adminPage.locator('article:visible', { hasText: 'Realtime User 1' }).first();
      await completedCard1.locator('select').selectOption('upi');
      await completedCard1.getByRole('button', { name: 'Customer paid' }).click();
      await expect(completedCard1).toContainText('Paid · UPI');

      // ─── 4. Customer places Order 2 (Craft Cola ₹89) & Admin completes WITHOUT marking paid ───
      await customerPage.goto('/?table=08');
      await customerPage.getByRole('button', { name: /Browse Menu/i }).click();
      await expect(customerPage).toHaveURL(/\/menu/);

      const colaCard = customerPage.locator('article:has-text("Craft Cola")').first();
      await colaCard.scrollIntoViewIfNeeded();
      await colaCard.getByRole('button', { name: 'Add' }).click();

      await customerPage.getByRole('button', { name: /View cart/i }).click();
      await customerPage
        .locator('[role="dialog"][aria-label="Your Cart"]')
        .getByRole('button', { name: /Review & Order/i })
        .click();
      await expect(customerPage).toHaveURL(/\/checkout/);

      await customerPage.getByLabel(/Your Name/i).fill('Unpaid User 2');
      await customerPage.getByLabel(/Mobile Number/i).fill('9811223344');
      await customerPage.getByRole('button', { name: /Place order/i }).click();
      await expect(customerPage).toHaveURL(/\/confirmation/);

      // Admin sees Order 2 within 2s without refresh
      const orderCard2 = adminPage.locator('article:visible', { hasText: 'Unpaid User 2' }).first();
      await expect(orderCard2).toBeVisible({ timeout: 2000 });

      await orderCard2.getByRole('button', { name: /Accept/i }).click();
      await adminPage
        .locator('article:visible', { hasText: 'Unpaid User 2' })
        .getByRole('button', { name: /Mark Ready/i })
        .click();
      await adminPage
        .locator('article:visible', { hasText: 'Unpaid User 2' })
        .getByRole('button', { name: /Complete Order/i })
        .click();

      // Verify Unpaid list shows Unpaid User 2 with phone number
      await adminPage.getByRole('button', { name: /Unpaid \(1\)/i }).click();
      const unpaidPanel = adminPage.locator('[data-testid="unpaid-orders-panel"]');
      await expect(unpaidPanel).toBeVisible();
      await expect(unpaidPanel).toContainText('Unpaid User 2');
      await expect(unpaidPanel).toContainText('+919811223344');
      await expect(unpaidPanel).toContainText('₹89');

      // ─── 5. Verify Today page totals (PAID only + separate Unpaid) & Undo ───
      await adminPage.goto('/admin/today');
      await expect(adminPage.locator('[data-testid="today-paid-orders-card"]')).toContainText('1');
      await expect(adminPage.locator('[data-testid="today-paid-revenue-card"]')).toContainText('₹149');
      await expect(adminPage.locator('[data-testid="today-unpaid-card"]')).toContainText('1');
      await expect(adminPage.locator('[data-testid="today-unpaid-card"]')).toContainText('₹89');

      // Undo paid on Order 1 from Today page
      await adminPage.getByRole('button', { name: /Undo paid for order/i }).first().click();
      await expect(adminPage.locator('[data-testid="today-paid-orders-card"]')).toContainText('0');
      await expect(adminPage.locator('[data-testid="today-paid-revenue-card"]')).toContainText('₹0');
      await expect(adminPage.locator('[data-testid="today-unpaid-card"]')).toContainText('2');
      await expect(adminPage.locator('[data-testid="today-unpaid-card"]')).toContainText('₹238');
      await expect(adminPage.getByText(/Payment undone \(was UPI\)/i)).toBeVisible();

      expect(consoleErrors).toEqual([]);
    } finally {
      await customerContext.close();
      await adminContext.close();
    }
  });

  test('Sequential numbering (101, 102, 103) from 390px phone syncs identically to Admin within 2s without refresh', async ({
    browser,
  }) => {
    const consoleErrors: string[] = [];
    const trackError = (source: string, text: string) => {
      if (
        !text.includes('Failed to load resource') &&
        !text.includes('Supabase Edge Function') &&
        !text.includes('WebSocket connection') &&
        !text.includes('ERR_CONNECTION_REFUSED')
      ) {
        consoleErrors.push(`[${source}] ${text}`);
      }
    };

    const adminContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const adminPage = await adminContext.newPage();
    adminPage.on('console', msg => {
      if (msg.type() === 'error') trackError('admin', msg.text());
    });

    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phonePage = await phoneContext.newPage();
    phonePage.on('console', msg => {
      if (msg.type() === 'error') trackError('phone', msg.text());
    });

    try {
      await adminPage.request.delete('/_dev_sync/orders');

      // Open Admin board
      await adminPage.goto('/admin/login');
      await adminPage.getByRole('button', { name: /Sign in/i }).click();
      await adminPage.waitForURL('**/admin');
      await expect(adminPage.locator('[data-testid="realtime-status"]')).toContainText('Live');

      const expectedNumbers = [101, 102, 103];
      for (let i = 0; i < expectedNumbers.length; i++) {
        const expectedNum = expectedNumbers[i];
        const customerName = `SeqCustomer_${expectedNum}`;
        const tableNum = `0${i + 1}`;

        await phonePage.goto(`/?table=${tableNum}`);
        await phonePage.getByRole('button', { name: /Browse Menu/i }).click();
        await expect(phonePage).toHaveURL(/\/menu/);

        const itemCard = phonePage.locator('article:has-text("Craft Cola")').first();
        await itemCard.scrollIntoViewIfNeeded();
        await itemCard.getByRole('button', { name: 'Add' }).click();

        await phonePage.getByRole('button', { name: /View cart/i }).click();
        await phonePage
          .locator('[role="dialog"][aria-label="Your Cart"]')
          .getByRole('button', { name: /Review & Order/i })
          .click();
        await expect(phonePage).toHaveURL(/\/checkout/);

        await phonePage.getByLabel(/Your Name/i).fill(customerName);
        await phonePage.getByLabel(/Mobile Number/i).fill(`987654321${i}`);
        await phonePage.getByRole('button', { name: /Place order/i }).click();

        // Confirmation page must display the server-assigned sequential number
        await expect(phonePage).toHaveURL(/\/confirmation/);
        await expect(phonePage.locator('h1')).toContainText(`Order #${expectedNum}`);

        // Admin board must receive the same order with the same number within 2s without refresh
        const adminCard = adminPage.locator('article:visible', { hasText: customerName }).first();
        await expect(adminCard).toBeVisible({ timeout: 2000 });
        await expect(adminCard).toContainText(`#${expectedNum}`);
      }

      expect(consoleErrors).toEqual([]);
    } finally {
      await phoneContext.close();
      await adminContext.close();
    }
  });

  test('Concurrency test: 10 parallel orders get 10 unique sequential numbers (101..110)', async ({
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

    await page.request.delete('/_dev_sync/orders');
    await page.goto('/?table=01');

    const assignedNumbers = await page.evaluate(async () => {
      const api = await import('/src/lib/api.ts');
      const { useCartStore } = await import('/src/lib/cart-store.ts');
      const menu = await api.getMenu();
      const cola = menu.find(m => m.name === 'Craft Cola')!;

      const orders = await Promise.all(
        Array.from({ length: 10 }, (_, idx) => {
          // Ensure each concurrent order uses a distinct idempotency key
          useCartStore.getState().resetIdempotencyKey();
          return api.placeOrder({
            customerName: `Parallel_${idx}`,
            customerPhone: `987654321${idx}`,
            tableNumber: String((idx % 9) + 1).padStart(2, '0'),
            items: [
              {
                menuItemId: cola.id,
                quantity: 1,
                optionIds: [],
                notes: '',
              },
            ],
          });
        })
      );

      return orders.map(o => o.orderNumber).sort((a, b) => a - b);
    });

    expect(assignedNumbers).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
    expect(new Set(assignedNumbers).size).toBe(10);
    expect(consoleErrors).toEqual([]);
  });
});
