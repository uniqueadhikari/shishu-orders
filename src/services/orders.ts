import type { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { OWNER_EMAIL, db } from '../firebase/config';
import { OperationType, handleFirestoreError } from '../firebase/errors';
import type { Order, OrderFormValues, OrderStatus, StoreSettings } from '../types/order';
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

function mapDocToOrder(id: string, data: Record<string, unknown>): Order {
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
  if (values.productName.trim().length > 160) return 'Product name must be 160 characters or fewer.';
  if (totalPhotosCount > 3) return 'Maximum 3 product photos allowed per order.';
  if (values.size.trim().length > 60) return 'Size must be 60 characters or fewer.';
  if (values.color.trim().length > 60) return 'Color must be 60 characters or fewer.';
  if (values.notes.length > 1000) return 'Special notes must be 1000 characters or fewer.';
  if (values.totalAmount.trim().length > 60) return 'Total amount must be 60 characters or fewer.';
  if (values.paidAmount.trim().length > 60) return 'Paid amount must be 60 characters or fewer.';
  if (values.remainingAmount.trim().length > 60) return 'Remaining amount must be 60 characters or fewer.';
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

export async function createOrder(
  values: OrderFormValues,
  newPhotos: NewPhotoInput[],
  user: User,
  settings: StoreSettings,
  onStage?: (stage: string) => void
): Promise<Order> {
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

  onStage?.('Saving order...');
  const currentYear = new Date().getFullYear();
  const counterRef = doc(db, 'counters', String(currentYear));

  const trimmedTotal = values.totalAmount.trim();
  const trimmedPaid = values.paidAmount.trim();
  const trimmedRemaining = values.remainingAmount.trim();

  try {
    let generatedOrderNumber = '';

    await runTransaction(db, async (tx) => {
      const counterSnap = await tx.get(counterRef);
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
        productName: values.productName.trim(),
        photos: photoUrls,
        photoPaths,
        size: values.size.trim(),
        color: values.color.trim(),
        notes: values.notes.trim(),
        productAmount: '',
        deliveryCharge: '',
        deliveryArea: '',
        paymentType: '',
        totalAmount: trimmedTotal,
        paidAmount: trimmedPaid,
        remainingAmount: trimmedRemaining,
        status: values.status || 'NEW',
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
      productName: values.productName.trim(),
      photos: photoUrls,
      photoPaths,
      size: values.size.trim(),
      color: values.color.trim(),
      notes: values.notes.trim(),
      productAmount: '',
      deliveryCharge: '',
      deliveryArea: '',
      paymentType: '',
      totalAmount: trimmedTotal,
      paidAmount: trimmedPaid,
      remainingAmount: trimmedRemaining,
      status: values.status || 'NEW',
      createdAt: now,
      updatedAt: now,
      createdByUid: user.uid,
      teamEmails,
    };
  } catch (error) {
    if (photoPaths.length > 0) {
      await deleteStoragePaths(photoPaths);
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
  try {
    await updateDoc(orderRef, {
      customerName: values.customerName.trim(),
      phone: values.phone.trim(),
      platform: existingOrder.platform ?? '',
      socialContact: values.socialContact.trim(),
      productName: values.productName.trim(),
      photos: finalPhotos,
      photoPaths: finalPhotoPaths,
      size: values.size.trim(),
      color: values.color.trim(),
      notes: values.notes.trim(),
      productAmount: existingOrder.productAmount ?? '',
      deliveryCharge: existingOrder.deliveryCharge ?? '',
      deliveryArea: existingOrder.deliveryArea ?? '',
      paymentType: existingOrder.paymentType ?? '',
      totalAmount: values.totalAmount.trim(),
      paidAmount: values.paidAmount.trim(),
      remainingAmount: values.remainingAmount.trim(),
      status: values.status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (newlyUploaded.length > 0) {
      await deleteStoragePaths(newlyUploaded.map((p) => p.path));
    }
    handleFirestoreError(error, OperationType.UPDATE, `orders/${existingOrder.id}`);
  }

  if (removedPhotoPaths.length > 0) {
    void deleteStoragePaths(removedPhotoPaths);
  }
}

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  const orderRef = doc(db, 'orders', orderId);
  try {
    await updateDoc(orderRef, {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
  }
}

export async function deleteOrder(order: Order): Promise<void> {
  const orderRef = doc(db, 'orders', order.id);
  try {
    await deleteDoc(orderRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `orders/${order.id}`);
  }
  if (order.photoPaths.length > 0) {
    await deleteStoragePaths(order.photoPaths);
  }
}
