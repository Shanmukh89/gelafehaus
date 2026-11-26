import { useEffect, useState, useRef, useCallback } from 'react';
import {
  getOrders,
  getOrderWithItems,
  updateOrderStatus,
  markOrderPaid,
  undoOrderPaid,
  subscribeAdminRealtime,
  type RealtimeStatus,
} from '../../lib/api';
import type { Order, OrderStatus, PaymentMethod } from '../../lib/types';
import { formatPrice, formatElapsed, elapsedMinutes } from '../../lib/utils';
import { soundAlert } from '../../lib/sound';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Dialog from '../../components/ui/Dialog';
import Textarea from '../../components/ui/Textarea';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import { useToast } from '../../components/ui/useToast';
import {
  Clock,
  CheckCircle2,
  ChevronRight,
  XCircle,
  Inbox,
  RefreshCw,
  Phone,
  RotateCcw,
  Wifi,
  WifiOff,
  CreditCard,
} from 'lucide-react';

const COLUMNS: { key: OrderStatus; label: string; badgeVariant: 'warning' | 'primary' | 'success' | 'default' }[] = [
  { key: 'received', label: 'Received', badgeVariant: 'warning' },
  { key: 'preparing', label: 'Preparing', badgeVariant: 'primary' },
  { key: 'ready', label: 'Ready', badgeVariant: 'success' },
  { key: 'completed', label: 'Completed', badgeVariant: 'default' },
];

type MobileTab = OrderStatus | 'unpaid';

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MobileTab>('received');
  const [rejectingOrder, setRejectingOrder] = useState<Order | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('reconnecting');
  const [showUnpaidSection, setShowUnpaidSection] = useState(false);

  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const initialLoadRef = useRef(true);
  const { toast } = useToast();

  const markAsNew = useCallback(
    (orderId: string, orderNumber?: number) => {
      soundAlert.playChime();
      if (orderNumber) {
        toast(`🔔 New order arrived! (#${orderNumber})`, 'info');
      }
      setNewOrderIds(prev => new Set([...prev, orderId]));
      setTimeout(() => {
        setNewOrderIds(prev => {
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });
      }, 6000);
    },
    [toast]
  );

  const fetchOrders = useCallback(
    async (isSilent = false) => {
      if (!isSilent && !initialLoadRef.current) setLoading(true);
      try {
        const data = await getOrders();
        setOrders(data);

        const currentIds = new Set(data.map(o => o.id));
        if (!initialLoadRef.current) {
          const fresh = data.filter(
            o => !knownOrderIdsRef.current.has(o.id) && o.status === 'received'
          );
          if (fresh.length > 0) {
            soundAlert.playChime();
            toast(`🔔 New order arrived! (#${fresh[0].orderNumber})`, 'info');
            setNewOrderIds(prev => new Set([...prev, ...fresh.map(o => o.id)]));
            setTimeout(() => {
              setNewOrderIds(prev => {
                const next = new Set(prev);
                fresh.forEach(o => next.delete(o.id));
                return next;
              });
            }, 6000);
          }
        }

        knownOrderIdsRef.current = currentIds;
        initialLoadRef.current = false;
        setError(null);
      } catch {
        if (!isSilent) setError('Failed to load orders');
      } finally {
        if (!isSilent) setLoading(false);
      }
    },
    [toast]
  );

  // Initial load + Realtime subscription (orders + order_items) + reconnect/refocus refetch
  useEffect(() => {
    let ignore = false;
    getOrders()
      .then(data => {
        if (!ignore) {
          setOrders(data);
          knownOrderIdsRef.current = new Set(data.map(o => o.id));
          initialLoadRef.current = false;
          setError(null);
        }
      })
      .catch(() => {
        if (!ignore) setError('Failed to load orders');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    const unsubscribe = subscribeAdminRealtime(
      async evt => {
        if (ignore) return;
        if (!evt.orderId) {
          void fetchOrders(true);
          return;
        }
        // Fetch full order with items before rendering (never partial)
        const fullOrder = await getOrderWithItems(evt.orderId);
        if (!fullOrder || ignore) return;

        const isNewInsert =
          evt.type === 'insert' && !knownOrderIdsRef.current.has(fullOrder.id);

        setOrders(prev => {
          const exists = prev.some(o => o.id === fullOrder.id);
          if (exists) {
            return prev.map(o => (o.id === fullOrder.id ? fullOrder : o));
          }
          return [fullOrder, ...prev];
        });

        knownOrderIdsRef.current.add(fullOrder.id);

        if (isNewInsert && fullOrder.status === 'received') {
          markAsNew(fullOrder.id, fullOrder.orderNumber);
        }
      },
      status => {
        if (ignore) return;
        setRealtimeStatus(prev => {
          if (prev === 'reconnecting' && status === 'live' && !initialLoadRef.current) {
            void fetchOrders(true);
          }
          return status;
        });
      }
    );

    const handleRefocusOrOnline = () => {
      if (document.visibilityState === 'visible') {
        void fetchOrders(true);
      }
    };

    window.addEventListener('online', handleRefocusOrOnline);
    window.addEventListener('focus', handleRefocusOrOnline);
    document.addEventListener('visibilitychange', handleRefocusOrOnline);

    // Backup background poll (15s) in case WebSocket/SSE drops silently
    const backupInterval = setInterval(() => fetchOrders(true), 15000);

    return () => {
      ignore = true;
      unsubscribe();
      window.removeEventListener('online', handleRefocusOrOnline);
      window.removeEventListener('focus', handleRefocusOrOnline);
      document.removeEventListener('visibilitychange', handleRefocusOrOnline);
      clearInterval(backupInterval);
    };
  }, [fetchOrders, markAsNew]);

  // Tab-title counter for received orders
  const receivedCount = orders.filter(o => o.status === 'received').length;
  useEffect(() => {
    const prevTitle = document.title;
    document.title =
      receivedCount > 0 ? `(${receivedCount}) Live Orders · Gelafehaus` : 'Live Orders · Gelafehaus';
    return () => {
      document.title = prevTitle;
    };
  }, [receivedCount]);

  async function handleAdvance(order: Order) {
    const nextStatus: Record<OrderStatus, OrderStatus | null> = {
      received: 'preparing',
      preparing: 'ready',
      ready: 'completed',
      completed: null,
      rejected: null,
    };
    const target = nextStatus[order.status];
    if (!target) return;

    try {
      const updated = await updateOrderStatus(order.id, target);
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
      toast(`Order #${order.orderNumber} marked as ${target}`, 'success');
    } catch {
      toast('Failed to update status', 'error');
    }
  }

  async function handleRejectSubmit() {
    if (!rejectingOrder) return;
    if (!rejectReason.trim()) {
      setRejectError('Please provide a reason for rejection');
      return;
    }

    try {
      const updated = await updateOrderStatus(rejectingOrder.id, 'rejected', rejectReason.trim());
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
      toast(`Order #${rejectingOrder.orderNumber} rejected`, 'info');
      setRejectingOrder(null);
      setRejectReason('');
      setRejectError('');
    } catch {
      toast('Failed to reject order', 'error');
    }
  }

  async function handleMarkPaid(orderId: string, method: PaymentMethod) {
    try {
      const updated = await markOrderPaid(orderId, method);
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
      toast(`Order #${updated.orderNumber} marked paid (${method.toUpperCase()})`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to mark order paid', 'error');
    }
  }

  async function handleUndoPaid(orderId: string) {
    try {
      const updated = await undoOrderPaid(orderId);
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
      toast(`Payment undone for Order #${updated.orderNumber}`, 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to undo payment', 'error');
    }
  }

  const getOrdersForStatus = (status: OrderStatus) => orders.filter(o => o.status === status);
  const unpaidCompletedOrders = orders.filter(
    o => o.status === 'completed' && o.paymentStatus !== 'paid'
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-ink">Live Orders Board</h1>
          <p className="text-sm text-muted mt-0.5">Kitchen display & order tracking</p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Live / Reconnecting indicator */}
          <span
            data-testid="realtime-status"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
              realtimeStatus === 'live'
                ? 'bg-success/10 text-success border-success/30'
                : 'bg-warning/10 text-warning border-warning/30'
            }`}
          >
            {realtimeStatus === 'live' ? (
              <>
                <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                <Wifi className="h-3 w-3" />
                <span>Live</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3" />
                <span>Reconnecting</span>
              </>
            )}
          </span>

          {/* Desktop Unpaid toggle pill */}
          <button
            type="button"
            onClick={() => setShowUnpaidSection(v => !v)}
            className={`hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-input)] text-xs font-semibold border transition-colors cursor-pointer ${
              showUnpaidSection
                ? 'bg-danger text-white border-danger'
                : 'bg-surface text-ink border-border hover:bg-background'
            }`}
          >
            <CreditCard className="h-3.5 w-3.5" />
            <span>Unpaid ({unpaidCompletedOrders.length})</span>
          </button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchOrders()}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {loading && <OrdersSkeleton />}
      {error && <ErrorState message={error} onRetry={() => fetchOrders()} />}

      {!loading && !error && (
        <>
          {/* Mobile/Tablet Tabs (<1024px) */}
          <div className="flex lg:hidden overflow-x-auto scroll-hide gap-2 border-b border-border pb-2">
            {COLUMNS.map(col => {
              const count = getOrdersForStatus(col.key).length;
              return (
                <button
                  key={col.key}
                  onClick={() => setActiveTab(col.key)}
                  className={`
                    flex items-center gap-2 px-4 py-2 rounded-[var(--radius-input)] text-sm font-semibold
                    whitespace-nowrap transition-colors cursor-pointer
                    ${
                      activeTab === col.key
                        ? 'bg-primary text-white shadow-sm'
                        : 'bg-surface text-ink border border-border hover:bg-background'
                    }
                  `}
                >
                  <span>{col.label}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full ${
                      activeTab === col.key ? 'bg-white/20 text-white' : 'bg-background text-muted'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
            <button
              onClick={() => setActiveTab('unpaid')}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-[var(--radius-input)] text-sm font-semibold
                whitespace-nowrap transition-colors cursor-pointer
                ${
                  activeTab === 'unpaid'
                    ? 'bg-danger text-white shadow-sm'
                    : 'bg-surface text-ink border border-border hover:bg-background'
                }
              `}
            >
              <span>Unpaid</span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === 'unpaid' ? 'bg-white/20 text-white' : 'bg-danger/10 text-danger'
                }`}
              >
                {unpaidCompletedOrders.length}
              </span>
            </button>
          </div>

          {/* Active Tab View (<1024px) */}
          <div className="block lg:hidden">
            {activeTab === 'unpaid' ? (
              <UnpaidOrdersPanel
                orders={unpaidCompletedOrders}
                onMarkPaid={handleMarkPaid}
              />
            ) : (
              <OrderColumn
                column={COLUMNS.find(c => c.key === activeTab)!}
                orders={getOrdersForStatus(activeTab)}
                newOrderIds={newOrderIds}
                onAdvance={handleAdvance}
                onReject={order => {
                  setRejectingOrder(order);
                  setRejectReason('');
                  setRejectError('');
                }}
                onMarkPaid={handleMarkPaid}
                onUndoPaid={handleUndoPaid}
              />
            )}
          </div>

          {/* Desktop Unpaid List when toggled */}
          {showUnpaidSection && (
            <div className="hidden lg:block">
              <UnpaidOrdersPanel
                orders={unpaidCompletedOrders}
                onMarkPaid={handleMarkPaid}
              />
            </div>
          )}

          {/* 4-Column Board (>=1024px) */}
          <div className="hidden lg:grid lg:grid-cols-4 gap-4 items-start">
            {COLUMNS.map(col => (
              <OrderColumn
                key={col.key}
                column={col}
                orders={getOrdersForStatus(col.key)}
                newOrderIds={newOrderIds}
                onAdvance={handleAdvance}
                onReject={order => {
                  setRejectingOrder(order);
                  setRejectReason('');
                  setRejectError('');
                }}
                onMarkPaid={handleMarkPaid}
                onUndoPaid={handleUndoPaid}
              />
            ))}
          </div>
        </>
      )}

      {/* Reject Order Reason Dialog */}
      <Dialog
        open={rejectingOrder !== null}
        onClose={() => setRejectingOrder(null)}
        title={`Reject Order #${rejectingOrder?.orderNumber}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Please provide a reason. This will be shown to the customer on their status screen.
          </p>

          <Textarea
            label="Rejection Reason *"
            placeholder="e.g. Kitchen is closed, item ingredients unavailable"
            value={rejectReason}
            onChange={e => {
              setRejectReason(e.target.value);
              if (rejectError) setRejectError('');
            }}
            error={rejectError}
            rows={3}
            autoFocus
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setRejectingOrder(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRejectSubmit}>
              Confirm Rejection
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ─── Unpaid Orders List ───

function UnpaidOrdersPanel({
  orders,
  onMarkPaid,
}: {
  orders: Order[];
  onMarkPaid: (orderId: string, method: PaymentMethod) => void;
}) {
  return (
    <section
      data-testid="unpaid-orders-panel"
      className="bg-surface rounded-[var(--radius-card)] p-4 border border-danger/30 shadow-[var(--shadow-sm)] space-y-3"
    >
      <div className="flex items-center justify-between border-b border-border pb-2.5">
        <div className="flex items-center gap-2">
          <h2 className="font-heading font-bold text-sm text-ink">
            Unpaid Completed Orders
          </h2>
          <Badge variant="danger">{orders.length}</Badge>
        </div>
        <span className="text-xs font-semibold text-danger tabular-nums">
          Total: {formatPrice(orders.reduce((s, o) => s + o.total, 0))}
        </span>
      </div>

      {orders.length === 0 ? (
        <p className="text-xs text-muted py-6 text-center">
          All completed orders have been paid.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {orders.map(order => (
            <UnpaidOrderRow
              key={order.id}
              order={order}
              onMarkPaid={onMarkPaid}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function UnpaidOrderRow({
  order,
  onMarkPaid,
}: {
  order: Order;
  onMarkPaid: (orderId: string, method: PaymentMethod) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash');

  return (
    <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="font-heading font-bold text-sm text-ink">
            #{order.orderNumber} · {order.customerName}
          </span>
          <span className="text-xs text-primary font-semibold">Table {order.tableNumber}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          {order.customerPhone && (
            <span className="inline-flex items-center gap-1 font-medium text-ink tabular-nums">
              <Phone className="h-3 w-3 text-muted" />
              {order.customerPhone}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatElapsed(order.createdAt)}
          </span>
          <span className="font-semibold text-ink tabular-nums">
            {formatPrice(order.total)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <select
          aria-label={`Payment method for order #${order.orderNumber}`}
          value={method}
          onChange={e => setMethod(e.target.value as PaymentMethod)}
          className="h-9 px-2 text-xs bg-background border border-border rounded-[var(--radius-input)] text-ink"
        >
          <option value="cash">Cash</option>
          <option value="upi">UPI</option>
          <option value="card">Card</option>
        </select>
        <Button size="sm" variant="primary" onClick={() => onMarkPaid(order.id, method)}>
          Customer paid
        </Button>
      </div>
    </div>
  );
}

// ─── Column Component ───

interface OrderColumnProps {
  column: { key: OrderStatus; label: string; badgeVariant: 'warning' | 'primary' | 'success' | 'default' };
  orders: Order[];
  newOrderIds: Set<string>;
  onAdvance: (order: Order) => void;
  onReject: (order: Order) => void;
  onMarkPaid: (orderId: string, method: PaymentMethod) => void;
  onUndoPaid: (orderId: string) => void;
}

function OrderColumn({
  column,
  orders,
  newOrderIds,
  onAdvance,
  onReject,
  onMarkPaid,
  onUndoPaid,
}: OrderColumnProps) {
  return (
    <div className="bg-background/50 rounded-[var(--radius-card)] p-3 border border-border flex flex-col min-h-[500px]">
      {/* Column Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h2 className="font-heading font-bold text-sm text-ink">{column.label}</h2>
          <Badge variant={column.badgeVariant}>{orders.length}</Badge>
        </div>
      </div>

      {/* Orders List */}
      {orders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-muted">
          <Inbox className="h-8 w-8 mb-2 opacity-40" />
          <p className="text-xs">No {column.label.toLowerCase()} orders</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              isNew={newOrderIds.has(order.id)}
              onAdvance={() => onAdvance(order)}
              onReject={() => onReject(order)}
              onMarkPaid={method => onMarkPaid(order.id, method)}
              onUndoPaid={() => onUndoPaid(order.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Order Card Component ───

function OrderCard({
  order,
  isNew,
  onAdvance,
  onReject,
  onMarkPaid,
  onUndoPaid,
}: {
  order: Order;
  isNew: boolean;
  onAdvance: () => void;
  onReject: () => void;
  onMarkPaid: (method: PaymentMethod) => void;
  onUndoPaid: () => void;
}) {
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const mins = elapsedMinutes(order.createdAt);
  let timeColorClass = 'text-muted';
  if (order.status !== 'completed' && order.status !== 'rejected') {
    if (mins >= 20) {
      timeColorClass = 'text-danger font-bold';
    } else if (mins >= 10) {
      timeColorClass = 'text-warning font-semibold';
    }
  }

  const nextActionLabels: Record<OrderStatus, string | null> = {
    received: 'Accept & Cook',
    preparing: 'Mark Ready',
    ready: 'Complete Order',
    completed: null,
    rejected: null,
  };
  const actionLabel = nextActionLabels[order.status];
  const isPaid = order.paymentStatus === 'paid';

  return (
    <article
      className={`
        bg-surface rounded-[var(--radius-card)] p-4 border border-border shadow-[var(--shadow-sm)]
        transition-all duration-200 hover:shadow-[var(--shadow-lg)]
        ${isNew ? 'ring-2 ring-primary animate-pulse' : ''}
      `}
      style={isNew ? { animation: 'highlight-pulse 1.5s ease-in-out infinite' } : {}}
    >
      {/* Top Meta */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="font-heading font-bold text-base text-ink block">
            #{order.orderNumber}
          </span>
          <span className="text-xs font-semibold text-primary block">
            Table {order.tableNumber}
          </span>
        </div>

        <div className="text-right">
          <div className={`flex items-center justify-end gap-1 text-xs ${timeColorClass}`}>
            <Clock className="h-3 w-3" />
            <span>{formatElapsed(order.createdAt)}</span>
          </div>
          <span className="text-xs font-medium text-ink block mt-0.5">{order.customerName}</span>
          {order.customerPhone && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted mt-0.5 tabular-nums">
              <Phone className="h-2.5 w-2.5" />
              {order.customerPhone}
            </span>
          )}
        </div>
      </div>

      {/* Line Items */}
      <div className="py-2.5 my-2 border-y border-border space-y-1.5">
        {order.items.map((item, idx) => (
          <div key={idx} className="text-xs">
            <div className="flex justify-between items-baseline">
              <span className="font-medium text-ink">
                <span className="font-bold text-primary mr-1">{item.quantity}×</span>
                {item.name}
              </span>
              <span className="text-muted tabular-nums">{formatPrice(item.lineTotal)}</span>
            </div>
            {item.options.length > 0 && (
              <p className="text-[11px] text-muted pl-4">
                {item.options.map(o => o.optionName).join(', ')}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Footer / Total */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted">Total</span>
        <span className="text-sm font-heading font-bold text-ink tabular-nums">
          {formatPrice(order.total)}
        </span>
      </div>

      {/* Actions */}
      {order.status === 'received' && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button
            size="sm"
            variant="danger"
            onClick={onReject}
            icon={<XCircle className="h-3.5 w-3.5" />}
          >
            Reject
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={onAdvance}
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          >
            Accept
          </Button>
        </div>
      )}

      {actionLabel && order.status !== 'received' && (
        <Button
          size="sm"
          variant="primary"
          className="w-full flex items-center justify-center gap-1.5"
          onClick={onAdvance}
        >
          <span>{actionLabel}</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      )}

      {order.status === 'completed' && (
        <div className="pt-2 border-t border-border mt-2 space-y-2">
          {isPaid ? (
            <div className="flex items-center justify-between gap-2">
              <Badge variant="success">
                Paid · {(order.paymentMethod || 'cash').toUpperCase()}
              </Badge>
              <button
                type="button"
                onClick={onUndoPaid}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-danger transition-colors cursor-pointer"
                aria-label={`Undo paid for order #${order.orderNumber}`}
              >
                <RotateCcw className="h-3 w-3" />
                <span>Undo</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select
                aria-label={`Payment method for order #${order.orderNumber}`}
                value={payMethod}
                onChange={e => setPayMethod(e.target.value as PaymentMethod)}
                className="h-9 px-2 text-xs bg-background border border-border rounded-[var(--radius-input)] text-ink"
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
              </select>
              <Button
                size="sm"
                variant="primary"
                className="flex-1"
                onClick={() => onMarkPaid(payMethod)}
              >
                Customer paid
              </Button>
            </div>
          )}

          {order.paymentHistory && order.paymentHistory.length > 0 && (
            <div className="text-[11px] text-muted space-y-0.5 pt-1">
              {order.paymentHistory.map((h, idx) => (
                <p key={idx}>
                  {h.action === 'paid'
                    ? `Marked paid (${(h.method || '').toUpperCase()})`
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
      )}
    </article>
  );
}

// ─── Loading Skeleton ───

function OrdersSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map(col => (
        <div key={col} className="bg-background/50 rounded-[var(--radius-card)] p-3 border border-border space-y-3">
          <Skeleton className="h-6 w-24 mb-4" />
          {[1, 2].map(i => (
            <div key={i} className="bg-surface rounded-[var(--radius-card)] p-4 border border-border space-y-3">
              <div className="flex justify-between">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
