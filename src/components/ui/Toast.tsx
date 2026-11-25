import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X, Info } from 'lucide-react';
import { ToastContext, type ToastType, type ToastOptions } from './ToastContext';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const icons: Record<ToastType, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-success shrink-0" />,
  error: <AlertCircle className="h-5 w-5 text-danger shrink-0" />,
  info: <Info className="h-5 w-5 text-primary shrink-0" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, typeOrOptions: ToastType | ToastOptions = 'success') => {
    const id = crypto.randomUUID();
    let type: ToastType = 'success';
    let duration = 4000;
    let action: { label: string; onClick: () => void } | undefined;

    if (typeof typeOrOptions === 'string') {
      type = typeOrOptions;
    } else if (typeOrOptions) {
      type = typeOrOptions.type || 'success';
      duration = typeOrOptions.duration || 4000;
      action = typeOrOptions.action;
    }

    setToasts(prev => [...prev, { id, message, type, duration, action }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-full max-w-sm px-4" role="log" aria-live="polite">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div
      className="flex items-center gap-3 bg-surface border border-border rounded-[var(--radius-card)] px-4 py-3 shadow-[var(--shadow-lg)]"
      style={{ animation: 'slide-up 200ms ease-out both' }}
    >
      {icons[toast.type]}
      <p className="text-sm text-ink flex-1">{toast.message}</p>
      {toast.action && (
        <button
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
          className="text-xs font-bold text-primary hover:underline px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 transition-colors cursor-pointer shrink-0"
        >
          {toast.action.label}
        </button>
      )}
      <button onClick={() => onDismiss(toast.id)} aria-label="Dismiss" className="text-muted hover:text-ink shrink-0 cursor-pointer">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
