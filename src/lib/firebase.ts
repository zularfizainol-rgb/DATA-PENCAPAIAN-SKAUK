import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  deleteDoc,
  getDocFromServer,
  type Firestore
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const firestoreDatabaseId =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-c3aa1f24-023c-44a1-a799-4df09c1d7afa';

export const db: Firestore = (() => {
  try {
    return initializeFirestore(
      app,
      { experimentalAutoDetectLongPolling: true },
      firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firestoreDatabaseId);
  }
})();

// Google Workspace Scopes (Scope Minimization: Google Sheets only)
export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets'
];

const googleProvider = new GoogleAuthProvider();
SCOPES.forEach(scope => googleProvider.addScope(scope));
googleProvider.setCustomParameters({ prompt: 'consent select_account' });

// In-memory token caching (NEVER stored in localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthSuccess) {
          // User is signed into Firebase, but memory OAuth token expired/refreshed
          onAuthSuccess(user, null);
        }
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal mendapatkan token capaian Google Sheets daripada log masuk Google.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Google Sign-In error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const clearAccessToken = () => {
  cachedAccessToken = null;
};

export const logout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};

// Firestore Connection Validation & Structured Error Handling
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

export function isQuotaError(error: unknown): boolean {
  const errObj = error as { code?: string; message?: string } | null;
  const msg = errObj?.message || String(error || '');
  return (
    errObj?.code === 'resource-exhausted' ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('resource-exhausted') ||
    msg.toLowerCase().includes('resource_exhausted')
  );
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): FirestoreErrorInfo {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

export interface FirestoreConnectionStatus {
  ok: boolean;
  quotaExceeded: boolean;
  offline: boolean;
  configValid: boolean;
}

export async function testConnection(): Promise<FirestoreConnectionStatus> {
  if (!firebaseConfig.projectId || !firebaseConfig.apiKey || !firebaseConfig.appId || !firestoreDatabaseId) {
    console.warn('Konfigurasi Firebase tidak lengkap.');
    return { ok: false, quotaExceeded: false, offline: false, configValid: false };
  }

  // Fast REST preflight (<4s) to detect 429 quota exhaustion or offline network
  // before opening Firestore SDK WebChannel/long-polling streams that stall for 10s.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  try {
    const probeUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      firebaseConfig.projectId
    )}/databases/${encodeURIComponent(firestoreDatabaseId)}/documents/test/connection?key=${encodeURIComponent(
      firebaseConfig.apiKey
    )}`;
    const res = await fetch(probeUrl, { method: 'GET', signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.status === 429) {
      return { ok: false, quotaExceeded: true, offline: false, configValid: true };
    }
    if (res.status === 404) {
      console.warn('Pangkalan data Firestore tidak ditemui untuk konfigurasi semasa.');
      return { ok: false, quotaExceeded: false, offline: false, configValid: false };
    }
    if (!res.ok && res.status !== 403) {
      const bodyText = await res.text().catch(() => '');
      if (isQuotaError({ message: bodyText })) {
        return { ok: false, quotaExceeded: true, offline: false, configValid: true };
      }
    }
  } catch {
    clearTimeout(timeoutId);
    return { ok: false, quotaExceeded: false, offline: true, configValid: true };
  }

  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true, quotaExceeded: false, offline: false, configValid: true };
  } catch (error) {
    if (isQuotaError(error)) {
      return { ok: false, quotaExceeded: true, offline: false, configValid: true };
    }
    const errCode = (error as { code?: string } | null)?.code;
    const errMsg = error instanceof Error ? error.message : String(error || '');
    if (errCode === 'permission-denied' || errMsg.toLowerCase().includes('missing or insufficient permissions')) {
      return { ok: true, quotaExceeded: false, offline: false, configValid: true };
    }
    if (errMsg.includes('the client is offline') || errCode === 'unavailable') {
      console.warn('Sambungan Firestore terganggu buat sementara (mod luar talian).');
      return { ok: false, quotaExceeded: false, offline: true, configValid: true };
    }
    return { ok: false, quotaExceeded: false, offline: false, configValid: true };
  }
}

export {
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  deleteDoc
};
export type { User };

