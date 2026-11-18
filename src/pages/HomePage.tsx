import {
  ArrowRight,
  Award,
  CheckCircle2,
  Clock,
  ClipboardCheck,
  KeyRound,
  Play,
  RefreshCw,
  UserCheck,
  UserCircle2,
} from 'lucide-react';
import { CategoryStackedBar } from '../components/CategoryStackedBar';
import {
  PAF_CATEGORIES,
  PafCategoryIcon,
  formatFirstNameTitleCase,
  formatTodayLabel,
  getTimeGreeting,
} from '../lib/display';
import { formatTimestamp } from '../lib/firebase';
import {
  LEVEL_STYLES,
  type CostAudit,
  type UserProfile,
} from '../types/audit';

interface HomePageProps {
  uid: string;
  displayName: string;
  profile: UserProfile | null;
  profileLoading: boolean;
  audits: CostAudit[];
  latestAudit: CostAudit | null;
  auditsLoading: boolean;
  adminSetupNeeded: boolean;
  startingAudit: boolean;
  onRecheckAdmin: () => void;
  onStartInterview: () => void;
  onGoToProfile: () => void;
  onOpenAudit: (audit: CostAudit) => void;
}

export function HomePage({
  uid,
  displayName,
  profile,
  profileLoading,
  audits,
  latestAudit,
  auditsLoading,
  adminSetupNeeded,
  startingAudit,
  onRecheckAdmin,
  onStartInterview,
  onGoToProfile,
  onOpenAudit,
}: HomePageProps) {
  const firstName = formatFirstNameTitleCase(profile?.displayName || displayName);
  const greeting = getTimeGreeting();
  const todayLabel = formatTodayLabel();

  const completedAudits = audits.filter(
    (a) => a.status === 'completed' && Boolean(a.costSheet)
  );
  const latestCompleted = completedAudits[0] || null;
  const latestSheet = latestCompleted?.costSheet || null;
  const latestLevelStyle = latestSheet ? LEVEL_STYLES[latestSheet.level] : null;

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Super Admin Setup Card */}
      {adminSetupNeeded && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl shadow-sm p-6 space-y-3 animate-fade-rise">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2.5">
              <KeyRound className="w-5 h-5 text-amber-700 shrink-0" />
              <h2 className="text-base font-extrabold text-amber-950">
                Super Administrator Setup Required
              </h2>
            </div>
            <button
              type="button"
              onClick={onRecheckAdmin}
              className="px-3 py-1.5 text-xs font-bold bg-amber-600 text-white rounded-xl hover:bg-amber-700 transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Re-check Admin Status</span>
            </button>
          </div>
          <p className="text-sm text-amber-900">
            Your email matches the configured super administrator account, but your{' '}
            <code className="font-mono bg-amber-100 px-1.5 py-0.5 rounded">/admins/{uid}</code>{' '}
            document does not exist yet. Create it manually in the Firebase Console:
          </p>
          <div className="bg-white border border-amber-200 rounded-xl p-4 text-xs font-mono text-slate-800 space-y-1">
            <div>Collection: admins</div>
            <div>Document ID: {uid}</div>
            <div>Field: role = &quot;superadmin&quot; (string)</div>
          </div>
        </div>
      )}

      {/* Welcome Banner using .hero-gradient */}
      <div className="hero-gradient rounded-2xl shadow-sm p-6 md:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 animate-fade-rise">
        <div className="space-y-2 max-w-2xl">
          <div
            className="text-xs font-extrabold uppercase tracking-wider"
            style={{ color: '#FDBA74' }}
          >
            Notre Dame of Kidapawan College
          </div>
          <div className="text-xs font-bold" style={{ color: '#DBEAFE' }}>
            {todayLabel}
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white">
            {greeting}, {firstName}
          </h1>
          <p className="text-sm md:text-base leading-relaxed" style={{ color: '#DBEAFE' }}>
            Work through a 7-question conversation with the Audit Partner about one core work
            process, then turn it into your Quality Cost Sheet.
          </p>
        </div>

        <div className="shrink-0">
          {profileLoading ? (
            <div
              style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}
              className="h-12 w-56 rounded-xl animate-pulse"
            />
          ) : !profile ? (
            <button
              type="button"
              onClick={onGoToProfile}
              className="btn-coral w-full sm:w-auto px-6 py-3.5 font-extrabold text-base rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <UserCheck className="w-5 h-5" />
              <span>Complete Profile First</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartInterview}
              disabled={startingAudit}
              className="btn-coral w-full sm:w-auto px-7 py-4 disabled:opacity-60 font-extrabold text-base rounded-xl transition-colors flex items-center justify-center gap-2.5 cursor-pointer shadow-sm"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>{startingAudit ? 'Starting Interview...' : 'Start Cost Interview'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Three Small Stat Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-fade-rise">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 flex items-center gap-3.5">
          <div
            style={{ backgroundColor: '#EFF6FF', color: '#1E40AF' }}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          >
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-500">Audits Completed</div>
            <div className="text-xl font-extrabold text-slate-900 tabular-nums">
              {auditsLoading ? '…' : completedAudits.length}
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 flex items-center gap-3.5">
          <div
            style={{ backgroundColor: '#FFF7ED', color: '#EA580C' }}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          >
            <Award className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-slate-500">Latest COPQ Share</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xl font-extrabold text-slate-900 tabular-nums">
                {auditsLoading ? '…' : latestSheet ? `${latestSheet.copqShare}%` : '—'}
              </span>
              {latestSheet && latestLevelStyle && (
                <span
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border ${latestLevelStyle.bg} ${latestLevelStyle.text} ${latestLevelStyle.border}`}
                >
                  {latestSheet.level}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 flex items-center gap-3.5">
          <div
            style={{ backgroundColor: '#F0FDF4', color: '#16A34A' }}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          >
            <Clock className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-500">Quality Hours / Week</div>
            <div className="text-xl font-extrabold text-slate-900 tabular-nums">
              {auditsLoading
                ? '…'
                : latestSheet
                  ? `${latestSheet.totalHours.toFixed(1)} hrs`
                  : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Profile Summary & Latest Audit */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Your Role Profile Card */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-6 space-y-4 animate-fade-rise">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                style={{ backgroundColor: '#EFF6FF', color: '#1E40AF' }}
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              >
                <UserCircle2 className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-extrabold text-slate-900">Your Role Profile</h2>
            </div>
            <button
              type="button"
              onClick={onGoToProfile}
              className="text-xs font-bold text-[#1E40AF] hover:underline cursor-pointer"
            >
              {profile ? 'Edit Profile' : 'Set Up Profile'}
            </button>
          </div>

          {profileLoading ? (
            <div className="space-y-2.5">
              <div className="h-4 bg-slate-100 rounded w-2/3 animate-pulse" />
              <div className="h-4 bg-slate-100 rounded w-1/2 animate-pulse" />
            </div>
          ) : !profile ? (
            <p className="text-sm text-slate-600">
              Please fill in your department or office, role category, position, job description,
              and years in role before starting your first interview.
            </p>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs font-semibold text-slate-500">Department / Office</dt>
                <dd className="font-bold text-slate-900">{profile.office}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">Role Category</dt>
                <dd className="font-bold text-slate-900">{profile.roleCategory}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">Position</dt>
                <dd className="font-bold text-slate-900">{profile.position}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">Years in Role</dt>
                <dd className="font-bold text-slate-900 tabular-nums">{profile.yearsInRole}</dd>
              </div>
            </dl>
          )}
        </div>

        {/* Your Latest Audit Card */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-6 space-y-4 animate-fade-rise">
          <div className="flex items-center gap-3">
            <div
              style={{ backgroundColor: '#FFF7ED', color: '#EA580C' }}
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            >
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-extrabold text-slate-900">Your Latest Audit</h2>
          </div>

          {auditsLoading ? (
            <div className="space-y-2.5">
              <div className="h-4 bg-slate-100 rounded w-3/4 animate-pulse" />
              <div className="h-4 bg-slate-100 rounded w-1/2 animate-pulse" />
            </div>
          ) : !latestAudit ? (
            <p className="text-sm text-slate-600">
              You have not started any Quality Cost Audit yet. Click &ldquo;Start Cost
              Interview&rdquo; above to begin.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-bold text-slate-900">
                    {latestAudit.costSheet?.processName || 'Work Process Interview'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatTimestamp(latestAudit.createdAt)} · {latestAudit.answerCount} of 7
                    answers
                  </div>
                </div>
                {latestAudit.status === 'completed' && latestAudit.costSheet ? (
                  <span
                    className={`px-2.5 py-1 rounded-xl text-xs font-bold border ${
                      LEVEL_STYLES[latestAudit.costSheet.level].bg
                    } ${LEVEL_STYLES[latestAudit.costSheet.level].text} ${
                      LEVEL_STYLES[latestAudit.costSheet.level].border
                    }`}
                  >
                    {latestAudit.costSheet.level}
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-xl text-xs font-bold bg-blue-50 text-[#1E40AF] border border-blue-200">
                    In progress
                  </span>
                )}
              </div>

              {latestAudit.status === 'completed' && latestAudit.costSheet && (
                <div className="space-y-2.5">
                  <CategoryStackedBar totals={latestAudit.costSheet.categoryTotals} compact />
                  <div className="flex flex-wrap gap-4 text-sm tabular-nums">
                    <div>
                      <span className="text-slate-500">COPQ Share: </span>
                      <span className="font-extrabold text-slate-900">
                        {latestAudit.costSheet.copqShare}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">COPQ Hours: </span>
                      <span className="font-extrabold text-slate-900">
                        {latestAudit.costSheet.copqHours.toFixed(1)} hrs/wk
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => onOpenAudit(latestAudit)}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-[#1E40AF] hover:underline cursor-pointer"
              >
                <span>
                  {latestAudit.status === 'completed'
                    ? 'Open Quality Cost Sheet'
                    : 'Resume Interview'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Cost of Quality in 30 Seconds Strip */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-6 space-y-4 animate-fade-rise">
        <h2 className="text-base font-extrabold text-slate-900">Cost of Quality in 30 seconds</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PAF_CATEGORIES.map((item) => (
            <div
              key={item.category}
              className={`p-4 rounded-2xl border ${item.softBg} ${item.softBorder} space-y-1.5`}
            >
              <div className="flex items-center gap-2">
                <PafCategoryIcon category={item.category} className="w-4 h-4 shrink-0" />
                <span className={`text-sm font-extrabold ${item.textColor}`}>{item.category}</span>
              </div>
              <p className="text-xs text-slate-700 leading-snug">{item.meaning}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
