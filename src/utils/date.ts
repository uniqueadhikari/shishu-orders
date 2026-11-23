import type { DateRangePreset } from '../types/order';

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function isTodayDate(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function getDateRangeBounds(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string
): { start: Date | null; end: Date | null } {
  const now = new Date();
  switch (preset) {
    case 'all':
      return { start: null, end: null };
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now) };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(now.getDate() - 1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case 'this_week': {
      const start = startOfDay(now);
      const day = start.getDay(); // 0=Sun
      const diff = day === 0 ? 6 : day - 1; // Monday start
      start.setDate(start.getDate() - diff);
      return { start, end: endOfDay(now) };
    }
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start, end: endOfDay(now) };
    }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start, end };
    }
    case 'custom': {
      const start = customStart ? startOfDay(new Date(`${customStart}T00:00:00`)) : null;
      const end = customEnd ? endOfDay(new Date(`${customEnd}T00:00:00`)) : null;
      return {
        start: start && !Number.isNaN(start.getTime()) ? start : null,
        end: end && !Number.isNaN(end.getTime()) ? end : null,
      };
    }
    default:
      return { start: null, end: null };
  }
}

export const DATE_PRESET_LABELS: Record<DateRangePreset, string> = {
  all: 'All time',
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  this_month: 'This month',
  last_month: 'Last month',
  custom: 'Custom range',
};
