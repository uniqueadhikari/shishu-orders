import { auth } from './config';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function getUserFriendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error) return fallback;
  const raw = error instanceof Error ? error.message : String(error);

  if (raw.includes('Missing or insufficient permissions') || raw.includes('permission-denied')) {
    return 'Access denied. Only authorized Shishu.clo accounts can perform this action.';
  }
  if (raw.includes('Quota exceeded')) {
    return 'Daily database quota exceeded. Please try again tomorrow or upgrade your Firebase plan.';
  }
  if (raw.includes('client is offline') || raw.includes('network-request-failed')) {
    return 'You appear to be offline. Please check your internet connection and try again.';
  }
  if (raw.includes('aborted') || raw.includes('failed-precondition')) {
    return 'Stock or order changed while saving. Please try again.';
  }
  if (raw.includes('storage/unauthorized')) {
    return 'Photo upload denied. Ensure your Firebase Storage rules allow authorized Shishu.clo users.';
  }
  if (raw.includes('storage/')) {
    return 'Could not upload photo right now. Please check your connection and try again.';
  }
  if (raw.includes('popup-closed-by-user')) {
    return 'Google sign-in was cancelled before completing.';
  }
  if (raw.includes('popup-blocked')) {
    return 'Sign-in popup was blocked by your browser. Please allow popups and try again.';
  }
  if (raw.startsWith('{') && raw.includes('"operationType"')) {
    try {
      const parsed = JSON.parse(raw) as FirestoreErrorInfo;
      if (parsed.error.includes('Missing or insufficient permissions')) {
        return 'Access denied. Only authorized Shishu.clo accounts can perform this action.';
      }
    } catch {
      // ignore JSON parse failure
    }
  }
  // Surface our own clean validation error messages directly
  if (raw.length > 0 && raw.length < 180 && !raw.includes('FirebaseError:') && !raw.includes('Error:')) {
    return raw;
  }
  return fallback;
}
