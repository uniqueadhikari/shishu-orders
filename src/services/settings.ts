import type { User } from 'firebase/auth';
import {
  Timestamp,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { OWNER_EMAIL, db } from '../firebase/config';
import { OperationType, handleFirestoreError } from '../firebase/errors';
import type { Order, StoreSettings } from '../types/order';
import { DEFAULT_STORE_SETTINGS } from '../utils/payment';

export function subscribeToSettings(
  onData: (settings: StoreSettings, exists: boolean) => void,
  onError: (error: unknown) => void
): () => void {
  const settingsRef = doc(db, 'settings', 'store');
  return onSnapshot(
    settingsRef,
    (snap) => {
      if (!snap.exists()) {
        onData(DEFAULT_STORE_SETTINGS, false);
        return;
      }
      const data = snap.data();
      onData(
        {
          brandName: String(data.brandName ?? DEFAULT_STORE_SETTINGS.brandName),
          currency: String(data.currency ?? DEFAULT_STORE_SETTINGS.currency),
          insideValleyRate: Number(data.insideValleyRate ?? DEFAULT_STORE_SETTINGS.insideValleyRate),
          outsideValleyRate: Number(data.outsideValleyRate ?? DEFAULT_STORE_SETTINGS.outsideValleyRate),
          otherRate: Number(data.otherRate ?? DEFAULT_STORE_SETTINGS.otherRate),
          partnerEmails: Array.isArray(data.partnerEmails) ? data.partnerEmails.map(String) : [],
          updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : null,
          updatedByUid: String(data.updatedByUid ?? ''),
        },
        true
      );
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, 'settings/store');
      } catch (wrapped) {
        onError(wrapped);
      }
    }
  );
}

export async function saveStoreSettings(
  next: {
    brandName: string;
    currency: string;
    insideValleyRate: number;
    outsideValleyRate: number;
    otherRate: number;
    partnerEmails: string[];
  },
  user: User,
  orders: Order[]
): Promise<void> {
  if (!next.brandName.trim()) {
    throw new Error('Please enter a brand name.');
  }
  if (!next.currency.trim()) {
    throw new Error('Please enter a currency label.');
  }
  if (
    !Number.isFinite(next.insideValleyRate) ||
    next.insideValleyRate < 0 ||
    !Number.isFinite(next.outsideValleyRate) ||
    next.outsideValleyRate < 0 ||
    !Number.isFinite(next.otherRate) ||
    next.otherRate < 0
  ) {
    throw new Error('Delivery charges must be zero or positive numbers.');
  }

  const normalizedPartners = Array.from(
    new Set(
      next.partnerEmails
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0 && e !== OWNER_EMAIL)
    )
  ).slice(0, 5);

  const settingsRef = doc(db, 'settings', 'store');
  try {
    await setDoc(settingsRef, {
      brandName: next.brandName.trim(),
      currency: next.currency.trim(),
      insideValleyRate: next.insideValleyRate,
      outsideValleyRate: next.outsideValleyRate,
      otherRate: next.otherRate,
      partnerEmails: normalizedPartners,
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/store');
  }

  // Sync teamEmails across orders and active year counters so partner gets instant access
  if (user.email?.toLowerCase() === OWNER_EMAIL) {
    const teamEmails = Array.from(new Set([OWNER_EMAIL, ...normalizedPartners])).slice(0, 5);
    try {
      const refsToUpdate: ReturnType<typeof doc>[] = [];

      for (const order of orders) {
        const same =
          order.teamEmails.length === teamEmails.length &&
          teamEmails.every((email) => order.teamEmails.includes(email));
        if (!same) {
          refsToUpdate.push(doc(db, 'orders', order.id));
        }
      }

      const currentYear = new Date().getFullYear();
      for (const yr of [currentYear, currentYear + 1]) {
        const counterRef = doc(db, 'counters', String(yr));
        const counterSnap = await getDoc(counterRef);
        if (counterSnap.exists()) {
          refsToUpdate.push(counterRef);
        }
      }

      for (let i = 0; i < refsToUpdate.length; i += 450) {
        const chunk = refsToUpdate.slice(i, i + 450);
        const batch = writeBatch(db);
        for (const ref of chunk) {
          batch.update(ref, {
            teamEmails,
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
    } catch (err) {
      console.warn('Could not sync teamEmails across historical records:', err);
    }
  }
}
