# Security Specification & Red Team Test Plan — SHISHU.CLO Order Manager

## 1. Data Invariants

1. **Private Team Isolation**: No unauthenticated or unverified user may read, list, create, update, or delete any document in `orders`, `inventory`, `orderPhotos`, `counters`, or `settings`. Only the bootstrapped owner (`girimerina469@gmail.com` with `email_verified == true`) and explicitly authorized partner emails (`request.auth.token.email in resource.data.teamEmails` or in `settings/store.partnerEmails`) may access data.
2. **Strict Schema Enforcement**: Every write to `orders/{orderId}` and `inventory/{itemId}` must enforce `hasAll` and `hasOnly` key checks, preventing shadow fields. All user-facing order fields (`customerName`, `phone`, `socialContact`, `productName`, `size`, `color`, `notes`, `photos`, `totalAmount`, `paidAmount`, `remainingAmount`, `inventoryItemId`, `orderQuantity`, `stockDeducted`, `items`) are optional, while every string enforces bounded length and arrays enforce bounded size (`0 <= photos.size() <= 3`, `0 <= items.size() <= 15`, `1 <= teamEmails.size() <= 5`). Inventory quantities must be non-negative bounded numbers (`0 <= quantity <= 100000`).
3. **Flexible Amount Safety**: Amount fields (`totalAmount`, `paidAmount`, `remainingAmount`, `productAmount`, `deliveryCharge`) accept either bounded strings (`<= 60` chars) or non-negative numbers (`>= 0`). Negative numbers and oversized strings are rejected at the rules layer.
4. **Immutable Audit & Identity Fields**: `id`, `orderNumber` (on orders), `createdAt`, and `createdByUid` cannot be changed after creation. `createdAt == request.time` on create and `updatedAt == request.time` on create and update.
5. **Path Hardening**: Document IDs (`orderId`, `itemId`, `photoId`, `yearId`, `settingId`) must match `^[a-zA-Z0-9_\-]+$` and be `<= 128` characters.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Unauthenticated List Scrape**: Unauthenticated `getDocs(collection(db, 'orders'))` or `collection(db, 'inventory')` -> Expected: `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: Signed-in user with `email: 'girimerina469@gmail.com'` and `email_verified: false` attempts `getDoc` on `/orders/ord_1` -> Expected: `PERMISSION_DENIED`.
3. **Unauthorized Outsider Read**: Verified outsider `stranger@gmail.com` attempts `getDoc` on `/orders/ord_1` or `/inventory/inv_1` -> Expected: `PERMISSION_DENIED`.
4. **Query Delegation Bypass**: Verified outsider `stranger@gmail.com` attempts unconstrained `list` on `/orders` or `/inventory` without `teamEmails` membership -> Expected: `PERMISSION_DENIED`.
5. **Shadow Ghost Field Injection**: Authorized user attempts `setDoc` on `/orders/ord_1` or `/inventory/inv_1` including extra field `isAdminBypass: true` -> Expected: `PERMISSION_DENIED`.
6. **Negative Price / Stock Manipulation**: Authorized user submits `totalAmount: -500` or inventory `quantity: -5` -> Expected: `PERMISSION_DENIED`.
7. **Oversized Text Injection**: Authorized user submits `totalAmount` or `size` or `color` with > 60 characters -> Expected: `PERMISSION_DENIED`.
8. **Photo Array Bloat**: Authorized user submits 4 photos (`photos.size() == 4`) -> Expected: `PERMISSION_DENIED`.
9. **Order Number Forgery / Mutation**: Authorized user attempts to update `orderNumber` from `SH-2026-0001` to `SH-2026-9999` -> Expected: `PERMISSION_DENIED`.
10. **Timestamp Forgery**: Authorized user sets `createdAt` to a backdated client timestamp instead of `serverTimestamp()` -> Expected: `PERMISSION_DENIED`.
11. **Invalid Document ID Poisoning**: Authorized user attempts write to `/orders/bad$id` or `/inventory/bad$id` -> Expected: `PERMISSION_DENIED`.
12. **Privilege Escalation on Settings**: Unauthorized user attempts to write their own email into `/settings/store` `partnerEmails` -> Expected: `PERMISSION_DENIED`.
