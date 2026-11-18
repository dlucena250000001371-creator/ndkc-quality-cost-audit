import React, { useState } from 'react';
import {
  ClipboardList,
  FileBarChart2,
  FileCheck2,
  Home,
  LayoutGrid,
  LogOut,
  MessageSquareText,
  UserCircle2,
} from 'lucide-react';
import { formatDisplayNameTitleCase } from '../lib/display';

export type NavTab =
  | 'home'
  | 'interview'
  | 'my-audits'
  | 'profile'
  | 'admin-baseline'
  | 'admin-ledger'
  | 'admin-reports';

interface AppShellProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isAdmin: boolean;
  displayName: string;
  photoURL: string;
  onSignOut: () => void;
  children: React.ReactNode;
}

export function AppShell({
  activeTab,
  onSelectTab,
  isAdmin,
  displayName,
  photoURL,
  onSignOut,
  children,
}: AppShellProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const navItems: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'interview', label: 'Interview', icon: MessageSquareText },
    { id: 'my-audits', label: 'My Audits', icon: ClipboardList },
    { id: 'profile', label: 'Profile', icon: UserCircle2 },
  ];

  if (isAdmin) {
    navItems.push(
      { id: 'admin-baseline', label: 'Baseline', icon: FileCheck2 },
      { id: 'admin-ledger', label: 'Ledger', icon: LayoutGrid },
      { id: 'admin-reports', label: 'Reports', icon: FileBarChart2 }
    );
  }

  const formattedDisplayName = formatDisplayNameTitleCase(displayName);
  const initials = (formattedDisplayName || 'ND')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="min-h-screen flex flex-col bg-[#F1F5F9]">
      {/* Slim White Header */}
      <header className="h-14 bg-white border-b border-[#E2E8F0] px-4 md:px-6 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <span className="text-base md:text-lg font-extrabold text-[#1E40AF] tracking-tight whitespace-nowrap">
            NDKC Quality Cost Audit
          </span>
          <span className="text-xs text-slate-500 font-semibold truncate hidden sm:inline">
            Notre Dame of Kidapawan College
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-bold text-slate-700 hidden sm:inline max-w-[200px] truncate">
            {formattedDisplayName}
          </span>
          {photoURL && !imgFailed ? (
            <img
              src={photoURL}
              alt={formattedDisplayName}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="w-8 h-8 rounded-full object-cover border border-[#E2E8F0]"
            />
          ) : (
            <div
              style={{ backgroundColor: '#1E40AF', color: '#FFFFFF' }}
              className="w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center"
            >
              {initials || 'ND'}
            </div>
          )}
        </div>
      </header>

      {/* Mobile Horizontal Scrolling Tab Strip (< 768px) */}
      <nav
        aria-label="Primary navigation"
        className="md:hidden rail-royal flex items-center gap-1 px-2 py-1.5 overflow-x-auto shrink-0"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              style={active ? { backgroundColor: '#F97316', color: '#FFFFFF' } : undefined}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors duration-200 ${
                active ? '' : 'text-blue-100 hover:bg-blue-800/70'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={onSignOut}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-blue-100 hover:bg-blue-800/70 whitespace-nowrap shrink-0 ml-auto"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Sign out</span>
        </button>
      </nav>

      {/* Desktop Body: Left 76px Icon Rail + Main Content */}
      <div className="flex flex-1 min-h-0">
        <aside
          aria-label="Sidebar navigation"
          className="hidden md:flex flex-col w-[76px] shrink-0 rail-royal py-3 px-1.5 justify-between z-10"
        >
          <div className="flex flex-col gap-1.5 items-center w-full">
            {/* Round Q Logo Mark */}
            <div
              className="logo-coral w-9 h-9 rounded-full font-extrabold text-base flex items-center justify-center shadow-sm mb-2 shrink-0 select-none"
              aria-hidden="true"
            >
              Q
            </div>

            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <div key={item.id} className="relative group w-full">
                  <button
                    type="button"
                    title={item.label}
                    onClick={() => onSelectTab(item.id)}
                    style={active ? { backgroundColor: '#F97316', color: '#FFFFFF' } : undefined}
                    className={`w-full py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition-all duration-200 cursor-pointer ${
                      active
                        ? 'shadow-sm'
                        : 'text-blue-100 hover:bg-blue-800/70 hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span className="text-[11px] font-bold leading-tight text-center">
                      {item.label}
                    </span>
                  </button>
                  <span
                    role="tooltip"
                    className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold whitespace-nowrap shadow-md z-30"
                  >
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="relative group w-full">
            <button
              type="button"
              title="Sign out"
              onClick={onSignOut}
              className="w-full py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1 text-blue-100 hover:bg-blue-800/70 hover:text-white transition-all duration-200 cursor-pointer"
            >
              <LogOut className="w-5 h-5 shrink-0" />
              <span className="text-[11px] font-bold leading-tight text-center">Sign out</span>
            </button>
            <span
              role="tooltip"
              className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold whitespace-nowrap shadow-md z-30"
            >
              Sign out
            </span>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[1280px] mx-auto w-full h-full">{children}</div>
        </main>
      </div>
    </div>
  );
}
