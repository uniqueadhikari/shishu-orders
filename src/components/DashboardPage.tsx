import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Package,
  Plus,
  Shirt,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { getUserFriendlyError } from '../firebase/errors';
import { adjustInventoryQuantity, getStockState } from '../services/inventory';
import {
  getOrderLineItems,
  markOrderPaidAndComplete,
  updateOrderStatus,
} from '../services/orders';
import type { InventoryItem, Order, OrderStatus, StoreSettings } from '../types/order';
import { formatShortDate, isTodayDate } from '../utils/date';
import { formatAmountDisplay, formatCurrency, parseAmountNumber } from '../utils/payment';
import { OrderPhoto } from './OrderPhoto';
import { StatusBadge } from './StatusBadge';

interface DashboardPageProps {
  orders: Order[];
  inventory: InventoryItem[];
  loading: boolean;
  settings: StoreSettings;
  onNewOrder: () => void;
  onOrderFromStock?: (item: InventoryItem) => void;
  onSelectOrder: (order: Order) => void;
  onViewAllOrders: (statusFilter?: OrderStatus) => void;
  onOpenInventory: () => void;
  onNotify?: (text: string) => void;
}

export function DashboardPage({
  orders,
  inventory,
  loading,
  settings,
  onNewOrder,
  onOrderFromStock,
  onSelectOrder,
  onViewAllOrders,
  onOpenInventory,
  onNotify,
}: DashboardPageProps) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const metrics = useMemo(() => {
    let todaysOrders = 0;
    let todaysSales = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let activeTotal = 0;
    let processingCount = 0;
    let readyCount = 0;
    let shippedCount = 0;
    let completedCount = 0;

    for (const order of orders) {
      const isCancelledOrReturned =
        order.status === 'CANCELLED' || order.status === 'RETURNED';

      const orderTotal = parseAmountNumber(order.totalAmount);
      const orderPaid = parseAmountNumber(order.paidAmount);
      const orderRemaining = parseAmountNumber(order.remainingAmount);

      if (isTodayDate(order.createdAt) && order.status !== 'CANCELLED') {
        todaysOrders += 1;
        if (!isCancelledOrReturned) {
          todaysSales += orderTotal;
        }
      }

      if (!isCancelledOrReturned) {
        totalCollected += orderPaid;
        totalOutstanding += orderRemaining;
        activeTotal += orderTotal;
      }

      if (order.status === 'PROCESSING') processingCount += 1;
      else if (order.status === 'READY') readyCount += 1;
      else if (order.status === 'SHIPPED') shippedCount += 1;
      else if (order.status === 'COMPLETED') completedCount += 1;
    }

    const collectionRate =
      activeTotal > 0 ? Math.min(100, Math.round((totalCollected / activeTotal) * 100)) : 0;

    return {
      todaysOrders,
      todaysSales,
      totalCollected,
      totalOutstanding,
      collectionRate,
      processingCount,
      readyCount,
      shippedCount,
      completedCount,
    };
  }, [orders]);

  const stockMetrics = useMemo(() => {
    let totalUnits = 0;
    const alertItems: InventoryItem[] = [];
    for (const item of inventory) {
      totalUnits += item.quantity;
      const state = getStockState(item);
      if (state === 'low' || state === 'out') {
        alertItems.push(item);
      }
    }
    alertItems.sort((a, b) => a.quantity - b.quantity);
    return {
      totalSkus: inventory.length,
      totalUnits,
      alertItems: alertItems.slice(0, 4),
      totalAlerts: alertItems.length,
    };
  }, [inventory]);

  const recentOrders = useMemo(() => orders.slice(0, 8), [orders]);

  async function handleQuickStatus(orderNumber: string, orderId: string, nextStatus: OrderStatus) {
    setStatusError(null);
    setUpdatingId(orderId);
    try {
      const result = await updateOrderStatus(orderId, nextStatus);
      const qtyHint =
        typeof result.updatedStockQuantity === 'number'
          ? ` (${result.updatedStockQuantity} left)`
          : '';
      const pieceHint = result.stockPieceLabel ? `${result.stockPieceLabel} ` : '';
      const multiCount =
        (result.stockUpdatesCount ?? 0) > 1 ? `${result.stockUpdatesCount} stock pieces ` : '';
      const stockSuffix =
        result.stockAction === 'restored'
          ? ` · ${multiCount || pieceHint + 'stock '}restored${qtyHint}`
          : result.stockAction === 'deducted'
            ? ` · ${multiCount || pieceHint + 'stock '}deducted${qtyHint}`
            : '';
      onNotify?.(`${orderNumber} marked ${nextStatus}${stockSuffix}`);
    } catch (err) {
      setStatusError(getUserFriendlyError(err, 'Could not update order status.'));
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleQuickMarkPaid(e: React.MouseEvent, order: Order) {
    e.stopPropagation();
    setStatusError(null);
    setUpdatingId(order.id);
    try {
      const result = await markOrderPaidAndComplete(order.id);
      const qtyHint =
        typeof result.updatedStockQuantity === 'number'
          ? ` (${result.updatedStockQuantity} left)`
          : '';
      const pieceHint = result.stockPieceLabel ? `${result.stockPieceLabel} ` : '';
      const multiCount =
        (result.stockUpdatesCount ?? 0) > 1 ? `${result.stockUpdatesCount} stock pieces ` : '';
      const stockSuffix =
        result.stockAction === 'deducted'
          ? ` · ${multiCount || pieceHint + 'stock '}deducted${qtyHint}`
          : '';
      onNotify?.(`${order.orderNumber} marked paid & completed${stockSuffix}`);
    } catch (err) {
      setStatusError(getUserFriendlyError(err, 'Could not settle payment.'));
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleQuickRestock(item: InventoryItem) {
    setStatusError(null);
    setRestockingId(item.id);
    try {
      await adjustInventoryQuantity(item.id, item.quantity + 1);
      onNotify?.(`Added +1 stock for ${item.pieceName}`);
    } catch (err) {
      setStatusError(getUserFriendlyError(err, 'Could not update stock.'));
    } finally {
      setRestockingId(null);
    }
  }

  const financialCards = [
    {
      label: "Today's Orders",
      value: String(metrics.todaysOrders),
      sub: 'Created today',
      accent: 'text-[#121211]',
    },
    {
      label: "Today's Sales",
      value: formatCurrency(metrics.todaysSales, settings.currency),
      sub: 'Active today value',
      accent: 'text-[#121211]',
    },
    {
      label: 'Total Collected',
      value: formatCurrency(metrics.totalCollected, settings.currency),
      sub: `${metrics.collectionRate}% of active revenue`,
      accent: 'text-emerald-900',
    },
    {
      label: 'Total Outstanding',
      value: formatCurrency(metrics.totalOutstanding, settings.currency),
      sub: 'Remaining COD balance',
      accent: 'text-amber-900',
    },
  ];

  const pipelineCards: {
    label: string;
    value: number;
    sub: string;
    status: OrderStatus;
    dotColor: string;
  }[] = [
    {
      label: 'In Processing',
      value: metrics.processingCount,
      sub: 'Being prepared',
      status: 'PROCESSING',
      dotColor: 'bg-amber-600',
    },
    {
      label: 'Ready Orders',
      value: metrics.readyCount,
      sub: 'Ready for dispatch',
      status: 'READY',
      dotColor: 'bg-purple-600',
    },
    {
      label: 'Shipped Orders',
      value: metrics.shippedCount,
      sub: 'In transit',
      status: 'SHIPPED',
      dotColor: 'bg-teal-600',
    },
    {
      label: 'Completed Orders',
      value: metrics.completedCount,
      sub: 'Delivered & closed',
      status: 'COMPLETED',
      dotColor: 'bg-emerald-600',
    },
  ];

  return (
    <div className="space-y-7">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#8C877E]">
            {formatShortDate(new Date())} · {orders.length}{' '}
            {orders.length === 1 ? 'order' : 'orders'} · {stockMetrics.totalUnits} in stock
          </p>
          <h1 className="mt-1 text-3xl sm:text-4xl font-display font-semibold tracking-tight text-[#121211]">
            Studio Overview
          </h1>
        </div>

        <button
          type="button"
          onClick={onNewOrder}
          className="min-h-[46px] px-5 py-2.5 rounded-xl bg-[#121211] text-[#F7F5F0] text-sm font-medium hover:bg-[#272624] active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Order</span>
        </button>
      </div>

      {statusError && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm font-medium text-rose-800">
          {statusError}
        </div>
      )}

      {/* 8 KPI Grid */}
      <section aria-label="Order metrics" className="space-y-4">
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="bg-white border border-[#E6E2D8] rounded-2xl p-4 sm:p-5 h-[108px] animate-pulse"
              >
                <div className="h-3 w-24 bg-[#ECE9E2] rounded" />
                <div className="h-6 w-28 bg-[#E4E0D6] rounded mt-3.5" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {financialCards.map((card) => (
                <div
                  key={card.label}
                  className="bg-white border border-[#E6E2D8] rounded-2xl p-4 sm:p-5 flex flex-col justify-between"
                >
                  <p className="text-xs font-medium text-[#5C5852]">{card.label}</p>
                  <p
                    className={`mt-2.5 text-lg sm:text-2xl font-semibold font-mono tabular-nums tracking-tight truncate ${card.accent}`}
                  >
                    {card.value}
                  </p>
                  <p className="mt-1.5 text-[11px] text-[#8C877E] tabular-nums">{card.sub}</p>
                </div>
              ))}
            </div>

            {orders.length > 0 && (
              <div className="bg-white border border-[#E6E2D8] rounded-2xl px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-medium text-[#5C5852] shrink-0">
                    Collection Progress
                  </span>
                  <div className="flex-1 sm:w-48 h-2 rounded-full bg-[#EFECE5] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#121211] transition-all duration-300"
                      style={{ width: `${metrics.collectionRate}%` }}
                    />
                  </div>
                </div>
                <p className="text-xs font-mono tabular-nums text-[#5C5852]">
                  {metrics.collectionRate}% collected ·{' '}
                  <span className="text-amber-900 font-semibold">
                    {formatCurrency(metrics.totalOutstanding, settings.currency)}
                  </span>{' '}
                  remaining
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {pipelineCards.map((card) => (
                <button
                  key={card.label}
                  type="button"
                  onClick={() => onViewAllOrders(card.status)}
                  className="group text-left bg-white border border-[#E6E2D8] hover:border-[#C9C3B6] rounded-2xl p-4 sm:p-5 flex flex-col justify-between transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-xs font-medium text-[#5C5852]">
                      <span className={`w-2 h-2 rounded-full ${card.dotColor}`} aria-hidden="true" />
                      {card.label}
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-[#8C877E] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="mt-2.5 text-xl sm:text-2xl font-semibold text-[#121211] font-mono tabular-nums tracking-tight">
                    {card.value}
                  </p>
                  <p className="mt-1 text-[11px] text-[#8C877E]">{card.sub}</p>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Inventory & Stock Alerts Snapshot */}
      <section className="bg-white border border-[#E6E2D8] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#ECE9E2] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Package className="w-4 h-4 text-[#5C5852]" />
            <h2 className="text-base font-semibold text-[#121211]">Inventory Snapshot</h2>
            <span className="text-xs text-[#8C877E] tabular-nums">
              · {stockMetrics.totalSkus} pieces · {stockMetrics.totalUnits} units
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenInventory}
            className="min-h-[38px] px-2.5 text-xs sm:text-sm font-medium text-[#5C5852] hover:text-[#121211] inline-flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>Manage stock</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {inventory.length === 0 ? (
          <div className="px-5 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-[#5C5852]">
              Add your pieces, colors, and quantities to track stock automatically when orders come
              in.
            </p>
            <button
              type="button"
              onClick={onOpenInventory}
              className="min-h-[40px] px-4 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] hover:bg-[#EFECE5] text-xs font-medium text-[#121211] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Open Inventory
            </button>
          </div>
        ) : stockMetrics.alertItems.length === 0 ? (
          <div className="px-5 py-4 text-sm text-emerald-900 flex items-center justify-between gap-3">
            <span>All {stockMetrics.totalSkus} stock pieces are healthy and ready for orders.</span>
          </div>
        ) : (
          <div className="divide-y divide-[#ECE9E2]">
            {stockMetrics.alertItems.map((item) => {
              const out = item.quantity <= 0;
              return (
                <div
                  key={item.id}
                  className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] shrink-0 flex items-center justify-center">
                      <OrderPhoto
                        src={item.photoUrl}
                        alt={item.pieceName}
                        className="w-full h-full object-cover"
                        iconClassName="w-3.5 h-3.5 text-[#8C877E]"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#121211] truncate">
                        {item.pieceName}
                        {item.color ? ` · ${item.color}` : ''}
                      </p>
                      <p
                        className={`text-xs inline-flex items-center gap-1 ${
                          out ? 'text-rose-700 font-semibold' : 'text-amber-800 font-medium'
                        }`}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        <span>{out ? 'Out of stock' : `Low stock · ${item.quantity} left`}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!out && onOrderFromStock && (
                      <button
                        type="button"
                        onClick={() => onOrderFromStock(item)}
                        className="min-h-[34px] px-3 py-1 rounded-lg bg-[#121211] text-[#F7F5F0] hover:bg-[#272624] text-xs font-medium cursor-pointer"
                      >
                        Order
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={restockingId === item.id}
                      onClick={() => handleQuickRestock(item)}
                      className="min-h-[34px] px-3 py-1 rounded-lg border border-[#DDD8CE] bg-[#FAF9F5] hover:bg-[#EFECE5] text-xs font-medium text-[#121211] cursor-pointer"
                    >
                      {restockingId === item.id ? 'Adding...' : '+1 Stock'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent Orders */}
      <section className="bg-white border border-[#E6E2D8] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#ECE9E2] flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-[#121211]">Recent Orders</h2>
          {orders.length > 0 && (
            <button
              type="button"
              onClick={() => onViewAllOrders()}
              className="min-h-[38px] px-2.5 text-xs sm:text-sm font-medium text-[#5C5852] hover:text-[#121211] inline-flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span>View all orders</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-[#F7F5F0] animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-[#F7F5F0] border border-[#E6E2D8] flex items-center justify-center text-[#5C5852]">
              <Shirt className="w-5 h-5" />
            </div>
            <h3 className="mt-4 text-lg font-display font-semibold text-[#121211]">
              No orders yet
            </h3>
            <p className="mt-1 text-sm text-[#5C5852]">
              Add your first Shishu.clo customer order in seconds.
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
        ) : (
          <div className="divide-y divide-[#ECE9E2]">
            {recentOrders.map((order) => {
              const lineItems = getOrderLineItems(order);
              const totalQty =
                lineItems.length > 0
                  ? lineItems.reduce((sum, li) => sum + li.quantity, 0)
                  : order.orderQuantity;
              const hasDue =
                order.status !== 'CANCELLED' &&
                order.status !== 'RETURNED' &&
                parseAmountNumber(order.remainingAmount) > 0;

              const subtitleParts = [
                order.productName || 'Untitled piece',
                totalQty > 1 ? `${totalQty} pcs` : '',
                order.size ? `Size ${order.size}` : '',
                order.color || '',
              ].filter(Boolean);

              return (
                <div
                  key={order.id}
                  onClick={() => onSelectOrder(order)}
                  className="px-4 sm:px-5 py-3.5 hover:bg-[#FAF9F5] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-12 h-12 rounded-xl overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] shrink-0 flex items-center justify-center">
                      <OrderPhoto
                        src={order.photos[0]}
                        alt={order.productName || order.orderNumber}
                        className="w-full h-full object-cover"
                        iconClassName="w-4 h-4 text-[#8C877E]"
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-[#121211] tabular-nums">
                          {order.orderNumber}
                        </span>
                        <span className="text-xs text-[#8C877E]" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-sm font-medium text-[#121211] truncate">
                          {order.customerName || 'Unnamed customer'}
                        </span>
                      </div>
                      <p className="text-xs text-[#5C5852] truncate mt-0.5">
                        {subtitleParts.join(' · ')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 pl-[62px] sm:pl-0 shrink-0 flex-wrap">
                    <div className="text-left sm:text-right">
                      <p className="text-sm font-semibold font-mono tabular-nums text-[#121211]">
                        {formatAmountDisplay(order.totalAmount, settings.currency)}
                      </p>
                      <p className="text-[11px] font-mono tabular-nums text-[#8C877E]">
                        Paid {formatAmountDisplay(order.paidAmount, settings.currency)}
                      </p>
                    </div>

                    {hasDue && (
                      <button
                        type="button"
                        disabled={updatingId === order.id}
                        onClick={(e) => handleQuickMarkPaid(e, order)}
                        title="Mark COD paid & complete order"
                        className="min-h-[32px] px-2.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-[11px] font-semibold text-emerald-900 inline-flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Mark Paid</span>
                      </button>
                    )}

                    <StatusBadge
                      status={order.status}
                      compact
                      disabled={updatingId === order.id}
                      onChange={(next) => handleQuickStatus(order.orderNumber, order.id, next)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
