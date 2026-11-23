import type { User } from 'firebase/auth';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getUserFriendlyError } from '../firebase/errors';
import { type NewPhotoInput, createOrder, updateOrder, validateOrderForm } from '../services/orders';
import { compressImageToTarget, warmStorageProbe } from '../services/storage';
import type {
  DeliveryArea,
  Order,
  OrderFormValues,
  OrderStatus,
  PaymentType,
  Platform,
  StoreSettings,
} from '../types/order';
import {
  ORDER_STATUSES,
  PAYMENT_TYPE_OPTIONS,
  PLATFORMS,
  QUICK_SIZES,
  calculateOrderPayment,
  formatCurrency,
  getDeliveryOptionsFromSettings,
} from '../utils/payment';
import { type PhotoItem, PhotoUploader } from './PhotoUploader';

interface OrderFormProps {
  mode: 'create' | 'edit';
  initialOrder?: Order;
  settings: StoreSettings;
  user: User;
  onCancel: () => void;
  onSuccess: (savedOrder?: Order) => void;
}

const QUICK_COLORS = ['Black', 'Ivory', 'Beige', 'Brown', 'Olive', 'Navy', 'Burgundy', 'White'];

export function OrderForm({
  mode,
  initialOrder,
  settings,
  user,
  onCancel,
  onSuccess,
}: OrderFormProps) {
  const deliveryOptions = useMemo(() => getDeliveryOptionsFromSettings(settings), [settings]);

  const [customerName, setCustomerName] = useState(initialOrder?.customerName ?? '');
  const [phone, setPhone] = useState(initialOrder?.phone ?? '');
  const [platform, setPlatform] = useState<Platform>(initialOrder?.platform ?? 'Instagram');
  const [socialContact, setSocialContact] = useState(initialOrder?.socialContact ?? '');
  const [productName, setProductName] = useState(initialOrder?.productName ?? '');
  const [size, setSize] = useState(initialOrder?.size ?? 'M');
  const [color, setColor] = useState(initialOrder?.color ?? '');
  const [notes, setNotes] = useState(initialOrder?.notes ?? '');
  const [productAmountText, setProductAmountText] = useState(
    initialOrder ? String(initialOrder.productAmount) : ''
  );
  const [deliveryArea, setDeliveryArea] = useState<DeliveryArea>(
    initialOrder?.deliveryArea ?? 'Inside Valley'
  );
  const [deliveryCharge, setDeliveryCharge] = useState<number>(
    initialOrder?.deliveryCharge ?? settings.insideValleyRate
  );
  const [paymentType, setPaymentType] = useState<PaymentType>(
    initialOrder?.paymentType ?? 'HALF_WITH_DELIVERY'
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

  useEffect(() => {
    if (mode === 'create') {
      const matched = deliveryOptions.find((opt) => opt.area === deliveryArea);
      if (matched) setDeliveryCharge(matched.charge);
    }
  }, [deliveryArea, deliveryOptions, mode]);

  const parsedProductAmount = useMemo(() => {
    const num = Number(productAmountText);
    return Number.isFinite(num) && num >= 0 ? num : 0;
  }, [productAmountText]);

  const paymentSummary = useMemo(() => {
    try {
      return calculateOrderPayment(parsedProductAmount, deliveryCharge, paymentType);
    } catch {
      return {
        productAmount: 0,
        deliveryCharge,
        totalAmount: deliveryCharge,
        paidAmount: 0,
        remainingAmount: deliveryCharge,
      };
    }
  }, [parsedProductAmount, deliveryCharge, paymentType]);

  const hasCompressingPhotos = photoItems.some((p) => p.compressing);

  function handleSelectDelivery(area: DeliveryArea, charge: number) {
    setDeliveryArea(area);
    setDeliveryCharge(charge);
  }

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

    const rawProductNum = Number(productAmountText);
    const values: OrderFormValues = {
      customerName,
      phone,
      platform,
      socialContact,
      productName,
      size,
      color,
      notes,
      productAmount: productAmountText.trim() === '' ? Number.NaN : rawProductNum,
      deliveryArea,
      deliveryCharge,
      paymentType,
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
        onSuccess();
      }
    } catch (err) {
      setError(getUserFriendlyError(err, 'Could not save order. Please check your details and try again.'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
      setSaveStage(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl mx-auto space-y-6 pb-20 sm:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-[#E8E5DF] bg-white hover:bg-[#F5F3EE] flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Go back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#141413]">
              {mode === 'create' ? 'New Order' : `Edit ${initialOrder?.orderNumber ?? 'Order'}`}
            </h1>
            <p className="text-xs sm:text-sm text-[#78716C]">
              {mode === 'create'
                ? 'Order number is assigned automatically on save'
                : 'Totals and balances recalculate automatically'}
            </p>
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

      {/* 1. Customer & Social Source */}
      <section className="bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 space-y-5">
        <h2 className="text-sm font-semibold text-[#141413] tracking-tight">
          1. Customer & Social Source
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="customerName" className="block text-xs font-medium text-[#57534E] mb-1.5">
              Customer name *
            </label>
            <input
              id="customerName"
              type="text"
              required
              autoFocus={mode === 'create'}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Ananya Shrestha"
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DFDBD2] bg-[#FAF9F7] focus:bg-white focus:border-[#141413] focus:outline-none text-sm"
            />
          </div>

          <div>
            <label htmlFor="phone" className="block text-xs font-medium text-[#57534E] mb-1.5">
              Phone number *
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 98XXXXXXXX"
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DFDBD2] bg-[#FAF9F7] focus:bg-white focus:border-[#141413] focus:outline-none text-sm font-mono tabular-nums"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <span className="block text-xs font-medium text-[#57534E] mb-1.5">
              Platform *
            </span>
            <div className="grid grid-cols-3 gap-2">
              {PLATFORMS.map((p) => {
                const active = platform === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className={`min-h-[46px] px-3 py-2 rounded-xl border text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#141413] text-white border-[#141413]'
                        : 'bg-[#FAF9F7] text-[#141413] border-[#DFDBD2] hover:bg-[#F1EFEA]'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="socialContact" className="block text-xs font-medium text-[#57534E] mb-1.5">
              {platform === 'WhatsApp' ? 'WhatsApp name / number *' : `${platform} username *`}
            </label>
            <input
              id="socialContact"
              type="text"
              required
              value={socialContact}
              onChange={(e) => setSocialContact(e.target.value)}
              placeholder={platform === 'WhatsApp' ? 'e.g. Ananya (98...)' : 'e.g. @ananya.s'}
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DFDBD2] bg-[#FAF9F7] focus:bg-white focus:border-[#141413] focus:outline-none text-sm"
            />
          </div>
        </div>
      </section>

      {/* 2. Piece Details & Reference Photos */}
      <section className="bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 space-y-5">
        <h2 className="text-sm font-semibold text-[#141413] tracking-tight">
          2. Piece Details & Reference Photos
        </h2>

        <div>
          <label htmlFor="productName" className="block text-xs font-medium text-[#57534E] mb-1.5">
            Piece / product name *
          </label>
          <input
            id="productName"
            type="text"
            required
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="e.g. Draped Linen Set / Corset Top"
            className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DFDBD2] bg-[#FAF9F7] focus:bg-white focus:border-[#141413] focus:outline-none text-sm"
          />
        </div>

        <PhotoUploader
          items={photoItems}
          onAddFiles={handleAddFiles}
          onRemoveItem={handleRemovePhoto}
          maxPhotos={3}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label htmlFor="sizeInput" className="block text-xs font-medium text-[#57534E] mb-1.5">
              Size *
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {QUICK_SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSize(s)}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    size === s
                      ? 'bg-[#141413] text-white border-[#141413]'
                      : 'bg-[#FAF9F7] text-[#141413] border-[#DFDBD2] hover:bg-[#F1EFEA]'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <input
              id="sizeInput"
              type="text"
              required
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="Or type custom size (e.g. Bust 34)"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DFDBD2] bg-[#FAF9F7] focus:bg-white focus:border-[#141413] focus:outline-none text-sm"
            />
          </div>

          <div>
            <label htmlFor="colorInput" className="block text-xs font-medium text-[#57534E] mb-1.5">
              Color *
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {QUICK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    color.toLowerCase() === c.toLowerCase()
                      ? 'bg-[#141413] text-white border-[#141413]'
                      : 'bg-[#FAF9F7] text-[#141413] border-[#DFDBD2] hover:bg-[#F1EFEA]'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <input
              id="colorInput"
              type="text"
              required
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="e.g. Sage Green, Charcoal"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DFDBD2] bg-[#FAF9F7] focus:bg-white focus:border-[#141413] focus:outline-none text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="notes" className="block text-xs font-medium text-[#57534E] mb-1.5">
            Special notes (optional)
          </label>
          <textarea
            id="notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Custom measurements, urgent delivery date, gift note..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#DFDBD2] bg-[#FAF9F7] focus:bg-white focus:border-[#141413] focus:outline-none text-sm resize-y"
          />
        </div>
      </section>

      {/* 3. Pricing, Delivery & Payment */}
      <section className="bg-white border border-[#E8E5DF] rounded-2xl p-5 sm:p-6 space-y-5">
        <h2 className="text-sm font-semibold text-[#141413] tracking-tight">
          3. Pricing, Delivery & Payment
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="productAmount" className="block text-xs font-medium text-[#57534E] mb-1.5">
              Product amount ({settings.currency}) *
            </label>
            <input
              id="productAmount"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              required
              value={productAmountText}
              onChange={(e) => setProductAmountText(e.target.value)}
              placeholder="e.g. 2800"
              className="w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border border-[#DFDBD2] bg-[#FAF9F7] focus:bg-white focus:border-[#141413] focus:outline-none text-base font-mono tabular-nums font-medium"
            />
          </div>

          {mode === 'edit' && (
            <div>
              <label htmlFor="orderStatus" className="block text-xs font-medium text-[#57534E] mb-1.5">
                Order status
              </label>
              <select
                id="orderStatus"
                value={status}
                onChange={(e) => setStatus(e.target.value as OrderStatus)}
                className="w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border border-[#DFDBD2] bg-[#FAF9F7] focus:bg-white focus:border-[#141413] focus:outline-none text-sm font-medium"
              >
                {ORDER_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Delivery Area */}
        <div>
          <span className="block text-xs font-medium text-[#57534E] mb-2">
            Delivery option *
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {deliveryOptions.map((opt) => {
              const selected = deliveryArea === opt.area && deliveryCharge === opt.charge;
              return (
                <button
                  key={opt.area}
                  type="button"
                  onClick={() => handleSelectDelivery(opt.area, opt.charge)}
                  className={`min-h-[52px] px-4 py-3 rounded-xl border text-left transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                    selected
                      ? 'bg-[#141413] text-white border-[#141413]'
                      : 'bg-[#FAF9F7] text-[#141413] border-[#DFDBD2] hover:bg-[#F1EFEA]'
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold font-mono tabular-nums">
                      {settings.currency} {opt.charge}
                    </p>
                    <p className={`text-xs ${selected ? 'text-stone-300' : 'text-[#57534E]'}`}>
                      {opt.area}
                    </p>
                  </div>
                  {selected && <Check className="w-4 h-4 shrink-0" />}
                </button>
              );
            })}
          </div>
          {mode === 'edit' &&
            !deliveryOptions.some(
              (opt) => opt.area === deliveryArea && opt.charge === deliveryCharge
            ) && (
              <p className="mt-2 text-xs text-[#57534E]">
                Current saved rate: {settings.currency} {deliveryCharge} — {deliveryArea} (tap above to apply current settings rate).
              </p>
            )}
        </div>

        {/* Payment Type */}
        <div>
          <span className="block text-xs font-medium text-[#57534E] mb-2">
            Payment type *
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {PAYMENT_TYPE_OPTIONS.map((opt) => {
              const selected = paymentType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPaymentType(opt.value)}
                  className={`min-h-[56px] px-4 py-3 rounded-xl border text-left transition-colors cursor-pointer ${
                    selected
                      ? 'bg-[#141413] text-white border-[#141413]'
                      : 'bg-[#FAF9F7] text-[#141413] border-[#DFDBD2] hover:bg-[#F1EFEA]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{opt.label}</span>
                    {selected && <Check className="w-4 h-4 shrink-0" />}
                  </div>
                  <p className={`mt-0.5 text-xs ${selected ? 'text-stone-300' : 'text-[#78716C]'}`}>
                    {opt.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Payment Summary */}
        <div className="rounded-xl bg-[#F8F7F4] border border-[#E8E5DF] p-4 sm:p-5 space-y-2.5">
          <div className="flex items-center justify-between text-sm text-[#57534E]">
            <span>Product amount</span>
            <span className="font-mono tabular-nums font-medium text-[#141413]">
              {formatCurrency(paymentSummary.productAmount, settings.currency)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm text-[#57534E]">
            <span>Delivery charge ({deliveryArea})</span>
            <span className="font-mono tabular-nums font-medium text-[#141413]">
              + {formatCurrency(paymentSummary.deliveryCharge, settings.currency)}
            </span>
          </div>
          <div className="border-t border-[#E2DFD7] pt-2.5 flex items-center justify-between text-base font-semibold text-[#141413]">
            <span>Total amount</span>
            <span className="font-mono tabular-nums">
              {formatCurrency(paymentSummary.totalAmount, settings.currency)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5">
              <p className="text-xs font-medium text-emerald-800">Paid amount</p>
              <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-emerald-950">
                {formatCurrency(paymentSummary.paidAmount, settings.currency)}
              </p>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5">
              <p className="text-xs font-medium text-amber-800">Remaining (COD)</p>
              <p className="mt-0.5 text-base font-semibold font-mono tabular-nums text-amber-950">
                {formatCurrency(paymentSummary.remainingAmount, settings.currency)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Desktop Actions */}
      <div className="hidden sm:flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="min-h-[46px] px-5 py-2.5 rounded-xl border border-[#DFDBD2] bg-white text-sm font-medium text-[#57534E] hover:bg-[#F5F3EE] disabled:opacity-50 transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || hasCompressingPhotos}
          className="min-h-[46px] px-7 py-2.5 rounded-xl bg-[#141413] text-white text-sm font-medium hover:bg-[#292826] disabled:opacity-60 transition-colors flex items-center gap-2 cursor-pointer"
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
      <div className="sm:hidden fixed bottom-16 left-0 right-0 z-20 px-4 py-3 bg-white/95 backdrop-blur-md border-t border-[#E8E5DF] flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-[#78716C]">Total · Paid</p>
          <p className="text-xs font-semibold font-mono tabular-nums text-[#141413] truncate">
            {formatCurrency(paymentSummary.totalAmount, settings.currency)} ·{' '}
            {formatCurrency(paymentSummary.paidAmount, settings.currency)}
          </p>
        </div>
        <button
          type="submit"
          disabled={submitting || hasCompressingPhotos}
          className="min-h-[46px] px-6 py-2.5 rounded-xl bg-[#141413] text-white text-sm font-medium active:scale-[0.98] disabled:opacity-60 transition-transform flex items-center justify-center gap-2 shrink-0 cursor-pointer"
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
