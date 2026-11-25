import { useEffect, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCartStore, selectCartItems, selectCartTotal } from '../../lib/cart-store';
import { formatPrice, cartItemTotal } from '../../lib/utils';
import QuantityStepper from '../ui/QuantityStepper';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import { Trash2, ShoppingBag, X } from 'lucide-react';

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
}

function CartDrawerComponent({ open, onClose }: CartDrawerProps) {
  const items = useCartStore(selectCartItems);
  const total = useCartStore(selectCartTotal);
  const updateQty = useCartStore(s => s.updateQty);
  const removeItem = useCartStore(s => s.removeItem);
  const navigate = useNavigate();
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  function handleCheckout() {
    onClose();
    navigate('/checkout');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Dialog */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your Cart"
        className="
          relative z-10 w-full max-h-[90dvh] md:max-h-[85vh] overflow-hidden flex flex-col bg-surface
          rounded-t-[20px] md:rounded-[var(--radius-card)] md:max-w-lg md:mx-4
          shadow-[var(--shadow-lg)] transition-all duration-200 ease-out
        "
        style={{ animation: 'sheet-up 200ms ease-out both' }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-surface px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-heading font-bold text-ink">Your Cart</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cart"
            className="w-9 h-9 flex items-center justify-center rounded-full text-muted hover:text-ink hover:bg-background transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<ShoppingBag className="h-12 w-12" />}
                title="Your cart is empty"
                description="Browse the menu and add some delicious items!"
                action={
                  <Button variant="secondary" onClick={onClose}>
                    Back to menu
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="pb-6">
              <ul className="divide-y divide-border">
                {items.map(item => (
                  <li key={item.cartItemId} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-heading font-semibold text-ink">{item.name}</p>
                        {item.selectedOptions && item.selectedOptions.length > 0 && (
                          <p className="text-xs text-muted mt-0.5 line-clamp-2">
                            {item.selectedOptions.map(o => o.optionName).join(', ')}
                          </p>
                        )}
                        {item.notes && (
                          <p className="text-xs text-muted mt-0.5 italic">Note: {item.notes}</p>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-ink tabular-nums shrink-0">
                        {formatPrice(cartItemTotal(item))}
                      </p>
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      <QuantityStepper
                        value={item.quantity}
                        onChange={q => updateQty(item.cartItemId, q)}
                        min={1}
                      />
                      <button
                        type="button"
                        onClick={() => removeItem(item.cartItemId)}
                        aria-label={`Remove ${item.name} from cart`}
                        className="h-11 w-11 flex items-center justify-center rounded-[var(--radius-input)] text-muted hover:text-danger hover:bg-danger/5 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Subtotal */}
              <div className="px-5 pt-4 border-t border-border">
                <div className="flex justify-between items-baseline">
                  <span className="text-base font-heading font-bold text-ink">Total</span>
                  <span className="text-lg font-heading font-bold text-ink tabular-nums">
                    {formatPrice(total)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Checkout Footer */}
        {items.length > 0 && (
          <div className="sticky bottom-0 bg-surface border-t border-border px-5 py-4 pb-[max(env(safe-area-inset-bottom,0px),16px)]">
            <Button
              size="lg"
              className="w-full"
              onClick={handleCheckout}
              aria-label="Review & Order - Checkout"
            >
              Review & Order
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(CartDrawerComponent);
