import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { ArrowLeft, ClipboardList, MessageSquareText, Play } from 'lucide-react';
import { OperationType, db, formatTimestamp, handleFirestoreError, toMillis } from '../lib/firebase';
import { CostSheetView } from '../components/CostSheetView';
import { MarkdownContent } from '../components/MarkdownContent';
import { LEVEL_STYLES, type CostAudit, type InteractionMessage } from '../types/audit';

interface MyAuditsPageProps {
  uid: string;
  audits: CostAudit[];
  auditsLoading: boolean;
  onResumeInterview: (auditId: string) => void;
  onStartNewAudit: () => void;
  onNotify: (toast: { type: 'error' | 'success' | 'info'; message: string }) => void;
}

export function MyAuditsPage({
  uid,
  audits,
  auditsLoading,
  onResumeInterview,
  onStartNewAudit,
  onNotify,
}: MyAuditsPageProps) {
  const [selectedAudit, setSelectedAudit] = useState<CostAudit | null>(null);
  const [viewMode, setViewMode] = useState<'sheet' | 'transcript'>('sheet');
  const [transcript, setTranscript] = useState<InteractionMessage[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  useEffect(() => {
    if (!selectedAudit) {
      setTranscript([]);
      return;
    }

    setTranscriptLoading(true);
    const q = query(
      collection(db, 'users', uid, 'interactions'),
      where('auditId', '==', selectedAudit.id)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<InteractionMessage, 'id'>),
        }));
        list.sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp));
        setTranscript(list);
        setTranscriptLoading(false);
      },
      (err) => {
        setTranscriptLoading(false);
        onNotify({ type: 'error', message: 'Could not load audit transcript.' });
        handleFirestoreError(err, OperationType.LIST, `users/${uid}/interactions`);
      }
    );

    return () => unsub();
  }, [uid, selectedAudit, onNotify]);

  if (selectedAudit) {
    const isCompleted = selectedAudit.status === 'completed' && Boolean(selectedAudit.costSheet);
    return (
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedAudit(null)}
              className="p-2 rounded-xl bg-white border border-[#E2E8F0] text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900">
                {selectedAudit.costSheet?.processName || 'In-progress Audit'}
              </h1>
              <div className="text-xs text-slate-500">
                {formatTimestamp(selectedAudit.createdAt)} · {selectedAudit.answerCount} answers
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isCompleted && (
              <div className="inline-flex p-1 bg-white border border-[#E2E8F0] rounded-xl">
                <button
                  type="button"
                  onClick={() => setViewMode('sheet')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                    viewMode === 'sheet'
                      ? 'btn-royal'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Quality Cost Sheet
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('transcript')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                    viewMode === 'transcript'
                      ? 'btn-royal'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Transcript
                </button>
              </div>
            )}
            {!isCompleted && (
              <button
                type="button"
                onClick={() => onResumeInterview(selectedAudit.id)}
                className="btn-coral px-4 py-2 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Resume Interview</span>
              </button>
            )}
          </div>
        </div>

        {isCompleted && viewMode === 'sheet' && selectedAudit.costSheet ? (
          <CostSheetView sheet={selectedAudit.costSheet} />
        ) : (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-6 space-y-4 animate-fade-rise">
            <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
              <MessageSquareText className="w-5 h-5 text-[#1E40AF]" />
              <span>Interview Transcript</span>
            </h2>
            {transcriptLoading ? (
              <div className="h-24 bg-slate-100 rounded-xl animate-pulse" />
            ) : transcript.length === 0 ? (
              <p className="text-sm text-slate-500">No messages recorded in this audit.</p>
            ) : (
              <div className="space-y-3">
                {transcript.map((m) => (
                  <div
                    key={m.id}
                    className={`p-4 rounded-xl border ${
                      m.role === 'assistant'
                        ? 'bg-white border-[#E2E8F0]'
                        : 'bg-[#EFF6FF] border-[#BFDBFE]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                      <span className={m.role === 'assistant' ? 'text-[#F97316]' : 'text-[#1E40AF]'}>
                        {m.role === 'assistant'
                          ? `Audit Partner · Q${m.questionNumber}`
                          : 'Your answer'}
                      </span>
                      <span className="font-normal text-slate-400">
                        {formatTimestamp(m.timestamp)}
                      </span>
                    </div>
                    {m.role === 'assistant' ? (
                      <MarkdownContent text={m.content} className="text-sm" />
                    ) : (
                      <p className="text-sm text-slate-900 whitespace-pre-wrap">{m.content}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-50 text-[#1E40AF] flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">My Audits</h1>
            <p className="text-sm text-slate-600">
              Review your interview transcripts and completed Quality Cost Sheets.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onStartNewAudit}
          className="btn-coral px-4 py-2.5 text-sm font-bold rounded-xl transition-colors flex items-center gap-2 self-start cursor-pointer shadow-sm"
        >
          <MessageSquareText className="w-4 h-4" />
          <span>New Cost Interview</span>
        </button>
      </div>

      {auditsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-32 bg-white border border-[#E2E8F0] rounded-2xl animate-pulse" />
          <div className="h-32 bg-white border border-[#E2E8F0] rounded-2xl animate-pulse" />
        </div>
      ) : audits.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-10 text-center space-y-4 animate-fade-rise">
          <div className="w-14 h-14 rounded-full bg-blue-50 text-[#1E40AF] flex items-center justify-center mx-auto">
            <ClipboardList className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-extrabold text-slate-900">No audits yet</h2>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              Start a short 7-question interview about one work process to generate your first
              Quality Cost Sheet.
            </p>
          </div>
          <button
            type="button"
            onClick={onStartNewAudit}
            className="btn-coral px-5 py-2.5 text-sm font-bold rounded-xl transition-colors cursor-pointer"
          >
            Start Cost Interview
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {audits.map((audit) => {
            const sheet = audit.costSheet;
            const levelStyle = sheet ? LEVEL_STYLES[sheet.level] : null;

            return (
              <button
                key={audit.id}
                type="button"
                onClick={() => {
                  setViewMode(sheet ? 'sheet' : 'transcript');
                  setSelectedAudit(audit);
                }}
                className="text-left bg-white border border-[#E2E8F0] hover:border-[#1E40AF] rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 p-5 space-y-3 cursor-pointer animate-fade-rise"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-extrabold text-slate-900">
                      {sheet?.processName || 'Work Process Interview'}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {formatTimestamp(audit.createdAt)} · {audit.answerCount} of 7 answers
                    </div>
                  </div>
                  {sheet && levelStyle ? (
                    <span
                      className={`px-2.5 py-1 rounded-xl text-xs font-bold border shrink-0 ${levelStyle.bg} ${levelStyle.text} ${levelStyle.border}`}
                    >
                      {sheet.level}
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-xl text-xs font-bold bg-blue-50 text-[#1E40AF] border border-blue-200 shrink-0">
                      In progress
                    </span>
                  )}
                </div>

                {sheet ? (
                  <div className="flex items-center gap-5 text-xs text-slate-600 pt-2 border-t border-slate-100 tabular-nums">
                    <span>
                      Code: <strong className="text-slate-900">{sheet.processCode}</strong>
                    </span>
                    <span>
                      Total: <strong className="text-slate-900">{sheet.totalHours.toFixed(1)} hrs</strong>
                    </span>
                    <span>
                      COPQ Share: <strong className="text-slate-900">{sheet.copqShare}%</strong>
                    </span>
                  </div>
                ) : (
                  <div className="text-xs font-bold text-[#F97316] pt-2 border-t border-slate-100">
                    Click to view transcript or resume interview
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
