import type { User } from 'firebase/auth';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getUserFriendlyError } from '../firebase/errors';
import { type NewPhotoInput, createOrder, updateOrder, validateOrderForm } from '../services/orders';
import { compressImageToTarget, warmStorageProbe } from '../services/storage';
import type { Order, OrderFormValues, OrderStatus, StoreSettings } from '../types/order';
import { ORDER_STATUSES, formatAmountDisplay } from '../utils/payment';
import { type PhotoItem, PhotoUploader } from './PhotoUploader';

interface OrderFormProps {
  mode: 'create' | 'edit';
  initialOrder?: Order;
  settings: StoreSettings;
  user: User;
  onCancel: () => void;
  onSuccess: (savedOrder?: Order) => void;
}

export function OrderForm({
  mode,
  initialOrder,
  settings,
  user,
  onCancel,
  onSuccess,
}: OrderFormProps) {
  const [customerName, setCustomerName] = useState(initialOrder?.customerName ?? '');
  const [phone, setPhone] = useState(initialOrder?.phone ?? '');
  const [socialContact, setSocialContact] = useState(initialOrder?.socialContact ?? '');
  const [productName, setProductName] = useState(initialOrder?.productName ?? '');
  const [size, setSize] = useState(initialOrder?.size ?? '');
  const [color, setColor] = useState(initialOrder?.color ?? '');
  const [notes, setNotes] = useState(initialOrder?.notes ?? '');
  const [totalAmount, setTotalAmount] = useState(
    initialOrder ? String(initialOrder.totalAmount ?? '') : ''
  );
  const [paidAmount, setPaidAmount] = useState(
    initialOrder ? String(initialOrder.paidAmount ?? '') : ''
  );
  const [remainingAmount, setRemainingAmount] = useState(
    initialOrder ? String(initialOrder.remainingAmount ?? '') : ''
  );
  const [status, setStatus] = useState<OrderStatus>(initialOrder?.status ?? 'NEW');

  const [photoItems, setPhotoItems] = useState<PhotoItem[]>(() =>
    (initialOrder?.photos ?? []).map((url, idx) => ({
      id: `existing-${idx}-${url}`,
      previewUrl: url,
      existingUrl: url,
      existingPath: initialOrder?.photoPaths?.[idx] ?? '',
    }))
  );
  const [removedPaths, setRemovedPaths] = useState<string[]>([]);
  const createdBlobUrlsRef = useRef<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);
  const [saveStage, setSaveStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    warmStorageProbe();
    const blobSet = createdBlobUrlsRef.current;
    return () => {
      for (const url of blobSet) {
        URL.revokeObjectURL(url);
      }
      blobSet.clear();
    };
  }, []);

  const hasCompressingPhotos = photoItems.some((p) => p.compressing);

  function handleAddFiles(files: File[]) {
    setError(null);
    const pendingItems: PhotoItem[] = files.map((file) => {
      const rawUrl = URL.createObjectURL(file);
      createdBlobUrlsRef.current.add(rawUrl);
      return {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        previewUrl: rawUrl,
        file,
        compressing: true,
      };
    });

    setPhotoItems((prev) => [...prev, ...pendingItems].slice(0, 3));

    for (const item of pendingItems) {
      if (!item.file) continue;
      compressImageToTarget(item.file)
        .then((compressed) => {
          createdBlobUrlsRef.current.add(compressed.previewUrl);
          setPhotoItems((prev) =>
            prev.map((p) => {
              if (p.id !== item.id) return p;
              if (p.previewUrl.startsWith('blob:')) {
                URL.revokeObjectURL(p.previewUrl);
                createdBlobUrlsRef.current.delete(p.previewUrl);
              }
              return {
                ...p,
                previewUrl: compressed.previewUrl,
                compressed,
                compressing: false,
              };
            })
          );
        })
        .catch(() => {
          setPhotoItems((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, compressing: false } : p))
          );
        });
    }
  }

  function handleRemovePhoto(id: string) {
    setPhotoItems((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) {
        if (target.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(target.previewUrl);
          createdBlobUrlsRef.current.delete(target.previewUrl);
        }
        if (target.existingPath) {
          setRemovedPaths((paths) => [...paths, target.existingPath!]);
        }
      }
      return prev.filter((p) => p.id !== id);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (hasCompressingPhotos) {
      setError('Please wait a moment while photos finish optimizing.');
      return;
    }

    setError(null);

    const values: OrderFormValues = {
      customerName,
      phone,
      socialContact,
      productName,
      size,
      color,
      notes,
      totalAmount,
      paidAmount,
      remainingAmount,
      status,
    };

    const validationError = validateOrderForm(values, photoItems.length);
    if (validationError) {
      setError(validationError);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setSubmitting(true);
    setSaveStage('Preparing...');
    try {
      const newPhotos: NewPhotoInput[] = photoItems
        .filter((p) => !p.existingUrl && (p.compressed || p.file))
        .map((p) => (p.compressed ? p.compressed : p.file!));

      if (mode === 'create') {
        const created = await createOrder(values, newPhotos, user, settings, setSaveStage);
        onSuccess(created);
      } else if (initialOrder) {
        const keptPhotos = photoItems
          .filter((p) => p.existingUrl)
          .map((p) => p.existingUrl!);
        const keptPaths = photoItems
          .filter((p) => p.existingUrl)
          .map((p) => p.existingPath ?? '');
        await updateOrder(
          initialOrder,
          values,
          keptPhotos,
          keptPaths,
          newPhotos,
          removedPaths,
          user,
          setSaveStage
        );
        onSuccess(initialOrder);
      }
    } catch (err) {
      setError(getUserFriendlyError(err, 'Could not save order. Please try again.'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
      setSaveStage(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-5 pb-24 sm:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-[#E6E2D8] bg-white hover:bg-[#F7F5F0] flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Go back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8C877E]">
              {mode === 'create'
                ? 'All fields optional · Auto-numbered on save'
                : 'All fields optional'}
            </p>
            <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-[#121211]">
              {mode === 'create' ? 'New Order' : `Edit ${initialOrder?.orderNumber ?? 'Order'}`}
            </h1>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm font-medium text-rose-800"
        >
          {error}
        </div>
      )}

      {/* 1. Customer */}
      <section className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#121211] tracking-tight">Customer</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="customerName" className="block text-xs font-medium text-[#5C5852] mb-1.5">
              Customer name
            </label>
            <input
              id="customerName"
              type="text"
              autoFocus={mode === 'create'}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Ananya Shrestha"
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
            />
          </div>

          <div>
            <label htmlFor="phone" className="block text-xs font-medium text-[#5C5852] mb-1.5">
              Phone number
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 98XXXXXXXX"
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm font-mono tabular-nums"
            />
          </div>

          <div>
            <label htmlFor="socialContact" className="block text-xs font-medium text-[#5C5852] mb-1.5">
              Username / contact
            </label>
            <input
              id="socialContact"
              type="text"
              value={socialContact}
              onChange={(e) => setSocialContact(e.target.value)}
              placeholder="e.g. @ananya.s"
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
            />
          </div>
        </div>
      </section>

      {/* 2. Piece & Photos */}
      <section className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#121211] tracking-tight">Piece & Details</h2>

        <div>
          <label htmlFor="productName" className="block text-xs font-medium text-[#5C5852] mb-1.5">
            Piece / product name
          </label>
          <input
            id="productName"
            type="text"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="e.g. Draped Linen Set / Corset Top"
            className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="sizeInput" className="block text-xs font-medium text-[#5C5852] mb-1.5">
              Size
            </label>
            <input
              id="sizeInput"
              type="text"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="e.g. M, Free Size, Bust 34"
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
            />
          </div>

          <div>
            <label htmlFor="colorInput" className="block text-xs font-medium text-[#5C5852] mb-1.5">
              Color
            </label>
            <input
              id="colorInput"
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="e.g. Ivory, Sage Green"
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
            />
          </div>
        </div>

        <PhotoUploader
          items={photoItems}
          onAddFiles={handleAddFiles}
          onRemoveItem={handleRemovePhoto}
          maxPhotos={3}
        />

        <div>
          <label htmlFor="notes" className="block text-xs font-medium text-[#5C5852] mb-1.5">
            Notes
          </label>
          <textarea
            id="notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Delivery address, custom notes, measurements..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm resize-y"
          />
        </div>
      </section>

      {/* 3. Amounts */}
      <section className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[#121211] tracking-tight">Payment Amounts</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="totalAmount" className="block text-xs font-medium text-[#5C5852] mb-1.5">
              Total amount
            </label>
            <input
              id="totalAmount"
              type="text"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              placeholder={`e.g. 2500`}
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm font-mono tabular-nums"
            />
          </div>

          <div>
            <label htmlFor="paidAmount" className="block text-xs font-medium text-[#5C5852] mb-1.5">
              Paid amount
            </label>
            <input
              id="paidAmount"
              type="text"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              placeholder={`e.g. 1000`}
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm font-mono tabular-nums"
            />
          </div>

          <div>
            <label htmlFor="remainingAmount" className="block text-xs font-medium text-[#5C5852] mb-1.5">
              Remaining amount
            </label>
            <input
              id="remainingAmount"
              type="text"
              value={remainingAmount}
              onChange={(e) => setRemainingAmount(e.target.value)}
              placeholder={`e.g. 1500`}
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm font-mono tabular-nums"
            />
          </div>
        </div>

        {mode === 'edit' && (
          <div className="pt-2">
            <label htmlFor="orderStatus" className="block text-xs font-medium text-[#5C5852] mb-1.5">
              Order status
            </label>
            <select
              id="orderStatus"
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus)}
              className="w-full sm:w-64 min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm font-medium"
            >
              {ORDER_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {/* Desktop Actions */}
      <div className="hidden sm:flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="min-h-[46px] px-5 py-2.5 rounded-xl border border-[#DDD8CE] bg-white text-sm font-medium text-[#5C5852] hover:bg-[#F7F5F0] disabled:opacity-50 transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || hasCompressingPhotos}
          className="min-h-[46px] px-7 py-2.5 rounded-xl bg-[#121211] text-[#F7F5F0] text-sm font-medium hover:bg-[#272624] disabled:opacity-60 transition-colors flex items-center gap-2 cursor-pointer"
        >
          {(submitting || hasCompressingPhotos) && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>
            {hasCompressingPhotos
              ? 'Optimizing photos...'
              : submitting
                ? saveStage || 'Saving...'
                : mode === 'create'
                  ? 'Save Order'
                  : 'Save Changes'}
          </span>
        </button>
      </div>

      {/* Mobile Sticky Save CTA */}
      <div className="sm:hidden fixed bottom-16 left-0 right-0 z-20 px-4 py-3 bg-white/95 backdrop-blur-md border-t border-[#E6E2D8] flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-[#8C877E]">Total · Paid</p>
          <p className="text-xs font-semibold font-mono tabular-nums text-[#121211] truncate">
            {formatAmountDisplay(totalAmount, settings.currency)} ·{' '}
            {formatAmountDisplay(paidAmount, settings.currency)}
          </p>
        </div>
        <button
          type="submit"
          disabled={submitting || hasCompressingPhotos}
          className="min-h-[46px] px-6 py-2.5 rounded-xl bg-[#121211] text-[#F7F5F0] text-sm font-medium active:scale-[0.98] disabled:opacity-60 transition-transform flex items-center justify-center gap-2 shrink-0 cursor-pointer"
        >
          {(submitting || hasCompressingPhotos) && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>
            {hasCompressingPhotos
              ? 'Optimizing...'
              : submitting
                ? saveStage || 'Saving...'
                : mode === 'create'
                  ? 'Save Order'
                  : 'Save'}
          </span>
        </button>
      </div>
    </form>
  );
}
