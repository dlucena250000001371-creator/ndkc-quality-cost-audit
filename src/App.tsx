import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { apiFetch } from './lib/api';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  stripUndefined,
  testConnection,
  toMillis,
  withTimeout,
} from './lib/firebase';
import { AppShell, type NavTab } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer, type ToastItem } from './components/Toast';
import { AdminBaselinePage } from './pages/AdminBaselinePage';
import { AdminLedgerPage } from './pages/AdminLedgerPage';
import { AdminReportsPage } from './pages/AdminReportsPage';
import { HomePage } from './pages/HomePage';
import { InterviewPage } from './pages/InterviewPage';
import { LandingPage } from './pages/LandingPage';
import { MyAuditsPage } from './pages/MyAuditsPage';
import { ProfilePage } from './pages/ProfilePage';
import { buildWelcomeMessage, type CostAudit, type UserProfile } from './types/audit';

interface MeResponse {
  uid: string;
  displayName: string;
  isAdmin: boolean;
  adminSetupNeeded: boolean;
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminSetupNeeded, setAdminSetupNeeded] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const [audits, setAudits] = useState<CostAudit[]>([]);
  const [auditsLoading, setAuditsLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [activeAuditId, setActiveAuditId] = useState<string | null>(null);
  const [startingAudit, setStartingAudit] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const listenersRef = useRef<Unsubscribe[]>([]);

  const pushToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { ...toast, id }]);
      if (!toast.actionLabel) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 5000);
      }
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const cleanupListeners = useCallback(() => {
    for (const unsub of listenersRef.current) {
      try {
        unsub();
      } catch {
        // ignore unsubscribe errors
      }
    }
    listenersRef.current = [];
  }, []);

  // Test Firestore connection on boot
  useEffect(() => {
    void testConnection();
  }, []);

  const fetchMe = useCallback(async (firebaseUser: User) => {
    try {
      const token = await firebaseUser.getIdToken();
      const me = await apiFetch<MeResponse>('/api/me', token);
      setIsAdmin(me.isAdmin);
      setAdminSetupNeeded(me.adminSetupNeeded);
    } catch {
      setIsAdmin(false);
      setAdminSetupNeeded(false);
    }
  }, []);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      cleanupListeners();
      setUser(firebaseUser);
      setAuthReady(true);

      if (!firebaseUser) {
        setIsAdmin(false);
        setAdminSetupNeeded(false);
        setProfile(null);
        setAudits([]);
        setActiveAuditId(null);
        setActiveTab('home');
        return;
      }

      void fetchMe(firebaseUser);

      // Subscribe to user profile
      setProfileLoading(true);
      const profileRef = doc(db, 'users', firebaseUser.uid);
      const unsubProfile = onSnapshot(
        profileRef,
        (snap) => {
          if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
          } else {
            setProfile(null);
          }
          setProfileLoading(false);
        },
        (err) => {
          setProfileLoading(false);
          pushToast({ type: 'error', message: 'Could not read your profile.' });
          handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      );

      // Subscribe to user's costAudits
      setAuditsLoading(true);
      const auditsQuery = query(
        collection(db, 'users', firebaseUser.uid, 'costAudits'),
        where('userId', '==', firebaseUser.uid)
      );
      const unsubAudits = onSnapshot(
        auditsQuery,
        (snap) => {
          const list: CostAudit[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<CostAudit, 'id'>),
          }));
          list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
          setAudits(list);
          setAuditsLoading(false);
        },
        (err) => {
          setAuditsLoading(false);
          pushToast({ type: 'error', message: 'Could not load your audits.' });
          handleFirestoreError(err, OperationType.LIST, `users/${firebaseUser.uid}/costAudits`);
        }
      );

      listenersRef.current = [unsubProfile, unsubAudits];
    });

    return () => {
      cleanupListeners();
      unsubAuth();
    };
  }, [cleanupListeners, fetchMe, pushToast]);

  const handleSignIn = async () => {
    setAuthError(null);
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      setAuthError(msg);
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    cleanupListeners();
    try {
      await signOut(auth);
    } catch {
      pushToast({ type: 'error', message: 'Failed to sign out cleanly.' });
    }
  };

  const getIdToken = useCallback(async () => {
    if (!auth.currentUser) {
      throw new Error('Not signed in.');
    }
    return auth.currentUser.getIdToken();
  }, []);

  // Rule 8.4: Create the audit document and welcome message once, in the click handler
  const handleStartInterview = async () => {
    if (!user) return;
    if (!profile) {
      pushToast({
        type: 'info',
        message: 'Please complete your Employee Profile before starting an interview.',
      });
      setActiveTab('profile');
      return;
    }

    if (!navigator.onLine) {
      pushToast({
        type: 'error',
        message: 'You are offline. Reconnect to start a new interview.',
      });
      return;
    }

    setStartingAudit(true);
    const newAuditId = crypto.randomUUID();
    const welcomeText = buildWelcomeMessage(profile.displayName || user.displayName || 'Colleague');

    try {
      const batch = writeBatch(db);
      const auditRef = doc(db, 'users', user.uid, 'costAudits', newAuditId);
      batch.set(
        auditRef,
        stripUndefined({
          userId: user.uid,
          status: 'in_progress',
          questionNumber: 1,
          answerCount: 0,
          profileSnapshot: {
            displayName: profile.displayName,
            photoURL: profile.photoURL || '',
            office: profile.office,
            roleCategory: profile.roleCategory,
            position: profile.position,
            jobDescription: profile.jobDescription,
            yearsInRole: profile.yearsInRole,
          },
          costSheet: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          completedAt: null,
        })
      );

      const welcomeRef = doc(db, 'users', user.uid, 'interactions', `welcome_${newAuditId}`);
      batch.set(
        welcomeRef,
        stripUndefined({
          userId: user.uid,
          auditId: newAuditId,
          role: 'assistant',
          content: welcomeText,
          questionNumber: 1,
          timestamp: serverTimestamp(),
          modelUsed: '',
          clientMessageId: '',
        })
      );

      await withTimeout(batch.commit(), 15000, 'Starting interview timed out.');
      setActiveAuditId(newAuditId);
      setActiveTab('interview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create audit session.';
      pushToast({
        type: 'error',
        message: msg,
        actionLabel: 'Retry Save',
        onAction: () => void handleStartInterview(),
      });
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/costAudits/${newAuditId}`);
      }
    } finally {
      setStartingAudit(false);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F1F5F9] flex items-center justify-center">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl px-6 py-4 text-sm font-bold text-[#1E40AF]">
          Loading NDKC Quality Cost Audit...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorBoundary>
        <LandingPage
          onSignIn={() => void handleSignIn()}
          signingIn={signingIn}
          errorMessage={authError}
        />
      </ErrorBoundary>
    );
  }

  const latestAudit = audits[0] || null;
  const fallbackAuditId =
    activeAuditId || audits.find((a) => a.status === 'in_progress')?.id || null;

  return (
    <ErrorBoundary>
      <AppShell
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isAdmin={isAdmin}
        displayName={profile?.displayName || user.displayName || 'NDKC Employee'}
        photoURL={profile?.photoURL || user.photoURL || ''}
        onSignOut={() => void handleSignOut()}
      >
        {activeTab === 'home' && (
          <HomePage
            uid={user.uid}
            displayName={user.displayName || 'NDKC Employee'}
            profile={profile}
            profileLoading={profileLoading}
            audits={audits}
            latestAudit={latestAudit}
            auditsLoading={auditsLoading}
            adminSetupNeeded={adminSetupNeeded}
            startingAudit={startingAudit}
            onRecheckAdmin={() => void fetchMe(user)}
            onStartInterview={() => void handleStartInterview()}
            onGoToProfile={() => setActiveTab('profile')}
            onOpenAudit={(audit) => {
              if (audit.status === 'in_progress') {
                setActiveAuditId(audit.id);
                setActiveTab('interview');
              } else {
                setActiveTab('my-audits');
              }
            }}
          />
        )}

        {activeTab === 'profile' && (
          <ProfilePage
            uid={user.uid}
            authDisplayName={user.displayName || 'NDKC Employee'}
            authPhotoURL={user.photoURL || ''}
            profile={profile}
            profileLoading={profileLoading}
            onSaved={() => setActiveTab('home')}
            onNotify={pushToast}
          />
        )}

        {activeTab === 'interview' && (
          <InterviewPage
            uid={user.uid}
            auditId={fallbackAuditId}
            getIdToken={getIdToken}
            onStartNewAudit={() => void handleStartInterview()}
            onNotify={pushToast}
          />
        )}

        {activeTab === 'my-audits' && (
          <MyAuditsPage
            uid={user.uid}
            audits={audits}
            auditsLoading={auditsLoading}
            onResumeInterview={(id) => {
              setActiveAuditId(id);
              setActiveTab('interview');
            }}
            onStartNewAudit={() => void handleStartInterview()}
            onNotify={pushToast}
          />
        )}

        {isAdmin && activeTab === 'admin-baseline' && (
          <AdminBaselinePage uid={user.uid} onNotify={pushToast} />
        )}

        {isAdmin && activeTab === 'admin-ledger' && (
          <AdminLedgerPage onNotify={pushToast} />
        )}

        {isAdmin && activeTab === 'admin-reports' && (
          <AdminReportsPage
            uid={user.uid}
            getIdToken={getIdToken}
            onNotify={pushToast}
          />
        )}
      </AppShell>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ErrorBoundary>
  );
}
