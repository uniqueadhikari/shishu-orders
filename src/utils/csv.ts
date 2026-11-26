import { getOrderLineItems } from '../services/orders';
import type { InventoryItem, Order } from '../types/order';
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
    'Color',
    'Size',
    'Qty',
    'Total',
    'Paid',
    'Remaining',
    'Status',
    'Notes',
  ];

  const rows = orders.map((order) => {
    const lineItems = getOrderLineItems(order);
    const productCell =
      lineItems.length > 1
        ? lineItems
            .map((item) => {
              const specs = [item.color, item.size].filter(Boolean).join('/');
              return `${item.productName || 'Piece'}${specs ? ` (${specs})` : ''} ×${item.quantity}`;
            })
            .join('; ')
        : order.productName;
    const totalQty =
      lineItems.length > 0
        ? lineItems.reduce((sum, item) => sum + item.quantity, 0)
        : order.orderQuantity;

    return [
      order.orderNumber,
      formatDateTime(order.createdAt),
      order.customerName,
      order.phone,
      order.socialContact,
      productCell,
      order.color,
      order.size,
      totalQty,
      order.totalAmount,
      order.paidAmount,
      order.remainingAmount,
      order.status,
      order.notes,
    ];
  });

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

export function downloadInventoryCsv(items: InventoryItem[], filenamePrefix = 'shishu-clo-stock'): void {
  const headers = [
    'Piece Name',
    'Color',
    'Size',
    'Quantity',
    'Low Stock Alert',
    'Default Price',
    'Notes',
    'Updated',
  ];

  const rows = items.map((item) => [
    item.pieceName,
    item.color,
    item.size,
    item.quantity,
    item.lowStockThreshold,
    item.unitPrice,
    item.notes,
    formatDateTime(item.updatedAt),
  ]);

  const csvContent =
    '\uFEFF' +
    [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))].join(
      '\r\n'
    );

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
