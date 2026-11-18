import {
  ClipboardList,
  FileSpreadsheet,
  MessageSquareText,
  ShieldCheck,
} from 'lucide-react';
import { PAF_CATEGORIES, PafCategoryIcon } from '../lib/display';

interface LandingPageProps {
  onSignIn: () => void;
  signingIn: boolean;
  errorMessage: string | null;
}

const HOW_IT_WORKS_STEPS = [
  {
    num: 1,
    text: 'Tell us about one work process',
    icon: ClipboardList,
  },
  {
    num: 2,
    text: 'Answer 7 short questions',
    icon: MessageSquareText,
  },
  {
    num: 3,
    text: 'Get your Quality Cost Sheet',
    icon: FileSpreadsheet,
  },
];

export function LandingPage({ onSignIn, signingIn, errorMessage }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-[#F1F5F9] grid grid-cols-1 lg:grid-cols-2">
      {/* Left Hero Panel: Full-height blue-to-indigo gradient with dotted pattern */}
      <section className="hero-gradient lg:min-h-screen p-8 md:p-12 lg:p-16 flex flex-col justify-center">
        <div className="max-w-lg mx-auto lg:mx-0 w-full space-y-8 animate-fade-rise">
          <div className="space-y-3">
            <div
              className="text-xs font-extrabold uppercase tracking-widest"
              style={{ color: '#FDBA74' }}
            >
              Notre Dame of Kidapawan College
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-[42px] font-extrabold tracking-tight leading-tight text-white">
              NDKC Quality Cost Audit
            </h1>
            <p className="text-base md:text-lg leading-relaxed" style={{ color: '#DBEAFE' }}>
              See how much of your working week goes into getting work right the first time versus
              fixing rework, complaints, and corrections.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <div
              className="text-xs font-extrabold uppercase tracking-wider"
              style={{ color: '#FDBA74' }}
            >
              How it works
            </div>
            <ol className="space-y-3">
              {HOW_IT_WORKS_STEPS.map((step) => {
                const Icon = step.icon;
                return (
                  <li
                    key={step.num}
                    style={{ backgroundColor: 'rgba(255, 255, 255, 0.12)' }}
                    className="flex items-center gap-3.5 border border-white/20 rounded-2xl px-4 py-3"
                  >
                    <div className="logo-coral w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="text-sm md:text-base font-bold text-white">
                      <span style={{ color: '#FDBA74' }} className="mr-1.5">
                        {step.num}.
                      </span>
                      {step.text}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </section>

      {/* Right Column: Sign-In Card */}
      <main className="flex items-center justify-center p-6 md:p-12">
        <div className="max-w-lg w-full bg-white border border-[#E2E8F0] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 p-7 md:p-9 space-y-6 animate-fade-rise">
          <div className="space-y-1">
            <h2 className="text-2xl font-extrabold text-slate-900">Cost of Quality Model</h2>
            <p className="text-sm text-slate-600">
              Your interview sorts weekly process time into four clear categories.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PAF_CATEGORIES.map((item) => (
              <div
                key={item.category}
                className={`p-3.5 rounded-2xl border ${item.softBg} ${item.softBorder} space-y-1`}
              >
                <div className="flex items-center gap-2">
                  <PafCategoryIcon category={item.category} className="w-4 h-4 shrink-0" />
                  <span className={`text-sm font-extrabold ${item.textColor}`}>
                    {item.category}
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-snug">{item.meaning}</p>
              </div>
            ))}
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
            >
              {errorMessage}
            </div>
          )}

          <div className="space-y-3 pt-1">
            <button
              type="button"
              onClick={onSignIn}
              disabled={signingIn}
              className="btn-royal w-full py-3.5 px-5 disabled:opacity-60 font-bold text-base rounded-xl transition-colors flex items-center justify-center gap-2.5 cursor-pointer"
            >
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <span>{signingIn ? 'Signing in...' : 'Sign in with Google'}</span>
            </button>
            <p className="text-xs text-slate-500 text-center">
              Sign in with any Google account to complete your profile and start an audit.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
