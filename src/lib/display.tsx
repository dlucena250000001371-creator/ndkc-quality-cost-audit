import { AlertTriangle, SearchCheck, ShieldCheck, Wrench } from 'lucide-react';
import type { CostCategory } from '../types/audit';

export function toTitleCaseWord(word: string): string {
  const cleaned = word.trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

export function formatDisplayNameTitleCase(name: string): string {
  const cleaned = (name || '').trim();
  if (!cleaned) return 'NDKC Employee';
  return cleaned
    .split(/\s+/)
    .map((part) => toTitleCaseWord(part))
    .join(' ');
}

export function formatFirstNameTitleCase(name: string): string {
  const cleaned = (name || '').trim();
  if (!cleaned) return 'Colleague';
  const first = cleaned.split(/\s+/)[0] || 'Colleague';
  return toTitleCaseWord(first);
}

export function formatWelcomeTextTitleCase(content: string): string {
  return content.replace(/^Hello\s+([^.\n]+)\./, (_match, rawName: string) => {
    return `Hello ${formatFirstNameTitleCase(rawName)}.`;
  });
}

export function getTimeGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatTodayLabel(date: Date = new Date()): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export const PAF_CATEGORIES: Array<{
  category: CostCategory;
  color: string;
  softBg: string;
  softBorder: string;
  textColor: string;
  meaning: string;
}> = [
  {
    category: 'Prevention',
    color: '#16A34A',
    softBg: 'bg-green-50',
    softBorder: 'border-green-200',
    textColor: 'text-green-800',
    meaning: 'Getting it right the first time',
  },
  {
    category: 'Appraisal',
    color: '#2563EB',
    softBg: 'bg-blue-50',
    softBorder: 'border-blue-200',
    textColor: 'text-blue-800',
    meaning: 'Checking before release',
  },
  {
    category: 'Internal Failure',
    color: '#F59E0B',
    softBg: 'bg-amber-50',
    softBorder: 'border-amber-200',
    textColor: 'text-amber-900',
    meaning: 'Fixing before anyone sees it',
  },
  {
    category: 'External Failure',
    color: '#DC2626',
    softBg: 'bg-red-50',
    softBorder: 'border-red-200',
    textColor: 'text-red-800',
    meaning: 'Fixing after it reaches students or offices',
  },
];

export function PafCategoryIcon({
  category,
  className = 'w-4 h-4',
}: {
  category: CostCategory;
  className?: string;
}) {
  switch (category) {
    case 'Prevention':
      return <ShieldCheck className={className} style={{ color: '#16A34A' }} />;
    case 'Appraisal':
      return <SearchCheck className={className} style={{ color: '#2563EB' }} />;
    case 'Internal Failure':
      return <Wrench className={className} style={{ color: '#F59E0B' }} />;
    case 'External Failure':
      return <AlertTriangle className={className} style={{ color: '#DC2626' }} />;
  }
}

export function PafCategoryChip({ category }: { category: CostCategory }) {
  const meta = PAF_CATEGORIES.find((p) => p.category === category);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-bold border ${
        meta ? `${meta.softBg} ${meta.textColor} ${meta.softBorder}` : 'bg-slate-100 text-slate-800 border-slate-200'
      }`}
    >
      <PafCategoryIcon category={category} className="w-3.5 h-3.5 shrink-0" />
      <span>{category}</span>
    </span>
  );
}

export function getPartBorderColor(questionNumber: number, isClosingCard = false): string {
  if (isClosingCard) return '#F97316';
  switch (questionNumber) {
    case 1:
      return '#1E40AF';
    case 2:
      return '#16A34A';
    case 3:
      return '#2563EB';
    case 4:
      return '#F59E0B';
    case 5:
      return '#DC2626';
    case 6:
      return '#7C3AED';
    case 7:
      return '#F97316';
    default:
      return '#1E40AF';
  }
}
