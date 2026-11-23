import { useCartStore } from '../../lib/cart-store';
import { formatPrice, cartItemTotal } from '../../lib/utils';
import Sheet from '../ui/Sheet';
import QuantityStepper from '../ui/QuantityStepper';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import { Trash2, ShoppingBag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function CartDrawer({ open, onClose }: CartDrawerProps) {
  const items = useCartStore(s => s.items);
  const updateQuantity = useCartStore(s => s.updateQuantity);
  const removeItem = useCartStore(s => s.removeItem);
  const total = useCartStore(s => s.total());
  const navigate = useNavigate();

  function handleCheckout() {
    onClose();
    navigate('/checkout');
  }

  return (
    <Sheet open={open} onClose={onClose} title="Your Cart">
      {items.length === 0 ? (
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
      ) : (
        <div className="pb-28">
          <ul className="divide-y divide-border">
            {items.map(item => (
              <li key={item.cartItemId} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-heading font-semibold text-ink">{item.name}</p>
                    {item.selectedOptions.length > 0 && (
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
                    onChange={q => updateQuantity(item.cartItemId, q)}
                    min={1}
                  />
                  <button
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

          {/* Totals */}
          <div className="px-5 pt-4 border-t border-border">
            <div className="flex justify-between items-baseline">
              <span className="text-base font-heading font-bold text-ink">Total</span>
              <span className="text-lg font-heading font-bold text-ink tabular-nums">{formatPrice(total)}</span>
            </div>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="sticky bottom-0 bg-surface border-t border-border px-5 py-4">
          <Button size="lg" className="w-full" onClick={handleCheckout}>
            Checkout
          </Button>
        </div>
      )}
    </Sheet>
  );
}
