import { useEffect, useState, useRef, useCallback } from 'react';
import { getOrders, updateOrderStatus } from '../../lib/api';
import type { Order, OrderStatus } from '../../lib/types';
import { formatPrice, formatElapsed, elapsedMinutes } from '../../lib/utils';
import { soundAlert } from '../../lib/sound';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Dialog from '../../components/ui/Dialog';
import Textarea from '../../components/ui/Textarea';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import { useToast } from '../../components/ui/useToast';
import { Clock, CheckCircle2, ChevronRight, XCircle, Inbox, RefreshCw } from 'lucide-react';

const COLUMNS: { key: OrderStatus; label: string; badgeVariant: 'warning' | 'primary' | 'success' | 'default' }[] = [
  { key: 'received', label: 'Received', badgeVariant: 'warning' },
  { key: 'preparing', label: 'Preparing', badgeVariant: 'primary' },
  { key: 'ready', label: 'Ready', badgeVariant: 'success' },
  { key: 'completed', label: 'Completed', badgeVariant: 'default' },
];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OrderStatus>('received');
  const [rejectingOrder, setRejectingOrder] = useState<Order | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());

  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const initialLoadRef = useRef(true);
  const { toast } = useToast();

  const fetchOrders = useCallback(async (isSilent = false) => {
    if (!isSilent && !initialLoadRef.current) setLoading(true);
    try {
      const data = await getOrders();
      setOrders(data);

      // Check for newly arrived orders
      const currentIds = new Set(data.map(o => o.id));
      if (!initialLoadRef.current) {
        const freshIds = data
          .filter(o => !knownOrderIdsRef.current.has(o.id) && o.status === 'received')
          .map(o => o.id);

        if (freshIds.length > 0) {
          soundAlert.playChime();
          toast(`🔔 New order arrived! (#${data.find(o => o.id === freshIds[0])?.orderNumber})`, 'info');
          setNewOrderIds(prev => new Set([...prev, ...freshIds]));
          // Remove highlight after 6 seconds
          setTimeout(() => {
            setNewOrderIds(prev => {
              const next = new Set(prev);
              freshIds.forEach(id => next.delete(id));
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
  }, [toast]);

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

    const interval = setInterval(() => fetchOrders(true), 3500);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [fetchOrders]);

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

  const getOrdersForStatus = (status: OrderStatus) =>
    orders.filter(o => o.status === status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-ink">Live Orders Board</h1>
          <p className="text-sm text-muted mt-0.5">Kitchen display & order tracking</p>
        </div>

        <div className="flex items-center gap-3">
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
                    ${activeTab === col.key
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-surface text-ink border border-border hover:bg-background'
                    }
                  `}
                >
                  <span>{col.label}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === col.key ? 'bg-white/20 text-white' : 'bg-background text-muted'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Active Tab View (<1024px) */}
          <div className="block lg:hidden">
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
            />
          </div>

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

// ─── Column Component ───

interface OrderColumnProps {
  column: { key: OrderStatus; label: string; badgeVariant: 'warning' | 'primary' | 'success' | 'default' };
  orders: Order[];
  newOrderIds: Set<string>;
  onAdvance: (order: Order) => void;
  onReject: (order: Order) => void;
}

function OrderColumn({ column, orders, newOrderIds, onAdvance, onReject }: OrderColumnProps) {
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
}: {
  order: Order;
  isNew: boolean;
  onAdvance: () => void;
  onReject: () => void;
}) {
  const mins = elapsedMinutes(order.createdAt);
  // Time urgency colors: >10 min warning, >20 min danger
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
          <div className={`flex items-center gap-1 text-xs ${timeColorClass}`}>
            <Clock className="h-3 w-3" />
            <span>{formatElapsed(order.createdAt)}</span>
          </div>
          <span className="text-xs text-muted block mt-0.5">{order.customerName}</span>
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

      {/* Footer / Total & Actions */}
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
        <div className="text-center py-1 text-xs text-success font-medium flex items-center justify-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>Served & Finished</span>
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
