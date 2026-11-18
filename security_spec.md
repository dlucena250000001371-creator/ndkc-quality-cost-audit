# NDKC Quality Cost Audit — Security Specification (Phase 0)

## 1. Data Invariants
1. **No Email in Firestore**: Neither `/users/{userId}` nor `profileSnapshot` may store an `email` field.
2. **Owner Isolation**: Users may only read and write under `/users/{request.auth.uid}` and its subcollections (`costAudits`, `interactions`).
3. **Admin Privilege Separation**: Admin status requires `request.auth.token.email_verified == true` and existence of `/admins/{request.auth.uid}`. No client code may create, update, or delete `/admins/{uid}`. Admin may read any user's data and collection groups, but never modify user data.
4. **Immutable Audit Trail**: Once created, `interactions` cannot be updated or deleted. Once a `costAudit` transitions to `completed`, it is locked from further client mutations.
5. **Parent Integrity**: An `interaction` cannot be created unless its referenced `costAudit` exists (or is created in the same atomic batch).
6. **Temporal & Key Integrity**: `createdAt`, `updatedAt`, `completedAt`, and `timestamp` must match `request.time`. No unapproved/shadow keys may be written (`hasAll` + `hasOnly`).

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Shadow Field Injection on Profile**: `{ uid, displayName, ..., email: "attacker@example.com", isAdmin: true }` -> Blocked by `hasOnly(...)`.
2. **Self-Admin Escalation**: Creating `/admins/{myUid}` with `{ role: "superadmin" }` -> Blocked by `allow create: if false`.
3. **Cross-User Profile Read/Write**: Signed-in user A writing or reading `/users/{userB}` -> Blocked by `isOwner(userId)`.
4. **Spoofed UID Inside Subcollection**: User A creating `/users/{userA}/costAudits/{id}` with `userId: userB` -> Blocked by `data.userId == request.auth.uid`.
5. **Audit Terminal State Bypass**: User A updating `/users/{userA}/costAudits/{completedId}` after `status == 'completed'` -> Blocked by `existing().status == 'in_progress'`.
6. **Orphaned Interaction Write**: Creating `/users/{userA}/interactions/{id}` referencing a non-existent `auditId` -> Blocked by `exists(...) || existsAfter(...)`.
7. **Interaction Tampering**: Updating or deleting an existing `/users/{userA}/interactions/{id}` -> Blocked by `allow update, delete: if false`.
8. **Backdated Timestamp Attack**: Creating a profile or interaction with `createdAt` or `timestamp` set to a past client date instead of `serverTimestamp()` -> Blocked by `== request.time`.
9. **Baseline Poisoning by Non-Admin**: Standard faculty user writing to `/settings/qualityBaseline` -> Blocked by `isAdmin()`.
10. **Ledger Report Exfiltration/Creation by Non-Admin**: Standard user reading or writing `/ledgerReports/{id}` -> Blocked by `isAdmin()`.
11. **Oversized ID Poisoning**: Creating a document with a 500-character ID or invalid characters (`../admin`) -> Blocked by `isValidId()`.
12. **Unverified Token / Unauthenticated Collection Group Scrape**: Unauthenticated or unverified token running collection-group query on `costAudits` or `interactions` -> Blocked by `isAdmin()` requiring `email_verified == true`.
