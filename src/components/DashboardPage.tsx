import { ArrowRight, ArrowUpRight, Plus, Shirt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getUserFriendlyError } from '../firebase/errors';
import { updateOrderStatus } from '../services/orders';
import type { Order, OrderStatus, StoreSettings } from '../types/order';
import { formatShortDate, isTodayDate } from '../utils/date';
import { formatAmountDisplay, formatCurrency, parseAmountNumber } from '../utils/payment';
import { OrderPhoto } from './OrderPhoto';
import { StatusBadge } from './StatusBadge';

interface DashboardPageProps {
  orders: Order[];
  loading: boolean;
  settings: StoreSettings;
  onNewOrder: () => void;
  onSelectOrder: (order: Order) => void;
  onViewAllOrders: (statusFilter?: OrderStatus) => void;
  onNotify?: (text: string) => void;
}

export function DashboardPage({
  orders,
  loading,
  settings,
  onNewOrder,
  onSelectOrder,
  onViewAllOrders,
  onNotify,
}: DashboardPageProps) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
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

  const recentOrders = useMemo(() => orders.slice(0, 8), [orders]);

  async function handleQuickStatus(orderNumber: string, orderId: string, nextStatus: OrderStatus) {
    setStatusError(null);
    setUpdatingId(orderId);
    try {
      await updateOrderStatus(orderId, nextStatus);
      onNotify?.(`${orderNumber} marked ${nextStatus}`);
    } catch (err) {
      setStatusError(getUserFriendlyError(err, 'Could not update order status.'));
    } finally {
      setUpdatingId(null);
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
            {formatShortDate(new Date())} · {orders.length} {orders.length === 1 ? 'order' : 'orders'}
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
              const subtitleParts = [
                order.productName || 'Untitled piece',
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

                  <div className="flex items-center justify-between sm:justify-end gap-4 pl-[62px] sm:pl-0 shrink-0">
                    <div className="text-left sm:text-right">
                      <p className="text-sm font-semibold font-mono tabular-nums text-[#121211]">
                        {formatAmountDisplay(order.totalAmount, settings.currency)}
                      </p>
                      <p className="text-[11px] font-mono tabular-nums text-[#8C877E]">
                        Paid {formatAmountDisplay(order.paidAmount, settings.currency)}
                      </p>
                    </div>

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
