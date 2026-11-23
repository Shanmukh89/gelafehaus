// ─── Cart Store (Zustand + localStorage persistence by table) ───
import { create } from 'zustand';
import type { CartItem, MenuItem, SelectedOption } from './types';
import { cartTotal } from './utils';

interface CartState {
  tableNumber: string;
  items: CartItem[];
  idempotencyKey: string | null;
  setTable: (table: string) => void;
  addItem: (item: Omit<CartItem, 'cartItemId'>) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  removeItem: (cartItemId: string) => void;
  clearCart: () => void;
  itemCount: () => number;
  total: () => number;
  getIdempotencyKey: () => string;
  resetIdempotencyKey: () => void;
  validateCart: (menuItems: MenuItem[]) => void;
}

function storageKey(table: string) {
  return `gelafehaus-cart-${table}`;
}

function loadCart(table: string): CartItem[] {
  try {
    const raw = localStorage.getItem(storageKey(table));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(table: string, items: CartItem[]) {
  try {
    localStorage.setItem(storageKey(table), JSON.stringify(items));
  } catch {
    // quota exceeded — silent
  }
}

function displayCartNotification(changes: string[]) {
  if (changes.length === 0 || typeof document === 'undefined') return;
  const message = changes.join(' • ');
  const toastEl = document.createElement('div');
  toastEl.className =
    'fixed bottom-20 left-1/2 -translate-x-1/2 z-[70] bg-surface text-ink border border-border rounded-[var(--radius-card)] px-4 py-3 shadow-[var(--shadow-lg)] text-xs font-medium max-w-sm flex items-center gap-2 animate-bounce';
  toastEl.innerHTML = `<span>⚠️</span> <span class="flex-1">${message}</span>`;
  document.body.appendChild(toastEl);
  setTimeout(() => {
    toastEl.style.transition = 'opacity 300ms ease-out';
    toastEl.style.opacity = '0';
    setTimeout(() => toastEl.remove(), 300);
  }, 5000);
}

const SESSION_TABLE_KEY = 'gelafehaus-table';

function getStoredTable(): string {
  if (typeof window === 'undefined') return '';
  try {
    return sessionStorage.getItem(SESSION_TABLE_KEY) || '';
  } catch {
    return '';
  }
}

export const useCartStore = create<CartState>((set, get) => {
  const initialTable = getStoredTable();
  return {
    tableNumber: initialTable,
    items: initialTable ? loadCart(initialTable) : [],
    idempotencyKey: null,

    setTable: (table: string) => {
      try {
        if (table) {
          sessionStorage.setItem(SESSION_TABLE_KEY, table);
        } else {
          sessionStorage.removeItem(SESSION_TABLE_KEY);
        }
      } catch {
        // quota or privacy mode error - silent
      }
      const items = loadCart(table);
      set({ tableNumber: table, items });
    },

  addItem: (item) => {
    const cartItemId = crypto.randomUUID();
    set(state => {
      // Check if same item with same options already exists
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

  updateQuantity: (cartItemId, quantity) => {
    set(state => {
      const newItems = quantity <= 0
        ? state.items.filter(ci => ci.cartItemId !== cartItemId)
        : state.items.map(ci =>
            ci.cartItemId === cartItemId ? { ...ci, quantity } : ci
          );
      saveCart(state.tableNumber, newItems);
      return { items: newItems };
    });
  },

  removeItem: (cartItemId) => {
    set(state => {
      const newItems = state.items.filter(ci => ci.cartItemId !== cartItemId);
      saveCart(state.tableNumber, newItems);
      return { items: newItems };
    });
  },

  clearCart: () => {
    set(state => {
      localStorage.removeItem(storageKey(state.tableNumber));
      return { items: [], idempotencyKey: null };
    });
  },

  itemCount: () => get().items.reduce((s, i) => s + i.quantity, 0),
  total: () => cartTotal(get().items),

  getIdempotencyKey: () => {
    const existing = get().idempotencyKey;
    if (existing) return existing;
    const newKey = crypto.randomUUID();
    set({ idempotencyKey: newKey });
    return newKey;
  },

  resetIdempotencyKey: () => {
    set({ idempotencyKey: null });
  },

  validateCart: (menuItems: MenuItem[]) => {
    const currentItems = get().items;
    if (currentItems.length === 0 || menuItems.length === 0) return;

    const changes: string[] = [];
    const validItems: CartItem[] = [];

    const menuMap = new Map(menuItems.map(m => [m.id, m]));

    for (const cartItem of currentItems) {
      const liveItem = menuMap.get(cartItem.menuItemId);
      if (!liveItem || !liveItem.available) {
        changes.push(`${cartItem.name} was removed (sold out)`);
        continue;
      }

      let updatedItem = { ...cartItem };

      // Check base price
      if (cartItem.basePrice !== liveItem.price) {
        changes.push(`${cartItem.name} price updated`);
        updatedItem.basePrice = liveItem.price;
      }

      // Check options
      const validOptions: SelectedOption[] = [];
      const liveOptionMap = new Map<string, { price: number }>();
      for (const og of liveItem.optionGroups) {
        for (const opt of og.options) {
          liveOptionMap.set(opt.id, { price: opt.price });
        }
      }

      for (const opt of cartItem.selectedOptions) {
        const liveOpt = liveOptionMap.get(opt.optionId);
        if (liveOpt) {
          validOptions.push({
            ...opt,
            price: liveOpt.price,
          });
        } else {
          changes.push(`Option ${opt.optionName} is no longer available`);
        }
      }

      updatedItem.selectedOptions = validOptions;
      validItems.push(updatedItem);
    }

    if (changes.length > 0) {
      set({ items: validItems });
      saveCart(get().tableNumber, validItems);
      displayCartNotification(changes);
    }
  },
}; });

function optionsMatch(a: SelectedOption[], b: SelectedOption[]): boolean {
  if (a.length !== b.length) return false;
  const aIds = a.map(o => o.optionId).sort();
  const bIds = b.map(o => o.optionId).sort();
  return aIds.every((id, i) => id === bIds[i]);
}
