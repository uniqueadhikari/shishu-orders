import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Filter,
  Plus,
  Search,
  Shirt,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getUserFriendlyError } from '../firebase/errors';
import { updateOrderStatus } from '../services/orders';
import type {
  DateRangePreset,
  Order,
  OrderFilters,
  OrderStatus,
  PaymentType,
  StoreSettings,
} from '../types/order';
import { downloadOrdersCsv } from '../utils/csv';
import { DATE_PRESET_LABELS, formatShortDate, getDateRangeBounds } from '../utils/date';
import {
  ORDER_STATUSES,
  PAYMENT_TYPE_OPTIONS,
  formatAmountDisplay,
} from '../utils/payment';
import { OrderPhoto } from './OrderPhoto';
import { StatusBadge } from './StatusBadge';

interface OrdersPageProps {
  orders: Order[];
  loading: boolean;
  settings: StoreSettings;
  initialStatusFilter?: OrderStatus | 'ALL';
  onNewOrder: () => void;
  onSelectOrder: (order: Order) => void;
  onNotify?: (text: string) => void;
}

const PAGE_SIZE = 20;

const INITIAL_FILTERS: OrderFilters = {
  search: '',
  status: 'ALL',
  paymentType: 'ALL',
  datePreset: 'all',
  customStart: '',
  customEnd: '',
  size: 'ALL',
  color: 'ALL',
};

export function OrdersPage({
  orders,
  loading,
  settings,
  initialStatusFilter = 'ALL',
  onNewOrder,
  onSelectOrder,
  onNotify,
}: OrdersPageProps) {
  const [filters, setFilters] = useState<OrderFilters>(() => ({
    ...INITIAL_FILTERS,
    status: initialStatusFilter,
  }));
  const [searchInput, setSearchInput] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [copiedOrderNum, setCopiedOrderNum] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, status: initialStatusFilter }));
    setPage(1);
  }, [initialStatusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: searchInput.trim().toLowerCase() }));
      setPage(1);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: orders.length };
    for (const st of ORDER_STATUSES) counts[st] = 0;
    for (const o of orders) {
      counts[o.status] = (counts[o.status] || 0) + 1;
    }
    return counts;
  }, [orders]);

  const availableSizes = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.size.trim()) set.add(o.size.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [orders]);

  const availableColors = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.color.trim()) set.add(o.color.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const { start, end } = getDateRangeBounds(
      filters.datePreset,
      filters.customStart,
      filters.customEnd
    );

    return orders.filter((order) => {
      if (filters.status !== 'ALL' && order.status !== filters.status) return false;
      if (filters.paymentType !== 'ALL' && order.paymentType !== filters.paymentType) return false;
      if (filters.size !== 'ALL' && order.size !== filters.size) return false;
      if (filters.color !== 'ALL' && order.color !== filters.color) return false;

      if (start && order.createdAt < start) return false;
      if (end && order.createdAt > end) return false;

      if (filters.search) {
        const q = filters.search;
        const hit =
          order.orderNumber.toLowerCase().includes(q) ||
          order.customerName.toLowerCase().includes(q) ||
          order.phone.toLowerCase().includes(q) ||
          order.socialContact.toLowerCase().includes(q) ||
          order.productName.toLowerCase().includes(q) ||
          order.size.toLowerCase().includes(q) ||
          order.color.toLowerCase().includes(q);
        if (!hit) return false;
      }

      return true;
    });
  }, [orders, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedOrders = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredOrders.slice(start, start + PAGE_SIZE);
  }, [filteredOrders, safePage]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.paymentType !== 'ALL') count++;
    if (filters.datePreset !== 'all') count++;
    if (filters.size !== 'ALL') count++;
    if (filters.color !== 'ALL') count++;
    return count;
  }, [filters]);

  function resetAllFilters() {
    setSearchInput('');
    setFilters(INITIAL_FILTERS);
    setPage(1);
  }

  async function handleQuickStatus(orderNumber: string, orderId: string, nextStatus: OrderStatus) {
    setStatusError(null);
    setUpdatingId(orderId);
    try {
      await updateOrderStatus(orderId, nextStatus);
      onNotify?.(`${orderNumber} updated to ${nextStatus}`);
    } catch (err) {
      setStatusError(getUserFriendlyError(err, 'Could not update status.'));
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleCopyOrderNumber(e: React.MouseEvent, orderNumber: string) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(orderNumber);
      setCopiedOrderNum(orderNumber);
      onNotify?.(`Copied ${orderNumber}`);
      window.setTimeout(() => setCopiedOrderNum(null), 1500);
    } catch {
      // ignore clipboard errors if blocked
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#8C877E] tabular-nums">
            {filteredOrders.length} of {orders.length} orders
          </p>
          <h1 className="mt-1 text-3xl sm:text-4xl font-display font-semibold tracking-tight text-[#121211]">
            Orders
          </h1>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            disabled={filteredOrders.length === 0}
            onClick={() => {
              downloadOrdersCsv(filteredOrders, 'shishu-clo-orders');
              onNotify?.(`Exported ${filteredOrders.length} orders to CSV`);
            }}
            className="min-h-[42px] px-4 py-2 rounded-xl border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] disabled:opacity-50 text-xs sm:text-sm font-medium text-[#121211] inline-flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={onNewOrder}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#121211] text-[#F7F5F0] hover:bg-[#272624] text-xs sm:text-sm font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Order</span>
          </button>
        </div>
      </div>

      {/* Quick Status Tabs */}
      {orders.length > 0 && (
        <div
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1"
          role="tablist"
          aria-label="Filter orders by status"
        >
          {(['ALL', ...ORDER_STATUSES] as const).map((st) => {
            const active = filters.status === st;
            const count = statusCounts[st] ?? 0;
            return (
              <button
                key={st}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setFilters((f) => ({ ...f, status: st }));
                  setPage(1);
                }}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#121211] text-[#F7F5F0] border-[#121211]'
                    : 'bg-white text-[#5C5852] border-[#E6E2D8] hover:border-[#C9C3B6] hover:text-[#121211]'
                }`}
              >
                <span>{st === 'ALL' ? 'All' : st}</span>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    active ? 'text-stone-300' : 'text-[#8C877E]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Search & Filter Toggle */}
      <div className="bg-white border border-[#E6E2D8] rounded-2xl p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#8C877E] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search order #, customer, phone, contact, product, size, or color..."
              className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`min-h-[44px] px-4 py-2 rounded-xl border text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer ${
                showFilters || activeFilterCount > 0
                  ? 'bg-[#121211] text-[#F7F5F0] border-[#121211]'
                  : 'bg-white text-[#121211] border-[#DDD8CE] hover:bg-[#F7F5F0]'
              }`}
            >
              <Filter className="w-4 h-4" />
              <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
            </button>

            {(activeFilterCount > 0 || filters.status !== 'ALL' || searchInput) && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] text-sm font-medium text-[#5C5852] inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>

        {/* Expanded Filter Controls */}
        {showFilters && (
          <div className="pt-3 border-t border-[#ECE9E2] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#5C5852] mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, status: e.target.value as OrderStatus | 'ALL' }));
                  setPage(1);
                }}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] text-sm"
              >
                <option value="ALL">All statuses</option>
                {ORDER_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#5C5852] mb-1">Date</label>
              <select
                value={filters.datePreset}
                onChange={(e) => {
                  setFilters((f) => ({
                    ...f,
                    datePreset: e.target.value as DateRangePreset,
                  }));
                  setPage(1);
                }}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] text-sm"
              >
                {(Object.keys(DATE_PRESET_LABELS) as DateRangePreset[]).map((preset) => (
                  <option key={preset} value={preset}>
                    {DATE_PRESET_LABELS[preset]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#5C5852] mb-1">Size</label>
              <select
                value={filters.size}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, size: e.target.value }));
                  setPage(1);
                }}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] text-sm"
              >
                <option value="ALL">All sizes</option>
                {availableSizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#5C5852] mb-1">Color</label>
              <select
                value={filters.color}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, color: e.target.value }));
                  setPage(1);
                }}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] text-sm"
              >
                <option value="ALL">All colors</option>
                {availableColors.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {orders.some((o) => o.paymentType) && (
              <div>
                <label className="block text-xs font-medium text-[#5C5852] mb-1">
                  Legacy payment type
                </label>
                <select
                  value={filters.paymentType}
                  onChange={(e) => {
                    setFilters((f) => ({
                      ...f,
                      paymentType: e.target.value as PaymentType | 'ALL',
                    }));
                    setPage(1);
                  }}
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] text-sm"
                >
                  <option value="ALL">All payment types</option>
                  {PAYMENT_TYPE_OPTIONS.map((pt) => (
                    <option key={pt.value} value={pt.value}>
                      {pt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {filters.datePreset === 'custom' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-[#5C5852] mb-1">From date</label>
                  <input
                    type="date"
                    value={filters.customStart}
                    onChange={(e) => {
                      setFilters((f) => ({ ...f, customStart: e.target.value }));
                      setPage(1);
                    }}
                    className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#5C5852] mb-1">To date</label>
                  <input
                    type="date"
                    value={filters.customEnd}
                    onChange={(e) => {
                      setFilters((f) => ({ ...f, customEnd: e.target.value }));
                      setPage(1);
                    }}
                    className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] text-sm"
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {statusError && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm font-medium text-rose-800">
          {statusError}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="bg-white border border-[#E6E2D8] rounded-2xl p-5 space-y-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-14 rounded-xl bg-[#F7F5F0] animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white border border-[#E6E2D8] rounded-2xl px-6 py-16 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-[#F7F5F0] border border-[#E6E2D8] flex items-center justify-center text-[#5C5852]">
            <Shirt className="w-5 h-5" />
          </div>
          <h2 className="mt-4 text-lg font-display font-semibold text-[#121211]">No orders yet</h2>
          <p className="mt-1 text-sm text-[#5C5852]">
            Start recording Shishu.clo orders to track sales, payments, and deliveries.
          </p>
          <button
            type="button"
            onClick={onNewOrder}
            className="mt-5 min-h-[46px] px-6 py-2.5 rounded-xl bg-[#121211] text-[#F7F5F0] text-sm font-medium hover:bg-[#272624] transition-colors inline-flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create your first order</span>
          </button>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white border border-[#E6E2D8] rounded-2xl px-6 py-14 text-center">
          <h2 className="text-base font-semibold text-[#121211]">No matching orders</h2>
          <p className="mt-1 text-sm text-[#5C5852]">
            Try clearing or adjusting your search and filter options.
          </p>
          <button
            type="button"
            onClick={resetAllFilters}
            className="mt-4 min-h-[42px] px-5 py-2 rounded-xl border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] text-sm font-medium text-[#121211] cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block bg-white border border-[#E6E2D8] rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#ECE9E2] bg-[#FAF9F5] text-[11px] uppercase tracking-[0.08em] font-semibold text-[#5C5852]">
                    <th className="py-3.5 px-4">Order #</th>
                    <th className="py-3.5 px-4">Customer</th>
                    <th className="py-3.5 px-4">Phone</th>
                    <th className="py-3.5 px-4">Product</th>
                    <th className="py-3.5 px-4">Size</th>
                    <th className="py-3.5 px-4">Color</th>
                    <th className="py-3.5 px-4 text-right">Total</th>
                    <th className="py-3.5 px-4 text-right">Paid</th>
                    <th className="py-3.5 px-4 text-right">Remaining</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE9E2] text-sm">
                  {paginatedOrders.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => onSelectOrder(order)}
                      className="hover:bg-[#FAF9F5] transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-[#121211] whitespace-nowrap tabular-nums">
                        <div className="inline-flex items-center gap-1.5">
                          <span>{order.orderNumber}</span>
                          <button
                            type="button"
                            onClick={(e) => handleCopyOrderNumber(e, order.orderNumber)}
                            className="p-1 rounded text-[#8C877E] hover:text-[#121211] transition-colors cursor-pointer"
                            aria-label={`Copy ${order.orderNumber}`}
                          >
                            {copiedOrderNum === order.orderNumber ? (
                              <Check className="w-3 h-3 text-emerald-700" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-medium text-[#121211] max-w-[170px] truncate">
                        {order.customerName || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-[#5C5852] whitespace-nowrap tabular-nums">
                        {order.phone || '—'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5 max-w-[220px]">
                          <div className="w-9 h-9 rounded-lg overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] shrink-0 flex items-center justify-center">
                            <OrderPhoto
                              src={order.photos[0]}
                              alt={order.productName || order.orderNumber}
                              className="w-full h-full object-cover"
                              iconClassName="w-3.5 h-3.5 text-[#8C877E]"
                            />
                          </div>
                          <span className="truncate font-medium text-[#121211]">
                            {order.productName || '—'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-[#5C5852] whitespace-nowrap max-w-[90px] truncate">
                        {order.size || '—'}
                      </td>
                      <td className="py-3 px-4 text-xs text-[#5C5852] whitespace-nowrap max-w-[100px] truncate">
                        {order.color || '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-[#121211] whitespace-nowrap tabular-nums">
                        {formatAmountDisplay(order.totalAmount, settings.currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-emerald-800 whitespace-nowrap tabular-nums">
                        {formatAmountDisplay(order.paidAmount, settings.currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-amber-900 whitespace-nowrap tabular-nums">
                        {formatAmountDisplay(order.remainingAmount, settings.currency)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <StatusBadge
                          status={order.status}
                          compact
                          disabled={updatingId === order.id}
                          onChange={(next) => handleQuickStatus(order.orderNumber, order.id, next)}
                        />
                      </td>
                      <td className="py-3 px-4 text-xs text-[#8C877E] whitespace-nowrap">
                        {formatShortDate(order.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile & Tablet Order Cards */}
          <div className="lg:hidden space-y-3">
            {paginatedOrders.map((order) => {
              const specs = [
                order.size ? `Size ${order.size}` : '',
                order.color || '',
                order.socialContact || '',
              ]
                .filter(Boolean)
                .join(' · ');

              return (
                <div
                  key={order.id}
                  onClick={() => onSelectOrder(order)}
                  className="bg-white border border-[#E6E2D8] rounded-2xl p-4 space-y-3 active:bg-[#FAF9F5] transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[#121211] tabular-nums">
                          {order.orderNumber}
                        </span>
                        <span className="text-xs text-[#8C877E]" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-xs text-[#8C877E]">
                          {formatShortDate(order.createdAt)}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-[#121211] mt-0.5">
                        {order.customerName || 'Unnamed customer'}
                      </h3>
                    </div>

                    <StatusBadge
                      status={order.status}
                      compact
                      disabled={updatingId === order.id}
                      onChange={(next) => handleQuickStatus(order.orderNumber, order.id, next)}
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-xl overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] shrink-0 flex items-center justify-center">
                      <OrderPhoto
                        src={order.photos[0]}
                        alt={order.productName || order.orderNumber}
                        className="w-full h-full object-cover"
                        iconClassName="w-4 h-4 text-[#8C877E]"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#121211] truncate">
                        {order.productName || 'Untitled piece'}
                      </p>
                      {specs && (
                        <p className="text-xs text-[#5C5852] truncate mt-0.5">{specs}</p>
                      )}
                      {order.phone && (
                        <p className="text-xs font-mono text-[#8C877E] tabular-nums mt-0.5">
                          {order.phone}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-[#ECE9E2] grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-[#8C877E]">Total</p>
                      <p className="font-mono font-semibold text-[#121211] tabular-nums mt-0.5 truncate">
                        {formatAmountDisplay(order.totalAmount, settings.currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#8C877E]">Paid</p>
                      <p className="font-mono font-semibold text-emerald-800 tabular-nums mt-0.5 truncate">
                        {formatAmountDisplay(order.paidAmount, settings.currency)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[#8C877E]">Remaining</p>
                      <p className="font-mono font-semibold text-amber-900 tabular-nums mt-0.5 truncate">
                        {formatAmountDisplay(order.remainingAmount, settings.currency)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-[#5C5852] tabular-nums">
                Page {safePage} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="min-h-[40px] min-w-[40px] px-3 rounded-xl border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] disabled:opacity-40 flex items-center justify-center cursor-pointer"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="min-h-[40px] min-w-[40px] px-3 rounded-xl border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] disabled:opacity-40 flex items-center justify-center cursor-pointer"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
