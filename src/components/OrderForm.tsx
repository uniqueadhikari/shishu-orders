import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  Minus,
  Package,
  Plus,
  Search,
  Trash2,
  Unlink,
  UserCheck,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getUserFriendlyError } from '../firebase/errors';
import {
  createInventoryItem,
  getStockState,
  validateInventoryForm,
} from '../services/inventory';
import {
  type CreatedOrderResult,
  type NewPhotoInput,
  createOrder,
  getOrderLineItems,
  isStockActiveStatus,
  updateOrder,
  validateOrderForm,
} from '../services/orders';
import {
  buildCatalogPhotoOptions,
  compressImageToTarget,
  warmStorageProbe,
} from '../services/storage';
import type {
  InventoryFormValues,
  InventoryItem,
  Order,
  OrderFormValues,
  OrderLineItem,
  OrderStatus,
  StoreSettings,
} from '../types/order';
import { formatShortDate } from '../utils/date';
import { ORDER_STATUSES, formatAmountDisplay } from '../utils/payment';
import { OrderPhoto } from './OrderPhoto';
import { type CatalogPhotoOption, type PhotoItem, PhotoUploader } from './PhotoUploader';

interface OrderFormProps {
  mode: 'create' | 'edit';
  initialOrder?: Order;
  orders?: Order[];
  inventory: InventoryItem[];
  preselectedInventoryItem?: InventoryItem | null;
  settings: StoreSettings;
  user: User;
  onCancel: () => void;
  onSuccess: (savedOrder?: CreatedOrderResult | Order) => void;
  onInventoryCreated?: (item: InventoryItem) => void;
}

type DraftLineItem = OrderLineItem & { rowId: string };

interface CustomerProfile {
  key: string;
  name: string;
  phone: string;
  socialContact: string;
  lastNotes: string;
  lastProductName: string;
  lastOrderDate: Date;
  totalOrders: number;
  returnedOrCancelledCount: number;
}

function makeRowId(): string {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyDraftRow(): DraftLineItem {
  return {
    rowId: makeRowId(),
    inventoryItemId: '',
    productName: '',
    color: '',
    size: '',
    quantity: 1,
    unitPrice: '',
    stockDeducted: false,
  };
}

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

export function OrderForm({
  mode,
  initialOrder,
  orders = [],
  inventory,
  preselectedInventoryItem,
  settings,
  user,
  onCancel,
  onSuccess,
  onInventoryCreated,
}: OrderFormProps) {
  const seedItem = mode === 'create' ? preselectedInventoryItem : undefined;

  const [customerName, setCustomerName] = useState(initialOrder?.customerName ?? '');
  const [phone, setPhone] = useState(initialOrder?.phone ?? '');
  const [socialContact, setSocialContact] = useState(initialOrder?.socialContact ?? '');
  const [appliedCustomerKey, setAppliedCustomerKey] = useState<string | null>(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState(false);

  const [items, setItems] = useState<DraftLineItem[]>(() => {
    if (initialOrder) {
      const existing = getOrderLineItems(initialOrder);
      if (existing.length > 0) {
        return existing.map((li) => ({ ...li, rowId: makeRowId() }));
      }
      return [emptyDraftRow()];
    }
    if (seedItem) {
      return [
        {
          rowId: makeRowId(),
          inventoryItemId: seedItem.id,
          productName: seedItem.pieceName,
          color: seedItem.color,
          size: seedItem.size,
          quantity: 1,
          unitPrice: seedItem.unitPrice,
          stockDeducted: false,
        },
      ];
    }
    return [emptyDraftRow()];
  });

  const [notes, setNotes] = useState(initialOrder?.notes ?? '');
  const [totalAmount, setTotalAmount] = useState(
    initialOrder ? String(initialOrder.totalAmount ?? '') : seedItem?.unitPrice ?? ''
  );
  const [paidAmount, setPaidAmount] = useState(
    initialOrder ? String(initialOrder.paidAmount ?? '') : ''
  );
  const [remainingAmount, setRemainingAmount] = useState(
    initialOrder ? String(initialOrder.remainingAmount ?? '') : ''
  );
  const [status, setStatus] = useState<OrderStatus>(initialOrder?.status ?? 'NEW');

  const [stockSearch, setStockSearch] = useState('');
  const [recentlyAddedStock, setRecentlyAddedStock] = useState<InventoryItem | null>(null);
  const autoFilledPriceRef = useRef<boolean>(mode === 'create' && !initialOrder);
  const itemsRef = useRef<DraftLineItem[]>(items);
  itemsRef.current = items;

  // Quick Add Stock modal inside OrderForm
  const [quickStockOpen, setQuickStockOpen] = useState(false);
  const [quickStockTargetRowId, setQuickStockTargetRowId] = useState<string | null>(null);
  const [quickStockValues, setQuickStockValues] = useState<InventoryFormValues>({
    pieceName: '',
    color: '',
    size: '',
    quantity: '5',
    lowStockThreshold: '3',
    unitPrice: '',
    notes: '',
  });
  const [quickStockBusy, setQuickStockBusy] = useState(false);
  const [quickStockError, setQuickStockError] = useState<string | null>(null);
  const [reuseOrderPhotoInStock, setReuseOrderPhotoInStock] = useState(true);

  const [photoItems, setPhotoItems] = useState<PhotoItem[]>(() => {
    if (initialOrder?.photos?.length) {
      return initialOrder.photos.map((url, idx) => ({
        id: `existing-${idx}-${url}`,
        previewUrl: url,
        existingUrl: url,
        existingPath:
          initialOrder?.photoPaths?.[idx] || (url.startsWith('fsphoto:') ? url : ''),
      }));
    }
    if (seedItem?.photoUrl) {
      return [
        {
          id: `stock-photo-${seedItem.id}`,
          previewUrl: seedItem.photoUrl,
          existingUrl: seedItem.photoUrl,
          existingPath:
            seedItem.photoPath ||
            (seedItem.photoUrl.startsWith('fsphoto:') ? seedItem.photoUrl : ''),
        },
      ];
    }
    return [];
  });
  const [removedPhotoRefs, setRemovedPhotoRefs] = useState<Array<{ url?: string; path?: string }>>([]);
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

  // Build deduplicated returning customer index from order history
  const customerProfiles = useMemo(() => {
    const profiles: (CustomerProfile & { phoneDigits: string; normHandle: string })[] = [];
    const keyToIndex = new Map<string, number>();

    const sorted = [...orders].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    for (const o of sorted) {
      const name = o.customerName.trim();
      const rawPhone = o.phone.trim();
      const digits = normalizePhoneDigits(rawPhone);
      const handle = normalizeHandle(o.socialContact);
      if (!name && !digits && !handle) continue;

      const phoneKey = digits.length >= 6 ? `p:${digits}` : '';
      const handleKey = handle ? `h:${handle}` : '';
      const nameKey = name ? `n:${name.toLowerCase()}` : '';

      let matchedIdx: number | undefined;
      if (phoneKey) matchedIdx = keyToIndex.get(phoneKey);
      if (matchedIdx === undefined && handleKey) matchedIdx = keyToIndex.get(handleKey);
      if (matchedIdx === undefined && nameKey) {
        const candidateIdx = keyToIndex.get(nameKey);
        if (candidateIdx !== undefined) {
          const cand = profiles[candidateIdx];
          const phoneConflict =
            digits.length >= 6 && cand.phoneDigits.length >= 6 && digits !== cand.phoneDigits;
          const handleConflict =
            Boolean(handle) && Boolean(cand.normHandle) && handle !== cand.normHandle;
          if (!phoneConflict && !handleConflict) {
            matchedIdx = candidateIdx;
          }
        }
      }

      const isIssue = o.status === 'CANCELLED' || o.status === 'RETURNED';

      if (matchedIdx !== undefined) {
        const existing = profiles[matchedIdx];
        existing.totalOrders += 1;
        if (isIssue) existing.returnedOrCancelledCount += 1;
        if (!existing.name && name) existing.name = name;
        if (!existing.phone && rawPhone) {
          existing.phone = rawPhone;
          existing.phoneDigits = digits;
        }
        if (!existing.socialContact && o.socialContact.trim()) {
          existing.socialContact = o.socialContact.trim();
          existing.normHandle = handle;
        }
        if (!existing.lastNotes && o.notes.trim()) {
          existing.lastNotes = o.notes.trim();
        }
        if (phoneKey) keyToIndex.set(phoneKey, matchedIdx);
        if (handleKey) keyToIndex.set(handleKey, matchedIdx);
        if (nameKey && !keyToIndex.has(nameKey)) keyToIndex.set(nameKey, matchedIdx);
      } else {
        const primaryKey = phoneKey || handleKey || `${nameKey}:${o.id}`;
        const idx = profiles.length;
        profiles.push({
          key: primaryKey,
          name,
          phone: rawPhone,
          phoneDigits: digits,
          normHandle: handle,
          socialContact: o.socialContact.trim(),
          lastNotes: o.notes.trim(),
          lastProductName: o.productName.trim(),
          lastOrderDate: o.createdAt,
          totalOrders: 1,
          returnedOrCancelledCount: isIssue ? 1 : 0,
        });
        if (phoneKey) keyToIndex.set(phoneKey, idx);
        if (handleKey) keyToIndex.set(handleKey, idx);
        if (nameKey && !keyToIndex.has(nameKey)) keyToIndex.set(nameKey, idx);
      }
    }

    return profiles;
  }, [orders]);

  const matchingCustomers = useMemo(() => {
    if (mode !== 'create' || dismissedSuggestions) return [];
    const nameQ = customerName.trim().toLowerCase();
    const phoneDigitsQ = normalizePhoneDigits(phone);
    const handleQ = normalizeHandle(socialContact);

    const hasQuery = nameQ.length >= 2 || phoneDigitsQ.length >= 3 || handleQ.length >= 2;
    if (!hasQuery) return [];

    return customerProfiles
      .filter((profile) => {
        if (appliedCustomerKey === profile.key) return false;
        const nameHit = nameQ.length >= 2 && profile.name.toLowerCase().includes(nameQ);
        const phoneHit =
          phoneDigitsQ.length >= 3 && normalizePhoneDigits(profile.phone).includes(phoneDigitsQ);
        const handleHit =
          handleQ.length >= 2 && normalizeHandle(profile.socialContact).includes(handleQ);
        return nameHit || phoneHit || handleHit;
      })
      .slice(0, 3);
  }, [
    mode,
    dismissedSuggestions,
    customerProfiles,
    customerName,
    phone,
    socialContact,
    appliedCustomerKey,
  ]);

  const appliedProfile = useMemo(
    () =>
      appliedCustomerKey
        ? customerProfiles.find((p) => p.key === appliedCustomerKey) ?? null
        : null,
    [appliedCustomerKey, customerProfiles]
  );

  function handleApplyCustomerProfile(profile: CustomerProfile) {
    if (profile.name) setCustomerName(profile.name);
    if (profile.phone) setPhone(profile.phone);
    if (profile.socialContact) setSocialContact(profile.socialContact);
    if (profile.lastNotes && !notes.trim()) {
      setNotes(profile.lastNotes);
    }
    setAppliedCustomerKey(profile.key);
  }

  const allInventory = useMemo(() => {
    if (!recentlyAddedStock) return inventory;
    if (inventory.some((i) => i.id === recentlyAddedStock.id)) return inventory;
    return [recentlyAddedStock, ...inventory];
  }, [inventory, recentlyAddedStock]);

  const inventoryById = useMemo(
    () => new Map(allInventory.map((item) => [item.id, item])),
    [allInventory]
  );

  // Quantity currently held by the existing saved order (for edit mode availability calculation)
  const heldByInitialOrder = useMemo(() => {
    const map = new Map<string, number>();
    if (mode !== 'edit' || !initialOrder) return map;
    for (const li of getOrderLineItems(initialOrder)) {
      if (li.inventoryItemId && li.stockDeducted) {
        map.set(li.inventoryItemId, (map.get(li.inventoryItemId) ?? 0) + li.quantity);
      }
    }
    return map;
  }, [mode, initialOrder]);

  const willDeductStock = isStockActiveStatus(status);

  // Requested qty aggregated per inventoryItemId across all draft rows
  const requestedByStockId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of items) {
      if (!row.inventoryItemId) continue;
      map.set(row.inventoryItemId, (map.get(row.inventoryItemId) ?? 0) + row.quantity);
    }
    return map;
  }, [items]);

  const stockConflicts = useMemo(() => {
    const conflicts: string[] = [];
    if (!willDeductStock) return conflicts;
    for (const [invId, reqQty] of requestedByStockId.entries()) {
      const inv = inventoryById.get(invId);
      if (!inv) continue;
      const available = inv.quantity + (heldByInitialOrder.get(invId) ?? 0);
      if (reqQty > available) {
        conflicts.push(
          `Only ${available} left for ${inv.pieceName}${inv.color ? ` (${inv.color})` : ''} — requested ${reqQty}`
        );
      }
    }
    return conflicts;
  }, [willDeductStock, requestedByStockId, inventoryById, heldByInitialOrder]);

  const isOverStock = stockConflicts.length > 0;

  // Live stock suggestions: filtered by stockSearch OR typed text on unlinked row
  const activeTypedRow = useMemo(
    () => items.find((r) => !r.inventoryItemId && (r.productName.trim() || r.color.trim())) ?? null,
    [items]
  );

  const suggestedStock = useMemo(() => {
    const manualQuery = stockSearch.trim().toLowerCase();
    const pieceQuery = activeTypedRow?.productName.trim().toLowerCase() ?? '';
    const colorQuery = activeTypedRow?.color.trim().toLowerCase() ?? '';

    const list = allInventory.filter((item) => {
      if (manualQuery) {
        return (
          item.pieceName.toLowerCase().includes(manualQuery) ||
          item.color.toLowerCase().includes(manualQuery) ||
          item.size.toLowerCase().includes(manualQuery)
        );
      }
      if (pieceQuery || colorQuery) {
        const pieceMatch = !pieceQuery || item.pieceName.toLowerCase().includes(pieceQuery);
        const colorMatch = !colorQuery || item.color.toLowerCase().includes(colorQuery);
        return pieceMatch && colorMatch;
      }
      return true;
    });

    const sorted = [...list].sort((a, b) => {
      if ((a.quantity > 0) !== (b.quantity > 0)) return a.quantity > 0 ? -1 : 1;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    if (sorted.length === 0 && !manualQuery && allInventory.length > 0) {
      return [...allInventory].sort((a, b) => {
        if ((a.quantity > 0) !== (b.quantity > 0)) return a.quantity > 0 ? -1 : 1;
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      });
    }

    return sorted;
  }, [allInventory, stockSearch, activeTypedRow]);

  const hasCompressingPhotos = photoItems.some((p) => p.compressing);

  function computeItemsNumericSum(rows: DraftLineItem[]): string {
    let sum = 0;
    let hasAnyPrice = false;
    for (const row of rows) {
      const cleaned = row.unitPrice.trim();
      if (cleaned && /^\d+(\.\d+)?$/.test(cleaned)) {
        hasAnyPrice = true;
        sum += Number(cleaned) * row.quantity;
      }
    }
    if (!hasAnyPrice) return '';
    return String(Math.round((sum + Number.EPSILON) * 100) / 100);
  }

  const computedSumString = useMemo(() => computeItemsNumericSum(items), [items]);

  function applyItemsAndMaybeSyncTotal(updater: (prev: DraftLineItem[]) => DraftLineItem[]) {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItems(next);

    if (autoFilledPriceRef.current) {
      const nextSum = computeItemsNumericSum(next);
      setTotalAmount(nextSum);
    }
  }

  const catalogPhotos = useMemo(
    () => buildCatalogPhotoOptions(allInventory, orders),
    [allInventory, orders]
  );

  function attachStockPhotoIfSpace(stockItem: InventoryItem) {
    if (!stockItem.photoUrl) return;
    setPhotoItems((prev) => {
      if (prev.length >= 3) return prev;
      if (prev.some((p) => p.existingUrl === stockItem.photoUrl)) return prev;
      return [
        ...prev,
        {
          id: `stock-photo-${stockItem.id}-${Date.now()}`,
          previewUrl: stockItem.photoUrl,
          existingUrl: stockItem.photoUrl,
          existingPath:
            stockItem.photoPath ||
            (stockItem.photoUrl.startsWith('fsphoto:') ? stockItem.photoUrl : ''),
        },
      ];
    });
  }

  function handleSelectCatalogPhoto(photo: CatalogPhotoOption) {
    setError(null);
    setPhotoItems((prev) => {
      if (prev.length >= 3) return prev;
      if (prev.some((p) => p.existingUrl === photo.url)) return prev;
      return [
        ...prev,
        {
          id: `catalog-photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          previewUrl: photo.url,
          existingUrl: photo.url,
          existingPath: photo.path || (photo.url.startsWith('fsphoto:') ? photo.url : ''),
        },
      ];
    });
  }

  function handleSelectStockSuggestion(stockItem: InventoryItem, targetRowId?: string) {
    const availableForItem = stockItem.quantity + (heldByInitialOrder.get(stockItem.id) ?? 0);
    const currentInOrder = requestedByStockId.get(stockItem.id) ?? 0;
    if (willDeductStock && !targetRowId && currentInOrder >= availableForItem) {
      setError(
        availableForItem <= 0
          ? `${stockItem.pieceName} is out of stock.`
          : `All ${availableForItem} available units of ${stockItem.pieceName} are already in this order.`
      );
      return;
    }

    setError(null);
    attachStockPhotoIfSpace(stockItem);

    applyItemsAndMaybeSyncTotal((prev) => {
      if (targetRowId) {
        return prev.map((row) =>
          row.rowId === targetRowId
            ? {
                ...row,
                inventoryItemId: stockItem.id,
                productName: stockItem.pieceName,
                color: stockItem.color,
                size: stockItem.size || row.size,
                unitPrice: stockItem.unitPrice || row.unitPrice,
              }
            : row
        );
      }

      // If this stock piece is already in the order, increment its quantity
      const existingIdx = prev.findIndex((r) => r.inventoryItemId === stockItem.id);
      if (existingIdx >= 0) {
        return prev.map((row, idx) =>
          idx === existingIdx ? { ...row, quantity: Math.min(10000, row.quantity + 1) } : row
        );
      }

      // Otherwise fill the first empty unlinked row if available
      const emptyIdx = prev.findIndex(
        (r) =>
          !r.inventoryItemId &&
          !r.productName.trim() &&
          !r.color.trim() &&
          !r.size.trim() &&
          !r.unitPrice.trim()
      );
      if (emptyIdx >= 0) {
        return prev.map((row, idx) =>
          idx === emptyIdx
            ? {
                ...row,
                inventoryItemId: stockItem.id,
                productName: stockItem.pieceName,
                color: stockItem.color,
                size: stockItem.size,
                unitPrice: stockItem.unitPrice,
              }
            : row
        );
      }

      // Otherwise append as a new piece in this multi-piece order
      if (prev.length >= 15) return prev;
      return [
        ...prev,
        {
          rowId: makeRowId(),
          inventoryItemId: stockItem.id,
          productName: stockItem.pieceName,
          color: stockItem.color,
          size: stockItem.size,
          quantity: 1,
          unitPrice: stockItem.unitPrice,
          stockDeducted: false,
        },
      ];
    });

    setStockSearch('');
  }

  function handleUnlinkRowStock(rowId: string) {
    setError(null);
    const next = itemsRef.current.map((row) =>
      row.rowId === rowId ? { ...row, inventoryItemId: '', stockDeducted: false } : row
    );
    itemsRef.current = next;
    setItems(next);
  }

  function handleRemoveRow(rowId: string) {
    applyItemsAndMaybeSyncTotal((prev) => {
      if (prev.length <= 1) return [emptyDraftRow()];
      return prev.filter((row) => row.rowId !== rowId);
    });
  }

  function handleUpdateRow(rowId: string, patch: Partial<DraftLineItem>) {
    applyItemsAndMaybeSyncTotal((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row))
    );
  }

  function handleAddEmptyRow() {
    if (items.length >= 15) return;
    setItems((prev) => [...prev, emptyDraftRow()]);
  }

  function handleOpenQuickAddStock(row?: DraftLineItem) {
    setQuickStockTargetRowId(row?.rowId ?? null);
    setQuickStockValues({
      pieceName: row?.productName.trim() ?? '',
      color: row?.color.trim() ?? '',
      size: row?.size.trim() ?? '',
      quantity: String(Math.max(1, row?.quantity ?? 1)),
      lowStockThreshold: '3',
      unitPrice: row?.unitPrice.trim() || totalAmount.trim(),
      notes: '',
    });
    setReuseOrderPhotoInStock(photoItems.length > 0);
    setQuickStockError(null);
    setQuickStockOpen(true);
  }

  async function handleQuickAddStockSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationErr = validateInventoryForm(quickStockValues);
    if (validationErr) {
      setQuickStockError(validationErr);
      return;
    }
    const firstOrderPhoto = reuseOrderPhotoInStock ? photoItems[0] : undefined;
    if (firstOrderPhoto?.compressing) {
      setQuickStockError('Please wait a moment while the photo finishes optimizing.');
      return;
    }

    setQuickStockBusy(true);
    setQuickStockError(null);
    try {
      const canReuseExisting = Boolean(firstOrderPhoto?.existingUrl);
      const localPhotoInput: NewPhotoInput | null =
        firstOrderPhoto && !canReuseExisting
          ? firstOrderPhoto.compressed ?? firstOrderPhoto.file ?? null
          : null;
      const existingPhotoRef =
        firstOrderPhoto && canReuseExisting
          ? {
              url: firstOrderPhoto.existingUrl!,
              path:
                firstOrderPhoto.existingPath ||
                (firstOrderPhoto.existingUrl!.startsWith('fsphoto:')
                  ? firstOrderPhoto.existingUrl!
                  : ''),
            }
          : null;

      const created = await createInventoryItem(
        quickStockValues,
        localPhotoInput,
        user,
        settings,
        existingPhotoRef
      );

      if (firstOrderPhoto && !canReuseExisting && created.photoUrl) {
        setPhotoItems((prev) =>
          prev.map((p) => {
            if (p.id !== firstOrderPhoto.id) return p;
            if (p.previewUrl.startsWith('blob:')) {
              URL.revokeObjectURL(p.previewUrl);
              createdBlobUrlsRef.current.delete(p.previewUrl);
            }
            return {
              id: p.id,
              previewUrl: created.photoUrl,
              existingUrl: created.photoUrl,
              existingPath: created.photoPath,
            };
          })
        );
      }

      setRecentlyAddedStock(created);
      onInventoryCreated?.(created);
      handleSelectStockSuggestion(created, quickStockTargetRowId ?? undefined);
      setQuickStockTargetRowId(null);
      setQuickStockOpen(false);
    } catch (err) {
      setQuickStockError(getUserFriendlyError(err, 'Could not add piece to inventory.'));
    } finally {
      setQuickStockBusy(false);
    }
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
        .catch((err) => {
          setError(getUserFriendlyError(err, 'Could not process the selected photo.'));
          setPhotoItems((prev) => {
            const target = prev.find((p) => p.id === item.id);
            if (target?.previewUrl.startsWith('blob:')) {
              URL.revokeObjectURL(target.previewUrl);
              createdBlobUrlsRef.current.delete(target.previewUrl);
            }
            return prev.filter((p) => p.id !== item.id);
          });
        });
    }
  }

  function handleRemovePhoto(id: string) {
    const target = photoItems.find((p) => p.id === id);
    if (!target) return;
    if (target.existingUrl || target.existingPath) {
      setRemovedPhotoRefs((prev) => [
        ...prev,
        { url: target.existingUrl, path: target.existingPath },
      ]);
    }
    if (target.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(target.previewUrl);
      createdBlobUrlsRef.current.delete(target.previewUrl);
    }
    setPhotoItems((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (hasCompressingPhotos) {
      setError('Finishing photo optimization — just a moment.');
      return;
    }

    if (isOverStock) {
      setError(stockConflicts[0]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const values: OrderFormValues = {
      customerName,
      phone,
      socialContact,
      notes,
      totalAmount,
      paidAmount,
      remainingAmount,
      status,
      items: items.map(({ rowId: _rowId, ...rest }) => rest),
    };

    const validationError = validateOrderForm(values, photoItems.length);
    if (validationError) {
      setError(validationError);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const newPhotos: NewPhotoInput[] = [];
    for (const item of photoItems) {
      if (item.compressed) newPhotos.push(item.compressed);
      else if (item.file) newPhotos.push(item.file);
    }

    const reusedPhotos = photoItems
      .filter((p) => Boolean(p.existingUrl))
      .map((p) => ({
        url: p.existingUrl as string,
        path:
          p.existingPath || (p.existingUrl?.startsWith('fsphoto:') ? p.existingUrl : ''),
      }));

    setSubmitting(true);
    setSaveStage(newPhotos.length > 0 ? 'Uploading photos...' : 'Saving order...');
    try {
      if (mode === 'create') {
        const created = await createOrder(
          values,
          newPhotos,
          user,
          settings,
          setSaveStage,
          reusedPhotos
        );
        onSuccess(created);
      } else if (initialOrder) {
        const keptPhotos = reusedPhotos.map((p) => p.url);
        const keptPaths = reusedPhotos.map((p) => p.path).filter(Boolean);

        await updateOrder(
          initialOrder,
          values,
          keptPhotos,
          keptPaths,
          newPhotos,
          removedPhotoRefs,
          user,
          setSaveStage,
          orders,
          allInventory
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

  const showQuickRemainingHelper = useMemo(() => {
    const t = totalAmount.trim();
    const p = paidAmount.trim();
    if (!/^\d+(\.\d+)?$/.test(t) || !/^\d+(\.\d+)?$/.test(p)) return null;
    const diff = Math.round((Number(t) - Number(p) + Number.EPSILON) * 100) / 100;
    if (!Number.isFinite(diff) || diff < 0) return null;
    if (remainingAmount.trim() === String(diff)) return null;
    return String(diff);
  }, [totalAmount, paidAmount, remainingAmount]);

  const totalUnitsCount = useMemo(
    () => items.reduce((sum, r) => sum + r.quantity, 0),
    [items]
  );

  return (
    <>
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
                  ? 'All fields optional · Multi-piece & stock-synced'
                  : 'All fields optional · Multi-piece & stock-synced'}
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

        {/* 1. Customer & Returning Customer Auto-Fill */}
        <section className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#121211] tracking-tight">Customer</h2>
            {appliedProfile && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800">
                <UserCheck className="w-3.5 h-3.5" />
                <span>
                  Returning · {appliedProfile.totalOrders} past{' '}
                  {appliedProfile.totalOrders === 1 ? 'order' : 'orders'}
                </span>
                {appliedProfile.lastNotes && notes.trim() !== appliedProfile.lastNotes && (
                  <button
                    type="button"
                    onClick={() => setNotes(appliedProfile.lastNotes)}
                    className="ml-1 underline underline-offset-2 text-[#121211] cursor-pointer"
                  >
                    Fill last notes
                  </button>
                )}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="customerName" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                Customer name
              </label>
              <input
                id="customerName"
                type="text"
                autoFocus={mode === 'create' && !seedItem}
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setAppliedCustomerKey(null);
                  setDismissedSuggestions(false);
                }}
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
                onChange={(e) => {
                  setPhone(e.target.value);
                  setAppliedCustomerKey(null);
                  setDismissedSuggestions(false);
                }}
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
                onChange={(e) => {
                  setSocialContact(e.target.value);
                  setAppliedCustomerKey(null);
                  setDismissedSuggestions(false);
                }}
                placeholder="e.g. @ananya.s"
                className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
              />
            </div>
          </div>

          {matchingCustomers.length > 0 && (
            <div className="rounded-xl border border-[#E6E2D8] bg-[#FAF9F5] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#121211]">
                  <UserCheck className="w-3.5 h-3.5 text-[#5C5852]" />
                  <span>Returning Customer Match — tap to auto-fill</span>
                </span>
                <button
                  type="button"
                  onClick={() => setDismissedSuggestions(true)}
                  className="text-[11px] text-[#8C877E] hover:text-[#121211] cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {matchingCustomers.map((profile) => (
                  <button
                    key={profile.key}
                    type="button"
                    onClick={() => handleApplyCustomerProfile(profile)}
                    className="text-left p-2.5 rounded-xl border border-[#DDD8CE] bg-white hover:border-[#121211] transition-colors space-y-1 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-[#121211] truncate">
                        {profile.name || profile.socialContact || profile.phone}
                      </p>
                      <span className="text-[11px] font-mono text-[#5C5852] tabular-nums shrink-0">
                        {profile.totalOrders} {profile.totalOrders === 1 ? 'order' : 'orders'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#5C5852] truncate">
                      {[profile.phone, profile.socialContact].filter(Boolean).join(' · ') ||
                        `Last ${formatShortDate(profile.lastOrderDate)}`}
                    </p>
                    {profile.lastNotes && (
                      <p className="text-[11px] text-[#8C877E] truncate">
                        Notes: {profile.lastNotes}
                      </p>
                    )}
                    {profile.returnedOrCancelledCount > 0 && (
                      <p className="text-[11px] font-medium text-amber-800 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span>
                          {profile.returnedOrCancelledCount} past cancelled/returned
                        </span>
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 2. Pieces, Live Stock Suggestions & Photos */}
        <section className="bg-white border border-[#E6E2D8] rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[#121211] tracking-tight">
                Pieces & Stock
                {items.length > 1 ? ` · ${items.length} items (${totalUnitsCount} pcs)` : ''}
              </h2>
              <p className="text-xs text-[#8C877E] mt-0.5">
                Tap stock pieces below to add them & sync inventory, or enter custom text.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                handleOpenQuickAddStock(
                  items.length === 1 && !items[0].inventoryItemId ? items[0] : undefined
                )
              }
              className="min-h-[36px] px-3 py-1.5 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] hover:bg-[#EFECE5] text-xs font-medium text-[#121211] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-[#5C5852]" />
              <span>Add Stock Piece</span>
            </button>
          </div>

          {/* Always-Visible Live Stock Suggestions Shelf */}
          <div className="rounded-xl border border-[#E6E2D8] bg-[#FAF9F5] p-3.5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#121211]">
                <Package className="w-3.5 h-3.5 text-[#5C5852]" />
                <span>
                  In Stock Suggestions ({allInventory.filter((i) => i.quantity > 0).length} ready) ·
                  Tap to add
                </span>
              </span>

              {allInventory.length > 3 && (
                <div className="relative sm:w-56">
                  <Search className="w-3.5 h-3.5 text-[#8C877E] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={stockSearch}
                    onChange={(e) => setStockSearch(e.target.value)}
                    placeholder="Filter stock..."
                    className="w-full min-h-[34px] pl-8 pr-2.5 py-1 rounded-lg border border-[#DDD8CE] bg-white text-xs focus:border-[#121211] focus:outline-none"
                  />
                </div>
              )}
            </div>

            {allInventory.length === 0 ? (
              <div className="py-3 text-center space-y-2">
                <p className="text-xs text-[#5C5852]">
                  No pieces in your inventory yet. Add pieces to get instant suggestions & automatic
                  stock deduction.
                </p>
                <button
                  type="button"
                  onClick={() => handleOpenQuickAddStock()}
                  className="min-h-[34px] px-3 py-1.5 rounded-lg bg-[#121211] text-[#F7F5F0] text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add your first stock piece</span>
                </button>
              </div>
            ) : suggestedStock.length === 0 ? (
              <p className="text-xs text-[#8C877E] py-2 text-center">
                No stock pieces match &ldquo;{stockSearch}&rdquo;.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-0.5">
                {suggestedStock.map((item) => {
                  const qtyInOrder = requestedByStockId.get(item.id) ?? 0;
                  const state = getStockState(item);
                  const out = item.quantity <= 0 && qtyInOrder === 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={out}
                      onClick={() => handleSelectStockSuggestion(item)}
                      className={`text-left p-2.5 rounded-xl border flex items-center gap-2.5 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                        qtyInOrder > 0
                          ? 'border-[#121211] bg-white'
                          : 'border-[#E6E2D8] bg-white hover:border-[#121211]/50'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-lg overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] shrink-0 flex items-center justify-center">
                        <OrderPhoto
                          src={item.photoUrl}
                          alt={item.pieceName}
                          className="w-full h-full object-cover"
                          iconClassName="w-4 h-4 text-[#8C877E]"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[#121211] truncate">
                          {item.pieceName}
                        </p>
                        <p className="text-[11px] text-[#5C5852] truncate">
                          {[
                            item.color,
                            item.size ? `Size ${item.size}` : '',
                            item.unitPrice
                              ? formatAmountDisplay(item.unitPrice, settings.currency)
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'Standard'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={`font-mono text-xs font-semibold tabular-nums ${
                            state === 'out'
                              ? 'text-rose-700'
                              : state === 'low'
                                ? 'text-amber-800'
                                : 'text-emerald-800'
                          }`}
                        >
                          {item.quantity <= 0 ? 'Out' : `${item.quantity} left`}
                        </p>
                        {qtyInOrder > 0 && (
                          <p className="text-[10px] font-semibold text-[#121211] inline-flex items-center gap-0.5 justify-end">
                            <Check className="w-3 h-3" />
                            <span>In order ×{qtyInOrder}</span>
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Line Items List */}
          <div className="space-y-3">
            {items.map((row, idx) => {
              const linkedInv = row.inventoryItemId
                ? inventoryById.get(row.inventoryItemId) ?? null
                : null;
              const availableForItem = linkedInv
                ? linkedInv.quantity + (heldByInitialOrder.get(linkedInv.id) ?? 0)
                : null;
              const totalReqForItem = row.inventoryItemId
                ? requestedByStockId.get(row.inventoryItemId) ?? row.quantity
                : row.quantity;
              const rowOverStock =
                willDeductStock &&
                availableForItem !== null &&
                totalReqForItem > availableForItem;
              const projectedAfter =
                availableForItem !== null && willDeductStock
                  ? Math.max(0, availableForItem - totalReqForItem)
                  : availableForItem;

              // Exact match suggestion if row is unlinked & user typed piece name manually
              const pName = row.productName.trim().toLowerCase();
              const pColor = row.color.trim().toLowerCase();
              const exactMatches =
                !linkedInv && pName
                  ? allInventory.filter(
                      (inv) =>
                        inv.quantity > 0 &&
                        inv.pieceName.trim().toLowerCase() === pName &&
                        (!pColor || inv.color.trim().toLowerCase() === pColor)
                    )
                  : [];
              const exactMatch = exactMatches.length === 1 ? exactMatches[0] : null;

              return (
                <div
                  key={row.rowId}
                  className={`rounded-xl border p-3.5 sm:p-4 space-y-3 ${
                    rowOverStock
                      ? 'border-rose-300 bg-rose-50/50'
                      : linkedInv
                        ? 'border-[#121211]/25 bg-[#FAF9F5]/60'
                        : 'border-[#E6E2D8] bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#121211]">
                        {items.length > 1 ? `Piece #${idx + 1}` : 'Piece Details'}
                        {linkedInv ? ` · Stock Linked` : ''}
                      </p>
                      {linkedInv && (
                        <p
                          className={`text-xs font-mono tabular-nums mt-0.5 ${
                            rowOverStock
                              ? 'text-rose-700 font-semibold'
                              : 'text-emerald-900 font-medium'
                          }`}
                        >
                          {rowOverStock
                            ? `Only ${availableForItem} available in stock (requested ${totalReqForItem})`
                            : willDeductStock
                              ? `Stock sync: ${availableForItem} in stock → ${projectedAfter} left after saving`
                              : `Status is ${status} · Stock stays at ${availableForItem}`}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="inline-flex items-center gap-1">
                        <span className="text-xs text-[#5C5852] mr-1">Qty</span>
                        <button
                          type="button"
                          disabled={row.quantity <= 1}
                          onClick={() =>
                            handleUpdateRow(row.rowId, {
                              quantity: Math.max(1, row.quantity - 1),
                            })
                          }
                          className="w-7 h-7 rounded-lg border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] disabled:opacity-40 flex items-center justify-center cursor-pointer"
                          aria-label="Decrease quantity"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="min-w-[24px] text-center font-mono text-xs font-semibold tabular-nums">
                          {row.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateRow(row.rowId, {
                              quantity: Math.min(10000, row.quantity + 1),
                            })
                          }
                          className="w-7 h-7 rounded-lg border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] flex items-center justify-center cursor-pointer"
                          aria-label="Increase quantity"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {linkedInv && (
                        <button
                          type="button"
                          onClick={() => handleUnlinkRowStock(row.rowId)}
                          className="min-h-[30px] px-2.5 py-1 rounded-lg border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] text-[11px] font-medium text-[#5C5852] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Unlink className="w-3 h-3" />
                          <span>Unlink</span>
                        </button>
                      )}

                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.rowId)}
                          className="w-7 h-7 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 flex items-center justify-center cursor-pointer"
                          aria-label="Remove piece"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-5">
                      <label className="block text-[11px] font-medium text-[#5C5852] mb-1">
                        Piece / product name
                      </label>
                      <input
                        type="text"
                        value={row.productName}
                        onChange={(e) =>
                          handleUpdateRow(row.rowId, { productName: e.target.value })
                        }
                        placeholder="e.g. Draped Linen Set"
                        className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-[#5C5852] mb-1">
                        Size
                      </label>
                      <input
                        type="text"
                        value={row.size}
                        onChange={(e) => handleUpdateRow(row.rowId, { size: e.target.value })}
                        placeholder="e.g. M"
                        className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-medium text-[#5C5852] mb-1">
                        Color
                      </label>
                      <input
                        type="text"
                        value={row.color}
                        onChange={(e) => handleUpdateRow(row.rowId, { color: e.target.value })}
                        placeholder="e.g. Ivory"
                        className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-[#5C5852] mb-1">
                        Unit price
                      </label>
                      <input
                        type="text"
                        value={row.unitPrice}
                        onChange={(e) =>
                          handleUpdateRow(row.rowId, { unitPrice: e.target.value })
                        }
                        placeholder="e.g. 2200"
                        className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm font-mono tabular-nums"
                      />
                    </div>
                  </div>

                  {exactMatch && (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2">
                      <p className="text-xs text-emerald-950">
                        Found in stock:{' '}
                        <span className="font-semibold">
                          {exactMatch.pieceName}
                          {exactMatch.color ? ` (${exactMatch.color})` : ''}
                        </span>{' '}
                        · {exactMatch.quantity} left
                      </p>
                      <button
                        type="button"
                        onClick={() => handleSelectStockSuggestion(exactMatch, row.rowId)}
                        className="px-2.5 py-1 rounded-lg bg-[#121211] text-[#F7F5F0] text-[11px] font-medium shrink-0 cursor-pointer"
                      >
                        Link & Auto-Deduct
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {items.length < 15 && (
              <button
                type="button"
                onClick={handleAddEmptyRow}
                className="w-full min-h-[42px] px-4 py-2 rounded-xl border border-dashed border-[#D2CCC0] bg-[#FAF9F5] hover:bg-[#EFECE5] text-xs font-medium text-[#121211] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Another Piece to This Order</span>
              </button>
            )}
          </div>

          <PhotoUploader
            items={photoItems}
            onAddFiles={handleAddFiles}
            onRemoveItem={handleRemovePhoto}
            maxPhotos={3}
            catalogPhotos={catalogPhotos}
            onSelectCatalogPhoto={handleSelectCatalogPhoto}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#121211] tracking-tight">Payment Amounts</h2>
            <div className="flex flex-wrap items-center gap-3">
              {computedSumString && totalAmount.trim() !== computedSumString && (
                <button
                  type="button"
                  onClick={() => {
                    setTotalAmount(computedSumString);
                    autoFilledPriceRef.current = true;
                  }}
                  className="text-xs font-medium text-[#121211] underline underline-offset-2 hover:opacity-75 cursor-pointer"
                >
                  Use pieces sum ({formatAmountDisplay(computedSumString, settings.currency)})
                </button>
              )}
              {showQuickRemainingHelper !== null && (
                <button
                  type="button"
                  onClick={() => setRemainingAmount(showQuickRemainingHelper)}
                  className="text-xs font-medium text-[#121211] underline underline-offset-2 hover:opacity-75 cursor-pointer"
                >
                  Set remaining to {formatAmountDisplay(showQuickRemainingHelper, settings.currency)}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="totalAmount" className="block text-xs font-medium text-[#5C5852] mb-1.5">
                Total amount
              </label>
              <input
                id="totalAmount"
                type="text"
                value={totalAmount}
                onChange={(e) => {
                  autoFilledPriceRef.current = false;
                  setTotalAmount(e.target.value);
                }}
                placeholder="e.g. 2500"
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
                placeholder="e.g. 1000"
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
                placeholder="e.g. 1500"
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
            disabled={submitting || hasCompressingPhotos || isOverStock}
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
            disabled={submitting || hasCompressingPhotos || isOverStock}
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

      {/* Quick Add Stock Modal (right inside OrderForm) */}
      {quickStockOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleQuickAddStockSubmit}
            className="w-full sm:max-w-md bg-white border border-[#E6E2D8] rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8C877E]">
                  Inventory & Auto-Link
                </p>
                <h2 className="text-xl font-display font-semibold text-[#121211]">
                  Add Stock Piece
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setQuickStockOpen(false)}
                className="min-h-[40px] min-w-[40px] rounded-xl border border-[#E6E2D8] hover:bg-[#F7F5F0] flex items-center justify-center cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {quickStockError && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-medium text-rose-800">
                {quickStockError}
              </div>
            )}

            <div>
              <label htmlFor="qsPiece" className="block text-xs font-medium text-[#5C5852] mb-1">
                Piece name *
              </label>
              <input
                id="qsPiece"
                type="text"
                required
                autoFocus
                value={quickStockValues.pieceName}
                onChange={(e) =>
                  setQuickStockValues((v) => ({ ...v, pieceName: e.target.value }))
                }
                placeholder="e.g. Draped Linen Set"
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="qsColor" className="block text-xs font-medium text-[#5C5852] mb-1">
                  Color
                </label>
                <input
                  id="qsColor"
                  type="text"
                  value={quickStockValues.color}
                  onChange={(e) => setQuickStockValues((v) => ({ ...v, color: e.target.value }))}
                  placeholder="e.g. Ivory"
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
                />
              </div>
              <div>
                <label htmlFor="qsSize" className="block text-xs font-medium text-[#5C5852] mb-1">
                  Size
                </label>
                <input
                  id="qsSize"
                  type="text"
                  value={quickStockValues.size}
                  onChange={(e) => setQuickStockValues((v) => ({ ...v, size: e.target.value }))}
                  placeholder="e.g. Free Size"
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="qsQty" className="block text-xs font-medium text-[#5C5852] mb-1">
                  Quantity in stock
                </label>
                <input
                  id="qsQty"
                  type="number"
                  min={1}
                  max={100000}
                  value={quickStockValues.quantity}
                  onChange={(e) =>
                    setQuickStockValues((v) => ({ ...v, quantity: e.target.value }))
                  }
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="qsPrice" className="block text-xs font-medium text-[#5C5852] mb-1">
                  Default price
                </label>
                <input
                  id="qsPrice"
                  type="text"
                  value={quickStockValues.unitPrice}
                  onChange={(e) =>
                    setQuickStockValues((v) => ({ ...v, unitPrice: e.target.value }))
                  }
                  placeholder="e.g. 2500"
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#DDD8CE] bg-[#FAF9F5] focus:bg-white focus:border-[#121211] focus:outline-none text-sm font-mono tabular-nums"
                />
              </div>
            </div>

            {photoItems.length > 0 && (
              <label className="flex items-center gap-3 rounded-xl border border-[#E6E2D8] bg-[#FAF9F5] p-2.5 cursor-pointer">
                <div className="w-10 h-10 rounded-lg overflow-hidden border border-[#E6E2D8] bg-white shrink-0 flex items-center justify-center">
                  <OrderPhoto
                    src={photoItems[0].previewUrl}
                    alt="Order photo preview"
                    className="w-full h-full object-cover"
                    lazy={false}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[#121211]">
                    Reuse order photo for this stock piece
                  </p>
                  <p className="text-[11px] text-[#8C877E]">
                    Shares 1 stored image between inventory &amp; order
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={reuseOrderPhotoInStock}
                  onChange={(e) => setReuseOrderPhotoInStock(e.target.checked)}
                  className="w-4 h-4 accent-[#121211] cursor-pointer"
                />
              </label>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={quickStockBusy}
                onClick={() => setQuickStockOpen(false)}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-[#DDD8CE] text-sm font-medium text-[#5C5852] hover:bg-[#F7F5F0] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  quickStockBusy ||
                  (reuseOrderPhotoInStock && Boolean(photoItems[0]?.compressing))
                }
                className="min-h-[42px] px-5 py-2 rounded-xl bg-[#121211] text-[#F7F5F0] text-sm font-medium hover:bg-[#272624] disabled:opacity-60 inline-flex items-center gap-2 cursor-pointer"
              >
                {quickStockBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Save & Link to Order</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
