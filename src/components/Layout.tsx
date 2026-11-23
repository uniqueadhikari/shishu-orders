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
  onSignOut,
  children,
}: LayoutProps) {
  const displayBrand = (brandName || 'SHISHU.CLO').toUpperCase();

  return (
    <div className="min-h-screen bg-[#F8F7F4] text-[#141413] flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-[#E8E5DF] px-5 py-6 justify-between">
        <div>
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="text-left cursor-pointer"
          >
            <span className="font-display text-2xl font-semibold tracking-[0.06em] text-[#141413] block whitespace-nowrap">
              {displayBrand}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenNewOrder}
            className="mt-6 w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#141413] text-white text-sm font-medium hover:bg-[#292826] active:scale-[0.99] transition-all flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
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
                  className={`w-full min-h-[42px] px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-3 transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-[#F3F0EA] text-[#141413]'
                      : 'text-[#57534E] hover:bg-[#FAF9F7] hover:text-[#141413]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="pt-4 border-t border-[#ECE9E2] space-y-3">
          <div className="px-1">
            <p className="text-xs font-medium text-[#78716C]">Signed in as</p>
            <p className="text-xs font-medium text-[#141413] truncate mt-0.5">{userEmail}</p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full min-h-[40px] px-3 py-2 rounded-xl text-xs font-medium text-[#57534E] hover:bg-[#F5F3EE] hover:text-[#141413] flex items-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Compact Header (<= 56px) */}
      <header className="no-print lg:hidden sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-[#E8E5DF] px-4 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className="font-display text-xl font-semibold tracking-[0.06em] text-[#141413] whitespace-nowrap shrink-0 cursor-pointer"
        >
          {displayBrand}
        </button>

        {activeView !== 'new-order' && (
          <button
            type="button"
            onClick={onOpenNewOrder}
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#141413] text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 active:scale-[0.98] transition-transform cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>New Order</span>
          </button>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 lg:pl-64 pb-24 lg:pb-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
          {children}
        </div>
      </main>

      {/* Mobile Fixed Bottom Navigation (<= 64px) */}
      <nav
        aria-label="Mobile navigation"
        className="no-print lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-[#E8E5DF] pb-safe"
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
                className={`flex flex-col items-center justify-center gap-1 min-h-[44px] transition-colors cursor-pointer ${
                  isActive ? 'text-[#141413]' : 'text-[#78716C]'
                }`}
              >
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
