import { PafCategoryIcon } from '../lib/display';
import { CATEGORY_COLORS, type CategoryTotals, type CostCategory } from '../types/audit';

const CATEGORIES: CostCategory[] = [
  'Prevention',
  'Appraisal',
  'Internal Failure',
  'External Failure',
];

export function CategoryStackedBar({
  totals,
  compact = false,
}: {
  totals: CategoryTotals;
  compact?: boolean;
}) {
  const sum =
    (totals.Prevention || 0) +
    (totals.Appraisal || 0) +
    (totals['Internal Failure'] || 0) +
    (totals['External Failure'] || 0);

  if (compact) {
    return (
      <div
        className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex border border-[#E2E8F0]"
        aria-label="Category breakdown bar"
      >
        {sum > 0 &&
          CATEGORIES.map((cat) => {
            const hrs = totals[cat] || 0;
            if (hrs <= 0) return null;
            const pct = (hrs / sum) * 100;
            return (
              <div
                key={cat}
                title={`${cat}: ${hrs.toFixed(1)} hrs/wk (${Math.round(pct)}%)`}
                style={{
                  width: `${pct}%`,
                  backgroundColor: CATEGORY_COLORS[cat].hex,
                }}
                className="h-full"
              />
            );
          })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="w-full h-7 bg-slate-100 rounded-xl overflow-hidden flex border border-[#E2E8F0]">
        {sum === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
            No hours reported yet
          </div>
        ) : (
          CATEGORIES.map((cat) => {
            const hrs = totals[cat] || 0;
            if (hrs <= 0) return null;
            const pct = (hrs / sum) * 100;
            return (
              <div
                key={cat}
                title={`${cat}: ${hrs} hrs/wk (${Math.round(pct)}%)`}
                style={{
                  width: `${pct}%`,
                  backgroundColor: CATEGORY_COLORS[cat].hex,
                }}
                className="h-full transition-all duration-300 flex items-center justify-center text-[11px] font-bold text-white overflow-hidden"
              >
                {pct >= 11 ? `${Math.round(pct)}%` : ''}
              </div>
            );
          })
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {CATEGORIES.map((cat) => {
          const hrs = totals[cat] || 0;
          const pct = sum > 0 ? Math.round((hrs / sum) * 100) : 0;
          return (
            <div key={cat} className="flex items-start gap-2">
              <PafCategoryIcon category={cat} className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-700 truncate">{cat}</div>
                <div className="text-sm font-extrabold text-slate-900 tabular-nums">
                  {hrs.toFixed(1)} hrs{' '}
                  <span className="text-xs font-semibold text-slate-500">({pct}%)</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
