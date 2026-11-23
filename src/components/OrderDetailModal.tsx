import {
  ArrowLeft,
  Edit3,
  Expand,
  Loader2,
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
import { StatusBadge } from './StatusBadge';

interface OrderDetailModalProps {
  order: Order;
  settings: StoreSettings;
  onClose: () => void;
  onEdit: (order: Order) => void;
  onDeleted: () => void;
}

export function OrderDetailModal({
  order,
  settings,
  onClose,
  onEdit,
  onDeleted,
}: OrderDetailModalProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStatusChange(nextStatus: OrderStatus) {
    setError(null);
    setStatusBusy(true);
    try {
      await updateOrderStatus(order.id, nextStatus);
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

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Top Action Bar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-[#E8E5DF] bg-white hover:bg-[#F5F3EE] flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Back to orders"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-mono font-semibold text-[#141413] tabular-nums">
                {order.orderNumber}
              </h1>
              <StatusBadge
                status={order.status}
                onChange={handleStatusChange}
                disabled={statusBusy}
              />
            </div>
            <p className="text-xs text-[#78716C] mt-0.5">
              Created {formatDateTime(order.createdAt)} · Updated {formatDateTime(order.updatedAt)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[42px] px-3.5 py-2 rounded-xl border border-[#DFDBD2] bg-white hover:bg-[#F5F3EE] text-xs sm:text-sm font-medium text-[#141413] flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Print Summary</span>
          </button>

          <button
            type="button"
            onClick={() => onEdit(order)}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#141413] text-white hover:bg-[#292826] text-xs sm:text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Edit3 className="w-4 h-4" />
            <span>Edit</span>
          </button>

          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="min-h-[42px] px-3.5 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs sm:text-sm font-medium text-rose-800 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete</span>
          </button>
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
            <p className="text-xs text-stone-600 mt-1">Order Summary</p>
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
          <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-[#78716C]">Piece / Product</p>
                <h2 className="text-lg sm:text-xl font-semibold text-[#141413] mt-0.5">
                  {order.productName}
                </h2>
              </div>
              <div className="text-right text-sm text-[#57534E] shrink-0">
                <span>Size {order.size}</span>
                <span aria-hidden="true"> · </span>
                <span>{order.color}</span>
              </div>
            </div>

            {order.photos.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {order.photos.map((url, idx) => (
                  <button
                    key={`${url}-${idx}`}
                    type="button"
                    onClick={() => setLightboxIdx(idx)}
                    className="group relative aspect-square rounded-xl overflow-hidden border border-[#E8E5DF] bg-[#F5F3EE] cursor-pointer flex items-center justify-center"
                  >
                    <OrderPhoto
                      src={url}
                      alt={`${order.productName} reference ${idx + 1}`}
                      lazy={false}
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                    />
                    <span className="no-print absolute bottom-2 right-2 w-8 h-8 rounded-lg bg-black/60 text-white flex items-center justify-center opacity-85 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <Expand className="w-4 h-4" />
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="pt-3 border-t border-[#ECE9E2] grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-[#78716C]">Size</p>
                <p className="font-medium text-[#141413] mt-0.5">{order.size}</p>
              </div>
              <div>
                <p className="text-xs text-[#78716C]">Color</p>
                <p className="font-medium text-[#141413] mt-0.5">{order.color}</p>
              </div>
            </div>

            {order.notes && (
              <div className="pt-3 border-t border-[#ECE9E2]">
                <p className="text-xs text-[#78716C]">Special Notes</p>
                <p className="text-sm text-[#141413] mt-1 whitespace-pre-wrap leading-relaxed">
                  {order.notes}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#141413]">Customer & Source</h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-[#78716C]">Customer Name</p>
                <p className="font-medium text-[#141413] mt-0.5">{order.customerName}</p>
              </div>
              <div>
                <p className="text-xs text-[#78716C]">Phone</p>
                <a
                  href={`tel:${order.phone}`}
                  className="mt-0.5 inline-flex items-center gap-1.5 font-mono tabular-nums font-medium text-[#141413] hover:underline"
                >
                  <Phone className="w-3.5 h-3.5 text-[#78716C]" />
                  {order.phone}
                </a>
              </div>
              <div>
                <p className="text-xs text-[#78716C]">Social Source</p>
                <p className="font-medium text-[#141413] mt-0.5">
                  {order.platform} · {order.socialContact}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#78716C]">Delivery Area</p>
                <p className="font-medium text-[#141413] mt-0.5">{order.deliveryArea}</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 space-y-3">
            <h3 className="text-sm font-semibold text-[#141413]">Payment Breakdown</h3>
            <p className="text-xs text-[#57534E]">
              {PAYMENT_TYPE_LABELS[order.paymentType]}
            </p>

            <div className="pt-2 space-y-2 text-sm">
              <div className="flex justify-between text-[#57534E]">
                <span>Product price</span>
                <span className="font-mono tabular-nums text-[#141413]">
                  {formatCurrency(order.productAmount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between text-[#57534E]">
                <span>Delivery ({order.deliveryArea})</span>
                <span className="font-mono tabular-nums text-[#141413]">
                  {formatCurrency(order.deliveryCharge, settings.currency)}
                </span>
              </div>
              <div className="border-t border-[#ECE9E2] pt-2 flex justify-between font-semibold text-[#141413]">
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
          <div className="max-w-sm w-full bg-white border border-[#E8E5DF] rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-[#141413]">
              Delete {order.orderNumber}?
            </h3>
            <p className="text-sm text-[#57534E] leading-relaxed">
              This permanently removes the order for <span className="font-medium text-[#141413]">{order.customerName}</span> and deletes its reference photos.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-[#DFDBD2] text-sm font-medium text-[#57534E] hover:bg-[#F5F3EE] cursor-pointer"
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
