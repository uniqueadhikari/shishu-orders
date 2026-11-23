import {
  BarChart3,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { AppView } from '../types/order';

interface LayoutProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onOpenNewOrder: () => void;
  userEmail: string;
  brandName: string;
  activeOrderCount?: number;
  onSignOut: () => void;
  children: ReactNode;
}

const NAV_ITEMS: { id: Exclude<AppView, 'new-order'>; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Layout({
  activeView,
  onNavigate,
  onOpenNewOrder,
  userEmail,
  brandName,
  activeOrderCount = 0,
  onSignOut,
  children,
}: LayoutProps) {
  const displayBrand = (brandName || 'SHISHU.CLO').toUpperCase();

  return (
    <div className="min-h-screen bg-[#F7F5F0] text-[#121211] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-[#E6E2D8] px-5 py-6 justify-between">
        <div>
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="w-full text-left flex items-center gap-3 group cursor-pointer"
          >
            <div className="w-9 h-9 rounded-lg overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0] flex items-center justify-center shrink-0">
              <img
                src="/favicon.ico"
                alt={displayBrand}
                className="w-6 h-6 object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="min-w-0">
              <span className="font-display text-[22px] font-semibold tracking-[0.07em] text-[#121211] block leading-none truncate">
                {displayBrand}
              </span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-[#8C877E] mt-1">
                Order Manager
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={onOpenNewOrder}
            className="mt-6 w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-[#121211] text-[#F7F5F0] text-sm font-medium hover:bg-[#272624] active:scale-[0.99] transition-all flex items-center justify-center gap-2 whitespace-nowrap shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>New Order</span>
          </button>

          <nav className="mt-6 space-y-1" aria-label="Primary navigation">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`w-full min-h-[42px] px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center justify-between gap-3 transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-[#F2EFE8] text-[#121211]'
                      : 'text-[#5C5852] hover:bg-[#FAF9F5] hover:text-[#121211]'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="w-4 h-4 shrink-0" strokeWidth={isActive ? 2.1 : 1.75} />
                    <span>{item.label}</span>
                  </span>
                  {item.id === 'orders' && activeOrderCount > 0 && (
                    <span className="font-mono text-[11px] font-semibold tabular-nums text-[#8C877E]">
                      {activeOrderCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="pt-4 border-t border-[#ECE9E2] space-y-3">
          <div className="px-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#8C877E]">
              Studio Team
            </p>
            <p className="text-xs font-medium text-[#121211] truncate mt-0.5">{userEmail}</p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full min-h-[40px] px-3 py-2 rounded-xl text-xs font-medium text-[#5C5852] hover:bg-[#F7F5F0] hover:text-[#121211] flex items-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Compact Header (<= 56px) */}
      <header className="no-print lg:hidden sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-[#E6E2D8] px-4 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className="flex items-center gap-2.5 shrink-0 cursor-pointer"
        >
          <img
            src="/favicon.ico"
            alt=""
            className="w-6 h-6 rounded object-contain"
            referrerPolicy="no-referrer"
          />
          <span className="font-display text-xl font-semibold tracking-[0.07em] text-[#121211] whitespace-nowrap">
            {displayBrand}
          </span>
        </button>

        {activeView !== 'new-order' && (
          <button
            type="button"
            onClick={onOpenNewOrder}
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#121211] text-[#F7F5F0] text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 active:scale-[0.98] transition-transform cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>New Order</span>
          </button>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 lg:pl-64 pb-24 lg:pb-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
          {children}
        </div>
      </main>

      {/* Mobile Fixed Bottom Navigation (<= 64px) */}
      <nav
        aria-label="Mobile navigation"
        className="no-print lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-[#E6E2D8] pb-safe"
      >
        <div className="grid grid-cols-4 h-16">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative flex flex-col items-center justify-center gap-1 min-h-[44px] transition-colors cursor-pointer ${
                  isActive ? 'text-[#121211]' : 'text-[#8C877E]'
                }`}
              >
                {isActive && (
                  <span
                    className="absolute top-0 inset-x-6 h-[2px] bg-[#121211] rounded-full"
                    aria-hidden="true"
                  />
                )}
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.2 : 1.75} />
                <span className={`text-[11px] leading-none ${isActive ? 'font-semibold' : 'font-medium'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
