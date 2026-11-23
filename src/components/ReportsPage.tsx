import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DateRangePreset, Order, StoreSettings } from '../types/order';
import { downloadOrdersCsv } from '../utils/csv';
import { DATE_PRESET_LABELS, getDateRangeBounds } from '../utils/date';
import {
  ORDER_STATUSES,
  ORDER_STATUS_META,
  formatCurrency,
  parseAmountNumber,
} from '../utils/payment';

interface ReportsPageProps {
  orders: Order[];
  settings: StoreSettings;
  onNotify?: (text: string) => void;
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

export function ReportsPage({ orders, settings, onNotify }: ReportsPageProps) {
  const [datePreset, setDatePreset] = useState<DateRangePreset>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [hoveredDayKey, setHoveredDayKey] = useState<string | null>(null);

  const scopedOrders = useMemo(() => {
    const { start, end } = getDateRangeBounds(datePreset, customStart, customEnd);
    return orders.filter((order) => {
      if (start && order.createdAt < start) return false;
      if (end && order.createdAt > end) return false;
      return true;
    });
  }, [orders, datePreset, customStart, customEnd]);

  const summary = useMemo(() => {
    const totalOrders = scopedOrders.length;
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
      const orderTotal = parseAmountNumber(o.totalAmount);
      const orderPaid = parseAmountNumber(o.paidAmount);
      const orderRemaining = parseAmountNumber(o.remainingAmount);

      totalSales += orderTotal;
      totalCollected += orderPaid;
      totalOutstanding += orderRemaining;
      if (o.status === 'COMPLETED') {
        completedSales += orderTotal;
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

  const dailyTrend = useMemo(() => {
    const map = new Map<string, { key: string; label: string; sales: number; count: number }>();
    for (const o of scopedOrders) {
      if (o.status === 'CANCELLED' || o.status === 'RETURNED') continue;
      const d = o.createdAt;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const orderTotal = parseAmountNumber(o.totalAmount);
      const prev = map.get(key);
      if (prev) {
        prev.sales += orderTotal;
        prev.count += 1;
      } else {
        map.set(key, { key, label, sales: orderTotal, count: 1 });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-14);
  }, [scopedOrders]);

  const maxDailySales = Math.max(1, ...dailyTrend.map((d) => d.sales));
  const activeDay =
    (hoveredDayKey ? dailyTrend.find((d) => d.key === hoveredDayKey) : null) ||
    dailyTrend[dailyTrend.length - 1] ||
    null;

  const statusBreakdown = useMemo(() => {
    return ORDER_STATUSES.map((status) => {
      const matching = scopedOrders.filter((o) => o.status === status);
      return {
        status,
        count: matching.length,
        sales: matching.reduce((acc, o) => acc + parseAmountNumber(o.totalAmount), 0),
        color: ORDER_STATUS_META[status].barColor,
      };
    });
  }, [scopedOrders]);

  const maxStatusCount = Math.max(1, ...statusBreakdown.map((s) => s.count));

  const productBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; count: number; sales: number }>();
    for (const o of scopedOrders) {
      if (o.status === 'CANCELLED' || o.status === 'RETURNED') continue;
      const displayName = o.productName.trim() || 'Untitled piece';
      const key = displayName.toLowerCase();
      const orderTotal = parseAmountNumber(o.totalAmount);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.sales += orderTotal;
      } else {
        map.set(key, { name: displayName, count: 1, sales: orderTotal });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 10);
  }, [scopedOrders]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#8C877E]">
            {DATE_PRESET_LABELS[datePreset]} · {scopedOrders.length} orders in range
          </p>
          <h1 className="mt-1 text-3xl sm:text-4xl font-display font-semibold tracking-tight text-[#121211]">
            Reports & Analytics
          </h1>
        </div>

        <button
          type="button"
          disabled={scopedOrders.length === 0}
          onClick={() => {
            downloadOrdersCsv(scopedOrders, `shishu-clo-report-${datePreset}`);
            onNotify?.(`Exported ${scopedOrders.length} report rows to CSV`);
          }}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-[#121211] text-[#F7F5F0] hover:bg-[#272624] disabled:opacity-50 text-xs sm:text-sm font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Export Report CSV</span>
        </button>
      </div>

      {/* Date Range Selector */}
      <div className="bg-white border border-[#E6E2D8] rounded-2xl p-4 space-y-3">
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
                    ? 'bg-[#121211] text-[#F7F5F0]'
                    : 'bg-[#FAF9F5] text-[#5C5852] hover:bg-[#EFECE5] hover:text-[#121211]'
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
              <label className="block text-xs font-medium text-[#5C5852] mb-1">Start date</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5C5852] mb-1">End date</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] text-sm"
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
            className="bg-white border border-[#E6E2D8] rounded-2xl p-4 sm:p-5"
          >
            <p className="text-xs font-medium text-[#5C5852]">{metric.label}</p>
            <p className="mt-2 text-lg sm:text-2xl font-semibold font-mono tabular-nums text-[#121211] truncate">
              {metric.value}
            </p>
          </div>
        ))}
      </div>

      {/* Daily Sales Trend SVG Bar Chart */}
      {dailyTrend.length > 0 && (
        <section className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[#121211]">Daily Sales Trend</h2>
              <p className="text-xs text-[#8C877E]">
                Active order volume across recent days in range
              </p>
            </div>
            {activeDay && (
              <div className="text-left sm:text-right">
                <p className="text-xs font-medium text-[#5C5852]">
                  {activeDay.label} · {activeDay.count}{' '}
                  {activeDay.count === 1 ? 'order' : 'orders'}
                </p>
                <p className="font-mono text-sm font-semibold text-[#121211] tabular-nums">
                  {formatCurrency(activeDay.sales, settings.currency)}
                </p>
              </div>
            )}
          </div>

          <div className="w-full overflow-x-auto no-scrollbar pt-2">
            <div className="min-w-[360px]">
              <svg
                viewBox={`0 0 ${Math.max(dailyTrend.length * 46, 320)} 150`}
                className="w-full h-40 overflow-visible"
                role="img"
                aria-label="Daily sales bar chart"
              >
                <line
                  x1="0"
                  y1="120"
                  x2={Math.max(dailyTrend.length * 46, 320)}
                  y2="120"
                  stroke="#ECE9E2"
                  strokeWidth="1"
                />
                {dailyTrend.map((d, idx) => {
                  const totalWidth = Math.max(dailyTrend.length * 46, 320);
                  const slotWidth = totalWidth / dailyTrend.length;
                  const barWidth = Math.min(28, slotWidth * 0.56);
                  const x = idx * slotWidth + (slotWidth - barWidth) / 2;
                  const barHeight = Math.max(6, Math.round((d.sales / maxDailySales) * 104));
                  const y = 120 - barHeight;
                  const isHighlighted = activeDay?.key === d.key;

                  return (
                    <g
                      key={d.key}
                      onMouseEnter={() => setHoveredDayKey(d.key)}
                      onClick={() => setHoveredDayKey(d.key)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={x}
                        y={y}
                        width={barWidth}
                        height={barHeight}
                        rx="6"
                        fill={isHighlighted ? '#121211' : '#CFCAC0'}
                        className="transition-colors duration-150"
                      />
                      <text
                        x={x + barWidth / 2}
                        y="138"
                        textAnchor="middle"
                        fontSize="10"
                        fill={isHighlighted ? '#121211' : '#8C877E'}
                        fontWeight={isHighlighted ? '600' : '400'}
                      >
                        {d.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </section>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Order Status Breakdown Chart */}
        <section className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#121211]">Orders by Status</h2>
            <span className="text-xs text-[#8C877E] tabular-nums">{scopedOrders.length} total</span>
          </div>

          <div className="space-y-3">
            {statusBreakdown.map((item) => {
              const widthPct = Math.round((item.count / maxStatusCount) * 100);
              return (
                <div key={item.status} className="grid grid-cols-12 items-center gap-2 text-xs">
                  <span className="col-span-4 font-semibold text-[#121211] truncate">
                    {item.status}
                  </span>
                  <div className="col-span-6 h-2.5 rounded-full bg-[#EFECE5] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${item.count > 0 ? Math.max(4, widthPct) : 0}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                  <span className="col-span-2 text-right font-mono font-semibold text-[#121211] tabular-nums">
                    {item.count}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Top Products */}
        <section className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#121211]">Breakdown by Product</h2>
            <span className="text-xs text-[#8C877E]">Top pieces</span>
          </div>

          {productBreakdown.length === 0 ? (
            <p className="text-sm text-[#8C877E] py-6 text-center">
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
                    <p className="font-medium text-[#121211] truncate">{prod.name}</p>
                    <p className="text-xs text-[#8C877E] tabular-nums">
                      {prod.count} {prod.count === 1 ? 'order' : 'orders'}
                    </p>
                  </div>
                  <span className="font-mono text-xs sm:text-sm font-semibold text-[#121211] tabular-nums shrink-0">
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
