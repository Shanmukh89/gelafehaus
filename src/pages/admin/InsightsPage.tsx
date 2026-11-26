import { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { getInsights, subscribeAdminRealtime } from '../../lib/api';
import type { InsightsData, InsightsRange, InsightsSeriesPoint } from '../../lib/types';
import { formatPrice } from '../../lib/utils';
import Chip from '../../components/ui/Chip';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import {
  IndianRupee,
  ShoppingBag,
  Users,
  Receipt,
  Banknote,
  Smartphone,
  CreditCard,
  TrendingUp,
  TrendingDown,
  Award,
} from 'lucide-react';

const RANGES: { id: InsightsRange; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

const METHOD_COLORS = {
  cash: '#E4572E', // --color-primary (ember)
  upi: '#2F9E6B',  // --color-success
  card: '#E0A030', // --color-warning
};

function pctChange(curr: number, prev: number): { label: string; positive: boolean } | null {
  if (prev === 0 && curr === 0) return null;
  if (prev === 0) return { label: '+100%', positive: true };
  const pct = Math.round(((curr - prev) / prev) * 100);
  return {
    label: `${pct >= 0 ? '+' : ''}${pct}%`,
    positive: pct >= 0,
  };
}

function ChangePill({ curr, prev }: { curr: number; prev: number }) {
  const change = pctChange(curr, prev);
  if (!change) return <span className="text-xs text-muted">vs prev period: —</span>;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold ${
        change.positive ? 'text-success' : 'text-danger'
      }`}
    >
      {change.positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {change.label} vs prev
    </span>
  );
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: InsightsSeriesPoint }>;
  metric: 'revenue' | 'orders';
  mode: 'split' | 'total';
}

function InsightsTooltip({ active, payload, metric, mode }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;
  const cashVal = metric === 'revenue' ? formatPrice(pt.cashRevenue) : `${pt.cashOrders}`;
  const upiVal = metric === 'revenue' ? formatPrice(pt.upiRevenue) : `${pt.upiOrders}`;
  const cardVal = metric === 'revenue' ? formatPrice(pt.cardRevenue) : `${pt.cardOrders}`;
  const totalVal = metric === 'revenue' ? formatPrice(pt.totalRevenue) : `${pt.totalOrders} orders`;
  const hasCard = metric === 'revenue' ? pt.cardRevenue > 0 : pt.cardOrders > 0;

  return (
    <div className="bg-surface border border-border rounded-[var(--radius-input)] p-3 shadow-[var(--shadow-lg)] text-xs space-y-1">
      <p className="font-heading font-bold text-ink">
        {pt.label}
        {pt.subLabel ? ` (${pt.subLabel})` : ''}
      </p>
      {mode === 'split' && (
        <>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: METHOD_COLORS.cash }} />
              Cash
            </span>
            <span className="font-semibold text-ink tabular-nums">{cashVal}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: METHOD_COLORS.upi }} />
              UPI
            </span>
            <span className="font-semibold text-ink tabular-nums">{upiVal}</span>
          </div>
          {hasCard && (
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: METHOD_COLORS.card }} />
                Card
              </span>
              <span className="font-semibold text-ink tabular-nums">{cardVal}</span>
            </div>
          )}
        </>
      )}
      <div className="pt-1 border-t border-border flex items-center justify-between gap-4">
        <span className="font-semibold text-muted">Total</span>
        <span className="font-bold text-ink tabular-nums">{totalVal}</span>
      </div>
    </div>
  );
}

export default function InsightsPage() {
  const [range, setRange] = useState<InsightsRange>('day');
  const [chartMode, setChartMode] = useState<'split' | 'total'>('split');
  const [metric, setMetric] = useState<'revenue' | 'orders'>('revenue');
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInsights = useCallback(async (r: InsightsRange) => {
    try {
      const res = await getInsights(r);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load insights');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadInsights(range);
  }, [range, loadInsights]);

  useEffect(() => {
    const unsubscribe = subscribeAdminRealtime(() => {
      void loadInsights(range);
    });
    return () => unsubscribe();
  }, [range, loadInsights]);

  const hasCard = data ? data.methods.card.revenue > 0 || data.methods.card.orders > 0 : false;
  const isEmpty = data ? data.kpis.orders === 0 : false;

  return (
    <div className="space-y-6">
      {/* Header & Range Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-bold text-ink">Insights</h1>
          <p className="text-sm text-muted mt-0.5">
            Paid revenue &amp; order analytics (Asia/Kolkata)
          </p>
        </div>

        <div className="flex gap-2" role="tablist" aria-label="Insights range">
          {RANGES.map(r => (
            <Chip
              key={r.id}
              label={r.label}
              active={range === r.id}
              onClick={() => setRange(r.id)}
            />
          ))}
        </div>
      </div>

      {loading && <InsightsSkeleton />}
      {!loading && error && (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            void loadInsights(range);
          }}
        />
      )}

      {!loading && !error && data && (
        <>
          {/* Primary KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              data-testid="insights-revenue-card"
              className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between"
            >
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Paid Revenue</p>
                <p className="text-2xl font-heading font-bold text-ink mt-1.5 tabular-nums">
                  {formatPrice(data.kpis.revenue)}
                </p>
                <div className="mt-1">
                  <ChangePill curr={data.kpis.revenue} prev={data.kpis.prevRevenue} />
                </div>
              </div>
              <div className="h-10 w-10 rounded-[var(--radius-input)] bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <IndianRupee className="h-5 w-5" />
              </div>
            </div>

            <div
              data-testid="insights-orders-card"
              className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between"
            >
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Paid Orders</p>
                <p className="text-2xl font-heading font-bold text-ink mt-1.5 tabular-nums">
                  {data.kpis.orders}
                </p>
                <div className="mt-1">
                  <ChangePill curr={data.kpis.orders} prev={data.kpis.prevOrders} />
                </div>
              </div>
              <div className="h-10 w-10 rounded-[var(--radius-input)] bg-success/10 flex items-center justify-center text-success shrink-0">
                <ShoppingBag className="h-5 w-5" />
              </div>
            </div>

            <div className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Unique Customers</p>
                <p className="text-2xl font-heading font-bold text-ink mt-1.5 tabular-nums">
                  {data.kpis.uniqueCustomers}
                </p>
                <div className="mt-1">
                  <ChangePill curr={data.kpis.uniqueCustomers} prev={data.kpis.prevUniqueCustomers} />
                </div>
              </div>
              <div className="h-10 w-10 rounded-[var(--radius-input)] bg-warning/10 flex items-center justify-center text-warning shrink-0">
                <Users className="h-5 w-5" />
              </div>
            </div>

            <div className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Avg Order Value</p>
                <p className="text-2xl font-heading font-bold text-ink mt-1.5 tabular-nums">
                  {formatPrice(data.kpis.avgOrderValue)}
                </p>
                <div className="mt-1">
                  <ChangePill curr={data.kpis.avgOrderValue} prev={data.kpis.prevAvgOrderValue} />
                </div>
              </div>
              <div className="h-10 w-10 rounded-[var(--radius-input)] bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <Receipt className="h-5 w-5" />
              </div>
            </div>
          </div>

          {/* Cash & UPI KPI Cards under Total */}
          <div className={`grid grid-cols-1 sm:grid-cols-2 ${hasCard ? 'lg:grid-cols-3' : ''} gap-4`}>
            <div
              data-testid="insights-cash-card"
              className="bg-surface rounded-[var(--radius-card)] p-4 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between"
            >
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Cash</p>
                <p className="text-xl font-heading font-bold text-ink mt-1 tabular-nums">
                  {formatPrice(data.methods.cash.revenue)}
                </p>
                <p className="text-xs text-muted mt-0.5 tabular-nums">
                  {data.methods.cash.orders} {data.methods.cash.orders === 1 ? 'order' : 'orders'}
                </p>
              </div>
              <div className="h-9 w-9 rounded-[var(--radius-input)] bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <Banknote className="h-4 w-4" />
              </div>
            </div>

            <div
              data-testid="insights-upi-card"
              className="bg-surface rounded-[var(--radius-card)] p-4 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between"
            >
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">UPI</p>
                <p className="text-xl font-heading font-bold text-ink mt-1 tabular-nums">
                  {formatPrice(data.methods.upi.revenue)}
                </p>
                <p className="text-xs text-muted mt-0.5 tabular-nums">
                  {data.methods.upi.orders} {data.methods.upi.orders === 1 ? 'order' : 'orders'}
                </p>
              </div>
              <div className="h-9 w-9 rounded-[var(--radius-input)] bg-success/10 flex items-center justify-center text-success shrink-0">
                <Smartphone className="h-4 w-4" />
              </div>
            </div>

            {hasCard && (
              <div
                data-testid="insights-card-card"
                className="bg-surface rounded-[var(--radius-card)] p-4 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between"
              >
                <div>
                  <p className="text-xs font-semibold text-muted uppercase tracking-wider">Card</p>
                  <p className="text-xl font-heading font-bold text-ink mt-1 tabular-nums">
                    {formatPrice(data.methods.card.revenue)}
                  </p>
                  <p className="text-xs text-muted mt-0.5 tabular-nums">
                    {data.methods.card.orders} {data.methods.card.orders === 1 ? 'order' : 'orders'}
                  </p>
                </div>
                <div className="h-9 w-9 rounded-[var(--radius-input)] bg-warning/10 flex items-center justify-center text-warning shrink-0">
                  <CreditCard className="h-4 w-4" />
                </div>
              </div>
            )}
          </div>

          {isEmpty ? (
            <div className="bg-surface rounded-[var(--radius-card)] border border-border p-12 text-center">
              <ShoppingBag className="h-10 w-10 text-muted/40 mx-auto mb-3" />
              <p className="text-base font-heading font-semibold text-ink">No paid orders in this period</p>
              <p className="text-xs text-muted mt-1">
                Confirmed payments will appear here as soon as orders are marked paid.
              </p>
            </div>
          ) : (
            <>
              {/* Bar Chart */}
              <div className="bg-surface rounded-[var(--radius-card)] border border-border shadow-[var(--shadow-sm)] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-heading font-bold text-ink">
                      {metric === 'revenue' ? 'Revenue' : 'Orders'} Breakdown
                    </h2>
                    <p className="text-xs text-muted">
                      {range === 'day'
                        ? 'Hourly breakdown (IST)'
                        : range === 'week'
                          ? 'Last 7 days'
                          : 'Last 30 days by week'}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <div className="flex gap-1 bg-background p-1 rounded-[var(--radius-chip)] border border-border">
                      <button
                        type="button"
                        onClick={() => setChartMode('split')}
                        className={`px-3 py-1 text-xs font-semibold rounded-[var(--radius-chip)] cursor-pointer transition-colors ${
                          chartMode === 'split' ? 'bg-primary text-white' : 'text-muted hover:text-ink'
                        }`}
                      >
                        Split
                      </button>
                      <button
                        type="button"
                        onClick={() => setChartMode('total')}
                        className={`px-3 py-1 text-xs font-semibold rounded-[var(--radius-chip)] cursor-pointer transition-colors ${
                          chartMode === 'total' ? 'bg-primary text-white' : 'text-muted hover:text-ink'
                        }`}
                      >
                        Total
                      </button>
                    </div>

                    <div className="flex gap-1 bg-background p-1 rounded-[var(--radius-chip)] border border-border">
                      <button
                        type="button"
                        onClick={() => setMetric('revenue')}
                        className={`px-3 py-1 text-xs font-semibold rounded-[var(--radius-chip)] cursor-pointer transition-colors ${
                          metric === 'revenue' ? 'bg-ink text-white' : 'text-muted hover:text-ink'
                        }`}
                      >
                        Revenue
                      </button>
                      <button
                        type="button"
                        onClick={() => setMetric('orders')}
                        className={`px-3 py-1 text-xs font-semibold rounded-[var(--radius-chip)] cursor-pointer transition-colors ${
                          metric === 'orders' ? 'bg-ink text-white' : 'text-muted hover:text-ink'
                        }`}
                      >
                        Orders
                      </button>
                    </div>
                  </div>
                </div>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.series} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E7E2DA" vertical={false} />
                      <XAxis
                        dataKey={range === 'month' ? 'shortLabel' : 'label'}
                        tick={{ fill: '#78716C', fontSize: 11 }}
                        axisLine={{ stroke: '#E7E2DA' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#78716C', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={val =>
                          metric === 'revenue' ? `₹${Math.round(Number(val) / 100)}` : `${val}`
                        }
                      />
                      <Tooltip content={<InsightsTooltip metric={metric} mode={chartMode} />} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />

                      {chartMode === 'split' ? (
                        <>
                          <Bar
                            dataKey={metric === 'revenue' ? 'cashRevenue' : 'cashOrders'}
                            name="Cash"
                            stackId="a"
                            fill={METHOD_COLORS.cash}
                            radius={[0, 0, 0, 0]}
                          />
                          <Bar
                            dataKey={metric === 'revenue' ? 'upiRevenue' : 'upiOrders'}
                            name="UPI"
                            stackId="a"
                            fill={METHOD_COLORS.upi}
                            radius={hasCard ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                          />
                          {hasCard && (
                            <Bar
                              dataKey={metric === 'revenue' ? 'cardRevenue' : 'cardOrders'}
                              name="Card"
                              stackId="a"
                              fill={METHOD_COLORS.card}
                              radius={[4, 4, 0, 0]}
                            />
                          )}
                        </>
                      ) : (
                        <Bar
                          dataKey={metric === 'revenue' ? 'totalRevenue' : 'totalOrders'}
                          name={metric === 'revenue' ? 'Total Revenue' : 'Total Orders'}
                          fill={METHOD_COLORS.cash}
                          radius={[4, 4, 0, 0]}
                        />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Compact Extras: Top 5 Items, Payment Method Split, New vs Returning */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Top 5 Items */}
                <div className="bg-surface rounded-[var(--radius-card)] border border-border shadow-[var(--shadow-sm)] p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Award className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-heading font-bold text-ink">Top 5 Items</h3>
                  </div>
                  {data.topItems.length === 0 ? (
                    <p className="text-xs text-muted">No items sold in this period.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {data.topItems.map((item, i) => (
                        <li key={item.name} className="py-2 flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-ink font-medium">
                            <span className="text-muted mr-1.5">{i + 1}.</span>
                            {item.name}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted">
                            <strong className="text-ink">{item.quantity}</strong> · {formatPrice(item.revenue)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Payment Method Split */}
                <div className="bg-surface rounded-[var(--radius-card)] border border-border shadow-[var(--shadow-sm)] p-5 space-y-3">
                  <h3 className="text-sm font-heading font-bold text-ink">Payment Method Split</h3>
                  <div className="space-y-3">
                    {data.methodSplit
                      .filter(m => m.method !== 'card' || m.revenue > 0 || m.orders > 0)
                      .map(m => {
                        const pct =
                          data.kpis.revenue > 0
                            ? Math.round((m.revenue / data.kpis.revenue) * 100)
                            : 0;
                        const color = METHOD_COLORS[m.method];
                        return (
                          <div key={m.method} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold uppercase text-ink">{m.method}</span>
                              <span className="tabular-nums text-muted">
                                <strong className="text-ink">{formatPrice(m.revenue)}</strong> ({pct}%) · {m.orders}
                              </span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-background overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${pct}%`, backgroundColor: color }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>

                {/* New vs Returning Customers */}
                <div className="bg-surface rounded-[var(--radius-card)] border border-border shadow-[var(--shadow-sm)] p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-heading font-bold text-ink">New vs Returning Customers</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="rounded-[var(--radius-input)] bg-background p-3 border border-border">
                      <p className="text-[11px] font-semibold text-muted uppercase">New</p>
                      <p className="text-2xl font-heading font-bold text-ink mt-1 tabular-nums">
                        {data.customerSplit.newCustomers}
                      </p>
                    </div>
                    <div className="rounded-[var(--radius-input)] bg-background p-3 border border-border">
                      <p className="text-[11px] font-semibold text-muted uppercase">Returning</p>
                      <p className="text-2xl font-heading font-bold text-success mt-1 tabular-nums">
                        {data.customerSplit.returningCustomers}
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted">
                    Matched by customer mobile number on paid orders.
                  </p>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Skeleton className="h-24 rounded-[var(--radius-card)]" />
        <Skeleton className="h-24 rounded-[var(--radius-card)]" />
      </div>
      <Skeleton className="h-80 rounded-[var(--radius-card)]" />
    </div>
  );
}
