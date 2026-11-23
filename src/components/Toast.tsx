import { CheckCircle2, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  text: string;
  tone?: 'success' | 'info';
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="no-print fixed bottom-20 lg:bottom-6 right-4 sm:right-6 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-auto pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="animate-toast pointer-events-auto bg-[#121211] text-[#F7F5F0] border border-white/10 rounded-xl px-4 py-3 shadow-lg flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {toast.tone === 'info' ? (
              <Info className="w-4 h-4 text-stone-300 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span className="text-xs sm:text-sm font-medium truncate">{toast.text}</span>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="p-1 text-stone-400 hover:text-white transition-colors shrink-0 cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
