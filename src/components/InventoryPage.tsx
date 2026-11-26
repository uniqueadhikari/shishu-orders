import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CopyPlus,
  Download,
  Edit3,
  Loader2,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getUserFriendlyError } from '../firebase/errors';
import {
  type StockState,
  adjustInventoryQuantity,
  createInventoryItem,
  deleteInventoryItem,
  getStockState,
  updateInventoryItem,
  validateInventoryForm,
} from '../services/inventory';
import { type NewPhotoInput, getOrderLineItems } from '../services/orders';
import { compressImageToTarget } from '../services/storage';
import type {
  InventoryFormValues,
  InventoryItem,
  Order,
  StoreSettings,
} from '../types/order';
import { downloadInventoryCsv } from '../utils/csv';
import { formatShortDate } from '../utils/date';
import { formatAmountDisplay } from '../utils/payment';
import { OrderPhoto } from './OrderPhoto';
import { type PhotoItem, PhotoUploader } from './PhotoUploader';
import { StatusBadge } from './StatusBadge';

interface InventoryPageProps {
  items: InventoryItem[];
  orders: Order[];
  loading: boolean;
  settings: StoreSettings;
  user: User;
  onCreateOrderFromStock: (item: InventoryItem) => void;
  onSelectOrder: (order: Order) => void;
  onNotify?: (text: string) => void;
}

type StockFilter = 'ALL' | 'ok' | 'low' | 'out';

export function InventoryPage({
  items,
  orders,
  loading,
  settings,
  user,
  onCreateOrderFromStock,
  onSelectOrder,
  onNotify,
}: InventoryPageProps) {
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('ALL');
  const [colorFilter, setColorFilter] = useState<string>('ALL');

  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyVal, setEditingQtyVal] = useState('');
  const [pageError, setPageError] = useState<string | null>(null);

  // Connected orders modal for a selected inventory item
  const [inspectItemId, setInspectItemId] = useState<string | null>(null);

  // Add/Edit Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [formValues, setFormValues] = useState<InventoryFormValues>({
    pieceName: '',
    color: '',
    size: '',
    quantity: '1',
    lowStockThreshold: '3',
    unitPrice: '',
    notes: '',
  });
  const [photoItems, setPhotoItems] = useState<PhotoItem[]>([]);
  const [removedPhotoPath, setRemovedPhotoPath] = useState('');
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const blobUrlsRef = useRef<Set<string>>(new Set());
  const committingQtyRef = useRef(false);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const blobs = blobUrlsRef.current;
    return () => {
      for (const url of blobs) {
        URL.revokeObjectURL(url);
      }
      blobs.clear();
    };
  }, []);

  // Map linked orders (pending + sold + per-piece qty) across single and multi-piece orders
  const ordersByItem = useMemo(() => {
    const map = new Map<
      string,
      { pendingUnits: number; soldUnits: number; list: { order: Order; itemQty: number; deducted: boolean }[] }
    >();
    for (const o of orders) {
      const lineItems = getOrderLineItems(o);
      const perOrderMap = new Map<string, { qty: number; deducted: boolean }>();
      for (const li of lineItems) {
        if (!li.inventoryItemId) continue;
        const prev = perOrderMap.get(li.inventoryItemId);
        perOrderMap.set(li.inventoryItemId, {
          qty: (prev?.qty ?? 0) + li.quantity,
          deducted: Boolean(prev?.deducted || li.stockDeducted),
        });
      }

      for (const [invId, info] of perOrderMap.entries()) {
        let entry = map.get(invId);
        if (!entry) {
          entry = { pendingUnits: 0, soldUnits: 0, list: [] };
          map.set(invId, entry);
        }
        entry.list.push({ order: o, itemQty: info.qty, deducted: info.deducted });
        if (o.status === 'COMPLETED') {
          entry.soldUnits += info.qty;
        } else if (o.status !== 'CANCELLED' && o.status !== 'RETURNED') {
          entry.pendingUnits += info.qty;
        }
      }
    }
    return map;
  }, [orders]);

  const inspectItem = useMemo(
    () => (inspectItemId ? items.find((i) => i.id === inspectItemId) ?? null : null),
    [items, inspectItemId]
  );

  const summary = useMemo(() => {
    let totalUnits = 0;
    let lowCount = 0;
    let outCount = 0;
    let okCount = 0;

    for (const item of items) {
      totalUnits += item.quantity;
      const state = getStockState(item);
      if (state === 'out') outCount += 1;
      else if (state === 'low') lowCount += 1;
      else okCount += 1;
    }

    return {
      totalSkus: items.length,
      totalUnits,
      lowCount,
      outCount,
      okCount,
    };
  }, [items]);

  const availableColors = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.color.trim()) set.add(item.color.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  useEffect(() => {
    if (colorFilter !== 'ALL' && !availableColors.includes(colorFilter)) {
      setColorFilter('ALL');
    }
  }, [colorFilter, availableColors]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      const state = getStockState(item);
      if (stockFilter !== 'ALL' && state !== stockFilter) return false;
      if (colorFilter !== 'ALL' && item.color.trim() !== colorFilter) return false;
      if (q) {
        const hit =
          item.pieceName.toLowerCase().includes(q) ||
          item.color.toLowerCase().includes(q) ||
          item.size.toLowerCase().includes(q) ||
          item.notes.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [items, search, stockFilter, colorFilter]);

  function openAddModal(preset?: Partial<InventoryFormValues>) {
    setEditingItem(null);
    setFormValues({
      pieceName: preset?.pieceName ?? '',
      color: preset?.color ?? '',
      size: preset?.size ?? '',
      quantity: preset?.quantity ?? '1',
      lowStockThreshold: preset?.lowStockThreshold ?? '3',
      unitPrice: preset?.unitPrice ?? '',
      notes: preset?.notes ?? '',
    });
    setPhotoItems([]);
    setRemovedPhotoPath('');
    setModalError(null);
    setModalOpen(true);
  }

  function openEditModal(item: InventoryItem) {
    setEditingItem(item);
    setFormValues({
      pieceName: item.pieceName,
      color: item.color,
      size: item.size,
      quantity: String(item.quantity),
      lowStockThreshold: String(item.lowStockThreshold),
      unitPrice: item.unitPrice,
      notes: item.notes,
    });
    setPhotoItems(
      item.photoUrl
        ? [
            {
              id: `existing-${item.id}`,
              previewUrl: item.photoUrl,
              existingUrl: item.photoUrl,
              existingPath: item.photoPath,
            },
          ]
        : []
    );
    setRemovedPhotoPath('');
    setModalError(null);
    setModalOpen(true);
  }

  function handleAddModalFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    setModalError(null);
    const rawUrl = URL.createObjectURL(file);
    blobUrlsRef.current.add(rawUrl);
    const itemId = `inv-new-${Date.now()}`;

    setPhotoItems([
      {
        id: itemId,
        previewUrl: rawUrl,
        file,
        compressing: true,
      },
    ]);

    compressImageToTarget(file)
      .then((compressed) => {
        blobUrlsRef.current.add(compressed.previewUrl);
        setPhotoItems((prev) =>
          prev.map((p) => {
            if (p.id !== itemId) return p;
            if (p.previewUrl.startsWith('blob:')) {
              URL.revokeObjectURL(p.previewUrl);
              blobUrlsRef.current.delete(p.previewUrl);
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
      .catch((err) => {
        setModalError(getUserFriendlyError(err, 'Could not process the selected photo.'));
        setPhotoItems((prev) => {
          const target = prev.find((p) => p.id === itemId);
          if (target?.previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(target.previewUrl);
            blobUrlsRef.current.delete(target.previewUrl);
          }
          return prev.filter((p) => p.id !== itemId);
        });
      });
  }

  function handleRemoveModalPhoto(id: string) {
    setPhotoItems((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) {
        if (target.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(target.previewUrl);
          blobUrlsRef.current.delete(target.previewUrl);
        }
        if (target.existingPath) {
          setRemovedPhotoPath(target.existingPath);
        }
      }
      return prev.filter((p) => p.id !== id);
    });
  }

  async function saveModal(addAnotherColor: boolean) {
    if (photoItems.some((p) => p.compressing)) {
      setModalError('Please wait while the photo finishes optimizing.');
      return;
    }

    const validationErr = validateInventoryForm(formValues);
    if (validationErr) {
      setModalError(validationErr);
      return;
    }

    setModalError(null);
    setModalSubmitting(true);
    try {
      const firstPhoto = photoItems[0];
      const newPhoto: NewPhotoInput | null =
        firstPhoto && !firstPhoto.existingUrl
          ? firstPhoto.compressed ?? firstPhoto.file ?? null
          : null;

      if (editingItem) {
        const keptUrl = firstPhoto?.existingUrl ?? '';
        const keptPath = firstPhoto?.existingPath ?? '';
        const sharedByOrder =
          Boolean(editingItem.photoUrl) &&
          orders.some((o) => o.photos.includes(editingItem.photoUrl));
        await updateInventoryItem(
          editingItem,
          formValues,
          keptUrl,
          keptPath,
          newPhoto,
          removedPhotoPath,
          user,
          sharedByOrder
        );
        onNotify?.(`Updated ${formValues.pieceName.trim()}`);
        setModalOpen(false);
      } else {
        await createInventoryItem(formValues, newPhoto, user, settings);
        onNotify?.(`Added ${formValues.pieceName.trim()} to inventory`);
        if (addAnotherColor) {
          for (const p of photoItems) {
            if (p.previewUrl.startsWith('blob:')) {
              URL.revokeObjectURL(p.previewUrl);
              blobUrlsRef.current.delete(p.previewUrl);
            }
          }
          setFormValues((v) => ({
            ...v,
            color: '',
            quantity: '1',
          }));
          setPhotoItems([]);
          setRemovedPhotoPath('');
        } else {
          setModalOpen(false);
        }
      }
    } catch (err) {
      setModalError(getUserFriendlyError(err, 'Could not save inventory item.'));
    } finally {
      setModalSubmitting(false);
    }
  }

  async function handleStepQuantity(item: InventoryItem, delta: number) {
    const nextQty = Math.max(0, Math.min(100000, item.quantity + delta));
    if (nextQty === item.quantity) return;
    setPageError(null);
    setBusyItemId(item.id);
    try {
      await adjustInventoryQuantity(item.id, nextQty);
    } catch (err) {
      setPageError(getUserFriendlyError(err, 'Could not update stock quantity.'));
    } finally {
      setBusyItemId(null);
    }
  }

  async function handleCommitInlineQty(item: InventoryItem) {
    if (committingQtyRef.current) return;
    committingQtyRef.current = true;
    try {
      const parsed = Math.floor(Number(editingQtyVal));
      setEditingQtyId(null);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed === item.quantity) return;
      setPageError(null);
      setBusyItemId(item.id);
      try {
        await adjustInventoryQuantity(item.id, parsed);
        onNotify?.(`${item.pieceName} stock set to ${Math.min(100000, parsed)}`);
      } catch (err) {
        setPageError(getUserFriendlyError(err, 'Could not update stock quantity.'));
      } finally {
        setBusyItemId(null);
      }
    } finally {
      committingQtyRef.current = false;
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setPageError(null);
    try {
      const name = deleteTarget.pieceName;
      const sharedByOrder =
        Boolean(deleteTarget.photoUrl) &&
        orders.some((o) => o.photos.includes(deleteTarget.photoUrl));
      await deleteInventoryItem(deleteTarget, sharedByOrder);
      setDeleteTarget(null);
      onNotify?.(`Removed ${name} from inventory`);
    } catch (err) {
      setPageError(getUserFriendlyError(err, 'Could not delete inventory piece.'));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  function renderStockLabel(state: StockState) {
    if (state === 'out') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700">
          <AlertTriangle className="w-3.5 h-3.5" />
          Out of stock
        </span>
      );
    }
    if (state === 'low') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5" />
          Low stock
        </span>
      );
    }
    return <span className="text-xs font-medium text-emerald-800">In stock</span>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#8C877E] tabular-nums">
            {summary.totalSkus} pieces · {summary.totalUnits} units available
          </p>
          <h1 className="mt-1 text-3xl sm:text-4xl font-display font-semibold tracking-tight text-[#121211]">
            Inventory Manager
          </h1>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            disabled={items.length === 0}
            onClick={() => {
              downloadInventoryCsv(filteredItems);
              onNotify?.(`Exported ${filteredItems.length} stock items to CSV`);
            }}
            className="min-h-[42px] px-4 py-2 rounded-xl border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] disabled:opacity-50 text-xs sm:text-sm font-medium text-[#121211] inline-flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => openAddModal()}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-[#121211] text-[#F7F5F0] hover:bg-[#272624] text-xs sm:text-sm font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Piece</span>
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-[#E6E2D8] rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-[#5C5852]">Catalog Pieces</p>
          <p className="mt-2 text-xl sm:text-2xl font-semibold font-mono tabular-nums text-[#121211]">
            {summary.totalSkus}
          </p>
          <p className="mt-1 text-[11px] text-[#8C877E]">Piece & color variants</p>
        </div>

        <div className="bg-white border border-[#E6E2D8] rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-[#5C5852]">Total Stock Units</p>
          <p className="mt-2 text-xl sm:text-2xl font-semibold font-mono tabular-nums text-emerald-900">
            {summary.totalUnits}
          </p>
          <p className="mt-1 text-[11px] text-[#8C877E]">Auto-synced with orders</p>
        </div>

        <button
          type="button"
          onClick={() => setStockFilter(stockFilter === 'low' ? 'ALL' : 'low')}
          className={`text-left bg-white border rounded-2xl p-4 sm:p-5 transition-colors cursor-pointer ${
            stockFilter === 'low' ? 'border-amber-500' : 'border-[#E6E2D8] hover:border-[#C9C3B6]'
          }`}
        >
          <p className="text-xs font-medium text-[#5C5852]">Low Stock</p>
          <p className="mt-2 text-xl sm:text-2xl font-semibold font-mono tabular-nums text-amber-900">
            {summary.lowCount}
          </p>
          <p className="mt-1 text-[11px] text-[#8C877E]">At or below alert level</p>
        </button>

        <button
          type="button"
          onClick={() => setStockFilter(stockFilter === 'out' ? 'ALL' : 'out')}
          className={`text-left bg-white border rounded-2xl p-4 sm:p-5 transition-colors cursor-pointer ${
            stockFilter === 'out' ? 'border-rose-500' : 'border-[#E6E2D8] hover:border-[#C9C3B6]'
          }`}
        >
          <p className="text-xs font-medium text-[#5C5852]">Out of Stock</p>
          <p className="mt-2 text-xl sm:text-2xl font-semibold font-mono tabular-nums text-rose-800">
            {summary.outCount}
          </p>
          <p className="mt-1 text-[11px] text-[#8C877E]">Needs restocking</p>
        </button>
      </div>

      {/* Filter Tabs + Search */}
      <div className="bg-white border border-[#E6E2D8] rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'ALL', label: 'All Stock', count: items.length },
              { id: 'ok', label: 'In Stock', count: summary.okCount },
              { id: 'low', label: 'Low Stock', count: summary.lowCount },
              { id: 'out', label: 'Out of Stock', count: summary.outCount },
            ] as const
          ).map((tab) => {
            const active = stockFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStockFilter(tab.id)}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#121211] text-[#F7F5F0] border-[#121211]'
                    : 'bg-[#FAF9F5] text-[#5C5852] border-[#E6E2D8] hover:text-[#121211]'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    active ? 'text-stone-300' : 'text-[#8C877E]'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#8C877E] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search piece name, color, size, or notes..."
              className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
            />
          </div>

          {availableColors.length > 0 && (
            <select
              value={colorFilter}
              onChange={(e) => setColorFilter(e.target.value)}
              aria-label="Filter by color"
              className="min-h-[44px] sm:w-48 px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] text-sm"
            >
              <option value="ALL">All colors</option>
              {availableColors.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {pageError && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm font-medium text-rose-800">
          {pageError}
        </div>
      )}

      {/* Inventory List */}
      {loading ? (
        <div className="bg-white border border-[#E6E2D8] rounded-2xl p-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-[#F7F5F0] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-[#E6E2D8] rounded-2xl px-6 py-16 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-[#F7F5F0] border border-[#E6E2D8] flex items-center justify-center text-[#5C5852]">
            <Package className="w-5 h-5" />
          </div>
          <h2 className="mt-4 text-lg font-display font-semibold text-[#121211]">
            No stock pieces yet
          </h2>
          <p className="mt-1 text-sm text-[#5C5852] max-w-md mx-auto">
            Add your clothing pieces, colors, and quantities here. Shishu.clo will show them as
            live suggestions during order entry and update stock automatically.
          </p>
          <button
            type="button"
            onClick={() => openAddModal()}
            className="mt-5 min-h-[46px] px-6 py-2.5 rounded-xl bg-[#121211] text-[#F7F5F0] text-sm font-medium hover:bg-[#272624] transition-colors inline-flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add your first piece</span>
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white border border-[#E6E2D8] rounded-2xl px-6 py-14 text-center">
          <h2 className="text-base font-semibold text-[#121211]">No matching stock pieces</h2>
          <p className="mt-1 text-sm text-[#5C5852]">
            Try clearing your search or switching stock status filters.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setStockFilter('ALL');
              setColorFilter('ALL');
            }}
            className="mt-4 min-h-[42px] px-5 py-2 rounded-xl border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] text-sm font-medium text-[#121211] cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden lg:block bg-white border border-[#E6E2D8] rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#ECE9E2] bg-[#FAF9F5] text-[11px] uppercase tracking-[0.08em] font-semibold text-[#5C5852]">
                    <th className="py-3.5 px-4">Piece</th>
                    <th className="py-3.5 px-4">Color</th>
                    <th className="py-3.5 px-4">Size</th>
                    <th className="py-3.5 px-4">Price</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4">Stock Qty</th>
                    <th className="py-3.5 px-4 text-right">Linked Orders</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE9E2] text-sm">
                  {filteredItems.map((item) => {
                    const state = getStockState(item);
                    const isBusy = busyItemId === item.id;
                    const itemOrders = ordersByItem.get(item.id);
                    const pending = itemOrders?.pendingUnits ?? 0;
                    const sold = itemOrders?.soldUnits ?? 0;
                    const totalLinked = itemOrders?.list.length ?? 0;

                    return (
                      <tr key={item.id} className="hover:bg-[#FAF9F5] transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3 max-w-[260px]">
                            <div className="w-10 h-10 rounded-lg overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] shrink-0 flex items-center justify-center">
                              <OrderPhoto
                                src={item.photoUrl}
                                alt={item.pieceName}
                                className="w-full h-full object-cover"
                                iconClassName="w-4 h-4 text-[#8C877E]"
                              />
                            </div>
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => setInspectItemId(item.id)}
                                className="font-medium text-[#121211] hover:underline truncate block text-left cursor-pointer"
                              >
                                {item.pieceName}
                              </button>
                              {item.notes && (
                                <p className="text-xs text-[#8C877E] truncate">{item.notes}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs font-medium text-[#121211]">
                          {item.color || '—'}
                        </td>
                        <td className="py-3 px-4 text-xs text-[#5C5852]">{item.size || '—'}</td>
                        <td className="py-3 px-4 font-mono text-xs text-[#121211] tabular-nums">
                          {item.unitPrice
                            ? formatAmountDisplay(item.unitPrice, settings.currency)
                            : '—'}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">{renderStockLabel(state)}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isBusy || item.quantity <= 0}
                              onClick={() => handleStepQuantity(item, -1)}
                              className="w-8 h-8 rounded-lg border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] disabled:opacity-40 flex items-center justify-center cursor-pointer"
                              aria-label={`Decrease ${item.pieceName} stock`}
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>

                            {editingQtyId === item.id ? (
                              <input
                                type="number"
                                min={0}
                                max={100000}
                                autoFocus
                                value={editingQtyVal}
                                onChange={(e) => setEditingQtyVal(e.target.value)}
                                onBlur={() => handleCommitInlineQty(item)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void handleCommitInlineQty(item);
                                  if (e.key === 'Escape') setEditingQtyId(null);
                                }}
                                className="w-16 h-8 px-2 text-center rounded-lg border border-[#121211] bg-white font-mono text-xs font-semibold tabular-nums"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingQtyId(item.id);
                                  setEditingQtyVal(String(item.quantity));
                                }}
                                title="Click to type exact quantity"
                                className="min-w-[44px] h-8 px-2 rounded-lg border border-[#ECE9E2] bg-[#FAF9F5] hover:border-[#C9C3B6] font-mono text-xs font-semibold tabular-nums text-[#121211] cursor-pointer"
                              >
                                {isBusy ? '...' : item.quantity}
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleStepQuantity(item, 1)}
                              className="w-8 h-8 rounded-lg border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] disabled:opacity-40 flex items-center justify-center cursor-pointer"
                              aria-label={`Increase ${item.pieceName} stock`}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">
                          <button
                            type="button"
                            onClick={() => setInspectItemId(item.id)}
                            className="text-[#5C5852] hover:text-[#121211] hover:underline cursor-pointer"
                          >
                            {totalLinked === 0
                              ? '0 orders'
                              : `${pending} active · ${sold} sold`}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={item.quantity <= 0}
                              onClick={() => onCreateOrderFromStock(item)}
                              title={
                                item.quantity <= 0
                                  ? 'Restock to create order'
                                  : 'Create order using this piece'
                              }
                              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#121211] text-[#F7F5F0] hover:bg-[#272624] disabled:opacity-35 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <ShoppingBag className="w-3.5 h-3.5" />
                              <span>Order</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                openAddModal({
                                  pieceName: item.pieceName,
                                  size: item.size,
                                  unitPrice: item.unitPrice,
                                  lowStockThreshold: String(item.lowStockThreshold),
                                })
                              }
                              title="Add another color for this piece"
                              className="min-h-[34px] px-2.5 py-1 rounded-lg border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] text-xs font-medium text-[#121211] inline-flex items-center gap-1 cursor-pointer"
                            >
                              <CopyPlus className="w-3.5 h-3.5" />
                              <span>Color</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(item)}
                              className="w-8 h-8 rounded-lg border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] text-[#5C5852] hover:text-[#121211] inline-flex items-center justify-center cursor-pointer"
                              aria-label={`Edit ${item.pieceName}`}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(item)}
                              className="w-8 h-8 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 inline-flex items-center justify-center cursor-pointer"
                              aria-label={`Delete ${item.pieceName}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile & Tablet Cards */}
          <div className="lg:hidden space-y-3">
            {filteredItems.map((item) => {
              const state = getStockState(item);
              const isBusy = busyItemId === item.id;
              const itemOrders = ordersByItem.get(item.id);
              const pending = itemOrders?.pendingUnits ?? 0;
              const sold = itemOrders?.soldUnits ?? 0;
              const specs = [item.color, item.size ? `Size ${item.size}` : '']
                .filter(Boolean)
                .join(' · ');

              return (
                <div
                  key={item.id}
                  className="bg-white border border-[#E6E2D8] rounded-2xl p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setInspectItemId(item.id)}
                      className="flex items-center gap-3 min-w-0 text-left cursor-pointer"
                    >
                      <div className="w-12 h-12 rounded-xl overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] shrink-0 flex items-center justify-center">
                        <OrderPhoto
                          src={item.photoUrl}
                          alt={item.pieceName}
                          className="w-full h-full object-cover"
                          iconClassName="w-4 h-4 text-[#8C877E]"
                        />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-[#121211] truncate">
                          {item.pieceName}
                        </h3>
                        <p className="text-xs text-[#5C5852] truncate mt-0.5">
                          {specs || 'No color/size'}
                          {item.unitPrice
                            ? ` · ${formatAmountDisplay(item.unitPrice, settings.currency)}`
                            : ''}
                        </p>
                      </div>
                    </button>
                    <div className="shrink-0">{renderStockLabel(state)}</div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#ECE9E2]">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy || item.quantity <= 0}
                        onClick={() => handleStepQuantity(item, -1)}
                        className="w-10 h-10 rounded-xl border border-[#DDD8CE] bg-white active:bg-[#F7F5F0] disabled:opacity-40 flex items-center justify-center cursor-pointer"
                        aria-label="Decrease stock"
                      >
                        <Minus className="w-4 h-4" />
                      </button>

                      {editingQtyId === item.id ? (
                        <input
                          type="number"
                          min={0}
                          max={100000}
                          autoFocus
                          value={editingQtyVal}
                          onChange={(e) => setEditingQtyVal(e.target.value)}
                          onBlur={() => handleCommitInlineQty(item)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleCommitInlineQty(item);
                            if (e.key === 'Escape') setEditingQtyId(null);
                          }}
                          className="w-16 h-10 px-2 text-center rounded-xl border border-[#121211] bg-white font-mono text-sm font-semibold tabular-nums"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingQtyId(item.id);
                            setEditingQtyVal(String(item.quantity));
                          }}
                          className="min-w-[52px] h-10 px-3 rounded-xl border border-[#ECE9E2] bg-[#FAF9F5] font-mono text-sm font-semibold tabular-nums text-[#121211] cursor-pointer"
                        >
                          {isBusy ? '...' : item.quantity}
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleStepQuantity(item, 1)}
                        className="w-10 h-10 rounded-xl border border-[#DDD8CE] bg-white active:bg-[#F7F5F0] disabled:opacity-40 flex items-center justify-center cursor-pointer"
                        aria-label="Increase stock"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={item.quantity <= 0}
                        onClick={() => onCreateOrderFromStock(item)}
                        className="min-h-[40px] px-3 py-2 rounded-xl bg-[#121211] text-[#F7F5F0] disabled:opacity-35 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <ShoppingBag className="w-3.5 h-3.5" />
                        <span>Order</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(item)}
                        className="w-10 h-10 rounded-xl border border-[#DDD8CE] bg-white text-[#5C5852] flex items-center justify-center cursor-pointer"
                        aria-label="Edit piece"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(item)}
                        className="w-10 h-10 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 flex items-center justify-center cursor-pointer"
                        aria-label="Delete piece"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[#8C877E] tabular-nums">
                    <button
                      type="button"
                      onClick={() => setInspectItemId(item.id)}
                      className="hover:text-[#121211] underline-offset-2 hover:underline cursor-pointer"
                    >
                      {pending > 0 || sold > 0
                        ? `${pending} active · ${sold} sold orders`
                        : '0 linked orders'}
                    </button>
                    <span>Updated {formatShortDate(item.updatedAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Piece Connected Orders & Restock Drawer/Modal */}
      {inspectItem && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full sm:max-w-lg bg-white border border-[#E6E2D8] rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-xl overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] shrink-0 flex items-center justify-center">
                  <OrderPhoto
                    src={inspectItem.photoUrl}
                    alt={inspectItem.pieceName}
                    className="w-full h-full object-cover"
                    iconClassName="w-5 h-5 text-[#8C877E]"
                  />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-display font-semibold text-[#121211] truncate">
                    {inspectItem.pieceName}
                  </h2>
                  <p className="text-xs text-[#5C5852]">
                    {[
                      inspectItem.color,
                      inspectItem.size ? `Size ${inspectItem.size}` : '',
                      `${inspectItem.quantity} in stock`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectItemId(null)}
                className="min-h-[38px] min-w-[38px] rounded-xl border border-[#E6E2D8] hover:bg-[#F7F5F0] flex items-center justify-center cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#ECE9E2] bg-[#FAF9F5] p-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busyItemId === inspectItem.id}
                  onClick={() => handleStepQuantity(inspectItem, 1)}
                  className="min-h-[34px] px-3 rounded-lg border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] text-xs font-medium cursor-pointer"
                >
                  +1 Stock
                </button>
                <button
                  type="button"
                  disabled={busyItemId === inspectItem.id}
                  onClick={() => handleStepQuantity(inspectItem, 5)}
                  className="min-h-[34px] px-3 rounded-lg border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] text-xs font-medium cursor-pointer"
                >
                  +5 Restock
                </button>
              </div>
              <button
                type="button"
                disabled={inspectItem.quantity <= 0}
                onClick={() => {
                  const target = inspectItem;
                  setInspectItemId(null);
                  onCreateOrderFromStock(target);
                }}
                className="min-h-[34px] px-3.5 rounded-lg bg-[#121211] text-[#F7F5F0] disabled:opacity-40 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>Create Order</span>
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#5C5852]">
                Connected Orders ({ordersByItem.get(inspectItem.id)?.list.length ?? 0})
              </p>

              {(ordersByItem.get(inspectItem.id)?.list.length ?? 0) === 0 ? (
                <p className="text-xs text-[#8C877E] py-6 text-center border border-dashed border-[#E6E2D8] rounded-xl">
                  No orders linked to this stock piece yet.
                </p>
              ) : (
                <div className="divide-y divide-[#ECE9E2] border border-[#E6E2D8] rounded-xl overflow-hidden">
                  {ordersByItem.get(inspectItem.id)!.list.map(({ order, itemQty, deducted }) => (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => {
                        setInspectItemId(null);
                        onSelectOrder(order);
                      }}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-[#FAF9F5] flex items-center justify-between gap-3 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#121211] truncate">
                          <span className="font-mono">{order.orderNumber}</span> ·{' '}
                          {order.customerName || 'Unnamed customer'}
                        </p>
                        <p className="text-[11px] text-[#8C877E] mt-0.5 tabular-nums">
                          Qty {itemQty} · {formatShortDate(order.createdAt)} ·{' '}
                          {deducted ? 'Deducted' : 'Restored'}
                        </p>
                      </div>
                      <StatusBadge status={order.status} compact />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Stock Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveModal(false);
            }}
            className="w-full sm:max-w-lg bg-white border border-[#E6E2D8] rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8C877E]">
                  Inventory Stock
                </p>
                <h2 className="text-xl font-display font-semibold text-[#121211]">
                  {editingItem ? 'Edit Stock Piece' : 'Add Stock Piece'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[40px] min-w-[40px] rounded-xl border border-[#E6E2D8] hover:bg-[#F7F5F0] flex items-center justify-center cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm font-medium text-rose-800">
                {modalError}
              </div>
            )}

            <div>
              <label htmlFor="invPieceName" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                Piece / product name *
              </label>
              <input
                id="invPieceName"
                type="text"
                autoFocus
                required
                value={formValues.pieceName}
                onChange={(e) => setFormValues((v) => ({ ...v, pieceName: e.target.value }))}
                placeholder="e.g. Draped Linen Corset Top"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label htmlFor="invColor" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                  Color
                </label>
                <input
                  id="invColor"
                  type="text"
                  value={formValues.color}
                  onChange={(e) => setFormValues((v) => ({ ...v, color: e.target.value }))}
                  placeholder="e.g. Ivory, Sage Green"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
                />
              </div>

              <div>
                <label htmlFor="invSize" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                  Size
                </label>
                <input
                  id="invSize"
                  type="text"
                  value={formValues.size}
                  onChange={(e) => setFormValues((v) => ({ ...v, size: e.target.value }))}
                  placeholder="e.g. Free Size, M, S"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="invQty" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                  Quantity
                </label>
                <input
                  id="invQty"
                  type="number"
                  min={0}
                  max={100000}
                  value={formValues.quantity}
                  onChange={(e) => setFormValues((v) => ({ ...v, quantity: e.target.value }))}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm font-mono tabular-nums"
                />
              </div>

              <div>
                <label htmlFor="invThreshold" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                  Low alert at
                </label>
                <input
                  id="invThreshold"
                  type="number"
                  min={0}
                  max={1000}
                  value={formValues.lowStockThreshold}
                  onChange={(e) =>
                    setFormValues((v) => ({ ...v, lowStockThreshold: e.target.value }))
                  }
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm font-mono tabular-nums"
                />
              </div>

              <div>
                <label htmlFor="invPrice" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                  Default price
                </label>
                <input
                  id="invPrice"
                  type="text"
                  value={formValues.unitPrice}
                  onChange={(e) => setFormValues((v) => ({ ...v, unitPrice: e.target.value }))}
                  placeholder="e.g. 2500"
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm font-mono tabular-nums"
                />
              </div>
            </div>

            <PhotoUploader
              items={photoItems}
              onAddFiles={handleAddModalFiles}
              onRemoveItem={handleRemoveModalPhoto}
              maxPhotos={1}
            />

            <div>
              <label htmlFor="invNotes" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                Notes
              </label>
              <textarea
                id="invNotes"
                rows={2}
                value={formValues.notes}
                onChange={(e) => setFormValues((v) => ({ ...v, notes: e.target.value }))}
                placeholder="Fabric details, supplier batch, rack location..."
                className="w-full px-3.5 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm resize-y"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={modalSubmitting}
                onClick={() => setModalOpen(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-[#DDD8CE] bg-white text-sm font-medium text-[#5C5852] hover:bg-[#F7F5F0] cursor-pointer"
              >
                Cancel
              </button>

              {!editingItem && (
                <button
                  type="button"
                  disabled={modalSubmitting || photoItems.some((p) => p.compressing)}
                  onClick={() => void saveModal(true)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-[#121211] bg-white text-[#121211] text-sm font-medium hover:bg-[#F7F5F0] disabled:opacity-60 cursor-pointer"
                >
                  Save & Add Color
                </button>
              )}

              <button
                type="submit"
                disabled={modalSubmitting || photoItems.some((p) => p.compressing)}
                className="min-h-[44px] px-6 py-2 rounded-xl bg-[#121211] text-[#F7F5F0] text-sm font-medium hover:bg-[#272624] disabled:opacity-60 inline-flex items-center gap-2 cursor-pointer"
              >
                {modalSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  {modalSubmitting ? 'Saving...' : editingItem ? 'Save Changes' : 'Add Piece'}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-w-sm w-full bg-white border border-[#E6E2D8] rounded-2xl p-6 space-y-4 shadow-xl">
            <h3 className="text-lg font-display font-semibold text-[#121211]">
              Remove {deleteTarget.pieceName}?
            </h3>
            <p className="text-sm text-[#5C5852] leading-relaxed">
              This removes{' '}
              <span className="font-medium text-[#121211]">
                {deleteTarget.pieceName}
                {deleteTarget.color ? ` (${deleteTarget.color})` : ''}
              </span>{' '}
              from your stock list. Existing orders keep their text details.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-[#DDD8CE] text-sm font-medium text-[#5C5852] hover:bg-[#F7F5F0] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60 cursor-pointer"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{deleting ? 'Removing...' : 'Remove'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
