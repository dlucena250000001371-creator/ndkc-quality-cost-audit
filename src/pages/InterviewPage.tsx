import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileQuestion,
  FileSpreadsheet,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Send,
} from 'lucide-react';
import {
  CATEGORY_TO_STATED_KEY,
  COST_CATEGORIES,
  createEmptyStatedHours,
  hasTimeRange,
  recomputeCostSheetWithInputs,
  roundTwo,
} from '../../shared/costMath';
import { ApiRequestError, apiFetch } from '../lib/api';
import { PafCategoryIcon, formatWelcomeTextTitleCase, getPartBorderColor } from '../lib/display';
import {
  OperationType,
  db,
  formatTimestamp,
  handleFirestoreError,
  stripUndefined,
  toMillis,
  withTimeout,
} from '../lib/firebase';
import { CostSheetView } from '../components/CostSheetView';
import { MarkdownContent } from '../components/MarkdownContent';
import { ModalDialog } from '../components/ModalDialog';
import {
  INTERVIEW_PARTS,
  LEVEL_STYLES,
  MAX_CHAT_MESSAGE_CHARS,
  type CostAudit,
  type CostCategory,
  type CostSheet,
  type InteractionMessage,
} from '../types/audit';

interface InterviewPageProps {
  uid: string;
  auditId: string | null;
  codeTitles?: Record<string, string>;
  getIdToken: () => Promise<string>;
  onStartNewAudit: () => void;
  onNotify: (toast: {
    type: 'error' | 'success' | 'info';
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => void;
}

interface ReplyResponse {
  reply: string;
  questionNumber: number;
  answerCount: number;
  closing: boolean;
  modelUsed: string;
}

interface SheetResponse {
  costSheet: CostSheet;
  modelUsed: string;
}

function ProgressRing({ completed, total = 7 }: { completed: number; total?: number }) {
  const clamped = Math.min(Math.max(completed, 0), total);
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (clamped / total) * circumference;

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64" aria-hidden="true">
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke="#E2E8F0"
            strokeWidth="6"
          />
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke={clamped >= total ? '#16A34A' : '#F97316'}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-300"
          />
        </svg>
        <span className="absolute text-xs font-extrabold text-slate-900 tabular-nums">
          {clamped} of {total}
        </span>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-extrabold text-slate-900">Interview Progress</div>
        <div className="text-xs font-semibold text-slate-500 tabular-nums">
          Answer {clamped} of {total}
        </div>
      </div>
    </div>
  );
}

function buildInitialInputs(sheet: CostSheet): Record<CostCategory, string> {
  return {
    Prevention: String(sheet.categoryTotals?.Prevention ?? 0),
    Appraisal: String(sheet.categoryTotals?.Appraisal ?? 0),
    'Internal Failure': String(sheet.categoryTotals?.['Internal Failure'] ?? 0),
    'External Failure': String(sheet.categoryTotals?.['External Failure'] ?? 0),
  };
}

export function InterviewPage({
  uid,
  auditId,
  codeTitles = {},
  getIdToken,
  onStartNewAudit,
  onNotify,
}: InterviewPageProps) {
  const [audit, setAudit] = useState<CostAudit | null>(null);
  const [messages, setMessages] = useState<InteractionMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const [inputText, setInputText] = useState('');
  const [savingMessage, setSavingMessage] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [replyError, setReplyError] = useState<string | null>(null);

  const [confirmSheetOpen, setConfirmSheetOpen] = useState(false);
  const [buildingSheet, setBuildingSheet] = useState(false);

  // Step 2: Check-your-hours in-memory review state before saving
  const [initialPendingSheet, setInitialPendingSheet] = useState<CostSheet | null>(null);
  const [hourInputs, setHourInputs] = useState<Record<CostCategory, string>>({
    Prevention: '0',
    Appraisal: '0',
    'Internal Failure': '0',
    'External Failure': '0',
  });
  const [savingFinalSheet, setSavingFinalSheet] = useState(false);

  const pendingClientMsgIdRef = useRef<string | null>(null);
  const lastSavedUserTextRef = useRef<string | null>(null);
  const scrollBottomRef = useRef<HTMLDivElement | null>(null);

  // Read-only listeners for the active audit and its interactions
  useEffect(() => {
    setInitialPendingSheet(null);
    setSavingFinalSheet(false);

    if (!uid || !auditId) {
      setAudit(null);
      setMessages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setReplyError(null);

    const auditRef = doc(db, 'users', uid, 'costAudits', auditId);
    const unsubAudit = onSnapshot(
      auditRef,
      (snap) => {
        if (snap.exists()) {
          setAudit({ id: snap.id, ...(snap.data() as Omit<CostAudit, 'id'>) });
        } else {
          setAudit(null);
        }
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        onNotify({ type: 'error', message: 'Could not load audit status.' });
        handleFirestoreError(err, OperationType.GET, `users/${uid}/costAudits/${auditId}`);
      }
    );

    const interactionsQuery = query(
      collection(db, 'users', uid, 'interactions'),
      where('auditId', '==', auditId)
    );
    const unsubMsgs = onSnapshot(
      interactionsQuery,
      (snap) => {
        const list: InteractionMessage[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<InteractionMessage, 'id'>),
        }));
        list.sort((a, b) => {
          const ta = toMillis(a.timestamp);
          const tb = toMillis(b.timestamp);
          if (ta !== tb) return ta - tb;
          return a.id.localeCompare(b.id);
        });
        setMessages(list);
      },
      (err) => {
        onNotify({ type: 'error', message: 'Could not load interview messages.' });
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/interactions`);
      }
    );

    return () => {
      unsubAudit();
      unsubMsgs();
    };
  }, [uid, auditId, onNotify]);

  // Live seconds counter while reply is pending
  useEffect(() => {
    if (!thinking) {
      setThinkingSeconds(0);
      return;
    }
    setThinkingSeconds(0);
    const timer = setInterval(() => {
      setThinkingSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [thinking]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, thinking]);

  // Pair Audit Partner questions with Employee answers and detect the Closing turn accurately
  const pairedTurns = useMemo(() => {
    const turns: Array<{
      assistant: InteractionMessage;
      user?: InteractionMessage;
      isClosing: boolean;
    }> = [];
    let userAnswersSeen = 0;

    for (const msg of messages) {
      if (msg.role === 'assistant') {
        turns.push({ assistant: msg, isClosing: userAnswersSeen >= 7 });
      } else if (msg.role === 'user') {
        userAnswersSeen++;
        if (turns.length > 0 && !turns[turns.length - 1].user) {
          turns[turns.length - 1].user = msg;
        } else {
          turns.push({
            assistant: {
              id: `synthetic-${msg.id}`,
              userId: msg.userId,
              auditId: msg.auditId,
              role: 'assistant',
              content: 'Follow-up question',
              questionNumber: msg.questionNumber,
              timestamp: msg.timestamp,
              modelUsed: '',
              clientMessageId: '',
            },
            user: msg,
            isClosing: false,
          });
        }
      }
    }
    return turns;
  }, [messages]);

  const answerCount = useMemo(
    () => messages.filter((m) => m.role === 'user').length,
    [messages]
  );

  // Live recomputation of pending sheet as employee checks/edits category hours
  const { previewSheet, hoursEdited, inputValidationError } = useMemo(() => {
    if (!initialPendingSheet) {
      return { previewSheet: null, hoursEdited: false, inputValidationError: null as string | null };
    }

    const baseStated = initialPendingSheet.statedHours || createEmptyStatedHours();
    const editedValues: Record<CostCategory, number | null> = {
      Prevention: 0,
      Appraisal: 0,
      'Internal Failure': 0,
      'External Failure': 0,
    };

    let anyEdited = false;
    let validationErr: string | null = null;

    for (const cat of COST_CATEGORIES) {
      const rawStr = (hourInputs[cat] ?? '').trim();
      const parsed = rawStr === '' ? NaN : Number(rawStr);
      const initialCatTotal = roundTwo(initialPendingSheet.categoryTotals?.[cat] ?? 0);

      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 80) {
        validationErr = `${cat} hours must be a number between 0 and 80.`;
        editedValues[cat] = baseStated[CATEGORY_TO_STATED_KEY[cat]]?.hours ?? null;
      } else {
        const rounded = roundTwo(parsed);
        const changed = Math.abs(rounded - initialCatTotal) > 0.001;
        if (changed) {
          anyEdited = true;
          editedValues[cat] = rounded;
        } else {
          const origStated = baseStated[CATEGORY_TO_STATED_KEY[cat]]?.hours;
          editedValues[cat] = origStated !== undefined ? origStated : null;
        }
      }
    }

    const recomputed = recomputeCostSheetWithInputs(initialPendingSheet, editedValues);
    return {
      previewSheet: recomputed,
      hoursEdited: anyEdited,
      inputValidationError: validationErr,
    };
  }, [initialPendingSheet, hourInputs]);

  const currentQuestionNum = audit?.questionNumber || 1;
  const isClosingReached = answerCount >= 7;
  const isCompleted = audit?.status === 'completed' && Boolean(audit.costSheet);

  const requestPartnerReply = async (clientMessageId: string, messageText: string) => {
    if (!auditId) return;
    setReplyError(null);
    setThinking(true);
    try {
      const idToken = await getIdToken();
      const data = await apiFetch<ReplyResponse>('/api/interview/reply', idToken, {
        method: 'POST',
        body: {
          auditId,
          clientMessageId,
          message: messageText,
        },
      });

      const batch = writeBatch(db);
      const asstRef = doc(db, 'users', uid, 'interactions', `asst_${clientMessageId}`);
      batch.set(
        asstRef,
        stripUndefined({
          userId: uid,
          auditId,
          role: 'assistant',
          content: data.reply,
          questionNumber: data.questionNumber,
          timestamp: serverTimestamp(),
          modelUsed: data.modelUsed || '',
          clientMessageId,
        })
      );

      const auditRef = doc(db, 'users', uid, 'costAudits', auditId);
      batch.update(
        auditRef,
        stripUndefined({
          questionNumber: data.questionNumber,
          answerCount: data.answerCount,
          updatedAt: serverTimestamp(),
        })
      );

      await withTimeout(batch.commit(), 15000, 'Saving Audit Partner reply timed out.');
      pendingClientMsgIdRef.current = null;
      lastSavedUserTextRef.current = null;
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setReplyError(err.message);
      } else {
        setReplyError('The server is busy. Click Retry.');
      }
    } finally {
      setThinking(false);
    }
  };

  const submitMessage = async (overrideText?: string) => {
    if (!auditId || !audit || isCompleted) return;
    const textToSend = (overrideText !== undefined ? overrideText : inputText).trim();
    if (textToSend.length < 1 || textToSend.length > MAX_CHAT_MESSAGE_CHARS) {
      onNotify({
        type: 'error',
        message: `Your answer must be between 1 and ${MAX_CHAT_MESSAGE_CHARS} characters.`,
      });
      return;
    }

    const clientMessageId = pendingClientMsgIdRef.current || crypto.randomUUID();
    pendingClientMsgIdRef.current = clientMessageId;

    if (!navigator.onLine) {
      setInputText(textToSend);
      onNotify({
        type: 'error',
        message: 'You are offline. Your answer was kept in the box.',
        actionLabel: 'Retry Save',
        onAction: () => void submitMessage(textToSend),
      });
      return;
    }

    // Rule 8.4: clear the input right away, save the message, call server only after save succeeds
    setInputText('');
    setSavingMessage(true);
    setReplyError(null);

    try {
      const msgRef = doc(db, 'users', uid, 'interactions', `user_${clientMessageId}`);
      await withTimeout(
        setDoc(
          msgRef,
          stripUndefined({
            userId: uid,
            auditId,
            role: 'user',
            content: textToSend,
            questionNumber: currentQuestionNum,
            timestamp: serverTimestamp(),
            modelUsed: '',
            clientMessageId,
          })
        ),
        15000,
        'Saving your answer timed out after 15 seconds.'
      );
      lastSavedUserTextRef.current = textToSend;
    } catch (err) {
      setInputText(textToSend);
      setSavingMessage(false);
      onNotify({
        type: 'error',
        message:
          err instanceof Error
            ? `${err.message} Your text has been restored.`
            : 'Failed to save your message.',
        actionLabel: 'Retry Save',
        onAction: () => void submitMessage(textToSend),
      });
      return;
    }

    setSavingMessage(false);
    await requestPartnerReply(clientMessageId, textToSend);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitMessage();
  };

  // Builds the Quality Cost Sheet in memory; does NOT save to Firestore until employee confirms
  const handleBuildCostSheet = async () => {
    if (!auditId || buildingSheet) return;
    setConfirmSheetOpen(false);
    setBuildingSheet(true);

    try {
      const idToken = await getIdToken();
      const { costSheet } = await apiFetch<SheetResponse>('/api/interview/sheet', idToken, {
        method: 'POST',
        body: { auditId },
      });

      setInitialPendingSheet(costSheet);
      setHourInputs(buildInitialInputs(costSheet));
      onNotify({
        type: 'info',
        message: 'Please review your recorded hours before saving.',
      });
    } catch (err) {
      const msg =
        err instanceof ApiRequestError
          ? err.message
          : 'Could not build Quality Cost Sheet. Please try again.';
      onNotify({
        type: 'error',
        message: msg,
        actionLabel: 'Retry',
        onAction: () => void handleBuildCostSheet(),
      });
    } finally {
      setBuildingSheet(false);
    }
  };

  const handleUndoHourChanges = () => {
    if (!initialPendingSheet) return;
    setHourInputs(buildInitialInputs(initialPendingSheet));
  };

  const handleSaveConfirmedSheet = async () => {
    if (!auditId || !previewSheet || savingFinalSheet) return;
    if (inputValidationError) {
      onNotify({ type: 'error', message: inputValidationError });
      return;
    }
    if (!navigator.onLine) {
      onNotify({
        type: 'error',
        message: 'You appear to be offline. Reconnect to save your Quality Cost Sheet.',
        actionLabel: 'Retry Save',
        onAction: () => void handleSaveConfirmedSheet(),
      });
      return;
    }

    setSavingFinalSheet(true);
    try {
      const finalSheet: CostSheet = {
        ...previewSheet,
        confirmedByEmployee: true,
        hoursEdited,
      };

      const auditRef = doc(db, 'users', uid, 'costAudits', auditId);
      const batch = writeBatch(db);
      batch.update(
        auditRef,
        stripUndefined({
          status: 'completed',
          costSheet: finalSheet,
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      await withTimeout(batch.commit(), 15000, 'Saving Quality Cost Sheet timed out.');
      setInitialPendingSheet(null);
      onNotify({
        type: 'success',
        message: 'Quality Cost Sheet confirmed and saved.',
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to save Quality Cost Sheet.';
      onNotify({
        type: 'error',
        message: msg,
        actionLabel: 'Retry Save',
        onAction: () => void handleSaveConfirmedSheet(),
      });
    } finally {
      setSavingFinalSheet(false);
    }
  };

  if (!auditId) {
    return (
      <div className="p-6 md:p-10">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-10 max-w-xl mx-auto text-center space-y-4 animate-fade-rise">
          <div className="w-14 h-14 rounded-full bg-blue-50 text-[#1E40AF] flex items-center justify-center mx-auto">
            <MessageSquareText className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-extrabold text-slate-900">No Active Interview</h1>
          <p className="text-sm text-slate-600">
            Start a short 7-question conversation with the Audit Partner about one work process you
            handle each week.
          </p>
          <button
            type="button"
            onClick={onStartNewAudit}
            className="btn-coral px-6 py-3 font-bold text-sm rounded-xl transition-colors cursor-pointer"
          >
            Start Cost Interview
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-28 bg-white border border-[#E2E8F0] rounded-2xl animate-pulse" />
        <div className="h-28 bg-white border border-[#E2E8F0] rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="p-6 md:p-10">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-10 max-w-xl mx-auto text-center space-y-4 animate-fade-rise">
          <div className="w-14 h-14 rounded-full bg-amber-50 text-[#F59E0B] flex items-center justify-center mx-auto">
            <FileQuestion className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-extrabold text-slate-900">Audit Not Found</h1>
          <p className="text-sm text-slate-600">
            This audit session could not be located. Start a new Quality Cost Interview below.
          </p>
          <button
            type="button"
            onClick={onStartNewAudit}
            className="btn-coral px-6 py-3 font-bold text-sm rounded-xl transition-colors cursor-pointer"
          >
            Start Cost Interview
          </button>
        </div>
      </div>
    );
  }

  if (isCompleted && audit.costSheet) {
    return (
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Quality Cost Sheet</h1>
            <p className="text-sm text-slate-600">
              Completed audit for {audit.profileSnapshot.position} · {audit.profileSnapshot.office}
            </p>
          </div>
          <button
            type="button"
            onClick={onStartNewAudit}
            className="btn-royal px-4 py-2 text-sm font-bold rounded-xl transition-colors self-start cursor-pointer"
          >
            Start Another Interview
          </button>
        </div>
        <CostSheetView sheet={audit.costSheet} codeTitles={codeTitles} />
      </div>
    );
  }

  // Step 2: Check-your-hours confirmation card (unsaved in memory until confirmed)
  if (initialPendingSheet && previewSheet) {
    const stated = previewSheet.statedHours || createEmptyStatedHours();
    const previewLevelStyle =
      LEVEL_STYLES[previewSheet.level] || LEVEL_STYLES['Not enough data'];
    const checksList = previewSheet.checks || [];

    return (
      <div className="p-4 md:p-8 space-y-6">
        <div className="bg-white border-2 border-[#1E40AF] rounded-2xl shadow-sm p-6 md:p-7 space-y-5 animate-fade-rise">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="space-y-1">
              <div className="text-xs font-extrabold uppercase tracking-wider text-[#F97316]">
                Check Your Hours Before Saving
              </div>
              <h1 className="text-xl md:text-2xl font-extrabold text-slate-900">
                Here&apos;s what I recorded. Is this right?
              </h1>
              <p className="text-sm text-slate-600">
                Adjust any category&apos;s weekly hours below if needed, then save your Quality Cost
                Sheet. Nothing is saved until you click &ldquo;Yes, save my sheet&rdquo;.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setInitialPendingSheet(null)}
              disabled={savingFinalSheet}
              className="text-xs font-bold text-[#1E40AF] hover:underline self-start cursor-pointer"
            >
              Back to interview
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {COST_CATEGORIES.map((cat) => {
              const key = CATEGORY_TO_STATED_KEY[cat];
              const entry = stated[key];
              const hasRange = hasTimeRange(entry?.said || '');
              const inputId = `check-hours-${key}`;

              return (
                <div
                  key={cat}
                  className="p-4 rounded-2xl bg-slate-50 border border-[#E2E8F0] space-y-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <label
                      htmlFor={inputId}
                      className="flex items-center gap-2 text-sm font-extrabold text-slate-900"
                    >
                      <PafCategoryIcon category={cat} className="w-4 h-4 shrink-0" />
                      <span>{cat}</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        id={inputId}
                        type="number"
                        min={0}
                        max={80}
                        step={0.5}
                        value={hourInputs[cat]}
                        onChange={(e) =>
                          setHourInputs((prev) => ({ ...prev, [cat]: e.target.value }))
                        }
                        className="w-24 px-3 py-1.5 text-sm font-extrabold text-right text-slate-900 bg-white border border-[#E2E8F0] rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
                      />
                      <span className="text-xs font-bold text-slate-500">hrs/wk</span>
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1">
                    <div>
                      <span className="font-bold text-slate-700">You said:</span>{' '}
                      {entry?.said ? (
                        <span className="italic">&ldquo;{entry.said}&rdquo;</span>
                      ) : (
                        <span className="text-slate-400">No category total stated</span>
                      )}
                    </div>
                    {hasRange && (
                      <div>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-[#1E40AF] border border-blue-200">
                          higher number used
                        </span>
                      </div>
                    )}
                    {entry?.peakNote && (
                      <div className="text-amber-800 font-semibold">
                        Peak period: {entry.peakNote}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {inputValidationError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-800"
            >
              {inputValidationError}
            </div>
          )}

          {checksList.length > 0 && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-900">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Hours Checks</span>
              </div>
              <ul className="list-disc pl-5 text-xs text-amber-900 space-y-0.5">
                {checksList.map((chk, idx) => (
                  <li key={idx}>{chk}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Live Total, COPQ Share & Level + Actions */}
          <div className="pt-4 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-5 text-sm tabular-nums">
              <div>
                <span className="text-slate-500 font-semibold">Total: </span>
                <span className="font-extrabold text-slate-900">
                  {previewSheet.totalHours.toFixed(1)} hrs/wk
                </span>
              </div>
              <div>
                <span className="text-slate-500 font-semibold">COPQ Share: </span>
                <span className="font-extrabold text-slate-900">
                  {previewSheet.copqShare}% ({previewSheet.copqHours.toFixed(1)} hrs)
                </span>
              </div>
              <span
                className={`px-3 py-1 rounded-xl text-xs font-bold border ${previewLevelStyle.bg} ${previewLevelStyle.text} ${previewLevelStyle.border}`}
              >
                {previewSheet.level}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleUndoHourChanges}
                disabled={!hoursEdited || savingFinalSheet}
                className="px-4 py-2.5 text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Undo my changes</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSaveConfirmedSheet()}
                disabled={savingFinalSheet || Boolean(inputValidationError)}
                className="btn-coral px-5 py-2.5 text-sm font-extrabold rounded-xl transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{savingFinalSheet ? 'Saving Sheet...' : 'Yes, save my sheet'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live Preview of the Quality Cost Sheet */}
        <div className="space-y-2">
          <div className="text-xs font-extrabold uppercase tracking-wider text-slate-500 px-1">
            Quality Cost Sheet Preview (Unsaved)
          </div>
          <CostSheetView sheet={previewSheet} codeTitles={codeTitles} />
        </div>
      </div>
    );
  }

  const canBuildSheet = answerCount >= 5 && !thinking && !savingMessage && !buildingSheet;

  return (
    <div className="md:h-[calc(100vh-56px)] flex flex-col lg:grid lg:grid-cols-12 gap-4 p-4 md:p-6 overflow-hidden">
      {/* Left 2/3: Question Cards + Fixed Answer Box */}
      <div className="lg:col-span-8 flex flex-col min-h-0 flex-1 bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {pairedTurns.map((turn, idx) => {
            const qNum = turn.assistant.questionNumber || 1;
            const partMeta = INTERVIEW_PARTS.find((p) => p.num === qNum);
            const badgeText = turn.isClosing
              ? 'Closing'
              : `Q${qNum} · ${partMeta?.label || 'Interview'}`;
            const partColor = getPartBorderColor(qNum, turn.isClosing);
            const displayBody =
              idx === 0
                ? formatWelcomeTextTitleCase(turn.assistant.content)
                : turn.assistant.content;

            return (
              <div
                key={turn.assistant.id}
                style={{ borderLeftColor: partColor }}
                className="bg-white border border-[#E2E8F0] border-l-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 md:p-5 space-y-3 animate-fade-rise"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div
                      style={{ backgroundColor: '#1E40AF', color: '#FFFFFF' }}
                      className="w-8 h-8 rounded-full text-xs font-extrabold flex items-center justify-center shrink-0"
                      aria-hidden="true"
                    >
                      AP
                    </div>
                    <span
                      style={{ backgroundColor: '#F97316', color: '#FFFFFF' }}
                      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-extrabold"
                    >
                      {badgeText}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {formatTimestamp(turn.assistant.timestamp)}
                  </span>
                </div>

                <MarkdownContent text={displayBody} className="text-sm md:text-base" />

                {turn.user && (
                  <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-xs font-bold text-[#1E40AF]">
                      <span>Your answer</span>
                      <span className="font-normal text-slate-500">
                        {formatTimestamp(turn.user.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-900 whitespace-pre-wrap leading-relaxed">
                      {turn.user.content}
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {thinking && (
            <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-4 flex items-center gap-3 text-sm font-bold text-[#1E40AF]">
              <div className="w-4 h-4 border-2 border-[#1E40AF] border-t-transparent rounded-full animate-spin" />
              <span className="tabular-nums">Thinking… {thinkingSeconds}s</span>
            </div>
          )}

          {replyError && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <span className="text-sm font-semibold text-red-900">{replyError}</span>
              {pendingClientMsgIdRef.current && lastSavedUserTextRef.current && (
                <button
                  type="button"
                  onClick={() =>
                    void requestPartnerReply(
                      pendingClientMsgIdRef.current!,
                      lastSavedUserTextRef.current!
                    )
                  }
                  className="btn-coral px-4 py-1.5 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 self-start sm:self-auto"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              )}
            </div>
          )}

          <div ref={scrollBottomRef} />
        </div>

        {/* Always-Visible Answer Box */}
        <form
          onSubmit={handleFormSubmit}
          className="border-t border-[#E2E8F0] bg-slate-50 p-3.5 md:p-4 shrink-0 space-y-2"
        >
          <div className="flex items-end gap-2.5">
            <textarea
              rows={2}
              maxLength={MAX_CHAT_MESSAGE_CHARS}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!savingMessage && !thinking && inputText.trim()) {
                    void submitMessage();
                  }
                }
              }}
              disabled={savingMessage || thinking || buildingSheet}
              placeholder={
                isClosingReached
                  ? 'Interview complete — click Build Quality Cost Sheet on the right (or add a final note).'
                  : 'Type your answer here (include rough hours per week where you can)...'
              }
              className="flex-1 resize-none px-3.5 py-2.5 bg-white border border-[#E2E8F0] rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E40AF] disabled:bg-slate-100"
            />
            <button
              type="submit"
              disabled={savingMessage || thinking || buildingSheet || !inputText.trim()}
              className="btn-royal px-4 py-2.5 h-[42px] disabled:opacity-50 font-bold text-sm rounded-xl transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>{savingMessage ? 'Saving...' : 'Send'}</span>
            </button>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Press Enter to send · Shift+Enter for a new line</span>
            <span className="tabular-nums">
              {inputText.length} / {MAX_CHAT_MESSAGE_CHARS}
            </span>
          </div>
        </form>
      </div>

      {/* Right 1/3: Sticky Progress Ring + 7-Part Checklist + Build Quality Cost Sheet */}
      <aside className="lg:col-span-4 bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-5 flex flex-col justify-between gap-5 shrink-0 lg:overflow-y-auto">
        <div className="space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <ProgressRing completed={answerCount} total={7} />
          </div>

          <ol className="space-y-2.5">
            {INTERVIEW_PARTS.map((part) => {
              const done = answerCount >= part.num;
              const current = !done && currentQuestionNum === part.num;
              return (
                <li
                  key={part.num}
                  className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-colors ${
                    current
                      ? 'bg-orange-50/70 border-orange-200'
                      : done
                        ? 'bg-green-50/50 border-green-200'
                        : 'bg-slate-50 border-slate-100'
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                  ) : (
                    <Circle
                      className={`w-4 h-4 shrink-0 mt-0.5 ${
                        current ? 'text-[#F97316]' : 'text-slate-300'
                      }`}
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-slate-900">
                      {part.num}. {part.label}
                    </div>
                    <div className="text-[11px] text-slate-500 leading-snug">
                      {part.description}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="space-y-2.5 pt-3 border-t border-slate-100">
          <button
            type="button"
            disabled={!canBuildSheet}
            onClick={() => setConfirmSheetOpen(true)}
            className={`w-full py-3 px-4 rounded-xl font-extrabold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              isClosingReached ? 'btn-coral' : 'btn-royal'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>
              {buildingSheet ? 'Building Quality Cost Sheet...' : 'Build Quality Cost Sheet'}
            </span>
          </button>
          <p className="text-xs text-slate-500 text-center">
            {answerCount < 5
              ? `Available after 5 answers (${5 - answerCount} remaining).`
              : isClosingReached
                ? 'All 7 parts answered. Click above to review and build your sheet.'
                : 'You can build now or finish all 7 questions first.'}
          </p>
        </div>
      </aside>

      <ModalDialog
        open={confirmSheetOpen}
        title="Build Quality Cost Sheet?"
        onClose={() => setConfirmSheetOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700 leading-relaxed">
            This will analyze your interview transcript and prepare your Quality Cost Sheet so you
            can review and confirm your weekly hours before saving.
          </p>
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setConfirmSheetOpen(false)}
              className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Keep Interviewing
            </button>
            <button
              type="button"
              onClick={() => void handleBuildCostSheet()}
              className="btn-coral px-5 py-2 text-sm font-bold rounded-xl transition-colors"
            >
              Build Sheet Now
            </button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}
