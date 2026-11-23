import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getOrder } from '../../lib/api';
import type { Order, OrderStatus } from '../../lib/types';
import { formatPrice } from '../../lib/utils';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import OfflineBanner from '../../components/ui/OfflineBanner';
import { Check, Clock, ChefHat, Bell, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';

const STATUS_STEPS: { key: OrderStatus; label: string; icon: typeof Clock }[] = [
  { key: 'received', label: 'Received', icon: Clock },
  { key: 'preparing', label: 'Preparing', icon: ChefHat },
  { key: 'ready', label: 'Ready', icon: Bell },
  { key: 'completed', label: 'Completed', icon: CheckCircle2 },
];

export default function ConfirmationPage() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');
  const navigate = useNavigate();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(Boolean(orderId));
  const [error, setError] = useState<string | null>(orderId ? null : 'No order ID provided');

  const fetchOrderStatus = useCallback(async () => {
    if (!orderId) return;
    try {
      const data = await getOrder(orderId);
      if (data) {
        setOrder(data);
      } else {
        setError('Order not found');
      }
    } catch {
      setError('Failed to fetch order status');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    let ignore = false;
    getOrder(orderId)
      .then(data => {
        if (!ignore) {
          if (data) {
            setOrder(data);
          } else {
            setError('Order not found');
          }
        }
      })
      .catch(() => {
        if (!ignore) setError('Failed to fetch order status');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    const interval = setInterval(fetchOrderStatus, 4000);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [orderId, fetchOrderStatus]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <OfflineBanner />
        <div className="max-w-md mx-auto px-4 py-16 space-y-6">
          <Skeleton className="h-24 w-24 rounded-full mx-auto" />
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-32 w-full rounded-[var(--radius-card)]" />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-background">
        <OfflineBanner />
        <div className="max-w-md mx-auto px-4 py-16">
          <ErrorState message={error || 'Could not load order.'} onRetry={fetchOrderStatus} />
          <div className="mt-4 text-center">
            <Button variant="secondary" onClick={() => navigate('/menu')}>
              Back to menu
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isRejected = order.status === 'rejected';
  const currentStepIndex = STATUS_STEPS.findIndex(s => s.key === order.status);

  return (
    <div className="min-h-screen bg-background pb-16">
      <OfflineBanner />

      <main className="max-w-md mx-auto px-4 pt-8">
        {/* Animated Check & Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-success/10 mb-4">
            <svg
              className="h-10 w-10 text-success"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth="2.5"
            >
              <circle cx="12" cy="12" r="10" className="opacity-20" />
              <path
                className="check-animate"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 13l3 3 7-7"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-heading font-bold text-ink">Order #{order.orderNumber}</h1>
          <p className="text-sm text-muted mt-1">
            Table {order.tableNumber} &middot; {order.customerName}
          </p>
          <div className="mt-2">
            <Badge variant="primary">Pay at counter</Badge>
          </div>
        </div>

        {/* Rejection alert */}
        {isRejected && (
          <div className="mb-6 p-4 rounded-[var(--radius-card)] bg-danger/10 border border-danger/20 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-danger">Order could not be accepted</p>
              {order.rejectionReason && (
                <p className="text-xs text-danger/80 mt-1">Reason: {order.rejectionReason}</p>
              )}
            </div>
          </div>
        )}

        {/* Live Status Tracker */}
        {!isRejected && (
          <div className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)] mb-6">
            <h2 className="text-sm font-heading font-semibold text-muted uppercase tracking-wider mb-4">
              Order Status
            </h2>

            <div className="relative">
              {/* Stepper connecting line */}
              <div className="absolute top-4 left-4 right-4 h-0.5 bg-border -z-0" />

              <div className="flex justify-between items-start relative z-10">
                {STATUS_STEPS.map((step, idx) => {
                  const isDone = currentStepIndex > idx;
                  const isCurrent = currentStepIndex === idx;
                  const Icon = step.icon;

                  let circleClasses = 'bg-surface border-2 border-border text-muted';
                  if (isDone) {
                    circleClasses = 'bg-success text-white border-2 border-success';
                  } else if (isCurrent) {
                    circleClasses = 'bg-primary text-white border-2 border-primary shadow-[0_0_0_4px_rgba(228,87,46,0.15)]';
                  }

                  return (
                    <div key={step.key} className="flex flex-col items-center">
                      <div
                        className={`
                          h-8 w-8 rounded-full flex items-center justify-center transition-all duration-300
                          ${circleClasses}
                        `}
                      >
                        {isDone ? (
                          <Check className="h-4 w-4 stroke-[3]" />
                        ) : (
                          <Icon className="h-4 w-4" />
                        )}
                      </div>
                      <span
                        className={`
                          text-xs mt-2 font-medium transition-colors duration-150 text-center
                          ${isCurrent ? 'text-primary font-semibold' : isDone ? 'text-ink' : 'text-muted'}
                        `}
                      >
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-border flex items-center justify-between text-xs text-muted">
              <span>Auto-refreshing status</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                Live
              </span>
            </div>
          </div>
        )}

        {/* Order Details */}
        <div className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)] mb-6">
          <h2 className="text-sm font-heading font-semibold text-ink mb-3">Order Items</h2>
          <ul className="divide-y divide-border">
            {order.items.map((item, idx) => (
              <li key={idx} className="py-2.5 flex justify-between items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    <span className="font-semibold text-primary mr-1.5">{item.quantity}×</span>
                    {item.name}
                  </p>
                  {item.options.length > 0 && (
                    <p className="text-xs text-muted mt-0.5">
                      {item.options.map(o => o.optionName).join(', ')}
                    </p>
                  )}
                </div>
                <span className="text-sm font-semibold text-ink tabular-nums shrink-0">
                  {formatPrice(item.lineTotal)}
                </span>
              </li>
            ))}
          </ul>

          <div className="pt-3 border-t border-border mt-2 flex justify-between items-baseline">
            <span className="text-sm font-heading font-bold text-ink">Total to Pay at Counter</span>
            <span className="text-lg font-heading font-bold text-ink tabular-nums">
              {formatPrice(order.total)}
            </span>
          </div>
        </div>

        {/* Action Button */}
        <div className="space-y-3">
          <Button
            variant="secondary"
            size="lg"
            className="w-full flex items-center justify-center gap-2"
            onClick={() => navigate('/menu')}
          >
            <span>Order more</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </main>
    </div>
  );
}
