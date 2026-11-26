import { useEffect, useState, useCallback } from 'react';
import { getDayStats, getOrders, subscribeAdminRealtime, undoOrderPaid } from '../../lib/api';
import type { DayStats, Order, OrderStatus } from '../../lib/types';
import { formatPrice, formatElapsed } from '../../lib/utils';
import Badge from '../../components/ui/Badge';
import Chip from '../../components/ui/Chip';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import { useToast } from '../../components/ui/useToast';
import { ShoppingBag, IndianRupee, Clock, TrendingUp, Calendar, AlertCircle, RotateCcw, Phone, Banknote, Smartphone, CreditCard, AlertTriangle } from 'lucide-react';

export default function TodayPage() {
  const [stats, setStats] = useState<DayStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { toast } = useToast();

  async function handleUndoPaid(orderId: string) {
    try {
      const updated = await undoOrderPaid(orderId);
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
      const newStats = await getDayStats();
      setStats(newStats);
      toast(`Payment undone for Order #${updated.orderNumber}`, 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to undo payment', 'error');
    }
  }

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

    const unsubscribe = subscribeAdminRealtime(() => {
      void fetchData();
    });

    return () => {
      ignore = true;
      unsubscribe();
    };
  }, [fetchData]);

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Paid Orders */}
            <div
              data-testid="today-paid-orders-card"
              className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between"
            >
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Paid Orders</p>
                <p className="text-3xl font-heading font-bold text-ink mt-2 tabular-nums">
                  {stats.totalOrders}
                </p>
                <p className="text-xs text-muted mt-1 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-success" />
                  <span>Confirmed paid today</span>
                </p>
              </div>
              <div className="h-10 w-10 rounded-[var(--radius-input)] bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <ShoppingBag className="h-5 w-5" />
              </div>
            </div>

            {/* Paid Revenue (Total revenue) */}
            <div
              data-testid="today-paid-revenue-card"
              className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between"
            >
              <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider">Total Revenue</p>
                <p className="text-3xl font-heading font-bold text-ink mt-2 tabular-nums">
                  {formatPrice(stats.revenue)}
                </p>
                <p className="text-xs text-muted mt-1">Confirmed payments only</p>
              </div>
              <div className="h-10 w-10 rounded-[var(--radius-input)] bg-success/10 flex items-center justify-center text-success shrink-0">
                <IndianRupee className="h-5 w-5" />
              </div>
            </div>

            {/* Unpaid Completed */}
            <div
              data-testid="today-unpaid-card"
              className="bg-surface rounded-[var(--radius-card)] p-5 border border-danger/30 shadow-[var(--shadow-sm)] flex items-start justify-between"
            >
              <div>
                <p className="text-xs font-semibold text-danger uppercase tracking-wider">Unpaid</p>
                <p className="text-3xl font-heading font-bold text-ink mt-2 tabular-nums">
                  {stats.unpaidOrders ?? 0}
                  <span className="text-base font-semibold text-danger ml-2">
                    ({formatPrice(stats.unpaidAmount ?? 0)})
                  </span>
                </p>
                <p className="text-xs text-muted mt-1">Completed & awaiting payment</p>
              </div>
              <div className="h-10 w-10 rounded-[var(--radius-input)] bg-danger/10 flex items-center justify-center text-danger shrink-0">
                <AlertCircle className="h-5 w-5" />
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

          {/* Payment Method Breakdown */}
          {(() => {
            const splitSum = (stats.cashRevenue ?? 0) + (stats.upiRevenue ?? 0) + (stats.cardRevenue ?? 0);
            const hasMismatch = splitSum !== stats.revenue;
            const hasCard = (stats.cardRevenue ?? 0) > 0 || (stats.cardOrders ?? 0) > 0;
            return (
              <div className="space-y-2">
                <div className={`grid grid-cols-1 sm:grid-cols-2 ${hasCard ? 'lg:grid-cols-3' : ''} gap-4`}>
                  <div
                    data-testid="today-cash-card"
                    className="bg-surface rounded-[var(--radius-card)] p-4 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between"
                  >
                    <div>
                      <p className="text-xs font-semibold text-muted uppercase tracking-wider">Cash taken</p>
                      <p className="text-2xl font-heading font-bold text-ink mt-1.5 tabular-nums">
                        {formatPrice(stats.cashRevenue ?? 0)}
                      </p>
                      <p className="text-xs text-muted mt-0.5 tabular-nums">
                        {stats.cashOrders ?? 0} {(stats.cashOrders ?? 0) === 1 ? 'order' : 'orders'}
                      </p>
                    </div>
                    <div className="h-9 w-9 rounded-[var(--radius-input)] bg-primary/10 flex items-center justify-center text-primary shrink-0">
                      <Banknote className="h-4 w-4" />
                    </div>
                  </div>

                  <div
                    data-testid="today-upi-card"
                    className="bg-surface rounded-[var(--radius-card)] p-4 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between"
                  >
                    <div>
                      <p className="text-xs font-semibold text-muted uppercase tracking-wider">UPI received</p>
                      <p className="text-2xl font-heading font-bold text-ink mt-1.5 tabular-nums">
                        {formatPrice(stats.upiRevenue ?? 0)}
                      </p>
                      <p className="text-xs text-muted mt-0.5 tabular-nums">
                        {stats.upiOrders ?? 0} {(stats.upiOrders ?? 0) === 1 ? 'order' : 'orders'}
                      </p>
                    </div>
                    <div className="h-9 w-9 rounded-[var(--radius-input)] bg-success/10 flex items-center justify-center text-success shrink-0">
                      <Smartphone className="h-4 w-4" />
                    </div>
                  </div>

                  {hasCard && (
                    <div
                      data-testid="today-card-card"
                      className="bg-surface rounded-[var(--radius-card)] p-4 border border-border shadow-[var(--shadow-sm)] flex items-start justify-between"
                    >
                      <div>
                        <p className="text-xs font-semibold text-muted uppercase tracking-wider">Card</p>
                        <p className="text-2xl font-heading font-bold text-ink mt-1.5 tabular-nums">
                          {formatPrice(stats.cardRevenue ?? 0)}
                        </p>
                        <p className="text-xs text-muted mt-0.5 tabular-nums">
                          {stats.cardOrders ?? 0} {(stats.cardOrders ?? 0) === 1 ? 'order' : 'orders'}
                        </p>
                      </div>
                      <div className="h-9 w-9 rounded-[var(--radius-input)] bg-warning/10 flex items-center justify-center text-warning shrink-0">
                        <CreditCard className="h-4 w-4" />
                      </div>
                    </div>
                  )}
                </div>

                {hasMismatch && (
                  <p
                    role="alert"
                    className="text-xs font-medium text-danger flex items-center gap-1.5 px-1"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Method split ({formatPrice(splitSum)}) does not match Total Revenue ({formatPrice(stats.revenue)}).
                    </span>
                  </p>
                )}
              </div>
            );
          })()}

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

                      <p className="text-xs text-muted mt-1 flex flex-wrap items-center gap-2">
                        <span>
                          Customer: <span className="text-ink font-medium">{order.customerName}</span>
                        </span>
                        {order.customerPhone && (
                          <span className="inline-flex items-center gap-1 text-ink font-medium tabular-nums">
                            <Phone className="h-3 w-3 text-muted" />
                            {order.customerPhone}
                          </span>
                        )}
                        <span>&middot; Ordered {formatElapsed(order.createdAt)}</span>
                      </p>

                      <div className="mt-2 text-xs text-muted">
                        {order.items.map((i, idx) => (
                          <span key={idx} className="mr-3">
                            <strong className="text-ink font-semibold">{i.quantity}×</strong> {i.name}
                          </span>
                        ))}
                      </div>

                      {order.paymentHistory && order.paymentHistory.length > 0 && (
                        <div className="mt-1.5 text-[11px] text-muted space-y-0.5">
                          {order.paymentHistory.map((h, idx) => (
                            <p key={idx}>
                              {h.action === 'paid'
                                ? `Paid (${(h.method || '').toUpperCase()})`
                                : `Payment undone (was ${(h.previousMethod || '').toUpperCase()})`}
                              {' · '}
                              {new Date(h.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="text-left md:text-right shrink-0 space-y-1">
                      <p className="text-base font-heading font-bold text-ink tabular-nums">
                        {formatPrice(order.total)}
                      </p>
                      {order.paymentStatus === 'paid' ? (
                        <div className="flex items-center md:justify-end gap-2">
                          <Badge variant="success">
                            Paid · {(order.paymentMethod || 'cash').toUpperCase()}
                          </Badge>
                          <button
                            type="button"
                            onClick={() => handleUndoPaid(order.id)}
                            className="inline-flex items-center gap-1 text-xs text-muted hover:text-danger transition-colors cursor-pointer"
                            aria-label={`Undo paid for order #${order.orderNumber}`}
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Undo</span>
                          </button>
                        </div>
                      ) : (
                        <p className="text-[11px] font-medium text-danger">
                          {order.status === 'completed' ? 'Unpaid' : 'Pay at counter'}
                        </p>
                      )}
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
