export type Platform = '' | 'TikTok' | 'Instagram' | 'WhatsApp';

export type DeliveryArea = '' | 'Inside Valley' | 'Outside Valley' | 'Other';

export type PaymentType =
  | ''
  | 'FULL_PAID'
  | 'HALF_WITH_DELIVERY'
  | 'HALF_WITHOUT_DELIVERY'
  | 'FULL_COD'
  | 'DELIVERY_ONLY';

export type OrderStatus =
  | 'NEW'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'READY'
  | 'SHIPPED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'RETURNED';

export interface InventoryItem {
  id: string;
  pieceName: string;
  color: string;
  size: string;
  quantity: number;
  lowStockThreshold: number;
  unitPrice: string;
  photoUrl: string;
  photoPath: string;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUid: string;
  teamEmails: string[];
}

export interface InventoryFormValues {
  pieceName: string;
  color: string;
  size: string;
  quantity: string;
  lowStockThreshold: string;
  unitPrice: string;
  notes: string;
}

export interface OrderLineItem {
  inventoryItemId: string;
  productName: string;
  color: string;
  size: string;
  quantity: number;
  unitPrice: string;
  stockDeducted: boolean;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  platform: Platform;
  socialContact: string;
  productName: string;
  photos: string[];
  photoPaths: string[];
  size: string;
  color: string;
  notes: string;
  productAmount: string | number;
  deliveryCharge: string | number;
  deliveryArea: DeliveryArea;
  paymentType: PaymentType;
  totalAmount: string | number;
  paidAmount: string | number;
  remainingAmount: string | number;
  status: OrderStatus;
  inventoryItemId: string;
  orderQuantity: number;
  stockDeducted: boolean;
  items: OrderLineItem[];
  createdAt: Date;
  updatedAt: Date;
  createdByUid: string;
  teamEmails: string[];
}

export interface OrderFormValues {
  customerName: string;
  phone: string;
  socialContact: string;
  notes: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  status: OrderStatus;
  items: OrderLineItem[];
}

export interface PaymentCalculation {
  productAmount: number;
  deliveryCharge: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
}

export interface StoreSettings {
  brandName: string;
  currency: string;
  insideValleyRate: number;
  outsideValleyRate: number;
  otherRate: number;
  partnerEmails: string[];
  updatedAt: Date | null;
  updatedByUid: string;
}

export type DateRangePreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'custom';

export interface OrderFilters {
  search: string;
  status: OrderStatus | 'ALL';
  paymentType: PaymentType | 'ALL';
  datePreset: DateRangePreset;
  customStart: string;
  customEnd: string;
  size: string;
  color: string;
}

export type AppView =
  | 'dashboard'
  | 'orders'
  | 'inventory'
  | 'new-order'
  | 'reports'
  | 'settings';
