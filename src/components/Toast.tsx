import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'error' | 'success' | 'info';
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-[calc(100vw-2rem)]"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const isError = toast.type === 'error';
        const isSuccess = toast.type === 'success';
        const bg = isError
          ? 'bg-red-50 border-red-200 text-red-900'
          : isSuccess
            ? 'bg-green-50 border-green-200 text-green-900'
            : 'bg-white border-[#E2E8F0] text-slate-900';

        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 p-3.5 rounded-2xl border shadow-sm ${bg}`}
          >
            {isError ? (
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 text-sm leading-snug">{toast.message}</div>
            {toast.actionLabel && toast.onAction && (
              <button
                type="button"
                onClick={() => {
                  onDismiss(toast.id);
                  toast.onAction?.();
                }}
                className="px-3 py-1 text-xs font-bold bg-[#F97316] text-white rounded-lg hover:bg-orange-600 transition-colors shrink-0 whitespace-nowrap"
              >
                {toast.actionLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="text-slate-400 hover:text-slate-700 p-0.5 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
