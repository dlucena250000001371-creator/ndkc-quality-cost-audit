import type {
  AuditLevel,
  CategoryTotals,
  CostCategory,
  CostSheet,
  HoursSource,
  QualityCostActivity,
  StatedCategoryKey,
  StatedHoursMap,
} from '../src/types/audit.ts';

export const COST_CATEGORIES: CostCategory[] = [
  'Prevention',
  'Appraisal',
  'Internal Failure',
  'External Failure',
];

export const CATEGORY_TO_STATED_KEY: Record<CostCategory, StatedCategoryKey> = {
  Prevention: 'prevention',
  Appraisal: 'appraisal',
  'Internal Failure': 'internalFailure',
  'External Failure': 'externalFailure',
};

export function roundTwo(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function createEmptyStatedHours(): StatedHoursMap {
  return {
    prevention: { hours: null, said: '', peakNote: '' },
    appraisal: { hours: null, said: '', peakNote: '' },
    internalFailure: { hours: null, said: '', peakNote: '' },
    externalFailure: { hours: null, said: '', peakNote: '' },
  };
}

export function hasTimeRange(said: string): boolean {
  if (!said) return false;
  return (
    /\d+(?:\.\d+)?\s*(?:-|–|—|\bto\b)\s*\d+(?:\.\d+)?/i.test(said) ||
    /\bbetween\s+\d+(?:\.\d+)?\s+and\s+\d+(?:\.\d+)?/i.test(said)
  );
}

export interface RawActivityInput {
  category: CostCategory;
  activity: string;
  hoursPerWeek: number | null;
  peakOnly: boolean;
  frequency: string;
  code: string;
  evidenceQuote: string;
}

export interface ComputedCostMathResult {
  activities: QualityCostActivity[];
  categoryTotals: CategoryTotals;
  totalHours: number;
  copqHours: number;
  copqShare: number;
  level: AuditLevel;
  checks: string[];
  statedHours: StatedHoursMap;
}

function clampHours(val: unknown): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  if (val < 0) return 0;
  if (val > 80) return 80;
  return roundTwo(val);
}

export function computeCostSheetMath(
  rawActivities: RawActivityInput[],
  rawStatedHours: StatedHoursMap,
  processCode = 'None'
): ComputedCostMathResult {
  const statedHours: StatedHoursMap = {
    prevention: {
      hours: clampHours(rawStatedHours?.prevention?.hours),
      said: String(rawStatedHours?.prevention?.said || '').trim(),
      peakNote: String(rawStatedHours?.prevention?.peakNote || '').trim(),
    },
    appraisal: {
      hours: clampHours(rawStatedHours?.appraisal?.hours),
      said: String(rawStatedHours?.appraisal?.said || '').trim(),
      peakNote: String(rawStatedHours?.appraisal?.peakNote || '').trim(),
    },
    internalFailure: {
      hours: clampHours(rawStatedHours?.internalFailure?.hours),
      said: String(rawStatedHours?.internalFailure?.said || '').trim(),
      peakNote: String(rawStatedHours?.internalFailure?.peakNote || '').trim(),
    },
    externalFailure: {
      hours: clampHours(rawStatedHours?.externalFailure?.hours),
      said: String(rawStatedHours?.externalFailure?.said || '').trim(),
      peakNote: String(rawStatedHours?.externalFailure?.peakNote || '').trim(),
    },
  };

  const categoryTotals: CategoryTotals = {
    Prevention: 0,
    Appraisal: 0,
    'Internal Failure': 0,
    'External Failure': 0,
  };

  const checks: string[] = [];
  const finalActivities: QualityCostActivity[] = [];

  for (const cat of COST_CATEGORIES) {
    const key = CATEGORY_TO_STATED_KEY[cat];
    const statedEntry = statedHours[key];
    const statedVal = statedEntry.hours;
    const catActs = rawActivities.filter((a) => a.category === cat);

    if (statedVal !== null) {
      const targetTotal = roundTwo(statedVal);
      categoryTotals[cat] = targetTotal;

      if (catActs.length === 0) {
        if (targetTotal > 0) {
          finalActivities.push({
            category: cat,
            activity: `${cat} work (not itemized)`,
            hoursPerWeek: targetTotal,
            hoursSource: 'split',
            peakOnly: false,
            frequency: '',
            code: processCode || 'None',
            evidenceQuote: statedEntry.said || statedEntry.peakNote || '',
          });
        }
        continue;
      }

      const ownActs = catActs.filter((a) => a.hoursPerWeek !== null);
      const untimedActs = catActs.filter((a) => a.hoursPerWeek === null);
      const ownSum = roundTwo(
        ownActs.reduce((acc, a) => acc + (a.hoursPerWeek ?? 0), 0)
      );

      if (ownSum > targetTotal) {
        const splitEach = roundTwo(targetTotal / catActs.length);
        for (const a of catActs) {
          finalActivities.push({
            category: a.category,
            activity: a.activity,
            hoursPerWeek: splitEach,
            hoursSource: 'split',
            peakOnly: Boolean(a.peakOnly),
            frequency: a.frequency,
            code: a.code || processCode || 'None',
            evidenceQuote: a.evidenceQuote,
          });
        }
        checks.push(
          `${cat}: the activities added up to ${ownSum} h but you said ${targetTotal} h, so ${targetTotal} h was split evenly.`
        );
      } else {
        const remainder = roundTwo(Math.max(0, targetTotal - ownSum));
        const splitEach =
          untimedActs.length > 0 ? roundTwo(remainder / untimedActs.length) : 0;

        for (const a of catActs) {
          const hasOwn = a.hoursPerWeek !== null;
          const hoursSource: HoursSource = hasOwn ? 'own' : 'split';
          const hoursPerWeek = hasOwn
            ? roundTwo(a.hoursPerWeek as number)
            : splitEach;
          finalActivities.push({
            category: a.category,
            activity: a.activity,
            hoursPerWeek,
            hoursSource,
            peakOnly: Boolean(a.peakOnly),
            frequency: a.frequency,
            code: a.code || processCode || 'None',
            evidenceQuote: a.evidenceQuote,
          });
        }
      }
    } else {
      let sum = 0;
      for (const a of catActs) {
        const ownVal = a.hoursPerWeek !== null ? roundTwo(a.hoursPerWeek) : null;
        if (ownVal !== null) {
          sum = roundTwo(sum + ownVal);
        }
        finalActivities.push({
          category: a.category,
          activity: a.activity,
          hoursPerWeek: ownVal,
          hoursSource: 'own',
          peakOnly: Boolean(a.peakOnly),
          frequency: a.frequency,
          code: a.code || processCode || 'None',
          evidenceQuote: a.evidenceQuote,
        });
      }
      categoryTotals[cat] = roundTwo(sum);
    }
  }

  const totalHours = roundTwo(
    categoryTotals.Prevention +
      categoryTotals.Appraisal +
      categoryTotals['Internal Failure'] +
      categoryTotals['External Failure']
  );

  const copqHours = roundTwo(
    categoryTotals['Internal Failure'] + categoryTotals['External Failure']
  );

  const copqShare = totalHours > 0 ? Math.round((copqHours / totalHours) * 100) : 0;

  const categoriesWithHours = COST_CATEGORIES.filter(
    (cat) => categoryTotals[cat] > 0
  ).length;

  let level: AuditLevel = 'Not enough data';
  if (categoriesWithHours >= 2 && totalHours > 0) {
    if (copqShare <= 25) level = 'Healthy';
    else if (copqShare <= 40) level = 'Watch';
    else level = 'High';
  }

  return {
    activities: finalActivities,
    categoryTotals,
    totalHours,
    copqHours,
    copqShare,
    level,
    checks: checks.slice(0, 10),
    statedHours,
  };
}

export function recomputeCostSheetWithInputs(
  initialSheet: CostSheet,
  editedCategoryValues: Record<CostCategory, number | null>
): CostSheet {
  const baseStated = initialSheet.statedHours || createEmptyStatedHours();
  const nextStated: StatedHoursMap = {
    prevention: { ...baseStated.prevention, hours: editedCategoryValues.Prevention },
    appraisal: { ...baseStated.appraisal, hours: editedCategoryValues.Appraisal },
    internalFailure: {
      ...baseStated.internalFailure,
      hours: editedCategoryValues['Internal Failure'],
    },
    externalFailure: {
      ...baseStated.externalFailure,
      hours: editedCategoryValues['External Failure'],
    },
  };

  // Preserve only genuinely itemized own-hour activities from the initial sheet;
  // drop auto-added "(not itemized)" placeholders so computeCostSheetMath regenerates cleanly if needed.
  const rawActivities: RawActivityInput[] = (initialSheet.activities || [])
    .filter((a) => !a.activity.endsWith('work (not itemized)'))
    .map((a) => ({
      category: a.category,
      activity: a.activity,
      hoursPerWeek: a.hoursSource === 'split' ? null : a.hoursPerWeek,
      peakOnly: Boolean(a.peakOnly),
      frequency: a.frequency || '',
      code: a.code || initialSheet.processCode || 'None',
      evidenceQuote: a.evidenceQuote || '',
    }));

  const computed = computeCostSheetMath(
    rawActivities,
    nextStated,
    initialSheet.processCode || 'None'
  );

  return {
    ...initialSheet,
    activities: computed.activities,
    categoryTotals: computed.categoryTotals,
    totalHours: computed.totalHours,
    copqHours: computed.copqHours,
    copqShare: computed.copqShare,
    level: computed.level,
    statedHours: computed.statedHours,
    checks: computed.checks,
  };
}

export function extractBaselineCodeTitles(
  docs: Array<{ text?: string }>
): Record<string, string> {
  const titles: Record<string, string> = {};
  if (!Array.isArray(docs)) return titles;

  for (const doc of docs) {
    if (!doc || typeof doc.text !== 'string') continue;
    const lines = doc.text.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Markdown table row format: | Code | Title | ... |
      if (line.includes('|') && !/^\|?[\s\-:|]+\|?$/.test(line)) {
        const cells = line
          .split('|')
          .map((c) => c.replace(/[*`]/g, '').trim())
          .filter(Boolean);
        for (let i = 0; i < cells.length; i++) {
          const codeMatch = cells[i].match(/^([A-Z]{2,4}-\d{1,3})\b(?:\s*[:.\-–—·]\s*(.+))?$/);
          if (codeMatch) {
            const code = codeMatch[1];
            const inlineTitle = codeMatch[2]?.trim();
            const candidate = inlineTitle || cells[i + 1] || '';
            const cleaned = cleanExtractedTitle(candidate);
            if (cleaned && !titles[code]) {
              titles[code] = cleaned;
            }
          }
        }
        continue;
      }

      // Heading / bullet / standard line format
      const stripped = line
        .replace(/^#+\s*/, '')
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .replace(/[*`]/g, '')
        .trim();

      const match = stripped.match(
        /^([A-Z]{2,4}-\d{1,3})\s*(?:[:.\-–—·]\s*|\(([^)]+)\)|\s+)(.+)?$/
      );
      if (match) {
        const code = match[1];
        const parenTitle = match[2]?.trim();
        const rest = match[3]?.trim() || '';
        const cleaned = cleanExtractedTitle(parenTitle || rest);
        if (cleaned && !titles[code]) {
          titles[code] = cleaned;
        }
      }
    }
  }

  return titles;
}

function cleanExtractedTitle(raw: string): string {
  if (!raw) return '';
  let s = raw.replace(/[*`]/g, '').trim();
  // Remove leading punctuation or parens
  s = s.replace(/^[:.\-–—·\s]+/, '').trim();
  if (s.startsWith('(') && s.includes(')')) {
    const inside = s.slice(1, s.indexOf(')')).trim();
    if (inside) s = inside;
  }
  // If followed by long description separated by " — ", " - ", ": ", or ". ", keep just the concise title
  for (const sep of [' — ', ' – ', ': ', '. ']) {
    const idx = s.indexOf(sep);
    if (idx > 2) {
      s = s.slice(0, idx).trim();
    }
  }
  if (s.length > 90) {
    s = `${s.slice(0, 87).trim()}...`;
  }
  return s;
}

export function formatBaselineCode(
  code: string | undefined | null,
  codeTitles?: Record<string, string>
): string {
  const cleaned = (code || '').trim();
  if (!cleaned || cleaned === 'None') return 'None';
  const title = codeTitles?.[cleaned];
  return title ? `${cleaned} · ${title}` : cleaned;
}

export function isClosingMessage(
  messages: Array<{ role?: unknown }>,
  index: number
): boolean {
  const msg = messages[index];
  if (!msg || msg.role !== 'assistant') return false;
  let userAnswersBefore = 0;
  for (let i = 0; i < index; i++) {
    if (messages[i]?.role === 'user') {
      userAnswersBefore++;
    }
  }
  return userAnswersBefore >= 7;
}
