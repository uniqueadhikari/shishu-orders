import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DateRangePreset, Order, StoreSettings } from '../types/order';
import { downloadOrdersCsv } from '../utils/csv';
import { DATE_PRESET_LABELS, getDateRangeBounds } from '../utils/date';
import {
  ORDER_STATUSES,
  ORDER_STATUS_META,
  PAYMENT_TYPE_OPTIONS,
  PLATFORMS,
  formatCurrency,
} from '../utils/payment';

interface ReportsPageProps {
  orders: Order[];
  settings: StoreSettings;
}

const REPORT_PRESETS: DateRangePreset[] = [
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'last_month',
  'custom',
  'all',
];

export function ReportsPage({ orders, settings }: ReportsPageProps) {
  const [datePreset, setDatePreset] = useState<DateRangePreset>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const scopedOrders = useMemo(() => {
    const { start, end } = getDateRangeBounds(datePreset, customStart, customEnd);
    return orders.filter((order) => {
      if (start && order.createdAt < start) return false;
      if (end && order.createdAt > end) return false;
      return true;
    });
  }, [orders, datePreset, customStart, customEnd]);

  const summary = useMemo(() => {
    let totalOrders = scopedOrders.length;
    let totalSales = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let completedSales = 0;
    let cancelledOrders = 0;
    let returnedOrders = 0;

    for (const o of scopedOrders) {
      if (o.status === 'CANCELLED') {
        cancelledOrders += 1;
        continue;
      }
      if (o.status === 'RETURNED') {
        returnedOrders += 1;
        continue;
      }
      totalSales += o.totalAmount;
      totalCollected += o.paidAmount;
      totalOutstanding += o.remainingAmount;
      if (o.status === 'COMPLETED') {
        completedSales += o.totalAmount;
      }
    }

    return {
      totalOrders,
      totalSales,
      totalCollected,
      totalOutstanding,
      completedSales,
      cancelledOrders,
      returnedOrders,
    };
  }, [scopedOrders]);

  const platformBreakdown = useMemo(() => {
    return PLATFORMS.map((platform) => {
      const matching = scopedOrders.filter(
        (o) => o.platform === platform && o.status !== 'CANCELLED' && o.status !== 'RETURNED'
      );
      const count = matching.length;
      const sales = matching.reduce((acc, o) => acc + o.totalAmount, 0);
      return { platform, count, sales };
    });
  }, [scopedOrders]);

  const maxPlatformSales = Math.max(1, ...platformBreakdown.map((p) => p.sales));

  const paymentBreakdown = useMemo(() => {
    return PAYMENT_TYPE_OPTIONS.map((pt) => {
      const matching = scopedOrders.filter(
        (o) => o.paymentType === pt.value && o.status !== 'CANCELLED' && o.status !== 'RETURNED'
      );
      const count = matching.length;
      const total = matching.reduce((acc, o) => acc + o.totalAmount, 0);
      const collected = matching.reduce((acc, o) => acc + o.paidAmount, 0);
      return { ...pt, count, total, collected };
    });
  }, [scopedOrders]);

  const maxPaymentCount = Math.max(1, ...paymentBreakdown.map((p) => p.count));

  const statusBreakdown = useMemo(() => {
    return ORDER_STATUSES.map((status) => {
      const matching = scopedOrders.filter((o) => o.status === status);
      return {
        status,
        count: matching.length,
        sales: matching.reduce((acc, o) => acc + o.totalAmount, 0),
        color: ORDER_STATUS_META[status].barColor,
      };
    });
  }, [scopedOrders]);

  const maxStatusCount = Math.max(1, ...statusBreakdown.map((s) => s.count));

  const productBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; count: number; sales: number }>();
    for (const o of scopedOrders) {
      if (o.status === 'CANCELLED' || o.status === 'RETURNED') continue;
      const key = o.productName.trim().toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.sales += o.totalAmount;
      } else {
        map.set(key, { name: o.productName.trim(), count: 1, sales: o.totalAmount });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 10);
  }, [scopedOrders]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-[#141413]">
            Reports & Analytics
          </h1>
          <p className="text-sm text-[#57534E] mt-0.5">
            {DATE_PRESET_LABELS[datePreset]} · {scopedOrders.length} orders in range
          </p>
        </div>

        <button
          type="button"
          disabled={scopedOrders.length === 0}
          onClick={() => downloadOrdersCsv(scopedOrders, `shishu-clo-report-${datePreset}`)}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-[#141413] text-white hover:bg-[#292826] disabled:opacity-50 text-xs sm:text-sm font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Export Report CSV</span>
        </button>
      </div>

      {/* Date Range Selector */}
      <div className="bg-white border border-[#E8E5DF] rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {REPORT_PRESETS.map((preset) => {
            const active = datePreset === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => setDatePreset(preset)}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#141413] text-white'
                    : 'bg-[#FAF9F7] text-[#57534E] hover:bg-[#F1EFEA] hover:text-[#141413]'
                }`}
              >
                {DATE_PRESET_LABELS[preset]}
              </button>
            );
          })}
        </div>

        {datePreset === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#ECE9E2]">
            <div>
              <label className="block text-xs font-medium text-[#57534E] mb-1">Start date</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DFDBD2] bg-[#FAF9F7] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#57534E] mb-1">End date</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DFDBD2] bg-[#FAF9F7] text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* 7 Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: 'Total Orders', value: String(summary.totalOrders) },
          { label: 'Total Sales', value: formatCurrency(summary.totalSales, settings.currency) },
          { label: 'Total Collected', value: formatCurrency(summary.totalCollected, settings.currency) },
          { label: 'Total Outstanding', value: formatCurrency(summary.totalOutstanding, settings.currency) },
          { label: 'Completed Sales', value: formatCurrency(summary.completedSales, settings.currency) },
          { label: 'Cancelled Orders', value: String(summary.cancelledOrders) },
          { label: 'Returned Orders', value: String(summary.returnedOrders) },
        ].map((metric) => (
          <div
            key={metric.label}
            className="bg-white border border-[#E8E5DF] rounded-2xl p-4 sm:p-5"
          >
            <p className="text-xs font-medium text-[#57534E]">{metric.label}</p>
            <p className="mt-2 text-lg sm:text-2xl font-semibold font-mono tabular-nums text-[#141413] truncate">
              {metric.value}
            </p>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Platform Breakdown Chart */}
        <section className="bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#141413]">Sales by Platform</h2>
            <span className="text-xs text-[#78716C]">Active orders</span>
          </div>

          <div className="space-y-4">
            {platformBreakdown.map((item) => {
              const widthPct = Math.round((item.sales / maxPlatformSales) * 100);
              return (
                <div key={item.platform} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-[#141413]">
                      {item.platform}{' '}
                      <span className="text-xs font-normal text-[#78716C] tabular-nums">
                        ({item.count} {item.count === 1 ? 'order' : 'orders'})
                      </span>
                    </span>
                    <span className="font-mono text-xs sm:text-sm font-semibold text-[#141413] tabular-nums">
                      {formatCurrency(item.sales, settings.currency)}
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-[#F1EFEA] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#141413] transition-all duration-300"
                      style={{ width: `${item.sales > 0 ? Math.max(4, widthPct) : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Order Status Breakdown SVG Chart */}
        <section className="bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#141413]">Orders by Status</h2>
            <span className="text-xs text-[#78716C] tabular-nums">{scopedOrders.length} total</span>
          </div>

          <div className="space-y-3">
            {statusBreakdown.map((item) => {
              const widthPct = Math.round((item.count / maxStatusCount) * 100);
              return (
                <div key={item.status} className="grid grid-cols-12 items-center gap-2 text-xs">
                  <span className="col-span-4 font-semibold text-[#141413] truncate">
                    {item.status}
                  </span>
                  <div className="col-span-6 h-2.5 rounded-full bg-[#F1EFEA] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${item.count > 0 ? Math.max(4, widthPct) : 0}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                  <span className="col-span-2 text-right font-mono font-semibold text-[#141413] tabular-nums">
                    {item.count}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Payment Type Breakdown */}
        <section className="bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#141413]">Payment Type Breakdown</h2>
            <span className="text-xs text-[#78716C]">Count & collected</span>
          </div>

          <div className="space-y-3.5">
            {paymentBreakdown.map((item) => {
              const pct = Math.round((item.count / maxPaymentCount) * 100);
              return (
                <div key={item.value} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
                    <span className="font-medium text-[#141413] truncate">{item.label}</span>
                    <span className="font-mono text-xs text-[#57534E] tabular-nums shrink-0">
                      {item.count} · {formatCurrency(item.collected, settings.currency)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#F1EFEA] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#57534E] transition-all duration-300"
                      style={{ width: `${item.count > 0 ? Math.max(4, pct) : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Top Products */}
        <section className="bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#141413]">Breakdown by Product</h2>
            <span className="text-xs text-[#78716C]">Top pieces</span>
          </div>

          {productBreakdown.length === 0 ? (
            <p className="text-sm text-[#78716C] py-6 text-center">
              No active product sales in this date range.
            </p>
          ) : (
            <div className="divide-y divide-[#ECE9E2]">
              {productBreakdown.map((prod) => (
                <div
                  key={prod.name}
                  className="py-2.5 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-[#141413] truncate">{prod.name}</p>
                    <p className="text-xs text-[#78716C] tabular-nums">
                      {prod.count} {prod.count === 1 ? 'order' : 'orders'}
                    </p>
                  </div>
                  <span className="font-mono text-xs sm:text-sm font-semibold text-[#141413] tabular-nums shrink-0">
                    {formatCurrency(prod.sales, settings.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
