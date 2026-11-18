export type RoleCategory = 'Faculty' | 'Academic Administrator' | 'Support Office';

export type CostCategory =
  | 'Prevention'
  | 'Appraisal'
  | 'Internal Failure'
  | 'External Failure';

export type AuditLevel = 'Healthy' | 'Watch' | 'High' | 'Not enough data';

export interface ProfileSnapshot {
  displayName: string;
  photoURL: string;
  office: string;
  roleCategory: RoleCategory;
  position: string;
  jobDescription: string;
  yearsInRole: number;
}

export interface UserProfile extends ProfileSnapshot {
  uid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BaselineDoc {
  id: string;
  title: string;
  text: string;
  sizeChars: number;
  uploadedAt: string;
}

export type HoursSource = 'own' | 'split';

export type StatedCategoryKey =
  | 'prevention'
  | 'appraisal'
  | 'internalFailure'
  | 'externalFailure';

export interface StatedCategoryHours {
  hours: number | null;
  said: string;
  peakNote: string;
}

export type StatedHoursMap = Record<StatedCategoryKey, StatedCategoryHours>;

export interface QualityCostActivity {
  category: CostCategory;
  activity: string;
  hoursPerWeek: number | null;
  hoursSource?: HoursSource;
  peakOnly?: boolean;
  frequency: string;
  code: string;
  evidenceQuote: string;
}

export interface RootCauseItem {
  failure: string;
  cause: string;
  contributingFactors: string[];
  needsApproval?: boolean;
  evidenceQuote: string;
}

export interface KaizenAction {
  step: string;
  target?: string;
  owner: string;
  measure: string;
  code: string;
}

export interface CategoryTotals {
  Prevention: number;
  Appraisal: number;
  'Internal Failure': number;
  'External Failure': number;
}

export interface CostSheet {
  processName: string;
  processCode: string;
  summary: string;
  statedHours?: StatedHoursMap;
  activities: QualityCostActivity[];
  rootCauses: RootCauseItem[];
  kaizenActions: KaizenAction[];
  strengths: string[];
  categoryTotals: CategoryTotals;
  totalHours: number;
  copqHours: number;
  copqShare: number;
  level: AuditLevel;
  checks?: string[];
  confirmedByEmployee?: boolean;
  hoursEdited?: boolean;
  builtAt: string;
}

export interface CostAudit {
  id: string;
  userId: string;
  status: 'in_progress' | 'completed';
  questionNumber: number;
  answerCount: number;
  profileSnapshot: ProfileSnapshot;
  costSheet: CostSheet | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
}

export interface InteractionMessage {
  id: string;
  userId: string;
  auditId: string;
  role: 'user' | 'assistant';
  content: string;
  questionNumber: number;
  timestamp?: unknown;
  modelUsed: string;
  clientMessageId: string;
}

export interface AdminStats {
  peopleInterviewed: number;
  completedAudits: number;
  totalQualityHours: number;
  copqHours: number;
  copqShare: number;
  categoryTotals: CategoryTotals;
  processAreasCount: number;
}

export interface LedgerReport {
  id: string;
  title: string;
  markdown: string;
  stats: AdminStats;
  modelUsed: string;
  createdAt?: unknown;
  createdBy: string;
}

export const INTERVIEW_PARTS: Array<{ num: number; label: string; description: string }> = [
  { num: 1, label: 'Process', description: 'Main weekly work process & steps' },
  { num: 2, label: 'Prevention', description: 'Getting work right the first time' },
  { num: 3, label: 'Appraisal', description: 'Checking, reviewing & verifying' },
  { num: 4, label: 'Internal Failure', description: 'Rework before release' },
  { num: 5, label: 'External Failure', description: 'Complaints, appeals & corrections' },
  { num: 6, label: 'Root Cause', description: 'Why top failures keep happening' },
  { num: 7, label: 'Kaizen', description: 'First small change & measure' },
];

export const CATEGORY_COLORS: Record<CostCategory, { hex: string; bg: string; text: string; border: string }> = {
  Prevention: {
    hex: '#16A34A',
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
  },
  Appraisal: {
    hex: '#2563EB',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
  },
  'Internal Failure': {
    hex: '#F59E0B',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
  },
  'External Failure': {
    hex: '#DC2626',
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
  },
};

export const LEVEL_STYLES: Record<AuditLevel, { bg: string; text: string; border: string }> = {
  Healthy: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200' },
  Watch: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200' },
  High: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-200' },
  'Not enough data': { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
};

export const MAX_BASELINE_FILE_BYTES = 200 * 1024;
export const MAX_BASELINE_TOTAL_CHARS = 800_000;
export const MAX_CHAT_MESSAGE_CHARS = 2000;

export function getFirstName(displayName: string): string {
  const cleaned = (displayName || '').trim();
  if (!cleaned) return 'Colleague';
  return cleaned.split(/\s+/)[0] || 'Colleague';
}

export function buildWelcomeMessage(displayName: string): string {
  const firstName = getFirstName(displayName);
  return `Hello ${firstName}. This interview has 7 short questions about one work process you handle at Notre Dame of Kidapawan College. Please include rough hours per week where you can (for example, "about 3 hours a week").\n\nWhich work process takes the biggest part of your week (for example lesson planning, exams and grading, enrollment, subsidy processing or IT support), and what are its main steps?`;
}
