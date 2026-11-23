import { useState, useId } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCartStore } from '../../lib/cart-store';
import { formatPrice, cartItemTotal } from '../../lib/utils';
import { placeOrder } from '../../lib/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import OfflineBanner from '../../components/ui/OfflineBanner';
import { ArrowLeft, Info, ShoppingBag } from 'lucide-react';
import { useToast } from '../../components/ui/useToast';
import { useTurnstile } from '../../hooks/useTurnstile';

export default function CheckoutPage() {
  const [searchParams] = useSearchParams();
  const tableParam = searchParams.get('table') || '';
  const navigate = useNavigate();
  const { toast } = useToast();

  const items = useCartStore(s => s.items);
  const total = useCartStore(s => s.total());
  const clearCart = useCartStore(s => s.clearCart);
  const storeTable = useCartStore(s => s.tableNumber);

  const effectiveTable = storeTable || tableParam || '';

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [loading, setLoading] = useState(false);
  const nameInputId = useId();
  const { executeTurnstile } = useTurnstile();

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <OfflineBanner />
        <div className="max-w-md mx-auto px-4 py-16 text-center">
          <ShoppingBag className="h-12 w-12 text-muted mx-auto mb-4" />
          <h2 className="text-xl font-heading font-bold text-ink mb-2">Your cart is empty</h2>
          <p className="text-sm text-muted mb-6">Add some delicious burgers before checking out.</p>
          <Button onClick={() => navigate('/menu')}>
            Back to menu
          </Button>
        </div>
      </div>
    );
  }

  async function handlePlaceOrder(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      setNameError('Please enter your name');
      return;
    }
    setNameError('');

    setLoading(true);
    try {
      const turnstileToken = await executeTurnstile();

      // Send ONLY item IDs, option IDs, and quantities (server-side price validation)
      const payload = {
        customerName: name.trim(),
        tableNumber: effectiveTable,
        turnstileToken,
        items: items.map(item => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          optionIds: item.selectedOptions.map(o => o.optionId),
          notes: item.notes || '',
        })),
      };

      const order = await placeOrder(payload);
      clearCart();
      toast('Order placed successfully!', 'success');
      navigate(`/confirmation?orderId=${order.id}&table=${effectiveTable}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to place order';
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <OfflineBanner />

      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-md mx-auto flex items-center justify-between px-4 h-14">
          <button
            onClick={() => navigate(`/menu?table=${effectiveTable}`)}
            className="flex items-center gap-2 text-sm font-semibold text-ink hover:text-primary transition-colors cursor-pointer"
            aria-label="Back to menu"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Menu</span>
          </button>
          <span className="font-heading font-bold text-lg text-ink">Checkout</span>
          <div className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-6">
        <form onSubmit={handlePlaceOrder} className="space-y-6">
          {/* Customer & Table details */}
          <div className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)] space-y-4">
            <h2 className="text-base font-heading font-semibold text-ink">Your Details</h2>

            <div>
              <Input
                id={nameInputId}
                label="Your Name *"
                placeholder="e.g. Alex"
                value={name}
                onChange={e => {
                  setName(e.target.value);
                  if (nameError) setNameError('');
                }}
                error={nameError}
                autoFocus
                required
              />
            </div>

            <div>
              <label htmlFor="table-number-readonly" className="text-sm font-medium text-ink block mb-1.5">
                Table Number
              </label>
              <input
                id="table-number-readonly"
                type="text"
                readOnly
                value={`Table ${effectiveTable}`}
                className="h-11 px-3 text-sm bg-background text-muted border border-border rounded-[var(--radius-input)] w-full cursor-not-allowed font-medium"
              />
            </div>
          </div>

          {/* Pay at Counter Notice */}
          <div className="bg-surface rounded-[var(--radius-card)] p-4 border border-border flex items-start gap-3 shadow-[var(--shadow-sm)]">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Info className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Pay at the Counter</h3>
              <p className="text-xs text-muted mt-0.5">
                Place your order now. Payment will be collected in cash or card at the counter when you finish your meal.
              </p>
            </div>
          </div>

          {/* Order Summary */}
          <div className="bg-surface rounded-[var(--radius-card)] p-5 border border-border shadow-[var(--shadow-sm)]">
            <h2 className="text-base font-heading font-semibold text-ink mb-3">Order Summary</h2>
            <ul className="divide-y divide-border">
              {items.map(item => (
                <li key={item.cartItemId} className="py-3 flex justify-between items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      <span className="font-semibold tabular-nums text-primary mr-1.5">{item.quantity}×</span>
                      {item.name}
                    </p>
                    {item.selectedOptions.length > 0 && (
                      <p className="text-xs text-muted mt-0.5">
                        {item.selectedOptions.map(o => o.optionName).join(', ')}
                      </p>
                    )}
                    {item.notes && (
                      <p className="text-xs text-muted italic mt-0.5">
                        Note: {item.notes}
                      </p>
                    )}
                  </div>
                  <span className="text-sm font-semibold text-ink tabular-nums shrink-0">
                    {formatPrice(cartItemTotal(item))}
                  </span>
                </li>
              ))}
            </ul>

            <div className="pt-4 border-t border-border mt-2 flex justify-between items-baseline">
              <span className="text-base font-heading font-bold text-ink">Total</span>
              <span className="text-xl font-heading font-bold text-ink tabular-nums">
                {formatPrice(total)}
              </span>
            </div>
          </div>

          {/* Place Order Button */}
          <Button
            type="submit"
            size="lg"
            className="w-full text-base font-bold shadow-[var(--shadow-lg)]"
            loading={loading}
            disabled={loading}
          >
            Place order · {formatPrice(total)}
          </Button>
        </form>
      </main>
    </div>
  );
}
