import { ArrowRight, Plus, Shirt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getUserFriendlyError } from '../firebase/errors';
import { updateOrderStatus } from '../services/orders';
import type { Order, OrderStatus, StoreSettings } from '../types/order';
import { formatShortDate, isTodayDate } from '../utils/date';
import { formatCurrency } from '../utils/payment';
import { OrderPhoto } from './OrderPhoto';
import { StatusBadge } from './StatusBadge';

interface DashboardPageProps {
  orders: Order[];
  loading: boolean;
  settings: StoreSettings;
  onNewOrder: () => void;
  onSelectOrder: (order: Order) => void;
  onViewAllOrders: () => void;
}

export function DashboardPage({
  orders,
  loading,
  settings,
  onNewOrder,
  onSelectOrder,
  onViewAllOrders,
}: DashboardPageProps) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const metrics = useMemo(() => {
    let todaysOrders = 0;
    let todaysSales = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let processingCount = 0;
    let readyCount = 0;
    let shippedCount = 0;
    let completedCount = 0;

    for (const order of orders) {
      const isCancelledOrReturned =
        order.status === 'CANCELLED' || order.status === 'RETURNED';

      if (isTodayDate(order.createdAt) && order.status !== 'CANCELLED') {
        todaysOrders += 1;
        if (!isCancelledOrReturned) {
          todaysSales += order.totalAmount;
        }
      }

      if (!isCancelledOrReturned) {
        totalCollected += order.paidAmount;
        totalOutstanding += order.remainingAmount;
      }

      if (order.status === 'PROCESSING') processingCount += 1;
      else if (order.status === 'READY') readyCount += 1;
      else if (order.status === 'SHIPPED') shippedCount += 1;
      else if (order.status === 'COMPLETED') completedCount += 1;
    }

    return {
      todaysOrders,
      todaysSales,
      totalCollected,
      totalOutstanding,
      processingCount,
      readyCount,
      shippedCount,
      completedCount,
    };
  }, [orders]);

  const recentOrders = useMemo(() => orders.slice(0, 8), [orders]);

  async function handleQuickStatus(orderId: string, nextStatus: OrderStatus) {
    setStatusError(null);
    setUpdatingId(orderId);
    try {
      await updateOrderStatus(orderId, nextStatus);
    } catch (err) {
      setStatusError(getUserFriendlyError(err, 'Could not update order status.'));
    } finally {
      setUpdatingId(null);
    }
  }

  const kpiCards = [
    {
      label: "Today's Orders",
      value: String(metrics.todaysOrders),
      sub: 'Created today',
      mono: true,
    },
    {
      label: "Today's Sales",
      value: formatCurrency(metrics.todaysSales, settings.currency),
      sub: 'Active order total',
      mono: true,
    },
    {
      label: 'Total Collected',
      value: formatCurrency(metrics.totalCollected, settings.currency),
      sub: 'Paid across active orders',
      mono: true,
    },
    {
      label: 'Total Outstanding',
      value: formatCurrency(metrics.totalOutstanding, settings.currency),
      sub: 'Remaining COD balance',
      mono: true,
    },
    {
      label: 'In Processing',
      value: String(metrics.processingCount),
      sub: 'Being prepared',
      mono: true,
    },
    {
      label: 'Ready Orders',
      value: String(metrics.readyCount),
      sub: 'Ready for dispatch',
      mono: true,
    },
    {
      label: 'Shipped Orders',
      value: String(metrics.shippedCount),
      sub: 'In transit',
      mono: true,
    },
    {
      label: 'Completed Orders',
      value: String(metrics.completedCount),
      sub: 'Delivered & closed',
      mono: true,
    },
  ];

  return (
    <div className="space-y-7">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-[#141413]">
            Studio Overview
          </h1>
          <p className="text-sm text-[#57534E] mt-0.5">
            {formatShortDate(new Date())} · {orders.length} total orders
          </p>
        </div>

        <button
          type="button"
          onClick={onNewOrder}
          className="min-h-[46px] px-5 py-2.5 rounded-xl bg-[#141413] text-white text-sm font-medium hover:bg-[#292826] active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>+ New Order</span>
        </button>
      </div>

      {statusError && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm font-medium text-rose-800">
          {statusError}
        </div>
      )}

      {/* 8 KPI Grid */}
      <section aria-label="Order metrics">
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="bg-white border border-[#E8E5DF] rounded-2xl p-4 sm:p-5 h-[102px] animate-pulse"
              >
                <div className="h-3 w-24 bg-[#ECE9E2] rounded" />
                <div className="h-6 w-28 bg-[#E5E1D8] rounded mt-3" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {kpiCards.map((card) => (
              <div
                key={card.label}
                className="bg-white border border-[#E8E5DF] rounded-2xl p-4 sm:p-5 flex flex-col justify-between"
              >
                <p className="text-xs font-medium text-[#57534E]">{card.label}</p>
                <p className="mt-2 text-lg sm:text-2xl font-semibold text-[#141413] font-mono tabular-nums tracking-tight truncate">
                  {card.value}
                </p>
                <p className="mt-1 text-[11px] text-[#78716C]">{card.sub}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Orders */}
      <section className="bg-white border border-[#E8E5DF] rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#ECE9E2] flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-[#141413]">Recent Orders</h2>
          {orders.length > 0 && (
            <button
              type="button"
              onClick={onViewAllOrders}
              className="min-h-[38px] px-2.5 text-xs sm:text-sm font-medium text-[#57534E] hover:text-[#141413] inline-flex items-center gap-1 transition-colors cursor-pointer"
            >
              <span>View all</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-[#F5F3EE] animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-[#F5F3EE] flex items-center justify-center text-[#57534E]">
              <Shirt className="w-5 h-5" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-[#141413]">No orders yet</h3>
            <p className="mt-1 text-sm text-[#57534E]">
              Add your first Shishu.clo customer order in seconds.
            </p>
            <button
              type="button"
              onClick={onNewOrder}
              className="mt-5 min-h-[46px] px-6 py-2.5 rounded-xl bg-[#141413] text-white text-sm font-medium hover:bg-[#292826] transition-colors inline-flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Create your first order</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[#ECE9E2]">
            {recentOrders.map((order) => (
              <div
                key={order.id}
                onClick={() => onSelectOrder(order)}
                className="px-4 sm:px-5 py-3.5 hover:bg-[#FAF9F7] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-xl overflow-hidden border border-[#E8E5DF] bg-[#F5F3EE] shrink-0 flex items-center justify-center">
                    <OrderPhoto
                      src={order.photos[0]}
                      alt={order.productName}
                      className="w-full h-full object-cover"
                      iconClassName="w-4 h-4 text-[#78716C]"
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-[#141413] tabular-nums">
                        {order.orderNumber}
                      </span>
                      <span className="text-xs text-[#78716C]">·</span>
                      <span className="text-sm font-medium text-[#141413] truncate">
                        {order.customerName}
                      </span>
                    </div>
                    <p className="text-xs text-[#57534E] truncate mt-0.5">
                      {order.productName} · Size {order.size} · {order.color} · {order.platform}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 pl-14 sm:pl-0 shrink-0">
                  <div className="text-left sm:text-right">
                    <p className="text-sm font-semibold font-mono tabular-nums text-[#141413]">
                      {formatCurrency(order.totalAmount, settings.currency)}
                    </p>
                    <p className="text-[11px] font-mono tabular-nums text-[#78716C]">
                      Paid {formatCurrency(order.paidAmount, settings.currency)}
                    </p>
                  </div>

                  <StatusBadge
                    status={order.status}
                    compact
                    disabled={updatingId === order.id}
                    onChange={(next) => handleQuickStatus(order.id, next)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
