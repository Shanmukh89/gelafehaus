// ─── Supabase API Layer for Gelafehaus ───
// Implements real Supabase database, RPC, and Realtime calls.
// Preserves every function signature and return type so UI components remain unchanged.

import { supabase } from './supabase';
import type {
  MenuItem,
  Order,
  OrderLineItem,
  SelectedOption,
  OrderStatus,
  PlaceOrderPayload,
  DayStats,
  MenuCategory,
  OptionGroup,
  Offer,
} from './types';
import { getOfferStatus } from './types';
import { menuItems as seedMenu } from './menu-data';
import { useCartStore } from './cart-store';
import { soundAlert } from './sound';
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
// to share orders in real time even when running without Docker/Supabase.
function syncOrderToDevServer(order: Order) {
  if (typeof window === 'undefined') return;
  fetch('/_dev_sync/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  }).catch(() => {});
}

async function fetchOrdersFromDevServer(): Promise<Order[] | null> {
  if (typeof window === 'undefined') return null;
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

let fallbackMenu: MenuItem[] = getStoredFallbackMenu();
let fallbackOrders: Order[] = getStoredFallbackOrders();
let fallbackOffers: import('./types').Offer[] = getStoredFallbackOffers();
let nextFallbackOrderNumber = 101;

// ─── Global Realtime Subscription for Admin ───
let adminRealtimeSubscribed = false;

function setupAdminRealtime() {
  if (adminRealtimeSubscribed || typeof window === 'undefined') return;
  adminRealtimeSubscribed = true;

  try {
    supabase
      .channel('admin_live_orders')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          soundAlert.playChime();
          window.dispatchEvent(
            new CustomEvent('gelafehaus:new_order', { detail: payload.new })
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          window.dispatchEvent(
            new CustomEvent('gelafehaus:order_updated', { detail: payload.new })
          );
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('Realtime subscription error. Polling fallback active.');
        }
      });
  } catch (err) {
    console.warn('Failed to initialize admin realtime channel:', err);
  }
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

    const timeout = new Promise<{ data: null; error: Error }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error('Timeout') }), 1200)
    );

    const { data, error } = await Promise.race([query, timeout]);

    if (!error && data) {
      return {
        valid: Boolean(data.is_active),
        tableNumber: data.number,
      };
    }
  } catch (err) {
    console.warn('Supabase table lookup error, checking fallback:', err);
  }

  // Fallback for offline / local mode (tables 01-15 are active)
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

    const timeout = new Promise<{ data: null; error: Error }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error('Timeout') }), 1200)
    );

    const { data: categories, error } = await Promise.race([query, timeout]);

    // Helper to attach active offers to menu items
    const attachOffers = (itemList: MenuItem[]) => {
      return itemList.map(it => {
        const activeOffer = fallbackOffers.find(
          o => o.menuItemId === it.id && getOfferStatus(o) === 'active'
        );
        return {
          ...it,
          offer: activeOffer || null,
        };
      });
    };

    if (error || !categories || categories.length === 0) {
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
    console.warn('getMenu error, using fallback:', err);
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

/**
 * placeOrder: Calls the Supabase Edge Function 'place-order',
 * which verifies Cloudflare Turnstile token, applies rate limiting,
 * and calls the place_order RPC with service_role.
 */
export async function placeOrder(
  payload: PlaceOrderPayload & { turnstileToken?: string }
): Promise<Order> {
  const idempotencyKey = useCartStore.getState().getIdempotencyKey();

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 1200)
    );
    const invokePromise = supabase.functions.invoke('place-order', {
      body: {
        tableNumber: payload.tableNumber,
        customerName: payload.customerName,
        items: payload.items,
        idempotencyKey,
        turnstileToken: payload.turnstileToken || null,
      },
    });

    const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

    if (error) {
      let message = error.message || 'Failed to place order';
      if (message.includes(': ')) {
        message = message.substring(message.indexOf(': ') + 2);
      }
      throw new Error(message);
    }

    if (data?.error) {
      let message = data.error;
      if (message.includes(': ')) {
        message = message.substring(message.indexOf(': ') + 2);
      }
      throw new Error(message);
    }

    if (data && data.order_id) {
      // Order placed successfully: reset the idempotency key!
      useCartStore.getState().resetIdempotencyKey();

      return {
        id: data.order_id,
        orderNumber: data.order_number,
        customerName: payload.customerName,
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.length > 0 &&
      !err.message.includes('fetch') &&
      !err.message.includes('Failed to send a request') &&
      !err.message.includes('timeout')
    ) {
      throw err;
    }
    console.warn('Supabase Edge Function place-order unreachable, using fallback simulation:', err);
  }

  // Fallback simulation (server-side validation of availability, soft-deletes, options, and live offers)
  const now = new Date().toISOString();
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

  const order: Order = {
    id: crypto.randomUUID(),
    orderNumber: nextFallbackOrderNumber++,
    customerName: payload.customerName,
    tableNumber: payload.tableNumber,
    items: orderItems,
    total: calculatedTotal,
    status: 'received',
    createdAt: now,
    updatedAt: now,
  };
  fallbackOrders.unshift(order);
  saveStoredFallbackOrders(fallbackOrders);
  syncOrderToDevServer(order);
  useCartStore.getState().resetIdempotencyKey();
  return order;
}

/**
 * getOrder: Customer order lookup via rpc('get_order_status').
 */
export async function getOrder(orderId: string): Promise<Order | null> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 1200)
    );
    const rpcPromise = supabase.rpc('get_order_status', {
      p_order_id: orderId,
    });

    const { data, error } = await Promise.race([rpcPromise, timeoutPromise]);

    if (!error && data && data.length > 0) {
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
  } catch (err) {
    console.warn('getOrder RPC error, checking fallback:', err);
  }

  const serverOrders = await fetchOrdersFromDevServer();
  if (serverOrders) {
    const found = serverOrders.find(o => o.id === orderId);
    if (found) return { ...found };
  }

  fallbackOrders = getStoredFallbackOrders();
  const order = fallbackOrders.find(o => o.id === orderId);
  return order ? { ...order } : null;
}

/**
 * getOrders: Admin query for today's live orders with items and options.
 */
export async function getOrders(): Promise<Order[]> {
  setupAdminRealtime();

  try {
    const today = new Date().toISOString().split('T')[0];
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 1200)
    );
    const fetchPromise = supabase
      .from('orders')
      .select(`
        id,
        order_number,
        order_date,
        customer_name,
        status,
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
      `)
      .eq('order_date', today)
      .order('created_at', { ascending: false });

    const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);

    if (!error && data) {
      return data.map((o: any) => ({
        id: o.id,
        orderNumber: o.order_number,
        customerName: o.customer_name,
        tableNumber: o.tables?.number || '',
        status: o.status as OrderStatus,
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
      }));
    }
  } catch (err) {
    console.warn('getOrders query error, using fallback:', err);
  }

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
      if (message.includes(': ')) {
        message = message.substring(message.indexOf(': ') + 2);
      }
      throw new Error(message);
    }
  } catch (err: unknown) {
    if (err instanceof Error && !err.message.includes('fetch')) {
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
    syncOrderToDevServer(order);
    return { ...order };
  }

  return {
    id: orderId,
    orderNumber: 101,
    customerName: 'Customer',
    tableNumber: '',
    status,
    total: 24900,
    items: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * getDayStats: Computed from today's orders.
 */
export async function getDayStats(): Promise<DayStats> {
  const orders = await getOrders();
  const completed = orders.filter(o => o.status === 'completed');

  return {
    totalOrders: orders.length,
    revenue: orders.reduce((s, o) => s + o.total, 0),
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
