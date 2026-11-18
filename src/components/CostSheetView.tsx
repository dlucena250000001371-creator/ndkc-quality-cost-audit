import { AlertCircle, BarChart3, Lightbulb, Sparkles } from 'lucide-react';
import { PafCategoryIcon } from '../lib/display';
import {
  CATEGORY_COLORS,
  LEVEL_STYLES,
  type CostCategory,
  type CostSheet,
} from '../types/audit';
import { CategoryStackedBar } from './CategoryStackedBar';

const CATEGORIES: CostCategory[] = [
  'Prevention',
  'Appraisal',
  'Internal Failure',
  'External Failure',
];

export function CostSheetView({ sheet }: { sheet: CostSheet }) {
  const levelStyle = LEVEL_STYLES[sheet.level] || LEVEL_STYLES['Not enough data'];

  return (
    <div className="space-y-6">
      {/* Header Summary Card */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-6 space-y-5 animate-fade-rise">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
              <span>Process Code: {sheet.processCode || 'None'}</span>
              <span aria-hidden="true">·</span>
              <span>Built {new Date(sheet.builtAt).toLocaleDateString()}</span>
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900">{sheet.processName}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="text-right">
              <div className="text-xs text-slate-500 font-semibold">Total Quality Hours</div>
              <div className="text-lg font-extrabold text-slate-900 tabular-nums">
                {sheet.totalHours.toFixed(1)} hrs/wk
              </div>
            </div>
            <div className="h-8 w-px bg-slate-200 hidden sm:block" />
            <div className="text-right">
              <div className="text-xs text-slate-500 font-semibold">COPQ Hours</div>
              <div className="text-lg font-extrabold text-slate-900 tabular-nums">
                {sheet.copqHours.toFixed(1)} hrs ({sheet.copqShare}%)
              </div>
            </div>
            <span
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border whitespace-nowrap ${levelStyle.bg} ${levelStyle.text} ${levelStyle.border}`}
            >
              {sheet.level}
            </span>
          </div>
        </div>

        <p className="text-sm text-slate-700 leading-relaxed">{sheet.summary}</p>

        <div className="pt-2 border-t border-slate-100">
          <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#1E40AF]" />
            <span>Where the Time Goes</span>
          </h3>
          <CategoryStackedBar totals={sheet.categoryTotals} />
        </div>
      </div>

      {/* Four Category Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {CATEGORIES.map((cat) => {
          const items = sheet.activities.filter((a) => a.category === cat);
          const color = CATEGORY_COLORS[cat];
          const catTotal = sheet.categoryTotals[cat] ?? 0;

          return (
            <div
              key={cat}
              className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-4 flex flex-col gap-3 animate-fade-rise border-t-4"
              style={{ borderTopColor: color.hex }}
            >
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <PafCategoryIcon category={cat} className="w-4 h-4 shrink-0" />
                  <h3 className="text-sm font-extrabold text-slate-900">{cat}</h3>
                </div>
                <span className="text-xs font-bold text-slate-700 tabular-nums">
                  {catTotal.toFixed(1)} hrs
                </span>
              </div>

              {items.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-2">
                  No activities reported in this category.
                </p>
              ) : (
                <div className="space-y-3">
                  {items.map((item, idx) => (
                    <div
                      key={`${cat}-${idx}`}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1.5"
                    >
                      <div className="text-sm font-bold text-slate-900 leading-snug">
                        {item.activity}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 tabular-nums">
                        <span className="font-semibold text-slate-800">
                          {item.hoursPerWeek !== null
                            ? `${item.hoursPerWeek} hrs/wk`
                            : 'Hours not given'}
                        </span>
                        {item.frequency && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{item.frequency}</span>
                          </>
                        )}
                        {item.code && item.code !== 'None' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-[#1E40AF] font-semibold">
                              {item.code}
                            </span>
                          </>
                        )}
                      </div>
                      {item.evidenceQuote && (
                        <p className="text-xs text-slate-500 italic">
                          &ldquo;{item.evidenceQuote}&rdquo;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Root Causes, Kaizen Actions, and Strengths */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-5 space-y-3 animate-fade-rise">
          <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#F59E0B]" />
            <span>Root Causes</span>
          </h3>
          {sheet.rootCauses.length === 0 ? (
            <p className="text-sm text-slate-500">No root causes captured.</p>
          ) : (
            <div className="space-y-3">
              {sheet.rootCauses.map((rc, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1.5">
                  <div className="text-xs font-bold text-amber-800">{rc.failure}</div>
                  <div className="text-sm font-semibold text-slate-900">{rc.cause}</div>
                  {rc.contributingFactors.length > 0 && (
                    <div className="text-xs text-slate-600">
                      Factors: {rc.contributingFactors.join(' · ')}
                    </div>
                  )}
                  {rc.evidenceQuote && (
                    <div className="text-xs text-slate-500 italic">
                      &ldquo;{rc.evidenceQuote}&rdquo;
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-5 space-y-3 animate-fade-rise">
          <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-[#F97316]" />
            <span>Kaizen Actions</span>
          </h3>
          {sheet.kaizenActions.length === 0 ? (
            <p className="text-sm text-slate-500">No Kaizen actions captured.</p>
          ) : (
            <div className="space-y-3">
              {sheet.kaizenActions.map((k, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1.5">
                  <div className="text-sm font-bold text-slate-900">{k.step}</div>
                  <div className="text-xs text-slate-600 flex flex-wrap gap-x-2 gap-y-0.5">
                    <span>Owner: {k.owner}</span>
                    {k.code && k.code !== 'None' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[#1E40AF] font-semibold">{k.code}</span>
                      </>
                    )}
                  </div>
                  {k.measure && (
                    <div className="text-xs font-semibold text-green-700">
                      Measure: {k.measure}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-5 space-y-3 animate-fade-rise">
          <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#16A34A]" />
            <span>Strengths Already in Place</span>
          </h3>
          {sheet.strengths.length === 0 ? (
            <p className="text-sm text-slate-500">No strengths recorded.</p>
          ) : (
            <ul className="space-y-2">
              {sheet.strengths.map((s, idx) => (
                <li
                  key={idx}
                  className="p-3 rounded-xl bg-green-50/70 border border-green-100 text-sm text-slate-800"
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
