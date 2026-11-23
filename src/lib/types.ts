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

export interface Order {
  id: string;
  orderNumber: number;
  customerName: string;
  tableNumber: string;
  items: OrderLineItem[];
  total: number; // paise
  status: OrderStatus;
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
  tableNumber: string;
  items: {
    menuItemId: string;
    quantity: number;
    optionIds: string[];
    notes: string;
  }[];
}

// ─── Admin ───

export interface DayStats {
  totalOrders: number;
  revenue: number; // paise
  avgPrepTime: number; // minutes
}
