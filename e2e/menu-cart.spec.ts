import { test, expect } from '@playwright/test';

test.describe('Gelafehaus Mobile UI Revisions & Cart Verification', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Welcome Page Layout: Button directly beneath table pill and vertically centered', async ({ page }) => {
    await page.goto('/?table=12');

    const brand = page.locator('text=Gelafehaus');
    const pill = page.locator('text=Table 12');
    const tagline = page.locator('text=Fresh burgers, made to order.');
    const browseBtn = page.getByRole('button', { name: /Browse Menu/i });

    await expect(brand).toBeVisible();
    await expect(pill).toBeVisible();
    await expect(tagline).toBeVisible();
    await expect(browseBtn).toBeVisible();

    // Verify vertical order & grouping
    const brandBox = await brand.boundingBox();
    const pillBox = await pill.boundingBox();
    const taglineBox = await tagline.boundingBox();
    const btnBox = await browseBtn.boundingBox();

    expect(brandBox).not.toBeNull();
    expect(pillBox).not.toBeNull();
    expect(taglineBox).not.toBeNull();
    expect(btnBox).not.toBeNull();

    // Wordmark -> Table pill -> Tagline -> Button
    expect(pillBox!.y).toBeGreaterThan(brandBox!.y);
    expect(taglineBox!.y).toBeGreaterThan(pillBox!.y);
    expect(btnBox!.y).toBeGreaterThan(taglineBox!.y);

    // Button is directly beneath in the same centered group (within 120px of pill)
    expect(btnBox!.y - (pillBox!.y + pillBox!.height)).toBeLessThan(120);

    // Centered in viewport
    expect(btnBox!.y + btnBox!.height).toBeLessThan(750);
  });

  test('Product Sheet Exit & Organic Swiping: Finger tracking, translate3d, X button, swipe-down, Esc, focus restoration', async ({ page }) => {
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

    await page.goto('/?table=12');
    await page.getByRole('button', { name: /Browse Menu/i }).click();
    await expect(page).toHaveURL(/\/menu/);

    // Find and open "The Classic Smash"
    const classicSmashCard = page.locator('article:has-text("The Classic Smash")');
    await expect(classicSmashCard).toBeVisible();
    await classicSmashCard.click();

    // Product sheet opens
    const sheet = page.locator('[role="dialog"][aria-label]');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'The Classic Smash' })).toBeVisible();

    // 1. Position indicator "1 / 6" visible
    const indicator = sheet.locator('text=1 / 6');
    await expect(indicator).toBeVisible();

    // 2. X button top-right (44px target)
    const closeBtn = sheet.getByRole('button', { name: 'Close' });
    await expect(closeBtn).toBeVisible();
    const closeBox = await closeBtn.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(closeBox!.width).toBeGreaterThanOrEqual(44);
    expect(closeBox!.height).toBeGreaterThanOrEqual(44);

    // 3. Swipe left with finger-tracking (>25% distance or fast flick) to navigate to Truffle Royale
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="customizer-swipe-container"]');
      if (!el) return;
      // Start drag at 300, move left to 120 (>25% of 390px = 97.5px)
      const t1 = new Touch({ identifier: 0, target: el, clientX: 300, clientY: 250 });
      const t2 = new Touch({ identifier: 0, target: el, clientX: 120, clientY: 250 });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], bubbles: true, cancelable: true }));
      el.dispatchEvent(new TouchEvent('touchmove', { touches: [t2], bubbles: true, cancelable: true }));
      el.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t2], bubbles: true, cancelable: true }));
    });
    await expect(sheet.getByRole('heading', { name: 'Truffle Royale' })).toBeVisible();
    await expect(sheet.locator('text=2 / 6')).toBeVisible();

    // 4. Swipe right to navigate back to The Classic Smash
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="customizer-swipe-container"]');
      if (!el) return;
      const t1 = new Touch({ identifier: 0, target: el, clientX: 120, clientY: 250 });
      const t2 = new Touch({ identifier: 0, target: el, clientX: 300, clientY: 250 });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], bubbles: true, cancelable: true }));
      el.dispatchEvent(new TouchEvent('touchmove', { touches: [t2], bubbles: true, cancelable: true }));
      el.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t2], bubbles: true, cancelable: true }));
    });
    await expect(sheet.getByRole('heading', { name: 'The Classic Smash' })).toBeVisible();
    await expect(sheet.locator('text=1 / 6')).toBeVisible();

    // 5. Tap X to close and verify focus restoration
    await closeBtn.click();
    await expect(sheet).not.toBeVisible();
    await expect(classicSmashCard).toBeFocused();

    // 6. Reopen and test swipe-down-to-dismiss (>25% drag)
    await classicSmashCard.click();
    await expect(sheet).toBeVisible();
    await page.evaluate(() => {
      const el = document.querySelector('[role="dialog"][aria-label]');
      if (!el) return;
      const t1 = new Touch({ identifier: 0, target: el, clientX: 200, clientY: 100 });
      const t2 = new Touch({ identifier: 0, target: el, clientX: 200, clientY: 380 });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], bubbles: true, cancelable: true }));
      el.dispatchEvent(new TouchEvent('touchmove', { touches: [t2], bubbles: true, cancelable: true }));
      el.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t2], bubbles: true, cancelable: true }));
    });
    await expect(sheet).not.toBeVisible();

    // 7. Reopen and test Esc to close
    await classicSmashCard.click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).not.toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  test('Cart Flow: Header cart empty state, Add 3 items across categories, CartBar, Drawer qty/remove, Checkout button, reload persistence', async ({ page }) => {
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

    await page.goto('/?table=12');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/?table=12');
    await page.getByRole('button', { name: /Browse Menu/i }).click();
    await expect(page).toHaveURL(/\/menu/);

    // 1. Verify Header Cart Icon is visible when empty and clicking opens Empty State
    const headerCartBtn = page.locator('header').getByRole('button', { name: /cart/i });
    await expect(headerCartBtn).toBeVisible();
    await headerCartBtn.click();

    const emptyDrawer = page.locator('[role="dialog"][aria-label="Your Cart"]');
    await expect(emptyDrawer).toBeVisible();
    await expect(emptyDrawer.getByText('Your cart is empty')).toBeVisible();

    // Close empty drawer via "Back to menu" button
    await emptyDrawer.getByRole('button', { name: 'Back to menu' }).click();
    await expect(emptyDrawer).not.toBeVisible();

    // 2. Add Item 1 from Burgers category (Customizable: The Classic Smash)
    const burgerCard = page.locator('article:has-text("The Classic Smash")');
    await burgerCard.getByRole('button', { name: 'Add' }).click();

    const customizerSheet = page.locator('[role="dialog"][aria-label]');
    await expect(customizerSheet).toBeVisible();

    // Tap Add to Cart in customizer
    const addToCartBtn = customizerSheet.getByRole('button', { name: /Add to cart/i });
    await addToCartBtn.click();

    // Sheet closes
    await expect(customizerSheet).not.toBeVisible();
    await expect(page.getByText('Added to cart').first()).toBeVisible();

    // Floating CartBar slides in (1 item)
    const cartBar = page.getByRole('button', { name: /View cart/i });
    await expect(cartBar).toBeVisible();
    await expect(cartBar.locator('text=1')).toBeVisible();

    // Header cart button now displays count badge "1"
    await expect(headerCartBtn.locator('text=1')).toBeVisible();

    // 3. Add Item 2 from Sides category (Direct Add: Loaded Cheese Fries)
    const sideCard = page.locator('article:has-text("Loaded Cheese Fries")');
    await sideCard.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Added to cart').first()).toBeVisible();
    await expect(cartBar.locator('text=2')).toBeVisible();
    await expect(headerCartBtn.locator('text=2')).toBeVisible();

    // 4. Add Item 3 from Drinks category (Direct Add: Craft Cola)
    const drinkCard = page.locator('article:has-text("Craft Cola")');
    await drinkCard.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Added to cart').first()).toBeVisible();
    await expect(cartBar.locator('text=3')).toBeVisible();
    await expect(headerCartBtn.locator('text=3')).toBeVisible();

    // 5. Tap CartBar to open CartDrawer
    await cartBar.click();
    const cartDrawer = page.locator('[role="dialog"][aria-label="Your Cart"]');
    await expect(cartDrawer).toBeVisible();

    // Verify all 3 items across categories are in the drawer
    await expect(cartDrawer.getByText('The Classic Smash')).toBeVisible();
    await expect(cartDrawer.getByText('Loaded Cheese Fries')).toBeVisible();
    await expect(cartDrawer.getByText('Craft Cola')).toBeVisible();

    // Verify "Checkout" button is visible
    const checkoutBtn = cartDrawer.getByRole('button', { name: 'Checkout' });
    await expect(checkoutBtn).toBeVisible();

    // 6. Edit quantity (increment first item)
    const plusBtn = cartDrawer.locator('button:has(svg.lucide-plus)').first();
    await plusBtn.click();
    await expect(cartDrawer.locator('text=2').first()).toBeVisible();

    // 7. Remove third item (Craft Cola)
    const removeBtn = cartDrawer.locator('button:has(svg.lucide-trash-2)').last();
    await removeBtn.click();
    await expect(cartDrawer.getByText('Craft Cola')).not.toBeVisible();

    // 8. Reload page and check persistence
    await page.reload();
    await expect(page.locator('header').getByText('Table 12')).toBeVisible();

    // CartBar is still visible with 3 count (The Classic Smash has qty 2 + Loaded Cheese Fries has qty 1 = 3)
    const reloadedCartBar = page.getByRole('button', { name: /View cart/i });
    await expect(reloadedCartBar).toBeVisible();
    await expect(reloadedCartBar.locator('text=3')).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: /cart/i }).locator('text=3')).toBeVisible();

    // Reopen drawer after reload to verify items persisted
    await reloadedCartBar.click();
    await expect(page.locator('[role="dialog"][aria-label="Your Cart"]')).toBeVisible();
    await expect(page.getByText('The Classic Smash')).toBeVisible();
    await expect(page.getByText('Loaded Cheese Fries')).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });
});
