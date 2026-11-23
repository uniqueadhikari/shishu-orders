import {
  ArrowLeft,
  Check,
  Copy,
  Edit3,
  Expand,
  Loader2,
  MessageSquare,
  Phone,
  Printer,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { getUserFriendlyError } from '../firebase/errors';
import { deleteOrder, updateOrderStatus } from '../services/orders';
import type { Order, OrderStatus, StoreSettings } from '../types/order';
import { formatDateTime } from '../utils/date';
import { PAYMENT_TYPE_LABELS, formatCurrency } from '../utils/payment';
import { ImageLightbox } from './ImageLightbox';
import { OrderPhoto } from './OrderPhoto';
import { PlatformIcon } from './PlatformIcon';
import { StatusBadge } from './StatusBadge';

interface OrderDetailModalProps {
  order: Order;
  settings: StoreSettings;
  onClose: () => void;
  onEdit: (order: Order) => void;
  onDeleted: () => void;
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
  settings,
  onClose,
  onEdit,
  onDeleted,
  onNotify,
}: OrderDetailModalProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedDm, setCopiedDm] = useState(false);
  const [copiedOrderNum, setCopiedOrderNum] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentStepIdx = PIPELINE_STEPS.indexOf(order.status);

  async function handleStatusChange(nextStatus: OrderStatus) {
    if (nextStatus === order.status) return;
    setError(null);
    setStatusBusy(true);
    try {
      await updateOrderStatus(order.id, nextStatus);
      onNotify?.(`${order.orderNumber} updated to ${nextStatus}`);
    } catch (err) {
      setError(getUserFriendlyError(err, 'Could not update status.'));
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleConfirmDelete() {
    setError(null);
    setDeleting(true);
    try {
      await deleteOrder(order);
      onDeleted();
    } catch (err) {
      setError(getUserFriendlyError(err, 'Could not delete this order.'));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleCopyDmSummary() {
    const brand = settings.brandName || 'Shishu.clo';
    const lines = [
      `Thank you for ordering with ${brand}!`,
      `Order: ${order.orderNumber}`,
      `Piece: ${order.productName} (Size ${order.size} · ${order.color})`,
      `Delivery: ${order.deliveryArea} (${formatCurrency(order.deliveryCharge, settings.currency)})`,
      `Total: ${formatCurrency(order.totalAmount, settings.currency)}`,
      `Paid: ${formatCurrency(order.paidAmount, settings.currency)}`,
      order.remainingAmount > 0
        ? `Remaining (COD): ${formatCurrency(order.remainingAmount, settings.currency)}`
        : 'Payment Status: Fully Paid',
      `Current Status: ${order.status}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedDm(true);
      onNotify?.('DM confirmation message copied');
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
                  {order.productName}
                </h2>
              </div>
              <div className="text-right text-sm text-[#5C5852] shrink-0">
                <span>Size {order.size}</span>
                <span aria-hidden="true"> · </span>
                <span>{order.color}</span>
              </div>
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
                    alt={`${order.productName} primary reference`}
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
                          alt={`${order.productName} reference ${idx + 2}`}
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

            <div className="pt-3 border-t border-[#ECE9E2] grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-[#8C877E]">Size</p>
                <p className="font-medium text-[#121211] mt-0.5">{order.size}</p>
              </div>
              <div>
                <p className="text-xs text-[#8C877E]">Color</p>
                <p className="font-medium text-[#121211] mt-0.5">{order.color}</p>
              </div>
            </div>

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
            <h3 className="text-sm font-semibold text-[#121211]">Customer & Source</h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-[#8C877E]">Customer Name</p>
                <p className="font-medium text-[#121211] mt-0.5">{order.customerName}</p>
              </div>
              <div>
                <p className="text-xs text-[#8C877E]">Phone</p>
                <a
                  href={`tel:${order.phone}`}
                  className="mt-0.5 inline-flex items-center gap-1.5 font-mono tabular-nums font-medium text-[#121211] hover:underline"
                >
                  <Phone className="w-3.5 h-3.5 text-[#8C877E]" />
                  {order.phone}
                </a>
              </div>
              <div>
                <p className="text-xs text-[#8C877E]">Social Source</p>
                <p className="font-medium text-[#121211] mt-0.5 inline-flex items-center gap-1.5">
                  <PlatformIcon platform={order.platform} className="w-3.5 h-3.5 text-[#5C5852]" />
                  <span>
                    {order.platform} · {order.socialContact}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs text-[#8C877E]">Delivery Area</p>
                <p className="font-medium text-[#121211] mt-0.5">{order.deliveryArea}</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-3">
            <h3 className="text-sm font-semibold text-[#121211]">Payment Breakdown</h3>
            <p className="text-xs text-[#5C5852]">
              {PAYMENT_TYPE_LABELS[order.paymentType]}
            </p>

            <div className="pt-2 space-y-2 text-sm">
              <div className="flex justify-between text-[#5C5852]">
                <span>Product price</span>
                <span className="font-mono tabular-nums text-[#121211]">
                  {formatCurrency(order.productAmount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between text-[#5C5852]">
                <span>Delivery ({order.deliveryArea})</span>
                <span className="font-mono tabular-nums text-[#121211]">
                  {formatCurrency(order.deliveryCharge, settings.currency)}
                </span>
              </div>
              <div className="border-t border-dashed border-[#D8D3C8] pt-2.5 flex justify-between font-semibold text-[#121211]">
                <span>Total</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(order.totalAmount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between text-emerald-800 font-medium">
                <span>Paid</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(order.paidAmount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between text-amber-900 font-semibold">
                <span>Remaining</span>
                <span className="font-mono tabular-nums">
                  {formatCurrency(order.remainingAmount, settings.currency)}
                </span>
              </div>
            </div>
          </div>
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
              This permanently removes the order for{' '}
              <span className="font-medium text-[#121211]">{order.customerName}</span> and deletes
              its reference photos.
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
          title={`${order.orderNumber} · ${order.productName}`}
        />
      )}
    </div>
  );
}
