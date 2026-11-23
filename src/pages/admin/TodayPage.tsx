import { useEffect, useState, useCallback } from 'react';
import { getDayStats, getOrders } from '../../lib/api';
import type { DayStats, Order, OrderStatus } from '../../lib/types';
import { formatPrice, formatElapsed } from '../../lib/utils';
import Badge from '../../components/ui/Badge';
import Chip from '../../components/ui/Chip';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import { ShoppingBag, IndianRupee, Clock, TrendingUp, Calendar } from 'lucide-react';

export default function TodayPage() {
  const [stats, setStats] = useState<DayStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetchData = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([getDayStats(), getOrders()]);
      setStats(s);
      setOrders(o);
      setError(null);
    } catch {
      setError('Failed to fetch dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    Promise.all([getDayStats(), getOrders()])
      .then(([s, o]) => {
        if (!ignore) {
          setStats(s);
          setOrders(o);
          setError(null);
        }
      })
      .catch(() => {
        if (!ignore) {
          setError('Failed to fetch dashboard data');
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const filteredOrders = orders.filter(o =>
    statusFilter === 'all' ? true : o.status === statusFilter
  );

  const statusBadgeVariants: Record<OrderStatus, 'warning' | 'primary' | 'success' | 'default' | 'danger'> = {
    received: 'warning',
    preparing: 'primary',
    ready: 'success',
    completed: 'default',
    rejected: 'danger',
  };

  const [todayDateString] = useState(() =>
    new Intl.DateTimeFormat('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-heading font-bold text-ink">Today&rsquo;s Overview</h1>
          <p className="text-sm text-muted flex items-center gap-1.5 mt-0.5">
            <Calendar className="h-3.5 w-3.5" />
            <span>{todayDateString}</span>
          </p>
        </div>
      </div>

      {loading && <TodaySkeleton />}
      {error && <ErrorState message={error} onRetry={() => { setLoading(true); void fetchData(); }} />}

      {!loading && !error && stats && (
        <>
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Total Orders */}
            <div className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Total Orders</p>
                <p className="text-3xl font-heading font-bold text-ink mt-2 tabular-nums">
                  {stats.totalOrders}
                </p>
                <p className="text-xs text-muted mt-1 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-success" />
                  <span>Dine-in QR orders</span>
                </p>
              </div>
              <div className="h-10 w-10 rounded-[var(--radius-input)] bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <ShoppingBag className="h-5 w-5" />
              </div>
            </div>

            {/* Total Revenue */}
            <div className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Today&rsquo;s Revenue</p>
                <p className="text-3xl font-heading font-bold text-ink mt-2 tabular-nums">
                  {formatPrice(stats.revenue)}
                </p>
                <p className="text-xs text-muted mt-1">Pay-at-counter total</p>
              </div>
              <div className="h-10 w-10 rounded-[var(--radius-input)] bg-success/10 flex items-center justify-center text-success shrink-0">
                <IndianRupee className="h-5 w-5" />
              </div>
            </div>

            {/* Avg Prep Time */}
            <div className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Avg Prep Time</p>
                <p className="text-3xl font-heading font-bold text-ink mt-2 tabular-nums">
                  {stats.avgPrepTime > 0 ? `${stats.avgPrepTime}m` : '—'}
                </p>
                <p className="text-xs text-muted mt-1">Kitchen turnaround</p>
              </div>
              <div className="h-10 w-10 rounded-[var(--radius-input)] bg-warning/10 flex items-center justify-center text-warning shrink-0">
                <Clock className="h-5 w-5" />
              </div>
            </div>
          </div>

          {/* Orders Section */}
          <div className="bg-surface rounded-[var(--radius-card)] border border-border shadow-[var(--shadow-sm)] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-heading font-bold text-ink">Today&rsquo;s Orders</h2>
                <p className="text-xs text-muted">All orders submitted across tables today</p>
              </div>

              {/* Status Filters */}
              <div className="flex gap-2 overflow-x-auto scroll-hide">
                <Chip
                  label="All"
                  active={statusFilter === 'all'}
                  onClick={() => setStatusFilter('all')}
                />
                <Chip
                  label="Received"
                  active={statusFilter === 'received'}
                  onClick={() => setStatusFilter('received')}
                />
                <Chip
                  label="Preparing"
                  active={statusFilter === 'preparing'}
                  onClick={() => setStatusFilter('preparing')}
                />
                <Chip
                  label="Ready"
                  active={statusFilter === 'ready'}
                  onClick={() => setStatusFilter('ready')}
                />
                <Chip
                  label="Completed"
                  active={statusFilter === 'completed'}
                  onClick={() => setStatusFilter('completed')}
                />
              </div>
            </div>

            {/* List */}
            {filteredOrders.length === 0 ? (
              <div className="text-center py-12 text-muted">
                <ShoppingBag className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No orders matching this filter.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredOrders.map(order => (
                  <div key={order.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-heading font-bold text-base text-ink">
                          #{order.orderNumber}
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-background border border-border text-primary">
                          Table {order.tableNumber}
                        </span>
                        <Badge variant={statusBadgeVariants[order.status]}>
                          {order.status}
                        </Badge>
                      </div>

                      <p className="text-xs text-muted mt-1">
                        Customer: <span className="text-ink font-medium">{order.customerName}</span> &middot; Ordered {formatElapsed(order.createdAt)}
                      </p>

                      <div className="mt-2 text-xs text-muted">
                        {order.items.map((i, idx) => (
                          <span key={idx} className="mr-3">
                            <strong className="text-ink font-semibold">{i.quantity}×</strong> {i.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="text-left md:text-right shrink-0">
                      <p className="text-base font-heading font-bold text-ink tabular-nums">
                        {formatPrice(order.total)}
                      </p>
                      <p className="text-[11px] text-muted">Pay at counter</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TodaySkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-surface rounded-[var(--radius-card)] p-5 border border-border">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
      <div className="bg-surface rounded-[var(--radius-card)] p-5 border border-border space-y-4">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
