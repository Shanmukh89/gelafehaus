import { useState, useId } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCartStore } from '../../lib/cart-store';
import { formatPrice, cartItemTotal } from '../../lib/utils';
import { placeOrder } from '../../lib/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import OfflineBanner from '../../components/ui/OfflineBanner';
import { ArrowLeft, Info, ShoppingBag, X } from 'lucide-react';
import { useToast } from '../../components/ui/useToast';
import { useTurnstile } from '../../hooks/useTurnstile';

function mapFriendlyOrderError(step: string, code: string | undefined, rawMsg: string): string {
  if (step === 'validate') return rawMsg;

  const detail = rawMsg.replace(/^[A-Z0-9_]+:\s*/, '');
  switch (code) {
    case 'RATE_LIMIT_EXCEEDED':
      return 'Too many order attempts right now. Please wait a minute and try again.';
    case 'BOT_VERIFICATION_FAILED':
      return 'Security verification failed. Please refresh the page and try again.';
    case 'INVALID_TABLE':
      return 'This table is unavailable or invalid. Please re-scan your table QR code.';
    case 'INVALID_CUSTOMER_NAME':
      return 'Please enter a valid name (1–60 characters).';
    case 'INVALID_PHONE':
      return 'Please enter a valid 10-digit Indian mobile number.';
    case 'ITEM_UNAVAILABLE':
    case 'ITEM_NOT_FOUND':
    case 'OFFER_EXPIRED':
    case 'MISSING_REQUIRED_OPTION':
    case 'OPTION_UNAVAILABLE':
    case 'INVALID_OPTION_COUNT':
    case 'MAX_OPTIONS_EXCEEDED':
    case 'INVALID_OPTION_FOR_ITEM':
      return detail;
    case 'INVALID_ITEMS':
    case 'INVALID_ITEM_ID':
    case 'INVALID_QUANTITY':
      return 'Your cart has an invalid item or quantity. Please review your cart and try again.';
    default:
      if (rawMsg === 'timeout' || rawMsg.toLowerCase().includes('unable to reach order service')) {
        return 'Connection timed out. Please check your internet and try again.';
      }
      return 'We could not place your order right now. Please try again or ask a staff member for help.';
  }
}

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
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [loading, setLoading] = useState(false);
  const [orderError, setOrderError] = useState<{
    step: string;
    message: string;
    code?: string;
    rawMessage: string;
  } | null>(null);
  const nameInputId = useId();
  const phoneInputId = useId();
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
    let step = 'validate';

    try {
      // ── Step: validate ──
      if (!effectiveTable) {
        throw new Error('Table number is missing. Please scan your table QR code.');
      }

      if (!name.trim()) {
        setNameError('Please enter your name');
        throw new Error('Please enter your name');
      }
      setNameError('');

      const cleanPhone = phone.replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
        setPhoneError('Enter a valid 10-digit Indian mobile number');
        throw new Error('Enter a valid 10-digit Indian mobile number');
      }
      setPhoneError('');

      const sessionTable = sessionStorage.getItem('gelafehaus-table');
      if (!sessionTable) {
        throw new Error('Session table number is missing (sessionStorage empty). Please re-scan your table QR code.');
      }

      setLoading(true);
      setOrderError(null);

      // ── Step: token ──
      step = 'token';
      const turnstileToken = await executeTurnstile();
      if (!turnstileToken) {
        throw new Error('Turnstile did not return a token.');
      }

      // ── Step: request ──
      step = 'request';
      const payload = {
        customerName: name.trim(),
        customerPhone: `+91${cleanPhone}`,
        tableNumber: effectiveTable,
        turnstileToken,
        items: items.map(item => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          optionIds: item.selectedOptions.map(o => o.optionId),
          notes: item.notes || '',
          offerId: item.offerId,
        })),
      };

      // ── Step: response ──
      step = 'response';
      const order = await placeOrder(payload);

      if (!order || !order.id) {
        throw new Error('Server returned an empty or invalid order object.');
      }

      // ── Step: session ──
      step = 'session';
      clearCart();
      toast('Order placed successfully!', 'success');
      navigate(`/confirmation?orderId=${order.id}&table=${effectiveTable}`);
    } catch (err: unknown) {
      const errObj = err as {
        message?: string;
        code?: string;
        details?: unknown;
        hint?: string;
        status?: number;
        responseBody?: unknown;
      };
      const rawMsg = err instanceof Error ? err.message : String(err);
      const errCode = errObj?.code;
      console.error('[PlaceOrder] FAILED:', {
        step,
        message: rawMsg,
        code: errCode,
        details: errObj?.details,
        hint: errObj?.hint,
        status: errObj?.status,
        responseBody: errObj?.responseBody,
        error: err,
      });

      const friendlyMsg = mapFriendlyOrderError(step, errCode, rawMsg);
      setOrderError({ step, message: friendlyMsg, code: errCode, rawMessage: rawMsg });
      toast(friendlyMsg, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <OfflineBanner />

      {/* ── Persistent Order Error Banner ── */}
      {orderError && (
        <div
          role="alert"
          className="sticky top-0 z-50 bg-red-600 text-white px-4 py-3 shadow-lg"
        >
          <div className="max-w-md mx-auto flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">
                Could not place your order
              </p>
              <p className="text-xs mt-0.5 opacity-90 break-words">
                {orderError.message}
              </p>
            </div>
            <button
              onClick={() => setOrderError(null)}
              className="shrink-0 mt-0.5 p-0.5 hover:bg-red-700 rounded transition-colors cursor-pointer"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

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
        <form onSubmit={handlePlaceOrder} noValidate className="space-y-6">
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
              <label htmlFor={phoneInputId} className="text-sm font-medium text-ink block mb-1.5">
                Mobile Number *
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-3 h-11 text-sm font-semibold bg-background text-ink border border-r-0 border-border rounded-l-[var(--radius-input)] select-none">
                  +91
                </span>
                <input
                  id={phoneInputId}
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="9876543210"
                  value={phone}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                    setPhone(digits);
                    if (phoneError) setPhoneError('');
                  }}
                  required
                  className={`
                    h-11 px-3 text-sm bg-surface text-ink placeholder:text-muted
                    border rounded-r-[var(--radius-input)] w-full
                    focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors
                    ${phoneError ? 'border-danger focus:border-danger' : 'border-border focus:border-primary'}
                  `}
                />
              </div>
              {phoneError && (
                <p className="text-xs text-danger mt-1" role="alert">
                  {phoneError}
                </p>
              )}
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
                  <div className="text-right shrink-0">
                    <span className="text-sm font-semibold text-ink tabular-nums block">
                      {formatPrice(cartItemTotal(item))}
                    </span>
                    {item.originalPrice && item.originalPrice > item.basePrice && (
                      <span className="text-xs text-muted line-through tabular-nums block">
                        {formatPrice(
                          (item.originalPrice +
                            item.selectedOptions.reduce((s, o) => s + o.price, 0)) *
                            item.quantity
                        )}
                      </span>
                    )}
                  </div>
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
