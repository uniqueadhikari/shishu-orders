import type { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { OWNER_EMAIL, db } from '../firebase/config';
import { OperationType, handleFirestoreError } from '../firebase/errors';
import type { InventoryFormValues, InventoryItem, StoreSettings } from '../types/order';
import { buildTeamEmails, type NewPhotoInput } from './orders';
import {
  compressImageToTarget,
  deleteStoragePaths,
  uploadPreparedOrderPhotos,
} from './storage';

function toDateSafe(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return new Date();
}

function mapDocToInventoryItem(id: string, data: Record<string, unknown>): InventoryItem {
  const qty = Number(data.quantity ?? 0);
  const threshold = Number(data.lowStockThreshold ?? 3);
  return {
    id,
    pieceName: String(data.pieceName ?? ''),
    color: String(data.color ?? ''),
    size: String(data.size ?? ''),
    quantity: Number.isFinite(qty) && qty >= 0 ? Math.floor(qty) : 0,
    lowStockThreshold: Number.isFinite(threshold) && threshold >= 0 ? Math.floor(threshold) : 3,
    unitPrice: String(data.unitPrice ?? ''),
    photoUrl: String(data.photoUrl ?? ''),
    photoPath: String(data.photoPath ?? ''),
    notes: String(data.notes ?? ''),
    createdAt: toDateSafe(data.createdAt),
    updatedAt: toDateSafe(data.updatedAt),
    createdByUid: String(data.createdByUid ?? ''),
    teamEmails: Array.isArray(data.teamEmails) ? data.teamEmails.map(String) : [OWNER_EMAIL],
  };
}

export type StockState = 'out' | 'low' | 'ok';

export function getStockState(item: Pick<InventoryItem, 'quantity' | 'lowStockThreshold'>): StockState {
  if (item.quantity <= 0) return 'out';
  if (item.quantity <= item.lowStockThreshold) return 'low';
  return 'ok';
}

export function validateInventoryForm(values: InventoryFormValues): string | null {
  const piece = values.pieceName.trim();
  if (!piece) return 'Please enter a piece name.';
  if (piece.length > 160) return 'Piece name must be 160 characters or fewer.';
  if (values.color.trim().length > 60) return 'Color must be 60 characters or fewer.';
  if (values.size.trim().length > 60) return 'Size must be 60 characters or fewer.';
  if (values.unitPrice.trim().length > 60) return 'Price must be 60 characters or fewer.';
  if (values.notes.length > 500) return 'Notes must be 500 characters or fewer.';

  const qtyRaw = values.quantity.trim();
  const qty = qtyRaw === '' ? 0 : Number(qtyRaw);
  if (!Number.isFinite(qty) || qty < 0 || qty > 100000 || !Number.isInteger(qty)) {
    return 'Quantity must be a whole number between 0 and 100,000.';
  }

  const thresholdRaw = values.lowStockThreshold.trim();
  const threshold = thresholdRaw === '' ? 3 : Number(thresholdRaw);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1000 || !Number.isInteger(threshold)) {
    return 'Low stock alert must be a whole number between 0 and 1,000.';
  }

  return null;
}

export function subscribeToInventory(
  userEmail: string,
  onData: (items: InventoryItem[]) => void,
  onError: (error: unknown) => void
): () => void {
  const normalized = userEmail.trim().toLowerCase();
  const isOwner = normalized === OWNER_EMAIL;

  const q = isOwner
    ? query(collection(db, 'inventory'), orderBy('updatedAt', 'desc'))
    : query(collection(db, 'inventory'), where('teamEmails', 'array-contains', normalized));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((docSnap) =>
        mapDocToInventoryItem(docSnap.id, docSnap.data() as Record<string, unknown>)
      );
      items.sort((a, b) => {
        const pieceCmp = a.pieceName.localeCompare(b.pieceName);
        if (pieceCmp !== 0) return pieceCmp;
        return a.color.localeCompare(b.color);
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'inventory');
      } catch (wrapped) {
        onError(wrapped);
      }
    }
  );
}

export async function createInventoryItem(
  values: InventoryFormValues,
  photoInput: NewPhotoInput | null,
  user: User,
  settings: StoreSettings
): Promise<InventoryItem> {
  const validationError = validateInventoryForm(values);
  if (validationError) {
    throw new Error(validationError);
  }

  const newRef = doc(collection(db, 'inventory'));
  const itemId = newRef.id;
  const teamEmails = buildTeamEmails(settings, user.email);

  let photoUrl = '';
  let photoPath = '';

  if (photoInput) {
    const compressed = 'blob' in photoInput ? photoInput : await compressImageToTarget(photoInput);
    const uploaded = await uploadPreparedOrderPhotos(`inv_${itemId}`, [compressed], user, teamEmails);
    if (uploaded[0]) {
      photoUrl = uploaded[0].url;
      photoPath = uploaded[0].path;
    }
  }

  const quantity = values.quantity.trim() === '' ? 0 : Math.floor(Number(values.quantity.trim()));
  const lowStockThreshold =
    values.lowStockThreshold.trim() === ''
      ? 3
      : Math.floor(Number(values.lowStockThreshold.trim()));

  try {
    await setDoc(newRef, {
      id: itemId,
      pieceName: values.pieceName.trim(),
      color: values.color.trim(),
      size: values.size.trim(),
      quantity,
      lowStockThreshold,
      unitPrice: values.unitPrice.trim(),
      photoUrl,
      photoPath,
      notes: values.notes.trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: user.uid,
      teamEmails,
    });
  } catch (error) {
    if (photoPath) {
      await deleteStoragePaths([photoPath]);
    }
    handleFirestoreError(error, OperationType.CREATE, `inventory/${itemId}`);
  }

  const now = new Date();
  return {
    id: itemId,
    pieceName: values.pieceName.trim(),
    color: values.color.trim(),
    size: values.size.trim(),
    quantity,
    lowStockThreshold,
    unitPrice: values.unitPrice.trim(),
    photoUrl,
    photoPath,
    notes: values.notes.trim(),
    createdAt: now,
    updatedAt: now,
    createdByUid: user.uid,
    teamEmails,
  };
}

export async function updateInventoryItem(
  existingItem: InventoryItem,
  values: InventoryFormValues,
  keptPhotoUrl: string,
  keptPhotoPath: string,
  newPhotoInput: NewPhotoInput | null,
  removedPhotoPath: string,
  user: User,
  skipPhotoCleanup = false
): Promise<void> {
  const validationError = validateInventoryForm(values);
  if (validationError) {
    throw new Error(validationError);
  }

  let finalPhotoUrl = keptPhotoUrl;
  let finalPhotoPath = keptPhotoPath;
  let newlyUploadedPath = '';

  if (newPhotoInput) {
    const compressed = 'blob' in newPhotoInput ? newPhotoInput : await compressImageToTarget(newPhotoInput);
    const uploaded = await uploadPreparedOrderPhotos(
      `inv_${existingItem.id}`,
      [compressed],
      user,
      existingItem.teamEmails
    );
    if (uploaded[0]) {
      finalPhotoUrl = uploaded[0].url;
      finalPhotoPath = uploaded[0].path;
      newlyUploadedPath = uploaded[0].path;
    }
  }

  const quantity = values.quantity.trim() === '' ? 0 : Math.floor(Number(values.quantity.trim()));
  const lowStockThreshold =
    values.lowStockThreshold.trim() === ''
      ? 3
      : Math.floor(Number(values.lowStockThreshold.trim()));

  const itemRef = doc(db, 'inventory', existingItem.id);
  try {
    await updateDoc(itemRef, {
      pieceName: values.pieceName.trim(),
      color: values.color.trim(),
      size: values.size.trim(),
      quantity,
      lowStockThreshold,
      unitPrice: values.unitPrice.trim(),
      photoUrl: finalPhotoUrl,
      photoPath: finalPhotoPath,
      notes: values.notes.trim(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (newlyUploadedPath) {
      await deleteStoragePaths([newlyUploadedPath]);
    }
    handleFirestoreError(error, OperationType.UPDATE, `inventory/${existingItem.id}`);
  }

  if (!skipPhotoCleanup && removedPhotoPath && removedPhotoPath !== finalPhotoPath) {
    void deleteStoragePaths([removedPhotoPath]);
  }
}

export async function adjustInventoryQuantity(itemId: string, nextQuantity: number): Promise<void> {
  const safeQty = Math.max(0, Math.min(100000, Math.floor(nextQuantity)));
  const itemRef = doc(db, 'inventory', itemId);
  try {
    await updateDoc(itemRef, {
      quantity: safeQty,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `inventory/${itemId}`);
  }
}

export async function deleteInventoryItem(
  item: InventoryItem,
  skipPhotoCleanup = false
): Promise<void> {
  const itemRef = doc(db, 'inventory', item.id);
  try {
    await deleteDoc(itemRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `inventory/${item.id}`);
  }
  if (!skipPhotoCleanup && item.photoPath) {
    await deleteStoragePaths([item.photoPath]);
  }
}
