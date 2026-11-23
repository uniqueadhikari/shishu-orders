# Security Specification & Red Team Test Plan — SHISHU.CLO Order Manager

## 1. Data Invariants

1. **Private Team Isolation**: No unauthenticated or unverified user may read, list, create, update, or delete any document in `orders`, `counters`, or `settings`. Only the bootstrapped owner (`girimerina469@gmail.com` with `email_verified == true`) and explicitly authorized partner emails (`request.auth.token.email in resource.data.teamEmails` or in `settings/store.partnerEmails`) may access data.
2. **Strict Schema Enforcement**: Every write to `orders/{orderId}` must contain all required fields (`hasAll`) and zero extra/shadow fields (`hasOnly`). Every string enforces bounded length and every array enforces bounded size (`1 <= photos.size() <= 3`, `1 <= teamEmails.size() <= 5`).
3. **Payment Integrity**: Negative amounts (`productAmount < 0`, `deliveryCharge < 0`, `totalAmount < 0`, `paidAmount < 0`, `remainingAmount < 0`) are rejected at the rules layer. `totalAmount == productAmount + deliveryCharge` and `paidAmount + remainingAmount == totalAmount` are mathematically enforced.
4. **Immutable Audit & Identity Fields**: `id`, `orderNumber`, `createdAt`, and `createdByUid` cannot be changed after creation. `createdAt == request.time` on create and `updatedAt == request.time` on create and update.
5. **Path Hardening**: Document IDs (`orderId`, `yearId`, `settingId`) must match `^[a-zA-Z0-9_\-]+$` and be `<= 128` characters.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Unauthenticated List Scrape**: Unauthenticated `getDocs(collection(db, 'orders'))` -> Expected: `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: Signed-in user with `email: 'girimerina469@gmail.com'` and `email_verified: false` attempts `getDoc` on `/orders/ord_1` -> Expected: `PERMISSION_DENIED`.
3. **Unauthorized Outsider Read**: Verified outsider `stranger@gmail.com` attempts `getDoc` on `/orders/ord_1` -> Expected: `PERMISSION_DENIED`.
4. **Query Delegation Bypass**: Verified outsider `stranger@gmail.com` attempts unconstrained `list` on `/orders` without `teamEmails` membership -> Expected: `PERMISSION_DENIED`.
5. **Shadow Ghost Field Injection**: Authorized user attempts `setDoc` on `/orders/ord_1` including extra field `isAdminBypass: true` -> Expected: `PERMISSION_DENIED`.
6. **Negative Price Manipulation**: Authorized user submits `productAmount: -500, totalAmount: -380` -> Expected: `PERMISSION_DENIED`.
7. **Payment Math Tampering**: Authorized user submits `FULL_PAID` with `productAmount: 2000, deliveryCharge: 120, totalAmount: 2120, paidAmount: 0, remainingAmount: 0` -> Expected: `PERMISSION_DENIED`.
8. **Missing Photo Bypass**: Authorized user submits `photos: []` (0 photos) -> Expected: `PERMISSION_DENIED`.
9. **Photo Array Bloat**: Authorized user submits 4 photos (`photos.size() == 4`) -> Expected: `PERMISSION_DENIED`.
10. **Order Number Forgery / Mutation**: Authorized user attempts to update `orderNumber` from `SH-2026-0001` to `SH-2026-9999` -> Expected: `PERMISSION_DENIED`.
11. **Timestamp Forgery**: Authorized user sets `createdAt` to a backdated client timestamp instead of `serverTimestamp()` -> Expected: `PERMISSION_DENIED`.
12. **Privilege Escalation on Settings**: Unauthorized user attempts to write their own email into `/settings/store` `partnerEmails` -> Expected: `PERMISSION_DENIED`.

## 3. Verification Test Runner Specification (`firestore.rules.test.ts`)

```ts
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, collection, serverTimestamp } from 'firebase/firestore';
import fs from 'node:fs';

async function runSecurityTests() {
  const env = await initializeTestEnvironment({
    projectId: 'shishu-clo-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });

  const unauth = env.unauthenticatedContext().firestore();
  const outsider = env.authenticatedContext('outsider1', { email: 'stranger@gmail.com', email_verified: true }).firestore();
  const spoofedAdmin = env.authenticatedContext('spoof1', { email: 'girimerina469@gmail.com', email_verified: false }).firestore();
  const owner = env.authenticatedContext('owner1', { email: 'girimerina469@gmail.com', email_verified: true }).firestore();

  const validOrder = {
    id: 'ord_test_1',
    orderNumber: 'SH-2026-0001',
    customerName: 'Aarav Sharma',
    phone: '9800000000',
    platform: 'Instagram',
    socialContact: '@aarav',
    productName: 'Linen Overshirt',
    photos: ['https://firebasestorage.googleapis.com/v0/b/test/o/photo.jpg'],
    photoPaths: ['orders/ord_test_1/photo.jpg'],
    size: 'M',
    color: 'Ivory',
    notes: '',
    productAmount: 2500,
    deliveryCharge: 120,
    deliveryArea: 'Inside Valley',
    paymentType: 'FULL_PAID',
    totalAmount: 2620,
    paidAmount: 2620,
    remainingAmount: 0,
    status: 'NEW',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: 'owner1',
    teamEmails: ['girimerina469@gmail.com'],
  };

  await assertSucceeds(setDoc(doc(owner, 'orders/ord_test_1'), validOrder));
  await assertFails(getDocs(collection(unauth, 'orders')));
  await assertFails(getDoc(doc(spoofedAdmin, 'orders/ord_test_1')));
  await assertFails(getDoc(doc(outsider, 'orders/ord_test_1')));
  await assertFails(getDocs(collection(outsider, 'orders')));
  await assertFails(setDoc(doc(owner, 'orders/ord_ghost'), { ...validOrder, id: 'ord_ghost', ghost: true }));
  await assertFails(setDoc(doc(owner, 'orders/ord_neg'), { ...validOrder, id: 'ord_neg', productAmount: -100 }));
  await assertFails(setDoc(doc(owner, 'orders/ord_math'), { ...validOrder, id: 'ord_math', paidAmount: 0 }));
  await assertFails(setDoc(doc(owner, 'orders/ord_nophoto'), { ...validOrder, id: 'ord_nophoto', photos: [] }));
  await assertFails(setDoc(doc(owner, 'orders/ord_4photos'), { ...validOrder, id: 'ord_4photos', photos: ['a', 'b', 'c', 'd'] }));
  await assertFails(updateDoc(doc(owner, 'orders/ord_test_1'), { orderNumber: 'SH-2026-9999', updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(owner, 'orders/ord_time'), { ...validOrder, id: 'ord_time', createdAt: new Date(2020, 0, 1) }));
  await assertFails(setDoc(doc(outsider, 'settings/store'), { brandName: 'Hacked' }));

  await env.cleanup();
}

runSecurityTests();
```
