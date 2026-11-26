import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  Expand,
  Loader2,
  MessageSquare,
  Package,
  Phone,
  Printer,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { getUserFriendlyError } from '../firebase/errors';
import {
  deleteOrder,
  getOrderLineItems,
  markOrderPaidAndComplete,
  updateOrderStatus,
} from '../services/orders';
import type { InventoryItem, Order, OrderStatus, StoreSettings } from '../types/order';
import { formatDateTime } from '../utils/date';
import {
  PAYMENT_TYPE_LABELS,
  formatAmountDisplay,
  hasAmountValue,
  parseAmountNumber,
} from '../utils/payment';
import { ImageLightbox } from './ImageLightbox';
import { OrderPhoto } from './OrderPhoto';
import { StatusBadge } from './StatusBadge';

interface OrderDetailModalProps {
  order: Order;
  orders: Order[];
  inventory: InventoryItem[];
  settings: StoreSettings;
  onClose: () => void;
  onEdit: (order: Order) => void;
  onDeleted: (stockRestored?: boolean, deletedOrderNumber?: string) => void;
  onOpenInventory?: () => void;
  onNotify?: (text: string) => void;
}

const PIPELINE_STEPS: OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'PROCESSING',
  'READY',
  'SHIPPED',
  'COMPLETED',
];

export function OrderDetailModal({
  order,
  orders,
  inventory,
  settings,
  onClose,
  onEdit,
  onDeleted,
  onOpenInventory,
  onNotify,
}: OrderDetailModalProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [settlingPaid, setSettlingPaid] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedDm, setCopiedDm] = useState(false);
  const [copiedOrderNum, setCopiedOrderNum] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentStepIdx = PIPELINE_STEPS.indexOf(order.status);
  const lineItems = useMemo(() => getOrderLineItems(order), [order]);
  const totalUnitQty = useMemo(
    () =>
      lineItems.length > 0
        ? lineItems.reduce((sum, item) => sum + item.quantity, 0)
        : order.orderQuantity || 1,
    [lineItems, order.orderQuantity]
  );

  const connectedStockEntries = useMemo(() => {
    const map = new Map<string, { qty: number; deducted: boolean }>();
    for (const li of lineItems) {
      if (!li.inventoryItemId) continue;
      const prev = map.get(li.inventoryItemId);
      map.set(li.inventoryItemId, {
        qty: (prev?.qty ?? 0) + li.quantity,
        deducted: Boolean(prev?.deducted || li.stockDeducted),
      });
    }
    return Array.from(map.entries()).map(([id, info]) => ({
      id,
      qty: info.qty,
      deducted: info.deducted,
      item: inventory.find((inv) => inv.id === id) ?? null,
    }));
  }, [lineItems, inventory]);

  const totalNum = parseAmountNumber(order.totalAmount);
  const paidNum = parseAmountNumber(order.paidAmount);
  const hasRemainingBalance =
    parseAmountNumber(order.remainingAmount) > 0 ||
    (hasAmountValue(order.totalAmount) &&
      (totalNum > 0
        ? paidNum + 0.001 < totalNum
        : String(order.paidAmount).trim() !== String(order.totalAmount).trim()));
  const canSettlePaidAndComplete =
    order.status !== 'CANCELLED' &&
    order.status !== 'RETURNED' &&
    (hasRemainingBalance || order.status !== 'COMPLETED');

  async function handleStatusChange(nextStatus: OrderStatus) {
    if (nextStatus === order.status) return;
    setError(null);
    setStatusBusy(true);
    try {
      const result = await updateOrderStatus(order.id, nextStatus);
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
      onNotify?.(`${order.orderNumber} updated to ${nextStatus}${stockSuffix}`);
    } catch (err) {
      setError(getUserFriendlyError(err, 'Could not update status.'));
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleMarkPaidAndComplete() {
    setError(null);
    setSettlingPaid(true);
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
      setError(getUserFriendlyError(err, 'Could not settle payment.'));
    } finally {
      setSettlingPaid(false);
    }
  }

  async function handleConfirmDelete() {
    setError(null);
    setDeleting(true);
    try {
      const orderNum = order.orderNumber;
      const result = await deleteOrder(order, orders, inventory);
      onDeleted(result.stockRestored, orderNum);
    } catch (err) {
      setError(getUserFriendlyError(err, 'Could not delete this order.'));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleCopyDmSummary() {
    const brand = settings.brandName || 'Shishu.clo';
    const pieceLines =
      lineItems.length > 1
        ? lineItems.map((li, idx) => {
            const specs = [li.size ? `Size ${li.size}` : '', li.color || '']
              .filter(Boolean)
              .join(' · ');
            return `${idx + 1}. ${li.productName || 'Piece'}${specs ? ` (${specs})` : ''} ×${li.quantity}`;
          })
        : [
            (() => {
              const pieceDetails = [
                order.size ? `Size ${order.size}` : '',
                order.color || '',
              ]
                .filter(Boolean)
                .join(' · ');
              if (order.productName) {
                return `Piece: ${order.productName}${totalUnitQty > 1 ? ` ×${totalUnitQty}` : ''}${pieceDetails ? ` (${pieceDetails})` : ''}`;
              }
              return pieceDetails
                ? `Details: ${pieceDetails}${totalUnitQty > 1 ? ` ×${totalUnitQty}` : ''}`
                : '';
            })(),
          ];

    const lines = [
      `Thank you for ordering with ${brand}!`,
      `Order: ${order.orderNumber}`,
      ...pieceLines,
      hasAmountValue(order.totalAmount)
        ? `Total: ${formatAmountDisplay(order.totalAmount, settings.currency)}`
        : '',
      hasAmountValue(order.paidAmount)
        ? `Paid: ${formatAmountDisplay(order.paidAmount, settings.currency)}`
        : '',
      hasAmountValue(order.remainingAmount)
        ? `Remaining: ${formatAmountDisplay(order.remainingAmount, settings.currency)}`
        : '',
      `Current Status: ${order.status}`,
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedDm(true);
      onNotify?.('Order summary copied');
      window.setTimeout(() => setCopiedDm(false), 1800);
    } catch {
      // ignore if clipboard blocked
    }
  }

  async function handleCopyOrderNumber() {
    try {
      await navigator.clipboard.writeText(order.orderNumber);
      setCopiedOrderNum(true);
      onNotify?.(`Copied ${order.orderNumber}`);
      window.setTimeout(() => setCopiedOrderNum(false), 1500);
    } catch {
      // ignore if clipboard blocked
    }
  }

  const headerTags = [
    order.size ? `Size ${order.size}` : '',
    order.color || '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Top Action Bar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-[#E6E2D8] bg-white hover:bg-[#F7F5F0] flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Back to orders"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={handleCopyOrderNumber}
                className="inline-flex items-center gap-1.5 text-xl sm:text-2xl font-mono font-semibold text-[#121211] tabular-nums hover:opacity-80 cursor-pointer"
                title="Copy order number"
              >
                <span>{order.orderNumber}</span>
                {copiedOrderNum ? (
                  <Check className="w-4 h-4 text-emerald-700" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#8C877E]" />
                )}
              </button>
              <StatusBadge
                status={order.status}
                onChange={handleStatusChange}
                disabled={statusBusy}
              />
            </div>
            <p className="text-xs text-[#8C877E] mt-0.5">
              Created {formatDateTime(order.createdAt)} · Updated {formatDateTime(order.updatedAt)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {canSettlePaidAndComplete && (
            <button
              type="button"
              disabled={settlingPaid || statusBusy}
              onClick={handleMarkPaidAndComplete}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-60 cursor-pointer"
            >
              {settlingPaid ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              <span>{hasRemainingBalance ? 'Mark Paid & Complete' : 'Mark Completed'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyDmSummary}
            className="min-h-[42px] px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] text-xs sm:text-sm font-medium text-[#121211] flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {copiedDm ? (
              <Check className="w-4 h-4 text-emerald-700" />
            ) : (
              <MessageSquare className="w-4 h-4" />
            )}
            <span>{copiedDm ? 'Copied DM' : 'Copy DM'}</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[42px] px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] text-xs sm:text-sm font-medium text-[#121211] flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">Print Slip</span>
          </button>

          <button
            type="button"
            onClick={() => onEdit(order)}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#121211] text-[#F7F5F0] hover:bg-[#272624] text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Edit3 className="w-4 h-4" />
            <span>Edit</span>
          </button>

          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="min-h-[42px] px-3.5 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs sm:text-sm font-medium text-rose-800 flex items-center gap-1.5 transition-colors cursor-pointer"
            aria-label="Delete order"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Delete</span>
          </button>
        </div>
      </div>

      {/* Interactive Fulfillment Stepper */}
      <div className="no-print bg-white border border-[#E6E2D8] rounded-2xl p-4">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8C877E]">
            Fulfillment Stage
          </span>
          {(order.status === 'CANCELLED' || order.status === 'RETURNED') && (
            <span className="text-xs font-semibold text-rose-700">
              Marked as {order.status}
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {PIPELINE_STEPS.map((step, idx) => {
            const isCurrent = order.status === step;
            const isPast = currentStepIdx >= 0 && idx < currentStepIdx;
            return (
              <button
                key={step}
                type="button"
                disabled={statusBusy}
                onClick={() => handleStatusChange(step)}
                className={`min-h-[38px] px-2 py-1.5 rounded-xl border text-[11px] font-semibold tracking-wide transition-all cursor-pointer disabled:opacity-60 ${
                  isCurrent
                    ? 'bg-[#121211] text-[#F7F5F0] border-[#121211]'
                    : isPast
                      ? 'bg-[#EFECE5] text-[#121211] border-[#DDD8CE] hover:border-[#121211]/40'
                      : 'bg-[#FAF9F5] text-[#8C877E] border-[#E6E2D8] hover:text-[#121211] hover:border-[#C9C3B6]'
                }`}
              >
                {step}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="no-print rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      )}

      {/* Print Header */}
      <div className="hidden print-only border-b border-stone-300 pb-4 mb-4">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="font-display text-2xl font-semibold tracking-wider">
              {settings.brandName.toUpperCase()}
            </p>
            <p className="text-xs text-stone-600 mt-1">Order Packing Slip & Summary</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-semibold">{order.orderNumber}</p>
            <p className="text-xs text-stone-600">{formatDateTime(order.createdAt)}</p>
          </div>
        </div>
      </div>

      {/* Main Detail Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[#8C877E]">Piece / Product</p>
                <h2 className="text-xl sm:text-2xl font-display font-semibold text-[#121211] mt-0.5">
                  {order.productName || '—'}
                </h2>
              </div>
              {headerTags && (
                <div className="text-right text-sm text-[#5C5852] shrink-0">{headerTags}</div>
              )}
            </div>

            {order.photos.length > 0 && (
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => setLightboxIdx(0)}
                  className="group relative w-full aspect-[4/3] sm:aspect-[16/10] rounded-xl overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] cursor-pointer flex items-center justify-center"
                >
                  <OrderPhoto
                    src={order.photos[0]}
                    alt={`${order.productName || order.orderNumber} primary reference`}
                    lazy={false}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                  />
                  <span className="no-print absolute bottom-3 right-3 px-2.5 py-1.5 rounded-lg bg-black/70 text-white text-xs font-medium flex items-center gap-1.5 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <Expand className="w-3.5 h-3.5" />
                    <span>View full size</span>
                  </span>
                </button>

                {order.photos.length > 1 && (
                  <div className="grid grid-cols-2 gap-2.5">
                    {order.photos.slice(1).map((url, idx) => (
                      <button
                        key={`${url}-${idx + 1}`}
                        type="button"
                        onClick={() => setLightboxIdx(idx + 1)}
                        className="group relative aspect-square rounded-xl overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] cursor-pointer flex items-center justify-center"
                      >
                        <OrderPhoto
                          src={url}
                          alt={`${order.productName || order.orderNumber} reference ${idx + 2}`}
                          lazy={false}
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                        />
                        <span className="no-print absolute bottom-2 right-2 w-8 h-8 rounded-lg bg-black/65 text-white flex items-center justify-center opacity-85 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                          <Expand className="w-4 h-4" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="pt-3 border-t border-[#ECE9E2] grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-[#8C877E]">Size</p>
                <p className="font-medium text-[#121211] mt-0.5">{order.size || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-[#8C877E]">Color</p>
                <p className="font-medium text-[#121211] mt-0.5">{order.color || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-[#8C877E]">Total Units</p>
                <p className="font-mono font-medium text-[#121211] tabular-nums mt-0.5">
                  {totalUnitQty}
                  {connectedStockEntries.length > 0 && (
                    <span className="block text-[11px] font-sans text-[#5C5852]">
                      {order.stockDeducted ? 'Deducted from stock' : 'Stock not deducted'}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {lineItems.length > 1 && (
              <div className="pt-3 border-t border-[#ECE9E2] space-y-2">
                <p className="text-xs font-medium text-[#8C877E]">
                  Pieces in this order ({lineItems.length})
                </p>
                <div className="divide-y divide-[#ECE9E2] border border-[#E6E2D8] rounded-xl overflow-hidden bg-[#FAF9F5]">
                  {lineItems.map((li, idx) => (
                    <div
                      key={`${li.productName}-${li.color}-${idx}`}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-[#121211] truncate">
                          {idx + 1}. {li.productName || 'Untitled piece'}
                        </p>
                        <p className="text-xs text-[#5C5852] truncate">
                          {[
                            li.color,
                            li.size ? `Size ${li.size}` : '',
                            li.inventoryItemId
                              ? li.stockDeducted
                                ? 'Stock deducted'
                                : 'Stock restored'
                              : 'Custom piece',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <div className="text-right shrink-0 font-mono text-xs tabular-nums">
                        <p className="font-semibold text-[#121211]">×{li.quantity}</p>
                        {li.unitPrice && (
                          <p className="text-[#5C5852]">
                            {formatAmountDisplay(li.unitPrice, settings.currency)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {order.notes && (
              <div className="pt-3 border-t border-[#ECE9E2]">
                <p className="text-xs text-[#8C877E]">Special Notes</p>
                <p className="text-sm text-[#121211] mt-1 whitespace-pre-wrap leading-relaxed">
                  {order.notes}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#121211]">Customer Details</h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-[#8C877E]">Customer Name</p>
                <p className="font-medium text-[#121211] mt-0.5">{order.customerName || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-[#8C877E]">Phone</p>
                {order.phone ? (
                  <a
                    href={`tel:${order.phone}`}
                    className="mt-0.5 inline-flex items-center gap-1.5 font-mono tabular-nums font-medium text-[#121211] hover:underline"
                  >
                    <Phone className="w-3.5 h-3.5 text-[#8C877E]" />
                    {order.phone}
                  </a>
                ) : (
                  <p className="font-medium text-[#121211] mt-0.5">—</p>
                )}
              </div>
              <div>
                <p className="text-xs text-[#8C877E]">Contact / Username</p>
                <p className="font-medium text-[#121211] mt-0.5">
                  {order.socialContact || '—'}
                </p>
              </div>
              {order.deliveryArea && (
                <div>
                  <p className="text-xs text-[#8C877E]">Delivery Area</p>
                  <p className="font-medium text-[#121211] mt-0.5">{order.deliveryArea}</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-3">
            <h3 className="text-sm font-semibold text-[#121211]">Payment Breakdown</h3>
            {order.paymentType && (
              <p className="text-xs text-[#5C5852]">
                {PAYMENT_TYPE_LABELS[order.paymentType] || order.paymentType}
              </p>
            )}

            <div className="pt-1 space-y-2 text-sm">
              {hasAmountValue(order.productAmount) && (
                <div className="flex justify-between text-[#5C5852]">
                  <span>Product price</span>
                  <span className="font-mono tabular-nums text-[#121211]">
                    {formatAmountDisplay(order.productAmount, settings.currency)}
                  </span>
                </div>
              )}
              {hasAmountValue(order.deliveryCharge) && (
                <div className="flex justify-between text-[#5C5852]">
                  <span>Delivery{order.deliveryArea ? ` (${order.deliveryArea})` : ''}</span>
                  <span className="font-mono tabular-nums text-[#121211]">
                    {formatAmountDisplay(order.deliveryCharge, settings.currency)}
                  </span>
                </div>
              )}
              <div
                className={`${
                  hasAmountValue(order.productAmount) || hasAmountValue(order.deliveryCharge)
                    ? 'border-t border-dashed border-[#D8D3C8] pt-2.5'
                    : ''
                } flex justify-between font-semibold text-[#121211]`}
              >
                <span>Total</span>
                <span className="font-mono tabular-nums">
                  {formatAmountDisplay(order.totalAmount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between text-emerald-800 font-medium">
                <span>Paid</span>
                <span className="font-mono tabular-nums">
                  {formatAmountDisplay(order.paidAmount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between text-amber-900 font-semibold">
                <span>Remaining</span>
                <span className="font-mono tabular-nums">
                  {formatAmountDisplay(order.remainingAmount, settings.currency)}
                </span>
              </div>
            </div>

            {canSettlePaidAndComplete && (
              <button
                type="button"
                disabled={settlingPaid || statusBusy}
                onClick={handleMarkPaidAndComplete}
                className="no-print mt-2 w-full min-h-[42px] px-4 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs sm:text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer"
              >
                {settlingPaid ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                <span>
                  {hasRemainingBalance
                    ? 'Settle Remaining COD & Complete'
                    : 'Mark Order Completed'}
                </span>
              </button>
            )}
          </div>

          {connectedStockEntries.length > 0 && (
            <div className="no-print bg-white border border-[#E6E2D8] rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-[#5C5852]" />
                  <h3 className="text-sm font-semibold text-[#121211]">
                    Connected Inventory ({connectedStockEntries.length})
                  </h3>
                </div>
                {onOpenInventory && (
                  <button
                    type="button"
                    onClick={onOpenInventory}
                    className="text-xs font-medium text-[#5C5852] hover:text-[#121211] underline underline-offset-2 cursor-pointer"
                  >
                    Open Inventory
                  </button>
                )}
              </div>

              <div className="divide-y divide-[#ECE9E2] space-y-2.5">
                {connectedStockEntries.map(({ id, qty, deducted, item }) =>
                  item ? (
                    <div key={id} className="flex items-center gap-3 pt-2 first:pt-0">
                      <div className="w-11 h-11 rounded-xl overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] shrink-0 flex items-center justify-center">
                        <OrderPhoto
                          src={item.photoUrl}
                          alt={item.pieceName}
                          className="w-full h-full object-cover"
                          iconClassName="w-4 h-4 text-[#8C877E]"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[#121211] truncate">
                          {item.pieceName}
                        </p>
                        <p className="text-xs text-[#5C5852] truncate">
                          {[item.color || 'No color', item.size ? `Size ${item.size}` : '']
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        <p className="text-xs mt-1 font-mono tabular-nums">
                          <span
                            className={
                              item.quantity <= 0
                                ? 'text-rose-700 font-semibold'
                                : item.quantity <= item.lowStockThreshold
                                  ? 'text-amber-800 font-semibold'
                                  : 'text-emerald-800 font-semibold'
                            }
                          >
                            {item.quantity} in stock now
                          </span>
                          <span className="text-[#8C877E] font-sans">
                            {' '}
                            · {deducted ? `Deducted ×${qty}` : 'Restored / not deducted'}
                          </span>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p key={id} className="text-xs text-[#8C877E] pt-2 first:pt-0">
                      Stock piece removed from inventory (
                      {deducted ? `deducted ×${qty}` : 'restored / not deducted'}).
                    </p>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div
          className="no-print fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-w-sm w-full bg-white border border-[#E6E2D8] rounded-2xl p-6 space-y-4 shadow-xl">
            <h3 className="text-lg font-display font-semibold text-[#121211]">
              Delete {order.orderNumber}?
            </h3>
            <p className="text-sm text-[#5C5852] leading-relaxed">
              This permanently removes the order
              {order.customerName ? (
                <>
                  {' '}
                  for <span className="font-medium text-[#121211]">{order.customerName}</span>
                </>
              ) : null}{' '}
              and deletes its reference photos.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-[#DDD8CE] text-sm font-medium text-[#5C5852] hover:bg-[#F7F5F0] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60 cursor-pointer"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{deleting ? 'Deleting...' : 'Delete Order'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxIdx !== null && (
        <ImageLightbox
          images={order.photos}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onSelectIndex={setLightboxIdx}
          title={`${order.orderNumber}${order.productName ? ` · ${order.productName}` : ''}`}
        />
      )}
    </div>
  );
}
