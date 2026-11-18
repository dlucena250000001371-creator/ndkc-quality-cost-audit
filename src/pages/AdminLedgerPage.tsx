import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, collectionGroup, getDocs, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock,
  Layers,
  Percent,
  RefreshCw,
  Users,
} from 'lucide-react';
import { PafCategoryChip } from '../lib/display';
import {
  OperationType,
  db,
  formatTimestamp,
  handleFirestoreError,
  toMillis,
} from '../lib/firebase';
import { CategoryStackedBar } from '../components/CategoryStackedBar';
import { CostSheetView } from '../components/CostSheetView';
import { MarkdownContent } from '../components/MarkdownContent';
import { ModalDialog } from '../components/ModalDialog';
import {
  LEVEL_STYLES,
  type AuditLevel,
  type CategoryTotals,
  type CostAudit,
  type InteractionMessage,
} from '../types/audit';

interface AdminLedgerPageProps {
  onNotify: (toast: { type: 'error' | 'success' | 'info'; message: string }) => void;
}

interface FailureRow {
  audit: CostAudit;
  activity: string;
  category: 'Internal Failure' | 'External Failure';
  code: string;
  hoursPerWeek: number | null;
  cause: string;
  roleCategory: string;
  dateLabel: string;
}

export function AdminLedgerPage({ onNotify }: AdminLedgerPageProps) {
  const [audits, setAudits] = useState<CostAudit[]>([]);
  const [loading, setLoading] = useState(true);

  const [categoryFilter, setCategoryFilter] = useState<'All' | 'Internal Failure' | 'External Failure'>('All');
  const [roleFilter, setRoleFilter] = useState<'All' | 'Faculty' | 'Academic Administrator' | 'Support Office'>('All');

  const [selectedAudit, setSelectedAudit] = useState<CostAudit | null>(null);
  const [detailTab, setDetailTab] = useState<'sheet' | 'transcript'>('sheet');
  const [transcript, setTranscript] = useState<InteractionMessage[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  const loadAudits = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collectionGroup(db, 'costAudits'));
      const list: CostAudit[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CostAudit, 'id'>),
      }));
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      setAudits(list);
    } catch (err) {
      onNotify({ type: 'error', message: 'Failed to load Quality Cost Ledger.' });
      handleFirestoreError(err, OperationType.LIST, 'costAudits (collectionGroup)');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadAudits();
  }, [loadAudits]);

  const openAuditDetail = async (audit: CostAudit) => {
    setSelectedAudit(audit);
    setDetailTab(audit.costSheet ? 'sheet' : 'transcript');
    setTranscript([]);
    setTranscriptLoading(true);

    try {
      const q = query(
        collection(db, 'users', audit.userId, 'interactions'),
        where('auditId', '==', audit.id)
      );
      const snap = await getDocs(q);
      const msgs = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<InteractionMessage, 'id'>),
      }));
      msgs.sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp));
      setTranscript(msgs);
    } catch (err) {
      onNotify({ type: 'error', message: 'Failed to load interview transcript.' });
      handleFirestoreError(err, OperationType.LIST, `users/${audit.userId}/interactions`);
    } finally {
      setTranscriptLoading(false);
    }
  };

  const completedAudits = useMemo(
    () => audits.filter((a) => a.status === 'completed' && Boolean(a.costSheet)),
    [audits]
  );

  const summary = useMemo(() => {
    const people = new Set<string>();
    const totals: CategoryTotals = {
      Prevention: 0,
      Appraisal: 0,
      'Internal Failure': 0,
      'External Failure': 0,
    };

    const processMap = new Map<
      string,
      {
        code: string;
        audits: number;
        Prevention: number;
        Appraisal: number;
        'Internal Failure': number;
        'External Failure': number;
        timedCount: number;
      }
    >();

    const failures: FailureRow[] = [];

    for (const audit of completedAudits) {
      people.add(audit.userId);
      const sheet = audit.costSheet!;
      totals.Prevention += sheet.categoryTotals.Prevention || 0;
      totals.Appraisal += sheet.categoryTotals.Appraisal || 0;
      totals['Internal Failure'] += sheet.categoryTotals['Internal Failure'] || 0;
      totals['External Failure'] += sheet.categoryTotals['External Failure'] || 0;

      const pCode = sheet.processCode || 'None';
      if (!processMap.has(pCode)) {
        processMap.set(pCode, {
          code: pCode,
          audits: 0,
          Prevention: 0,
          Appraisal: 0,
          'Internal Failure': 0,
          'External Failure': 0,
          timedCount: 0,
        });
      }
      const pRow = processMap.get(pCode)!;
      pRow.audits += 1;
      pRow.Prevention += sheet.categoryTotals.Prevention || 0;
      pRow.Appraisal += sheet.categoryTotals.Appraisal || 0;
      pRow['Internal Failure'] += sheet.categoryTotals['Internal Failure'] || 0;
      pRow['External Failure'] += sheet.categoryTotals['External Failure'] || 0;

      for (const act of sheet.activities || []) {
        if (act.hoursPerWeek !== null) pRow.timedCount += 1;
        if (act.category === 'Internal Failure' || act.category === 'External Failure') {
          const matchedCause =
            sheet.rootCauses?.find((rc) =>
              rc.failure?.toLowerCase().includes(act.activity.toLowerCase().slice(0, 14))
            )?.cause ||
            sheet.rootCauses?.[0]?.cause ||
            'Not specified';
          failures.push({
            audit,
            activity: act.activity,
            category: act.category,
            code: act.code || 'None',
            hoursPerWeek: act.hoursPerWeek,
            cause: matchedCause,
            roleCategory: audit.profileSnapshot?.roleCategory || 'Support Office',
            dateLabel: formatTimestamp(audit.completedAt || audit.createdAt),
          });
        }
      }
    }

    const totalQualityHours =
      totals.Prevention +
      totals.Appraisal +
      totals['Internal Failure'] +
      totals['External Failure'];
    const copqHours = totals['Internal Failure'] + totals['External Failure'];
    const copqShare = totalQualityHours > 0 ? Math.round((copqHours / totalQualityHours) * 100) : 0;

    const processRows = Array.from(processMap.values()).map((p) => {
      const pTotal =
        p.Prevention + p.Appraisal + p['Internal Failure'] + p['External Failure'];
      const pCopq = p['Internal Failure'] + p['External Failure'];
      const pShare = pTotal > 0 ? Math.round((pCopq / pTotal) * 100) : 0;
      let level: AuditLevel = 'Not enough data';
      if (p.timedCount >= 2 && pTotal > 0) {
        if (pShare <= 25) level = 'Healthy';
        else if (pShare <= 40) level = 'Watch';
        else level = 'High';
      }
      return { ...p, copqShare: pShare, level };
    });

    failures.sort((a, b) => (b.hoursPerWeek ?? -1) - (a.hoursPerWeek ?? -1));

    return {
      peopleInterviewed: people.size,
      completedCount: completedAudits.length,
      totalQualityHours,
      copqHours,
      copqShare,
      totals,
      processRows,
      failures,
    };
  }, [completedAudits]);

  const filteredFailures = useMemo(
    () =>
      summary.failures.filter((f) => {
        if (categoryFilter !== 'All' && f.category !== categoryFilter) return false;
        if (roleFilter !== 'All' && f.roleCategory !== roleFilter) return false;
        return true;
      }),
    [summary.failures, categoryFilter, roleFilter]
  );

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Quality Cost Ledger</h1>
          <p className="text-sm text-slate-600">
            College-wide read-only Cost of Quality ledger across all employee audits.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAudits()}
          disabled={loading}
          className="px-4 py-2 bg-white border border-[#E2E8F0] hover:bg-slate-50 text-slate-800 text-xs font-bold rounded-xl shadow-sm transition-colors flex items-center gap-1.5 self-start cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Ledger</span>
        </button>
      </div>

      {/* 3a. Five Figures with Icons & Colored Top Accent Lines */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 animate-fade-rise">
        <div
          style={{ borderTopColor: '#1E40AF' }}
          className="bg-white border border-[#E2E8F0] border-t-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 space-y-2"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">People Interviewed</span>
            <Users className="w-4 h-4 text-[#1E40AF]" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
            {summary.peopleInterviewed}
          </div>
        </div>

        <div
          style={{ borderTopColor: '#16A34A' }}
          className="bg-white border border-[#E2E8F0] border-t-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 space-y-2"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">Completed Audits</span>
            <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
            {summary.completedCount}
          </div>
        </div>

        <div
          style={{ borderTopColor: '#2563EB' }}
          className="bg-white border border-[#E2E8F0] border-t-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 space-y-2"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">Quality Hours / Week</span>
            <Clock className="w-4 h-4 text-[#2563EB]" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
            {summary.totalQualityHours.toFixed(1)}
          </div>
        </div>

        <div
          style={{ borderTopColor: '#F59E0B' }}
          className="bg-white border border-[#E2E8F0] border-t-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 space-y-2"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">COPQ Hours / Week</span>
            <AlertTriangle className="w-4 h-4 text-[#F59E0B]" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums">
            {summary.copqHours.toFixed(1)}
          </div>
        </div>

        <div
          style={{ borderTopColor: '#F97316' }}
          className="bg-white border border-[#E2E8F0] border-t-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 space-y-2 col-span-2 sm:col-span-1"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold">Overall COPQ Share</span>
            <Percent className="w-4 h-4 text-[#F97316]" />
          </div>
          <div className="text-2xl font-extrabold text-[#1E40AF] tabular-nums">
            {summary.copqShare}%
          </div>
        </div>
      </div>

      {/* 3b. Where the Time Goes */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-6 space-y-3 animate-fade-rise">
        <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#1E40AF]" />
          <span>Where the Time Goes</span>
        </h2>
        <CategoryStackedBar totals={summary.totals} />
      </div>

      {/* 3c. By Process Area */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden animate-fade-rise">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#1E40AF]" />
          <h2 className="text-base font-extrabold text-slate-900">By Process Area</h2>
        </div>
        {loading ? (
          <div className="p-6 h-24 bg-slate-50 animate-pulse" />
        ) : summary.processRows.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Layers className="w-6 h-6" />
            </div>
            <p className="text-sm text-slate-600">
              Process-area figures will appear here once employees complete their Quality Cost Sheets.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left tabular-nums">
              <thead className="bg-slate-50 border-b border-[#E2E8F0] text-xs font-bold text-slate-600">
                <tr>
                  <th className="px-4 py-3">Process Code</th>
                  <th className="px-4 py-3 text-right">Audits</th>
                  <th className="px-4 py-3 text-right">Prevention</th>
                  <th className="px-4 py-3 text-right">Appraisal</th>
                  <th className="px-4 py-3 text-right">Internal Fail</th>
                  <th className="px-4 py-3 text-right">External Fail</th>
                  <th className="px-4 py-3 text-right">COPQ Share</th>
                  <th className="px-4 py-3">Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.processRows.map((row) => {
                  const style = LEVEL_STYLES[row.level];
                  return (
                    <tr key={row.code} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-bold text-[#1E40AF]">{row.code}</td>
                      <td className="px-4 py-3 text-right">{row.audits}</td>
                      <td className="px-4 py-3 text-right">{row.Prevention.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right">{row.Appraisal.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right">{row['Internal Failure'].toFixed(1)}</td>
                      <td className="px-4 py-3 text-right">{row['External Failure'].toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-bold">{row.copqShare}%</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border ${style.bg} ${style.text} ${style.border}`}
                        >
                          {row.level}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3d. Failure Activities */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden animate-fade-rise">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex flex-col md:flex-row md:items-center justify-between gap-3">
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#DC2626]" />
            <span>Failure Activities ({filteredFailures.length})</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter failure category"
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value as 'All' | 'Internal Failure' | 'External Failure')
              }
              className="px-3 py-1.5 text-xs font-bold border border-[#E2E8F0] rounded-xl bg-white"
            >
              <option value="All">All Failure Categories</option>
              <option value="Internal Failure">Internal Failure</option>
              <option value="External Failure">External Failure</option>
            </select>
            <select
              aria-label="Filter role category"
              value={roleFilter}
              onChange={(e) =>
                setRoleFilter(
                  e.target.value as 'All' | 'Faculty' | 'Academic Administrator' | 'Support Office'
                )
              }
              className="px-3 py-1.5 text-xs font-bold border border-[#E2E8F0] rounded-xl bg-white"
            >
              <option value="All">All Role Categories</option>
              <option value="Faculty">Faculty</option>
              <option value="Academic Administrator">Academic Administrator</option>
              <option value="Support Office">Support Office</option>
            </select>
          </div>
        </div>

        {filteredFailures.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-[#F59E0B] flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <p className="text-sm text-slate-600">
              No matching failure activities found for the selected filters.
            </p>
            {(categoryFilter !== 'All' || roleFilter !== 'All') && (
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('All');
                  setRoleFilter('All');
                }}
                className="px-4 py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl cursor-pointer"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left tabular-nums">
              <thead className="bg-slate-50 border-b border-[#E2E8F0] text-xs font-bold text-slate-600">
                <tr>
                  <th className="px-4 py-3">Activity</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3 text-right">Hrs/Wk</th>
                  <th className="px-4 py-3">Cause</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredFailures.map((row, idx) => (
                  <tr
                    key={`${row.audit.id}-${idx}`}
                    onClick={() => void openAuditDetail(row.audit)}
                    className="hover:bg-blue-50/60 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-semibold text-slate-900">{row.activity}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <PafCategoryChip category={row.category} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#1E40AF]">{row.code}</td>
                    <td className="px-4 py-3 text-right font-bold">
                      {row.hoursPerWeek !== null ? row.hoursPerWeek.toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate">
                      {row.cause}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">{row.roleCategory}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {row.dateLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3e. All Audits */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden animate-fade-rise">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-[#1E40AF]" />
          <h2 className="text-base font-extrabold text-slate-900">All Audits ({audits.length})</h2>
        </div>

        {audits.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-blue-50 text-[#1E40AF] flex items-center justify-center mx-auto">
              <ClipboardList className="w-6 h-6" />
            </div>
            <p className="text-sm text-slate-600">
              Employee audits will appear here as soon as someone starts an interview.
            </p>
            <button
              type="button"
              onClick={() => void loadAudits()}
              className="btn-royal px-4 py-1.5 text-xs font-bold rounded-xl cursor-pointer"
            >
              Refresh Ledger
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left tabular-nums">
              <thead className="bg-slate-50 border-b border-[#E2E8F0] text-xs font-bold text-slate-600">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Role Category</th>
                  <th className="px-4 py-3">Position</th>
                  <th className="px-4 py-3">Process</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">COPQ Share</th>
                  <th className="px-4 py-3">Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {audits.map((a) => {
                  const sheet = a.costSheet;
                  const levelStyle = sheet ? LEVEL_STYLES[sheet.level] : null;
                  return (
                    <tr
                      key={`${a.userId}-${a.id}`}
                      onClick={() => void openAuditDetail(a)}
                      className="hover:bg-blue-50/60 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {a.profileSnapshot?.displayName || 'Employee'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        {a.profileSnapshot?.roleCategory}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        {a.profileSnapshot?.position}
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        {sheet?.processName || 'In-progress Interview'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {formatTimestamp(a.completedAt || a.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold">
                        {sheet ? `${sheet.copqShare}%` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {sheet && levelStyle ? (
                          <span
                            className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border ${levelStyle.bg} ${levelStyle.text} ${levelStyle.border}`}
                          >
                            {sheet.level}
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-blue-50 text-[#1E40AF] border border-blue-200">
                            In progress
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Read-Only Audit Detail Modal */}
      <ModalDialog
        open={Boolean(selectedAudit)}
        title={
          selectedAudit
            ? `${selectedAudit.profileSnapshot?.displayName || 'Employee'} — ${
                selectedAudit.costSheet?.processName || 'Interview'
              }`
            : 'Audit Detail'
        }
        onClose={() => setSelectedAudit(null)}
        maxWidthClass="max-w-5xl"
      >
        {selectedAudit && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="text-xs text-slate-600">
                {selectedAudit.profileSnapshot?.office} ·{' '}
                {selectedAudit.profileSnapshot?.roleCategory} ·{' '}
                {selectedAudit.profileSnapshot?.position}
              </div>
              <div className="inline-flex p-1 bg-slate-100 rounded-xl">
                {selectedAudit.costSheet && (
                  <button
                    type="button"
                    onClick={() => setDetailTab('sheet')}
                    className={`px-3 py-1 text-xs font-bold rounded-lg ${
                      detailTab === 'sheet' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Quality Cost Sheet
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDetailTab('transcript')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg ${
                    detailTab === 'transcript'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  Transcript
                </button>
              </div>
            </div>

            {detailTab === 'sheet' && selectedAudit.costSheet ? (
              <CostSheetView sheet={selectedAudit.costSheet} />
            ) : transcriptLoading ? (
              <div className="h-32 bg-slate-100 rounded-xl animate-pulse" />
            ) : transcript.length === 0 ? (
              <p className="text-sm text-slate-500">No messages recorded for this audit.</p>
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
                    <div className="flex items-center justify-between text-xs font-bold mb-1">
                      <span className={m.role === 'assistant' ? 'text-[#F97316]' : 'text-[#1E40AF]'}>
                        {m.role === 'assistant'
                          ? `Audit Partner · Q${m.questionNumber}`
                          : 'Employee'}
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
      </ModalDialog>
    </div>
  );
}
