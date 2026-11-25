import { create } from 'zustand';
import type { CartItem, MenuItem, SelectedOption } from './types';
import { cartTotal } from './utils';

export interface CartState {
  tableNumber: string;
  items: CartItem[];
  idempotencyKey: string | null;

  // Table
  setTable: (table: string) => void;

  // Actions
  addItem: (item: Omit<CartItem, 'cartItemId'>) => void;
  updateQty: (cartItemId: string, quantity: number) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  removeItem: (cartItemId: string) => void;
  clear: () => void;
  clearCart: () => void;

  // Selectors/methods
  itemCount: () => number;
  total: () => number;

  // Order idempotency & cart validation
  getIdempotencyKey: () => string;
  resetIdempotencyKey: () => void;
  validateCart: (menuItems: MenuItem[]) => void;
}

const SESSION_TABLE_KEY = 'gelafehaus-table';

function storageKey(table: string) {
  return `gelafehaus-cart-${table || 'default'}`;
}

function loadCart(table: string): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(table));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(table: string, items: CartItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(table), JSON.stringify(items));
  } catch {
    // Quota exceeded or private browsing: fail silently
  }
}

function getStoredTable(): string {
  if (typeof window === 'undefined') return '';
  try {
    return sessionStorage.getItem(SESSION_TABLE_KEY) || '';
  } catch {
    return '';
  }
}

function optionsMatch(a: SelectedOption[], b: SelectedOption[]): boolean {
  if (a.length !== b.length) return false;
  const aIds = a.map(o => o.optionId).sort();
  const bIds = b.map(o => o.optionId).sort();
  return aIds.every((id, i) => id === bIds[i]);
}

// ─── One Zustand Store Instance ───
export const useCartStore = create<CartState>((set, get) => {
  const initialTable = getStoredTable();

  const updateQtyHandler = (cartItemId: string, quantity: number) => {
    set(state => {
      const newItems =
        quantity <= 0
          ? state.items.filter(ci => ci.cartItemId !== cartItemId)
          : state.items.map(ci =>
              ci.cartItemId === cartItemId ? { ...ci, quantity } : ci
            );
      saveCart(state.tableNumber, newItems);
      return { items: newItems };
    });
  };

  const clearHandler = () => {
    set(state => {
      if (typeof window !== 'undefined') {
        try {
          localStorage.removeItem(storageKey(state.tableNumber));
        } catch {
          // Silent
        }
      }
      return { items: [], idempotencyKey: null };
    });
  };

  return {
    tableNumber: initialTable,
    items: initialTable ? loadCart(initialTable) : [],
    idempotencyKey: null,

    setTable: (table: string) => {
      try {
        if (typeof window !== 'undefined') {
          if (table) {
            sessionStorage.setItem(SESSION_TABLE_KEY, table);
          } else {
            sessionStorage.removeItem(SESSION_TABLE_KEY);
          }
        }
      } catch {
        // Silent
      }
      const items = loadCart(table);
      set({ tableNumber: table, items });
    },

    addItem: item => {
      const cartItemId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `item_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      set(state => {
        const existing = state.items.find(
          ci =>
            ci.menuItemId === item.menuItemId &&
            optionsMatch(ci.selectedOptions, item.selectedOptions)
        );

        let newItems: CartItem[];
        if (existing) {
          newItems = state.items.map(ci =>
            ci.cartItemId === existing.cartItemId
              ? { ...ci, quantity: ci.quantity + item.quantity }
              : ci
          );
        } else {
          newItems = [...state.items, { ...item, cartItemId }];
        }

        saveCart(state.tableNumber, newItems);
        return { items: newItems };
      });
    },

    updateQty: updateQtyHandler,
    updateQuantity: updateQtyHandler,

    removeItem: (cartItemId: string) => {
      set(state => {
        const newItems = state.items.filter(ci => ci.cartItemId !== cartItemId);
        saveCart(state.tableNumber, newItems);
        return { items: newItems };
      });
    },

    clear: clearHandler,
    clearCart: clearHandler,

    itemCount: () => get().items.reduce((sum, item) => sum + item.quantity, 0),
    total: () => cartTotal(get().items),

    getIdempotencyKey: () => {
      const existing = get().idempotencyKey;
      if (existing) return existing;
      const newKey =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `ord_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      set({ idempotencyKey: newKey });
      return newKey;
    },

    resetIdempotencyKey: () => {
      set({ idempotencyKey: null });
    },

    validateCart: (menuItems: MenuItem[]) => {
      const currentItems = get().items;
      if (currentItems.length === 0 || menuItems.length === 0) return;

      const menuMap = new Map(menuItems.map(m => [m.id, m]));
      const validItems: CartItem[] = [];

      for (const cartItem of currentItems) {
        const liveItem = menuMap.get(cartItem.menuItemId);
        if (!liveItem || !liveItem.available) {
          continue;
        }

        const updatedItem = { ...cartItem };
        if (cartItem.basePrice !== liveItem.price) {
          updatedItem.basePrice = liveItem.price;
        }

        const validOptions: SelectedOption[] = [];
        const liveOptionMap = new Map<string, { price: number }>();
        for (const og of liveItem.optionGroups || []) {
          for (const opt of og.options || []) {
            liveOptionMap.set(opt.id, { price: opt.price });
          }
        }

        for (const opt of cartItem.selectedOptions || []) {
          const liveOpt = liveOptionMap.get(opt.optionId);
          if (liveOpt) {
            validOptions.push({
              ...opt,
              price: liveOpt.price,
            });
          }
        }

        updatedItem.selectedOptions = validOptions;
        validItems.push(updatedItem);
      }

      set({ items: validItems });
      saveCart(get().tableNumber, validItems);
    },
  };
});

// ─── Selectors ───
export const selectCartCount = (state: CartState): number =>
  state.items.reduce((sum, item) => sum + item.quantity, 0);

export const selectCartTotal = (state: CartState): number =>
  cartTotal(state.items);

export const selectCartItems = (state: CartState): CartItem[] => state.items;
