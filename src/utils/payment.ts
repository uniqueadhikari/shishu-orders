import type {
  DeliveryArea,
  OrderStatus,
  PaymentCalculation,
  PaymentType,
  Platform,
  StoreSettings,
} from '../types/order';

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Extracts a numeric value from either a number or a free-text amount string
 * (e.g. "2500", "Rs. 2,500", "1500 cash") for KPI sums and charts.
 */
export function parseAmountNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return 0;
  const num = Number(match[0]);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

/**
 * Formats either numeric amounts or free-text amounts cleanly for display.
 * - Blank / null / undefined -> "—"
 * - Pure numeric text (e.g. "2500") or number -> "Rs. 2,500"
 * - Custom text (e.g. "1500 cash", "Paid") -> returned verbatim
 */
export function formatAmountDisplay(
  value: string | number | null | undefined,
  currency = 'Rs.'
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? formatCurrency(value, currency) : '—';
  }
  const trimmed = value.trim();
  if (!trimmed) return '—';
  if (/^\d[\d,]*(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed.replace(/,/g, ''));
    if (Number.isFinite(num)) {
      return formatCurrency(num, currency);
    }
  }
  return trimmed;
}

export function hasAmountValue(value: string | number | null | undefined): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return false;
}

/**
 * Legacy Shishu.clo payment calculation rules (retained for backwards compatibility).
 */
export function calculateOrderPayment(
  rawProductAmount: number,
  rawDeliveryCharge: number,
  paymentType: Exclude<PaymentType, ''>
): PaymentCalculation {
  if (!Number.isFinite(rawProductAmount) || rawProductAmount < 0) {
    throw new Error('Please enter a valid product amount.');
  }
  if (!Number.isFinite(rawDeliveryCharge) || rawDeliveryCharge < 0) {
    throw new Error('Please select a valid delivery option.');
  }

  const productAmount = roundMoney(rawProductAmount);
  const deliveryCharge = roundMoney(rawDeliveryCharge);
  const totalAmount = roundMoney(productAmount + deliveryCharge);

  let paidAmount = 0;
  let remainingAmount = 0;

  switch (paymentType) {
    case 'FULL_PAID':
      paidAmount = totalAmount;
      remainingAmount = 0;
      break;
    case 'HALF_WITH_DELIVERY':
      paidAmount = roundMoney(productAmount / 2 + deliveryCharge);
      remainingAmount = roundMoney(totalAmount - paidAmount);
      break;
    case 'HALF_WITHOUT_DELIVERY':
      paidAmount = roundMoney(productAmount / 2);
      remainingAmount = roundMoney(totalAmount - paidAmount);
      break;
    case 'FULL_COD':
      paidAmount = 0;
      remainingAmount = totalAmount;
      break;
    case 'DELIVERY_ONLY':
      paidAmount = deliveryCharge;
      remainingAmount = productAmount;
      break;
    default:
      throw new Error('Please select a valid payment type.');
  }

  if (
    paidAmount < 0 ||
    remainingAmount < 0 ||
    Math.abs(paidAmount + remainingAmount - totalAmount) > 0.02
  ) {
    throw new Error('Payment calculation check failed. Please verify amounts.');
  }

  return {
    productAmount,
    deliveryCharge,
    totalAmount,
    paidAmount,
    remainingAmount,
  };
}

export function formatCurrency(amount: number, currency = 'Rs.'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const hasFraction = Math.abs(safe - Math.round(safe)) > 0.001;
  const formatted = safe.toLocaleString('en-IN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}

export const PLATFORMS: Exclude<Platform, ''>[] = ['Instagram', 'TikTok', 'WhatsApp'];

export const PAYMENT_TYPE_OPTIONS: {
  value: Exclude<PaymentType, ''>;
  label: string;
  shortLabel: string;
  description: string;
}[] = [
  {
    value: 'FULL_PAID',
    label: 'Full paid',
    shortLabel: 'Full Paid',
    description: '100% of product + delivery paid upfront',
  },
  {
    value: 'HALF_WITH_DELIVERY',
    label: 'Half + delivery charge',
    shortLabel: 'Half + Delivery',
    description: '50% product + full delivery paid now',
  },
  {
    value: 'HALF_WITHOUT_DELIVERY',
    label: 'Half without delivery charge',
    shortLabel: 'Half Only',
    description: '50% product paid now; delivery + rest on COD',
  },
  {
    value: 'FULL_COD',
    label: 'Full COD',
    shortLabel: 'Full COD',
    description: 'Cash on delivery for full total',
  },
  {
    value: 'DELIVERY_ONLY',
    label: 'Delivery charge only paid',
    shortLabel: 'Delivery Paid',
    description: 'Delivery paid upfront; product price on COD',
  },
];

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  '': 'Manual entry',
  FULL_PAID: 'Full paid',
  HALF_WITH_DELIVERY: 'Half + delivery charge',
  HALF_WITHOUT_DELIVERY: 'Half without delivery charge',
  FULL_COD: 'Full COD',
  DELIVERY_ONLY: 'Delivery charge only paid',
};

export const ORDER_STATUSES: OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'PROCESSING',
  'READY',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
  'RETURNED',
];

export const ORDER_STATUS_META: Record<
  OrderStatus,
  {
    label: string;
    badgeClass: string;
    dotClass: string;
    barColor: string;
  }
> = {
  NEW: {
    label: 'NEW',
    badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    dotClass: 'bg-indigo-600',
    barColor: '#4F46E5',
  },
  CONFIRMED: {
    label: 'CONFIRMED',
    badgeClass: 'bg-sky-50 text-sky-800 border-sky-200',
    dotClass: 'bg-sky-600',
    barColor: '#0284C7',
  },
  PROCESSING: {
    label: 'PROCESSING',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    dotClass: 'bg-amber-600',
    barColor: '#D97706',
  },
  READY: {
    label: 'READY',
    badgeClass: 'bg-purple-50 text-purple-800 border-purple-200',
    dotClass: 'bg-purple-600',
    barColor: '#7C3AED',
  },
  SHIPPED: {
    label: 'SHIPPED',
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-200',
    dotClass: 'bg-teal-600',
    barColor: '#0D9488',
  },
  COMPLETED: {
    label: 'COMPLETED',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dotClass: 'bg-emerald-600',
    barColor: '#059669',
  },
  CANCELLED: {
    label: 'CANCELLED',
    badgeClass: 'bg-stone-100 text-stone-700 border-stone-300',
    dotClass: 'bg-stone-500',
    barColor: '#78716C',
  },
  RETURNED: {
    label: 'RETURNED',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-200',
    dotClass: 'bg-rose-600',
    barColor: '#E11D48',
  },
};

export function getDeliveryOptionsFromSettings(settings: StoreSettings): {
  area: Exclude<DeliveryArea, ''>;
  charge: number;
  label: string;
}[] {
  return [
    {
      area: 'Inside Valley',
      charge: settings.insideValleyRate,
      label: `${settings.currency} ${settings.insideValleyRate} — Inside Valley`,
    },
    {
      area: 'Outside Valley',
      charge: settings.outsideValleyRate,
      label: `${settings.currency} ${settings.outsideValleyRate} — Outside Valley`,
    },
    {
      area: 'Other',
      charge: settings.otherRate,
      label: `${settings.currency} ${settings.otherRate} — Other`,
    },
  ];
}

export const QUICK_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free Size'];

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  brandName: 'Shishu.clo',
  currency: 'Rs.',
  insideValleyRate: 120,
  outsideValleyRate: 150,
  otherRate: 200,
  partnerEmails: [],
  updatedAt: null,
  updatedByUid: '',
};
