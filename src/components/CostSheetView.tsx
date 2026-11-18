import { AlertCircle, BarChart3, CheckCircle2, Clock, Lightbulb, Sparkles } from 'lucide-react';
import { CATEGORY_TO_STATED_KEY, COST_CATEGORIES, formatBaselineCode } from '../../shared/costMath';
import { PafCategoryIcon } from '../lib/display';
import {
  CATEGORY_COLORS,
  LEVEL_STYLES,
  type CostCategory,
  type CostSheet,
} from '../types/audit';
import { CategoryStackedBar } from './CategoryStackedBar';

export function CostSheetView({
  sheet,
  codeTitles = {},
}: {
  sheet: CostSheet;
  codeTitles?: Record<string, string>;
}) {
  const levelStyle = LEVEL_STYLES[sheet.level] || LEVEL_STYLES['Not enough data'];
  const activities = Array.isArray(sheet.activities) ? sheet.activities : [];
  const rootCauses = Array.isArray(sheet.rootCauses) ? sheet.rootCauses : [];
  const kaizenActions = Array.isArray(sheet.kaizenActions) ? sheet.kaizenActions : [];
  const strengths = Array.isArray(sheet.strengths) ? sheet.strengths : [];
  const checks = Array.isArray(sheet.checks) ? sheet.checks : [];

  return (
    <div className="space-y-6">
      {/* Header Summary Card */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-6 space-y-5 animate-fade-rise">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
              <span>Process Code: {formatBaselineCode(sheet.processCode || 'None', codeTitles)}</span>
              <span aria-hidden="true">·</span>
              <span>Built {new Date(sheet.builtAt).toLocaleDateString()}</span>
              {sheet.confirmedByEmployee !== undefined && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-green-700 font-bold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      {sheet.confirmedByEmployee ? 'Confirmed by employee' : 'Pending confirmation'}
                    </span>
                  </span>
                </>
              )}
              {sheet.hoursEdited !== undefined && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{sheet.hoursEdited ? 'Hours edited' : 'Hours unedited'}</span>
                </>
              )}
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

        {sheet.statedHours && (
          <div className="pt-4 border-t border-slate-100 space-y-2.5">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#1E40AF]" />
              <span>Employee-Stated Hours by Category</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {COST_CATEGORIES.map((cat: CostCategory) => {
                const entry = sheet.statedHours?.[CATEGORY_TO_STATED_KEY[cat]];
                return (
                  <div
                    key={cat}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-800">{cat}</span>
                      <span className="font-extrabold text-slate-900 tabular-nums">
                        {entry?.hours !== null && entry?.hours !== undefined
                          ? `${entry.hours} hrs`
                          : 'Not stated'}
                      </span>
                    </div>
                    {entry?.said && (
                      <div className="text-slate-600 italic">&ldquo;{entry.said}&rdquo;</div>
                    )}
                    {entry?.peakNote && (
                      <div className="text-amber-800 font-semibold">Peak: {entry.peakNote}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {checks.length > 0 && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
            <div className="text-xs font-extrabold text-amber-900">Hours Consistency Checks</div>
            <ul className="list-disc pl-4 space-y-0.5 text-xs text-amber-900">
              {checks.map((chk, idx) => (
                <li key={idx}>{chk}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Four Category Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COST_CATEGORIES.map((cat) => {
          const items = activities.filter((a) => a.category === cat);
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
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-bold text-slate-900 leading-snug">
                          {item.activity}
                        </div>
                        {item.peakOnly && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap shrink-0">
                            Peak periods
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 tabular-nums">
                        <span className="font-semibold text-slate-800">
                          {item.hoursPerWeek !== null
                            ? `${item.hoursPerWeek} hrs/wk${item.hoursSource ? ` (${item.hoursSource})` : ''}`
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
                              {formatBaselineCode(item.code, codeTitles)}
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
          {rootCauses.length === 0 ? (
            <p className="text-sm text-slate-500">No root causes captured.</p>
          ) : (
            <div className="space-y-3">
              {rootCauses.map((rc, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-bold text-amber-800">{rc.failure}</div>
                    {rc.needsApproval && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 text-purple-800 border border-purple-200 whitespace-nowrap shrink-0">
                        Needs approval
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{rc.cause}</div>
                  {Array.isArray(rc.contributingFactors) && rc.contributingFactors.length > 0 && (
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
          {kaizenActions.length === 0 ? (
            <p className="text-sm text-slate-500">No Kaizen actions captured.</p>
          ) : (
            <div className="space-y-3">
              {kaizenActions.map((k, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1.5">
                  <div className="text-sm font-bold text-slate-900">{k.step}</div>
                  {k.target && (
                    <div className="text-xs font-semibold text-[#1E40AF]">
                      Target: {k.target}
                    </div>
                  )}
                  <div className="text-xs text-slate-600 flex flex-wrap gap-x-2 gap-y-0.5">
                    <span>Owner: {k.owner}</span>
                    {k.code && k.code !== 'None' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[#1E40AF] font-semibold">
                          {formatBaselineCode(k.code, codeTitles)}
                        </span>
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
          {strengths.length === 0 ? (
            <p className="text-sm text-slate-500">No strengths recorded.</p>
          ) : (
            <ul className="space-y-2">
              {strengths.map((s, idx) => (
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
