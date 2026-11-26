// ─── Gelafehaus Type Definitions ───
// Money is stored as integers (paise). Display with formatPrice().

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number; // paise
  image: string;
  category: MenuCategory;
  available: boolean;
  optionGroups: OptionGroup[];
  deletedAt?: string | null;
  offer?: Offer | null;
}

export interface Offer {
  id: string;
  menuItemId: string;
  label: string; // e.g. "Weekend Deal"
  offerPrice: number; // paise
  startsAt: string; // ISO
  endsAt: string; // ISO
  isActive: boolean;
  createdAt?: string;
  menuItemName?: string;
  menuItemBasePrice?: number;
}

export type OfferStatus = 'active' | 'scheduled' | 'expired';

export function getOfferStatus(offer: Offer): OfferStatus {
  if (!offer.isActive) return 'expired';
  const now = Date.now();
  const starts = new Date(offer.startsAt).getTime();
  const ends = new Date(offer.endsAt).getTime();
  if (now < starts) return 'scheduled';
  if (now >= ends) return 'expired';
  return 'active';
}

export type MenuCategory = 'burgers' | 'sides' | 'shakes' | 'drinks';

export const CATEGORY_LABELS: Record<MenuCategory, string> = {
  burgers: 'Burgers',
  sides: 'Sides',
  shakes: 'Shakes',
  drinks: 'Drinks',
};

export const CATEGORIES: MenuCategory[] = ['burgers', 'sides', 'shakes', 'drinks'];

export interface OptionGroup {
  id: string;
  name: string;
  type: 'single' | 'multi';
  required: boolean;
  maxSelections?: number; // for multi
  options: Option[];
}

export interface Option {
  id: string;
  name: string;
  price: number; // paise, 0 if free
}

// ─── Cart ───

export interface CartItem {
  cartItemId: string;
  menuItemId: string;
  name: string;
  image: string;
  basePrice: number;
  originalPrice?: number;
  offerId?: string;
  quantity: number;
  selectedOptions: SelectedOption[];
  notes: string;
}

export interface SelectedOption {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  price: number;
}

// ─── Orders ───

export type OrderStatus = 'received' | 'preparing' | 'ready' | 'completed' | 'rejected';

export type PaymentStatus = 'unpaid' | 'paid';
export type PaymentMethod = 'cash' | 'upi' | 'card';

export interface PaymentHistoryEntry {
  action: 'paid' | 'undo_paid';
  method?: PaymentMethod;
  previousMethod?: PaymentMethod;
  timestamp: string;
}

export interface Order {
  id: string;
  orderNumber: number;
  customerName: string;
  customerPhone?: string;
  tableNumber: string;
  items: OrderLineItem[];
  total: number; // paise
  status: OrderStatus;
  paymentStatus?: PaymentStatus;
  paidAt?: string;
  paymentMethod?: PaymentMethod;
  paymentHistory?: PaymentHistoryEntry[];
  rejectionReason?: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface OrderLineItem {
  menuItemId: string;
  name: string;
  quantity: number;
  options: SelectedOption[];
  lineTotal: number; // paise
}

// ─── API payloads ───

export interface PlaceOrderPayload {
  customerName: string;
  customerPhone: string;
  tableNumber: string;
  items: {
    menuItemId: string;
    quantity: number;
    optionIds: string[];
    notes: string;
    offerId?: string;
  }[];
}

// ─── Admin ───

export interface DayStats {
  totalOrders: number;
  revenue: number; // paise
  cashRevenue: number;
  cashOrders: number;
  upiRevenue: number;
  upiOrders: number;
  cardRevenue: number;
  cardOrders: number;
  avgPrepTime: number; // minutes
  unpaidOrders?: number;
  unpaidAmount?: number;
}

export type InsightsRange = 'day' | 'week' | 'month';

export interface InsightsSeriesPoint {
  label: string;
  shortLabel?: string;
  subLabel?: string;
  cashRevenue: number;
  upiRevenue: number;
  cardRevenue: number;
  totalRevenue: number;
  cashOrders: number;
  upiOrders: number;
  cardOrders: number;
  totalOrders: number;
}

export interface InsightsTopItem {
  name: string;
  quantity: number;
  revenue: number;
}

export interface InsightsMethodSplit {
  method: PaymentMethod;
  revenue: number;
  orders: number;
}

export interface InsightsData {
  range: InsightsRange;
  kpis: {
    revenue: number;
    prevRevenue: number;
    orders: number;
    prevOrders: number;
    uniqueCustomers: number;
    prevUniqueCustomers: number;
    avgOrderValue: number;
    prevAvgOrderValue: number;
  };
  methods: {
    cash: { revenue: number; orders: number };
    upi: { revenue: number; orders: number };
    card: { revenue: number; orders: number };
  };
  series: InsightsSeriesPoint[];
  topItems: InsightsTopItem[];
  methodSplit: InsightsMethodSplit[];
  customerSplit: {
    newCustomers: number;
    returningCustomers: number;
  };
}
