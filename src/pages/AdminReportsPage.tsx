import { useEffect, useState } from 'react';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  CheckCircle2,
  Download,
  Eye,
  FileBarChart2,
  Percent,
  Save,
  Trash2,
  Users,
} from 'lucide-react';
import { ApiRequestError, apiFetch } from '../lib/api';
import {
  OperationType,
  db,
  formatTimestamp,
  handleFirestoreError,
  stripUndefined,
  toMillis,
  withTimeout,
} from '../lib/firebase';
import {
  CATEGORY_TO_STATED_KEY,
  COST_CATEGORIES,
  formatBaselineCode,
  isClosingMessage,
} from '../../shared/costMath';
import { MarkdownContent } from '../components/MarkdownContent';
import { ModalDialog } from '../components/ModalDialog';
import type {
  AdminStats,
  CostAudit,
  InteractionMessage,
  LedgerReport,
} from '../types/audit';

interface AdminReportsPageProps {
  uid: string;
  codeTitles?: Record<string, string>;
  getIdToken: () => Promise<string>;
  onNotify: (toast: {
    type: 'error' | 'success' | 'info';
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => void;
}

interface ReportApiResponse {
  markdown: string;
  stats: AdminStats;
  modelUsed: string;
}

function triggerMarkdownDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AdminReportsPage({
  uid,
  codeTitles = {},
  getIdToken,
  onNotify,
}: AdminReportsPageProps) {
  const [reports, setReports] = useState<LedgerReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);

  const [generating, setGenerating] = useState(false);
  const [draftReport, setDraftReport] = useState<ReportApiResponse | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  const [exportingTranscripts, setExportingTranscripts] = useState(false);
  const [viewingReport, setViewingReport] = useState<LedgerReport | null>(null);
  const [deletingReport, setDeletingReport] = useState<LedgerReport | null>(null);

  useEffect(() => {
    setLoadingReports(true);
    const unsub = onSnapshot(
      collection(db, 'ledgerReports'),
      (snap) => {
        const list: LedgerReport[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<LedgerReport, 'id'>),
        }));
        list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setReports(list);
        setLoadingReports(false);
      },
      (err) => {
        setLoadingReports(false);
        onNotify({ type: 'error', message: 'Could not load saved reports.' });
        handleFirestoreError(err, OperationType.LIST, 'ledgerReports');
      }
    );
    return () => unsub();
  }, [onNotify]);

  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      const idToken = await getIdToken();
      const result = await apiFetch<ReportApiResponse>('/api/admin/report', idToken, {
        method: 'POST',
        body: {},
      });
      setDraftReport(result);
      onNotify({ type: 'success', message: 'Consolidated report generated.' });
    } catch (err) {
      const msg =
        err instanceof ApiRequestError
          ? err.message
          : 'Failed to generate consolidated report.';
      onNotify({ type: 'error', message: msg });
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!draftReport) return;
    setSavingDraft(true);
    const reportId = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const title = `NDKC Consolidated Quality Cost Report — ${today}`;

    try {
      await withTimeout(
        setDoc(
          doc(db, 'ledgerReports', reportId),
          stripUndefined({
            title,
            markdown: draftReport.markdown,
            stats: {
              peopleInterviewed: draftReport.stats.peopleInterviewed,
              completedAudits: draftReport.stats.completedAudits,
              totalQualityHours: draftReport.stats.totalQualityHours,
              copqHours: draftReport.stats.copqHours,
              copqShare: draftReport.stats.copqShare,
              categoryTotals: draftReport.stats.categoryTotals,
              processAreasCount: draftReport.stats.processAreasCount,
            },
            modelUsed: draftReport.modelUsed,
            createdAt: serverTimestamp(),
            createdBy: uid,
          })
        ),
        15000,
        'Saving report timed out.'
      );
      setDraftReport(null);
      onNotify({ type: 'success', message: 'Report saved to /ledgerReports.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save report.';
      onNotify({
        type: 'error',
        message: msg,
        actionLabel: 'Retry Save',
        onAction: () => void handleSaveDraft(),
      });
    } finally {
      setSavingDraft(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingReport) return;
    const target = deletingReport;
    setDeletingReport(null);
    try {
      await deleteDoc(doc(db, 'ledgerReports', target.id));
      onNotify({ type: 'success', message: 'Report deleted.' });
    } catch (err) {
      onNotify({ type: 'error', message: 'Could not delete report.' });
      handleFirestoreError(err, OperationType.DELETE, `ledgerReports/${target.id}`);
    }
  };

  const handleDownloadAllTranscripts = async () => {
    setExportingTranscripts(true);
    try {
      const [auditsSnap, interactionsSnap] = await Promise.all([
        getDocs(collectionGroup(db, 'costAudits')),
        getDocs(collectionGroup(db, 'interactions')),
      ]);

      const audits: CostAudit[] = auditsSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CostAudit, 'id'>),
      }));
      audits.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

      const msgByAudit = new Map<string, InteractionMessage[]>();
      for (const d of interactionsSnap.docs) {
        const msg = { id: d.id, ...(d.data() as Omit<InteractionMessage, 'id'>) };
        const key = `${msg.userId}::${msg.auditId}`;
        if (!msgByAudit.has(key)) msgByAudit.set(key, []);
        msgByAudit.get(key)!.push(msg);
      }

      const lines: string[] = [];
      lines.push('# NDKC Quality Cost Audit — Full Transcripts & Cost Sheets');
      lines.push(`Exported: ${new Date().toISOString()}`);
      lines.push(`Total Audits: ${audits.length}`);
      lines.push('');

      for (const audit of audits) {
        const snap = audit.profileSnapshot;
        lines.push('---');
        lines.push(`## Audit: ${audit.costSheet?.processName || 'In-progress Interview'} (${audit.id})`);
        lines.push(`- **Employee**: ${snap?.displayName || 'Employee'}`);
        lines.push(`- **Department / Office**: ${snap?.office || ''}`);
        lines.push(`- **Role Category**: ${snap?.roleCategory || ''}`);
        lines.push(`- **Position**: ${snap?.position || ''}`);
        lines.push(`- **Years in Role**: ${snap?.yearsInRole ?? ''}`);
        lines.push(`- **Job Description**: ${snap?.jobDescription || ''}`);
        lines.push(`- **Status**: ${audit.status}`);
        lines.push(`- **Created At**: ${formatTimestamp(audit.createdAt)}`);
        if (audit.completedAt) {
          lines.push(`- **Completed At**: ${formatTimestamp(audit.completedAt)}`);
        }
        lines.push('');
        lines.push('### Interview Transcript');
        const msgs = (msgByAudit.get(`${audit.userId}::${audit.id}`) || []).sort(
          (a, b) => toMillis(a.timestamp) - toMillis(b.timestamp)
        );
        if (msgs.length === 0) {
          lines.push('_No messages recorded._');
        } else {
          for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            const closingMsg = isClosingMessage(msgs, i);
            const speaker =
              m.role === 'assistant'
                ? closingMsg
                  ? 'Audit Partner (Closing)'
                  : `Audit Partner (Q${m.questionNumber})`
                : 'Employee';
            const timeStr = formatTimestamp(m.timestamp);
            lines.push(`- **[${timeStr}] ${speaker}:** ${m.content.replace(/\r?\n/g, ' ')}`);
          }
        }
        lines.push('');

        if (audit.costSheet) {
          const sheet = audit.costSheet;
          lines.push('### Quality Cost Sheet');
          lines.push(
            `- **Process**: ${sheet.processName} (${formatBaselineCode(sheet.processCode, codeTitles)})`
          );
          lines.push(`- **Summary**: ${sheet.summary}`);
          lines.push(
            `- **Confirmation**: Confirmed by employee: ${
              sheet.confirmedByEmployee === undefined
                ? 'Not recorded'
                : sheet.confirmedByEmployee
                  ? 'Yes'
                  : 'No'
            } | Hours edited: ${
              sheet.hoursEdited === undefined
                ? 'Not recorded'
                : sheet.hoursEdited
                  ? 'Yes'
                  : 'No'
            }`
          );
          lines.push(
            `- **Totals**: Total = ${sheet.totalHours} hrs/wk | Prevention = ${sheet.categoryTotals.Prevention} hrs | Appraisal = ${sheet.categoryTotals.Appraisal} hrs | Internal Failure = ${sheet.categoryTotals['Internal Failure']} hrs | External Failure = ${sheet.categoryTotals['External Failure']} hrs`
          );
          lines.push(
            `- **COPQ**: ${sheet.copqHours} hrs/wk (${sheet.copqShare}%) — **Level**: ${sheet.level}`
          );
          if (sheet.statedHours) {
            lines.push('');
            lines.push('#### Stated Category Hours');
            for (const cat of COST_CATEGORIES) {
              const entry = sheet.statedHours[CATEGORY_TO_STATED_KEY[cat]];
              const hrsText =
                entry?.hours !== null && entry?.hours !== undefined
                  ? `${entry.hours} hrs/wk`
                  : 'Not stated';
              const saidText = entry?.said ? ` | Said: "${entry.said}"` : '';
              const peakText = entry?.peakNote ? ` | Peak note: "${entry.peakNote}"` : '';
              lines.push(`- **${cat}**: ${hrsText}${saidText}${peakText}`);
            }
          }
          if (Array.isArray(sheet.checks) && sheet.checks.length > 0) {
            lines.push('');
            lines.push('#### Hours Checks');
            for (const chk of sheet.checks) {
              lines.push(`- ${chk}`);
            }
          }
          lines.push('');
          lines.push('#### Activities');
          for (const act of sheet.activities || []) {
            lines.push(
              `- [${act.category}] **${act.activity}** | Hours/wk: ${
                act.hoursPerWeek ?? 'Not specified'
              } | Source: ${act.hoursSource || '—'} | Peak periods only: ${
                act.peakOnly ? 'Yes' : 'No'
              } | Frequency: ${act.frequency || '—'} | Code: ${formatBaselineCode(
                act.code,
                codeTitles
              )} | Quote: "${act.evidenceQuote}"`
            );
          }
          lines.push('');
          lines.push('#### Root Causes');
          for (const rc of sheet.rootCauses || []) {
            lines.push(
              `- **${rc.failure}**: ${rc.cause} | Needs approval: ${
                rc.needsApproval ? 'Yes' : 'No'
              } (Factors: ${(rc.contributingFactors || []).join(', ') || 'None'}) | Quote: "${
                rc.evidenceQuote
              }"`
            );
          }
          lines.push('');
          lines.push('#### Kaizen Actions');
          for (const k of sheet.kaizenActions || []) {
            lines.push(
              `- **${k.step}** | Target: ${k.target || '—'} | Owner: ${k.owner} | Measure: ${
                k.measure
              } | Code: ${formatBaselineCode(k.code, codeTitles)}`
            );
          }
          lines.push('');
          lines.push('#### Strengths');
          for (const s of sheet.strengths || []) {
            lines.push(`- ${s}`);
          }
          lines.push('');
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      triggerMarkdownDownload(`ndkc-quality-cost-transcripts-${today}.md`, lines.join('\n'));
      onNotify({ type: 'success', message: 'Transcripts exported as Markdown.' });
    } catch (err) {
      onNotify({ type: 'error', message: 'Could not export transcripts.' });
      handleFirestoreError(err, OperationType.LIST, 'costAudits & interactions (collectionGroup)');
    } finally {
      setExportingTranscripts(false);
    }
  };

  const highlightStats = draftReport?.stats || reports[0]?.stats || null;

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-50 text-[#1E40AF] flex items-center justify-center shrink-0 mt-0.5">
            <FileBarChart2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Consolidated Reports</h1>
            <p className="text-sm text-slate-600">
              Generate college-wide TQM Cost of Quality reports and export full interview
              transcripts.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleDownloadAllTranscripts()}
            disabled={exportingTranscripts}
            className="px-4 py-2.5 bg-white border border-[#E2E8F0] hover:bg-slate-50 text-slate-800 text-sm font-bold rounded-xl shadow-sm transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>
              {exportingTranscripts ? 'Exporting...' : 'Download transcripts (.md)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void handleGenerateReport()}
            disabled={generating}
            className="btn-coral px-5 py-2.5 disabled:opacity-60 text-sm font-bold rounded-xl shadow-sm transition-colors flex items-center gap-2 cursor-pointer"
          >
            <FileBarChart2 className="w-4 h-4" />
            <span>
              {generating ? 'Generating Report...' : 'Generate Consolidated Report'}
            </span>
          </button>
        </div>
      </div>

      {/* Report Summary KPI Tiles with Icons & Colored Top Accent Lines */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-rise">
        <div
          style={{ borderTopColor: '#1E40AF' }}
          className="bg-white border border-[#E2E8F0] border-t-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 space-y-2"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">Saved Reports</span>
            <FileBarChart2 className="w-4 h-4 text-[#1E40AF]" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
            {loadingReports ? '…' : reports.length}
          </div>
        </div>

        <div
          style={{ borderTopColor: '#16A34A' }}
          className="bg-white border border-[#E2E8F0] border-t-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 space-y-2"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">Latest Report Audits</span>
            <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
            {highlightStats ? highlightStats.completedAudits : '—'}
          </div>
        </div>

        <div
          style={{ borderTopColor: '#2563EB' }}
          className="bg-white border border-[#E2E8F0] border-t-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 space-y-2"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">People Covered</span>
            <Users className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
            {highlightStats ? highlightStats.peopleInterviewed : '—'}
          </div>
        </div>

        <div
          style={{ borderTopColor: '#F97316' }}
          className="bg-white border border-[#E2E8F0] border-t-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 space-y-2"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">Latest COPQ Share</span>
            <Percent className="w-4 h-4 text-[#F97316]" />
          </div>
          <div className="text-2xl font-extrabold text-[#1E40AF] tabular-nums">
            {highlightStats ? `${highlightStats.copqShare}%` : '—'}
          </div>
        </div>
      </div>

      {/* Draft Report Preview */}
      {draftReport && (
        <div className="bg-white border-2 border-[#F97316] rounded-2xl shadow-sm p-6 space-y-4 animate-fade-rise">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">
                Generated Report Preview (Unsaved)
              </h2>
              <p className="text-xs text-slate-500">
                {draftReport.stats.completedAudits} completed audits ·{' '}
                {draftReport.stats.peopleInterviewed} people interviewed · COPQ Share:{' '}
                {draftReport.stats.copqShare}%
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  triggerMarkdownDownload(
                    `ndkc-consolidated-report-${new Date().toISOString().slice(0, 10)}.md`,
                    draftReport.markdown
                  )
                }
                className="px-3.5 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .md</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSaveDraft()}
                disabled={savingDraft}
                className="btn-royal px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingDraft ? 'Saving...' : 'Save Report'}</span>
              </button>
            </div>
          </div>

          <MarkdownContent text={draftReport.markdown} />
        </div>
      )}

      {/* Saved Reports List */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden animate-fade-rise">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center gap-2">
          <FileBarChart2 className="w-4 h-4 text-[#1E40AF]" />
          <h2 className="text-base font-extrabold text-slate-900">
            Saved Consolidated Reports ({reports.length})
          </h2>
        </div>

        {loadingReports ? (
          <div className="p-6 space-y-3">
            <div className="h-14 bg-slate-100 rounded-xl animate-pulse" />
            <div className="h-14 bg-slate-100 rounded-xl animate-pulse" />
          </div>
        ) : reports.length === 0 ? (
          <div className="p-10 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-orange-50 text-[#F97316] flex items-center justify-center mx-auto">
              <FileBarChart2 className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-extrabold text-slate-900">No saved reports yet</p>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                Compile all completed employee Quality Cost Sheets into a single institutional
                report.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleGenerateReport()}
              disabled={generating}
              className="btn-coral px-5 py-2.5 disabled:opacity-60 text-sm font-bold rounded-xl transition-colors cursor-pointer"
            >
              {generating ? 'Generating Report...' : 'Generate Consolidated Report'}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {reports.map((rep) => (
              <div
                key={rep.id}
                className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
              >
                <div>
                  <div className="text-sm font-bold text-slate-900">{rep.title}</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    {formatTimestamp(rep.createdAt)} · {rep.stats?.completedAudits ?? 0} audits ·
                    COPQ Share {rep.stats?.copqShare ?? 0}%
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setViewingReport(rep)}
                    className="px-3 py-1.5 text-xs font-bold text-[#1E40AF] bg-blue-50 hover:bg-blue-100 rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerMarkdownDownload(
                        `${rep.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
                        rep.markdown
                      )
                    }
                    className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>.md</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingReport(rep)}
                    className="px-3 py-1.5 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View Saved Report Modal */}
      <ModalDialog
        open={Boolean(viewingReport)}
        title={viewingReport?.title || 'Consolidated Report'}
        onClose={() => setViewingReport(null)}
        maxWidthClass="max-w-4xl"
      >
        {viewingReport && <MarkdownContent text={viewingReport.markdown} />}
      </ModalDialog>

      {/* Delete Report Confirmation */}
      <ModalDialog
        open={Boolean(deletingReport)}
        title="Delete Saved Report?"
        onClose={() => setDeletingReport(null)}
      >
        {deletingReport && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Permanently delete <strong>{deletingReport.title}</strong>?
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingReport(null)}
                className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}
