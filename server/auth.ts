import type { Request, Response, NextFunction } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseConfig } from './config.ts';
import { getFirestoreDoc } from './firestoreRest.ts';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  idToken: string;
}

export interface AuthedRequest extends Request {
  user?: AuthenticatedUser;
  requestId?: string;
}

function getAdminApp() {
  if (getApps().length > 0) return getApp();
  const { projectId } = getFirebaseConfig();
  return initializeApp({ projectId });
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const requestId = req.requestId || 'unknown';
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authentication required. Please sign in with Google.',
      code: 'UNAUTHENTICATED',
      requestId,
    });
    return;
  }

  const idToken = header.slice('Bearer '.length).trim();
  if (!idToken) {
    res.status(401).json({
      error: 'Missing authentication token.',
      code: 'UNAUTHENTICATED',
      requestId,
    });
    return;
  }

  try {
    const app = getAdminApp();
    const decoded = await getAuth(app).verifyIdToken(idToken);
    req.user = {
      uid: decoded.uid,
      email: (decoded.email || '').trim(),
      displayName: (decoded.name || '').trim(),
      emailVerified: Boolean(decoded.email_verified),
      idToken,
    };
    next();
  } catch {
    res.status(401).json({
      error: 'Your session has expired or is invalid. Please sign in again.',
      code: 'INVALID_TOKEN',
      requestId,
    });
  }
}

export async function resolveAdminStatus(user: AuthenticatedUser): Promise<{
  isAdmin: boolean;
  adminSetupNeeded: boolean;
}> {
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!adminEmail) {
    return { isAdmin: false, adminSetupNeeded: false };
  }

  const emailMatches =
    user.emailVerified && user.email.trim().toLowerCase() === adminEmail;

  if (!emailMatches) {
    return { isAdmin: false, adminSetupNeeded: false };
  }

  try {
    const adminDoc = await getFirestoreDoc(`admins/${user.uid}`, user.idToken);
    if (adminDoc) {
      return { isAdmin: true, adminSetupNeeded: false };
    }
    return { isAdmin: false, adminSetupNeeded: true };
  } catch {
    return { isAdmin: false, adminSetupNeeded: true };
  }
}
