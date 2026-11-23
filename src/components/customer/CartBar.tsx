import { useState } from 'react';
import { useCartStore } from '../../lib/cart-store';
import { formatPrice, cartTotal } from '../../lib/utils';
import { ShoppingCart } from 'lucide-react';
import CartDrawer from './CartDrawer';

interface CartBarProps {
  onOpen?: () => void;
}

export default function CartBar({ onOpen }: CartBarProps = {}) {
  const [internalDrawerOpen, setInternalDrawerOpen] = useState(false);
  const items = useCartStore(s => s.items);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const total = cartTotal(items);

  if (itemCount === 0) return null;

  const handleOpen = onOpen || (() => setInternalDrawerOpen(true));

  return (
    <>
      <div
        className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-4 pt-2 pointer-events-none"
        style={{ animation: 'slide-up 200ms ease-out both' }}
      >
        <div className="max-w-md mx-auto pointer-events-auto">
          <button
            onClick={handleOpen}
            className="
              w-full flex items-center justify-between
              bg-primary text-white rounded-[var(--radius-card)] px-5 py-3.5
              shadow-[var(--shadow-lg)] cursor-pointer
              transition-transform duration-150 active:scale-[0.98]
            "
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <ShoppingCart className="h-5 w-5" />
                <span className="absolute -top-2 -right-2 bg-white text-primary text-xs font-bold h-5 w-5 rounded-full flex items-center justify-center tabular-nums">
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
