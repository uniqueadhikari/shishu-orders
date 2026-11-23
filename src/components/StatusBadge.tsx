import { ChevronDown } from 'lucide-react';
import type { OrderStatus } from '../types/order';
import { ORDER_STATUSES, ORDER_STATUS_META } from '../utils/payment';

interface StatusBadgeProps {
  status: OrderStatus;
  onChange?: (next: OrderStatus) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function StatusBadge({ status, onChange, disabled, compact }: StatusBadgeProps) {
  const meta = ORDER_STATUS_META[status] || ORDER_STATUS_META.NEW;

  if (!onChange) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold tracking-wide whitespace-nowrap shrink-0 ${meta.badgeClass}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} aria-hidden="true" />
        {meta.label}
      </span>
    );
  }

  return (
    <div className="relative inline-flex items-center shrink-0">
      <span
        className={`w-1.5 h-1.5 rounded-full absolute left-2.5 pointer-events-none ${meta.dotClass}`}
        aria-hidden="true"
      />
      <select
        aria-label="Order status"
        value={status}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value as OrderStatus)}
        className={`appearance-none rounded-lg border pl-5 pr-7 font-semibold tracking-wide cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#141413]/20 disabled:opacity-60 transition-colors ${
          compact ? 'py-1 text-xs min-h-[32px]' : 'py-1.5 text-xs min-h-[38px]'
        } ${meta.badgeClass}`}
      >
        {ORDER_STATUSES.map((st) => (
          <option key={st} value={st} className="bg-white text-[#141413]">
            {st}
          </option>
        ))}
      </select>
      <ChevronDown
        className="w-3.5 h-3.5 absolute right-2 pointer-events-none opacity-70"
        aria-hidden="true"
      />
    </div>
  );
}
