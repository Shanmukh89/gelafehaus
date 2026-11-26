import { test, expect } from '@playwright/test';

const MOCK_DAY_STATS = {
  totalOrders: 5,
  revenue: 150000,
  cashRevenue: 50000,
  cashOrders: 2,
  upiRevenue: 70000,
  upiOrders: 2,
  cardRevenue: 30000,
  cardOrders: 1,
  unpaidOrders: 1,
  unpaidAmount: 24900,
  avgPrepTime: 12,
};

function makeInsights(range: 'day' | 'week' | 'month') {
  return {
    range,
    kpis: {
      revenue: 150000,
      prevRevenue: 120000,
      orders: 5,
      prevOrders: 4,
      uniqueCustomers: 4,
      prevUniqueCustomers: 3,
      avgOrderValue: 30000,
      prevAvgOrderValue: 30000,
    },
    methods: {
      cash: { revenue: 50000, orders: 2 },
      upi: { revenue: 70000, orders: 2 },
      card: { revenue: 30000, orders: 1 },
    },
    series: [
      {
        label: range === 'day' ? '12:00' : range === 'week' ? 'Thu' : 'W4 (20 Nov–26 Nov)',
        shortLabel: range === 'month' ? 'W4' : undefined,
        subLabel: '26 Nov',
        cashRevenue: 50000,
        upiRevenue: 70000,
        cardRevenue: 30000,
        totalRevenue: 150000,
        cashOrders: 2,
        upiOrders: 2,
        cardOrders: 1,
        totalOrders: 5,
      },
    ],
    topItems: [
      { name: 'The Classic Smash', quantity: 3, revenue: 74700 },
      { name: 'Craft Cola', quantity: 2, revenue: 17800 },
    ],
    methodSplit: [
      { method: 'cash', revenue: 50000, orders: 2 },
      { method: 'upi', revenue: 70000, orders: 2 },
      { method: 'card', revenue: 30000, orders: 1 },
    ],
    customerSplit: { newCustomers: 3, returningCustomers: 1 },
  };
}

for (const width of [1024, 390]) {
  test(`Today and Insights pages render cleanly at ${width}px with method split`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(err.message));

    await page.addInitScript(() => {
      sessionStorage.setItem('gelafehaus-admin-auth', 'true');
      localStorage.setItem(
        'gelafehaus-supabase-auth',
        JSON.stringify({
          access_token: 'mock-token',
          refresh_token: 'mock-refresh',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 'admin-1', email: 'manager@gelafehaus.com' },
        })
      );
    });

    await page.route('**/rest/v1/rpc/is_admin', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: 'true' })
    );
    await page.route('**/rest/v1/rpc/get_day_stats', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_DAY_STATS) })
    );
    await page.route('**/rest/v1/orders*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    await page.route('**/rest/v1/rpc/get_insights', async route => {
      const body = route.request().postDataJSON() as { p_range?: 'day' | 'week' | 'month' };
      const r = body?.p_range || 'day';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeInsights(r)),
      });
    });

    // 1. Today page
    await page.goto('/admin/today');
    await expect(page.locator('[data-testid="today-paid-revenue-card"]')).toContainText('₹1,500');
    await expect(page.locator('[data-testid="today-paid-orders-card"]')).toContainText('5');
    await expect(page.locator('[data-testid="today-cash-card"]')).toContainText('₹500');
    await expect(page.locator('[data-testid="today-cash-card"]')).toContainText('2 orders');
    await expect(page.locator('[data-testid="today-upi-card"]')).toContainText('₹700');
    await expect(page.locator('[data-testid="today-upi-card"]')).toContainText('2 orders');
    await expect(page.locator('[data-testid="today-card-card"]')).toContainText('₹300');

    // 2. Insights page
    await page.goto('/admin/insights');
    await expect(page.locator('[data-testid="insights-revenue-card"]')).toContainText('₹1,500');
    await expect(page.locator('[data-testid="insights-cash-card"]')).toContainText('₹500');
    await expect(page.locator('[data-testid="insights-upi-card"]')).toContainText('₹700');
    await expect(page.locator('[data-testid="insights-card-card"]')).toContainText('₹300');
    await expect(page.locator('.recharts-responsive-container')).toBeVisible();

    // Switch ranges and chart toggles
    await page.getByRole('button', { name: 'Week' }).click();
    await expect(page.locator('[data-testid="insights-revenue-card"]')).toContainText('₹1,500');
    await page.getByRole('button', { name: 'Month' }).click();
    await expect(page.locator('[data-testid="insights-revenue-card"]')).toContainText('₹1,500');
    await page.getByRole('button', { name: 'Total', exact: true }).click();
    await page.getByRole('button', { name: 'Orders', exact: true }).click();

    expect(consoleErrors).toEqual([]);
  });
}
