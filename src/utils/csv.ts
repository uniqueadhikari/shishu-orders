import type { Order } from '../types/order';
import { formatDateTime } from './date';

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  const sanitized = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (/[",\n\r]/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

export function buildOrdersCsv(orders: Order[]): string {
  const headers = [
    'Order number',
    'Date',
    'Customer',
    'Phone',
    'Contact',
    'Product',
    'Size',
    'Color',
    'Total',
    'Paid',
    'Remaining',
    'Status',
    'Notes',
  ];

  const rows = orders.map((order) => [
    order.orderNumber,
    formatDateTime(order.createdAt),
    order.customerName,
    order.phone,
    order.socialContact,
    order.productName,
    order.size,
    order.color,
    order.totalAmount,
    order.paidAmount,
    order.remainingAmount,
    order.status,
    order.notes,
  ]);

  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];

  return '\uFEFF' + lines.join('\r\n');
}

export function downloadOrdersCsv(orders: Order[], filenamePrefix = 'shishu-clo-orders'): void {
  const csvContent = buildOrdersCsv(orders);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filenamePrefix}-${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
