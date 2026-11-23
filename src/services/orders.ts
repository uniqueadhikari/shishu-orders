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
import { calculateOrderPayment } from '../utils/payment';
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

function mapDocToOrder(id: string, data: Record<string, unknown>): Order {
  return {
    id,
    orderNumber: String(data.orderNumber ?? ''),
    customerName: String(data.customerName ?? ''),
    phone: String(data.phone ?? ''),
    platform: (data.platform as Order['platform']) ?? 'Instagram',
    socialContact: String(data.socialContact ?? ''),
    productName: String(data.productName ?? ''),
    photos: Array.isArray(data.photos) ? data.photos.map(String) : [],
    photoPaths: Array.isArray(data.photoPaths) ? data.photoPaths.map(String) : [],
    size: String(data.size ?? ''),
    color: String(data.color ?? ''),
    notes: String(data.notes ?? ''),
    productAmount: Number(data.productAmount ?? 0),
    deliveryCharge: Number(data.deliveryCharge ?? 0),
    deliveryArea: (data.deliveryArea as Order['deliveryArea']) ?? 'Inside Valley',
    paymentType: (data.paymentType as Order['paymentType']) ?? 'FULL_PAID',
    totalAmount: Number(data.totalAmount ?? 0),
    paidAmount: Number(data.paidAmount ?? 0),
    remainingAmount: Number(data.remainingAmount ?? 0),
    status: (data.status as OrderStatus) ?? 'NEW',
    createdAt: toDateSafe(data.createdAt),
    updatedAt: toDateSafe(data.updatedAt),
    createdByUid: String(data.createdByUid ?? ''),
    teamEmails: Array.isArray(data.teamEmails) ? data.teamEmails.map(String) : [OWNER_EMAIL],
  };
}

export function validateOrderForm(values: OrderFormValues, totalPhotosCount: number): string | null {
  if (!values.customerName.trim()) return 'Please enter customer name.';
  if (values.customerName.trim().length > 120) return 'Customer name must be 120 characters or fewer.';
  if (!values.phone.trim() || values.phone.trim().length < 5) return 'Please enter a valid phone number.';
  if (values.phone.trim().length > 30) return 'Phone number must be 30 characters or fewer.';
  if (!values.platform) return 'Please select a social platform.';
  if (!values.socialContact.trim()) return 'Please enter social username or contact.';
  if (values.socialContact.trim().length > 120) return 'Social contact must be 120 characters or fewer.';
  if (!values.productName.trim()) return 'Please enter piece / product name.';
  if (values.productName.trim().length > 160) return 'Product name must be 160 characters or fewer.';
  if (totalPhotosCount < 1) return 'Please add at least one product photo.';
  if (totalPhotosCount > 3) return 'Maximum 3 product photos allowed per order.';
  if (!values.size.trim()) return 'Please enter or select a size.';
  if (!values.color.trim()) return 'Please enter a color.';
  if (values.notes.length > 1000) return 'Special notes must be 1000 characters or fewer.';
  if (!Number.isFinite(values.productAmount) || values.productAmount <= 0) {
    return 'Please enter a valid product amount.';
  }
  if (!values.deliveryArea || !Number.isFinite(values.deliveryCharge) || values.deliveryCharge < 0) {
    return 'Please select a valid delivery option.';
  }
  if (!values.paymentType) return 'Please select a payment type.';
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

  const payment = calculateOrderPayment(
    values.productAmount,
    values.deliveryCharge,
    values.paymentType
  );

  const newOrderRef = doc(collection(db, 'orders'));
  const orderId = newOrderRef.id;
  const teamEmails = buildTeamEmails(settings, user.email);

  onStage?.('Uploading photos...');
  const prepared = await ensureCompressedPhotos(newPhotos);
  const uploadedPhotos = await uploadPreparedOrderPhotos(orderId, prepared, user, teamEmails);
  const photoUrls = uploadedPhotos.map((p) => p.url);
  const photoPaths = uploadedPhotos.map((p) => p.path);

  onStage?.('Saving order...');
  const currentYear = new Date().getFullYear();
  const counterRef = doc(db, 'counters', String(currentYear));

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
        platform: values.platform,
        socialContact: values.socialContact.trim(),
        productName: values.productName.trim(),
        photos: photoUrls,
        photoPaths,
        size: values.size.trim(),
        color: values.color.trim(),
        notes: values.notes.trim(),
        productAmount: payment.productAmount,
        deliveryCharge: payment.deliveryCharge,
        deliveryArea: values.deliveryArea,
        paymentType: values.paymentType,
        totalAmount: payment.totalAmount,
        paidAmount: payment.paidAmount,
        remainingAmount: payment.remainingAmount,
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
      platform: values.platform,
      socialContact: values.socialContact.trim(),
      productName: values.productName.trim(),
      photos: photoUrls,
      photoPaths,
      size: values.size.trim(),
      color: values.color.trim(),
      notes: values.notes.trim(),
      productAmount: payment.productAmount,
      deliveryCharge: payment.deliveryCharge,
      deliveryArea: values.deliveryArea,
      paymentType: values.paymentType,
      totalAmount: payment.totalAmount,
      paidAmount: payment.paidAmount,
      remainingAmount: payment.remainingAmount,
      status: values.status || 'NEW',
      createdAt: now,
      updatedAt: now,
      createdByUid: user.uid,
      teamEmails,
    };
  } catch (error) {
    await deleteStoragePaths(photoPaths);
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

  const payment = calculateOrderPayment(
    values.productAmount,
    values.deliveryCharge,
    values.paymentType
  );

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
      platform: values.platform,
      socialContact: values.socialContact.trim(),
      productName: values.productName.trim(),
      photos: finalPhotos,
      photoPaths: finalPhotoPaths,
      size: values.size.trim(),
      color: values.color.trim(),
      notes: values.notes.trim(),
      productAmount: payment.productAmount,
      deliveryCharge: payment.deliveryCharge,
      deliveryArea: values.deliveryArea,
      paymentType: values.paymentType,
      totalAmount: payment.totalAmount,
      paidAmount: payment.paidAmount,
      remainingAmount: payment.remainingAmount,
      status: values.status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    await deleteStoragePaths(newlyUploaded.map((p) => p.path));
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
  await deleteStoragePaths(order.photoPaths);
}
