// ─── Supabase API Layer for Gelafehaus ───
// Implements real Supabase database, RPC, and Realtime calls.
// Preserves every function signature and return type so UI components remain unchanged.

import { supabase, isSupabaseConfigured, isProductionMissingConfig } from './supabase';
import type {
  MenuItem,
  Order,
  OrderLineItem,
  SelectedOption,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentHistoryEntry,
  PlaceOrderPayload,
  DayStats,
  MenuCategory,
  OptionGroup,
  Offer,
  InsightsRange,
  InsightsData,
} from './types';
import { getOfferStatus } from './types';
import { menuItems as seedMenu } from './menu-data';
import { useCartStore } from './cart-store';
import { padTableNumber } from './utils';

// ─── Local in-memory fallback state (used if backend is unreachable) ───
function getStoredFallbackOrders(): Order[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('gelafehaus_fallback_orders');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredFallbackOrders(orders: Order[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('gelafehaus_fallback_orders', JSON.stringify(orders));
  } catch {
    // ignore
  }
}

// ─── Lightweight Dev Server Cross-Device Sync ───
// Enables phone (customer) and laptop (admin) on the same Wi-Fi network
// to share live orders & sequential daily numbers in DEV mode when Supabase isn't running.
async function syncOrderToDevServer(order: Order): Promise<Order | null> {
  if (typeof window === 'undefined' || !import.meta.env.DEV) return null;
  try {
    const res = await fetch('/_dev_sync/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.order) return json.order as Order;
    }
  } catch {
    // ignore
  }
  return null;
}

async function fetchOrdersFromDevServer(): Promise<Order[] | null> {
  if (typeof window === 'undefined' || !import.meta.env.DEV) return null;
  try {
    const res = await fetch('/_dev_sync/orders');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
    }
  } catch {
    // ignore
  }
  return null;
}

function getStoredFallbackMenu(): MenuItem[] {
  if (typeof window === 'undefined') return [...seedMenu];
  try {
    const raw = localStorage.getItem('gelafehaus_fallback_menu');
    return raw ? JSON.parse(raw) : [...seedMenu];
  } catch {
    return [...seedMenu];
  }
}

function saveStoredFallbackMenu(menu: MenuItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('gelafehaus_fallback_menu', JSON.stringify(menu));
  } catch {
    // ignore
  }
}

function getStoredFallbackOffers(): import('./types').Offer[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('gelafehaus_fallback_offers');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredFallbackOffers(offers: import('./types').Offer[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('gelafehaus_fallback_offers', JSON.stringify(offers));
  } catch {
    // ignore
  }
}

const ALLOW_DEV_FALLBACK = import.meta.env.DEV;

let fallbackMenu: MenuItem[] = getStoredFallbackMenu();
let fallbackOrders: Order[] = getStoredFallbackOrders();
let fallbackOffers: import('./types').Offer[] = getStoredFallbackOffers();

function isNetworkOrUnreachableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'FunctionsFetchError') return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('failed to send a request to the edge function') ||
    msg === 'timeout' ||
    msg.includes('load failed') ||
    msg.includes('networkerror') ||
    msg.includes('connection refused') ||
    msg.includes('err_connection')
  );
}

export function normalizeIndianPhone(raw: string): string | null {
  const cleaned = raw.trim().replace(/^(\+91|91)?[\s-]*/, '').replace(/[\s-]/g, '');
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }
  return null;
}

// ─── Global Realtime Subscription for Admin ───
let adminRealtimeSubscribed = false;

export type RealtimeStatus = 'live' | 'reconnecting';

export function subscribeAdminRealtime(
  onOrderEvent: (event: { type: 'insert' | 'update'; orderId?: string }) => void,
  onStatusChange?: (status: RealtimeStatus) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  let devSource: EventSource | null = null;
  let devSyncConnected = false;

  // 1. Supabase Realtime single channel for orders (INSERT, UPDATE) & order_items
  const channel = supabase
    .channel('admin_live_orders')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      payload => {
        const orderId = (payload.new as { id?: string })?.id;
        onOrderEvent({ type: 'insert', orderId });
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders' },
      payload => {
        const orderId = (payload.new as { id?: string })?.id;
        onOrderEvent({ type: 'update', orderId });
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_items' },
      payload => {
        const orderId =
          (payload.new as { order_id?: string })?.order_id ||
          (payload.old as { order_id?: string })?.order_id;
        onOrderEvent({ type: 'update', orderId });
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'payments' },
      payload => {
        const orderId =
          (payload.new as { order_id?: string })?.order_id ||
          (payload.old as { order_id?: string })?.order_id;
        onOrderEvent({ type: 'update', orderId });
      }
    )
    .subscribe(status => {
      if (status === 'SUBSCRIBED') {
        onStatusChange?.('live');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (!devSyncConnected) {
          onStatusChange?.('reconnecting');
        }
      }
    });

  // 2. Dev-sync SSE stream for instant Wi-Fi / local dev updates (<100ms)
  if (typeof EventSource !== 'undefined') {
    try {
      devSource = new EventSource('/_dev_sync/events');
      devSource.onopen = () => {
        devSyncConnected = true;
        onStatusChange?.('live');
      };
      devSource.onmessage = evt => {
        try {
          const parsed = JSON.parse(evt.data);
          if (parsed.type === 'connected') {
            devSyncConnected = true;
            onStatusChange?.('live');
          } else if (parsed.type === 'order_inserted') {
            onOrderEvent({ type: 'insert', orderId: parsed.orderId });
          } else if (parsed.type === 'order_updated') {
            onOrderEvent({ type: 'update', orderId: parsed.orderId });
          }
        } catch {
          // ignore
        }
      };
      devSource.onerror = () => {
        devSyncConnected = false;
      };
    } catch {
      // ignore if SSE unsupported
    }
  }

  return () => {
    supabase.removeChannel(channel);
    if (devSource) {
      devSource.close();
    }
  };
}

function setupAdminRealtime() {
  if (adminRealtimeSubscribed || typeof window === 'undefined') return;
  adminRealtimeSubscribed = true;
}

// ─── Table Validation API ───

/**
 * validateTable: Checks table existence and active status in Supabase (or offline fallback).
 */
export async function validateTable(
  tableNumber: string
): Promise<{ valid: boolean; tableNumber: string }> {
  if (!tableNumber || !tableNumber.trim()) {
    return { valid: false, tableNumber: '' };
  }

  const padded = padTableNumber(tableNumber.trim());

  try {
    const query = supabase
      .from('tables')
      .select('number, is_active')
      .eq('number', padded)
      .maybeSingle();

    const timeoutMs = isSupabaseConfigured ? 8000 : 1200;
    const timeout = new Promise<{ data: null; error: Error }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error('Timeout') }), timeoutMs)
    );

    const { data, error } = await Promise.race([query, timeout]);

    if (!error && data) {
      return {
        valid: Boolean(data.is_active),
        tableNumber: data.number,
      };
    }
    if (!error && !data && !ALLOW_DEV_FALLBACK) {
      return { valid: false, tableNumber: padded };
    }
    if (error && !ALLOW_DEV_FALLBACK) {
      throw new Error(error.message);
    }
  } catch (err) {
    if (!ALLOW_DEV_FALLBACK) {
      throw err;
    }
    console.warn('Supabase table lookup error, checking dev fallback:', err);
  }

  if (!ALLOW_DEV_FALLBACK) {
    return { valid: false, tableNumber: padded };
  }

  // Fallback for offline / dev mode (tables 01-15 are active)
  const num = parseInt(padded, 10);
  const isValid = !isNaN(num) && num >= 1 && num <= 15;
  return {
    valid: isValid,
    tableNumber: padded,
  };
}

// ─── Menu API ───

/**
 * getMenu: One query with nested categories → items → option_groups → options.
 * Re-validates the persisted cart on load against the fetched menu items.
 */
export async function getMenu(includeDeleted: boolean = false): Promise<MenuItem[]> {
  try {
    const query = supabase
      .from('categories')
      .select(`
        id,
        name,
        sort_order,
        menu_items (
          id,
          category_id,
          name,
          description,
          image_url,
          price_paise,
          is_available,
          sort_order,
          deleted_at,
          option_groups (
            id,
            menu_item_id,
            name,
            type,
            is_required,
            max_select,
            options (
              id,
              option_group_id,
              name,
              price_paise,
              is_available
            )
          )
        )
      `)
      .order('sort_order', { ascending: true });

    const timeoutMs = isSupabaseConfigured ? 8000 : 1200;
    const timeout = new Promise<{ data: null; error: Error }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error('Timeout') }), timeoutMs)
    );

    const [{ data: categories, error }, liveOffers] = await Promise.all([
      Promise.race([query, timeout]),
      getOffers().catch(() => fallbackOffers),
    ]);

    // Helper to attach active offers to menu items
    const attachOffers = (itemList: MenuItem[]) => {
      return itemList.map(it => {
        const activeOffer = liveOffers.find(
          o => o.menuItemId === it.id && getOfferStatus(o) === 'active'
        );
        return {
          ...it,
          offer: activeOffer || null,
        };
      });
    };

    if (error || !categories || categories.length === 0) {
      if (!ALLOW_DEV_FALLBACK) {
        throw new Error(error?.message || 'Failed to load menu');
      }
      if (error) console.warn('Supabase getMenu query warning, using local menu:', error.message);
      const activeFallback = includeDeleted ? fallbackMenu : fallbackMenu.filter(m => !m.deletedAt);
      const withOffers = attachOffers(activeFallback);
      useCartStore.getState().validateCart(withOffers);
      return withOffers;
    }

    const items: MenuItem[] = [];

    for (const cat of categories) {
      const catSlug = cat.name.toLowerCase() as MenuCategory;
      const catItems = ((cat as any).menu_items || []) as any[];

      // Sort items by sort_order
      catItems.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      for (const item of catItems) {
        if (!includeDeleted && item.deleted_at) continue;

        const optionGroups: OptionGroup[] = (item.option_groups || []).map((og: any) => ({
          id: og.id,
          name: og.name,
          type: og.type,
          required: Boolean(og.is_required),
          maxSelections: og.max_select ?? undefined,
          options: (og.options || []).map((opt: any) => ({
            id: opt.id,
            name: opt.name,
            price: opt.price_paise,
          })),
        }));

        items.push({
          id: item.id,
          name: item.name,
          description: item.description || '',
          price: item.price_paise,
          image: item.image_url || '',
          category: catSlug,
          available: Boolean(item.is_available),
          optionGroups,
          deletedAt: item.deleted_at || null,
        });
      }
    }

    const withOffers = attachOffers(items);
    useCartStore.getState().validateCart(withOffers);
    return withOffers;
  } catch (err) {
    if (!ALLOW_DEV_FALLBACK) {
      throw err;
    }
    console.warn('getMenu error, using dev fallback:', err);
    const activeFallback = (includeDeleted ? fallbackMenu : fallbackMenu.filter(m => !m.deletedAt)).map(it => {
      const activeOffer = fallbackOffers.find(
        o => o.menuItemId === it.id && getOfferStatus(o) === 'active'
      );
      return { ...it, offer: activeOffer || null };
    });
    useCartStore.getState().validateCart(activeFallback);
    return activeFallback;
  }
}

/**
 * getAdminMenu: Returns all menu items for Admin (filters out soft-deleted items by default).
 */
export async function getAdminMenu(): Promise<MenuItem[]> {
  try {
    const items = await getMenu();
    return items;
  } catch {
    return fallbackMenu.filter(m => !m.deletedAt);
  }
}

export async function softDeleteMenuItem(itemId: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    const { error } = await supabase
      .from('menu_items')
      .update({ deleted_at: now })
      .eq('id', itemId);
    if (error) console.warn('Supabase softDeleteMenuItem error:', error);
  } catch (err) {
    console.warn('softDeleteMenuItem error:', err);
  }

  const idx = fallbackMenu.findIndex(m => m.id === itemId);
  if (idx !== -1) {
    fallbackMenu[idx].deletedAt = now;
    saveStoredFallbackMenu(fallbackMenu);
  }
}

export async function restoreMenuItem(itemId: string): Promise<MenuItem> {
  try {
    const { data, error } = await supabase
      .from('menu_items')
      .update({ deleted_at: null })
      .eq('id', itemId)
      .select()
      .single();
    if (!error && data) {
      // live updated
    }
  } catch (err) {
    console.warn('restoreMenuItem error:', err);
  }

  const idx = fallbackMenu.findIndex(m => m.id === itemId);
  if (idx === -1) throw new Error('Item not found');
  fallbackMenu[idx].deletedAt = null;
  saveStoredFallbackMenu(fallbackMenu);
  return { ...fallbackMenu[idx] };
}

// ─── Limited-Time Offers API ───

export async function getOffers(): Promise<Offer[]> {
  try {
    const { data, error } = await supabase
      .from('offers')
      .select(`
        id,
        menu_item_id,
        label,
        offer_price_paise,
        starts_at,
        ends_at,
        is_active,
        created_at
      `)
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      return data.map((o: any) => {
        const item = fallbackMenu.find(m => m.id === o.menu_item_id);
        return {
          id: o.id,
          menuItemId: o.menu_item_id,
          label: o.label,
          offerPrice: o.offer_price_paise,
          startsAt: o.starts_at,
          endsAt: o.ends_at,
          isActive: Boolean(o.is_active),
          createdAt: o.created_at,
          menuItemName: item?.name,
          menuItemBasePrice: item?.price,
        };
      });
    }
  } catch {
    // fallback
  }

  return fallbackOffers.map(o => {
    const item = fallbackMenu.find(m => m.id === o.menuItemId);
    return {
      ...o,
      menuItemName: o.menuItemName || item?.name,
      menuItemBasePrice: o.menuItemBasePrice || item?.price,
    };
  });
}

export async function createOffer(
  data: Omit<Offer, 'id' | 'createdAt'>
): Promise<Offer> {
  const item = fallbackMenu.find(m => m.id === data.menuItemId);
  if (!item) throw new Error('Menu item not found');
  if (data.offerPrice >= item.price) {
    throw new Error('Offer price must be strictly less than base price');
  }
  if (new Date(data.endsAt).getTime() <= new Date(data.startsAt).getTime()) {
    throw new Error('End date/time must be after start date/time');
  }

  const now = new Date().toISOString();
  try {
    const { data: inserted, error } = await supabase
      .from('offers')
      .insert({
        menu_item_id: data.menuItemId,
        label: data.label,
        offer_price_paise: data.offerPrice,
        starts_at: data.startsAt,
        ends_at: data.endsAt,
        is_active: data.isActive,
      })
      .select()
      .single();

    if (!error && inserted) {
      const newOffer: Offer = {
        id: inserted.id,
        menuItemId: inserted.menu_item_id,
        label: inserted.label,
        offerPrice: inserted.offer_price_paise,
        startsAt: inserted.starts_at,
        endsAt: inserted.ends_at,
        isActive: Boolean(inserted.is_active),
        createdAt: inserted.created_at,
        menuItemName: item.name,
        menuItemBasePrice: item.price,
      };
      fallbackOffers.unshift(newOffer);
      saveStoredFallbackOffers(fallbackOffers);
      return newOffer;
    }
  } catch {
    // fallback
  }

  const newOffer: Offer = {
    ...data,
    id: `offer-${crypto.randomUUID().slice(0, 8)}`,
    createdAt: now,
    menuItemName: item.name,
    menuItemBasePrice: item.price,
  };
  fallbackOffers.unshift(newOffer);
  saveStoredFallbackOffers(fallbackOffers);
  return newOffer;
}

export async function updateOffer(
  id: string,
  updates: Partial<Offer>
): Promise<Offer> {
  try {
    const payload: Record<string, any> = {};
    if (updates.label !== undefined) payload.label = updates.label;
    if (updates.offerPrice !== undefined) payload.offer_price_paise = updates.offerPrice;
    if (updates.startsAt !== undefined) payload.starts_at = updates.startsAt;
    if (updates.endsAt !== undefined) payload.ends_at = updates.endsAt;
    if (updates.isActive !== undefined) payload.is_active = updates.isActive;

    const { data, error } = await supabase
      .from('offers')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (!error && data) {
      const item = fallbackMenu.find(m => m.id === data.menu_item_id);
      const updated: Offer = {
        id: data.id,
        menuItemId: data.menu_item_id,
        label: data.label,
        offerPrice: data.offer_price_paise,
        startsAt: data.starts_at,
        endsAt: data.ends_at,
        isActive: Boolean(data.is_active),
        createdAt: data.created_at,
        menuItemName: item?.name,
        menuItemBasePrice: item?.price,
      };
      const idx = fallbackOffers.findIndex(o => o.id === id);
      if (idx !== -1) fallbackOffers[idx] = updated;
      saveStoredFallbackOffers(fallbackOffers);
      return updated;
    }
  } catch {
    // fallback
  }

  const idx = fallbackOffers.findIndex(o => o.id === id);
  if (idx === -1) throw new Error('Offer not found');
  fallbackOffers[idx] = { ...fallbackOffers[idx], ...updates };
  saveStoredFallbackOffers(fallbackOffers);
  return { ...fallbackOffers[idx] };
}

export async function endOfferEarly(id: string): Promise<Offer> {
  return updateOffer(id, { isActive: false, endsAt: new Date().toISOString() });
}

export async function deleteOffer(id: string): Promise<void> {
  try {
    await supabase.from('offers').delete().eq('id', id);
  } catch {
    // fallback
  }

  fallbackOffers = fallbackOffers.filter(o => o.id !== id);
  saveStoredFallbackOffers(fallbackOffers);
}

export async function toggleAvailability(itemId: string): Promise<MenuItem> {
  // Try live database update first
  try {
    const { data: item, error: fetchErr } = await supabase
      .from('menu_items')
      .select('is_available')
      .eq('id', itemId)
      .single();

    if (!fetchErr && item) {
      const nextAvailability = !item.is_available;
      const { data: updated, error: updateErr } = await supabase
        .from('menu_items')
        .update({ is_available: nextAvailability })
        .eq('id', itemId)
        .select()
        .single();

      if (!updateErr && updated) {
        return {
          id: updated.id,
          name: updated.name,
          description: updated.description || '',
          price: updated.price_paise,
          image: updated.image_url || '',
          category: 'burgers',
          available: Boolean(updated.is_available),
          optionGroups: [],
        };
      }
    }
  } catch {
    // fallback below
  }

  // Local fallback
  const item = fallbackMenu.find(m => m.id === itemId);
  if (!item) throw new Error('Item not found');
  item.available = !item.available;
  return { ...item };
}

export async function updateMenuItem(
  itemId: string,
  updates: Partial<Pick<MenuItem, 'name' | 'description' | 'price' | 'available' | 'image'>>
): Promise<MenuItem> {
  try {
    const payload: Record<string, any> = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.description !== undefined) payload.description = updates.description;
    if (updates.price !== undefined) payload.price_paise = updates.price;
    if (updates.available !== undefined) payload.is_available = updates.available;
    if (updates.image !== undefined) payload.image_url = updates.image;

    const { data, error } = await supabase
      .from('menu_items')
      .update(payload)
      .eq('id', itemId)
      .select()
      .single();

    if (!error && data) {
      return {
        id: data.id,
        name: data.name,
        description: data.description || '',
        price: data.price_paise,
        image: data.image_url || '',
        category: 'burgers',
        available: Boolean(data.is_available),
        optionGroups: [],
      };
    }
  } catch {
    // fallback
  }

  const idx = fallbackMenu.findIndex(m => m.id === itemId);
  if (idx === -1) throw new Error('Item not found');
  fallbackMenu[idx] = { ...fallbackMenu[idx], ...updates };
  return { ...fallbackMenu[idx] };
}

export async function addMenuItem(item: Omit<MenuItem, 'id'>): Promise<MenuItem> {
  try {
    // Look up category id
    const { data: cat } = await supabase
      .from('categories')
      .select('id')
      .ilike('name', item.category)
      .limit(1)
      .single();

    const categoryId = cat?.id || 'a0000000-0000-0000-0000-000000000001';

    const { data, error } = await supabase
      .from('menu_items')
      .insert({
        category_id: categoryId,
        name: item.name,
        description: item.description,
        price_paise: item.price,
        image_url: item.image,
        is_available: item.available,
      })
      .select()
      .single();

    if (!error && data) {
      return {
        id: data.id,
        name: data.name,
        description: data.description || '',
        price: data.price_paise,
        image: data.image_url || '',
        category: item.category,
        available: Boolean(data.is_available),
        optionGroups: [],
      };
    }
  } catch {
    // fallback
  }

  const newItem: MenuItem = { ...item, id: `item-${crypto.randomUUID().slice(0, 8)}` };
  fallbackMenu.push(newItem);
  return { ...newItem };
}

// ─── Orders API ───

export interface PlaceOrderError extends Error {
  code?: string;
  details?: unknown;
  hint?: string;
  status?: number;
  responseBody?: unknown;
}

function buildPlaceOrderError(
  rawMessage: string,
  extra: Omit<PlaceOrderError, 'name' | 'message'> = {}
): PlaceOrderError {
  const codeMatch = rawMessage.match(/^([A-Z0-9_]+):\s*(.*)$/);
  const code = extra.code || (codeMatch ? codeMatch[1] : undefined);
  const err = new Error(rawMessage) as PlaceOrderError;
  err.name = 'PlaceOrderError';
  if (code) err.code = code;
  if (extra.details !== undefined) err.details = extra.details;
  if (extra.hint !== undefined) err.hint = extra.hint;
  if (extra.status !== undefined) err.status = extra.status;
  if (extra.responseBody !== undefined) err.responseBody = extra.responseBody;
  return err;
}

/**
 * placeOrder: Calls the Supabase Edge Function 'place-order',
 * which verifies Cloudflare Turnstile token, applies rate limiting,
 * and calls the place_order RPC with service_role.
 */
export async function placeOrder(
  payload: PlaceOrderPayload & { turnstileToken?: string }
): Promise<Order> {
  if (isProductionMissingConfig) {
    throw new Error('Order service is not configured. Missing production Supabase environment variables.');
  }

  if (!payload.tableNumber || !payload.tableNumber.trim()) {
    throw new Error('INVALID_TABLE: Table number is missing. Please scan your table QR code.');
  }

  const normalizedPhone = normalizeIndianPhone(payload.customerPhone || '');
  if (!normalizedPhone) {
    throw new Error('INVALID_PHONE: Please enter a valid 10-digit Indian mobile number.');
  }

  const idempotencyKey = useCartStore.getState().getIdempotencyKey();

  try {
    const rpcTimeoutMs = isSupabaseConfigured ? 10000 : 1200;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), rpcTimeoutMs)
    );
    const invokePromise = supabase.functions.invoke('place-order', {
      body: {
        tableNumber: payload.tableNumber,
        customerName: payload.customerName,
        customerPhone: normalizedPhone,
        items: payload.items,
        idempotencyKey,
        turnstileToken: payload.turnstileToken || null,
      },
    });

    const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

    if (error) {
      let rawMessage = error.message || 'Failed to place order';
      let status: number | undefined;
      let responseBody: unknown;
      let code: string | undefined;
      let details: unknown;
      let hint: string | undefined;

      const ctx = (error as {
        context?: {
          status?: number;
          clone?: () => Response;
          text?: () => Promise<string>;
        };
      }).context;
      if (ctx) {
        status = ctx.status;
        try {
          const reader = typeof ctx.clone === 'function' ? ctx.clone() : ctx;
          const text = typeof reader.text === 'function' ? await reader.text() : '';
          if (text) {
            try {
              const parsed = JSON.parse(text);
              responseBody = parsed;
              if (parsed?.error) rawMessage = String(parsed.error);
              if (parsed?.code) code = String(parsed.code);
              if (parsed?.details) details = parsed.details;
              if (parsed?.hint) hint = String(parsed.hint);
            } catch {
              responseBody = text;
            }
          }
        } catch {
          // keep original error message if body cannot be read
        }
      }

      const fullError = buildPlaceOrderError(rawMessage, {
        code,
        details,
        hint,
        status,
        responseBody,
      });
      fullError.name = error.name || 'PlaceOrderError';
      console.error('[placeOrder] Edge Function error:', {
        message: fullError.message,
        code: fullError.code,
        details: fullError.details,
        hint: fullError.hint,
        status: fullError.status,
        responseBody: fullError.responseBody,
        rawError: error,
      });
      throw fullError;
    }

    if (data?.error) {
      const rawMessage = String(data.error);
      const fullError = buildPlaceOrderError(rawMessage, {
        code: data.code,
        details: data.details,
        hint: data.hint,
        responseBody: data,
      });
      console.error('[placeOrder] Response data.error:', {
        message: fullError.message,
        code: fullError.code,
        details: fullError.details,
        hint: fullError.hint,
        responseBody: fullError.responseBody,
      });
      throw fullError;
    }

    if (data && data.order_id && typeof data.order_number === 'number') {
      useCartStore.getState().resetIdempotencyKey();

      return {
        id: data.order_id,
        orderNumber: data.order_number,
        customerName: payload.customerName,
        customerPhone: normalizedPhone,
        tableNumber: payload.tableNumber,
        items: payload.items.map(i => ({
          menuItemId: i.menuItemId,
          name: 'Item',
          quantity: i.quantity,
          options: [],
          lineTotal: 0,
        })),
        total: data.total_paise,
        status: data.status || 'received',
        paymentStatus: 'unpaid',
        paymentHistory: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    throw new Error('Unexpected empty response from order service.');
  } catch (err: unknown) {
    if (!ALLOW_DEV_FALLBACK || !isNetworkOrUnreachableError(err)) {
      if (isNetworkOrUnreachableError(err)) {
        throw new Error('Unable to reach order service. Please check your connection and try again.');
      }
      throw err;
    }
    console.warn('DEV ONLY: Supabase Edge Function place-order unreachable, using dev-sync fallback:', err);
  }

  // DEV-ONLY fallback simulation (never reachable in production builds)
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  let calculatedTotal = 0;
  const orderItems: OrderLineItem[] = [];

  for (const i of payload.items) {
    const menuItem = fallbackMenu.find(m => m.id === i.menuItemId);
    if (!menuItem || menuItem.deletedAt) {
      throw new Error(`Menu item not found or no longer available`);
    }
    if (!menuItem.available) {
      throw new Error(`ITEM_UNAVAILABLE: ${menuItem.name} is sold out`);
    }

    // Server-side offer resolution
    let unitPrice = menuItem.price;
    if (i.offerId) {
      const offer = fallbackOffers.find(o => o.id === i.offerId && o.menuItemId === menuItem.id);
      if (!offer || getOfferStatus(offer) !== 'active') {
        throw new Error(`OFFER_EXPIRED: The offer for ${menuItem.name} has expired`);
      }
      unitPrice = offer.offerPrice;
    } else {
      // Automatic live offer detection
      const activeOffer = fallbackOffers.find(
        o => o.menuItemId === menuItem.id && getOfferStatus(o) === 'active'
      );
      if (activeOffer) {
        unitPrice = activeOffer.offerPrice;
      }
    }

    // Server-side options price calculation
    let optionsPrice = 0;
    const selectedOpts: SelectedOption[] = [];
    if (i.optionIds && i.optionIds.length > 0) {
      for (const optId of i.optionIds) {
        for (const og of menuItem.optionGroups || []) {
          const opt = (og.options || []).find(o => o.id === optId);
          if (opt) {
            optionsPrice += opt.price;
            selectedOpts.push({
              groupId: og.id,
              groupName: og.name,
              optionId: opt.id,
              optionName: opt.name,
              price: opt.price,
            });
          }
        }
      }
    }

    const lineUnit = unitPrice + optionsPrice;
    const lineTotal = lineUnit * i.quantity;
    calculatedTotal += lineTotal;

    orderItems.push({
      menuItemId: i.menuItemId,
      name: menuItem.name,
      quantity: i.quantity,
      options: selectedOpts,
      lineTotal,
    });
  }

  // Fallback counter only if dev-sync endpoint is unavailable (never reset to hardcoded 101)
  fallbackOrders = getStoredFallbackOrders();
  const maxToday = fallbackOrders
    .filter(o => o.createdAt.startsWith(today))
    .reduce((max, o) => Math.max(max, o.orderNumber || 100), 100);

  const draftOrder: Order & { idempotencyKey?: string } = {
    id: crypto.randomUUID(),
    orderNumber: maxToday + 1,
    customerName: payload.customerName,
    customerPhone: normalizedPhone,
    tableNumber: payload.tableNumber,
    items: orderItems,
    total: calculatedTotal,
    status: 'received',
    paymentStatus: 'unpaid',
    paymentHistory: [],
    createdAt: now,
    updatedAt: now,
    idempotencyKey,
  };

  // Dev server assigns concurrency-safe sequential daily order number (101, 102, 103...)
  const serverAssigned = await syncOrderToDevServer(draftOrder);
  const finalOrder: Order = serverAssigned || draftOrder;

  if (!fallbackOrders.some(o => o.id === finalOrder.id)) {
    fallbackOrders.unshift(finalOrder);
  }
  saveStoredFallbackOrders(fallbackOrders);
  useCartStore.getState().resetIdempotencyKey();
  return finalOrder;
}

/**
 * getOrder: Customer order lookup via rpc('get_order_status').
 */
export async function getOrder(orderId: string): Promise<Order | null> {
  if (isProductionMissingConfig) {
    throw new Error('Order service is not configured.');
  }

  try {
    const rpcTimeoutMs = isSupabaseConfigured ? 8000 : 1200;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), rpcTimeoutMs)
    );
    const rpcPromise = supabase.rpc('get_order_status', {
      p_order_id: orderId,
    });

    const { data, error } = await Promise.race([rpcPromise, timeoutPromise]);

    if (error) {
      throw new Error(error.message || 'Failed to fetch order');
    }

    if (data && data.length > 0) {
      const row = data[0];
      const items = (typeof row.items === 'string' ? JSON.parse(row.items) : row.items) || [];

      return {
        id: orderId,
        orderNumber: row.order_number,
        customerName: row.customer_name,
        tableNumber: 'Table',
        status: row.status as OrderStatus,
        total: row.total_paise,
        items: items.map((i: any) => ({
          menuItemId: i.id || '',
          name: i.name,
          quantity: i.quantity,
          lineTotal: (i.unit_price_paise || 0) * i.quantity,
          options: (i.options || []).map((o: any) => ({
            groupId: '',
            groupName: '',
            optionId: '',
            optionName: o.name,
            price: o.price_paise,
          })),
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    if (!ALLOW_DEV_FALLBACK) return null;
  } catch (err) {
    if (!ALLOW_DEV_FALLBACK || !isNetworkOrUnreachableError(err)) {
      throw err;
    }
    console.warn('getOrder RPC error, checking dev fallback:', err);
  }

  if (!ALLOW_DEV_FALLBACK) return null;

  const serverOrders = await fetchOrdersFromDevServer();
  if (serverOrders) {
    const found = serverOrders.find(o => o.id === orderId);
    if (found) return { ...found };
  }

  fallbackOrders = getStoredFallbackOrders();
  const order = fallbackOrders.find(o => o.id === orderId);
  return order ? { ...order } : null;
}

function mapSupabaseOrderRow(o: any): Order {
  return {
    id: o.id,
    orderNumber: o.order_number,
    customerName: o.customer_name,
    customerPhone: o.customer_phone || undefined,
    tableNumber: o.tables?.number || '',
    status: o.status as OrderStatus,
    paymentStatus: (o.payment_status as PaymentStatus) || 'unpaid',
    paidAt: o.paid_at || undefined,
    paymentMethod: (o.payment_method as PaymentMethod) || undefined,
    paymentHistory: Array.isArray(o.payment_history)
      ? o.payment_history.map((h: any) => ({
          action: h.action,
          method: h.method,
          previousMethod: h.previous_method,
          timestamp: h.timestamp,
        }))
      : [],
    rejectionReason: o.reject_reason || undefined,
    total: o.total_paise,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    items: (o.order_items || []).map((oi: any) => ({
      menuItemId: oi.menu_item_id || '',
      name: oi.name_snapshot,
      quantity: oi.quantity,
      lineTotal: oi.unit_price_paise * oi.quantity,
      options: (oi.order_item_options || []).map((opt: any) => ({
        groupId: '',
        groupName: '',
        optionId: opt.id,
        optionName: opt.name_snapshot,
        price: opt.price_paise,
      })),
    })),
  };
}

const ADMIN_ORDER_SELECT = `
  id,
  order_number,
  order_date,
  customer_name,
  customer_phone,
  status,
  payment_status,
  paid_at,
  payment_method,
  payment_history,
  reject_reason,
  total_paise,
  created_at,
  updated_at,
  tables ( number ),
  order_items (
    id,
    menu_item_id,
    name_snapshot,
    unit_price_paise,
    quantity,
    notes,
    order_item_options (
      id,
      name_snapshot,
      price_paise
    )
  )
`;

/**
 * getOrderWithItems: Fetch a single full order with all line items & options (used on realtime events).
 */
export async function getOrderWithItems(orderId: string): Promise<Order | null> {
  try {
    const timeoutMs = isSupabaseConfigured ? 8000 : 1500;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    );
    const fetchPromise = supabase
      .from('orders')
      .select(ADMIN_ORDER_SELECT)
      .eq('id', orderId)
      .maybeSingle();

    const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
    if (error) {
      throw new Error(error.message || 'Failed to fetch order');
    }
    if (data) {
      return mapSupabaseOrderRow(data);
    }
    if (!ALLOW_DEV_FALLBACK) return null;
  } catch (err) {
    if (!ALLOW_DEV_FALLBACK || !isNetworkOrUnreachableError(err)) {
      throw err;
    }
  }

  if (!ALLOW_DEV_FALLBACK) return null;

  const serverOrders = await fetchOrdersFromDevServer();
  if (serverOrders) {
    const found = serverOrders.find(o => o.id === orderId);
    if (found) return { ...found };
  }

  fallbackOrders = getStoredFallbackOrders();
  const found = fallbackOrders.find(o => o.id === orderId);
  return found ? { ...found } : null;
}

/**
 * getOrders: Admin query for today's live orders with items and options.
 */
export async function getOrders(): Promise<Order[]> {
  if (isProductionMissingConfig) {
    throw new Error('Order service is not configured. Missing production Supabase environment variables.');
  }
  setupAdminRealtime();

  try {
    const today = new Date().toISOString().split('T')[0];
    const timeoutMs = isSupabaseConfigured ? 8000 : 1200;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    );
    const fetchPromise = supabase
      .from('orders')
      .select(ADMIN_ORDER_SELECT)
      .eq('order_date', today)
      .order('created_at', { ascending: false });

    const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);

    if (error) {
      throw new Error(error.message || 'Failed to load orders');
    }
    if (data) {
      return data.map(mapSupabaseOrderRow);
    }
  } catch (err) {
    if (!ALLOW_DEV_FALLBACK || !isNetworkOrUnreachableError(err)) {
      throw err;
    }
    console.warn('getOrders query error, using dev fallback:', err);
  }

  if (!ALLOW_DEV_FALLBACK) return [];

  const serverOrders = await fetchOrdersFromDevServer();
  if (serverOrders && serverOrders.length > 0) {
    fallbackOrders = serverOrders;
    saveStoredFallbackOrders(serverOrders);
    return serverOrders.map(o => ({ ...o }));
  }

  fallbackOrders = getStoredFallbackOrders();
  return fallbackOrders.map(o => ({ ...o }));
}

/**
 * updateOrderStatus: Admin RPC call to transition status.
 */
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  rejectionReason?: string
): Promise<Order> {
  try {
    const { error } = await supabase.rpc('update_order_status', {
      p_order_id: orderId,
      p_status: status,
      p_reason: rejectionReason || null,
    });

    if (error) {
      let message = error.message || 'Failed to update order status';
      message = message.replace(/^[A-Z0-9_]+:\s*/, '');
      throw new Error(message);
    }
  } catch (err: unknown) {
    if (!ALLOW_DEV_FALLBACK || !isNetworkOrUnreachableError(err)) {
      throw err;
    }
    console.warn('updateOrderStatus RPC warning:', err);
  }

  const serverOrders = await fetchOrdersFromDevServer();
  if (serverOrders && serverOrders.length > 0) {
    fallbackOrders = serverOrders;
  } else {
    fallbackOrders = getStoredFallbackOrders();
  }

  const order = fallbackOrders.find(o => o.id === orderId);
  if (order) {
    order.status = status;
    order.updatedAt = new Date().toISOString();
    if (rejectionReason) order.rejectionReason = rejectionReason;
    saveStoredFallbackOrders(fallbackOrders);
    await syncOrderToDevServer(order);
    return { ...order };
  }

  throw new Error('Order not found');
}

/**
 * markOrderPaid: Admin-only confirmation that customer paid via Cash / UPI / Card.
 */
export async function markOrderPaid(
  orderId: string,
  method: PaymentMethod
): Promise<Order> {
  try {
    const { error } = await supabase.rpc('mark_order_paid', {
      p_order_id: orderId,
      p_method: method,
    });

    if (error) {
      throw new Error(error.message || 'Failed to mark order paid');
    }

    const updated = await getOrderWithItems(orderId);
    if (updated) return updated;
  } catch (err: unknown) {
    if (!ALLOW_DEV_FALLBACK || !isNetworkOrUnreachableError(err)) {
      throw err;
    }
  }

  if (!ALLOW_DEV_FALLBACK) {
    throw new Error('Unable to mark order paid in production without database connection.');
  }

  const serverOrders = await fetchOrdersFromDevServer();
  if (serverOrders && serverOrders.length > 0) {
    fallbackOrders = serverOrders;
  } else {
    fallbackOrders = getStoredFallbackOrders();
  }

  const idx = fallbackOrders.findIndex(o => o.id === orderId);
  if (idx === -1) throw new Error('Order not found');

  const now = new Date().toISOString();
  const prevHistory: PaymentHistoryEntry[] = fallbackOrders[idx].paymentHistory || [];
  fallbackOrders[idx] = {
    ...fallbackOrders[idx],
    paymentStatus: 'paid',
    paidAt: now,
    paymentMethod: method,
    paymentHistory: [
      ...prevHistory,
      { action: 'paid', method, timestamp: now },
    ],
    updatedAt: now,
  };
  saveStoredFallbackOrders(fallbackOrders);
  await syncOrderToDevServer(fallbackOrders[idx]);
  return { ...fallbackOrders[idx] };
}

/**
 * undoOrderPaid: Admin-only undo for mis-taps, logged in order paymentHistory.
 */
export async function undoOrderPaid(orderId: string): Promise<Order> {
  try {
    const { error } = await supabase.rpc('undo_order_paid', {
      p_order_id: orderId,
    });

    if (error) {
      throw new Error(error.message || 'Failed to undo payment');
    }

    const updated = await getOrderWithItems(orderId);
    if (updated) return updated;
  } catch (err: unknown) {
    if (!ALLOW_DEV_FALLBACK || !isNetworkOrUnreachableError(err)) {
      throw err;
    }
  }

  if (!ALLOW_DEV_FALLBACK) {
    throw new Error('Unable to undo payment in production without database connection.');
  }

  const serverOrders = await fetchOrdersFromDevServer();
  if (serverOrders && serverOrders.length > 0) {
    fallbackOrders = serverOrders;
  } else {
    fallbackOrders = getStoredFallbackOrders();
  }

  const idx = fallbackOrders.findIndex(o => o.id === orderId);
  if (idx === -1) throw new Error('Order not found');

  const now = new Date().toISOString();
  const prevMethod = fallbackOrders[idx].paymentMethod;
  const prevHistory: PaymentHistoryEntry[] = fallbackOrders[idx].paymentHistory || [];

  fallbackOrders[idx] = {
    ...fallbackOrders[idx],
    paymentStatus: 'unpaid',
    paidAt: undefined,
    paymentMethod: undefined,
    paymentHistory: [
      ...prevHistory,
      { action: 'undo_paid', previousMethod: prevMethod, timestamp: now },
    ],
    updatedAt: now,
  };
  saveStoredFallbackOrders(fallbackOrders);
  await syncOrderToDevServer(fallbackOrders[idx]);
  return { ...fallbackOrders[idx] };
}

/**
 * getDayStats: Backed by confirmed payments in Asia/Kolkata via get_day_stats RPC.
 */
export async function getDayStats(): Promise<DayStats> {
  try {
    const { data, error } = await supabase.rpc('get_day_stats');
    if (error) {
      throw new Error(error.message || 'Failed to load day stats');
    }
    if (data) {
      return data as DayStats;
    }
  } catch (err: unknown) {
    if (!ALLOW_DEV_FALLBACK || !isNetworkOrUnreachableError(err)) {
      throw err;
    }
  }

  const orders = await getOrders();
  const paidOrders = orders.filter(o => o.paymentStatus === 'paid');
  const unpaidCompleted = orders.filter(
    o => o.status === 'completed' && o.paymentStatus !== 'paid'
  );
  const completed = orders.filter(o => o.status === 'completed');

  const cash = paidOrders.filter(o => o.paymentMethod === 'cash');
  const upi = paidOrders.filter(o => o.paymentMethod === 'upi');
  const card = paidOrders.filter(o => o.paymentMethod === 'card');

  return {
    totalOrders: paidOrders.length,
    revenue: paidOrders.reduce((s, o) => s + o.total, 0),
    cashRevenue: cash.reduce((s, o) => s + o.total, 0),
    cashOrders: cash.length,
    upiRevenue: upi.reduce((s, o) => s + o.total, 0),
    upiOrders: upi.length,
    cardRevenue: card.reduce((s, o) => s + o.total, 0),
    cardOrders: card.length,
    unpaidOrders: unpaidCompleted.length,
    unpaidAmount: unpaidCompleted.reduce((s, o) => s + o.total, 0),
    avgPrepTime: completed.length > 0
      ? Math.round(
          completed.reduce((s, o) => {
            const mins = (new Date(o.updatedAt).getTime() - new Date(o.createdAt).getTime()) / 60_000;
            return s + mins;
          }, 0) / completed.length
        )
      : 14,
  };
}

/**
 * getInsights: Admin-only aggregates from confirmed payments in Asia/Kolkata.
 */
export async function getInsights(range: InsightsRange): Promise<InsightsData> {
  const { data, error } = await supabase.rpc('get_insights', { p_range: range });
  if (error) {
    throw new Error(error.message || 'Failed to load insights');
  }
  return data as InsightsData;
}

/**
 * subscribeToOrderStatus: Realtime subscription for customer confirmation screen.
 */
export function subscribeToOrderStatus(
  orderId: string,
  onStatusChange: (status: OrderStatus) => void
): () => void {
  const channel = supabase
    .channel(`order_status_${orderId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `id=eq.${orderId}`,
      },
      (payload) => {
        if (payload.new && (payload.new as any).status) {
          onStatusChange((payload.new as any).status as OrderStatus);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn('Realtime subscription failed, polling fallback active.');
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}
