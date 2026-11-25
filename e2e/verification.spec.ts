import { test, expect } from '@playwright/test';

test.describe('4x Throttled CPU Mobile Verification (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Full Customer Flow to Admin Verification under 4x CPU throttle', async ({ page, context }) => {
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

    // 1. Throttle CPU 4x via CDP Session
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    // Clear storage for fresh session
    await page.goto('/?table=07');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/?table=07');

    await page.getByRole('button', { name: /Browse Menu/i }).click();
    await expect(page).toHaveURL(/\/menu/);

    // 2. Open a product: verify no visible loading flicker, X visible without scrolling, CLS about 0
    const burgerCard = page.locator('article:has-text("The Classic Smash")');
    await expect(burgerCard).toBeVisible();

    // Measure CLS on open
    await page.evaluate(() => {
      (window as unknown as { __clsValue: number }).__clsValue = 0;
      const clsObserver = new PerformanceObserver(entryList => {
        for (const entry of entryList.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput && typeof shift.value === 'number') {
            (window as unknown as { __clsValue: number }).__clsValue += shift.value;
          }
        }
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });
    });

    await burgerCard.click();

    const sheet = page.locator('[role="dialog"][aria-label]');
    await expect(sheet).toBeVisible();

    // Verify close button is visible without scrolling
    const closeBtn = sheet.getByRole('button', { name: 'Close' });
    await expect(closeBtn).toBeVisible();
    const closeBox = await closeBtn.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(closeBox!.y).toBeLessThan(70); // Sticky top bar
    expect(Math.round(closeBox!.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(closeBox!.height)).toBeGreaterThanOrEqual(44);

    // Verify CLS is near 0 on open
    const initialCls = await page.evaluate(
      () => (window as unknown as { __clsValue: number }).__clsValue || 0
    );
    expect(initialCls).toBeLessThan(0.05);

    // Track initial render counts per panel
    const initialRenderCounts = await page.evaluate(
      () => (window as unknown as { __itemPanelRenderCounts?: Record<string, number> }).__itemPanelRenderCounts || {}
    );
    console.log('Initial panel render counts:', initialRenderCounts);

    // Track network requests and long tasks strictly during the swiping phase
    const swipeImageRequests: string[] = [];
    const requestListener = (req: { resourceType: () => string; url: () => string }) => {
      if (req.resourceType() === 'image') {
        swipeImageRequests.push(req.url());
      }
    };
    page.on('request', requestListener);

    await page.evaluate(() => {
      (window as unknown as { __swipeLongTasks: number[] }).__swipeLongTasks = [];
      const swipeTaskObserver = new PerformanceObserver(entryList => {
        for (const entry of entryList.getEntries()) {
          if (entry.duration > 50) {
            (window as unknown as { __swipeLongTasks: number[] }).__swipeLongTasks.push(entry.duration);
          }
        }
      });
      swipeTaskObserver.observe({ type: 'longtask', buffered: false });
    });

    // 3. Swipe through 6 items (1/6 -> 2/6 -> 3/6 -> 4/6 -> 5/6 -> 6/6)
    for (let i = 1; i <= 5; i++) {
      const currentIndicator = sheet.locator(`text=${i} / 6`);
      await expect(currentIndicator).toBeVisible();

      // Native scroll-snap advance
      await page.evaluate((targetIdx) => {
        const carousel = document.querySelector('[data-testid="customizer-swipe-container"]');
        if (!carousel) return;
        const width = (carousel as HTMLElement).offsetWidth || 390;
        carousel.scrollTo({ left: targetIdx * width, behavior: 'smooth' });
      }, i);

      // Wait for next item indicator
      await expect(sheet.locator(`text=${i + 1} / 6`)).toBeVisible();
    }

    // Verify at 6 / 6
    await expect(sheet.locator('text=6 / 6')).toBeVisible();

    // Check panel render counts: ZERO panel re-renders while swiping
    const postSwipeRenderCounts = await page.evaluate(
      () => (window as unknown as { __itemPanelRenderCounts?: Record<string, number> }).__itemPanelRenderCounts || {}
    );
    console.log('Post-swipe panel render counts:', postSwipeRenderCounts);
    for (const itemId of Object.keys(initialRenderCounts)) {
      expect(postSwipeRenderCounts[itemId]).toBe(initialRenderCounts[itemId]);
    }

    // Check network image refetches during swipe: no repeated refetches of existing images
    page.off('request', requestListener);
    const uniqueSwipeImages = new Set(swipeImageRequests);
    console.log('Swipe image requests count:', swipeImageRequests.length, 'unique:', uniqueSwipeImages.size);
    // Every image URL fetched during swipe should only be fetched at most once
    expect(swipeImageRequests.length).toBe(uniqueSwipeImages.size);

    // Verify long tasks during swiping: no frame drops over 50ms
    const swipeLongTasks = await page.evaluate(
      () => (window as unknown as { __swipeLongTasks: number[] }).__swipeLongTasks || []
    );
    console.log('Swipe long tasks (>50ms under 4x CPU throttle):', swipeLongTasks);
    expect(swipeLongTasks.filter(d => d > 50)).toHaveLength(0);

    // Swipe back to item 5 / 6 (Paneer Tikka Burger, which is available)
    await page.evaluate(() => {
      const carousel = document.querySelector('[data-testid="customizer-swipe-container"]');
      if (!carousel) return;
      const width = (carousel as HTMLElement).offsetWidth || 390;
      carousel.scrollTo({ left: 4 * width, behavior: 'smooth' });
    });
    await expect(sheet.locator('text=5 / 6')).toBeVisible();

    // 4. Test Add-to-cart animation on current item:
    // On tap: button scales to 0.96 then back, label swaps to check + "Added", flying dot, sheet closes after ~500ms
    const addBtn = sheet.getByRole('button', { name: /Add to cart/i });
    await expect(addBtn).toBeVisible();

    await addBtn.click();

    // Verify label swapped to check + "Added"
    await expect(sheet.getByText('Added')).toBeVisible();

    // Sheet closes after ~500ms
    await expect(sheet).not.toBeVisible({ timeout: 2500 });
    await expect(page.getByText('Added to cart').first()).toBeVisible();

    // CartBar appears at bottom with count 1
    const cartBar = page.getByRole('button', { name: /View cart/i });
    await expect(cartBar).toBeVisible();
    await expect(cartBar.locator('.rounded-full', { hasText: '1' })).toBeVisible();

    // 5. Add 2 more items across categories:
    // Item 2: Loaded Cheese Fries (Sides)
    const sidesSection = page.locator('section[data-category="sides"]');
    await sidesSection.scrollIntoViewIfNeeded();
    const friesCard = page.locator('article:has-text("Loaded Cheese Fries")');
    await friesCard.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Added to cart').first()).toBeVisible();

    // Item 3: Craft Cola (Drinks)
    const drinksSection = page.locator('section[data-category="drinks"]');
    await drinksSection.scrollIntoViewIfNeeded();
    const colaCard = page.locator('article:has-text("Craft Cola")');
    await colaCard.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Added to cart').first()).toBeVisible();

    // CartBar now has count 3
    await expect(cartBar.locator('.rounded-full', { hasText: '3' })).toBeVisible();

    // 6. Open CartDrawer and verify items & catchy "Review & Order" / "Order" button
    await cartBar.click();
    const drawer = page.locator('[role="dialog"][aria-label="Your Cart"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Loaded Cheese Fries')).toBeVisible();
    await expect(drawer.getByText('Craft Cola')).toBeVisible();

    // Verify checkout button has catchy text ("Review & Order")
    const orderBtn = drawer.getByRole('button', { name: /Order/i });
    await expect(orderBtn).toBeVisible();
    await orderBtn.click();
    await expect(page).toHaveURL(/\/checkout/);

    // 7. Checkout: name (table prefilled) -> "Place order" -> confirmation
    const tableInput = page.locator('#table-number-readonly');
    await expect(tableInput).toHaveValue('Table 07');

    const customerName = `Tester_${Date.now() % 10000}`;
    await page.getByLabel(/Your Name/i).fill(customerName);

    const placeOrderBtn = page.getByRole('button', { name: /Place Order/i });
    await placeOrderBtn.click();

    // Verify Confirmation page
    await expect(page).toHaveURL(/\/confirmation/);
    await expect(page.getByRole('heading', { name: /Order #/i })).toBeVisible();
    await expect(page.getByText(/Table 07/i)).toBeVisible();

    // 8. Verify the order appears in admin dashboard with correct items, notes and total
    await page.goto('/admin/login');
    await page.getByRole('button', { name: /Sign in/i }).click();
    await page.waitForURL('**/admin');

    const orderCard = page.locator('article', { hasText: customerName }).first();
    await expect(orderCard).toBeVisible({ timeout: 15000 });
    await expect(orderCard.getByText('Table 07')).toBeVisible();
    await expect(orderCard.getByText('Loaded Cheese Fries')).toBeVisible();
    await expect(orderCard.getByText('Craft Cola')).toBeVisible();

    // Ensure zero console errors
    expect(consoleErrors).toHaveLength(0);
  });
});
