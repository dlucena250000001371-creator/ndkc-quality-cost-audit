import {
  computeCostSheetMath,
  createEmptyStatedHours,
  formatBaselineCode,
  roundTwo,
  type RawActivityInput,
} from '../shared/costMath.ts';
import type {
  AuditLevel,
  BaselineDoc,
  CategoryTotals,
  CostCategory,
  CostSheet,
  KaizenAction,
  RoleCategory,
  RootCauseItem,
  StatedCategoryHours,
  StatedHoursMap,
} from '../src/types/audit.ts';

const AUDIT_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASELINE_CODE_REGEX = /\b([A-Z]{2,4}-\d{1,3})\b/g;

const VALID_CATEGORIES = new Set<CostCategory>([
  'Prevention',
  'Appraisal',
  'Internal Failure',
  'External Failure',
]);

const VALID_ROLE_CATEGORIES = new Set<RoleCategory>([
  'Faculty',
  'Academic Administrator',
  'Support Office',
]);

export function isValidAuditId(value: unknown): value is string {
  return typeof value === 'string' && AUDIT_ID_REGEX.test(value);
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export function extractBaselineCodes(docs: BaselineDoc[]): Set<string> {
  const codes = new Set<string>();
  for (const doc of docs) {
    if (!doc || typeof doc.text !== 'string') continue;
    const matches = doc.text.match(BASELINE_CODE_REGEX);
    if (matches) {
      for (const m of matches) {
        codes.add(m);
      }
    }
  }
  return codes;
}

export function formatBaselineText(docs: BaselineDoc[]): string {
  if (!docs || docs.length === 0) return '(No baseline documents uploaded)';
  return docs
    .map((d) => `=== ${d.title || 'Baseline Document'} ===\n${d.text || ''}`)
    .join('\n\n');
}

function cleanStr(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function normalizeCode(code: unknown, validCodes: Set<string>): string {
  if (typeof code !== 'string') return 'None';
  const trimmed = code.trim();
  if (!trimmed || trimmed === 'None') return 'None';
  return validCodes.has(trimmed) ? trimmed : 'None';
}

function parseStatedEntry(rawEntry: unknown): StatedCategoryHours {
  if (!rawEntry || typeof rawEntry !== 'object') {
    return { hours: null, said: '', peakNote: '' };
  }
  const e = rawEntry as Record<string, unknown>;
  let hours: number | null = null;
  if (typeof e.hours === 'number' && Number.isFinite(e.hours)) {
    if (e.hours >= 0 && e.hours <= 80) {
      hours = roundTwo(e.hours);
    }
  }
  return {
    hours,
    said: cleanStr(e.said, 240),
    peakNote: cleanStr(e.peakNote, 240),
  };
}

export function validateAndComputeCostSheet(
  raw: unknown,
  validCodes: Set<string>
): CostSheet {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Cost sheet payload is not an object');
  }
  const obj = raw as Record<string, unknown>;

  const processName = cleanStr(obj.processName, 140) || 'Work Process';
  const processCode = normalizeCode(obj.processCode, validCodes);
  const summary = cleanStr(obj.summary, 1400);

  const rawStated =
    obj.statedHours && typeof obj.statedHours === 'object'
      ? (obj.statedHours as Record<string, unknown>)
      : {};
  const statedHours: StatedHoursMap = {
    ...createEmptyStatedHours(),
    prevention: parseStatedEntry(rawStated.prevention),
    appraisal: parseStatedEntry(rawStated.appraisal),
    internalFailure: parseStatedEntry(rawStated.internalFailure),
    externalFailure: parseStatedEntry(rawStated.externalFailure),
  };

  const rawActivities = Array.isArray(obj.activities) ? obj.activities.slice(0, 60) : [];
  const parsedRawActivities: RawActivityInput[] = [];

  for (const item of rawActivities) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const cat = cleanStr(a.category, 40) as CostCategory;
    if (!VALID_CATEGORIES.has(cat)) continue;

    let hoursPerWeek: number | null = null;
    if (typeof a.hoursPerWeek === 'number' && Number.isFinite(a.hoursPerWeek)) {
      if (a.hoursPerWeek >= 0 && a.hoursPerWeek <= 80) {
        hoursPerWeek = roundTwo(a.hoursPerWeek);
      }
    }

    const activity = cleanStr(a.activity, 160);
    if (!activity) continue;

    const normalizedActCode = normalizeCode(a.code, validCodes);
    const resolvedCode =
      normalizedActCode !== 'None' ? normalizedActCode : processCode;

    parsedRawActivities.push({
      category: cat,
      activity,
      hoursPerWeek,
      peakOnly: Boolean(a.peakOnly),
      frequency: cleanStr(a.frequency, 100),
      code: resolvedCode,
      evidenceQuote: cleanStr(a.evidenceQuote, 300),
    });
  }

  const rawRootCauses = Array.isArray(obj.rootCauses) ? obj.rootCauses.slice(0, 10) : [];
  const rootCauses: RootCauseItem[] = [];
  for (const item of rawRootCauses) {
    if (!item || typeof item !== 'object') continue;
    const rc = item as Record<string, unknown>;
    const failure = cleanStr(rc.failure, 160);
    const cause = cleanStr(rc.cause, 250);
    if (!failure && !cause) continue;
    const factors = Array.isArray(rc.contributingFactors)
      ? rc.contributingFactors
          .slice(0, 10)
          .map((f) => cleanStr(f, 80))
          .filter(Boolean)
      : [];
    rootCauses.push({
      failure,
      cause,
      contributingFactors: factors,
      needsApproval: Boolean(rc.needsApproval),
      evidenceQuote: cleanStr(rc.evidenceQuote, 300),
    });
  }

  const rawKaizen = Array.isArray(obj.kaizenActions) ? obj.kaizenActions.slice(0, 10) : [];
  const kaizenActions: KaizenAction[] = [];
  for (const item of rawKaizen) {
    if (!item || typeof item !== 'object') continue;
    const k = item as Record<string, unknown>;
    const step = cleanStr(k.step, 250);
    if (!step) continue;
    const normalizedKaizenCode = normalizeCode(k.code, validCodes);
    kaizenActions.push({
      step,
      target: cleanStr(k.target, 200),
      owner: cleanStr(k.owner, 100) || 'Process Owner',
      measure: cleanStr(k.measure, 140),
      code: normalizedKaizenCode !== 'None' ? normalizedKaizenCode : processCode,
    });
  }

  const rawStrengths = Array.isArray(obj.strengths) ? obj.strengths.slice(0, 10) : [];
  const strengths: string[] = rawStrengths
    .map((s) => cleanStr(s, 220))
    .filter(Boolean);

  const computed = computeCostSheetMath(
    parsedRawActivities,
    statedHours,
    processCode
  );

  return {
    processName,
    processCode,
    summary,
    statedHours: computed.statedHours,
    activities: computed.activities,
    rootCauses,
    kaizenActions,
    strengths,
    categoryTotals: computed.categoryTotals,
    totalHours: computed.totalHours,
    copqHours: computed.copqHours,
    copqShare: computed.copqShare,
    level: computed.level,
    checks: computed.checks,
    confirmedByEmployee: false,
    hoursEdited: false,
    builtAt: new Date().toISOString(),
  };
}

export function validateProfileFields(profile: Record<string, unknown>): string | null {
  const office = cleanStr(profile.office, 120);
  const roleCategory = cleanStr(profile.roleCategory, 40) as RoleCategory;
  const position = cleanStr(profile.position, 120);
  const jobDescription = cleanStr(profile.jobDescription, 1000);
  const yearsInRole = profile.yearsInRole;

  if (!office) return 'Profile department or office is required.';
  if (!VALID_ROLE_CATEGORIES.has(roleCategory)) return 'Profile role category is invalid.';
  if (!position) return 'Profile position is required.';
  if (!jobDescription) return 'Profile job description is required.';
  if (
    typeof yearsInRole !== 'number' ||
    !Number.isInteger(yearsInRole) ||
    yearsInRole < 0 ||
    yearsInRole > 50
  ) {
    return 'Years in role must be a whole number between 0 and 50.';
  }
  return null;
}

// Sliding window rate limiter: 30 requests per 10 minutes per user
const userCallTimestamps = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_CALLS = 30;

export function checkInterviewRateLimit(uid: string): boolean {
  const now = Date.now();
  const existing = userCallTimestamps.get(uid) || [];
  const recent = existing.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_CALLS) {
    userCallTimestamps.set(uid, recent);
    return false;
  }
  recent.push(now);
  userCallTimestamps.set(uid, recent);
  return true;
}

export function computeLedgerAggregates(
  rawAudits: Array<Record<string, unknown>>,
  codeTitles: Record<string, string> = {}
) {
  const completedAudits = rawAudits.filter(
    (a) => a.status === 'completed' && a.costSheet && typeof a.costSheet === 'object'
  );

  const uniquePeople = new Set<string>();
  const roleCounts: Record<string, number> = {
    Faculty: 0,
    'Academic Administrator': 0,
    'Support Office': 0,
  };
  const processesCovered = new Set<string>();

  const categoryTotals: CategoryTotals = {
    Prevention: 0,
    Appraisal: 0,
    'Internal Failure': 0,
    'External Failure': 0,
  };

  interface ProcessAgg {
    code: string;
    names: Set<string>;
    auditCount: number;
    Prevention: number;
    Appraisal: number;
    'Internal Failure': number;
    'External Failure': number;
  }
  const processMap = new Map<string, ProcessAgg>();

  interface FailureRow {
    activity: string;
    category: 'Internal Failure' | 'External Failure';
    code: string;
    hoursPerWeek: number;
    cause: string;
    needsApproval: boolean;
    peakOnly: boolean;
    roleCategory: string;
  }
  const failureRows: FailureRow[] = [];
  const rootCauseEntries: Array<{
    processCode: string;
    roleCategory: string;
    failure: string;
    cause: string;
    contributingFactors: string[];
    needsApproval: boolean;
  }> = [];
  const kaizenEntries: Array<{
    rawProcessCode: string;
    processCode: string;
    step: string;
    target: string;
    owner: string;
    measure: string;
    code: string;
  }> = [];
  const strengthEntries: string[] = [];

  for (const audit of completedAudits) {
    const uid = String(audit.userId || '');
    if (uid) uniquePeople.add(uid);

    const snap = (audit.profileSnapshot || {}) as Record<string, unknown>;
    const roleCategory = String(snap.roleCategory || 'Support Office');
    roleCounts[roleCategory] = (roleCounts[roleCategory] || 0) + 1;

    const sheet = audit.costSheet as CostSheet;
    if (sheet.processName) processesCovered.add(sheet.processName);

    const totals = sheet.categoryTotals || {
      Prevention: 0,
      Appraisal: 0,
      'Internal Failure': 0,
      'External Failure': 0,
    };

    categoryTotals.Prevention = roundTwo(categoryTotals.Prevention + (Number(totals.Prevention) || 0));
    categoryTotals.Appraisal = roundTwo(categoryTotals.Appraisal + (Number(totals.Appraisal) || 0));
    categoryTotals['Internal Failure'] = roundTwo(
      categoryTotals['Internal Failure'] + (Number(totals['Internal Failure']) || 0)
    );
    categoryTotals['External Failure'] = roundTwo(
      categoryTotals['External Failure'] + (Number(totals['External Failure']) || 0)
    );

    const pCode = sheet.processCode || 'None';
    const pCodeLabel = formatBaselineCode(pCode, codeTitles);
    if (!processMap.has(pCode)) {
      processMap.set(pCode, {
        code: pCode,
        names: new Set(),
        auditCount: 0,
        Prevention: 0,
        Appraisal: 0,
        'Internal Failure': 0,
        'External Failure': 0,
      });
    }
    const pAgg = processMap.get(pCode)!;
    if (sheet.processName) pAgg.names.add(sheet.processName);
    pAgg.auditCount += 1;
    pAgg.Prevention = roundTwo(pAgg.Prevention + (Number(totals.Prevention) || 0));
    pAgg.Appraisal = roundTwo(pAgg.Appraisal + (Number(totals.Appraisal) || 0));
    pAgg['Internal Failure'] = roundTwo(
      pAgg['Internal Failure'] + (Number(totals['Internal Failure']) || 0)
    );
    pAgg['External Failure'] = roundTwo(
      pAgg['External Failure'] + (Number(totals['External Failure']) || 0)
    );

    const activities = Array.isArray(sheet.activities) ? sheet.activities : [];
    const rootCauses = Array.isArray(sheet.rootCauses) ? sheet.rootCauses : [];

    for (const act of activities) {
      if (
        (act.category === 'Internal Failure' || act.category === 'External Failure') &&
        typeof act.hoursPerWeek === 'number'
      ) {
        const matchedRc =
          rootCauses.find((rc) =>
            rc.failure?.toLowerCase().includes(act.activity.toLowerCase().slice(0, 15))
          ) || rootCauses[0];
        failureRows.push({
          activity: act.activity,
          category: act.category,
          code: formatBaselineCode(act.code || 'None', codeTitles),
          hoursPerWeek: act.hoursPerWeek,
          cause: matchedRc?.cause || 'Not specified',
          needsApproval: Boolean(matchedRc?.needsApproval),
          peakOnly: Boolean(act.peakOnly),
          roleCategory,
        });
      }
    }

    for (const rc of rootCauses) {
      rootCauseEntries.push({
        processCode: pCodeLabel,
        roleCategory,
        failure: rc.failure,
        cause: rc.cause,
        contributingFactors: rc.contributingFactors || [],
        needsApproval: Boolean(rc.needsApproval),
      });
    }

    const kaizens = Array.isArray(sheet.kaizenActions) ? sheet.kaizenActions : [];
    for (const k of kaizens) {
      kaizenEntries.push({
        rawProcessCode: pCode,
        processCode: pCodeLabel,
        step: k.step,
        target: cleanStr(k.target, 200),
        owner: k.owner,
        measure: k.measure,
        code: formatBaselineCode(k.code || 'None', codeTitles),
      });
    }

    const strengths = Array.isArray(sheet.strengths) ? sheet.strengths : [];
    for (const s of strengths) {
      strengthEntries.push(s);
    }
  }

  const totalQualityHours = roundTwo(
    categoryTotals.Prevention +
      categoryTotals.Appraisal +
      categoryTotals['Internal Failure'] +
      categoryTotals['External Failure']
  );
  const copqHours = roundTwo(
    categoryTotals['Internal Failure'] + categoryTotals['External Failure']
  );
  const copqShare = totalQualityHours > 0 ? Math.round((copqHours / totalQualityHours) * 100) : 0;

  const categoryBreakdown = (
    ['Prevention', 'Appraisal', 'Internal Failure', 'External Failure'] as CostCategory[]
  ).map((cat) => {
    const hrs = categoryTotals[cat];
    const pct = totalQualityHours > 0 ? Math.round((hrs / totalQualityHours) * 100) : 0;
    return { category: cat, hoursPerWeek: hrs, sharePercent: pct };
  });

  const processAreas = Array.from(processMap.values()).map((p) => {
    const total = roundTwo(
      p.Prevention + p.Appraisal + p['Internal Failure'] + p['External Failure']
    );
    const copq = roundTwo(p['Internal Failure'] + p['External Failure']);
    const share = total > 0 ? Math.round((copq / total) * 100) : 0;
    const catsWithHours = [
      p.Prevention,
      p.Appraisal,
      p['Internal Failure'],
      p['External Failure'],
    ].filter((v) => v > 0).length;

    let level: AuditLevel = 'Not enough data';
    if (catsWithHours >= 2 && total > 0) {
      if (share <= 25) level = 'Healthy';
      else if (share <= 40) level = 'Watch';
      else level = 'High';
    }
    return {
      rawProcessCode: p.code,
      processCode: formatBaselineCode(p.code, codeTitles),
      processes: Array.from(p.names),
      auditCount: p.auditCount,
      Prevention: p.Prevention,
      Appraisal: p.Appraisal,
      'Internal Failure': p['Internal Failure'],
      'External Failure': p['External Failure'],
      totalHours: total,
      copqHours: copq,
      copqShare: share,
      level,
    };
  });

  failureRows.sort((a, b) => b.hoursPerWeek - a.hoursPerWeek);

  const watchOrHighCodes = new Set(
    processAreas
      .filter((p) => p.level === 'Watch' || p.level === 'High')
      .map((p) => p.rawProcessCode)
  );

  const stats = {
    peopleInterviewed: uniquePeople.size,
    completedAudits: completedAudits.length,
    totalQualityHours,
    copqHours,
    copqShare,
    categoryTotals,
    processAreasCount: processAreas.length,
    roleCategoryCounts: roleCounts,
    processesCovered: Array.from(processesCovered),
  };

  return {
    stats,
    categoryBreakdown,
    processAreas: processAreas.map(({ rawProcessCode: _raw, ...rest }) => rest),
    topFailures: failureRows.slice(0, 5),
    rootCauseEntries,
    kaizenForPriorityAreas: kaizenEntries
      .filter((k) => watchOrHighCodes.has(k.rawProcessCode))
      .map(({ rawProcessCode: _raw, ...rest }) => rest),
    allKaizen: kaizenEntries.map(({ rawProcessCode: _raw, ...rest }) => rest),
    strengthEntries,
  };
}
