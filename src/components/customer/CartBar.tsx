import { useState, memo } from 'react';
import { useCartStore, selectCartCount, selectCartTotal } from '../../lib/cart-store';
import { formatPrice } from '../../lib/utils';
import { ShoppingCart } from 'lucide-react';
import CartDrawer from './CartDrawer';

interface CartBarProps {
  onOpen?: () => void;
}

function CartBarComponent({ onOpen }: CartBarProps) {
  const [internalDrawerOpen, setInternalDrawerOpen] = useState(false);
  const itemCount = useCartStore(selectCartCount);
  const total = useCartStore(selectCartTotal);

  if (itemCount === 0) return null;

  const handleOpen = onOpen || (() => setInternalDrawerOpen(true));

  return (
    <>
      <div
        className="fixed bottom-0 left-0 right-0 z-40 px-4 pt-2 pb-[max(env(safe-area-inset-bottom,0px),16px)] pointer-events-none transition-transform duration-200 ease-out"
        style={{ animation: 'slide-up 200ms ease-out both' }}
      >
        <div className="max-w-md mx-auto pointer-events-auto">
          <button
            type="button"
            onClick={handleOpen}
            aria-label={`View cart, ${itemCount} items, total ${formatPrice(total)}`}
            className="
              w-full flex items-center justify-between
              bg-primary text-white rounded-[var(--radius-card)] px-5 py-3.5
              shadow-[var(--shadow-lg)] cursor-pointer
              transition-transform duration-150 active:scale-[0.98]
            "
          >
            <div className="flex items-center gap-3">
              <div className="relative flex items-center justify-center">
                <ShoppingCart className="h-5 w-5" />
                <span className="absolute -top-2 -right-2 bg-white text-primary text-xs font-bold h-5 min-w-[20px] px-1 rounded-full flex items-center justify-center tabular-nums shadow-sm">
                  {itemCount}
                </span>
              </div>
              <span className="text-sm font-semibold">View cart</span>
            </div>
            <span className="text-sm font-bold tabular-nums">{formatPrice(total)}</span>
          </button>
        </div>
      </div>

      {!onOpen && (
        <CartDrawer
          open={internalDrawerOpen}
          onClose={() => setInternalDrawerOpen(false)}
        />
      )}
    </>
  );
}

export default memo(CartBarComponent);
