// ─── Format money (paise → ₹ display) ───
const formatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatPrice(paise: number): string {
  return formatter.format(paise / 100);
}

// ─── Elapsed time helpers ───
export function elapsedMinutes(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 60_000);
}

export function formatElapsed(isoDate: string): string {
  const mins = elapsedMinutes(isoDate);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

// ─── Cart item price calculator ───
import type { CartItem } from './types';

export function cartItemTotal(item: CartItem): number {
  const optionsTotal = item.selectedOptions.reduce((sum, o) => sum + o.price, 0);
  return (item.basePrice + optionsTotal) * item.quantity;
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + cartItemTotal(item), 0);
}

// ─── Validate table number ───
export function isValidTable(table: string | null): boolean {
  if (!table) return false;
  const num = parseInt(table, 10);
  return num >= 1 && num <= 50;
}

export function padTableNumber(table: string): string {
  return table.padStart(2, '0');
}
