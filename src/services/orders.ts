import type { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { OWNER_EMAIL, db } from '../firebase/config';
import { OperationType, handleFirestoreError } from '../firebase/errors';
import type {
  Order,
  OrderFormValues,
  OrderLineItem,
  OrderStatus,
  StoreSettings,
} from '../types/order';
import { parseAmountNumber } from '../utils/payment';
import {
  type CompressedPhoto,
  compressImageToTarget,
  deleteStoragePaths,
  uploadPreparedOrderPhotos,
} from './storage';

function toDateSafe(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return new Date();
}

function normalizeAmountField(value: unknown): string | number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return value;
  return '';
}

function normalizeOrderQty(value: unknown): number {
  const num = Number(value);
  if (Number.isFinite(num) && num >= 1) {
    return Math.min(10000, Math.floor(num));
  }
  return 1;
}

export function isStockActiveStatus(status: OrderStatus): boolean {
  return status !== 'CANCELLED' && status !== 'RETURNED';
}

function sanitizeLineItem(raw: Partial<OrderLineItem>, fallbackStockDeducted = false): OrderLineItem {
  return {
    inventoryItemId: String(raw.inventoryItemId ?? '').trim().slice(0, 128),
    productName: String(raw.productName ?? '').trim().slice(0, 160),
    color: String(raw.color ?? '').trim().slice(0, 60),
    size: String(raw.size ?? '').trim().slice(0, 60),
    quantity: normalizeOrderQty(raw.quantity),
    unitPrice: String(raw.unitPrice ?? '').trim().slice(0, 60),
    stockDeducted: Boolean(raw.stockDeducted ?? fallbackStockDeducted),
  };
}

function isLineItemEmpty(item: OrderLineItem): boolean {
  return (
    !item.inventoryItemId &&
    !item.productName &&
    !item.color &&
    !item.size &&
    !item.unitPrice &&
    item.quantity <= 1
  );
}

export function getOrderLineItems(
  order: Pick<
    Order,
    'items' | 'productName' | 'color' | 'size' | 'inventoryItemId' | 'orderQuantity' | 'stockDeducted'
  >
): OrderLineItem[] {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items.map((item) => sanitizeLineItem(item, order.stockDeducted));
  }
  const hasLegacyDetails = Boolean(
    order.productName?.trim() ||
      order.color?.trim() ||
      order.size?.trim() ||
      order.inventoryItemId?.trim() ||
      order.orderQuantity > 1
  );
  if (!hasLegacyDetails) return [];
  return [
    {
      inventoryItemId: order.inventoryItemId || '',
      productName: order.productName || '',
      color: order.color || '',
      size: order.size || '',
      quantity: normalizeOrderQty(order.orderQuantity),
      unitPrice: '',
      stockDeducted: Boolean(order.stockDeducted),
    },
  ];
}

function joinBoundedUnique(values: string[], maxLen: number): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const val of values) {
    const trimmed = val.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  if (unique.length === 0) return '';
  const joined = unique.join(', ');
  if (joined.length <= maxLen) return joined;
  return `${unique[0].slice(0, Math.max(0, maxLen - 12))} + ${unique.length - 1} more`.slice(
    0,
    maxLen
  );
}

function summarizeLineItems(items: OrderLineItem[]): {
  productName: string;
  color: string;
  size: string;
  inventoryItemId: string;
  orderQuantity: number;
} {
  if (items.length === 0) {
    return {
      productName: '',
      color: '',
      size: '',
      inventoryItemId: '',
      orderQuantity: 1,
    };
  }
  if (items.length === 1) {
    const first = items[0];
    return {
      productName: first.productName.slice(0, 160),
      color: first.color.slice(0, 60),
      size: first.size.slice(0, 60),
      inventoryItemId: first.inventoryItemId.slice(0, 128),
      orderQuantity: normalizeOrderQty(first.quantity),
    };
  }

  const totalQty = items.reduce((acc, item) => acc + normalizeOrderQty(item.quantity), 0);
  const firstName = items.find((i) => i.productName.trim())?.productName.trim() ?? '';
  const namesJoined = joinBoundedUnique(
    items.map((i) => i.productName),
    160
  );
  const productName =
    namesJoined || (firstName ? `${firstName} + ${items.length - 1} more`.slice(0, 160) : `${items.length} pieces`);

  return {
    productName,
    color: joinBoundedUnique(
      items.map((i) => i.color),
      60
    ),
    size: joinBoundedUnique(
      items.map((i) => i.size),
      60
    ),
    inventoryItemId: items.find((i) => i.inventoryItemId)?.inventoryItemId ?? '',
    orderQuantity: Math.min(10000, Math.max(1, totalQty)),
  };
}

function mapDocToOrder(id: string, data: Record<string, unknown>): Order {
  const rawItems = Array.isArray(data.items)
    ? data.items
        .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
        .map((entry) =>
          sanitizeLineItem({
            inventoryItemId: String(entry.inventoryItemId ?? ''),
            productName: String(entry.productName ?? ''),
            color: String(entry.color ?? ''),
            size: String(entry.size ?? ''),
            quantity: Number(entry.quantity ?? 1),
            unitPrice: String(entry.unitPrice ?? ''),
            stockDeducted: Boolean(entry.stockDeducted),
          })
        )
    : [];

  return {
    id,
    orderNumber: String(data.orderNumber ?? ''),
    customerName: String(data.customerName ?? ''),
    phone: String(data.phone ?? ''),
    platform: (data.platform as Order['platform']) ?? '',
    socialContact: String(data.socialContact ?? ''),
    productName: String(data.productName ?? ''),
    photos: Array.isArray(data.photos) ? data.photos.map(String) : [],
    photoPaths: Array.isArray(data.photoPaths) ? data.photoPaths.map(String) : [],
    size: String(data.size ?? ''),
    color: String(data.color ?? ''),
    notes: String(data.notes ?? ''),
    productAmount: normalizeAmountField(data.productAmount),
    deliveryCharge: normalizeAmountField(data.deliveryCharge),
    deliveryArea: (data.deliveryArea as Order['deliveryArea']) ?? '',
    paymentType: (data.paymentType as Order['paymentType']) ?? '',
    totalAmount: normalizeAmountField(data.totalAmount),
    paidAmount: normalizeAmountField(data.paidAmount),
    remainingAmount: normalizeAmountField(data.remainingAmount),
    status: (data.status as OrderStatus) ?? 'NEW',
    inventoryItemId: String(data.inventoryItemId ?? ''),
    orderQuantity: normalizeOrderQty(data.orderQuantity),
    stockDeducted: Boolean(data.stockDeducted),
    items: rawItems,
    createdAt: toDateSafe(data.createdAt),
    updatedAt: toDateSafe(data.updatedAt),
    createdByUid: String(data.createdByUid ?? ''),
    teamEmails: Array.isArray(data.teamEmails) ? data.teamEmails.map(String) : [OWNER_EMAIL],
  };
}

export function validateOrderForm(values: OrderFormValues, totalPhotosCount: number): string | null {
  if (values.customerName.trim().length > 120) return 'Customer name must be 120 characters or fewer.';
  if (values.phone.trim().length > 30) return 'Phone number must be 30 characters or fewer.';
  if (values.socialContact.trim().length > 120) return 'Contact/username must be 120 characters or fewer.';
  if (totalPhotosCount > 3) return 'Maximum 3 product photos allowed per order.';
  if (values.notes.length > 1000) return 'Special notes must be 1000 characters or fewer.';
  if (values.totalAmount.trim().length > 60) return 'Total amount must be 60 characters or fewer.';
  if (values.paidAmount.trim().length > 60) return 'Paid amount must be 60 characters or fewer.';
  if (values.remainingAmount.trim().length > 60) return 'Remaining amount must be 60 characters or fewer.';
  if (values.items.length > 15) return 'Maximum 15 pieces allowed per order.';

  for (let i = 0; i < values.items.length; i++) {
    const item = values.items[i];
    if (item.productName.trim().length > 160) {
      return `Piece #${i + 1} name must be 160 characters or fewer.`;
    }
    if (item.size.trim().length > 60) {
      return `Piece #${i + 1} size must be 60 characters or fewer.`;
    }
    if (item.color.trim().length > 60) {
      return `Piece #${i + 1} color must be 60 characters or fewer.`;
    }
    if (item.unitPrice.trim().length > 60) {
      return `Piece #${i + 1} price must be 60 characters or fewer.`;
    }
    if (
      !Number.isFinite(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 10000 ||
      !Number.isInteger(item.quantity)
    ) {
      return `Piece #${i + 1} quantity must be a whole number of at least 1.`;
    }
  }

  return null;
}

export function buildTeamEmails(settings: StoreSettings, currentUserEmail: string | null): string[] {
  const set = new Set<string>([OWNER_EMAIL]);
  for (const email of settings.partnerEmails) {
    const normalized = email.trim().toLowerCase();
    if (normalized) set.add(normalized);
  }
  if (currentUserEmail) {
    set.add(currentUserEmail.trim().toLowerCase());
  }
  return Array.from(set).slice(0, 5);
}

export function subscribeToOrders(
  userEmail: string,
  onData: (orders: Order[]) => void,
  onError: (error: unknown) => void
): () => void {
  const normalized = userEmail.trim().toLowerCase();
  const isOwner = normalized === OWNER_EMAIL;

  const q = isOwner
    ? query(collection(db, 'orders'), orderBy('createdAt', 'desc'))
    : query(collection(db, 'orders'), where('teamEmails', 'array-contains', normalized));

  return onSnapshot(
    q,
    (snapshot) => {
      const orders = snapshot.docs.map((docSnap) =>
        mapDocToOrder(docSnap.id, docSnap.data() as Record<string, unknown>)
      );
      orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      onData(orders);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'orders');
      } catch (wrapped) {
        onError(wrapped);
      }
    }
  );
}

export type NewPhotoInput = CompressedPhoto | File;

async function ensureCompressedPhotos(inputs: NewPhotoInput[]): Promise<CompressedPhoto[]> {
  return Promise.all(
    inputs.map((item) => ('blob' in item ? Promise.resolve(item) : compressImageToTarget(item)))
  );
}

class StockConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockConflictError';
  }
}

export interface StockUpdateSummary {
  itemId: string;
  pieceLabel: string;
  remainingQty: number;
}

export type CreatedOrderResult = Order & {
  updatedStockQuantity?: number;
  stockPieceLabel?: string;
  stockUpdates?: StockUpdateSummary[];
};

export interface StatusMutationResult {
  stockAction?: 'restored' | 'deducted';
  updatedStockQuantity?: number;
  stockPieceLabel?: string;
  stockUpdatesCount?: number;
}

function aggregateStockQty(items: OrderLineItem[], onlyDeducted: boolean): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    if (!item.inventoryItemId) continue;
    if (onlyDeducted && !item.stockDeducted) continue;
    map.set(item.inventoryItemId, (map.get(item.inventoryItemId) ?? 0) + item.quantity);
  }
  return map;
}

export async function createOrder(
  values: OrderFormValues,
  newPhotos: NewPhotoInput[],
  user: User,
  settings: StoreSettings,
  onStage?: (stage: string) => void
): Promise<CreatedOrderResult> {
  const validationError = validateOrderForm(values, newPhotos.length);
  if (validationError) {
    throw new Error(validationError);
  }

  const newOrderRef = doc(collection(db, 'orders'));
  const orderId = newOrderRef.id;
  const teamEmails = buildTeamEmails(settings, user.email);

  let photoUrls: string[] = [];
  let photoPaths: string[] = [];

  if (newPhotos.length > 0) {
    onStage?.('Uploading photos...');
    const prepared = await ensureCompressedPhotos(newPhotos);
    const uploadedPhotos = await uploadPreparedOrderPhotos(orderId, prepared, user, teamEmails);
    photoUrls = uploadedPhotos.map((p) => p.url);
    photoPaths = uploadedPhotos.map((p) => p.path);
  }

  onStage?.('Saving order & updating stock...');
  const currentYear = new Date().getFullYear();
  const counterRef = doc(db, 'counters', String(currentYear));

  const trimmedTotal = values.totalAmount.trim();
  const trimmedPaid = values.paidAmount.trim();
  const trimmedRemaining = values.remainingAmount.trim();
  const orderStatus: OrderStatus = values.status || 'NEW';
  const activeStatus = isStockActiveStatus(orderStatus);

  const sanitizedRaw = values.items.map((item) => sanitizeLineItem(item, false));
  const cleanedItems = sanitizedRaw.filter((item) => !isLineItemEmpty(item));
  const finalItems: OrderLineItem[] = cleanedItems.map((item) => ({
    ...item,
    stockDeducted: Boolean(item.inventoryItemId) && activeStatus,
  }));

  const neededByStockId = activeStatus ? aggregateStockQty(finalItems, false) : new Map<string, number>();
  const summary = summarizeLineItems(finalItems);
  const anyStockDeducted = finalItems.some((item) => item.stockDeducted);

  try {
    let generatedOrderNumber = '';
    const stockUpdates: StockUpdateSummary[] = [];

    await runTransaction(db, async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const stockIds = Array.from(neededByStockId.keys());
      const invSnaps = await Promise.all(
        stockIds.map((id) => tx.get(doc(db, 'inventory', id)))
      );

      for (let i = 0; i < stockIds.length; i++) {
        const invId = stockIds[i];
        const neededQty = neededByStockId.get(invId) ?? 0;
        const invSnap = invSnaps[i];

        if (!invSnap.exists()) {
          throw new StockConflictError(
            'A selected stock item no longer exists. Please unlink it or choose another piece.'
          );
        }

        const invData = invSnap.data();
        const available = Math.max(0, Math.floor(Number(invData.quantity ?? 0)));
        const pieceLabel = [String(invData.pieceName ?? ''), String(invData.color ?? '')]
          .filter(Boolean)
          .join(' · ');

        if (available < neededQty) {
          throw new StockConflictError(
            `Only ${available} left in stock for ${pieceLabel || 'this piece'} (ordered ${neededQty}).`
          );
        }

        const nextQty = available - neededQty;
        tx.update(invSnap.ref, {
          quantity: nextQty,
          updatedAt: serverTimestamp(),
        });
        stockUpdates.push({
          itemId: invId,
          pieceLabel,
          remainingQty: nextQty,
        });
      }

      const nextSequence = counterSnap.exists()
        ? Number(counterSnap.data().lastSequence || 0) + 1
        : 1;

      generatedOrderNumber = `SH-${currentYear}-${String(nextSequence).padStart(4, '0')}`;

      if (counterSnap.exists()) {
        tx.update(counterRef, {
          lastSequence: nextSequence,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(counterRef, {
          year: currentYear,
          lastSequence: 1,
          updatedAt: serverTimestamp(),
          teamEmails,
        });
      }

      tx.set(newOrderRef, {
        id: orderId,
        orderNumber: generatedOrderNumber,
        customerName: values.customerName.trim(),
        phone: values.phone.trim(),
        platform: '',
        socialContact: values.socialContact.trim(),
        productName: summary.productName,
        photos: photoUrls,
        photoPaths,
        size: summary.size,
        color: summary.color,
        notes: values.notes.trim(),
        productAmount: '',
        deliveryCharge: '',
        deliveryArea: '',
        paymentType: '',
        totalAmount: trimmedTotal,
        paidAmount: trimmedPaid,
        remainingAmount: trimmedRemaining,
        status: orderStatus,
        inventoryItemId: summary.inventoryItemId,
        orderQuantity: summary.orderQuantity,
        stockDeducted: anyStockDeducted,
        items: finalItems,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: user.uid,
        teamEmails,
      });
    });

    const now = new Date();
    return {
      id: orderId,
      orderNumber: generatedOrderNumber,
      customerName: values.customerName.trim(),
      phone: values.phone.trim(),
      platform: '',
      socialContact: values.socialContact.trim(),
      productName: summary.productName,
      photos: photoUrls,
      photoPaths,
      size: summary.size,
      color: summary.color,
      notes: values.notes.trim(),
      productAmount: '',
      deliveryCharge: '',
      deliveryArea: '',
      paymentType: '',
      totalAmount: trimmedTotal,
      paidAmount: trimmedPaid,
      remainingAmount: trimmedRemaining,
      status: orderStatus,
      inventoryItemId: summary.inventoryItemId,
      orderQuantity: summary.orderQuantity,
      stockDeducted: anyStockDeducted,
      items: finalItems,
      createdAt: now,
      updatedAt: now,
      createdByUid: user.uid,
      teamEmails,
      updatedStockQuantity: stockUpdates.length === 1 ? stockUpdates[0].remainingQty : undefined,
      stockPieceLabel: stockUpdates.length === 1 ? stockUpdates[0].pieceLabel : undefined,
      stockUpdates,
    };
  } catch (error) {
    if (photoPaths.length > 0) {
      await deleteStoragePaths(photoPaths);
    }
    if (error instanceof StockConflictError) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, `orders/${orderId}`);
  }
}

export async function updateOrder(
  existingOrder: Order,
  values: OrderFormValues,
  keptPhotos: string[],
  keptPhotoPaths: string[],
  newPhotos: NewPhotoInput[],
  removedPhotoPaths: string[],
  user: User,
  onStage?: (stage: string) => void
): Promise<void> {
  const totalPhotos = keptPhotos.length + newPhotos.length;
  const validationError = validateOrderForm(values, totalPhotos);
  if (validationError) {
    throw new Error(validationError);
  }

  let newlyUploaded: { url: string; path: string }[] = [];
  if (newPhotos.length > 0) {
    onStage?.('Uploading photos...');
    const prepared = await ensureCompressedPhotos(newPhotos);
    newlyUploaded = await uploadPreparedOrderPhotos(
      existingOrder.id,
      prepared,
      user,
      existingOrder.teamEmails
    );
  }

  const finalPhotos = [...keptPhotos, ...newlyUploaded.map((p) => p.url)];
  const finalPhotoPaths = [...keptPhotoPaths, ...newlyUploaded.map((p) => p.path)];

  onStage?.('Saving changes...');
  const orderRef = doc(db, 'orders', existingOrder.id);
  const nextActive = isStockActiveStatus(values.status);

  const sanitizedRaw = values.items.map((item) => sanitizeLineItem(item, false));
  const cleanedItems = sanitizedRaw.filter((item) => !isLineItemEmpty(item));
  const finalItems: OrderLineItem[] = cleanedItems.map((item) => ({
    ...item,
    stockDeducted: Boolean(item.inventoryItemId) && nextActive,
  }));

  const nextNeededMap = nextActive ? aggregateStockQty(finalItems, false) : new Map<string, number>();
  const summary = summarizeLineItems(finalItems);
  const anyStockDeducted = finalItems.some((item) => item.stockDeducted);

  try {
    await runTransaction(db, async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists()) {
        throw new StockConflictError('Order not found.');
      }

      const liveOrder = mapDocToOrder(orderSnap.id, orderSnap.data() as Record<string, unknown>);
      const liveItems = getOrderLineItems(liveOrder);
      const prevDeductedMap = aggregateStockQty(liveItems, true);

      const allStockIds = Array.from(
        new Set([...prevDeductedMap.keys(), ...nextNeededMap.keys()])
      );
      const invSnaps = await Promise.all(
        allStockIds.map((id) => tx.get(doc(db, 'inventory', id)))
      );

      for (let i = 0; i < allStockIds.length; i++) {
        const invId = allStockIds[i];
        const invSnap = invSnaps[i];
        const prevQty = prevDeductedMap.get(invId) ?? 0;
        const nextQtyNeeded = nextNeededMap.get(invId) ?? 0;
        const delta = nextQtyNeeded - prevQty;

        if (delta === 0) continue;

        if (!invSnap.exists()) {
          if (delta > 0) {
            throw new StockConflictError(
              'A selected stock item no longer exists. Please unlink it or choose another piece.'
            );
          }
          continue;
        }

        const invData = invSnap.data();
        const available = Math.max(0, Math.floor(Number(invData.quantity ?? 0)));
        const nextStock = available - delta;

        if (nextStock < 0) {
          const pieceLabel = [String(invData.pieceName ?? ''), String(invData.color ?? '')]
            .filter(Boolean)
            .join(' · ');
          throw new StockConflictError(
            `Only ${available + prevQty} total available in stock for ${pieceLabel || 'this piece'}.`
          );
        }

        tx.update(invSnap.ref, {
          quantity: nextStock,
          updatedAt: serverTimestamp(),
        });
      }

      tx.update(orderRef, {
        customerName: values.customerName.trim(),
        phone: values.phone.trim(),
        platform: existingOrder.platform ?? '',
        socialContact: values.socialContact.trim(),
        productName: summary.productName,
        photos: finalPhotos,
        photoPaths: finalPhotoPaths,
        size: summary.size,
        color: summary.color,
        notes: values.notes.trim(),
        productAmount: existingOrder.productAmount ?? '',
        deliveryCharge: existingOrder.deliveryCharge ?? '',
        deliveryArea: existingOrder.deliveryArea ?? '',
        paymentType: existingOrder.paymentType ?? '',
        totalAmount: values.totalAmount.trim(),
        paidAmount: values.paidAmount.trim(),
        remainingAmount: values.remainingAmount.trim(),
        status: values.status,
        inventoryItemId: summary.inventoryItemId,
        orderQuantity: summary.orderQuantity,
        stockDeducted: anyStockDeducted,
        items: finalItems,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (newlyUploaded.length > 0) {
      await deleteStoragePaths(newlyUploaded.map((p) => p.path));
    }
    if (error instanceof StockConflictError) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `orders/${existingOrder.id}`);
  }

  if (removedPhotoPaths.length > 0) {
    void deleteStoragePaths(removedPhotoPaths);
  }
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus
): Promise<StatusMutationResult> {
  const orderRef = doc(db, 'orders', orderId);
  let stockAction: 'restored' | 'deducted' | undefined;
  let updatedStockQuantity: number | undefined;
  let stockPieceLabel: string | undefined;
  let stockUpdatesCount = 0;

  try {
    await runTransaction(db, async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists()) {
        throw new StockConflictError('Order not found.');
      }

      const liveOrder = mapDocToOrder(orderSnap.id, orderSnap.data() as Record<string, unknown>);
      const liveItems = getOrderLineItems(liveOrder);
      const nextActive = isStockActiveStatus(status);

      const affectedIds = Array.from(
        new Set(liveItems.map((i) => i.inventoryItemId).filter(Boolean))
      );
      const invSnaps = await Promise.all(
        affectedIds.map((id) => tx.get(doc(db, 'inventory', id)))
      );
      const invById = new Map(affectedIds.map((id, idx) => [id, invSnaps[idx]]));

      const updatedItems = liveItems.map((item) => ({ ...item }));

      if (!nextActive) {
        const restoreMap = aggregateStockQty(liveItems, true);
        for (const [invId, qtyToRestore] of restoreMap.entries()) {
          const invSnap = invById.get(invId);
          if (invSnap?.exists()) {
            const invData = invSnap.data();
            const available = Math.max(0, Math.floor(Number(invData.quantity ?? 0)));
            const nextQty = available + qtyToRestore;
            tx.update(invSnap.ref, {
              quantity: nextQty,
              updatedAt: serverTimestamp(),
            });
            stockAction = 'restored';
            stockUpdatesCount += 1;
            if (stockUpdatesCount === 1) {
              updatedStockQuantity = nextQty;
              stockPieceLabel = [String(invData.pieceName ?? ''), String(invData.color ?? '')]
                .filter(Boolean)
                .join(' · ');
            } else {
              updatedStockQuantity = undefined;
              stockPieceLabel = undefined;
            }
          }
        }
        for (const item of updatedItems) {
          item.stockDeducted = false;
        }
      } else {
        // Re-deduct any linked line items that weren't deducted
        const toDeductMap = new Map<string, number>();
        for (const item of liveItems) {
          if (item.inventoryItemId && !item.stockDeducted) {
            toDeductMap.set(
              item.inventoryItemId,
              (toDeductMap.get(item.inventoryItemId) ?? 0) + item.quantity
            );
          }
        }

        for (const [invId, qtyToDeduct] of toDeductMap.entries()) {
          const invSnap = invById.get(invId);
          if (!invSnap?.exists()) continue;
          const invData = invSnap.data();
          const available = Math.max(0, Math.floor(Number(invData.quantity ?? 0)));
          const pieceLabel = [String(invData.pieceName ?? ''), String(invData.color ?? '')]
            .filter(Boolean)
            .join(' · ');

          if (available < qtyToDeduct) {
            throw new StockConflictError(
              `Cannot reactivate order: only ${available} left in stock for ${pieceLabel || 'this piece'}.`
            );
          }

          const nextQty = available - qtyToDeduct;
          tx.update(invSnap.ref, {
            quantity: nextQty,
            updatedAt: serverTimestamp(),
          });
          stockAction = 'deducted';
          stockUpdatesCount += 1;
          if (stockUpdatesCount === 1) {
            updatedStockQuantity = nextQty;
            stockPieceLabel = pieceLabel;
          } else {
            updatedStockQuantity = undefined;
            stockPieceLabel = undefined;
          }
        }

        for (const item of updatedItems) {
          if (item.inventoryItemId && invById.get(item.inventoryItemId)?.exists()) {
            item.stockDeducted = true;
          }
        }
      }

      const nextOrderDeducted = updatedItems.some((item) => item.stockDeducted);
      tx.update(orderRef, {
        status,
        stockDeducted: nextOrderDeducted,
        items: updatedItems,
        updatedAt: serverTimestamp(),
      });
    });

    return { stockAction, updatedStockQuantity, stockPieceLabel, stockUpdatesCount };
  } catch (error) {
    if (error instanceof StockConflictError) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
  }
}

export async function markOrderPaidAndComplete(
  orderId: string
): Promise<{
  orderNumber: string;
  paidAmount: string;
  stockAction?: 'deducted';
  updatedStockQuantity?: number;
  stockPieceLabel?: string;
  stockUpdatesCount?: number;
}> {
  const orderRef = doc(db, 'orders', orderId);
  let orderNumber = '';
  let nextPaid = '';
  let stockAction: 'deducted' | undefined;
  let updatedStockQuantity: number | undefined;
  let stockPieceLabel: string | undefined;
  let stockUpdatesCount = 0;

  try {
    await runTransaction(db, async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists()) {
        throw new StockConflictError('Order not found.');
      }

      const liveOrder = mapDocToOrder(orderSnap.id, orderSnap.data() as Record<string, unknown>);
      orderNumber = liveOrder.orderNumber;
      const totalStr = String(liveOrder.totalAmount ?? '').trim();
      const paidStr = String(liveOrder.paidAmount ?? '').trim();
      const remStr = String(liveOrder.remainingAmount ?? '').trim();

      if (totalStr) {
        nextPaid = totalStr.slice(0, 60);
      } else {
        const paidNum = parseAmountNumber(paidStr);
        const remNum = parseAmountNumber(remStr);
        if (remNum > 0 && paidNum > 0) {
          nextPaid = String(Math.round((paidNum + remNum + Number.EPSILON) * 100) / 100).slice(0, 60);
        } else if (remNum > 0) {
          nextPaid = remStr.slice(0, 60);
        } else {
          nextPaid = (paidStr || '0').slice(0, 60);
        }
      }

      const liveItems = getOrderLineItems(liveOrder);
      const updatedItems = liveItems.map((item) => ({ ...item }));

      const toDeductMap = new Map<string, number>();
      for (const item of liveItems) {
        if (item.inventoryItemId && !item.stockDeducted) {
          toDeductMap.set(
            item.inventoryItemId,
            (toDeductMap.get(item.inventoryItemId) ?? 0) + item.quantity
          );
        }
      }

      const deductIds = Array.from(toDeductMap.keys());
      const invSnaps = await Promise.all(
        deductIds.map((id) => tx.get(doc(db, 'inventory', id)))
      );

      for (let i = 0; i < deductIds.length; i++) {
        const invId = deductIds[i];
        const qtyToDeduct = toDeductMap.get(invId) ?? 0;
        const invSnap = invSnaps[i];
        if (!invSnap.exists()) continue;

        const invData = invSnap.data();
        const available = Math.max(0, Math.floor(Number(invData.quantity ?? 0)));
        const pieceLabel = [String(invData.pieceName ?? ''), String(invData.color ?? '')]
          .filter(Boolean)
          .join(' · ');

        if (available < qtyToDeduct) {
          throw new StockConflictError(
            `Cannot complete order: only ${available} left in stock for ${pieceLabel || 'this piece'}.`
          );
        }

        const nextQty = available - qtyToDeduct;
        tx.update(invSnap.ref, {
          quantity: nextQty,
          updatedAt: serverTimestamp(),
        });
        stockAction = 'deducted';
        stockUpdatesCount += 1;
        if (stockUpdatesCount === 1) {
          updatedStockQuantity = nextQty;
          stockPieceLabel = pieceLabel;
        } else {
          updatedStockQuantity = undefined;
          stockPieceLabel = undefined;
        }

        for (const item of updatedItems) {
          if (item.inventoryItemId === invId) {
            item.stockDeducted = true;
          }
        }
      }

      const nextOrderDeducted = updatedItems.some((item) => item.stockDeducted);
      tx.update(orderRef, {
        paidAmount: nextPaid,
        remainingAmount: '0',
        status: 'COMPLETED',
        stockDeducted: nextOrderDeducted,
        items: updatedItems,
        updatedAt: serverTimestamp(),
      });
    });

    return {
      orderNumber,
      paidAmount: nextPaid,
      stockAction,
      updatedStockQuantity,
      stockPieceLabel,
      stockUpdatesCount,
    };
  } catch (error) {
    if (error instanceof StockConflictError) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
  }
}

export async function deleteOrder(order: Order): Promise<{ stockRestored: boolean }> {
  const orderRef = doc(db, 'orders', order.id);
  let stockRestored = false;

  try {
    await runTransaction(db, async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists()) return;

      const liveOrder = mapDocToOrder(orderSnap.id, orderSnap.data() as Record<string, unknown>);
      const liveItems = getOrderLineItems(liveOrder);
      const restoreMap = aggregateStockQty(liveItems, true);

      const invIds = Array.from(restoreMap.keys());
      const invSnaps = await Promise.all(
        invIds.map((id) => tx.get(doc(db, 'inventory', id)))
      );

      for (let i = 0; i < invIds.length; i++) {
        const invId = invIds[i];
        const qtyToRestore = restoreMap.get(invId) ?? 0;
        const invSnap = invSnaps[i];
        if (invSnap.exists() && qtyToRestore > 0) {
          const available = Math.max(0, Math.floor(Number(invSnap.data().quantity ?? 0)));
          tx.update(invSnap.ref, {
            quantity: available + qtyToRestore,
            updatedAt: serverTimestamp(),
          });
          stockRestored = true;
        }
      }

      tx.delete(orderRef);
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `orders/${order.id}`);
  }

  if (order.photoPaths.length > 0) {
    await deleteStoragePaths(order.photoPaths);
  }

  return { stockRestored };
}
